/**
 * U-22 (DR-48, AXM-3, AXM-8): the two places where the JSON may break. The cleanup command's output
 * says what happened (nothing removed is not ok; a wrong digest is an error), and `--run latest`
 * while the only unfinished run is still going says so instead of "no run".
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CLEANUP_EXIT_CODES,
  CLEANUP_PROBLEM_KEPT_REASONS,
  CLEANUP_STATUSES,
  CLI_ERROR_EXIT_CODES,
  cleanupStatusOf,
  FIXED_MESSAGES,
  MESSAGE_IDS,
  toRunId,
} from "../../../src/contracts/index.js";
import type { CleanupOutcome, CleanupOutput, CleanupPlan, RunId } from "../../../src/contracts/index.js";

const runId = toRunId("20261112T120000Z-0000abcd") as RunId;
const totals: CleanupPlan["totals"] = {
  runs: { count: 0, notReverted: 0, files: 0, bytes: 0 },
  discarded: { count: 0, files: 0, bytes: 0 },
  leftovers: { count: 0, files: 0, bytes: 0 },
};
const done = (removed: number, reasons: readonly Extract<CleanupOutcome, { ok: true }>["kept"][number]["reason"][]): Extract<CleanupOutcome, { ok: true }> => ({
  ok: true,
  removed: Array.from({ length: removed }, () => ({ target: "run" as const, runId, size: { files: 1, bytes: 1 } })),
  kept: reasons.map((reason) => ({ target: "run" as const, runId, reason })),
  totals,
});

describe("U-22: the cleanup command's JSON says what happened", () => {
  test("statuses, exit codes and the kept reasons that are problems", () => {
    assert.deepEqual([...CLEANUP_STATUSES], ["preview", "removed", "nothing_removed", "partly_failed"]);
    assert.deepEqual(CLEANUP_EXIT_CODES, { preview: 0, removed: 0, nothing_removed: 3, partly_failed: 1 });
    assert.deepEqual([...CLEANUP_PROBLEM_KEPT_REASONS], ["changed", "not_plain_directory", "io_error", "partly_removed"]);
  });

  test("AXM-3: nothing removed because a file was open is partly_failed, not ok", () => {
    assert.equal(cleanupStatusOf(done(0, ["io_error"])), "partly_failed");
    const output: CleanupOutput = { schemaVersion: 1, kind: "cleanup", status: "partly_failed", exitCode: 1, outcome: { ...done(0, ["io_error"]), ok: false } };
    assert.equal(output.status === "partly_failed" && output.outcome.ok, false);
  });

  test("AXM-3: confirmed without --include-not-reverted, nothing removed: nothing_removed, not ok", () => {
    assert.equal(cleanupStatusOf(done(0, ["not_reverted_not_confirmed"])), "nothing_removed");
    assert.equal(cleanupStatusOf(done(0, [])), "nothing_removed", "an empty plan confirmed removes nothing");
  });

  test("something removed and the rest kept by choice is removed; a problem beside it is partly_failed", () => {
    assert.equal(cleanupStatusOf(done(1, ["not_confirmed", "not_reverted_not_confirmed", "used_by_kept_apply"])), "removed");
    assert.equal(cleanupStatusOf(done(2, ["partly_removed"])), "partly_failed");
  });

  test("AXM-3: a wrong digest is an error; the old line for it is gone", () => {
    assert.equal(CLI_ERROR_EXIT_CODES.cleanup_plan_changed, 2);
    for (const id of ["error.cleanup_plan_changed.what", "error.cleanup_plan_changed.fix"]) assert.ok((MESSAGE_IDS as readonly string[]).includes(id), id);
    assert.equal(Object.hasOwn(FIXED_MESSAGES, "cleanup.plan_changed"), false);
  });
});

describe("U-22: --run latest while the run is still going", () => {
  test("AXM-8: run_in_progress, in the try-again family as workspace_locked", () => {
    assert.equal(CLI_ERROR_EXIT_CODES.run_in_progress, 6);
    assert.equal(CLI_ERROR_EXIT_CODES.run_in_progress, CLI_ERROR_EXIT_CODES.workspace_locked);
    for (const id of ["error.run_in_progress.what", "error.run_in_progress.fix"]) assert.ok((MESSAGE_IDS as readonly string[]).includes(id), id);
  });
});
