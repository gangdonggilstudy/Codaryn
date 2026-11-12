/**
 * U-33 (review R-56 Q-3, contract 1362e4b), the CLI's part: the store's stateUncheckedSince also
 * counts a run whose journal has no run_finished, leaving out the apply that asks (its journal is
 * still being written). So its request names that apply: `applyRunId`, required by the contract.
 * Before, the CLI passed only the workspace and the plan run, and the asking apply itself would have
 * counted as a run since the plan that ended before its last check.
 * The plan run and the apply are real (engine, store, tools, scripted model), in this process; only
 * stateUncheckedSince is a stand-in that records its request. Nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { ApplyResult, EngineResult, StateUncheckedSince } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runApply } from "../../../src/cli/plan-commands.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 600_000;
const clock = { now: () => (now += 1000) };
let seed = 33;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);

const TASK = {
  schemaVersion: 1,
  id: "g-u33",
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

type Request = Parameters<StateUncheckedSince>[0];

/** A plan run, then its apply with a stateUncheckedSince that records each request and answers `answer`. */
async function applied(answer: boolean): Promise<{ planned: EngineResult; apply: ApplyResult; requests: Request[]; ws: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u33-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(ws, "a.txt"), "alpha\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(path.join(base, "task.json"), JSON.stringify(TASK), "utf8");
  const ran = await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun });
  assert.equal(ran.output.kind, "run", JSON.stringify(ran.output));
  const planned = ran.output as EngineResult;
  assert.equal(planned.reason, "plan_pending", JSON.stringify(planned));

  const requests: Request[] = [];
  const stateUncheckedSince: StateUncheckedSince = async (request) => {
    requests.push({ ...request });
    return answer;
  };
  const outcome = await runApply({
    ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", (planned.plan?.digest ?? "").slice(0, 12), "--quiet"]),
    stateUncheckedSince,
  });
  assert.ok("output" in outcome && outcome.output.kind === "apply", JSON.stringify(outcome));
  const apply = outcome.output as ApplyResult;
  assert.deepEqual([apply.status, apply.reason, outcome.exitCode], ["done", "verified", 0], JSON.stringify(apply));
  return { planned, apply, requests, ws };
}

describe("U-33 (R-56 Q-3): the apply names itself when it asks whether a run since the plan could not check", () => {
  test("the request carries the workspace, the plan run and this apply's run id, once", async () => {
    const { planned, apply, requests, ws } = await applied(false);
    assert.equal(requests.length, 1, JSON.stringify(requests));
    const [request] = requests;
    assert.deepEqual(Object.keys(request ?? {}).sort(), ["applyRunId", "planRunId", "workspaceRoot"]);
    assert.equal(request?.applyRunId, apply.runId);
    assert.notEqual(request?.applyRunId, planned.runId);
    assert.equal(request?.planRunId, planned.runId);
    assert.equal(path.basename(request?.workspaceRoot ?? ""), path.basename(ws));
    assert.equal(Object.hasOwn(apply, "noticeKinds"), false, JSON.stringify(apply));
  });

  test("its answer is still told: true gives the notice kind with the cause run_since_plan", async () => {
    const { apply, requests } = await applied(true);
    assert.equal(requests[0]?.applyRunId, apply.runId);
    assert.deepEqual(apply.noticeKinds, ["plan_records_unchecked"], JSON.stringify(apply));
    assert.equal(apply.planRecordsUncheckedCause, "run_since_plan", JSON.stringify(apply));
  });
});
