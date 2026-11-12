/**
 * U-34: cleanup outputs that reach every line of renderCleanup, for the English pin
 * (g-u34-cleanup-english) and the catalog and Korean tests (g-u34-cleanup-catalog). Made-up run ids,
 * sizes and digest; no store is read.
 */

import type { CleanupOutput, CleanupPlan, RunId, StateSummary } from "../../../src/contracts/index.js";

export const RUN_A = "20261101T000000Z-0000000a" as RunId; // not reverted
export const RUN_B = "20261102T000000Z-0000000b" as RunId; // an apply run with discarded files
export const RUN_C = "20261103T000000Z-0000000c" as RunId; // plain
export const RUN_D = "20261104T000000Z-0000000d" as RunId; // blocked
export const LEFTOVER = "0123456789abcdef";
export const DIGEST = "abcdef0123456789".repeat(4);
/** The plan digest's first MIN_PLAN_DIGEST_PREFIX characters, as the next steps give them. */
export const SHORT = "abcdef012345";

export const SUMMARY: StateSummary = {
  runs: { count: 4, bytes: 4000, oldest: "2026-11-01T00:00:00.000Z", newest: "2026-11-04T00:00:00.000Z" },
  entries: [],
  discarded: { runs: 1, files: 2, bytes: 200 },
  parked: { files: 1, bytes: 10 },
  leftovers: { count: 1, files: 3, bytes: 30 },
  unknownFolders: { count: 1, files: 1, bytes: 5 },
};

/** No leftover and no unknown folder: their summary lines are left out. */
export const SUMMARY_PLAIN: StateSummary = {
  runs: { count: 0, bytes: 0, oldest: null, newest: null },
  entries: [],
  discarded: { runs: 0, files: 0, bytes: 0 },
  parked: { files: 0, bytes: 0 },
  leftovers: { count: 0, files: 0, bytes: 0 },
};

const NO_TOTALS: CleanupPlan["totals"] = {
  runs: { count: 0, notReverted: 0, files: 0, bytes: 0 },
  discarded: { count: 0, files: 0, bytes: 0 },
  leftovers: { count: 0, files: 0, bytes: 0 },
};

/** Runs (one not reverted, one apply run with discarded files), a discarded-files folder, a leftover, a blocked run. */
export const PLAN_ALL: CleanupPlan = {
  items: [
    { target: "run", runId: RUN_A, size: { files: 3, bytes: 300 }, warnings: ["not_reverted"] },
    { target: "run", runId: RUN_B, size: { files: 1, bytes: 100 }, warnings: ["discarded_left"] },
    { target: "run", runId: RUN_C, size: { files: 1, bytes: 50 }, warnings: [] },
    { target: "discarded", runId: RUN_B, size: { files: 2, bytes: 200 }, warnings: ["people_files"] },
    { target: "leftover", leftoverId: LEFTOVER, size: { files: 3, bytes: 30 }, warnings: ["leftover"] },
  ],
  blocked: [{ target: "run", runId: RUN_D, code: "lock_held" }],
  totals: {
    runs: { count: 3, notReverted: 1, files: 5, bytes: 450 },
    discarded: { count: 1, files: 2, bytes: 200 },
    leftovers: { count: 1, files: 3, bytes: 30 },
  },
  parked: { files: 1, bytes: 10 },
  digest: DIGEST,
};

/** Only a discarded-files folder, and a blocked folder. */
export const PLAN_DISCARDED: CleanupPlan = {
  items: [{ target: "discarded", runId: RUN_B, size: { files: 2, bytes: 200 }, warnings: ["people_files"] }],
  blocked: [{ target: "discarded", runId: RUN_D, code: "no_result" }],
  totals: { ...NO_TOTALS, discarded: { count: 1, files: 2, bytes: 200 } },
  parked: { files: 0, bytes: 0 },
  digest: DIGEST,
};

/** Only a leftover folder. */
export const PLAN_LEFTOVERS: CleanupPlan = {
  items: [{ target: "leftover", leftoverId: LEFTOVER, size: { files: 3, bytes: 30 }, warnings: ["leftover"] }],
  blocked: [],
  totals: { ...NO_TOTALS, leftovers: { count: 1, files: 3, bytes: 30 } },
  parked: { files: 0, bytes: 0 },
  digest: DIGEST,
};

export const PLAN_EMPTY: CleanupPlan = { items: [], blocked: [], totals: NO_TOTALS, parked: { files: 0, bytes: 0 }, digest: DIGEST };

export const preview = (plan: CleanupPlan, summary: StateSummary = SUMMARY): CleanupOutput => ({
  schemaVersion: 1,
  kind: "cleanup",
  status: "preview",
  exitCode: 0,
  summary,
  plan,
});

/** A confirmed cleanup that removed nothing: one item of each kind kept. */
export const NOTHING_REMOVED: CleanupOutput = {
  schemaVersion: 1,
  kind: "cleanup",
  status: "nothing_removed",
  exitCode: 3,
  outcome: {
    ok: false,
    removed: [],
    kept: [
      { target: "run", runId: RUN_A, reason: "not_reverted_not_confirmed" },
      { target: "discarded", runId: RUN_B, reason: "not_confirmed" },
      { target: "leftover", leftoverId: LEFTOVER, reason: "partly_removed" },
    ],
    totals: PLAN_ALL.totals,
  },
};

/** A confirmed cleanup that removed runs, a folder and a leftover, and kept an apply run's records. */
export const REMOVED: CleanupOutput = {
  schemaVersion: 1,
  kind: "cleanup",
  status: "removed",
  exitCode: 0,
  outcome: {
    ok: true,
    removed: [
      { target: "run", runId: RUN_A, size: { files: 3, bytes: 300 } },
      { target: "run", runId: RUN_C, size: { files: 1, bytes: 50 } },
      { target: "discarded", runId: RUN_D, size: { files: 2, bytes: 200 } },
      { target: "leftover", leftoverId: LEFTOVER, size: { files: 3, bytes: 30 } },
    ],
    kept: [{ target: "run", runId: RUN_B, reason: "discarded_left" }],
    totals: PLAN_ALL.totals,
  },
};
