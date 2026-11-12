/**
 * DR-39 for the GUI (standalone-gui 3.8, GU-4): the app layer gives the store's summary, cleanup
 * plan and cleanup. What would be removed comes first (a preview, nothing removed); only a plan the
 * person confirmed (its digest) is removed, and the discarded-files folders (people's own files)
 * only with their own yes. Real runs through the app (scripted model), the real store. Fake values only.
 */

import assert from "node:assert/strict";
import { readdir, writeFile } from "node:fs/promises";
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
    assert.deepEqual(preview.plan.items.map((item) => `${item.target} ${item.runId}`).sort(), [`discarded ${applyRunId}`, `run ${applyRunId}`, `run ${planRunId}`].sort());
    assert.ok(preview.plan.items.find((item) => item.target === "discarded")?.warnings.includes("people_files"));
    assert.deepEqual(await runsIn(workspace), [planRunId, applyRunId].sort(), "the preview removed nothing");

    const applied = ok<CleanupApplied>(
      await app.applyCleanup({ workspace, selection, now: preview.now, confirmation: { digest: preview.plan.digest, discarded: false } }),
    );
    assert.ok(applied.outcome.ok, JSON.stringify(applied.outcome));
    assert.deepEqual(applied.outcome.removed.map((item) => `${item.target} ${item.runId}`).sort(), [`run ${applyRunId}`, `run ${planRunId}`].sort());
    assert.deepEqual(applied.outcome.kept, [{ target: "discarded", runId: applyRunId, reason: "not_confirmed" }]);
    assert.deepEqual(await runsIn(workspace), []);
    assert.equal(await exists(discardedOf(workspace, applyRunId)), true, "people's files stay without their own yes");

    const again = ok<CleanupPreview>(await app.previewCleanup({ workspace, selection: { discarded: { runIds: [applyRunId] } } }));
    const removed = ok<CleanupApplied>(
      await app.applyCleanup({ workspace, selection: { discarded: { runIds: [applyRunId] } }, now: again.now, confirmation: { digest: again.plan.digest, discarded: true } }),
    );
    assert.ok(removed.outcome.ok && removed.outcome.removed.length === 1, JSON.stringify(removed.outcome));
    assert.equal(await exists(discardedOf(workspace, applyRunId)), false);
  });

  test("a digest the person did not see, or a plan that changed after the preview, removes nothing", async () => {
    const { workspace, app, planRunId } = await appliedDiscard();
    const selection = { runs: { olderThanDays: 0 } };
    const preview = ok<CleanupPreview>(await app.previewCleanup({ workspace, selection }));
    const forged = ok<CleanupApplied>(await app.applyCleanup({ workspace, selection, now: preview.now, confirmation: { digest: "0".repeat(64), discarded: true } }));
    assert.deepEqual(forged.outcome, { ok: false, code: "plan_changed" });
    // A file appears in a selected run after the preview: its fingerprint changes.
    await writeFile(path.join(workspace, STATE_DIR_NAME, RUNS_DIR_NAME, planRunId, "late.txt"), "x", "utf8");
    const stale = ok<CleanupApplied>(await app.applyCleanup({ workspace, selection, now: preview.now, confirmation: { digest: preview.plan.digest, discarded: false } }));
    assert.deepEqual(stale.outcome, { ok: false, code: "plan_changed" });
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
    assert.equal(code(await app.applyCleanup({ workspace, selection, now: "yesterday", confirmation: { digest: "0".repeat(64), discarded: false } })), "invalid_arguments");
    assert.equal(code(await app.applyCleanup({ workspace, selection, now: "2026-11-12T00:00:00Z", confirmation: { digest: "abc", discarded: false } })), "invalid_arguments");
    assert.equal(code(await app.applyCleanup({ workspace, selection, now: "2026-11-12T00:00:00Z", confirmation: { digest: "0".repeat(64), discarded: "yes" as never } })), "invalid_arguments");
    assert.equal(code(await app.stateSummary({ workspace: path.join(workspace, "missing") })), "workspace_not_found");
    assert.equal((await runsIn(workspace)).length, 2);
  });
});
