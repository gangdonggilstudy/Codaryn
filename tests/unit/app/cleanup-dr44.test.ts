/**
 * DR-44 (review R-34, the cleanup of DR-39) through the app layer, the GUI's path. Reproduced first
 * (ac9252b, todo); the contract (73ec895), the app layer's confirmation check (ef5f389) and the
 * store (0c8394d) now follow DR-44.
 * - (가) a run not reverted (or reverted only in part) loses its only way back when its records go:
 *   they go only with a confirmation of their own, besides the plan's digest. Not blocked.
 * - (나) L-1: a run reverted only in part is not a reverted run: `reverted: true` does not select
 *   it, it is warned `partly_reverted`, and its records need the same confirmation.
 * - (다) L-2: an apply run whose discarded-files folder is selected too is warned `discarded_left`
 *   in the preview, as the person may keep the folder when confirming.
 * L-3 (a removal that fails after the move) needs a removal the OS refuses; the store's tests show
 * it, and the app layer passes the store's outcome on as it is.
 * Real runs through the app (scripted model), the real store. Fake values only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, CleanupApplied, CleanupPreview, CodarynApp } from "../../../src/app/index.js";
import { appEnvironment, setupRun, taskForm, taskRequest } from "./support.js";

const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

/** A run that changed c.txt and d.txt; `partly` reverts it after a person edited d.txt (a partial revert). */
async function changedRun(partly: boolean): Promise<{ base: string; workspace: string; app: CodarynApp; runId: string }> {
  const base = await setupRun({ "c.txt": "c\n", "d.txt": "d\n" }, {}, [
    { toolCalls: [{ name: "write_file", args: { path: "c.txt", expectedHash: sha("c\n"), change: { kind: "replace_all", content: "c2\n" } } }] },
    { toolCalls: [{ name: "write_file", args: { path: "d.txt", expectedHash: sha("d\n"), change: { kind: "replace_all", content: "d2\n" } } }] },
    { text: "done" },
  ]);
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok, JSON.stringify(started));
  await started.handle.done;
  const workspace = path.join(base, "work");
  if (partly) {
    await writeFile(path.join(workspace, "d.txt"), "edited by a person\n", "utf8");
    const reverted = ok(await app.revert({ workspace, runId: started.handle.runId }));
    assert.equal(reverted.status, "partial", JSON.stringify(reverted));
  }
  return { base, workspace, app, runId: started.handle.runId };
}

const runsIn = async (workspace: string): Promise<string[]> => readdir(path.join(workspace, STATE_DIR_NAME, RUNS_DIR_NAME));

describe("DR-44: cleanup of runs that keep a way back", () => {
  test("(나) L-1: a run reverted only in part is warned partly_reverted and is not selected by reverted: true", async () => {
    const { workspace, app, runId } = await changedRun(true);
    const all = ok<CleanupPreview>(await app.previewCleanup({ workspace, selection: { runs: { runIds: [runId] } } }));
    assert.ok(all.plan.items.find((item) => "runId" in item && item.runId === runId)?.warnings.includes("partly_reverted"), JSON.stringify(all.plan.items));
    assert.equal(all.plan.totals.runs.notReverted, 1, "it needs the confirmation of runs not reverted");
    const reverted = ok<CleanupPreview>(await app.previewCleanup({ workspace, selection: { runs: { olderThanDays: 0, reverted: true } } }));
    assert.deepEqual(reverted.plan.items, [], "a partial revert is not a reverted run");
  });

  test("(가) the records of a run not reverted go only with their own confirmation, besides the digest", async () => {
    const { workspace, app, runId } = await changedRun(false);
    const selection = { runs: { runIds: [runId] } };
    const preview = ok<CleanupPreview>(await app.previewCleanup({ workspace, selection }));
    assert.ok(preview.plan.items[0]?.warnings.includes("not_reverted"));
    assert.equal(preview.plan.totals.runs.notReverted, 1);
    const kept = ok<CleanupApplied>(await app.applyCleanup({ workspace, selection, now: preview.now, confirmation: { digest: preview.plan.digest, discarded: false, includeNotReverted: false } }));
    // DR-48 (U-22): nothing removed, so the cleanup says so and its outcome is not ok.
    assert.equal(kept.status, "nothing_removed", JSON.stringify(kept));
    assert.equal(kept.outcome.ok, false);
    assert.deepEqual(kept.outcome.removed, [], "the digest alone does not remove a run not reverted");
    assert.deepEqual(kept.outcome.kept, [{ target: "run", runId, reason: "not_reverted_not_confirmed" }]);
    assert.deepEqual(await runsIn(workspace), [runId]);
    const removed = ok<CleanupApplied>(await app.applyCleanup({ workspace, selection, now: preview.now, confirmation: { digest: preview.plan.digest, discarded: false, includeNotReverted: true } }));
    assert.ok(removed.status === "removed" && removed.outcome.ok && removed.outcome.removed.length === 1, JSON.stringify(removed));
    assert.deepEqual(await runsIn(workspace), []);
  });

  test("(다) L-2: an apply run whose discarded folder is selected too is warned discarded_left before the confirmation", async () => {
    const base = await setupRun({ "c.log": "old log\n" }, { workflowRef: "organize", policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["discard"] }, verifiers: [] }, [
      { toolCalls: [{ name: "propose_plan", args: { summary: "drop the log", actions: [{ kind: "discard", path: "c.log" }] } }] },
    ]);
    const app = createCodarynApp(await appEnvironment(base));
    const planned = await app.startRun(taskRequest(base));
    assert.ok(planned.ok);
    const plan = await planned.handle.done;
    assert.ok(plan.ok && plan.result.plan !== undefined);
    const applied = await app.applyPlan({ settings: taskForm(base), planRunId: plan.result.runId, digest: plan.result.plan.digest, cancelFile: null, unsafeMoveConsent: null });
    assert.ok(applied.ok);
    await applied.handle.done;
    const applyRunId = applied.handle.runId;
    const workspace = path.join(base, "work");
    const preview = ok<CleanupPreview>(await app.previewCleanup({ workspace, selection: { runs: { runIds: [applyRunId] }, discarded: { runIds: [applyRunId] } } }));
    const item = preview.plan.items.find((entry) => entry.target === "run" && "runId" in entry && entry.runId === applyRunId);
    assert.ok(item?.warnings.includes("discarded_left"), JSON.stringify(preview.plan.items));
  });
});
