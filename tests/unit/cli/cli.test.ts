import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import type { EngineResult, RunTask } from "../../../src/contracts/index.js";
import { parseArgs } from "../../../src/cli/args.js";
import type { Assemble, AssemblyInput } from "../../../src/cli/assemble.js";
import { createCancelSource } from "../../../src/cli/cancel.js";
import { RUN_ID_PATTERN, createRunId } from "../../../src/cli/run-id.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment } from "../../../src/cli/run.js";
import { parseTask } from "../../../src/cli/task.js";
import { lexicalLocate } from "./locate.js";

const FAKE_SECRET = "fake-secret-VALUE-0001";
const FAKE_KEY = "fake-api-key-not-real-0001";
const BASE = path.resolve("/tmp/codaryn-unit");

function taskJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "doc-1",
    goal: "write the doc",
    workflow: "document",
    workspaceRoot: "./work",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
    privacy: { secretEnv: ["CODARYN_TEST_SECRET"] },
    limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 10_000 },
    verifiers: [{ id: "v", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }],
    ...overrides,
  };
}

function cli(files: Record<string, unknown>, options: Partial<CliEnvironment> = {}) {
  const assembled: AssemblyInput[] = [];
  const finished: (EngineResult | null)[] = [];
  const result: EngineResult = {
    schemaVersion: 1,
    kind: "run",
    runId: "x",
    taskId: "doc-1",
    status: "done",
    reason: "verified",
    exitCode: 0,
    provider: "scripted",
    verifiers: [],
    changes: [],
    usage: { modelTurns: 1, toolCalls: 0, inputTokens: null, outputTokens: null, durationMs: 0 },
    journalPath: ".codaryn/runs/x/journal.jsonl",
    notices: [],
  };
  const assemble: Assemble = async (input) => {
    assembled.push(input);
    return {
      ok: true,
      deps: { task: input.task } as never,
      finish: async (value) => {
        finished.push(value);
      },
    };
  };
  const runTask: RunTask = async () => result;
  const io: CliEnvironment = {
    argv: ["run", "--task", "task.json"],
    env: { CODARYN_TEST_SECRET: FAKE_SECRET },
    cwd: BASE,
    readFile: async (file) => {
      const key = path.relative(BASE, file).split(path.sep).join("/");
      if (!(key in files)) throw new Error("missing");
      const value = files[key];
      return typeof value === "string" ? value : JSON.stringify(value);
    },
    isDirectory: async (dir) => dir === path.join(BASE, "work"),
    loadEnvFile: () => {
      throw new Error("no env file in this test");
    },
    locateInWorkspace: lexicalLocate,
    clock: { now: () => Date.UTC(2026, 10, 12, 3, 15, 0) },
    randomBytes: (size) => new Uint8Array(size).fill(0xab),
    assemble,
    runTask,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    ...options,
  };
  return { io, assembled, finished, result };
}

const script = { schemaVersion: 1, steps: [{ text: "done" }] };

describe("parseArgs", () => {
  test("accepts run with a task and an optional cancel file", () => {
    assert.deepEqual(parseArgs(["run", "--task", "t.json"]), {
      ok: true,
      args: { command: "run", input: { kind: "task", taskPath: "t.json" }, configPath: null, varsFile: null, cancelFile: null, quiet: false },
    });
    const parsed = parseArgs(["run", "--cancel-file", "stop", "--task", "t.json"]);
    assert.ok(parsed.ok);
    assert.equal(parsed.args.cancelFile, "stop");
  });

  test("rejects anything else", () => {
    for (const argv of [[], ["go"], ["run"], ["run", "--task"], ["run", "--task", "a", "--task", "b"], ["run", "--task", "a", "--skip-hash", "x"]]) {
      assert.equal(parseArgs(argv).ok, false, argv.join(" "));
    }
  });
});

test("runId follows P-3", () => {
  const id = createRunId(new Date(Date.UTC(2026, 10, 12, 3, 15, 0, 123)), () => new Uint8Array([0x9f, 0x2c, 0x41, 0xab]));
  assert.equal(id, "20261112T031500Z-9f2c41ab");
  assert.match(id, RUN_ID_PATTERN);
});

describe("parseTask", () => {
  test("resolves workspaceRoot and scriptPath against the task directory", () => {
    const parsed = parseTask(taskJson(), BASE);
    assert.ok(parsed.ok);
    assert.equal(parsed.task.workspaceRoot, path.join(BASE, "work"));
    assert.equal(parsed.task.model.provider === "scripted" ? parsed.task.model.scriptPath : "", path.join(BASE, "script.json"));
  });

  test("rejects invalid tasks with messages that do not echo values", () => {
    const cases: Record<string, unknown>[] = [
      taskJson({ schemaVersion: 2 }),
      taskJson({ id: `bad id ${FAKE_SECRET}` }),
      taskJson({ policy: { commands: [], network: "allow", destructive: "deny", restorePathTokens: false } }),
      taskJson({ limits: { maxModelTurns: 0, maxToolCalls: 1, maxTotalTokens: null, maxDurationMs: 1 } }),
      taskJson({ limits: { maxModelTurns: 1, maxToolCalls: 1, maxDurationMs: 1 } }),
      taskJson({ verifiers: [{ id: "v", kind: "file_rules", rules: [] }] }),
      taskJson({ apiKey: FAKE_KEY }),
    ];
    for (const value of cases) {
      const parsed = parseTask(value, BASE);
      assert.equal(parsed.ok, false);
      assert.equal(JSON.stringify(parsed).includes(FAKE_SECRET), false);
      assert.equal(JSON.stringify(parsed).includes(FAKE_KEY), false);
    }
  });
});

