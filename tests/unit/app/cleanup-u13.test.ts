/**
 * Unit U-13 (UXM-1 of the usability midpoint review, completing DR-44) through the app layer, the
 * GUI's path. An apply run whose discarded-files folder still holds files keeps its records unless
 * that folder's removal is confirmed too: it is skipped, the rest is removed, and the outcome says
 * why item by item (kept: discarded_left). Until U-13 the records went with a warning only, and the
 * discarded file stayed under a numbered name with nothing left to say what it was.
 * Reproduced first (2c8753d, todo); the contract (96c6ca9) and the store (f3ec04b, 3837677) follow it
 * now, and the app layer passes the store's outcome on as it is. UXM-1's steps: a plan applied and never reverted, then
 * `cleanup --older-than 0 --discarded-older-than 0 --confirm <digest> --include-not-reverted`
 * without `--delete-discarded`, here the app's selection and confirmation of the same.
 * Real runs through the app (scripted model), the real store. Fake values only.
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { DISCARDED_DIR_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, CleanupApplied, CleanupPreview, CodarynApp } from "../../../src/app/index.js";
import { appEnvironment, exists, setupRun, taskForm, taskRequest } from "./support.js";

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

const ORGANIZE = { workflowRef: "organize", policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["discard"] }, verifiers: [] };
const discardPlan = (file: string): unknown => ({ toolCalls: [{ name: "propose_plan", args: { summary: `drop ${file}`, actions: [{ kind: "discard", path: file }] } }] });

interface Applied {
  readonly base: string;
  readonly workspace: string;
  readonly app: CodarynApp;
  readonly planRunId: string;
  readonly applyRunId: string;
  /** A second plan run, never applied (changed nothing), when asked for. */
  readonly otherRunId: string | null;
}

/** UXM-1's workspace: a plan that discards c.log, applied and never reverted; and, if asked, another plan run. */
async function appliedNotReverted(withOther: boolean): Promise<Applied> {
  const base = await setupRun({ "c.log": "old log\n", "e.log": "other log\n" }, ORGANIZE, withOther ? [discardPlan("c.log"), discardPlan("e.log")] : [discardPlan("c.log")]);
  const app = createCodarynApp(await appEnvironment(base));
  const planned = await app.startRun(taskRequest(base));
  assert.ok(planned.ok, JSON.stringify(planned));
  const plan = await planned.handle.done;
  assert.ok(plan.ok && plan.result.plan !== undefined, JSON.stringify(plan));
  const applied = await app.applyPlan({ settings: taskForm(base), planRunId: plan.result.runId, digest: plan.result.plan.digest, cancelFile: null, unsafeMoveConsent: null });
  assert.ok(applied.ok, JSON.stringify(applied));
  await applied.handle.done;
  let otherRunId: string | null = null;
  if (withOther) {
    const other = await app.startRun(taskRequest(base));
    assert.ok(other.ok, JSON.stringify(other));
    await other.handle.done;
    otherRunId = other.handle.runId;
  }
  const workspace = path.join(base, "work");
  assert.equal(await exists(path.join(workspace, "c.log")), false, "the apply moved c.log into its discarded-files folder");
  return { base, workspace, app, planRunId: plan.result.runId, applyRunId: applied.handle.runId, otherRunId };
}

const runDirOf = (workspace: string, runId: string): string => path.join(workspace, STATE_DIR_NAME, RUNS_DIR_NAME, runId);
const discardedDirOf = (workspace: string, runId: string): string => path.join(workspace, STATE_DIR_NAME, DISCARDED_DIR_NAME, runId);
const sorted = (items: readonly unknown[]): string[] => items.map((item) => JSON.stringify(item)).sort();

/** Previews the selection and applies it with the given confirmation of the discarded folders, includeNotReverted given. */
async function cleanup(run: Applied, selection: Readonly<Record<string, unknown>>, discarded: boolean): Promise<CleanupApplied> {
  const preview = ok<CleanupPreview>(await run.app.previewCleanup({ workspace: run.workspace, selection }));
  return ok<CleanupApplied>(
    await run.app.applyCleanup({ workspace: run.workspace, selection, now: preview.now, confirmation: { digest: preview.plan.digest, discarded, includeNotReverted: true } }),
  );
}

