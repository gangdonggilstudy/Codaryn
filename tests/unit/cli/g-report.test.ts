/**
 * G-F: report reads the stage 4 runs (DR-16: the contract's reasons table; DR-12: apply runs and
 * the review verdict). Real engine, store and tools on a temporary workspace; scripted model.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { ApplyResult, EngineResult } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runApply, runReview } from "../../../src/cli/plan-commands.js";
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
let seed = 11;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);

async function setup(workflowRef: string, steps: unknown[]): Promise<{ base: string; ws: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-report-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(ws, "a.txt"), "alpha\n", "utf8");
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(
    path.join(base, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "g-report",
      goal: "g",
      workflow: "label",
      workspaceRoot: "./ws",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move", "discard"] },
      privacy: { secretEnv: [] },
      limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [],
      workflowRef,
    }),
    "utf8",
  );
  return { base, ws };
}

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

async function run(base: string): Promise<EngineResult> {
  const outcome = await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun });
  assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
  return outcome.output as EngineResult;
}

const PROPOSE = { toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] };

describe("DR-16: report accepts every reason of the contract's table", () => {
  test("a plan run (needs-input/plan_pending) reports as complete", async () => {
    const { base, ws } = await setup("organize", [PROPOSE]);
    const planned = await run(base);
    assert.equal(planned.reason, "plan_pending");
    const report = await runReport({ argv: ["report", "--workspace", ws, "--run", planned.runId, "--json"], cwd: base, env: {} });
    assert.ok("text" in report, JSON.stringify(report));
    const output = JSON.parse(report.text) as { kind: string; status: string; result: EngineResult };
    assert.deepEqual([output.kind, output.status, output.result.reason], ["report", "complete", "plan_pending"]);
  });

  test("a run awaiting review reports with its checklist, before and after a verdict", async () => {
    const { base, ws } = await setup("analyze", [{ text: "done" }]);
    const finished = await run(base);
    assert.equal(finished.reason, "awaiting_review");
    const before = await runReport({ argv: ["report", "--workspace", ws, "--run", finished.runId], cwd: base, env: {} });
    assert.ok("text" in before && before.text.includes("awaiting_review") && before.text.includes("## Review checklist"), JSON.stringify(before));
    const json = await runReport({ argv: ["report", "--workspace", ws, "--run", finished.runId, "--json"], cwd: base, env: {} });
    assert.ok("text" in json);
    const checklist = (JSON.parse(json.text) as { result: EngineResult }).result.review?.checklist ?? [];
    assert.ok(checklist.length > 0 && checklist.every((item) => before.text.includes(item)));
    // A verdict is kept in review.json; the report still reads the run (ReportOutput has no verdict field yet).
    const reviewed = await runReview(io(base, ["review", "--task", "task.json", "--run", finished.runId, "--accept", "--note", "looks right"]));
    assert.equal(reviewed.exitCode, 0);
    const after = await runReport({ argv: ["report", "--workspace", ws, "--run", finished.runId], cwd: base, env: {} });
    assert.ok("text" in after && after.exitCode === 0, JSON.stringify(after));
  });

  test("a plan run shows its action count, digest and the plan command", async () => {
    const { base, ws } = await setup("organize", [PROPOSE]);
    const planned = await run(base);
    const report = await runReport({ argv: ["report", "--workspace", ws, "--run", planned.runId], cwd: base, env: {} });
    assert.ok("text" in report);
    for (const part of ["1 action(s)", planned.plan?.digest ?? "?", `codaryn plan --run ${planned.runId}`]) assert.ok(report.text.includes(part), part);
  });
});

describe("DR-12: report tells an apply run apart", () => {
  test("an apply run is named as such, not as damaged records (its report form is not in the contract yet)", async () => {
    const { base, ws } = await setup("organize", [PROPOSE]);
    const planned = await run(base);
    const digest = planned.plan?.digest ?? "";
    const applied = await runApply(io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest.slice(0, 12), "--quiet"]));
    assert.ok("output" in applied && applied.output.kind === "apply", JSON.stringify(applied));
    const result = applied.output as ApplyResult;
    const report = await runReport({ argv: ["report", "--workspace", ws, "--run", result.runId], cwd: base, env: {} });
    assert.ok("output" in report && report.output.kind === "error", JSON.stringify(report));
    assert.equal(report.output.code, "invalid_arguments");
    assert.ok(report.output.message.includes("apply run"));
  });
});
