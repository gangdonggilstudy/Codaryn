/**
 * Unit U-22 (DR-48, AXM-3 and AXM-8) through the app layer, the GUI's path.
 * - A cleanup that was carried out says what happened with the contract's one rule
 *   (cleanupStatusOf): `removed`, `nothing_removed` or `partly_failed`, and its outcome is `ok` for
 *   `removed` only, as the CLI's JSON (CleanupOutput). Before, a cleanup that removed nothing came
 *   back as an ok outcome.
 * - A confirmed digest that is not the plan's is the error `cleanup_plan_changed`, and a held lock is
 *   `workspace_locked`; neither is a cleanup outcome. Before, both came back as outcomes.
 * - `--run latest` while the newest run is still going is `run_in_progress`, not `run_not_found`,
 *   even after a finished run (PM decision; a run named by its id is shown). The CLI resolves
 *   it; the app passes the code on.
 * Reproduced first (584a31c, todo); the app layer (c59256c) and the CLI (80fec27, 1de5b8a) follow the
 * contract now. `partly_failed` needs a removal the OS refuses; the contract's tests show the rule and
 * the app uses the same function. Real runs through the app (scripted model), the real store.
 * Fake values only.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { LOCK_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppHooks } from "../../../src/app/app.js";
import type { AppCallOutcome, CleanupApplied, CleanupPreview, CodarynApp, RunHandle } from "../../../src/app/index.js";
import { WRITE_NOTES, appEnvironment, exists, setupRun, taskRequest } from "./support.js";

const WAIT = { text: "waiting", delayMs: 30_000 };

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}
const codeOf = (outcome: AppCallOutcome<unknown>): string | null => (outcome.ok ? null : outcome.error.code);

/** A finished run that created NOTES.md (never reverted), through the app. */
async function finishedRun(): Promise<{ base: string; workspace: string; app: CodarynApp; runId: string }> {
  const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok, JSON.stringify(started));
  await started.handle.done;
  return { base, workspace: path.join(base, "work"), app, runId: started.handle.runId };
}

const runDirOf = (workspace: string, runId: string): string => path.join(workspace, STATE_DIR_NAME, RUNS_DIR_NAME, runId);

async function apply(run: { workspace: string; app: CodarynApp }, selection: Readonly<Record<string, unknown>>, includeNotReverted: boolean, digest?: string): Promise<AppCallOutcome<CleanupApplied>> {
  const preview = ok<CleanupPreview>(await run.app.previewCleanup({ workspace: run.workspace, selection }));
  return run.app.applyCleanup({ workspace: run.workspace, selection, now: preview.now, confirmation: { digest: digest ?? preview.plan.digest, discarded: false, includeNotReverted } });
}

describe("U-22 (DR-48): the app says what a cleanup did", () => {
  test("something removed: status removed, the outcome ok", async () => {
    const run = await finishedRun();
    const carried = ok<CleanupApplied>(await apply(run, { runs: { runIds: [run.runId] } }, true));
    assert.equal(carried.status, "removed");
    assert.equal(carried.outcome.ok, true);
    assert.equal(carried.outcome.removed.length, 1);
  });

  test("nothing removed (a confirmation not given): status nothing_removed, the outcome not ok", async () => {
    const run = await finishedRun();
    const carried = ok<CleanupApplied>(await apply(run, { runs: { runIds: [run.runId] } }, false));
    assert.equal(carried.status, "nothing_removed");
    assert.equal(carried.outcome.ok, false, "a cleanup that removed nothing is not ok");
    assert.deepEqual(carried.outcome.removed, []);
    assert.deepEqual(carried.outcome.kept.map((item) => item.reason), ["not_reverted_not_confirmed"]);
    assert.equal(await exists(runDirOf(run.workspace, run.runId)), true);
  });

  test("nothing selected: status nothing_removed", async () => {
    const run = await finishedRun();
    const carried = ok<CleanupApplied>(await apply(run, {}, true));
    assert.equal(carried.status, "nothing_removed");
    assert.equal(carried.outcome.ok, false);
  });

  test("a digest the person did not see, or a plan that changed after the preview, is the error cleanup_plan_changed", async () => {
    const run = await finishedRun();
    const selection = { runs: { runIds: [run.runId] } };
    assert.equal(codeOf(await apply(run, selection, true, "0".repeat(64))), "cleanup_plan_changed");
    const preview = ok<CleanupPreview>(await run.app.previewCleanup({ workspace: run.workspace, selection }));
    await writeFile(path.join(runDirOf(run.workspace, run.runId), "late.txt"), "x", "utf8");
    const stale = await run.app.applyCleanup({ workspace: run.workspace, selection, now: preview.now, confirmation: { digest: preview.plan.digest, discarded: false, includeNotReverted: true } });
    assert.equal(codeOf(stale), "cleanup_plan_changed");
    assert.equal(await exists(runDirOf(run.workspace, run.runId)), true, "nothing was removed");
  });

  test("while another task holds the workspace lock: the error workspace_locked", async () => {
    const run = await finishedRun();
    const handle = await busyOn(run);
    try {
      assert.equal(codeOf(await apply(run, { runs: { runIds: [run.runId] } }, true)), "workspace_locked");
      assert.equal(await exists(runDirOf(run.workspace, run.runId)), true);
    } finally {
      handle.cancel();
      await handle.done;
    }
  });

  test("report --run latest while the only run is still going: run_in_progress", async () => {
    const base = await setupRun({}, {}, []);
    const lone = { base, workspace: path.join(base, "work"), app: createCodarynApp(await appEnvironment(base)) };
    const handle = await busyOn(lone);
    try {
      assert.equal(codeOf(await lone.app.report({ workspace: lone.workspace, runId: "latest" })), "run_in_progress");
    } finally {
      handle.cancel();
      await handle.done;
    }
    // Once it has ended, latest names it.
    assert.equal(ok(await lone.app.report({ workspace: lone.workspace, runId: "latest" })).runId, handle.runId);
  });

  test("report --run latest while the newest run is going, after a finished one: run_in_progress; the finished one by its id", async () => {
    // PM decision (U-22): latest is the newest run, so a run still going answers run_in_progress
    // even when a finished run came before it; the finished run is shown when named by its id.
    const run = await finishedRun();
    const handle = await busyOn(run);
    try {
      assert.equal(codeOf(await run.app.report({ workspace: run.workspace, runId: "latest" })), "run_in_progress");
      assert.equal(ok(await run.app.report({ workspace: run.workspace, runId: run.runId })).runId, run.runId);
    } finally {
      handle.cancel();
      await handle.done;
    }
    // Once the newest run has ended, latest names it.
    assert.equal(ok(await run.app.report({ workspace: run.workspace, runId: "latest" })).runId, handle.runId);
  });
});

