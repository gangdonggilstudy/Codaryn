/**
 * Unit U-22 (DR-48, AXM-3 and AXM-8) through the app layer, the GUI's path.
 * - A cleanup that was carried out says what happened with the contract's one rule
 *   (cleanupStatusOf): `removed`, `nothing_removed` or `partly_failed`, and its outcome is `ok` for
 *   `removed` only, as the CLI's JSON (CleanupOutput). Before, a cleanup that removed nothing came
 *   back as an ok outcome.
 * - A confirmed digest that is not the plan's is the error `cleanup_plan_changed`, and a held lock is
 *   `workspace_locked`; neither is a cleanup outcome. Before, both came back as outcomes.
 * - `--run latest` while the latest run is still going is `run_in_progress`, not `run_not_found` or
 *   another run (the CLI resolves it; the app passes the code on).
 * Reproduced first, todo until the app layer (and, for run_in_progress, the CLI) follows the
 * contract. `partly_failed` needs a removal the OS refuses; the contract's tests show the rule and
 * the app uses the same function. Real runs through the app (scripted model), the real store.
 * Fake values only.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { LOCK_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, CleanupPreview, CodarynApp, RunHandle } from "../../../src/app/index.js";
import { WRITE_NOTES, appEnvironment, exists, setupRun, taskRequest } from "./support.js";

const TODO_APP = { todo: "U-22: wait for the app layer to follow the contract" };
const TODO_CLI = { todo: "U-22: wait for the CLI to answer run_in_progress" };
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

/** The fields of a carried-out cleanup the contract names, read without the app's type (it lacks `status` before U-22). */
interface Carried {
  readonly kind: string;
  readonly status?: unknown;
  readonly outcome: { readonly ok: boolean; readonly removed: readonly unknown[]; readonly kept: readonly { readonly reason: string }[] };
}

async function apply(run: { workspace: string; app: CodarynApp }, selection: Readonly<Record<string, unknown>>, includeNotReverted: boolean, digest?: string): Promise<AppCallOutcome<unknown>> {
  const preview = ok<CleanupPreview>(await run.app.previewCleanup({ workspace: run.workspace, selection }));
  return run.app.applyCleanup({ workspace: run.workspace, selection, now: preview.now, confirmation: { digest: digest ?? preview.plan.digest, discarded: false, includeNotReverted } });
}

describe("U-22 (DR-48): the app says what a cleanup did", () => {
  test("something removed: status removed, the outcome ok", TODO_APP, async () => {
    const run = await finishedRun();
    const carried = ok(await apply(run, { runs: { runIds: [run.runId] } }, true)) as Carried;
    assert.equal(carried.status, "removed");
    assert.equal(carried.outcome.ok, true);
    assert.equal(carried.outcome.removed.length, 1);
  });

  test("nothing removed (a confirmation not given): status nothing_removed, the outcome not ok", TODO_APP, async () => {
    const run = await finishedRun();
    const carried = ok(await apply(run, { runs: { runIds: [run.runId] } }, false)) as Carried;
    assert.equal(carried.status, "nothing_removed");
    assert.equal(carried.outcome.ok, false, "a cleanup that removed nothing is not ok");
    assert.deepEqual(carried.outcome.removed, []);
    assert.deepEqual(carried.outcome.kept.map((item) => item.reason), ["not_reverted_not_confirmed"]);
    assert.equal(await exists(runDirOf(run.workspace, run.runId)), true);
  });

  test("nothing selected: status nothing_removed", TODO_APP, async () => {
    const run = await finishedRun();
    const carried = ok(await apply(run, {}, true)) as Carried;
    assert.equal(carried.status, "nothing_removed");
    assert.equal(carried.outcome.ok, false);
  });

  test("a digest the person did not see, or a plan that changed after the preview, is the error cleanup_plan_changed", TODO_APP, async () => {
    const run = await finishedRun();
    const selection = { runs: { runIds: [run.runId] } };
    assert.equal(codeOf(await apply(run, selection, true, "0".repeat(64))), "cleanup_plan_changed");
    const preview = ok<CleanupPreview>(await run.app.previewCleanup({ workspace: run.workspace, selection }));
    await writeFile(path.join(runDirOf(run.workspace, run.runId), "late.txt"), "x", "utf8");
    const stale = await run.app.applyCleanup({ workspace: run.workspace, selection, now: preview.now, confirmation: { digest: preview.plan.digest, discarded: false, includeNotReverted: true } });
    assert.equal(codeOf(stale), "cleanup_plan_changed");
    assert.equal(await exists(runDirOf(run.workspace, run.runId)), true, "nothing was removed");
  });

  test("while another task holds the workspace lock: the error workspace_locked", TODO_APP, async () => {
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

  test("report --run latest while the latest run is still going: run_in_progress", TODO_CLI, async () => {
    const run = await finishedRun();
    const handle = await busyOn(run);
    try {
      assert.equal(codeOf(await run.app.report({ workspace: run.workspace, runId: "latest" })), "run_in_progress");
    } finally {
      handle.cancel();
      await handle.done;
    }
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
  // The waiting run holds the lock once its first model turn has started.
  for (let i = 0; i < 100; i += 1) {
    if (await exists(path.join(run.workspace, STATE_DIR_NAME, LOCK_FILE_NAME))) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return running.handle;
}
