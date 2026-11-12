/**
 * Y-1 to Y-4: `codaryn models`, `--use`, the run's HTTP 404 hint and the doctor note.
 * The listing function is injected (a fake standing for listAnthropicModels); no request leaves the
 * process. Fake values only; the key value is not key-shaped.
 */

import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { ANTHROPIC_API_KEY_ENV, CODARYN_API_BASE_URL_ENV, CODARYN_CONFIG_ENV, CODARYN_MODEL_ENV } from "../../../src/contracts/index.js";
import type {
  AnthropicListSettings,
  EngineResult,
  ListAnthropicModels,
  MessageCatalog,
  ModelInfo,
  ModelProvider,
  ModelsOutput,
} from "../../../src/contracts/index.js";
import { parseModelsArgs } from "../../../src/cli/args.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import type { CommandOutcome } from "../../../src/cli/guard.js";
import { helpRequest, helpText } from "../../../src/cli/help.js";
import { runModels, withModel, writeConfigAtomic } from "../../../src/cli/models.js";
import type { ModelsEnvironment } from "../../../src/cli/models.js";
import { MODEL_NOT_FOUND_HINT, runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { FAKE_SECRET, SECRET_ENV, cliIo, isDirectory, setupRun, tempDir } from "./k-support.js";

/** Not key-shaped; long enough to be hidden wherever it appears. */
const FAKE_KEY = "fake-models-key-value-0042";
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const BOM = String.fromCharCode(0xfeff);
const ESC = String.fromCharCode(27);

const MODELS: ModelInfo[] = [
  { id: "fake-model-a", displayName: "Fake Model A", createdAt: "2026-01-01T00:00:00Z", maxInputTokens: 200_000, maxOutputTokens: 64_000 },
  { id: "fake-model-b", displayName: `Fake ${ESC}[31mB`, createdAt: null, maxInputTokens: null, maxOutputTokens: null },
];

function keyEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY, ...extra };
}

/** A fake listing function that records its calls. */
function fakeList(outcome: Awaited<ReturnType<ListAnthropicModels>> = { ok: true, models: MODELS }) {
  const calls: AnthropicListSettings[] = [];
  const list: ListAnthropicModels = async (settings) => {
    calls.push(settings);
    return outcome;
  };
  return { list, calls };
}

function modelsIo(base: string, argv: readonly string[], extra: Partial<ModelsEnvironment> = {}): ModelsEnvironment {
  return {
    argv: ["models", ...argv],
    env: keyEnv(),
    cwd: base,
    readFile: (file) => readFile(file, "utf8"),
    loadEnvFile: () => {
      throw new Error("no variables file in this test");
    },
    ...extra,
  };
}

function text(outcome: CommandOutcome): string {
  assert.ok("text" in outcome, JSON.stringify(outcome));
  return outcome.text;
}

function error(outcome: CommandOutcome): { code: string; message: string; exitCode: number } {
  assert.ok("output" in outcome && outcome.output.kind === "error", JSON.stringify(outcome));
  return { code: outcome.output.code, message: outcome.output.message, exitCode: outcome.exitCode };
}

async function config(base: string, content: string): Promise<string> {
  const file = path.join(base, "config.json");
  await writeFile(file, content);
  return file;
}

