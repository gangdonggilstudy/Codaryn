/**
 * Contract base abc9906 (R-9c C-1) and the help option for DR-21/DR-25:
 * - plan and apply end as plan_run_missing when the plan run's plan.json is gone;
 * - revert of an apply run whose plan run is gone ends as plan_run_missing (not invalid_run_record);
 * - `codaryn help revert` describes --allow-unsafe-move.
 * Real engine, store and tools on a temporary workspace; scripted model. Nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { ApplyResult, EngineResult } from "../../../src/contracts/index.js";
import { assembleRun, createRevertCommand } from "../../../src/cli/assemble.js";
import { helpText } from "../../../src/cli/help.js";
import { runApply, runPlan } from "../../../src/cli/plan-commands.js";
import { runRevert } from "../../../src/cli/revert.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { RevertRunError, inspectRun, revertRun } from "../../../src/store/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 600_000;
const clock = { now: () => (now += 1000) };
let seed = 171;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);

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

async function planRun(): Promise<{ base: string; ws: string; planned: EngineResult }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-plan-missing-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(ws, "a.txt"), "alpha\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(
    path.join(base, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "g-plan-missing",
      goal: "sort",
      workflow: "label",
      workspaceRoot: "./ws",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] },
      privacy: { secretEnv: [] },
      limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [],
      workflowRef: "organize",
    }),
    "utf8",
  );
  const run = await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun });
  assert.equal(run.output.kind, "run", JSON.stringify(run.output));
  return { base, ws, planned: run.output as EngineResult };
}

const planFile = (ws: string, runId: string): string => path.join(ws, ".codaryn", "runs", runId, "plan.json");
const shows = (value: unknown): string => JSON.stringify(value);

describe("R-9c C-1: a plan run whose plan.json is gone", () => {
  test("plan and apply end as plan_run_missing; nothing is moved", async () => {
    const { base, ws, planned } = await planRun();
    await rm(planFile(ws, planned.runId));
    const shown = await runPlan(io(base, ["plan", "--task", "task.json", "--run", planned.runId]));
    assert.ok("output" in shown && shown.output.kind === "error" && shown.output.code === "plan_run_missing", shows(shown));
    const digest = (planned.plan?.digest ?? "").slice(0, 12);
    const applied = await runApply(io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest, "--quiet"]));
    assert.ok("output" in applied && applied.output.kind === "error" && applied.output.code === "plan_run_missing", shows(applied));
    assert.equal(await readFile(path.join(ws, "a.txt"), "utf8"), "alpha\n");
  });

  test("revert of an apply whose plan run lost its plan.json ends as plan_run_missing and changes nothing", async () => {
    const { base, ws, planned } = await planRun();
    const digest = (planned.plan?.digest ?? "").slice(0, 12);
    const applied = await runApply(io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest, "--quiet"]));
    assert.ok("output" in applied && applied.output.kind === "apply", shows(applied));
    const applyRunId = (applied.output as ApplyResult).runId;
    await rm(planFile(ws, planned.runId));
    const reverted = await runRevert({
      argv: ["revert", "--workspace", ws, "--run", applyRunId],
      cwd: base,
      isDirectory: async () => true,
      clock,
      randomBytes,
      revert: createRevertCommand(revertRun, { dryRun: revertRun, inspect: inspectRun }),
    });
    assert.ok(reverted.output.kind === "error" && reverted.output.code === "plan_run_missing", shows(reverted.output));
    assert.equal(await readFile(path.join(ws, "sorted", "a.txt"), "utf8"), "alpha\n", "nothing was moved back");
  });

  test("the store's plan_run_missing reaches the revert output with its own code", async () => {
    const throwing = async (): Promise<never> => {
      throw new RevertRunError("plan_run_missing", "synthetic");
    };
    const ws = await mkdtemp(path.join(tmpdir(), "codaryn-g-plan-missing-fake-"));
    temporaryDirs.push(ws);
    const runId = "20261112T070000Z-0000abcd";
    await mkdir(path.join(ws, ".codaryn", "runs", runId), { recursive: true });
    await writeFile(path.join(ws, ".codaryn", "runs", runId, "journal.jsonl"), "", "utf8");
    const outcome = await runRevert({
      argv: ["revert", "--workspace", ws, "--run", runId],
      cwd: ws,
      isDirectory: async () => true,
      clock,
      randomBytes,
      revert: createRevertCommand(throwing),
    });
    assert.ok(outcome.output.kind === "error" && outcome.output.code === "plan_run_missing", shows(outcome.output));
    assert.equal(outcome.output.message.includes("synthetic"), false, "the store's text is not passed on");
  });
});

describe("help revert names --allow-unsafe-move", () => {
  test("the option is listed with the others", () => {
    const text = helpText("revert");
    const options = text.slice(text.indexOf("\n\n", text.indexOf("usage:")));
    assert.ok(options.includes("--allow-unsafe-move"), text);
  });
});
