/**
 * DR-39 for the GUI (standalone-gui 3.8, GU-4): the app layer gives the store's summary, cleanup
 * plan and cleanup. What would be removed comes first (a preview, nothing removed); only a plan the
 * person confirmed (its digest) is removed, and the discarded-files folders (people's own files)
 * only with their own yes, and (DR-44 (a)) the records of runs not reverted only with theirs.
 * U-13 (UXM-1): an apply run's records stay while its discarded files stay.
 * Real runs through the app (scripted model), the real store. Fake values only.
 */

import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { DISCARDED_DIR_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, CleanupApplied, CleanupPreview, CodarynApp, StateSummaryView } from "../../../src/app/index.js";
import { appEnvironment, exists, setupRun, taskForm, taskRequest } from "./support.js";

const DISCARD_TASK = {
  workflowRef: "organize",
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["discard"] },
  verifiers: [],
};

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}
const code = (outcome: AppCallOutcome<unknown>): string | null => (outcome.ok ? null : outcome.error.code);

/** A plan run that discards c.log, applied through the app: the apply run has a discarded-files folder. */
async function appliedDiscard(): Promise<{ base: string; workspace: string; app: CodarynApp; planRunId: string; applyRunId: string }> {
  const base = await setupRun({ "c.log": "old log\n" }, DISCARD_TASK, [
    { toolCalls: [{ name: "propose_plan", args: { summary: "drop the log", actions: [{ kind: "discard", path: "c.log" }] } }] },
  ]);
  const app = createCodarynApp(await appEnvironment(base));
  const planned = await app.startRun(taskRequest(base));
  assert.ok(planned.ok, JSON.stringify(planned));
  const plan = await planned.handle.done;
  assert.ok(plan.ok && plan.result.plan !== undefined, JSON.stringify(plan));
  const applied = await app.applyPlan({ settings: taskForm(base), planRunId: plan.result.runId, digest: plan.result.plan.digest, cancelFile: null, unsafeMoveConsent: null });
  assert.ok(applied.ok, JSON.stringify(applied));
  const done = await applied.handle.done;
  assert.ok(done.ok, JSON.stringify(done));
  return { base, workspace: path.join(base, "work"), app, planRunId: plan.result.runId, applyRunId: applied.handle.runId };
}

/** "run <id>", "discarded <id>" or "leftover <id>" (DR-44 (d): a leftover folder has no run id). */
const refOf = (item: { readonly target: string; readonly runId?: string; readonly leftoverId?: string }): string => `${item.target} ${item.runId ?? item.leftoverId}`;
const runsIn = async (workspace: string): Promise<string[]> => (await readdir(path.join(workspace, STATE_DIR_NAME, RUNS_DIR_NAME))).sort();
const discardedOf = (workspace: string, runId: string): string => path.join(workspace, STATE_DIR_NAME, DISCARDED_DIR_NAME, runId);

