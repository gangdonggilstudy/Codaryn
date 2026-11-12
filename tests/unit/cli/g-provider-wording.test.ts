/**
 * The documentation owner's findings with the real CLI (to be fixed after the third bundle, with
 * the contract's ids where a text needs one):
 * (1) doctor's human text for a missing output cap says "config maxOutputTokens" whatever the
 *     provider, while an openai run reads providers.openai.maxOutputTokens (the JSON message already
 *     names it). The catalog text doctor.model.output_cap_missing takes no parameter, so the place
 *     needs one from the contract.
 * (2) key_in_file says "keys are read only from the ANTHROPIC_API_KEY environment variable" also
 *     when the key found is an OpenAI one; the message must name that provider's key variable (all
 *     key variables when the finding belongs to none, such as a key field). This is the CLI's own
 *     message; no contract change is needed.
 * Cases that hold today pass; the others are todo. Fake values built at run time; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV, OPENAI_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { DoctorOutput, MessageLanguage } from "../../../src/contracts/index.js";
import { renderDoctor, runDoctor } from "../../../src/cli/doctor.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const LIMITS = { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 1000, maxDurationMs: 60_000 };
/** Key-like under the contract's refusal shapes (DR-33, DR-36 (c)), assembled at run time. */
const OPENAI_SHAPED = ["sk", "proj", "Ab3x".repeat(10)].join("-");
const ANTHROPIC_SHAPED = ["sk", "ant", "Ab3x".repeat(10)].join("-");
const OPENAI_VALUE = ["fake", "wording", "openai", "value", "0001"].join("-");

async function base(config: Record<string, unknown>): Promise<{ dir: string; ws: string; configPath: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "codaryn-g-provider-wording-"));
  temporaryDirs.push(dir);
  const ws = path.join(dir, "ws");
  await mkdir(ws);
  const configPath = path.join(dir, "config.json");
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, ...config }), "utf8");
  return { dir, ws, configPath };
}

