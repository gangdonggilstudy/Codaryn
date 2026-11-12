/**
 * DR-39 (DR-9, R-19 I-5): seeing and cleaning up the state directory, after the store owner's
 * design (report-N-C 2). Two things can be removed, each confirmed apart in the same command (P-4):
 * run records (`runs/<runId>/`) and the discarded-files folders (`discarded/<runId>/`, people's own
 * files that an apply set aside, DR-9). Never removed: PARKED_DIR_NAME (files a revert could not put
 * back), LOCK_FILE_NAME, `.gitignore` and anything else. Every function takes exact run directory
 * names and plain directories only and never follows a link. A preview is the default.
 */

import type { TerminalRunStatus } from "./engine.js";
import type { RunId } from "./human.js";
import type { ContentHash } from "./text.js";

/** Files and bytes. */
export interface StateSize {
  readonly files: number;
  readonly bytes: number;
}

/** One run as summarizeState sees it. No file name of its own is given. */
export interface StateRunSummary {
  readonly runId: RunId;
  /** "run" or "apply"; null when its records cannot be read (damaged). */
  readonly kind: "run" | "apply" | null;
  readonly status: TerminalRunStatus | null;
  /** RUN_TIMESTAMP_PATTERN_SOURCE, or null when unknown. */
  readonly startedAt: string | null;
  /** Its run directory. */
  readonly records: StateSize;
  readonly reverted: boolean;
  /** Its discarded-files folder, or null when it has none. */
  readonly discarded: StateSize | null;
  /** DR-38: it has a records-changed mark (or an unreadable one). */
  readonly recordsChanged: boolean;
}

export interface StateSummary {
  readonly runs: { readonly count: number; readonly bytes: number; readonly oldest: string | null; readonly newest: string | null };
  /** Newest first, as listRuns orders them. */
  readonly entries: readonly StateRunSummary[];
  /** Over every discarded-files folder: how many runs have one, and their files and bytes. */
  readonly discarded: { readonly runs: number; readonly files: number; readonly bytes: number };
  /** Never cleaned; shown so a person knows the files are there. */
  readonly parked: StateSize;
}

/** Signature of `summarizeState`, exported by `src/store/index.ts`. Reads only; never rejects for one run. */
export type SummarizeState = (request: { readonly workspaceRoot: string }) => Promise<StateSummary>;

/**
 * What to remove. A run is selected when it matches every criterion its part gives; a part with no
 * criterion, or an absent part, selects nothing. `olderThanDays` counts from the request's `now` to
 * the run's start.
 */
export interface CleanupSelection {
  /** Run records. `reverted: true` keeps to runs whose changes were reverted. */
  readonly runs?: { readonly olderThanDays?: number; readonly runIds?: readonly string[]; readonly reverted?: true };
  /** Discarded-files folders (people's files). */
  readonly discarded?: { readonly olderThanDays?: number; readonly runIds?: readonly string[] };
}

/**
 * Why a selected item is not removed (never removed, whatever the confirmation):
 * - lock_held: the run holds the workspace lock (it is running)
 * - no_result: the run has no result yet (it may still be running)
 * - plan_used_by_apply: a plan run that an apply run not selected uses; removing it would leave that
 *   apply impossible to revert (`plan_run_missing`). Selecting both is allowed.
 */
export const CLEANUP_BLOCK_CODES = ["lock_held", "no_result", "plan_used_by_apply"] as const;
export type CleanupBlockCode = (typeof CLEANUP_BLOCK_CODES)[number];

/**
 * What a person is told before confirming:
 * - not_reverted: the run's changes were not reverted; without its records they cannot be
 * - discarded_left: an apply run's records go but its discarded-files folder stays; the files stay
 *   but a revert can no longer put them back
 * - people_files: a discarded-files folder: people's own files are deleted
 * - records_changed: the run has a records-changed mark (DR-38); its records are evidence (P-5)
 */
export const CLEANUP_WARNING_CODES = ["not_reverted", "discarded_left", "people_files", "records_changed"] as const;
export type CleanupWarningCode = (typeof CLEANUP_WARNING_CODES)[number];

