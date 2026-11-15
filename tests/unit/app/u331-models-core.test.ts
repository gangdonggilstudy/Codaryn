/** Public model-command boundaries; every port and credential is synthetic. */
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ANTHROPIC_API_KEY_ENV, CODARYN_API_BASE_URL_ENV } from "../../../src/contracts/index.js";
import type { ListAnthropicModels, ModelsOutput } from "../../../src/contracts/index.js";
import { runModels } from "../../../src/cli/models.js";
import type { ModelsEnvironment } from "../../../src/cli/models.js";
import type { CommandOutcome } from "../../../src/app/command-outcome.js";
import { parseModelsArgs } from "../../../src/app/input/args.js";
import { runModelsIn } from "../../../src/app/models-command.js";
import type { ModelsCommandAdapter, ModelsCommandEnvironment } from "../../../src/app/models-command.js";
import * as legacy from "../../../src/cli/models.js";

const SECRET = ["synthetic", "u331", "credential", "fixture"].join("-");
const MODELS: Awaited<ReturnType<ListAnthropicModels>> = {
  ok: true,
  models: ["first-model", "second-model"].map((id) => ({ id, displayName: id, createdAt: null, maxInputTokens: null, maxOutputTokens: null })),
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function ioFor(argv: readonly string[] = [], extra: Partial<ModelsEnvironment> = {}): ModelsEnvironment {
  return {
    argv: ["models", ...argv],
    cwd: path.join(tmpdir(), "u331-synthetic"),
    env: { [ANTHROPIC_API_KEY_ENV]: SECRET, [CODARYN_API_BASE_URL_ENV]: "http://127.0.0.1:9" },
    readFile: async () => { throw new Error("unexpected synthetic read"); },
    loadEnvFile: () => { throw new Error("unexpected synthetic vars load"); },
    listModels: async () => MODELS,
    ...extra,
  };
}
function json(outcome: CommandOutcome): ModelsOutput {
  assert.ok("text" in outcome);
  return JSON.parse(outcome.text) as ModelsOutput;
}

test("U331 parse refusal observes argv before any command port", async () => {
  const seen: string[] = [];
  const io = ioFor();
  Object.defineProperties(io, {
    argv: { get() { assert.equal(this, io); seen.push("argv"); return ["models", "--unknown"]; } },
    env: { get() { throw new Error("parse refusal must not read env"); } },
    defaultConfig: { get() { throw new Error("parse refusal must not read defaults"); } },
  });
  const pending = runModels(io);
  assert.equal(pending.constructor, Promise);
  assert.deepEqual(seen, ["argv"]);
  const result = await pending;
  assert.ok("output" in result && result.output.kind === "error");
  assert.equal(result.output.code, "invalid_arguments");
});

for (const thrown of [null, undefined]) {
  test(`U331 argv getter throws ${String(thrown)} as a rejected Promise`, async () => {
    const io = ioFor();
    Object.defineProperty(io, "argv", { get() { throw thrown; } });
    let pending!: Promise<CommandOutcome>;
    assert.doesNotThrow(() => { pending = runModels(io); });
    await assert.rejects(pending, (error: unknown) => Object.is(error, thrown));
  });
}

test("U331 final presentation runs synchronously at the original lister continuation", async () => {
  const list = deferred<Awaited<ReturnType<ListAnthropicModels>>>();
  const trace: string[] = [];
  const io = ioFor([], { listModels: () => { trace.push("list"); return list.promise; } });
  Object.defineProperty(io, "messages", { get() { trace.push("messages"); return undefined; } });
  const pending = runModels(io);
  pending.then(() => trace.push("settled"));
  trace.push("after-call");
  list.resolve(MODELS);
  queueMicrotask(() => trace.push("queued"));
  await pending;
  assert.deepEqual(trace, ["list", "after-call", "messages", "queued", "settled"]);
});

test("U331 numeric --use keeps io receivers, local lister, and writer call shape", async () => {
  let written = "";
  const calls: string[] = [];
  const io = ioFor(["--config", "config.json", "--use", "2", "--json"], {
    readFile: async function () { assert.equal(this, io); calls.push("read"); return '{"schemaVersion":1,"model":"old"}'; },
    listModels: function () { assert.equal(this, undefined); calls.push("list"); return Promise.resolve(MODELS); },
    writeConfig: async function (_file, text, options) {
      assert.equal(this, undefined);
      calls.push("write"); written = text;
      assert.deepEqual(options, { exclusive: false, expected: '{"schemaVersion":1,"model":"old"}' });
    },
  });
  const result = json(await runModels(io));
  assert.deepEqual(calls, ["read", "list", "write"]);
  assert.equal(JSON.parse(written).model, "second-model");
  assert.equal(result.selected?.id, "second-model");
});

test("U331 terminal ask stays late, keeps its receiver, and trims after awaiting", async () => {
  const answer = deferred<string | null>(), asked = deferred<void>();
  const trace: string[] = [];
  let askReads = 0, written = "";
  const io = ioFor(["--config", "config.json"], {
    readFile: async () => '{"schemaVersion":1,"model":"old"}',
    writeConfig: async (_file, text) => { trace.push("write"); written = text; },
  });
  Object.defineProperties(io, {
    messages: { get() { trace.push("messages"); return undefined; } },
    ask: { get() {
      trace.push(`ask:${++askReads}`);
      return function (this: ModelsEnvironment, question: string) {
        assert.equal(this, io); assert.match(question, /Number or id/);
        trace.push("ask-call"); asked.resolve(); return answer.promise;
      };
    } },
  });
  const pending = runModels(io);
  await asked.promise;
  assert.deepEqual(trace, ["ask:1", "messages", "ask:2", "messages", "ask-call"]);
  answer.resolve(" 2 ");
  await pending;
  assert.deepEqual(trace, ["ask:1", "messages", "ask:2", "messages", "ask-call", "write", "messages"]);
  assert.equal(JSON.parse(written).model, "second-model");
});

test("U331 missing lister refuses without a default transport or presentation read", async () => {
  const io = ioFor([], { listModels: undefined });
  Object.defineProperty(io, "messages", { get() { throw new Error("refusal must not render"); } });
  const result = await runModels(io);
  assert.ok("output" in result && result.output.kind === "error");
  assert.equal(result.output.code, "provider_not_implemented");
});

test("U331 ask rejection and completion getter preserve the original thrown value", async () => {
  const io = ioFor(["--config", "config.json"], {
    readFile: async () => '{"schemaVersion":1}',
    ask: () => Promise.reject(null),
  });
  await assert.rejects(runModels(io), (error: unknown) => error === null);
  const completion = ioFor();
  Object.defineProperty(completion, "messages", { get() { throw undefined; } });
  await assert.rejects(runModels(completion), (error: unknown) => error === undefined);
});

function commandArgs(argv: readonly string[]) {
  const parsed = parseModelsArgs(["models", ...argv]);
  assert.ok(parsed.ok);
  return parsed.args;
}
const noPrompt = {
  ask: () => { throw new Error("unexpected prompt"); },
  choice: (answer: string | null) => answer,
};

test("U331 direct core shares numeric selection and completes with the exact adapter outcome", async () => {
  let selected = "";
  const expected: CommandOutcome = { text: "formatted\n", exitCode: 0 };
  const io = ioFor([], {
    readFile: async () => '{"schemaVersion":1}',
    writeConfig: async (_file, text) => { selected = JSON.parse(text).model as string; },
  });
  const result = await runModelsIn(io, commandArgs(["--config", "config.json", "--json", "--use", "2"]), {
    ...noPrompt,
    complete(output, prompted, places) {
      assert.equal(output.selected?.id, "second-model");
      assert.equal(prompted, false);
      assert.deepEqual(places, { modelEnv: "CODARYN_MODEL", field: "model" });
      assert.deepEqual(Object.keys(output), ["schemaVersion", "kind", "status", "exitCode", "models", "current", "selected"]);
      return expected;
    },
  });
  assert.equal(selected, "second-model");
  assert.equal(result, expected);
});

test("U331 direct core refusal never reads a presentation callback", async () => {
  const io = ioFor([], { env: {} });
  const adapter = Object.defineProperties({}, {
    ask: { get() { throw new Error("early ask"); } },
    choice: { get() { throw new Error("early choice"); } },
    complete: { get() { throw new Error("early completion"); } },
  }) as ModelsCommandAdapter;
  const result = await runModelsIn(io, commandArgs([]), adapter);
  assert.ok("output" in result && result.output.kind === "error");
  assert.equal(result.output.code, "provider_not_configured");
});

test("U331 direct completion exception rejects with the same value", async () => {
  const thrown = Symbol("completion failure");
  const result = runModelsIn(ioFor(), commandArgs([]), {
    ...noPrompt,
    complete() { throw thrown; },
  });
  await assert.rejects(result, (error: unknown) => error === thrown);
});

test("U331 legacy exports and canonical environment remain compatible", () => {
  assert.deepEqual(Object.keys(legacy).sort(), ["renderModels", "runModels", "withModel", "writeConfigAtomic"]);
  const old: ModelsEnvironment = ioFor();
  const core: ModelsCommandEnvironment = old;
  const back: ModelsEnvironment = { ...core, argv: ["models"] };
  const noOptional: ModelsCommandEnvironment = { env: {}, cwd: old.cwd, readFile: old.readFile, loadEnvFile: old.loadEnvFile };
  assert.equal(back.env, old.env);
  assert.equal(noOptional.ask, undefined);
  // @ts-expect-error canonical environment remains readonly
  core.cwd = "synthetic";
  const defaultConfig: ModelsCommandEnvironment["defaultConfig"] = null;
  assert.equal(defaultConfig, null);
});
