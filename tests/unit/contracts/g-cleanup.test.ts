/**
 * DR-39: the contract of seeing and cleaning up the state directory (cleanup.ts), after the store
 * owner's design and the PM's answers P-4 (one command, two confirmations) and P-5 (a marked run is
 * warned about, not blocked). DR-44 (R-34): not reverted runs need their own confirmation, a partly
 * reverted run is not a reverted one, an apply's discarded files that could stay are warned about,
 * and what could not be removed entirely is never reported as removed and shows in the next plan.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CLEANUP_BLOCK_CODES,
  CLEANUP_FAILURE_CODES,
  CLEANUP_KEPT_REASONS,
  CLEANUP_LEFTOVER_MARK_FILE_NAME,
  CLEANUP_LEFTOVER_PATTERN_SOURCE,
  CLEANUP_LOG_FILE_NAME,
  CLEANUP_WARNING_CODES,
  cleanupRecordWarnings,
  FIXED_MESSAGES,
  isCleanupLeftoverMark,
  MESSAGE_IDS,
  needsNotRevertedConfirmation,
  NOT_REVERTED_WARNINGS,
  selectedAsReverted,
  toRunId,
} from "../../../src/contracts/index.js";
import type {
  CleanupConfirmation,
  CleanupLeftoverMark,
  CleanupLogLine,
  CleanupOutcome,
  CleanupPlan,
  ContentHash,
  LastRevert,
  PlanCleanup,
  RunId,
  StateSummary,
} from "../../../src/contracts/index.js";

const runId = toRunId("20261112T120000Z-0000abcd") as RunId;
const digest = "a".repeat(64) as ContentHash;
const emptyTotals: CleanupPlan["totals"] = {
  runs: { count: 0, notReverted: 0, files: 0, bytes: 0 },
  discarded: { count: 0, files: 0, bytes: 0 },
  leftovers: { count: 0, files: 0, bytes: 0 },
};

describe("DR-39: cleaning up run records and discarded files", () => {
  test("the codes", () => {
    assert.deepEqual([...CLEANUP_BLOCK_CODES], ["lock_held", "no_result", "plan_used_by_apply"]);
    assert.deepEqual([...CLEANUP_WARNING_CODES], ["not_reverted", "partly_reverted", "records_unreadable", "discarded_left", "people_files", "records_changed", "leftover"]);
    assert.deepEqual([...CLEANUP_KEPT_REASONS], [
      "not_confirmed",
      "not_reverted_not_confirmed",
      "discarded_left",
      "used_by_kept_apply",
      "changed",
      "not_plain_directory",
      "io_error",
      "partly_removed",
    ]);
    assert.deepEqual([...CLEANUP_FAILURE_CODES], ["plan_changed", "workspace_locked"]);
  });

  test("a summary, a plan with both targets, two confirmations, an outcome and its log line", async () => {
    const summary: StateSummary = {
      runs: { count: 1, bytes: 2048, oldest: "2026-11-12T12:00:00Z", newest: "2026-11-12T12:00:00Z" },
      entries: [
        { runId, kind: "apply", status: "done", startedAt: "2026-11-12T12:00:00Z", records: { files: 4, bytes: 2048 }, reverted: false, partlyReverted: false, discarded: { files: 2, bytes: 900 }, recordsChanged: true },
      ],
      discarded: { runs: 1, files: 2, bytes: 900 },
      parked: { files: 1, bytes: 10 },
      leftovers: { count: 0, files: 0, bytes: 0 },
    };
    const plan: CleanupPlan = {
      items: [
        { target: "run", runId, size: { files: 4, bytes: 2048 }, warnings: ["not_reverted", "discarded_left", "records_changed"] },
        { target: "discarded", runId, size: { files: 2, bytes: 900 }, warnings: ["people_files"] },
      ],
      blocked: [],
      totals: { runs: { count: 1, notReverted: 1, files: 4, bytes: 2048 }, discarded: { count: 1, files: 2, bytes: 900 }, leftovers: { count: 0, files: 0, bytes: 0 } },
      parked: summary.parked,
      digest,
    };
    const planCleanup: PlanCleanup = async () => plan;
    const planned = await planCleanup({ workspaceRoot: "/work", selection: { runs: { runIds: [runId] }, discarded: { runIds: [runId] } }, now: "2026-11-13T00:00:00Z" });
    const recordsOnly: CleanupConfirmation = { digest: planned.digest, discarded: false, includeNotReverted: true };
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

describe("DR-44 (R-34): what a person sees is what happens, and no way back is lost untold", () => {
  const run = (lastRevert: LastRevert, more: Partial<Parameters<typeof cleanupRecordWarnings>[0]> = {}) =>
    cleanupRecordWarnings({ kind: "run", changes: 2, lastRevert, hasDiscarded: false, recordsChanged: false, ...more });

  test("(b) L-1: a partly reverted run is not a reverted one: its own warning, and --reverted does not select it", () => {
    // R-34 e1b: r3 wrote c.txt and d.txt; d.txt was changed by a person, so the revert was partial.
    assert.deepEqual(run("partial"), ["partly_reverted"]);
    assert.deepEqual(run(null), ["not_reverted"]);
    assert.deepEqual(run("complete"), []);
    assert.deepEqual([selectedAsReverted("complete"), selectedAsReverted("partial"), selectedAsReverted(null)], [true, false, false]);
    assert.deepEqual(run(null, { changes: 0 }), [], "a run that changed nothing has nothing to revert");
  });

  test("(a) not reverted and partly reverted records go only with their own confirmation", () => {
    assert.deepEqual([...NOT_REVERTED_WARNINGS], ["not_reverted", "partly_reverted", "records_unreadable"]);
    assert.equal(needsNotRevertedConfirmation(run(null)), true);
    assert.equal(needsNotRevertedConfirmation(run("partial")), true);
    assert.equal(needsNotRevertedConfirmation(run("complete", { recordsChanged: true })), false);
    const confirmation: CleanupConfirmation = { digest, discarded: true, includeNotReverted: false };
    const kept: CleanupOutcome = { ok: true, removed: [], kept: [{ target: "run", runId, reason: "not_reverted_not_confirmed" }], totals: emptyTotals };
    assert.ok(confirmation && kept.ok);
    // The confirmation header says how many of the run records are such runs.
    assert.deepEqual(FIXED_MESSAGES["cleanup.confirm.not_reverted"], { count: "count" });
  });

  test("(a) a plan run whose apply run is kept is kept too, or that apply could no longer be reverted", () => {
    const planRun = toRunId("20261112T110000Z-0000aaaa") as RunId;
    const outcome: CleanupOutcome = {
      ok: true,
      removed: [],
      kept: [
        { target: "run", runId, reason: "not_reverted_not_confirmed" },
        { target: "run", runId: planRun, reason: "used_by_kept_apply" },
      ],
      totals: emptyTotals,
    };
    assert.ok(outcome.ok);
  });

  test("(c) L-2: an apply run's records are warned about whenever its discarded files could stay", () => {
    // R-34 e2/e9: the folder selected too, confirmed without the discarded files: the files stay and
    // the apply can no longer put them back. The warning does not depend on the selection.
    const apply = (lastRevert: LastRevert) => cleanupRecordWarnings({ kind: "apply", changes: 1, lastRevert, hasDiscarded: true, recordsChanged: false });
    assert.deepEqual(apply(null), ["not_reverted", "discarded_left"]);
    assert.deepEqual(apply("complete"), ["discarded_left"]);
    assert.deepEqual(cleanupRecordWarnings({ kind: "run", changes: 1, lastRevert: "complete", hasDiscarded: true, recordsChanged: true }), ["records_changed"]);
  });

  test("(d) L-3: a folder not removed entirely is kept as partly_removed, not logged, and the next plan shows it", () => {
    const leftover = new RegExp(CLEANUP_LEFTOVER_PATTERN_SOURCE, "u");
    assert.ok(leftover.test("cleanup-0123456789abcdef"));
    for (const name of ["cleanup-01234567", "cleanup-0123456789ABCDEF", "cleanup.jsonl", "x-cleanup-0123456789abcdef", "cleanup-0123456789abcdef0"]) {
      assert.equal(leftover.test(name), false, name);
    }
    // E7a: a file in the run's records could not be deleted after the move aside.
    const applied: CleanupOutcome = { ok: true, removed: [], kept: [{ target: "run", runId, reason: "partly_removed" }], totals: emptyTotals };
    const line: CleanupLogLine = { schemaVersion: 1, at: "2026-11-13T00:00:00Z", runs: { count: 0, files: 0, bytes: 0 }, discarded: { count: 0, files: 0, bytes: 0 } };
    assert.ok(applied.ok && line.runs.count === 0);
    const next: CleanupPlan = {
      items: [{ target: "leftover", leftoverId: "0123456789abcdef", size: { files: 1, bytes: 120 }, warnings: ["leftover"] }],
      blocked: [],
      totals: { ...emptyTotals, leftovers: { count: 1, files: 1, bytes: 120 } },
      parked: { files: 0, bytes: 0 },
      digest,
    };
    const removed: CleanupOutcome = { ok: true, removed: [{ target: "leftover", leftoverId: "0123456789abcdef", size: { files: 1, bytes: 120 } }], kept: [], totals: next.totals };
    const logged: CleanupLogLine = { ...line, leftovers: { count: 1, files: 1, bytes: 120 } };
    const summary: Pick<StateSummary, "leftovers"> = { leftovers: { count: 1, files: 1, bytes: 120 } };
    assert.ok(removed.ok && logged.leftovers?.count === 1 && summary.leftovers.count === 1);
    assert.deepEqual(FIXED_MESSAGES["cleanup.summary.leftovers"], { count: "count", bytes: "count" });
    assert.deepEqual(FIXED_MESSAGES["cleanup.confirm.leftovers"], { count: "count", bytes: "count" });
    assert.deepEqual(FIXED_MESSAGES["cleanup.done_leftovers"], { count: "count", bytes: "count" });
  });
});

describe("R-34b: damaged records, folders a cleanup did not leave", () => {
  test("P-1 (L-1): records that cannot be checked go only with the not reverted confirmation, and say why", () => {
    // R-34b exp 2: r1 made a.txt, then its result.json was broken; it was removed with --confirm alone.
    const damaged = (changes: number) => cleanupRecordWarnings({ kind: null, changes, lastRevert: null, hasDiscarded: true, recordsChanged: false });
    assert.deepEqual(damaged(0), ["records_unreadable"], "what it changed is not known either");
    assert.deepEqual(damaged(3), ["records_unreadable"]);
    assert.equal(needsNotRevertedConfirmation(damaged(0)), true);
    assert.deepEqual(cleanupRecordWarnings({ kind: null, changes: 0, lastRevert: null, hasDiscarded: false, recordsChanged: true }), ["records_unreadable", "records_changed"]);
    assert.ok((MESSAGE_IDS as readonly string[]).includes("cleanup.warning.records_unreadable"));
  });

  test("P-2 (L-2): a leftover is a folder with the mark a cleanup wrote for it; others are unknown folders, shown only", () => {
    assert.equal(CLEANUP_LEFTOVER_MARK_FILE_NAME, "cleanup-leftover.json");
    const mark: CleanupLeftoverMark = { schemaVersion: 1, kind: "cleanup_leftover", leftoverId: "0123456789abcdef" };
    assert.equal(isCleanupLeftoverMark(mark, "0123456789abcdef"), true);
    assert.equal(isCleanupLeftoverMark(JSON.parse(JSON.stringify(mark)) as unknown, "0123456789abcdef"), true, "as read back from its file");
    // R-34b exp 4: a person's folder named like one, with no mark or another folder's mark.
    for (const value of [undefined, null, "", {}, [], { ...mark, leftoverId: "fedcba9876543210" }, { ...mark, kind: "records_changed" }, { ...mark, schemaVersion: 2 }, { ...mark, extra: 1 }]) {
      assert.equal(isCleanupLeftoverMark(value, "0123456789abcdef"), false, JSON.stringify(value));
    }
    const summary: Pick<StateSummary, "leftovers" | "unknownFolders"> = { leftovers: { count: 0, files: 0, bytes: 0 }, unknownFolders: { count: 1, files: 1, bytes: 16 } };
    const none: Pick<StateSummary, "leftovers" | "unknownFolders"> = { leftovers: { count: 0, files: 0, bytes: 0 } };
    assert.ok(summary.unknownFolders?.count === 1 && none.unknownFolders === undefined, "absent when there is none");
    assert.deepEqual(FIXED_MESSAGES["cleanup.summary.unknown_folders"], { count: "count", bytes: "count" });
  });
});

describe("U-13 (UXM-1): an apply run's records stay while its discarded files stay", () => {
  test("UXM-1: --confirm and --include-not-reverted without --delete-discarded keep the apply, its plan run and the folder", () => {
    // The UXM-1 procedure: an apply that discarded inbox/old-draft.tmp (stored as 2), not reverted;
    // cleanup --older-than 0 --discarded-older-than 0 --confirm <digest> --include-not-reverted.
    const apply = toRunId("20261112T135834Z-86b30b72") as RunId;
    const planRun = toRunId("20261112T135800Z-0000aaaa") as RunId;
    const confirmation: CleanupConfirmation = { digest, discarded: false, includeNotReverted: true };
    const outcome: CleanupOutcome = {
      ok: true,
      removed: [],
      kept: [
        { target: "run", runId: apply, reason: "discarded_left" },
        { target: "run", runId: planRun, reason: "used_by_kept_apply" },
        { target: "discarded", runId: apply, reason: "not_confirmed" },
      ],
      totals: emptyTotals,
    };
    assert.ok(confirmation && outcome.ok);
    assert.ok((MESSAGE_IDS as readonly string[]).includes("cleanup.kept.discarded_left"));
    // The result summary says how many apply runs were kept so, after cleanup.done.
    assert.deepEqual(FIXED_MESSAGES["cleanup.done_discarded_left"], { count: "count" });
  });

  test("the warning is the one the preview shows for such an apply; an empty folder (a complete revert leaves it) holds nothing", () => {
    const apply = (hasDiscarded: boolean) => cleanupRecordWarnings({ kind: "apply", changes: 1, lastRevert: "complete", hasDiscarded, recordsChanged: false });
    assert.deepEqual(apply(true), ["discarded_left"]);
    assert.deepEqual(apply(false), []);
  });
});
