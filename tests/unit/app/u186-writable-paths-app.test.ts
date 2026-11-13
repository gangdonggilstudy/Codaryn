/**
 * Unit U-186 (DR-69 B-4, after na-core's U-182, report-N-A 116.2 (1)): U-182 builds a task's
 * writable path lists (ResolvedTaskSpec.writablePathSets) in the CLI's prepareTask and gives them to
 * the CLI's gates; the app layer builds its tasks with the same prepareTask, but its own two gates
 * (the run's assembly, src/app/assemble.ts, and the apply's preflight check, src/app/check-apply.ts)
 * did not get the lists, so a run or a check through the app (the GUI's) ignored them: fail open.
 * - A run through the app: a file tool's write outside a list is denied (path/path_not_writable),
 *   for the task file's list and for the config file's list under a task file run alike.
 * - checkApply: a plan action outside the apply task's list is `denied`, as the apply itself finds.
 * - applyPlan through the app already went through the CLI's apply (runApply), whose gate U-182 gave
 *   the lists: kept as a guard.
 * Reproduced first (394adf9, todo until the app layer's gates got the lists). Scripted model, temporary folders.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { ApplyResult, PlanCheck } from "../../../src/app/index.js";
import { PLAN_TASK, SECRET_ENV, appEnvironment, exists, plannedRun, readJournal, setupRun, taskForm, taskRequest } from "./support.js";

const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false } as const;

/** Each path written in turn as a new file, then the end. */
function writes(...files: readonly string[]): unknown[] {
  return [...files.map((file) => ({ toolCalls: [{ name: "write_file", args: { path: file, expectedHash: null, change: { kind: "replace_all", content: "x\n" } } }] })), { text: "done" }];
}

/** A run through the app; each tool decision as "allowed" or "<permission>/<code>", in order. */
async function runThroughApp(base: string, configPath: string | null = null): Promise<readonly string[]> {
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base, { configPath }));
  assert.ok(started.ok, JSON.stringify(started));
  const ended = await started.handle.done;
  assert.ok(ended.ok, JSON.stringify(ended));
  const journal = await readJournal(base, ended.result.runId);
  return journal.flatMap((record) => (record.type === "tool_decision" ? [record.allowed ? "allowed" : `${record.permission}/${record.code}`] : []));
}

describe("U-186: a run through the app layer keeps to the writable path lists", () => {
  test("the task file's list: a write outside it is path_not_writable, nothing is made there", async () => {
    const base = await setupRun({}, { policy: { ...POLICY, writablePaths: ["out"] }, verifiers: [] }, writes("out/ok.md", "elsewhere.md"));
    const decisions = await runThroughApp(base);
    assert.deepEqual(decisions, ["allowed", "path/path_not_writable"]);
    assert.equal(await exists(path.join(base, "work", "out", "ok.md")), true);
    assert.equal(await exists(path.join(base, "work", "elsewhere.md")), false, "nothing written outside the list");
  });

  test("the config file's list applies under a task file run too", async () => {
    const base = await setupRun({}, { verifiers: [] }, writes("out/ok.md", "elsewhere.md"));
    const config = path.join(base, "config.json");
    await writeFile(config, JSON.stringify({ schemaVersion: 1, policy: { ...POLICY, writablePaths: ["out"] } }), "utf8");
    const decisions = await runThroughApp(base, config);
    assert.deepEqual(decisions, ["allowed", "path/path_not_writable"]);
    assert.equal(await exists(path.join(base, "work", "elsewhere.md")), false);
  });

  test("an empty list: every file tool write is denied", async () => {
    const base = await setupRun({}, { policy: { ...POLICY, writablePaths: [] }, verifiers: [] }, writes("out/ok.md"));
    assert.deepEqual(await runThroughApp(base), ["path/path_not_writable"]);
    assert.equal(await exists(path.join(base, "work", "out", "ok.md")), false);
  });

  test("without a list nothing changes: the write is allowed", async () => {
    const base = await setupRun({}, { verifiers: [] }, writes("elsewhere.md"));
    assert.deepEqual(await runThroughApp(base), ["allowed"]);
  });
});

describe("U-186: the apply task's list in the app's preflight check and apply", () => {
  /** A plan made without a list, and an apply task file of the same task with `writablePaths`. */
  async function planAndApplyTask(writable: readonly string[]) {
    const planned = await plannedRun();
    const applyTask = path.join(planned.base, "apply-task.json");
    const task = JSON.parse(await readFile(path.join(planned.base, "task.json"), "utf8")) as Record<string, unknown>;
    await writeFile(applyTask, JSON.stringify({ ...task, policy: { ...PLAN_TASK.policy, writablePaths: writable } }), "utf8");
    assert.deepEqual((task["privacy"] as { secretEnv: string[] }).secretEnv, [SECRET_ENV], "the same secrets (DR-28)");
    return { ...planned, settings: taskForm(planned.base, { input: { kind: "task", taskPath: applyTask } }) };
  }

  test("checkApply: a move outside the apply task's list is denied", async () => {
    const p = await planAndApplyTask(["inbox"]);
    const outcome = await p.app.checkApply({ settings: p.settings, planRunId: p.plan.runId, digest: p.digest });
    assert.ok(outcome.ok, JSON.stringify(outcome));
    const check = (outcome as { output: PlanCheck }).output;
    assert.deepEqual(check.problems, [{ index: 0, problem: "denied" }]);
    assert.equal(await exists(path.join(p.base, "work", "a.txt")), true, "nothing moved");
  });

  test("checkApply: a move inside the list has no problem", async () => {
    const p = await planAndApplyTask(["."]);
    const outcome = await p.app.checkApply({ settings: p.settings, planRunId: p.plan.runId, digest: p.digest });
    assert.ok(outcome.ok, JSON.stringify(outcome));
    assert.deepEqual((outcome as { output: PlanCheck }).output.problems, []);
  });

  test("applyPlan through the app (the CLI's apply): the move outside the list is not made", async () => {
    const p = await planAndApplyTask(["inbox"]);
    const started = await p.app.applyPlan({ settings: p.settings, planRunId: p.plan.runId, digest: p.digest.slice(0, 12), cancelFile: null, unsafeMoveConsent: null });
    assert.ok(started.ok, JSON.stringify(started));
    const done = await started.handle.done;
    assert.ok(done.ok, JSON.stringify(done));
    const result: ApplyResult = done.output;
    assert.deepEqual([result.status, result.reason], ["failed", "plan_stale"]);
    assert.equal(await exists(path.join(p.base, "work", "a.txt")), true, "nothing moved");
    assert.equal(await exists(path.join(p.base, "work", "sorted", "a.txt")), false);
  });
});