describe("(1) doctor names where the missing output cap is read", () => {
  async function modelLine(config: Record<string, unknown>, language: MessageLanguage): Promise<{ line: string; message: string }> {
    const { dir, ws, configPath } = await base({ limits: LIMITS, ...config });
    const outcome = await runDoctor({
      argv: ["doctor", "--config", configPath, "--workspace", ws, "--json"],
      env: { [OPENAI_API_KEY_ENV]: OPENAI_VALUE },
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
    const catalog = createMessageCatalog(language);
    const label = catalog.format("doctor.check.model");
    const line = renderDoctor(output, catalog).split("\n").find((entry) => entry.includes(label)) ?? "";
    return { line, message: output.checks.find((check) => check.id === "model")?.message ?? "" };
  }

  const OPENAI_NO_CAP = { provider: "openai", providers: { openai: { model: "gpt-x" } } };

  test("the JSON message names providers.openai.maxOutputTokens (holds today)", async () => {
    const { message } = await modelLine(OPENAI_NO_CAP, "en");
    assert.ok(message.includes("providers.openai.maxOutputTokens"), message);
  });

  test("N-A 33.3 (0d38bfa): the model texts carry the provider's variable and config places", async () => {
    const { dir, ws, configPath } = await base({ limits: LIMITS, ...OPENAI_NO_CAP });
    const doctor = async (config: string): Promise<unknown> => {
      const outcome = await runDoctor({
        argv: ["doctor", "--config", config, "--workspace", ws, "--json"],
        env: { [OPENAI_API_KEY_ENV]: OPENAI_VALUE },
        cwd: dir,
        nodeVersion: "26.0.0",
        readFile: (file) => readFile(file, "utf8"),
        isDirectory: async (folder) => (await stat(folder).catch(() => null))?.isDirectory() ?? false,
        isFile: async (file) => (await stat(file).catch(() => null))?.isFile() ?? false,
        locateInWorkspace: (file, root) => locateInWorkspace(file, root),
        relatePaths: (target, root) => relateRealPaths(target, root),
      });
      assert.ok("text" in outcome);
      return (JSON.parse(outcome.text) as DoctorOutput).checks.find((check) => check.id === "model")?.text;
    };
    assert.deepEqual(await doctor(configPath), { id: "doctor.model.output_cap_missing", params: { field: "providers.openai.maxOutputTokens" } });
    const noModel = path.join(dir, "no-model.json");
    await writeFile(noModel, JSON.stringify({ schemaVersion: 1, limits: LIMITS, provider: "openai", providers: { openai: { maxOutputTokens: 64 } } }), "utf8");
    assert.deepEqual(await doctor(noModel), { id: "doctor.model.missing", params: { variable: "CODARYN_OPENAI_MODEL", field: "providers.openai.model" } });
  });

  for (const language of ["en", "ko"] as const) {
    test(
      `${language}: the person's line names providers.openai.maxOutputTokens for an openai config`,
      { todo: "N-B: the texts of doctor.model.output_cap_missing {field} (claude/security-core b88114c); the CLI passes the place (0d38bfa)" },
      async () => {
        const { line } = await modelLine(OPENAI_NO_CAP, language);
        assert.ok(line.includes("providers.openai.maxOutputTokens"), line);
      },
    );
  }
});

describe("(2) key_in_file names the key variable of the provider whose key was found", () => {
  async function refusal(config: Record<string, unknown>, goal: string, env: Record<string, string> = {}): Promise<string> {
    const { dir, ws, configPath } = await base({ limits: LIMITS, ...config });
    const outcome = await runCli({
      argv: ["run", "--workspace", ws, "--goal", goal, "--config", configPath, "--quiet"],
      env,
      cwd: dir,
      readFile: (file) => readFile(file, "utf8"),
      isDirectory: async (folder) => (await stat(folder).catch(() => null))?.isDirectory() ?? false,
      loadEnvFile: () => {},
      locateInWorkspace: (file, root) => locateInWorkspace(file, root),
      relatePaths: (target, root) => relateRealPaths(target, root),
      clock: { now: () => Date.now() },
      randomBytes: (size) => new Uint8Array(size).fill(12),
      assemble: async () => {
        throw new Error("nothing may be assembled");
      },
      cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    });
    assert.ok(outcome.output.kind === "error" && outcome.output.code === "key_in_file", JSON.stringify(outcome.output));
    return outcome.output.message;
  }

  test("an Anthropic-shaped key in the config names ANTHROPIC_API_KEY (holds today)", async () => {
    const message = await refusal({ model: ANTHROPIC_SHAPED }, "g");
    assert.ok(message.includes(ANTHROPIC_API_KEY_ENV), message);
  });


  test("an OpenAI-shaped key in the config names OPENAI_API_KEY", async () => {
    const message = await refusal({ model: OPENAI_SHAPED }, "g");
    assert.ok(message.includes(OPENAI_API_KEY_ENV) && !message.includes(ANTHROPIC_API_KEY_ENV), message);
  });

  test("an OpenAI-shaped key in the goal names OPENAI_API_KEY", async () => {
    const message = await refusal({}, `use ${OPENAI_SHAPED}`);
    assert.ok(message.includes(OPENAI_API_KEY_ENV) && !message.includes(ANTHROPIC_API_KEY_ENV), message);
  });

  test("the OpenAI key's registered value in the goal names OPENAI_API_KEY", async () => {
    const message = await refusal({}, `use ${OPENAI_VALUE}`, { [OPENAI_API_KEY_ENV]: OPENAI_VALUE });
    assert.ok(message.includes(OPENAI_API_KEY_ENV) && !message.includes(ANTHROPIC_API_KEY_ENV), message);
    assert.equal(message.includes(OPENAI_VALUE), false);
  });

  test("a key field, which belongs to no provider, names every key variable", async () => {
    const message = await refusal({ apiKey: "x" }, "g");
    assert.ok(message.includes(ANTHROPIC_API_KEY_ENV) && message.includes(OPENAI_API_KEY_ENV), message);
  });
});