describe("runCli", () => {
  test("a valid scripted task is assembled, run and finished; stdout object is the result", async () => {
    const { io, assembled, finished, result } = cli({ "task.json": taskJson(), "script.json": script });
    const outcome = await runCli(io);
    assert.equal(outcome.exitCode, 0);
    assert.deepEqual(outcome.output, result);
    assert.deepEqual(finished, [result]);
    assert.equal(assembled[0]?.runId, "20261112T031500Z-abababab");
    assert.deepEqual(assembled[0]?.secrets, [FAKE_SECRET]);
  });

  test("input errors map to their exit codes", async () => {
    const expectations: [CliEnvironment, string, number][] = [
      [cli({}, { argv: ["run"] }).io, "invalid_arguments", 2],
      [cli({ "task.json": "{not json" }).io, "invalid_task", 2],
      [cli({ "task.json": taskJson({ workspaceRoot: "./missing" }), "script.json": script }).io, "workspace_not_found", 2],
      [cli({ "task.json": taskJson(), "script.json": { schemaVersion: 1, steps: "x" } }).io, "invalid_script", 2],
      [cli({ "task.json": taskJson(), "script.json": script }, { env: {} }).io, "secret_env_missing", 2],
    ];
    for (const [io, code, exitCode] of expectations) {
      const outcome = await runCli(io);
      assert.equal(outcome.output.kind, "error");
      assert.equal(outcome.output.kind === "error" ? outcome.output.code : "", code);
      assert.equal(outcome.exitCode, exitCode);
    }
  });

  test("AD-07 the anthropic provider stops before assembly, with or without settings", async () => {
    // S-7: an anthropic task needs a token limit, so these tasks state one.
    const limits = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 10_000, maxDurationMs: 10_000 };
    const task = taskJson({ model: { provider: "anthropic" }, limits });
    const missing = cli({ "task.json": task });
    const notConfigured = await runCli(missing.io);
    assert.equal(notConfigured.output.kind === "error" ? notConfigured.output.code : "", "provider_not_configured");
    assert.equal(notConfigured.exitCode, 7);
    assert.equal(missing.assembled.length, 0);

    // Phase 1b also needs an output cap. `createAnthropicProvider: null` keeps the unconnected path.
    const present = cli(
      { "task.json": taskJson({ model: { provider: "anthropic", maxOutputTokens: 1024 }, limits }) },
      {
        env: { CODARYN_TEST_SECRET: FAKE_SECRET, ANTHROPIC_API_KEY: FAKE_KEY, CODARYN_MODEL: "fake-model" },
        createAnthropicProvider: null,
      },
    );
    const notImplemented = await runCli(present.io);
    assert.equal(notImplemented.output.kind === "error" ? notImplemented.output.code : "", "provider_not_implemented");
    assert.equal(notImplemented.exitCode, 7);
    assert.equal(present.assembled.length, 0);
    assert.equal(JSON.stringify(notImplemented).includes(FAKE_KEY), false);
  });

  test("assembly failures are reported without secret values", async () => {
    const { io } = cli(
      { "task.json": taskJson(), "script.json": script },
      { assemble: async () => ({ ok: false, code: "workspace_locked", message: `held; ${FAKE_SECRET}` }) },
    );
    const outcome = await runCli(io);
    assert.equal(outcome.exitCode, 6);
    assert.equal(JSON.stringify(outcome).includes(FAKE_SECRET), false);
  });
});

describe("createCancelSource (P-2)", () => {
  test("an existing cancel file aborts", () => {
    const source = createCancelSource({ cancelFile: "/stop", fileExists: () => true, onSignal: () => () => {} });
    assert.equal(source.signal.aborted, true);
    source.dispose();
  });

  test("SIGINT and SIGTERM abort, and dispose removes the handlers", () => {
    const handlers = new Map<string, () => void>();
    const source = createCancelSource({
      cancelFile: null,
      fileExists: () => false,
      onSignal: (name, handler) => {
        handlers.set(name, handler);
        return () => handlers.delete(name);
      },
    });
    assert.deepEqual([...handlers.keys()].sort(), ["SIGINT", "SIGTERM"]);
    handlers.get("SIGTERM")?.();
    assert.equal(source.signal.aborted, true);
    source.dispose();
    assert.equal(handlers.size, 0);
  });
});
