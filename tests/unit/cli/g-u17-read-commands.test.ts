/**
 * U-17 (UXM-3, UXM-19, AXM-14, DR-46), the CLI's part.
 * - The quick form of the commands that read only (`plan`) or write only a person's verdict
 *   (`review`) does not need the run's limits: no model runs. Before, without a config file they
 *   stopped as invalid_config ("limits.maxModelTurns is not set"). `apply` still builds the run's
 *   settings (its verifiers run under them).
 * - Reading commands take the current directory when `--workspace` is left out (`report`, `plan`,
 *   `changes`); commands that change things (`revert`, `cleanup`, `apply`, `review`) still ask for
 *   it, and say how to name the current directory.
 * Real engine, store and tools; scripted model; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { EngineResult, PlanOutput } from "../../../src/contracts/index.js";
import { parseApplyArgs, parsePlanArgs, parseReportArgs, parseRevertArgs, parseReviewArgs } from "../../../src/cli/args.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { parseChangesArgs } from "../../../src/cli/changes.js";
import { parseCleanupArgs } from "../../../src/cli/cleanup.js";
import { runApply, runPlan, runReview } from "../../../src/cli/plan-commands.js";
import { runReport } from "../../../src/cli/report.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { listRuns } from "../../../src/store/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 900_000;
const clock = { now: () => (now += 1000) };
let seed = 101;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);

const io = (cwd: string, argv: readonly string[]) => ({
  argv,
  env: {},
  cwd,
  readFile: (file: string) => readFile(file, "utf8"),
  isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
  loadEnvFile: () => {},
  locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
  relatePaths: (target: string, root: string) => relateRealPaths(target, root),
  clock,
  randomBytes,
  cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
});

/** A plan run made from a task file (no secrets); no config file anywhere. */
async function planRun(): Promise<{ base: string; ws: string; runId: string; digest: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u17-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(ws, "a.txt"), "alpha\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  const task = {
    schemaVersion: 1,
    id: "u17",
    goal: "g",
    workflow: "label",
    workspaceRoot: "./ws",
    workflowRef: "organize",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] },
    privacy: { secretEnv: [] },
    limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
    verifiers: [],
  };
  await writeFile(path.join(base, "task.json"), JSON.stringify(task), "utf8");
  const planned = (await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun })).output as EngineResult;
  assert.equal(planned.reason, "plan_pending", JSON.stringify(planned));
  return { base, ws, runId: planned.runId, digest: planned.plan?.digest ?? "" };
}

const errorCode = (outcome: object): string | null => {
  const output = (outcome as { output?: { kind?: string; code?: string } }).output;
  return output?.kind === "error" ? (output.code ?? null) : null;
};

describe("U-17 (UXM-3, AXM-14): the quick form of plan and review needs no run limits", () => {
  test("plan --workspace without a config file shows the plan", async () => {
    const { base, runId, digest } = await planRun();
    const outcome = await runPlan(io(base, ["plan", "--workspace", "ws", "--workflow", "organize", "--run", runId, "--json"]));
    assert.ok("output" in outcome && outcome.output.kind === "plan", JSON.stringify(outcome));
    assert.deepEqual([(outcome.output as PlanOutput).digest, outcome.exitCode], [digest, 0]);
  });

  test("review --workspace without a config file is judged by the run, not by missing limits", async () => {
    const { base, runId } = await planRun();
    const outcome = await runReview(io(base, ["review", "--workspace", "ws", "--workflow", "organize", "--run", runId, "--accept"]));
    // The run is a plan run, not one awaiting review: that is what the answer says.
    assert.notEqual(errorCode(outcome), "invalid_config", JSON.stringify(outcome));
    assert.notEqual(errorCode(outcome), null, JSON.stringify(outcome));
  });

  test("apply --workspace without a config file still needs the run's settings (its verifiers run under them)", async () => {
    const { base, runId, digest } = await planRun();
    const outcome = await runApply(io(base, ["apply", "--workspace", "ws", "--workflow", "organize", "--run", runId, "--digest", digest.slice(0, 12), "--quiet"]));
    assert.equal(errorCode(outcome), "invalid_config", JSON.stringify(outcome));
  });
});

describe("U-17 (UXM-19, DR-46): reading commands take the current directory without --workspace", () => {
  test("plan inside the workspace, with neither --task nor --workspace", async () => {
    const { ws, runId, digest } = await planRun();
    const outcome = await runPlan(io(ws, ["plan", "--workflow", "organize", "--run", runId, "--json"]));
    assert.ok("output" in outcome && outcome.output.kind === "plan", JSON.stringify(outcome));
    assert.equal((outcome.output as PlanOutput).digest, digest);
  });

  test("report inside the workspace, without --workspace", async () => {
    const { ws, runId } = await planRun();
    const outcome = await runReport({ argv: ["report", "--run", runId, "--json"], cwd: ws, env: {}, listRuns });
    assert.equal(outcome.exitCode, 0, JSON.stringify(outcome));
    const output = ("text" in outcome ? JSON.parse(outcome.text) : outcome.output) as { kind: string; runId: string };
    assert.deepEqual([output.kind, output.runId], ["report", runId]);
  });

  test("the parsers: report, plan and changes name the current directory; a given one is kept", () => {
    const report = parseReportArgs(["report", "--run", "latest"]);
    assert.ok(report.ok && report.args.workspace === ".", JSON.stringify(report));
    const plan = parsePlanArgs(["plan", "--run", "latest"]);
    assert.ok(plan.ok && plan.args.form.input.kind === "quick" && plan.args.form.input.workspace === ".", JSON.stringify(plan));
    const changes = parseChangesArgs(["changes", "--run", "latest"]);
    assert.ok(changes.ok && changes.args.settings.input.kind === "workspace" && changes.args.settings.input.workspace === ".", JSON.stringify(changes));
    const given = parseReportArgs(["report", "--workspace", "w", "--run", "latest"]);
    assert.ok(given.ok && given.args.workspace === "w");
    const both = parsePlanArgs(["plan", "--task", "t.json", "--workspace", "w", "--run", "latest"]);
    assert.equal(both.ok, false);
    assert.equal(parseReportArgs(["report"]).ok, false, "--run is still required");
  });

  test("commands that change things still ask for --workspace and say how to name the current directory", () => {
    const messages = [
      parseRevertArgs(["revert", "--run", "latest"]),
      parseApplyArgs(["apply", "--run", "20260102T030405Z-0a0b0c0d", "--digest", "0123456789ab"]),
      parseReviewArgs(["review", "--run", "latest", "--accept"]),
      parseCleanupArgs(["cleanup"]),
    ].map((parsed) => (parsed.ok ? "(parsed)" : parsed.message));
    for (const message of messages) assert.ok(message.includes("--workspace ."), message);
  });
});
