/**
 * U-46 (review R-56b R56b-L1, PM: an added field only): an apply whose own checks were complete but
 * a run since the plan could not check carries ApplyResult.planRecordsUncheckedCause
 * "run_since_plan" (U-33) in its output and result.json. `report --json` rebuilt the apply's result
 * from the checked fields and left it out, so a reader of the report could not tell the cause from
 * U-8's (the apply's own check was limited) but by the fixed notice text. Now the report carries it
 * when it is a known cause (PLAN_RECORDS_UNCHECKED_CAUSES); a recorded value that is not one is a
 * damaged field (`invalid_run_record`), as for noticeKinds. Absent stays absent.
 * The plan run and the apply are real (engine, store, tools, scripted model), in this process; only
 * stateUncheckedSince is a stand-in. Nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { RESULT_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { ApplyResult, CliErrorOutput, EngineResult } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runApply } from "../../../src/cli/plan-commands.js";
import { runReport } from "../../../src/cli/report.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 600_000;
const clock = { now: () => (now += 1000) };
let seed = 46;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);

const TASK = {
  schemaVersion: 1,
  id: "g-u46",
  goal: "g",
  workflow: "label",
  workspaceRoot: "./ws",
  model: { provider: "scripted", scriptPath: "./script.json" },
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] },
  privacy: { secretEnv: [] },
  limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
  verifiers: [],
  workflowRef: "organize",
};

const io = (base: string, argv: readonly string[]) => ({
  argv,
  env: {},
  cwd: base,
  readFile: (file: string) => readFile(file, "utf8"),
  isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
  loadEnvFile: () => {},
  locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
  relatePaths: (target: string, root: string) => relateRealPaths(target, root),
  clock,
  randomBytes,
  cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
});

interface ReportJson {
  readonly kind: string;
  readonly runKind: string;
  readonly result: ApplyResult | null;
}

/** A plan run and its apply; `sinceUnchecked`: what the stand-in stateUncheckedSince answers. */
async function applied(sinceUnchecked: boolean): Promise<{ base: string; ws: string; apply: ApplyResult }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u46-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(ws, "a.txt"), "alpha\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(path.join(base, "task.json"), JSON.stringify(TASK), "utf8");
  const ran = await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun });
  const planned = ran.output as EngineResult;
  assert.equal(planned.reason, "plan_pending", JSON.stringify(planned));
  const outcome = await runApply({
    ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", (planned.plan?.digest ?? "").slice(0, 12), "--quiet"]),
    stateUncheckedSince: async () => sinceUnchecked,
  });
  assert.ok("output" in outcome && outcome.output.kind === "apply", JSON.stringify(outcome));
  return { base, ws, apply: outcome.output as ApplyResult };
}

async function reportJson(base: string, ws: string, runId: string): Promise<{ exitCode: number; json: ReportJson | CliErrorOutput }> {
  const outcome = await runReport({ argv: ["report", "--workspace", ws, "--run", runId, "--json"], cwd: base, env: {} });
  const json = "text" in outcome ? (JSON.parse(outcome.text) as ReportJson) : (outcome.output as CliErrorOutput);
  return { exitCode: outcome.exitCode, json };
}

const resultFile = (ws: string, runId: string): string => path.join(ws, STATE_DIR_NAME, RUNS_DIR_NAME, runId, RESULT_FILE_NAME);

describe("U-46 (R56b-L1): report --json carries the cause of plan_records_unchecked", () => {
  test("a run since the plan could not check: the report's result has planRecordsUncheckedCause, as the apply and result.json do", async () => {
    const { base, ws, apply } = await applied(true);
    assert.deepEqual([apply.noticeKinds, apply.planRecordsUncheckedCause], [["plan_records_unchecked"], "run_since_plan"], JSON.stringify(apply));
    const stored = JSON.parse(await readFile(resultFile(ws, apply.runId), "utf8")) as ApplyResult;
    assert.equal(stored.planRecordsUncheckedCause, "run_since_plan");
    const { exitCode, json } = await reportJson(base, ws, apply.runId);
    assert.equal(exitCode, 0, JSON.stringify(json));
    const report = json as ReportJson;
    assert.equal(report.result?.planRecordsUncheckedCause, "run_since_plan", JSON.stringify(report.result));
    assert.deepEqual(report.result, apply, "the report's result is the apply's, field for field");
  });

  test("no cause recorded: the report's result has none (as before)", async () => {
    const { base, ws, apply } = await applied(false);
    assert.equal(Object.hasOwn(apply, "planRecordsUncheckedCause"), false);
    const report = (await reportJson(base, ws, apply.runId)).json as ReportJson;
    assert.equal(Object.hasOwn(report.result ?? {}, "planRecordsUncheckedCause"), false, JSON.stringify(report.result));
    assert.deepEqual(report.result, apply);
  });

  test("a recorded cause that is not a known one is a damaged field: invalid_run_record", async () => {
    const { base, ws, apply } = await applied(true);
    const file = resultFile(ws, apply.runId);
    const stored = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    for (const cause of ["something_else", 1, null, ["run_since_plan"]]) {
      await writeFile(file, JSON.stringify({ ...stored, planRecordsUncheckedCause: cause }), "utf8");
      const { exitCode, json } = await reportJson(base, ws, apply.runId);
      assert.deepEqual([exitCode, (json as CliErrorOutput).code], [2, "invalid_run_record"], `${JSON.stringify(cause)}: ${JSON.stringify(json)}`);
    }
  });
});
