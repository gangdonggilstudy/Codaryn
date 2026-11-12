/**
 * DR-39 (DR-9, R-19 I-5): seeing and cleaning up the state directory, after the store owner's
 * design (report-N-C 2). Two things can be removed, each confirmed apart in the same command (P-4):
 * run records (`runs/<runId>/`) and the discarded-files folders (`discarded/<runId>/`, people's own
 * files that an apply set aside, DR-9). Never removed: PARKED_DIR_NAME (files a revert could not put
 * back), LOCK_FILE_NAME, `.gitignore` and anything else. Every function takes exact run directory
 * names and plain directories only and never follows a link. A preview is the default.
 *
 * DR-44 (R-34): what a person sees must be what happens, and no way back is lost without telling.
 * Records of a run whose changes were not, or only partly, reverted go only with their own
 * confirmation (`includeNotReverted`); an apply run's records are warned about whenever its
 * discarded files could stay; a folder that could not be removed entirely is never reported as
 * removed, and the next plan shows it (a `leftover` item) so it can be.
 *
 * R-34b: records that cannot be checked (a damaged run) are treated as not reverted
 * (`records_unreadable`); a leftover is told by the mark the cleanup wrote into it, not by its name
 * alone, and a folder named like one without its mark is an unknown folder, shown and never removed.
 *
 * U-13 (UXM-1, completing DR-44): an apply run's records are not removed while its discarded-files
 * folder still holds files, unless that folder is removed entirely in the same cleanup. Without the
 * records the files would stay under their stored names (`discardedStoredName`) with nothing to say
 * what they were or where they belong. Such an apply is kept (`discarded_left`) and the rest goes.
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
  /** DR-44 (b): its last revert was complete. A partial revert is not a revert here (`partlyReverted`). */
  readonly reverted: boolean;
  /** DR-44 (b): its last revert was partial (some files were skipped); `reverted` is false then. */
  readonly partlyReverted: boolean;
  /** Its discarded-files folder, or null when it has none. */
  readonly discarded: StateSize | null;
  /** DR-38: it has a records-changed mark (or an unreadable one). */
  readonly recordsChanged: boolean;
}

/**
 * DR-44 (d): the name of a folder an earlier applyCleanup moved an item into and could not remove
 * entirely (`cleanup-` and 16 lowercase hex digits, directly in the state directory). R-34b P-2: the
 * name alone is not enough; a leftover also holds its mark (CLEANUP_LEFTOVER_MARK_FILE_NAME).
 */
export const CLEANUP_LEFTOVER_PATTERN_SOURCE = "^cleanup-[0-9a-f]{16}$";

/**
 * R-34b P-2: the mark applyCleanup writes, as a plain file directly inside, into each folder it moves
 * an item aside to, right after the move. A plain directory whose name matches
 * CLEANUP_LEFTOVER_PATTERN_SOURCE is a leftover only when it holds this file and the file's JSON is
 * its own mark (isCleanupLeftoverMark); otherwise it is an unknown folder (StateSummary.unknownFolders).
 * No run record and no stored discarded file (`discardedStoredName`) has this name.
 */
export const CLEANUP_LEFTOVER_MARK_FILE_NAME = "cleanup-leftover.json";

/** The content of CLEANUP_LEFTOVER_MARK_FILE_NAME: nothing but which folder it was written into. */
export interface CleanupLeftoverMark {
  readonly schemaVersion: 1;
  readonly kind: "cleanup_leftover";
  /** The 16 hex digits of the folder's name (`cleanup-<leftoverId>`). */
  readonly leftoverId: string;
}

/** R-34b P-2: whether `value` (the mark file's parsed JSON) is exactly the mark of the folder `leftoverId` names. */
export function isCleanupLeftoverMark(value: unknown, leftoverId: string): value is CleanupLeftoverMark {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (Object.keys(value).sort().join(",") !== "kind,leftoverId,schemaVersion") return false;
  const mark = value as Record<string, unknown>;
  return mark["schemaVersion"] === 1 && mark["kind"] === "cleanup_leftover" && mark["leftoverId"] === leftoverId;
}