export type CleanupTarget = "run" | "discarded";

export interface CleanupItem {
  readonly target: CleanupTarget;
  readonly runId: RunId;
  readonly size: StateSize;
  readonly warnings: readonly CleanupWarningCode[];
}

export interface CleanupPlan {
  readonly items: readonly CleanupItem[];
  readonly blocked: readonly { readonly target: CleanupTarget; readonly runId: RunId; readonly code: CleanupBlockCode }[];
  readonly totals: {
    readonly runs: { readonly count: number } & StateSize;
    readonly discarded: { readonly count: number } & StateSize;
  };
  /** Not cleaned; shown with the plan. */
  readonly parked: StateSize;
  /**
   * SHA-256 of the plan's canonical JSON and each item's metadata fingerprint (sizes, change times,
   * file ids). applyCleanup removes nothing unless the plan it makes again has this digest.
   */
  readonly digest: ContentHash;
}

/** Signature of `planCleanup`, exported by `src/store/index.ts`. Reads only. */
export type PlanCleanup = (request: {
  readonly workspaceRoot: string;
  readonly selection: CleanupSelection;
  /** RUN_TIMESTAMP_PATTERN_SOURCE: the moment `olderThanDays` counts from. */
  readonly now: string;
}) => Promise<CleanupPlan>;

/**
 * The person's confirmation of a plan shown to them: its digest, and apart from it whether the
 * discarded-files folders (people's files) may go. Without `discarded: true` they stay.
 */
export interface CleanupConfirmation {
  readonly digest: ContentHash;
  readonly discarded: boolean;
}

/**
 * Why an item of a confirmed plan was kept:
 * - not_confirmed: a discarded-files folder without `discarded: true`
 * - changed: it differs from the plan (checked again item by item just before removal)
 * - not_plain_directory: it is no longer a plain directory (a link, or something else)
 * - io_error: it could not be moved aside or removed
 */
export const CLEANUP_KEPT_REASONS = ["not_confirmed", "changed", "not_plain_directory", "io_error"] as const;
export type CleanupKeptReason = (typeof CLEANUP_KEPT_REASONS)[number];

/**
 * Why nothing was removed: plan_changed (the plan made again under the lock has another digest),
 * workspace_locked (another process holds the workspace lock).
 */
export const CLEANUP_FAILURE_CODES = ["plan_changed", "workspace_locked"] as const;
export type CleanupFailureCode = (typeof CLEANUP_FAILURE_CODES)[number];

export type CleanupOutcome =
  | {
      readonly ok: true;
      readonly removed: readonly { readonly target: CleanupTarget; readonly runId: RunId; readonly size: StateSize }[];
      readonly kept: readonly { readonly target: CleanupTarget; readonly runId: RunId; readonly reason: CleanupKeptReason }[];
      readonly totals: CleanupPlan["totals"];
    }
  | { readonly ok: false; readonly code: CleanupFailureCode };

/**
 * Signature of `applyCleanup`, exported by `src/store/index.ts`. Under the workspace lock it makes
 * the plan again from `selection` and `now` and goes on only when its digest equals the
 * confirmation's. Each item is checked again (exact name, plain directory, not a link, same
 * fingerprint), renamed to `cleanup-<random>` inside the state directory and then removed, so no
 * half-removed run is left. It appends one CleanupLogLine to CLEANUP_LOG_FILE_NAME.
 */
export type ApplyCleanup = (request: {
  readonly workspaceRoot: string;
  readonly selection: CleanupSelection;
  readonly now: string;
  readonly confirmation: CleanupConfirmation;
}) => Promise<CleanupOutcome>;

/** `.codaryn/cleanup.jsonl`: one line per cleanup. */
export const CLEANUP_LOG_FILE_NAME = "cleanup.jsonl";

/** One line of CLEANUP_LOG_FILE_NAME: counts and sizes only, never a name or a path. */
export interface CleanupLogLine {
  readonly schemaVersion: 1;
  /** RUN_TIMESTAMP_PATTERN_SOURCE. */
  readonly at: string;
  readonly runs: { readonly count: number } & StateSize;
  readonly discarded: { readonly count: number } & StateSize;
}