/** A second task on the same workspace that waits, holding the lock, until cancelled. */
async function busyOn(run: { base: string; workspace: string; app: CodarynApp }): Promise<RunHandle> {
  const busy = await setupRun({}, {}, [WAIT]);
  const busyTask = path.join(busy, "task.json");
  const text = JSON.parse(await readFile(busyTask, "utf8")) as Record<string, unknown>;
  await writeFile(busyTask, JSON.stringify({ ...text, workspaceRoot: run.workspace }), "utf8");
  const running = await run.app.startRun(taskRequest(busy));
  assert.ok(running.ok, JSON.stringify(running));
  // The waiting run holds the lock, and then its records appear in the run list (the lock comes
  // first, so wait for both).
  const runId = running.handle.runId;
  for (let i = 0; i < 250; i += 1) {
    const listed = await run.app.listRuns({ workspace: run.workspace });
    const held = await exists(path.join(run.workspace, STATE_DIR_NAME, LOCK_FILE_NAME));
    if (held && listed.ok && listed.output.runs.some((entry) => entry.runId === runId)) return running.handle;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("the waiting run did not show in the run list");
}

/**
 * Review R-51 of U-22, the app layer's part (reproduced first in a7e3ec2; the app follows now):
 * - M-2: DR-48 (b) holds for every command and app call that takes `latest`. The app's `changes`
 *   (and the CLI's `changes`, which calls it) and `resolveRun` still chose the run before the
 *   newest one while that one was going.
 * - M-1: a cleanup that removed nothing, or failed in part, is a result for the GUI, not an error:
 *   the call is ok, with `status` and what was removed and kept and why.
 */

describe("R-51: latest in the app's other calls, and the new cleanup results as results", () => {
  test("changes --run latest while the newest run is going, after a finished one: run_in_progress; the finished one by its id", async () => {
    const run = await finishedRun();
    const handle = await busyOn(run);
    const settings = { input: { kind: "task" as const, taskPath: path.join(run.base, "task.json") }, configPath: null, varsFile: null, profile: null, workflowRef: null };
    try {
      assert.equal(codeOf(await run.app.changes({ settings, runId: "latest" })), "run_in_progress");
      assert.equal(ok(await run.app.changes({ settings, runId: run.runId })).runId, run.runId);
    } finally {
      handle.cancel();
      await handle.done;
    }
  });

  test("resolveRun latest while the newest run is going, after a finished one: run_in_progress; the finished one by its id", async () => {
    const run = await finishedRun();
    const handle = await busyOn(run);
    try {
      assert.equal(codeOf(await run.app.resolveRun({ workspace: run.workspace, run: "latest" })), "run_in_progress");
      assert.equal(ok(await run.app.resolveRun({ workspace: run.workspace, run: run.runId })).runId, run.runId);
    } finally {
      handle.cancel();
      await handle.done;
    }
    assert.equal(ok(await run.app.resolveRun({ workspace: run.workspace, run: "latest" })).runId, handle.runId, "once it has ended, latest names it");
  });

  test("a cleanup that removed nothing is an ok call with its result, not an error", async () => {
    const run = await finishedRun();
    const outcome = await apply(run, { runs: { runIds: [run.runId] } }, false);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    const carried = ok<CleanupApplied>(outcome);
    assert.equal(carried.status, "nothing_removed");
    assert.deepEqual(carried.outcome.kept.map((item) => [item.target, item.reason]), [["run", "not_reverted_not_confirmed"]]);
  });

  test("a cleanup that failed in part is an ok call with its result: partly_failed, the outcome not ok, the folder kept as partly_removed", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const busy = (): Error => Object.assign(new Error("the file is in use"), { code: "EBUSY" });
    // The store's removal refused, as a file another process holds open would make it (the hook is
    // the app's test seam; nothing else changes).
    const hooks: AppHooks = { cleanupOperations: { remove: async () => { throw busy(); }, retryDelayMs: 1 } };
    const app = createCodarynApp(await appEnvironment(base), hooks);
    const started = await app.startRun(taskRequest(base));
    assert.ok(started.ok, JSON.stringify(started));
    await started.handle.done;
    const run = { workspace: path.join(base, "work"), app };
    const outcome = await apply(run, { runs: { runIds: [started.handle.runId] } }, true);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    const carried = ok<CleanupApplied>(outcome);
    assert.equal(carried.status, "partly_failed");
    assert.equal(carried.outcome.ok, false);
    assert.deepEqual(carried.outcome.removed, []);
    assert.deepEqual(carried.outcome.kept.map((item) => item.reason), ["partly_removed"]);
  });
});