export interface StateSummary {
  readonly runs: { readonly count: number; readonly bytes: number; readonly oldest: string | null; readonly newest: string | null };
  /** Newest first, as listRuns orders them. */
  readonly entries: readonly StateRunSummary[];
  /** Over every discarded-files folder: how many runs have one, and their files and bytes. */
  readonly discarded: { readonly runs: number; readonly files: number; readonly bytes: number };
  /** Never cleaned; shown so a person knows the files are there. */
  readonly parked: StateSize;
  /** DR-44 (d): folders an earlier cleanup could not remove entirely (with their mark, R-34b P-2). */
  readonly leftovers: { readonly count: number } & StateSize;
  /**
   * R-34b P-2: plain directories named like a leftover without their mark. Never an item and never
   * removed; shown only (cleanup.summary.unknown_folders). Absent when there is none.
   */
  readonly unknownFolders?: { readonly count: number } & StateSize;
}

/** Signature of `summarizeState`, exported by `src/store/index.ts`. Reads only; never rejects for one run. */
export type SummarizeState = (request: { readonly workspaceRoot: string }) => Promise<StateSummary>;

/**
 * What to remove. A run is selected when it matches every criterion its part gives; a part with no
 * criterion, or an absent part, selects nothing. `olderThanDays` counts from the request's `now` to
 * the run's start. Leftover folders (DR-44 (d)) are not selected: every plan includes them (those with
 * their mark only, R-34b P-2).
 */
