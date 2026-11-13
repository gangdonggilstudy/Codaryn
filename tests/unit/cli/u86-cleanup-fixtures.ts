/**
 * U-86: cleanup previews with the store's item fates (CLEANUP_ITEM_FATES) and the count of
 * discarded-files folders without records (STATE_DISCARDED_WITHOUT_RECORDS), for the preview tests.
 * Built on the U-34 fixtures; made-up ids and sizes; no store is read.
 */

import { CLEANUP_ITEM_FATES, STATE_DISCARDED_WITHOUT_RECORDS } from "../../../src/contracts/index.js";
import type { CleanupItemFate, CleanupPlan, StateSummary } from "../../../src/contracts/index.js";
import { DIGEST, LEFTOVER, PLAN_ALL, RUN_A, RUN_B, RUN_C, SUMMARY } from "./u34-cleanup-fixtures.js";

export const withFates = (plan: CleanupPlan, fates: readonly CleanupItemFate[]): CleanupPlan => ({ ...plan, [CLEANUP_ITEM_FATES]: fates });

/**
 * PLAN_ALL as the store foresees it: RUN_A's records need --include-not-reverted; the apply run
 * RUN_B (its folder selected too) and its folder need --delete-discarded; RUN_C and the leftover go
 * with --confirm alone.
 */
export const PLAN_ALL_FATES = withFates(PLAN_ALL, [
  { removedWith: ["include_not_reverted"] },
  { removedWith: ["delete_discarded"] },
  { removedWith: [] },
  { removedWith: ["delete_discarded"] },
  { removedWith: [] },
]);

/** An apply run not reverted whose folder is selected: it needs both flags. */
export const PLAN_BOTH: CleanupPlan = withFates(
  {
    items: [
      { target: "run", runId: RUN_A, size: { files: 2, bytes: 20 }, warnings: ["not_reverted", "discarded_left"] },
      { target: "discarded", runId: RUN_A, size: { files: 1, bytes: 10 }, warnings: ["people_files"] },
    ],
    blocked: [],
    totals: {
      runs: { count: 1, notReverted: 1, files: 2, bytes: 20 },
      discarded: { count: 1, files: 1, bytes: 10 },
      leftovers: { count: 0, files: 0, bytes: 0 },
    },
    parked: { files: 0, bytes: 0 },
    digest: DIGEST,
  },
  [{ removedWith: ["include_not_reverted", "delete_discarded"] }, { removedWith: ["delete_discarded"] }],
);

/** A plan run kept with its apply run, an apply run kept for its discarded files, and a leftover. */
export const PLAN_KEPT: CleanupPlan = withFates(
  {
    items: [
      { target: "run", runId: RUN_C, size: { files: 1, bytes: 5 }, warnings: [] },
      { target: "run", runId: RUN_B, size: { files: 1, bytes: 7 }, warnings: ["discarded_left"] },
      { target: "leftover", leftoverId: LEFTOVER, size: { files: 1, bytes: 3 }, warnings: ["leftover"] },
    ],
    blocked: [],
    totals: {
      runs: { count: 2, notReverted: 0, files: 2, bytes: 12 },
      discarded: { count: 0, files: 0, bytes: 0 },
      leftovers: { count: 1, files: 1, bytes: 3 },
    },
    parked: { files: 0, bytes: 0 },
    digest: DIGEST,
  },
  [{ keptFor: "used_by_kept_apply" }, { keptFor: "discarded_left" }, { removedWith: [] }],
);

/** SUMMARY with one discarded-files folder whose run has no records left. */
export const SUMMARY_RECORDLESS: StateSummary = { ...SUMMARY, [STATE_DISCARDED_WITHOUT_RECORDS]: { count: 1, files: 2, bytes: 200 } };