/** The discarded c.log is still put back by a revert of the apply run: its records are there. */
async function stillRevertable(run: Applied): Promise<void> {
  assert.equal(await exists(runDirOf(run.workspace, run.applyRunId)), true, "the apply run's records stay");
  assert.equal(await exists(runDirOf(run.workspace, run.planRunId)), true, "the plan run it uses stays");
  assert.ok((await readdir(discardedDirOf(run.workspace, run.applyRunId))).length > 0, "the discarded file stays in its folder");
  const reverted = await run.app.revert({ workspace: run.workspace, runId: run.applyRunId });
  assert.ok(reverted.ok, JSON.stringify(reverted));
  assert.equal(await readFile(path.join(run.workspace, "c.log"), "utf8"), "old log\n", "a revert puts c.log back");
}

describe("U-13 (UXM-1): an apply run's records stay while its discarded files stay", () => {
  test("UXM-1's steps: both folders selected, runs not reverted confirmed, the discarded folders not: the apply run is skipped, the rest removed", async () => {
    const run = await appliedNotReverted(true);
    const applied = await cleanup(run, { runs: { olderThanDays: 0 }, discarded: { olderThanDays: 0 } }, false);
    assert.ok(applied.status === "removed" && applied.outcome.ok, JSON.stringify(applied));
    assert.deepEqual(
      sorted(applied.outcome.kept),
      sorted([
        { target: "run", runId: run.applyRunId, reason: "discarded_left" },
        { target: "run", runId: run.planRunId, reason: "used_by_kept_apply" },
        { target: "discarded", runId: run.applyRunId, reason: "not_confirmed" },
      ]),
      "each skipped item says why",
    );
    assert.deepEqual(
      applied.outcome.removed.map((item) => [item.target, "runId" in item ? item.runId : null]),
      [["run", run.otherRunId]],
      "the rest is removed",
    );
    assert.equal(await exists(runDirOf(run.workspace, run.otherRunId ?? "")), false);
    await stillRevertable(run);
  });

  test("runs only selected (the discarded folder cannot be confirmed): the apply run is skipped as discarded_left", async () => {
    const run = await appliedNotReverted(false);
    const applied = await cleanup(run, { runs: { olderThanDays: 0 } }, true);
    // DR-48 (U-22): nothing removed, so the cleanup says so and its outcome is not ok.
    assert.equal(applied.status, "nothing_removed", JSON.stringify(applied));
    assert.equal(applied.outcome.ok, false);
    assert.deepEqual(
      sorted(applied.outcome.kept),
      sorted([
        { target: "run", runId: run.applyRunId, reason: "discarded_left" },
        { target: "run", runId: run.planRunId, reason: "used_by_kept_apply" },
      ]),
    );
    assert.deepEqual(applied.outcome.removed, []);
    await stillRevertable(run);
  });

  test("the discarded folder's removal confirmed too: the apply run's records go with it", async () => {
    const run = await appliedNotReverted(false);
    const applied = await cleanup(run, { runs: { olderThanDays: 0 }, discarded: { olderThanDays: 0 } }, true);
    assert.ok(applied.status === "removed" && applied.outcome.ok, JSON.stringify(applied));
    assert.deepEqual(applied.outcome.kept, []);
    assert.deepEqual(
      sorted(applied.outcome.removed.map((item) => [item.target, "runId" in item ? item.runId : null])),
      sorted([
        ["run", run.applyRunId],
        ["run", run.planRunId],
        ["discarded", run.applyRunId],
      ]),
    );
    assert.equal(await exists(discardedDirOf(run.workspace, run.applyRunId)), false);
    assert.equal(await exists(runDirOf(run.workspace, run.applyRunId)), false);
  });
});
