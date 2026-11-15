/**
 * G-F: plan, apply and review through the real CLI functions, engine, store and tools on a
 * temporary workspace (GT-U04, GT-U06, GT-U08 via the CLI, GT-U12). The model is scripted; nothing
 * is sent. GI-02 and GI-06 as process cases belong to the integration suite (G-G).
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { ApplyResult, EngineResult, PlanOutput, ReviewOutput } from "../../../src/contracts/index.js";
import { assembleRun, createRevertCommand } from "../../../src/cli/assemble.js";
import { runApply, runPlan, runReview } from "../../../src/cli/plan-commands.js";
import type { ApplyCommandEnvironment } from "../../../src/cli/plan-commands.js";
import { runRevert } from "../../../src/cli/revert.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { revertRun } from "../../../src/store/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
const LIMITS = { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 };
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let clockMs = Date.now() - 600_000;
const clock = { now: () => (clockMs += 1000) };
let randomByte = 1;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(randomByte++ % 250);

async function setup(workflowRef: string, steps: unknown[], extra: Record<string, unknown> = {}): Promise<{ base: string; ws: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-flow-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(ws, "a.txt"), "alpha\n", "utf8");
  await writeFile(path.join(ws, "b.txt"), "beta\n", "utf8");
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  const task = {
    schemaVersion: 1,
    id: "g-flow",
    goal: "arrange the files",
    workflow: "label",
    workspaceRoot: "./ws",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move", "discard"] },
    privacy: { secretEnv: [] },
    limits: LIMITS,
    verifiers: [],
    workflowRef,
    ...extra,
  };
  await writeFile(path.join(base, "task.json"), JSON.stringify(task), "utf8");
  return { base, ws };
}

function shared(base: string, argv: readonly string[]) {
  return {
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
  };
}

async function run(base: string): Promise<EngineResult> {
  const io: CliEnvironment = {
    ...shared(base, ["run", "--task", "task.json", "--quiet"]),
    assemble: assembleRun,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  };
  const outcome = await runCli(io);
  assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
  return outcome.output as EngineResult;
}

function applyIo(base: string, argv: readonly string[]): ApplyCommandEnvironment {
  return { ...shared(base, argv), cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }) };
}

const exists = async (file: string): Promise<boolean> => (await stat(file).catch(() => null)) !== null;

describe("organize: run → plan_pending → plan → apply → revert", () => {
  test("the plan run changes nothing; plan shows it masked; apply needs the digest and runs once; revert puts it back", async () => {
    const proposal = {
      toolCalls: [
        {
          name: "propose_plan",
          args: { summary: "sort a, discard b", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }, { kind: "discard", path: "b.txt" }] },
        },
      ],
    };
    const { base, ws } = await setup("organize", [proposal, { text: "done" }]);
    const planned = await run(base);
    assert.deepEqual([planned.status, planned.reason, planned.exitCode], ["needs-input", "plan_pending", 3]);
    assert.ok(planned.plan !== undefined && planned.plan.actions === 2);
    assert.ok(await exists(path.join(ws, "a.txt")) && await exists(path.join(ws, "b.txt")), "nothing moved before approval");

    const shown = await runPlan(shared(base, ["plan", "--task", "task.json", "--run", planned.runId, "--json"]));
    assert.ok("output" in shown && shown.output.kind === "plan");
    const plan = shown.output as PlanOutput;
    assert.equal(plan.digest, planned.plan?.digest);
    assert.equal(plan.status, "pending");
    assert.deepEqual(plan.actions.map((action) => action.kind), ["move", "discard"]);
    const text = await runPlan(shared(base, ["plan", "--task", "task.json", "--run", "latest"]));
    assert.ok("text" in text && text.text.includes(`--digest ${plan.digest.slice(0, 12)}`));

    // GT-U06: no digest at no terminal, a wrong digest: nothing moves.
    for (const extra of [[], ["--digest", "0".repeat(12)]]) {
      const refused = await runApply(applyIo(base, ["apply", "--task", "task.json", "--run", planned.runId, "--quiet", ...extra]));
      assert.ok("output" in refused && refused.output.kind === "error" && refused.output.code === "plan_not_approved", JSON.stringify(extra));
    }
    assert.ok(await exists(path.join(ws, "a.txt")));
    // The terminal question defaults to no.
    const declined = await runApply({ ...applyIo(base, ["apply", "--task", "task.json", "--run", planned.runId]), ask: async () => "" });
    assert.ok("output" in declined && declined.output.kind === "error" && declined.output.code === "plan_not_approved");

    const applied = await runApply(applyIo(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", plan.digest.slice(0, 12), "--quiet"]));
    assert.ok("output" in applied && applied.output.kind === "apply", JSON.stringify("output" in applied ? applied.output : null));
    const result = applied.output as ApplyResult;
    assert.deepEqual([result.status, result.reason, result.planRunId], ["done", "verified", planned.runId]);
    assert.equal(result.verifiers[0]?.id, "inventory");
    assert.equal(await readFile(path.join(ws, "sorted", "a.txt"), "utf8"), "alpha\n");
    assert.equal(await exists(path.join(ws, "a.txt")), false);
    assert.equal(await exists(path.join(ws, "b.txt")), false);
    // DR-9: the discarded file is kept (named by its action index, never by its file name).
    const discardedDir = path.join(ws, ".codaryn", "discarded", result.runId);
    const kept = await Promise.all((await readdir(discardedDir)).map((name) => readFile(path.join(discardedDir, name), "utf8").catch(() => "")));
    assert.ok(kept.includes("beta\n"), "DR-9: the discarded file is kept");
    assert.equal((await readdir(discardedDir)).some((name) => name.includes("b.txt")), false);
    assert.ok(await exists(path.join(ws, ".codaryn", "runs", result.runId, "result.json")));

    const again = await runApply(applyIo(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", plan.digest.slice(0, 12), "--quiet"]));
    assert.ok("output" in again && again.output.kind === "error" && again.output.code === "plan_already_applied");

    const reverted = await runRevert({
      argv: ["revert", "--workspace", ws, "--run", result.runId],
      cwd: base,
      isDirectory: async () => true,
      clock,
      randomBytes,
      revert: createRevertCommand(revertRun),
    });
    assert.ok(reverted.output.kind === "revert" && reverted.output.status === "complete", JSON.stringify(reverted.output));
    assert.equal(await readFile(path.join(ws, "a.txt"), "utf8"), "alpha\n");
    assert.equal(await readFile(path.join(ws, "b.txt"), "utf8"), "beta\n");
  });

  test("apply refuses a task whose workflow does not apply plans, and latest as the plan run", async () => {
    const { base } = await setup("document", [{ text: "done" }]);
    const finished = await run(base);
    const outcome = await runApply(applyIo(base, ["apply", "--task", "task.json", "--run", finished.runId, "--digest", "0".repeat(12)]));
    assert.ok("output" in outcome && outcome.output.kind === "error" && outcome.output.code === "run_not_plan");
    const latest = await runApply(applyIo(base, ["apply", "--task", "task.json", "--run", "latest", "--digest", "0".repeat(12)]));
    assert.ok("output" in latest && latest.output.kind === "error" && latest.output.code === "invalid_arguments");
  });
});

describe("analyze: run → awaiting_review → review", () => {
  test("review writes review.json only; a second one replaces it; a plan run cannot be reviewed", async () => {
    const { base, ws } = await setup("analyze", [{ text: "done" }], { policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false } });
    const finished = await run(base);
    assert.deepEqual([finished.status, finished.reason], ["needs-input", "awaiting_review"]);
    const resultFile = path.join(ws, ".codaryn", "runs", finished.runId, "result.json");
    const before = await readFile(resultFile, "utf8");

    const first = await runReview(shared(base, ["review", "--task", "task.json", "--run", finished.runId, "--accept", "--note", "numbers match", "--json"]));
    assert.ok("output" in first && first.output.kind === "review");
    const output = first.output as ReviewOutput;
    assert.deepEqual([output.verdict, output.replaced], ["accepted", false]);
    assert.ok(output.checklist.length > 0);
    const record = JSON.parse(await readFile(path.join(ws, ".codaryn", "runs", finished.runId, "review.json"), "utf8")) as Record<string, unknown>;
    assert.deepEqual([record["verdict"], record["note"]], ["accepted", "numbers match"]);
    assert.equal(await readFile(resultFile, "utf8"), before, "M-16: result.json is unchanged");

    const second = await runReview(shared(base, ["review", "--task", "task.json", "--run", "latest", "--reject"]));
    assert.ok("text" in second && second.text.includes("rejected") && second.text.includes("replaced"));

    const wrong = await runReview(shared(base, ["review", "--task", "task.json", "--run", "20261112T010000Z-00000000", "--accept"]));
    assert.ok("output" in wrong && wrong.output.kind === "error" && wrong.output.code === "run_not_found");
    const keyed = await runReview({ ...shared(base, ["review", "--task", "task.json", "--run", finished.runId, "--accept", "--note", `key ${["sk", "ant", "FAKEfake0000FAKEfake0000FAKEfake00"].join("-")}`]) });
    assert.ok("output" in keyed && keyed.output.kind === "error" && keyed.output.code === "key_in_file");
  });
});