describe("DR-39: the app layer's state summary and cleanup", () => {
  test("the summary names runs by id with their sizes, the discarded files and the parked files", async () => {
    const { workspace, app, planRunId, applyRunId } = await appliedDiscard();
    const view = ok<StateSummaryView>(await app.stateSummary({ workspace }));
    assert.equal(view.kind, "state_summary");
    assert.equal(view.summary.runs.count, 2);
    assert.deepEqual(view.summary.entries.map((entry) => entry.runId).sort(), [planRunId, applyRunId].sort());
    assert.deepEqual([view.summary.discarded.runs, view.summary.discarded.files], [1, 1]);
    assert.equal(JSON.stringify(view).includes("c.log"), false, "no file name of the person's");
  });

  test("a preview removes nothing; the apply removes only the confirmed run records; the discarded folder needs its own yes", async () => {
    const { workspace, app, planRunId, applyRunId } = await appliedDiscard();
    const selection = { runs: { runIds: [planRunId, applyRunId] }, discarded: { runIds: [applyRunId] } };
    const preview = ok<CleanupPreview>(await app.previewCleanup({ workspace, selection }));
    assert.equal(preview.kind, "cleanup_preview");
    assert.match(preview.plan.digest, /^[0-9a-f]{64}$/);
    assert.deepEqual(preview.plan.items.map(refOf).sort(), [`discarded ${applyRunId}`, `run ${applyRunId}`, `run ${planRunId}`].sort());
    assert.ok(preview.plan.items.find((item) => item.target === "discarded")?.warnings.includes("people_files"));
    assert.deepEqual(await runsIn(workspace), [planRunId, applyRunId].sort(), "the preview removed nothing");

    const applied = ok<CleanupApplied>(
      await app.applyCleanup({ workspace, selection, now: preview.now, confirmation: { digest: preview.plan.digest, discarded: false, includeNotReverted: true } }),
    );
    // DR-48 (U-22): nothing removed, so the cleanup says so and its outcome is not ok.
    assert.equal(applied.status, "nothing_removed", JSON.stringify(applied));
    assert.equal(applied.outcome.ok, false);
    // U-13 (UXM-1): the apply run's records stay while its discarded files stay, and so does its plan run.
    assert.deepEqual(applied.outcome.removed, []);
    assert.deepEqual(
      applied.outcome.kept.map((item) => `${refOf(item)} ${item.reason}`).sort(),
      [`discarded ${applyRunId} not_confirmed`, `run ${applyRunId} discarded_left`, `run ${planRunId} used_by_kept_apply`].sort(),
    );
    assert.deepEqual(await runsIn(workspace), [planRunId, applyRunId].sort());
    assert.equal(await exists(discardedOf(workspace, applyRunId)), true, "people's files stay without their own yes");
    // The discarded file stays with what names it: its content in the folder, and the records that say
    // it was c.log, so a revert still moves it back there (a dry run, nothing changed).
    const held = await readdir(discardedOf(workspace, applyRunId));
    assert.equal(held.length, 1, JSON.stringify(held));
    assert.equal(await readFile(path.join(discardedOf(workspace, applyRunId), held[0] ?? ""), "utf8"), "old log\n");
    const wouldRevert = await app.revert({ workspace, runId: applyRunId, dryRun: true });
    assert.ok(wouldRevert.ok, JSON.stringify(wouldRevert));
    assert.deepEqual(
      wouldRevert.output.reverted.map((file) => [file.path, file.action]),
      [["c.log", "restored_from_discard"]],
      "the records still name the file and where it belongs",
    );
    assert.equal(await exists(path.join(workspace, "c.log")), false, "the dry run changed nothing");

    const again = ok<CleanupPreview>(await app.previewCleanup({ workspace, selection: { discarded: { runIds: [applyRunId] } } }));
    const removed = ok<CleanupApplied>(
      await app.applyCleanup({ workspace, selection: { discarded: { runIds: [applyRunId] } }, now: again.now, confirmation: { digest: again.plan.digest, discarded: true, includeNotReverted: false } }),
    );
    assert.ok(removed.status === "removed" && removed.outcome.ok && removed.outcome.removed.length === 1, JSON.stringify(removed));
    assert.equal(await exists(discardedOf(workspace, applyRunId)), false);
  });

  test("a digest the person did not see, or a plan that changed after the preview, removes nothing: the error cleanup_plan_changed", async () => {
    const { workspace, app, planRunId } = await appliedDiscard();
    const selection = { runs: { olderThanDays: 0 } };
    const preview = ok<CleanupPreview>(await app.previewCleanup({ workspace, selection }));
    // DR-48 (U-22): a call error, not a cleanup outcome.
    const forged = await app.applyCleanup({ workspace, selection, now: preview.now, confirmation: { digest: "0".repeat(64), discarded: true, includeNotReverted: true } });
    assert.equal(code(forged), "cleanup_plan_changed", JSON.stringify(forged));
    // A file appears in a selected run after the preview: its fingerprint changes.
    await writeFile(path.join(workspace, STATE_DIR_NAME, RUNS_DIR_NAME, planRunId, "late.txt"), "x", "utf8");
    const stale = await app.applyCleanup({ workspace, selection, now: preview.now, confirmation: { digest: preview.plan.digest, discarded: false, includeNotReverted: true } });
    assert.equal(code(stale), "cleanup_plan_changed", JSON.stringify(stale));
    assert.equal((await runsIn(workspace)).length, 2, "nothing was removed");
  });

  test("arguments are checked before anything is read", async () => {
    const { workspace, app } = await appliedDiscard();
    const bad: unknown[] = [
      { runs: { runIds: ["../outside"] } },
      { runs: { olderThanDays: -1 } },
      { runs: { olderThanDays: 1.5 } },
      { runs: { reverted: false } },
      { runs: { everything: true } },
      { other: {} },
    ];
    for (const selection of bad) {
      assert.equal(code(await app.previewCleanup({ workspace, selection: selection as never })), "invalid_arguments", JSON.stringify(selection));
    }
    const selection = { runs: { olderThanDays: 0 } };
    assert.equal(code(await app.applyCleanup({ workspace, selection, now: "yesterday", confirmation: { digest: "0".repeat(64), discarded: false, includeNotReverted: false } })), "invalid_arguments");
    assert.equal(code(await app.applyCleanup({ workspace, selection, now: "2026-11-12T00:00:00Z", confirmation: { digest: "abc", discarded: false, includeNotReverted: false } })), "invalid_arguments");
    assert.equal(code(await app.applyCleanup({ workspace, selection, now: "2026-11-12T00:00:00Z", confirmation: { digest: "0".repeat(64), discarded: "yes" as never, includeNotReverted: false } })), "invalid_arguments");
    // DR-44 (a): the runs not reverted are asked apart; leaving the answer out is no yes.
    assert.equal(code(await app.applyCleanup({ workspace, selection, now: "2026-11-12T00:00:00Z", confirmation: { digest: "0".repeat(64), discarded: false } as never })), "invalid_arguments");
    assert.equal(code(await app.applyCleanup({ workspace, selection, now: "2026-11-12T00:00:00Z", confirmation: { digest: "0".repeat(64), discarded: false, includeNotReverted: "yes" as never } })), "invalid_arguments");
    assert.equal(code(await app.stateSummary({ workspace: path.join(workspace, "missing") })), "workspace_not_found");
    assert.equal((await runsIn(workspace)).length, 2);
  });
});
