/**
 * DR-39: the contract of seeing and cleaning up the state directory (cleanup.ts), after the store
 * owner's design and the PM's answers P-4 (one command, two confirmations) and P-5 (a marked run is
 * warned about, not blocked).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CLEANUP_BLOCK_CODES,
  CLEANUP_FAILURE_CODES,
  CLEANUP_KEPT_REASONS,
  CLEANUP_LOG_FILE_NAME,
  CLEANUP_WARNING_CODES,
  FIXED_MESSAGES,
  MESSAGE_IDS,
  toRunId,
} from "../../../src/contracts/index.js";
import type { CleanupConfirmation, CleanupLogLine, CleanupOutcome, CleanupPlan, ContentHash, PlanCleanup, RunId, StateSummary } from "../../../src/contracts/index.js";

const runId = toRunId("20261112T120000Z-0000abcd") as RunId;
const digest = "a".repeat(64) as ContentHash;

describe("DR-39: cleaning up run records and discarded files", () => {
  test("the codes", () => {
    assert.deepEqual([...CLEANUP_BLOCK_CODES], ["lock_held", "no_result", "plan_used_by_apply"]);
    assert.deepEqual([...CLEANUP_WARNING_CODES], ["not_reverted", "discarded_left", "people_files", "records_changed"]);
    assert.deepEqual([...CLEANUP_KEPT_REASONS], ["not_confirmed", "changed", "not_plain_directory", "io_error"]);
    assert.deepEqual([...CLEANUP_FAILURE_CODES], ["plan_changed", "workspace_locked"]);
  });

  test("a summary, a plan with both targets, two confirmations, an outcome and its log line", async () => {
    const summary: StateSummary = {
      runs: { count: 1, bytes: 2048, oldest: "2026-11-12T12:00:00Z", newest: "2026-11-12T12:00:00Z" },
      entries: [{ runId, kind: "apply", status: "done", startedAt: "2026-11-12T12:00:00Z", records: { files: 4, bytes: 2048 }, reverted: false, discarded: { files: 2, bytes: 900 }, recordsChanged: true }],
      discarded: { runs: 1, files: 2, bytes: 900 },
      parked: { files: 1, bytes: 10 },
    };
    const plan: CleanupPlan = {
      items: [
        { target: "run", runId, size: { files: 4, bytes: 2048 }, warnings: ["not_reverted", "discarded_left", "records_changed"] },
        { target: "discarded", runId, size: { files: 2, bytes: 900 }, warnings: ["people_files"] },
      ],
      blocked: [],
      totals: { runs: { count: 1, files: 4, bytes: 2048 }, discarded: { count: 1, files: 2, bytes: 900 } },
      parked: summary.parked,
      digest,
    };
    const planCleanup: PlanCleanup = async () => plan;
    const planned = await planCleanup({ workspaceRoot: "/work", selection: { runs: { runIds: [runId] }, discarded: { runIds: [runId] } }, now: "2026-11-13T00:00:00Z" });
    const recordsOnly: CleanupConfirmation = { digest: planned.digest, discarded: false };
    const outcome: CleanupOutcome = {
      ok: true,
      removed: [{ target: "run", runId, size: { files: 4, bytes: 2048 } }],
      kept: [{ target: "discarded", runId, reason: "not_confirmed" }],
      totals: planned.totals,
    };
    const line: CleanupLogLine = { schemaVersion: 1, at: "2026-11-13T00:00:00Z", runs: { count: 1, files: 4, bytes: 2048 }, discarded: { count: 0, files: 0, bytes: 0 } };
    assert.equal(JSON.stringify(line).includes(runId), false, "the log holds counts and sizes only");
    assert.equal(CLEANUP_LOG_FILE_NAME, "cleanup.jsonl");
    assert.ok(recordsOnly && outcome.ok);
  });

  test("message ids: the fixed texts and one per code", () => {
    assert.deepEqual(FIXED_MESSAGES["cleanup.confirm.discarded"], { files: "count", bytes: "count" });
    assert.deepEqual(FIXED_MESSAGES["cleanup.summary.parked"], { files: "count", bytes: "count" });
    const ids = MESSAGE_IDS as readonly string[];
    for (const code of CLEANUP_BLOCK_CODES) assert.ok(ids.includes(`cleanup.blocked.${code}`), code);
    for (const code of CLEANUP_WARNING_CODES) assert.ok(ids.includes(`cleanup.warning.${code}`), code);
    for (const reason of CLEANUP_KEPT_REASONS) assert.ok(ids.includes(`cleanup.kept.${reason}`), reason);
  });
});