describe("Y-1, Y-2 listing", () => {
  test("P0: the key reaches the listing function only, never the output", async () => {
    const base = await tempDir();
    const file = await config(base, JSON.stringify({ schemaVersion: 1, model: "fake-model-a", apiBaseUrl: "https://example.invalid", requestTimeoutMs: 5000, maxRetries: 1 }));
    const fake = fakeList();
    const plain = text(await runModels(modelsIo(base, ["--config", file], { listModels: fake.list })));
    const json = text(await runModels(modelsIo(base, ["--config", file, "--json"], { listModels: fake.list })));
    assert.deepEqual(fake.calls[0], { apiKey: FAKE_KEY, apiBaseUrl: "https://example.invalid", requestTimeoutMs: 5000, maxRetries: 1 });
    for (const printed of [plain, json]) assert.equal(printed.includes(FAKE_KEY), false);

    assert.ok(plain.includes("Models this key can use (2):"));
    assert.ok(plain.includes("* 1  fake-model-a"), plain);
    assert.ok(plain.includes("200000") && plain.includes("64000"));
    assert.ok(plain.includes("* current model (from the config file): fake-model-a"));
    assert.equal(plain.includes(ESC), false, "names from the API are cleaned");

    const output = JSON.parse(json) as ModelsOutput;
    assert.equal(output.kind, "models");
    assert.equal(output.status, "listed");
    assert.deepEqual(output.models.map((model) => [model.number, model.id]), [[1, "fake-model-a"], [2, "fake-model-b"]]);
    assert.deepEqual(output.current, { id: "fake-model-a", source: "config", listed: true });
    assert.equal(output.selected, null);
  });

  test("the address and environment follow the run's rules; no config file is needed for listing", async () => {
    const base = await tempDir();
    const fake = fakeList();
    const env = keyEnv({ [CODARYN_API_BASE_URL_ENV]: "http://127.0.0.1:9", [CODARYN_MODEL_ENV]: "fake-model-z" });
    const output = JSON.parse(text(await runModels(modelsIo(base, ["--json"], { env, listModels: fake.list })))) as ModelsOutput;
    assert.equal(fake.calls[0]?.apiBaseUrl, "http://127.0.0.1:9");
    assert.deepEqual(output.current, { id: "fake-model-z", source: "CODARYN_MODEL", listed: false });
    const bad = await runModels(modelsIo(base, [], { env: keyEnv({ [CODARYN_API_BASE_URL_ENV]: "http://example.invalid" }), listModels: fake.list }));
    assert.equal(error(bad).code, "invalid_config");
  });

  test("no key: provider_not_configured and nothing is sent; not connected: provider_not_implemented", async () => {
    const base = await tempDir();
    const fake = fakeList();
    const none = error(await runModels(modelsIo(base, [], { env: {}, listModels: fake.list })));
    assert.deepEqual([none.code, none.exitCode], ["provider_not_configured", 7]);
    assert.equal(fake.calls.length, 0);
    const unconnected = error(await runModels(modelsIo(base, [])));
    assert.deepEqual([unconnected.code, unconnected.exitCode], ["provider_not_implemented", 7]);
  });

  test("a failed request is model_list_failed (exit 8) and its message never holds the key", async () => {
    const base = await tempDir();
    const fake = fakeList({ ok: false, kind: "auth_failed", message: `HTTP 401 authentication_error: bad key ${FAKE_KEY}` });
    const failed = error(await runModels(modelsIo(base, [], { listModels: fake.list })));
    assert.equal(failed.code, "model_list_failed");
    assert.equal(failed.exitCode, 8);
    assert.ok(failed.message.startsWith("the model list request failed (auth_failed)"));
    assert.ok(failed.message.includes(`check ${ANTHROPIC_API_KEY_ENV}`));
    assert.equal(failed.message.includes(FAKE_KEY), false);
  });

  test("a config file with a key field is refused before anything is sent, and left alone", async () => {
    const base = await tempDir();
    const original = JSON.stringify({ schemaVersion: 1, limits: { apiKey: "x" } });
    const file = await config(base, original);
    const fake = fakeList();
    const refused = error(await runModels(modelsIo(base, ["--config", file, "--use", "1"], { listModels: fake.list })));
    assert.equal(refused.code, "key_in_file");
    assert.equal(fake.calls.length, 0);
    assert.equal(await readFile(file, "utf8"), original);
  });
});

