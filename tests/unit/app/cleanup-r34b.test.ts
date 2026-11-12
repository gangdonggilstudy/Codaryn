/**
 * Review R-34b of the cleanup (the last round, decided by the PM) through the app layer, the GUI's
 * path. Reproduced first (440c5bb, todo); the contract (eacd18e) and the store (26a10db, unit U-3)
 * follow it now.
 * - P-1 (R-34b L-1): a run whose records cannot be checked (damaged) may have changed files; whether
 *   it was reverted is not known. It is treated as a run not reverted: warned, counted in
 *   totals.runs.notReverted, and its records go only with includeNotReverted.
 * - P-2 (R-34b L-2): a folder named like a leftover (`cleanup-<16 hex>`) without the mark a cleanup
 *   writes when it moves a folder aside is not a leftover: it is never an item to remove, whatever
 *   is confirmed (the store shows it as an unknown folder only).
 * The checks use the contract's own rule (needsNotRevertedConfirmation), not a code name, so a new
 * warning for damaged records fits. Real runs through the app (scripted model), the real store.
 * Fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { RUNS_DIR_NAME, STATE_DIR_NAME, needsNotRevertedConfirmation } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, CleanupApplied, CleanupPreview, CodarynApp, StateSummaryView } from "../../../src/app/index.js";
import { WRITE_NOTES, appEnvironment, exists, setupRun, taskRequest } from "./support.js";

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

/** A finished run that created NOTES.md, through the app. */
async function finishedRun(): Promise<{ workspace: string; app: CodarynApp; runId: string }> {
  const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok, JSON.stringify(started));
  await started.handle.done;
  return { workspace: path.join(base, "work"), app, runId: started.handle.runId };
}

const runDirOf = (workspace: string, runId: string): string => path.join(workspace, STATE_DIR_NAME, RUNS_DIR_NAME, runId);

describe("R-34b: the cleanup's last round through the app layer", () => {
  test("P-1: a run whose records cannot be checked needs the confirmation of runs not reverted", async () => {
    const { workspace, app, runId } = await finishedRun();
    const result = path.join(runDirOf(workspace, runId), "result.json");
    assert.ok((await readFile(result, "utf8")).length > 0);
    await writeFile(result, "{ damaged", "utf8");
    const selection = { runs: { runIds: [runId] } };
    const preview = ok<CleanupPreview>(await app.previewCleanup({ workspace, selection }));
    const item = preview.plan.items.find((entry) => "runId" in entry && entry.runId === runId);
    assert.ok(item !== undefined && needsNotRevertedConfirmation(item.warnings), JSON.stringify(preview.plan.items));
    assert.ok(item.warnings.includes("records_unreadable"), "the contract's warning for damaged records");
    assert.equal(preview.plan.totals.runs.notReverted, 1);
    const kept = ok<CleanupApplied>(await app.applyCleanup({ workspace, selection, now: preview.now, confirmation: { digest: preview.plan.digest, discarded: false, includeNotReverted: false } }));
    // DR-48 (U-22): nothing removed, so the cleanup says so and its outcome is not ok.
    assert.equal(kept.status, "nothing_removed", JSON.stringify(kept));
    assert.equal(kept.outcome.ok, false);
    assert.deepEqual(kept.outcome.kept, [{ target: "run", runId, reason: "not_reverted_not_confirmed" }]);
    assert.equal(await exists(runDirOf(workspace, runId)), true, "its snapshot, the last copy of the originals, stays");
  });

  test("P-2: a cleanup-<hex> folder without the cleanup's mark is never an item to remove", async () => {
    const { workspace, app, runId } = await finishedRun();
    const stranger = path.join(workspace, STATE_DIR_NAME, "cleanup-0123456789abcdef");
    await mkdir(stranger, { recursive: true });
    await writeFile(path.join(stranger, "person.txt"), "a person's file\n", "utf8");
    const selection = { runs: { runIds: [runId] } };
    const preview = ok<CleanupPreview>(await app.previewCleanup({ workspace, selection }));
    assert.deepEqual(preview.plan.items.filter((item) => item.target === "leftover"), [], JSON.stringify(preview.plan.items));
    const applied = ok<CleanupApplied>(
      await app.applyCleanup({ workspace, selection, now: preview.now, confirmation: { digest: preview.plan.digest, discarded: true, includeNotReverted: true } }),
    );
    assert.ok(applied.status === "removed" && applied.outcome.ok, JSON.stringify(applied));
    assert.deepEqual(await readdir(stranger), ["person.txt"], "the unknown folder stays, whatever was confirmed");
    const summary = ok<StateSummaryView>(await app.stateSummary({ workspace }));
    assert.deepEqual([summary.summary.unknownFolders?.count, summary.summary.unknownFolders?.files], [1, 1], "shown as an unknown folder");
  });
});
