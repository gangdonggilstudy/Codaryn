/**
 * SP-4 (docs/design/second-provider.md 4.4, 4.5, 6; contract CodarynConfig.provider/providers,
 * ConfigProfile.provider, ProviderSettings): the config file chooses the quick form's API provider
 * and holds settings per provider; the settings resolve from the chosen provider's entry, its key
 * variable and its address rule; CODARYN_MODEL and CODARYN_API_BASE_URL apply to the chosen
 * provider only. The anthropic results stay as they were (the SP-0 pins P-7).
 * Fake values built at run time; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  ANTHROPIC_API_KEY_ENV,
  CODARYN_API_BASE_URL_ENV,
  CODARYN_MODEL_ENV,
  DEFAULT_OPENAI_API_BASE_URL,
  OPENAI_API_KEY_ENV,
} from "../../../src/contracts/index.js";
import type { CodarynConfig, DoctorOutput } from "../../../src/contracts/index.js";
import { parseConfig } from "../../../src/cli/config.js";
import { selectProfile } from "../../../src/cli/config-file.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { resolveAnthropicSettings, resolveApiSettings, resolveListSettings } from "../../../src/cli/settings.js";
import { buildQuickTask, parseTask } from "../../../src/cli/task.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const ANTHROPIC_VALUE = ["fake", "sp4", "anthropic", "0001"].join("-");
const OPENAI_VALUE = ["fake", "sp4", "openai", "0001"].join("-");
const LIMITS = { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 1000, maxDurationMs: 60_000 };

function config(value: Record<string, unknown>): CodarynConfig {
  const parsed = parseConfig({ schemaVersion: 1, ...value });
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
  return parsed.config;
}

function refused(value: Record<string, unknown>): string {
  const parsed = parseConfig({ schemaVersion: 1, ...value });
  assert.equal(parsed.ok, false, JSON.stringify(value));
  return parsed.ok ? "" : parsed.message;
}

describe("SP-4: the config file's provider fields", () => {
  test("provider, providers and a profile's provider are read", () => {
    const read = config({
      provider: "openai",
      providers: { openai: { model: "gpt-x", maxOutputTokens: 64, apiBaseUrl: "https://proxy.example/v1", requestTimeoutMs: 1000, maxRetries: 1 } },
      profiles: { fast: { provider: "anthropic" } },
    });
    assert.equal(read.provider, "openai");
    assert.deepEqual(read.providers?.openai, { model: "gpt-x", maxOutputTokens: 64, apiBaseUrl: "https://proxy.example/v1", requestTimeoutMs: 1000, maxRetries: 1 });
    assert.equal(read.profiles?.["fast"]?.provider, "anthropic");
    assert.deepEqual(config({ providers: { anthropic: { model: "claude-x" } } }).providers?.anthropic, { model: "claude-x" });
  });

  test("an unknown provider, an unknown settings field or scripted is invalid", () => {
    assert.match(refused({ provider: "scripted" }), /^provider /);
    assert.match(refused({ provider: "other" }), /^provider /);
    assert.match(refused({ providers: { other: {} } }), /^providers /);
    assert.match(refused({ providers: { openai: { limits: {} } } }), /providers\.openai/);
    assert.match(refused({ providers: [] }), /^providers /);
    assert.match(refused({ profiles: { fast: { provider: "other" } } }), /profiles\[0\]\.provider/);
  });

  test("top-level provider settings and providers.anthropic together are invalid (ambiguous)", () => {
    for (const field of ["model", "maxOutputTokens", "apiBaseUrl", "requestTimeoutMs", "maxRetries"]) {
      const top = { model: "claude-x", maxOutputTokens: 100, apiBaseUrl: "https://proxy.example", requestTimeoutMs: 1000, maxRetries: 1 }[field];
      assert.match(refused({ [field]: top, providers: { anthropic: {} } }), /providers\.anthropic/, field);
    }
    // providers.openai beside the top-level fields is fine: those are anthropic's.
    assert.ok(config({ model: "claude-x", providers: { openai: { model: "gpt-x" } } }).providers?.openai);
  });

  test("each provider's own address rule and output token bounds (API_PROVIDERS)", () => {
    // openai's address includes the version; it may not name an endpoint.
    assert.ok(config({ providers: { openai: { apiBaseUrl: "https://api.openai.com/v1" } } }));
    assert.match(refused({ providers: { openai: { apiBaseUrl: "https://api.openai.com/v1/responses" } } }), /providers\.openai\.apiBaseUrl/);
    assert.match(refused({ providers: { openai: { apiBaseUrl: "https://api.openai.com/v1/models/" } } }), /providers\.openai\.apiBaseUrl/);
    assert.match(refused({ providers: { openai: { apiBaseUrl: "http://example.com/v1" } } }), /providers\.openai\.apiBaseUrl/);
    // anthropic's does not (the adapter adds /v1/messages), wherever it is written.
    assert.match(refused({ providers: { anthropic: { apiBaseUrl: "https://proxy.example/v1" } } }), /providers\.anthropic\.apiBaseUrl/);
    // openai takes at least 16 output tokens.
    assert.match(refused({ providers: { openai: { maxOutputTokens: 8 } } }), /providers\.openai\.maxOutputTokens/);
    assert.ok(config({ providers: { anthropic: { maxOutputTokens: 8 } } }));
  });
});

describe("SP-4: the settings resolve for the chosen provider", () => {
  const both = config({
    model: "claude-top",
    maxOutputTokens: 100,
    providers: { openai: { model: "gpt-own", maxOutputTokens: 200, requestTimeoutMs: 5000, maxRetries: 0 } },
  });
  const env = { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE, [OPENAI_API_KEY_ENV]: OPENAI_VALUE };

  test("openai: its own key variable, entry and default address", () => {
    const resolved = resolveApiSettings({ provider: "openai" }, env, both);
    assert.ok(resolved.ok, resolved.ok ? "" : resolved.message);
    assert.deepEqual(resolved.settings, {
      apiKey: OPENAI_VALUE,
      model: "gpt-own",
      maxOutputTokens: 200,
      apiBaseUrl: DEFAULT_OPENAI_API_BASE_URL,
      requestTimeoutMs: 5000,
      maxRetries: 0,
    });
  });

  test("anthropic reads the top-level fields or providers.anthropic alike, never another provider's", () => {
    const top = resolveAnthropicSettings({ provider: "anthropic" }, env, both);
    const listed = resolveAnthropicSettings({ provider: "anthropic" }, env, config({ providers: { anthropic: { model: "claude-top", maxOutputTokens: 100 } } }));
    assert.ok(top.ok && listed.ok);
    assert.deepEqual(listed.settings, top.settings);
    assert.equal(top.settings.apiKey, ANTHROPIC_VALUE);
    const none = resolveAnthropicSettings({ provider: "anthropic" }, env, config({ providers: { openai: { model: "gpt-own", maxOutputTokens: 200 } } }));
    assert.ok(!none.ok && none.code === "provider_not_configured");
  });

  test("a missing openai key names OPENAI_API_KEY; the anthropic key does not stand in", () => {
    const resolved = resolveApiSettings({ provider: "openai" }, { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE }, both);
    assert.ok(!resolved.ok && resolved.code === "provider_not_configured");
    assert.ok(resolved.message.includes(OPENAI_API_KEY_ENV), resolved.message);
    assert.equal(resolved.message.includes(ANTHROPIC_VALUE), false);
  });

  test("a missing openai model or cap names providers.openai", () => {
    const resolved = resolveApiSettings({ provider: "openai" }, env, config({}));
    assert.ok(!resolved.ok);
    assert.ok(resolved.message.includes("providers.openai.model") && resolved.message.includes("providers.openai.maxOutputTokens"), resolved.message);
  });

  test("each provider has its own model and address variables, checked with its address rule (DR-34 (a))", () => {
    // DR-34 (a) replaced SP-4's "the variables apply to the chosen provider": CODARYN_MODEL and
    // CODARYN_API_BASE_URL are anthropic's, OpenAI has CODARYN_OPENAI_MODEL and CODARYN_OPENAI_API_BASE_URL.
    const withEnv = { ...env, CODARYN_OPENAI_MODEL: "env-model", CODARYN_OPENAI_API_BASE_URL: "https://proxy.example/v1" };
    const openai = resolveApiSettings({ provider: "openai" }, withEnv, both);
    assert.ok(openai.ok, openai.ok ? "" : openai.message);
    assert.deepEqual([openai.settings.model, openai.settings.apiBaseUrl], ["env-model", "https://proxy.example/v1"]);
    // The same address in anthropic's variable is refused, its adapter adds /v1/messages.
    const anthropic = resolveApiSettings({ provider: "anthropic" }, { ...env, [CODARYN_MODEL_ENV]: "env-model", [CODARYN_API_BASE_URL_ENV]: "https://proxy.example/v1" }, both);
    assert.ok(!anthropic.ok && anthropic.code === "invalid_config" && anthropic.message.startsWith(CODARYN_API_BASE_URL_ENV), anthropic.ok ? "" : anthropic.message);
  });

  test("listing settings follow the provider too", () => {
    const listed = resolveListSettings(env, both, "openai");
    assert.ok(listed.ok);
    assert.deepEqual([listed.settings.apiKey, listed.settings.apiBaseUrl], [OPENAI_VALUE, DEFAULT_OPENAI_API_BASE_URL]);
  });
});

describe("SP-4: tasks and the quick form", () => {
  test("a task file may name openai, within its output token bounds", () => {
    const base = { schemaVersion: 1, id: "t", goal: "g", workflow: "label", workspaceRoot: "./ws", policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false }, privacy: { secretEnv: [] }, limits: LIMITS, verifiers: [] };
    const ok = parseTask({ ...base, model: { provider: "openai", model: "gpt-x", maxOutputTokens: 16 } }, tmpdir());
    assert.ok(ok.ok, ok.ok ? "" : ok.message);
    assert.deepEqual(ok.task.model, { provider: "openai", model: "gpt-x", maxOutputTokens: 16 });
    const small = parseTask({ ...base, model: { provider: "openai", maxOutputTokens: 8 } }, tmpdir());
    assert.ok(!small.ok && small.message.startsWith("model.maxOutputTokens"), small.ok ? "" : small.message);
    const other = parseTask({ ...base, model: { provider: "other" } }, tmpdir());
    assert.ok(!other.ok && other.message.startsWith("model.provider"));
  });

  test("the quick form takes the profile's provider, else the config's, else anthropic", () => {
    const file = config({ provider: "openai", limits: LIMITS, profiles: { first: { provider: "anthropic" }, plain: {} } });
    const quick = (value: CodarynConfig | null) => {
      const built = buildQuickTask({ workspace: "ws", goal: "g", cwd: tmpdir(), config: value });
      assert.ok(built.ok, built.ok ? "" : built.message);
      return built.task.model.provider;
    };
    assert.equal(quick(file), "openai");
    const first = selectProfile(file, "first");
    const plain = selectProfile(file, "plain");
    assert.ok(first.ok && plain.ok);
    assert.equal(quick(first.config), "anthropic");
    assert.equal(quick(plain.config), "openai");
    assert.equal(quick(config({ limits: LIMITS })), "anthropic");
  });

  test("an openai quick form needs a token limit like anthropic", () => {
    const built = buildQuickTask({ workspace: "ws", goal: "g", cwd: tmpdir(), config: config({ provider: "openai", limits: { ...LIMITS, maxTotalTokens: null } }) });
    assert.ok(!built.ok && built.message.startsWith("limits.maxTotalTokens"), built.ok ? "" : built.message);
  });
});

async function workspace(configValue: Record<string, unknown>): Promise<{ base: string; ws: string; configPath: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-sp4-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  const configPath = path.join(base, "config.json");
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, ...configValue }), "utf8");
  return { base, ws, configPath };
}

describe("SP-4: commands with the openai provider chosen", () => {
  test("run: an openai quick form stops before anything is sent (SP-6 connects it)", async () => {
    const { base, ws, configPath } = await workspace({ provider: "openai", providers: { openai: { model: "gpt-x", maxOutputTokens: 64 } }, limits: LIMITS });
    let created = false;
    const outcome = await runCli({
      argv: ["run", "--workspace", ws, "--goal", "g", "--config", configPath, "--quiet"],
      env: { [OPENAI_API_KEY_ENV]: OPENAI_VALUE },
      cwd: base,
      readFile: (file) => readFile(file, "utf8"),
      isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
      loadEnvFile: () => {},
      locateInWorkspace: (file, root) => locateInWorkspace(file, root),
      relatePaths: (target, root) => relateRealPaths(target, root),
      clock: { now: () => Date.now() },
      randomBytes: (size) => new Uint8Array(size).fill(3),
      assemble: async () => {
        throw new Error("nothing may be assembled");
      },
      cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
      createAnthropicProvider: () => {
        created = true;
        throw new Error("the anthropic provider may not be made");
      },
    });
    assert.ok(outcome.output.kind === "error" && outcome.output.code === "provider_not_implemented", JSON.stringify(outcome.output));
    assert.equal(created, false);
  });

  test("doctor: the quick form's api_key and model checks are about the chosen provider", async () => {
    const { base, ws, configPath } = await workspace({ provider: "openai", providers: { openai: { model: "gpt-x", maxOutputTokens: 64 } }, limits: LIMITS });
    const doctor = async (env: Record<string, string>) => {
      const outcome = await runDoctor({
        argv: ["doctor", "--config", configPath, "--workspace", ws, "--json"],
        env,
        cwd: base,
        nodeVersion: "26.13.0",
        readFile: (file) => readFile(file, "utf8"),
        isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
        isFile: async (file) => (await stat(file).catch(() => null))?.isFile() ?? false,
        locateInWorkspace: (file, root) => locateInWorkspace(file, root),
        relatePaths: (target, root) => relateRealPaths(target, root),
      });
      assert.ok("text" in outcome);
      const output = JSON.parse(outcome.text) as DoctorOutput;
      return Object.fromEntries(output.checks.map((check) => [check.id, check]));
    };
    const missing = await doctor({ [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE });
    assert.equal(missing["api_key"]?.status, "fail");
    assert.deepEqual(missing["api_key"]?.text, { id: "doctor.api_key.missing", params: { keyEnv: OPENAI_API_KEY_ENV, provider: "openai" } });
    const ready = await doctor({ [OPENAI_API_KEY_ENV]: OPENAI_VALUE });
    assert.equal(ready["api_key"]?.status, "ok");
    // The model and cap come from providers.openai.
    assert.equal(ready["model"]?.status, "ok", ready["model"]?.message ?? "");
    assert.equal(ready["limits"]?.status, "ok", ready["limits"]?.message ?? "");
  });
});