describe("Y-3 --use writes the config file's model", () => {
  test("by number: only model changes; fields, order, BOM, CRLF and indentation stay", async () => {
    const base = await tempDir();
    const lines = ["{", `${"\t"}"schemaVersion": 1,`, `${"\t"}"model": "fake-model-a",`, `${"\t"}"maxOutputTokens": 4096,`, `${"\t"}"limits": { "maxModelTurns": 3 },`, `${"\t"}"secretEnv": ["CODARYN_K1_SECRET"]`, "}", ""];
    const original = `${BOM}${lines.join(`${CR}${LF}`)}`;
    const file = await config(base, original);
    const fake = fakeList();
    const outcome = await runModels(modelsIo(base, ["--config", file, "--use", "2", "--json"], { listModels: fake.list }));
    const output = JSON.parse(text(outcome)) as ModelsOutput;
    assert.equal(output.status, "selected");
    assert.deepEqual(output.selected, { id: "fake-model-b", created: false, overriddenBy: null });
    assert.deepEqual(output.current, { id: "fake-model-b", source: "config", listed: true });

    const written = await readFile(file, "utf8");
    assert.ok(written.startsWith(BOM));
    assert.ok(written.includes(`${CR}${LF}${"\t"}"model": "fake-model-b",${CR}${LF}`));
    assert.ok(written.endsWith(`}${CR}${LF}`));
    const value = JSON.parse(written.slice(1)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(value), ["schemaVersion", "model", "maxOutputTokens", "limits", "secretEnv"]);
    assert.deepEqual(value, { schemaVersion: 1, model: "fake-model-b", maxOutputTokens: 4096, limits: { maxModelTurns: 3 }, secretEnv: ["CODARYN_K1_SECRET"] });
    assert.deepEqual((await readdir(base)).sort(), ["config.json"], "no temporary file is left");
  });

  test("by id, through CODARYN_CONFIG; CODARYN_MODEL is reported as overriding it", async () => {
    const base = await tempDir();
    const file = await config(base, JSON.stringify({ schemaVersion: 1, maxRetries: 0 }));
    const env = keyEnv({ [CODARYN_CONFIG_ENV]: file, [CODARYN_MODEL_ENV]: "fake-model-a" });
    const outcome = await runModels(modelsIo(base, ["--use", "fake-model-b"], { env, listModels: fakeList().list }));
    const printed = text(outcome);
    assert.ok(printed.includes("Written: fake-model-b is now the config file's model."));
    assert.ok(printed.includes("Note: CODARYN_MODEL is set"));
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { schemaVersion: 1, model: "fake-model-b", maxRetries: 0 });
  });

  test("a missing config file is created with schemaVersion and model only; without --use it is an error", async () => {
    const base = await tempDir();
    const file = path.join(base, "new-config.json");
    const fake = fakeList();
    assert.equal(error(await runModels(modelsIo(base, ["--config", file], { listModels: fake.list }))).code, "invalid_config");
    const output = JSON.parse(text(await runModels(modelsIo(base, ["--config", file, "--use", "1", "--json"], { listModels: fake.list })))) as ModelsOutput;
    assert.deepEqual(output.selected, { id: "fake-model-a", created: true, overriddenBy: null });
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { schemaVersion: 1, model: "fake-model-a" });
  });

  test("an unknown choice, or --use without a config file, writes nothing", async () => {
    const base = await tempDir();
    const original = JSON.stringify({ schemaVersion: 1, model: "fake-model-a" });
    const file = await config(base, original);
    for (const use of ["0", "3", "fake-model-c", "1x"]) {
      const refused = error(await runModels(modelsIo(base, ["--config", file, "--use", use], { listModels: fakeList().list })));
      assert.equal(refused.code, "invalid_arguments", use);
    }
    assert.equal(await readFile(file, "utf8"), original);
    const fake = fakeList();
    const noConfig = error(await runModels(modelsIo(base, ["--use", "1"], { listModels: fake.list })));
    assert.equal(noConfig.code, "invalid_arguments");
    assert.equal(fake.calls.length, 0, "nothing is sent");
  });

  test("an id that is not a plain model id, or holds the key, is not written", async () => {
    const base = await tempDir();
    const original = JSON.stringify({ schemaVersion: 1 });
    const file = await config(base, original);
    for (const id of ["bad id", `fake-${FAKE_KEY}`]) {
      const fake = fakeList({ ok: true, models: [{ id, displayName: "x", createdAt: null, maxInputTokens: null, maxOutputTokens: null }] });
      const refused = error(await runModels(modelsIo(base, ["--config", file, "--use", "1"], { listModels: fake.list })));
      assert.equal(refused.code, "config_write_failed");
      assert.equal(refused.message.includes(FAKE_KEY), false);
    }
    assert.equal(await readFile(file, "utf8"), original);
  });

  test("a terminal prompt is used only when ask is given and --json is not", async () => {
    const base = await tempDir();
    const file = await config(base, JSON.stringify({ schemaVersion: 1 }));
    const questions: string[] = [];
    const ask = async (question: string): Promise<string> => {
      questions.push(question);
      return " 2 ";
    };
    const printed = text(await runModels(modelsIo(base, ["--config", file], { listModels: fakeList().list, ask })));
    assert.equal(questions.length, 1);
    assert.ok(questions[0]?.includes("Models this key can use (2):"));
    assert.ok(questions[0]?.endsWith("Number or id to write into the config file's model (Enter to skip): "));
    assert.equal(questions[0]?.includes(FAKE_KEY), false);
    assert.ok(printed.startsWith("* current model (from the config file): fake-model-b"), printed);
    assert.equal(JSON.parse(await readFile(file, "utf8")).model, "fake-model-b");

    await runModels(modelsIo(base, ["--config", file, "--json"], { listModels: fakeList().list, ask }));
    assert.equal(questions.length, 1, "no prompt with --json");
    const skipped = text(await runModels(modelsIo(base, ["--config", file], { listModels: fakeList().list, ask: async () => "" })));
    assert.ok(skipped.includes("* current model (from the config file): fake-model-b"));
  });

  test("the atomic writer refuses a file that changed since it was read and leaves no temporary file", async () => {
    const base = await tempDir();
    const file = await config(base, "{}");
    await assert.rejects(writeConfigAtomic(file, "{ }", { exclusive: false, expected: "something else" }));
    assert.equal(await readFile(file, "utf8"), "{}");
    assert.deepEqual(await readdir(base), ["config.json"]);
    await assert.rejects(writeConfigAtomic(file, "{}", { exclusive: true, expected: null }), "exclusive never replaces");
  });

  test("withModel keeps order and inserts model after schemaVersion", () => {
    assert.equal(withModel(`{"a":1,"schemaVersion":1,"b":2}`, "m"), `{${LF}  "a": 1,${LF}  "schemaVersion": 1,${LF}  "model": "m",${LF}  "b": 2${LF}}`);
    assert.equal(withModel(`{${LF}    "model": "x"${LF}}${LF}`, "m"), `{${LF}    "model": "m"${LF}}${LF}`);
  });
});

