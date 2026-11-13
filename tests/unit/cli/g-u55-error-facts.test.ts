/**
 * U-55 (AXM-9, contract 5b46a3a, engine 00e3113), the CLI's part: a program could not tell from an
 * error JSON whether to try again, nor from the report which model error ended a run.
 * - Every error the CLI makes carries `category` and `retryable` (cliErrorFacts). model_list_failed
 *   takes `retryable` from the listing's failure; when it cannot be told (a thrown listing, an
 *   api_error without an HTTP status) it is left out, which means unknown.
 * - `report --json` carries the result's `modelError` {kind, turn, retryable?} in its known form; a
 *   recorded value of another form is a damaged field (invalid_run_record). Absent stays absent.
 * In this process; scripted model; stand-in listers; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV, RESULT_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { CliErrorOutput, EngineResult, ListModels } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { jsonLine } from "../../../src/cli/guard.js";
import { runModels } from "../../../src/cli/models.js";
import { runReport } from "../../../src/cli/report.js";
import { cliError, runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

/** Not a real key format; built from parts (G-10). */
const FAKE_KEY = ["fake", "u55", "key", "not", "real", "0042"].join("-");

async function base(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "codaryn-g-u55-"));
  temporaryDirs.push(dir);
  await mkdir(path.join(dir, "ws"));
  return dir;
}

let now = Date.now() - 600_000;
const runIo = (dir: string, argv: readonly string[]) => ({
  argv,
  env: {},
  cwd: dir,
  readFile: (file: string) => readFile(file, "utf8"),
  isDirectory: async (target: string) => (await stat(target).catch(() => null))?.isDirectory() ?? false,
  loadEnvFile: () => {},
  locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
  relatePaths: (target: string, root: string) => relateRealPaths(target, root),
  clock: { now: () => (now += 1000) },
  randomBytes: (size: number) => new Uint8Array(size).fill(55),
  cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  assemble: assembleRun,
});

describe("U-55: every CLI error says its category and whether trying again may help", () => {
  test("by code: input errors are not retryable, a held lock is; the JSON line carries both", () => {
    const input = cliError("invalid_arguments", "x").output;
    assert.deepEqual([input.category, input.retryable], ["input", false]);
    assert.ok(jsonLine(input).endsWith(`"message":"x","category":"input","retryable":false}\n`), jsonLine(input));
    const locked = cliError("workspace_locked", "x").output;
    assert.deepEqual([locked.category, locked.retryable], ["state", true]);
    const internal = cliError("internal_error", "x").output;
    assert.deepEqual([internal.category, internal.retryable], ["internal", false]);
  });

  test("a run's error has them too: a task file that cannot be read", async () => {
    const dir = await base();
    const outcome = await runCli(runIo(dir, ["run", "--task", "missing.json"]));
    const output = outcome.output as CliErrorOutput;
    assert.deepEqual([output.code, output.category, output.retryable], ["invalid_task", "input", false]);
  });

  test("model_list_failed: retryable by the listing's failure, left out when it cannot be told", async () => {
    const dir = await base();
    const env = { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY };
    const listed = async (lister: ListModels): Promise<CliErrorOutput> => {
      const outcome = await runModels({ argv: ["models", "--json"], env, cwd: dir, readFile: (file) => readFile(file, "utf8"), loadEnvFile: () => {}, listModels: lister });
      assert.ok("output" in outcome && outcome.output.kind === "error", JSON.stringify(outcome));
      return outcome.output as CliErrorOutput;
    };
    const limited = await listed(async () => ({ ok: false, kind: "rate_limited", message: "slow down", httpStatus: 429 }));
    assert.deepEqual([limited.code, limited.category, limited.retryable], ["model_list_failed", "environment", true]);
    const denied = await listed(async () => ({ ok: false, kind: "auth_failed", message: "no", httpStatus: 401 }));
    assert.deepEqual([denied.category, denied.retryable], ["environment", false]);
    for (const unknown of [await listed(async () => ({ ok: false, kind: "api_error", message: "reset" })), await listed(async () => Promise.reject(new Error("thrown")))]) {
      assert.equal(unknown.category, "environment");
      assert.equal(Object.hasOwn(unknown, "retryable"), false, JSON.stringify(unknown));
    }
  });
});

describe("U-55: report --json carries the model error that ended a run", () => {
  async function exhausted(): Promise<{ dir: string; result: EngineResult }> {
    const dir = await base();
    // The script gives no step for the first turn: the run ends as model_error (script_exhausted).
    await writeFile(path.join(dir, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [] }), "utf8");
    const task = {
      schemaVersion: 1,
      id: "u55",
      goal: "g",
      workflow: "test",
      workspaceRoot: "./ws",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
      privacy: { secretEnv: [] },
      limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [],
    };
    await writeFile(path.join(dir, "task.json"), JSON.stringify(task), "utf8");
    const outcome = await runCli(runIo(dir, ["run", "--task", "task.json", "--quiet"]));
    const result = outcome.output as EngineResult;
    assert.equal(result.reason, "model_error", JSON.stringify(result));
    return { dir, result };
  }
  const report = async (dir: string, runId: string): Promise<{ exitCode: number; json: { result?: EngineResult | null; code?: string } }> => {
    const outcome = await runReport({ argv: ["report", "--workspace", path.join(dir, "ws"), "--run", runId, "--json"], cwd: dir, env: {} });
    return { exitCode: outcome.exitCode, json: "text" in outcome ? JSON.parse(outcome.text) : (outcome.output as never) };
  };
  const resultFile = (dir: string, runId: string): string => path.join(dir, "ws", STATE_DIR_NAME, RUNS_DIR_NAME, runId, RESULT_FILE_NAME);

  test("the recorded modelError, as the run gave it", async () => {
    const { dir, result } = await exhausted();
    assert.deepEqual(result.modelError, { kind: "script_exhausted", turn: 1, retryable: false });
    const { exitCode, json } = await report(dir, result.runId);
    assert.equal(exitCode, 0, JSON.stringify(json));
    assert.deepEqual(json.result?.modelError, result.modelError);
  });

  test("retryable left out stays left out; another form is a damaged field", async () => {
    const { dir, result } = await exhausted();
    const file = resultFile(dir, result.runId);
    const stored = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    await writeFile(file, JSON.stringify({ ...stored, modelError: { kind: "api_error", turn: 2 } }), "utf8");
    assert.deepEqual((await report(dir, result.runId)).json.result?.modelError, { kind: "api_error", turn: 2 });
    for (const bad of [{ kind: "nosuch", turn: 1 }, { kind: "api_error", turn: 0 }, { kind: "api_error", turn: 1, retryable: "yes" }, "api_error", null]) {
      await writeFile(file, JSON.stringify({ ...stored, modelError: bad }), "utf8");
      const { exitCode, json } = await report(dir, result.runId);
      assert.deepEqual([exitCode, json.code], [2, "invalid_run_record"], JSON.stringify(bad));
    }
  });
});
