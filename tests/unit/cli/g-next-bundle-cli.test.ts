/**
 * Reproductions for the next bundle's CLI items, todo until their contract is in:
 * - Review R-26 L-1: when the config file fails its checks, doctor still names a key destination,
 *   the default address of the anthropic provider, although the provider and the address come from
 *   that config (main's human text named none). The quick form's provider is not known then; without
 *   an address variable no destination may be named.
 * - DR-41 (GUI F-5, app A-8): in the quick form the config's policy replaced a workflow definition's
 *   policy wholesale, so adding a config could loosen the definition. Protected paths are to be
 *   the union; commands and plan actions only what both allow.
 * Fake values; a stand-in assembly captures the task, so nothing runs and nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV, CODARYN_API_BASE_URL_ENV, OPENAI_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { DoctorOutput, PolicyConfig, ResolvedTaskSpec } from "../../../src/contracts/index.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const LIMITS = { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 1000, maxDurationMs: 60_000 };
const ANTHROPIC_VALUE = ["fake", "next", "anthropic", "value", "0001"].join("-");
const OPENAI_VALUE = ["fake", "next", "openai", "value", "0001"].join("-");

async function base(config: Record<string, unknown>): Promise<{ dir: string; ws: string; configPath: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "codaryn-g-next-bundle-"));
  temporaryDirs.push(dir);
  const ws = path.join(dir, "ws");
  await mkdir(ws);
  const configPath = path.join(dir, "config.json");
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, ...config }), "utf8");
  return { dir, ws, configPath };
}

describe("R-26 L-1: doctor names no key destination when the config file fails its checks", () => {
  async function apiKeyCheck(config: Record<string, unknown>, env: Record<string, string>): Promise<{ status: string; message: string; text: unknown; configStatus: string }> {
    const { dir, ws, configPath } = await base(config);
    const outcome = await runDoctor({
      argv: ["doctor", "--config", configPath, "--workspace", ws, "--json"],
      env,
      cwd: dir,
      nodeVersion: "26.0.0",
      readFile: (file) => readFile(file, "utf8"),
      isDirectory: async (folder) => (await stat(folder).catch(() => null))?.isDirectory() ?? false,
      isFile: async (file) => (await stat(file).catch(() => null))?.isFile() ?? false,
      locateInWorkspace: (file, root) => locateInWorkspace(file, root),
      relatePaths: (target, root) => relateRealPaths(target, root),
    });
    assert.ok("text" in outcome);
    const output = JSON.parse(outcome.text) as DoctorOutput;
    const check = output.checks.find((entry) => entry.id === "api_key");
    return { status: check?.status ?? "", message: check?.message ?? "", text: check?.text, configStatus: output.checks.find((entry) => entry.id === "config_file")?.status ?? "" };
  }

  const todo = { todo: "contract: a text for a key whose destination is not known yet (R-26 L-1; doctor.api_key.destination_unknown or the plain one)" };

  test("anthropic config with its own address and a bad limit: neither the default nor that address", todo, async () => {
    const check = await apiKeyCheck({ apiBaseUrl: "http://127.0.0.1:8447/proxy", model: "claude-x", maxOutputTokens: 100, limits: { ...LIMITS, maxModelTurns: -5 } }, { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE });
    assert.equal(check.configStatus, "fail");
    const said = `${check.message} ${JSON.stringify(check.text)}`;
    assert.equal(said.includes("api.anthropic.com") || said.includes("127.0.0.1:8447") || said.includes("sends_to"), false, said);
  });

  test("openai config with a bad limit: no anthropic destination either", todo, async () => {
    const check = await apiKeyCheck(
      { provider: "openai", providers: { openai: { model: "gpt-x", maxOutputTokens: 64, apiBaseUrl: "http://127.0.0.1:8448/v1" } }, limits: { ...LIMITS, maxModelTurns: -5 } },
      { [OPENAI_API_KEY_ENV]: OPENAI_VALUE, [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE },
    );
    const said = `${check.message} ${JSON.stringify(check.text)}`;
    assert.equal(said.includes("anthropic requests") || said.includes("api.anthropic.com") || said.includes("sends_to"), false, said);
  });

  test("an address variable comes first, so a broken config does not hide it (holds today)", async () => {
    const check = await apiKeyCheck({ model: "claude-x", maxOutputTokens: 100, limits: { ...LIMITS, maxModelTurns: -5 } }, { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE, [CODARYN_API_BASE_URL_ENV]: "https://gateway.example" });
    assert.ok(check.message.includes("https://gateway.example"), check.message);
  });
});

describe("DR-41: a config's policy does not loosen a workflow definition's in the quick form", () => {
  const NODE_A = { executable: "node", argsPrefix: ["a.js"], allowExtraArgs: false };
  const NODE_B = { executable: "node", argsPrefix: ["b.js"], allowExtraArgs: false };
  const DEFINITION_POLICY = { commands: [NODE_A], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"], protectedPaths: ["keep"] };
  const CONFIG_POLICY = { commands: [NODE_A, NODE_B], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move", "discard"], protectedPaths: ["other"] };

  async function effectivePolicy(config: Record<string, unknown>): Promise<PolicyConfig> {
    const { dir, ws, configPath } = await base({ model: "claude-x", maxOutputTokens: 100, limits: LIMITS, ...config });
    let captured: ResolvedTaskSpec | null = null;
    const outcome = await runCli({
      argv: ["run", "--workspace", ws, "--goal", "tidy up", "--workflow", "tidy", "--config", configPath, "--quiet"],
      env: { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE },
      cwd: dir,
      readFile: (file) => readFile(file, "utf8"),
      isDirectory: async (folder) => (await stat(folder).catch(() => null))?.isDirectory() ?? false,
      loadEnvFile: () => {},
      locateInWorkspace: (file, root) => locateInWorkspace(file, root),
      relatePaths: (target, root) => relateRealPaths(target, root),
      clock: { now: () => Date.now() },
      randomBytes: (size) => new Uint8Array(size).fill(13),
      createAnthropicProvider: () => ({ name: "anthropic", complete: async () => ({ ok: false, kind: "api_error", message: "unused" }) }),
      assemble: async (input) => {
        captured = input.task;
        return { ok: false, code: "internal_error", message: "stopped by the test" };
      },
      cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    });
    assert.ok(captured !== null, JSON.stringify(outcome.output));
    return (captured as ResolvedTaskSpec).policy;
  }

  const workflows = { tidy: { tools: ["read_file", "search_files", "propose_plan", "run_command"], plan: "apply", policy: DEFINITION_POLICY } };
  const rule = (entry: { executable: string; argsPrefix: readonly string[] }): string => `${entry.executable} ${entry.argsPrefix.join(" ")}`;

  test("without a config policy the definition's applies (holds today)", async () => {
    const policy = await effectivePolicy({ workflows });
    assert.deepEqual(policy.planActions, ["move"]);
    assert.deepEqual(policy.commands.map(rule), ["node a.js"]);
  });

  const todo = { todo: "contract and CLI: DR-41's merge (union of protected paths; commands and plan actions both allow)" };

  test("plan actions and commands: only what both allow", todo, async () => {
    const policy = await effectivePolicy({ workflows, policy: CONFIG_POLICY });
    assert.deepEqual(policy.planActions, ["move"]);
    assert.deepEqual(policy.commands.map(rule), ["node a.js"]);
  });

  test("protected paths: the union", todo, async () => {
    const policy = await effectivePolicy({ workflows, policy: CONFIG_POLICY });
    assert.deepEqual([...(policy.protectedPaths ?? [])].sort(), ["keep", "other"]);
  });
});