describe("Y-4 hints", () => {
  async function anthropicRun(message: string): Promise<{ result: EngineResult; lines: string[] }> {
    const base = await setupRun(
      { "README.md": "# Title\n" },
      {
        model: { provider: "anthropic", model: "fake-model-gone", maxOutputTokens: 100 },
        limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 1000, maxDurationMs: 60_000 },
      },
      [],
    );
    const provider: ModelProvider = { name: "anthropic", complete: async () => ({ ok: false, kind: "api_error", message }) };
    const lines: string[] = [];
    const outcome = await runCli(
      cliIo(base, {
        env: { [SECRET_ENV]: FAKE_SECRET, [ANTHROPIC_API_KEY_ENV]: FAKE_KEY },
        createAnthropicProvider: () => provider,
        writeProgress: (line) => lines.push(line),
      }),
    );
    assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
    const result = outcome.output as EngineResult;
    const stored = JSON.parse(
      await readFile(path.join(base, "work", ".codaryn", "runs", result.runId, "result.json"), "utf8"),
    ) as EngineResult;
    assert.deepEqual(stored.notices, result.notices, "result.json holds the same notices");
    return { result, lines };
  }

  test("a model error answered with HTTP 404 gets the codaryn models hint", async () => {
    const { result, lines } = await anthropicRun("HTTP 404 not_found_error: model: fake-model-gone");
    assert.deepEqual([result.status, result.reason], ["failed", "model_error"]);
    assert.ok(result.notices.includes(MODEL_NOT_FOUND_HINT as never), JSON.stringify(result.notices));
    assert.ok(lines.some((line) => line.includes("codaryn models")));
    assert.equal(JSON.stringify(result).includes(FAKE_KEY), false);
  });

  test("other model errors get no hint", async () => {
    const { result } = await anthropicRun("HTTP 400 invalid_request_error: something else");
    assert.equal(result.reason, "model_error");
    assert.equal(result.notices.some((notice) => notice.includes("codaryn models")), false);
  });

  test("doctor says it does not check that the model exists", async () => {
    const base = await tempDir();
    const work = path.join(base, "work");
    await mkdir(work);
    const file = await config(base, JSON.stringify({ schemaVersion: 1, model: "fake-model-a", maxOutputTokens: 100, limits: { maxModelTurns: 1, maxToolCalls: 1, maxTotalTokens: 100, maxDurationMs: 1000 } }));
    const outcome = await runDoctor({
      argv: ["doctor", "--config", file, "--workspace", work, "--json"],
      env: keyEnv(),
      cwd: base,
      nodeVersion: "26.13.0",
      readFile: (target) => readFile(target, "utf8"),
      isDirectory,
      isFile: async () => false,
      locateInWorkspace: (target, root) => locateInWorkspace(target, root),
      relatePaths: (target, root) => relateRealPaths(target, root),
    });
    const output = JSON.parse(text(outcome)) as { checks: { id: string; status: string; message: string }[] };
    const model = output.checks.find((check) => check.id === "model");
    assert.equal(model?.status, "ok");
    assert.ok(model?.message.includes("whether the model exists is not checked (no network access)"));
    assert.ok(model?.message.includes("`codaryn models`"));
  });
});

describe("arguments and help", () => {
  test("parseModelsArgs", () => {
    assert.deepEqual(parseModelsArgs(["models"]), { ok: true, args: { command: "models", configPath: null, varsFile: null, use: null, json: false } });
    assert.deepEqual(parseModelsArgs(["models", "--json", "--use", "2", "--config", "c.json"]), {
      ok: true,
      args: { command: "models", configPath: "c.json", varsFile: null, use: "2", json: true },
    });
    assert.equal(parseModelsArgs(["models", "--workspace", "w"]).ok, false);
    assert.equal(parseModelsArgs(["models", "--use"]).ok, false);
    const envFile = parseModelsArgs(["models", "--env-file-if-exists=x"]);
    assert.ok(!envFile.ok && envFile.message.includes("--vars-file"));
  });

  test("help lists the command", () => {
    assert.deepEqual(helpRequest(["models", "--help"]), { kind: "help", command: "models" });
    // N-21: descriptions come from the catalog; a stand-in shows the ids.
    const messages = { language: "en", format: (id: string) => `<${id}>` } as unknown as MessageCatalog;
    assert.ok(helpText(null, messages).includes("codaryn models"));
    assert.ok(helpText("models", messages).includes("--use <number|id>"));
    assert.ok(helpText("models", messages).includes("<help.command.models>"));
  });
});