export interface CleanupSelection {
  /**
   * Run records. `reverted: true` keeps to runs whose last revert was complete (DR-44 (b): a partly
   * reverted run is not selected by it).
   */
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
 * - not_reverted: the run changed files and was never reverted; without its records they cannot be
 * - partly_reverted (DR-44 (b)): its last revert was partial; without its records the rest cannot be
 * - records_unreadable (R-34b P-1): its records cannot be checked (a damaged run), so whether it
 *   changed files and was reverted is not known; its records may hold the last copies of them
 * - discarded_left (DR-44 (c), U-13): an apply run whose discarded-files folder holds files: its
 *   records are kept unless that folder is removed in the same cleanup (selected, and confirmed with
 *   `discarded: true`), since only they say what the files were and let a revert put them back
 * - people_files: a discarded-files folder: people's own files are deleted
 * - records_changed: the run has a records-changed mark (DR-38); its records are evidence (P-5)
 * - leftover (DR-44 (d)): what an earlier cleanup confirmed and could not remove entirely
 * not_reverted, partly_reverted and records_unreadable need CleanupConfirmation.includeNotReverted
 * (NOT_REVERTED_WARNINGS).
 */
export const CLEANUP_WARNING_CODES = [
  "not_reverted",
  "partly_reverted",
  "records_unreadable",
  "discarded_left",
  "people_files",
  "records_changed",
  "leftover",
] as const;
export type CleanupWarningCode = (typeof CLEANUP_WARNING_CODES)[number];

/** DR-44 (a): the warnings whose run records go only with CleanupConfirmation.includeNotReverted. */
export const NOT_REVERTED_WARNINGS = ["not_reverted", "partly_reverted", "records_unreadable"] as const satisfies readonly CleanupWarningCode[];

/** How a run's last revert went, as its revert record says: complete, partial, or none. */
export type LastRevert = "complete" | "partial" | null;

/**
 * DR-44 (a)-(c): the warnings of a run's records item, the one rule the store, the CLI and the app
 * share. `changes`: the files the run changed or the actions an apply applied (0: nothing to revert).
 * `kind: null`: the records cannot be checked (R-34b P-1: records_unreadable, whatever `changes`).
 * `hasDiscarded` (U-13): its discarded-files folder holds at least one file. An empty folder, as a
 * complete revert leaves it, holds nothing to lose.
 */
export function cleanupRecordWarnings(run: {
  readonly kind: "run" | "apply" | null;
  readonly changes: number;
  readonly lastRevert: LastRevert;
  readonly hasDiscarded: boolean;
  readonly recordsChanged: boolean;
}): CleanupWarningCode[] {
  const warnings: CleanupWarningCode[] = [];
  if (run.kind === null) warnings.push("records_unreadable");
  else if (run.changes > 0) {
    if (run.lastRevert === null) warnings.push("not_reverted");
    else if (run.lastRevert === "partial") warnings.push("partly_reverted");
  }
  if (run.kind === "apply" && run.hasDiscarded) warnings.push("discarded_left");
  if (run.recordsChanged) warnings.push("records_changed");
  return warnings;
}

/** DR-44 (a): whether an item's records go only with `includeNotReverted`. */
export function needsNotRevertedConfirmation(warnings: readonly CleanupWarningCode[]): boolean {
  return warnings.some((warning) => (NOT_REVERTED_WARNINGS as readonly string[]).includes(warning));
}

/** DR-44 (b): whether `reverted: true` selects a run: only a complete last revert. */
export function selectedAsReverted(lastRevert: LastRevert): boolean {
  return lastRevert === "complete";
}

/**
 * What a cleanup item is: a run's records, a run's discarded-files folder, or a leftover folder.
 * U-34: a person reads each by its name, `cleanup.target.<target>` (src/contracts/human.ts).
 */
export const CLEANUP_TARGETS = ["run", "discarded", "leftover"] as const;
export type CleanupTarget = (typeof CLEANUP_TARGETS)[number];

/** Which item: by run id, or for a leftover by the 16 hex digits of its folder name. */
export type CleanupItemRef =
  | { readonly target: "run" | "discarded"; readonly runId: RunId }
  | { readonly target: "leftover"; readonly leftoverId: string };

export type CleanupItem = CleanupItemRef & {
  readonly size: StateSize;
  readonly warnings: readonly CleanupWarningCode[];
};

export interface CleanupPlan {
  /** Leftover folders come last, always included (DR-44 (d)). */
  readonly items: readonly CleanupItem[];
  readonly blocked: readonly { readonly target: "run" | "discarded"; readonly runId: RunId; readonly code: CleanupBlockCode }[];
  readonly totals: {
    /** `notReverted`: how many of them carry a NOT_REVERTED_WARNINGS code (DR-44 (a), the header). */
    readonly runs: { readonly count: number; readonly notReverted: number } & StateSize;
    readonly discarded: { readonly count: number } & StateSize;
    readonly leftovers: { readonly count: number } & StateSize;
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
 * discarded-files folders (people's files) may go, and (DR-44 (a)) whether the records of runs that
 * were not, or only partly, reverted may go. Without `discarded: true` the folders stay; without
 * `includeNotReverted: true` those records stay. The CLI asks for each with its own flag
 * (`--include-not-reverted` for the latter), the app and the GUI with their own question.
 */
export interface CleanupConfirmation {
  readonly digest: ContentHash;
  readonly discarded: boolean;
  readonly includeNotReverted: boolean;
}

/**
 * Why an item of a confirmed plan was kept:
 * - not_confirmed: a discarded-files folder without `discarded: true`
 * - not_reverted_not_confirmed (DR-44 (a)): records with a NOT_REVERTED_WARNINGS code without
 *   `includeNotReverted: true`
 * - discarded_left (U-13): an apply run's records whose discarded-files folder holds files and was
 *   not removed entirely in this cleanup (not selected, not confirmed with `discarded: true`, or its
 *   removal failed). Its plan run is kept too (used_by_kept_apply). When both apply, an apply's
 *   reason is not_reverted_not_confirmed.
 * - changed: it differs from the plan (checked again item by item just before removal)
 * - not_plain_directory: it is no longer a plain directory (a link, or something else)
 * - used_by_kept_apply (DR-44 (a)): a plan run whose apply run, selected too, was kept (for any
 *   reason); removing it would leave that apply impossible to revert (`plan_run_missing`)
 * - io_error: it could not be moved aside; nothing of it was removed
 * - partly_removed (DR-44 (d)): it was moved aside but not all of it could be removed; what is left
 *   stays in a leftover folder that the next plan shows. It is not reported or logged as removed.
 */
export const CLEANUP_KEPT_REASONS = [
  "not_confirmed",
  "not_reverted_not_confirmed",
  "discarded_left",
  "used_by_kept_apply",
  "changed",
  "not_plain_directory",
  "io_error",
  "partly_removed",
] as const;
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
      /** Only what was removed entirely (DR-44 (d)). */
      readonly removed: readonly (CleanupItemRef & { readonly size: StateSize })[];
      readonly kept: readonly (CleanupItemRef & { readonly reason: CleanupKeptReason })[];
      readonly totals: CleanupPlan["totals"];
    }
  | { readonly ok: false; readonly code: CleanupFailureCode };

/**
 * DR-48 (AXM-3): the kept reasons that are problems, not a confirmation left out or a rule. An item
 * kept for one of them makes a cleanup `partly_failed`.
 */
export const CLEANUP_PROBLEM_KEPT_REASONS = ["changed", "not_plain_directory", "io_error", "partly_removed"] as const satisfies readonly CleanupKeptReason[];

/**
 * DR-48 (AXM-3): what a cleanup did, as `codaryn cleanup` and the app say it:
 * - preview: no confirmation was given; nothing was removed
 * - removed: something was removed and nothing was kept for a problem (the rest, if any, kept for a
 *   confirmation not given or by a rule)
 * - nothing_removed: nothing was removed and nothing was kept for a problem (every item kept for a
 *   confirmation not given or by a rule, or nothing to remove)
 * - partly_failed: something was kept for a problem (CLEANUP_PROBLEM_KEPT_REASONS), whatever else
 *   was removed
 */
export const CLEANUP_STATUSES = ["preview", "removed", "nothing_removed", "partly_failed"] as const;
export type CleanupStatus = (typeof CLEANUP_STATUSES)[number];
export const CLEANUP_EXIT_CODES: { readonly [S in CleanupStatus]: number } = { preview: 0, removed: 0, nothing_removed: 3, partly_failed: 1 };

/** DR-48: the status of a cleanup that was carried out, the one rule the CLI and the app share. */
export function cleanupStatusOf(outcome: Extract<CleanupOutcome, { readonly ok: true }>): Exclude<CleanupStatus, "preview"> {
  if (outcome.kept.some((item) => (CLEANUP_PROBLEM_KEPT_REASONS as readonly string[]).includes(item.reason))) return "partly_failed";
  return outcome.removed.length > 0 ? "removed" : "nothing_removed";
}

/**
 * DR-48 (AXM-3): what `codaryn cleanup` prints, one JSON line with `--json` (moved here from
 * src/cli/cleanup.ts). `exitCode` is CLEANUP_EXIT_CODES[status]. `outcome.ok` is true for `removed`
 * only: a cleanup that removed nothing, or kept something for a problem, is not ok. A confirmed
 * digest that is not the plan's is the error `cleanup_plan_changed` and a held lock is
 * `workspace_locked` (CliErrorOutput); neither is a CleanupOutput. The old `mode` field is gone
 * (DR-48 allows breaking this JSON).
 */
export type CleanupOutput =
  | {
      readonly schemaVersion: 1;
      readonly kind: "cleanup";
      readonly status: "preview";
      readonly exitCode: number;
      readonly summary: StateSummary;
      readonly plan: CleanupPlan;
    }
  | {
      readonly schemaVersion: 1;
      readonly kind: "cleanup";
      readonly status: Exclude<CleanupStatus, "preview">;
      readonly exitCode: number;
      /** The store's outcome, with `ok` true only for `removed`. */
      readonly outcome: Omit<Extract<CleanupOutcome, { readonly ok: true }>, "ok"> & { readonly ok: boolean };
    };

/**
 * Signature of `applyCleanup`, exported by `src/store/index.ts`. Under the workspace lock it makes
 * the plan again from `selection` and `now` and goes on only when its digest equals the
 * confirmation's. Each item is checked again (exact name, plain directory, not a link, same
 * fingerprint), renamed to `cleanup-<16 hex>` inside the state directory and then removed, so no
 * half-removed run is left in place. A removal that fails after the rename keeps the item as
 * `partly_removed` (DR-44 (d)). R-34b P-2: right after the rename it writes the folder's mark
 * (CLEANUP_LEFTOVER_MARK_FILE_NAME, exclusive create) and removes everything else before the mark, so a
 * folder not removed entirely keeps it; a mark that cannot be written does not stop the removal (what
 * is then left is an unknown folder). A leftover item is removed in the same order. U-13: an apply
 * run's discarded-files folder is handled before its records, and the records go only when no
 * discarded file of the run is left (the folder held none, or it was removed entirely just before);
 * otherwise they are kept as `discarded_left`. It appends one CleanupLogLine to CLEANUP_LOG_FILE_NAME
 * with what was removed entirely only.
 */
export type ApplyCleanup = (request: {
  readonly workspaceRoot: string;
  readonly selection: CleanupSelection;
  readonly now: string;
  readonly confirmation: CleanupConfirmation;
}) => Promise<CleanupOutcome>;

/** `.codaryn/cleanup.jsonl`: one line per cleanup. */
export const CLEANUP_LOG_FILE_NAME = "cleanup.jsonl";

/** One line of CLEANUP_LOG_FILE_NAME: counts and sizes of what was removed entirely, never a name or a path. */
export interface CleanupLogLine {
  readonly schemaVersion: 1;
  /** RUN_TIMESTAMP_PATTERN_SOURCE. */
  readonly at: string;
  readonly runs: { readonly count: number } & StateSize;
  readonly discarded: { readonly count: number } & StateSize;
  /** DR-44 (d): leftover folders removed. Absent when none were (and in lines written before DR-44). */
  readonly leftovers?: { readonly count: number } & StateSize;
}
