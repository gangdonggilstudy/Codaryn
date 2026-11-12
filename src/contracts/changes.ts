/**
 * Change snapshots and revert (phase 2, R-6 to R-8).
 *
 * Before a file tool changes a file, it hands the file's original text to a ChangeRecorder.
 * The recorder keeps it under `<workspaceRoot>/.codaryn/runs/<runId>/snapshots/`. A revert puts
 * the originals back later, also after the process that ran the task has ended.
 *
 * Snapshots are raw local text and may hold secrets (R-8). They are kept like the workspace files
 * themselves: never written to the journal, never sent to a model, never printed. File tools
 * cannot reach them, because they live in the state directory. A command the policy allows runs
 * with the user's rights, so it can read them (T-11). They stay until the user deletes the run
 * directory; nothing removes them automatically. Delete it once the run is no longer needed.
 */

import type { CliErrorCode } from "./engine.js";
import { maskedParts, sameMaskedParts } from "./plan.js";
import type { ApprovalChannel, MaskedParts } from "./plan.js";
import type { ContentHash, RawText } from "./text.js";
import type { ResolvedPath } from "./workspace.js";

/** `<root>/.codaryn/runs/<runId>/snapshots/`. The file layout inside it belongs to `src/store`. */
export const SNAPSHOTS_DIR_NAME = "snapshots";

/**
 * Keeps the first original of every file a run changes.
 *
 * `createToolRunner` (src/tools) takes an optional `changeRecorder`. When one is given,
 * `write_file` calls `saveOriginal` after its checks and before it writes. Without one, nothing is
 * kept and the run cannot be reverted. The CLI always passes one.
 */
export interface ChangeRecorder {
  /**
   * Keeps `original` as the content `path` had before this run first changed it.
   * `original` is the exact text the tool read (`LocalSnapshot.text`, a byte order mark
   * included), or `null` when the file did not exist.
   *
   * Only the first call for a `path.relative` in a run is kept. Later calls for the same path
   * resolve without changing anything, so the snapshot holds the text from before the run.
   * Resolves after the snapshot was handed to the operating system. When it rejects, the tool
   * must not write and reports `io_error`.
   *
   * DR-29: `shownOriginal` is `original` masked by this run's gateway, as visible parts
   * (MaskedParts, the DR-28 form), or null when `original` is null. The tool builds it with the
   * gateway it was created with; the store keeps it with the snapshot and never sees the gateway.
   * Absent when the tool could not mask the text (or a caller from before DR-29): the comparison
   * view then shows no text for this path. Kept with the first call only, like the snapshot.
   */
  saveOriginal(path: ResolvedPath, original: RawText | null, shownOriginal?: MaskedParts | null): Promise<void>;
  /**
   * DR-29: called by a writing tool after its write succeeded, with the SHA-256 of the bytes it
   * wrote (the `newHash` of its `file_changed` record) and that text masked by this run's gateway,
   * as visible parts. The last call for a `path.relative` replaces the earlier one. It keeps no
   * secret value and no hash of one: the parts are the visible text between tokens, and the hash is
   * already in the record. When it rejects, the write has already happened and the tool's outcome
   * stays as it is; the comparison view then finds the record stale or missing and shows no text.
   * Optional only so recorders from before DR-29 still type-check; the store implements it.
   */
  saveNext?(path: ResolvedPath, sha256: ContentHash, shown: MaskedParts): Promise<void>;
}

export interface ChangeRecorderOptions {
  /** Real absolute path of the workspace root. */
  readonly workspaceRoot: string;
  readonly runId: string;
}

/** Signature of `createChangeRecorder`, exported by `src/store/index.ts`. */
export type CreateChangeRecorder = (options: ChangeRecorderOptions) => ChangeRecorder;

/**
 * DR-25: the person's consent to move files back unsafely (`unsafe_move`: no hard links on that
 * volume) in one revert of an apply run. Like UnsafeMoveConsent (DR-21) it comes only from a
 * person: the CLI's own argument on `codaryn revert` (UNSAFE_MOVE_CONSENT_ARGUMENT, `cli-flag`), a
 * terminal answer (`cli-tty`), or an adapter after the person agreed on screen (`adapter`). No task,
 * config, profile, record or model can give it. It names the run being reverted and holds for this
 * one revert only: a later revert needs it again.
 */
export interface RevertUnsafeMoveConsent {
  readonly channel: ApprovalChannel;
  /** Must equal RevertRequest.runId; a consent for another run counts as none. */
  readonly runId: string;
}

export interface RevertRequest {
  /** Real absolute path of the workspace root. */
  readonly workspaceRoot: string;
  readonly runId: string;
  /** DR-25: the person's consent for this revert, or absent/null for none (unsafe moves are skipped). */
  readonly unsafeMoveConsent?: RevertUnsafeMoveConsent | null;
  /**
   * N-7: decide every file exactly as a revert would, and change nothing: no file is written,
   * deleted or created, and no lock or record is taken or written. The outcome lists what would be
   * reverted (`reverted`, with the action it would take) and what would be skipped. Absent: false.
   */
  readonly dryRun?: boolean;
}

/**
 * N-7: `<root>/.codaryn/runs/<runId>/revert.json`, written by `codaryn revert` (not by a dry run)
 * after `revertRun` returned, while the lock is still held. It replaces an earlier one, so it
 * describes the latest revert. `listRuns` reads it to mark reverted runs. It never affects what
 * `revertRun` decides.
 */
export const REVERT_RECORD_FILE_NAME = "revert.json";

export interface RevertRecord {
  readonly schemaVersion: 1;
  readonly kind: "revert_record";
  readonly runId: string;
  /** When the revert finished, ISO 8601 UTC (RUN_TIMESTAMP_PATTERN_SOURCE). */
  readonly at: string;
  readonly status: "complete" | "partial";
  /** Number of files reverted and skipped. */
  readonly reverted: number;
  readonly skipped: number;
  /**
   * DR-25: how the person consented to unsafe moves for this revert, or null for no consent.
   * Absent in records written before DR-25 (no consent).
   */
  readonly unsafeMoveConsent?: ApprovalChannel | null;
  /** DR-25: number of files moved back unsafely, with that consent. Absent: 0. */
  readonly unsafeMoves?: number;
}

/**
 * N-22: signatures of `readRevertRecord` and `writeRevertRecord`, exported by `src/store/index.ts`.
 * - read: the run's checked record, or null when it has none. Rejects when one exists but cannot
 *   be read or fails the checks (same run id, timestamp pattern, known status); `revert` then
 *   leaves `revertedBefore` out.
 * - write: replaces the record atomically (temporary file and rename). The run directory must
 *   exist; it is not created. Rejects on failure; `revert` treats the record as best effort.
 */
export type ReadRevertRecord = (workspaceRoot: string, runId: string) => Promise<RevertRecord | null>;
export type WriteRevertRecord = (workspaceRoot: string, record: RevertRecord) => Promise<void>;

/**
 * restored, deleted: a `file_changed` path (phase 2). G-A, for an apply run:
 * - moved_back: a `file_moved` file was renamed from `to` back to `from`
 * - restored_from_discard: a `file_discarded` file was renamed from `.codaryn/discarded/<runId>/`
 *   (DR-9) back to its path
 */
export const REVERT_ACTIONS = ["restored", "deleted", "moved_back", "restored_from_discard"] as const;
export type RevertAction = (typeof REVERT_ACTIONS)[number];

/**
 * changed_since_run: the file's current state is not what the run left (a later edit, or the
 * file is gone). missing_snapshot: no original was kept for this path. io_error: reading or
 * writing this file failed. missing_record: an original was kept for this path but the journal
 * has no `file_changed` for it (the run stopped between the snapshot and the record), so the
 * state the run left is unknown and the file is not touched (T-10).
 * already_reverted (N-22): the file is already as it was before the run (its current hash equals
 * the first `previousHash` recorded for it, or it is absent when the run created it). Nothing is
 * left to do for it, so it does not make the outcome partial.
 * original_path_taken (G-A): a moved or discarded file cannot go back because something now
 * exists at its original path; nothing is replaced.
 * unsafe_move (DR-24 b, DR-25): the file could go back only by a rename that does not refuse an
 * existing destination (no hard links on that volume), and the request has no consent for this
 * revert (RevertRequest.unsafeMoveConsent); it is not moved. Reverting again with consent moves it.
 */
export const REVERT_SKIP_REASONS = [
  "changed_since_run",
  "missing_snapshot",
  "io_error",
  "missing_record",
  "already_reverted",
  "original_path_taken",
  "unsafe_move",
] as const;
export type RevertSkipReason = (typeof REVERT_SKIP_REASONS)[number];

/**
 * `path` is the path from the journal's `file_changed` record: relative to the workspace root,
 * `/` separated, masked when it was recorded. It never comes from the snapshot.
 */
export interface RevertedFile {
  readonly path: string;
  /** `deleted`: the run created the file (its original is `null`). */
  readonly action: RevertAction;
  /**
   * G-A: for `moved_back`, the masked path the file was moved back from (the record's `to`). For a
   * moved or discarded file `path` is the place it returned to. Absent for the other actions.
   */
  readonly from?: string;
  /** DR-25: present and true when the file was moved back unsafely, with consent. Never in a dry run. */
  readonly unsafe?: true;
}

export interface SkippedFile {
  /**
   * As for RevertedFile, except `missing_record`: there is no journal record, so the path comes
   * from the snapshot index. That is the path as the workspace resolved it, not masked; a file
   * name that holds a registered secret would show it.
   */
  readonly path: string;
  readonly reason: RevertSkipReason;
}

export interface RevertOutcome {
  readonly reverted: readonly RevertedFile[];
  readonly skipped: readonly SkippedFile[];
  /**
   * DR-25, dry run only: present and true when `reverted` lists a file that would be moved back
   * (`moved_back`, `restored_from_discard`). A dry run does not check whether this drive can move
   * files back without risk of replacing one (it creates nothing, N-7); the real revert checks it
   * before each move and, without the person's consent, skips the files it cannot move safely as
   * `unsafe_move`. So such a file may still be skipped by the real revert.
   */
  readonly moveSafetyUnchecked?: true;
}

/**
 * The codes `revertRun` rejects with (an error carrying one of them as `code`), always before it
 * changes anything, also with `dryRun`. The CLI prints each as CliErrorOutput with that code:
 * - run_not_found: the workspace has no journal for that run
 * - invalid_run_record: the run's records cannot be read or parsed, or fail a check
 * - plan_run_missing (R-9c C-1): an apply run whose plan run (`apply_started.planRunId`) has no
 *   directory or no plan.json any more, so its files' real paths are not known
 */
export const REVERT_ERROR_CODES = ["run_not_found", "invalid_run_record", "plan_run_missing"] as const satisfies readonly CliErrorCode[];
export type RevertErrorCode = (typeof REVERT_ERROR_CODES)[number];

/** DR-14: why a run's original of a path is not given. Moved from the store as it was. */
export type OriginalUnavailable = "masked_path" | "snapshot_missing" | "not_text" | "too_large" | "unreadable";

/**
 * DR-29: how the run masked one changed path, as recorded by ChangeRecorder (`saveOriginal`'s
 * `shownOriginal` and the last `saveNext`). Visible parts only (MaskedParts): no secret value, no
 * token, no hash of a secret.
 */
export interface ChangeShown {
  /** The original masked by the run's gateway; null when the run created the file. */
  readonly original: MaskedParts | null;
  /** The last text the run wrote: its SHA-256 (the path's last `newHash`) and its visible parts. Null when none was recorded. */
  readonly next: { readonly sha256: ContentHash; readonly parts: MaskedParts } | null;
}

/**
 * DR-14: one changed path of a run and its original, for a comparison view. Moved from the store
 * (`src/store/changes.ts`) as it was, with DR-29's `shown`.
 */
export interface RunOriginal {
  /** As the journal recorded it (masked). */
  readonly path: string;
  /** The run created the file: there is no original. */
  readonly created: boolean;
  /** The path's first `previousHash` (the state before the run), null when the run created it. */
  readonly before: ContentHash | null;
  /** The path's last `newHash` (the state the run left). */
  readonly after: ContentHash;
  /**
   * The original as UTF-8 text (raw local text, R-8: mask it before it leaves the process), why it
   * is not given, or null for a created file.
   */
  readonly original: { readonly text: RawText } | { readonly unavailable: OriginalUnavailable } | null;
  /**
   * DR-29: how the run masked the original and the text it left, when the run recorded it (runs
   * from DR-29 on) and the record passed the store's checks. Absent otherwise. A view shows the
   * text only when changeShownMatches holds for it.
   */
  readonly shown?: ChangeShown;
}

/**
 * Signature of `readRunOriginals`, exported by `src/store/index.ts` (DR-14, DR-29). Reads only.
 * Rejects like `revertRun`: `run_not_found`, `invalid_run_record`.
 */
export type ReadRunOriginals = (request: { readonly workspaceRoot: string; readonly runId: string }) => Promise<RunOriginal[]>;

/**
 * DR-29: what a comparison view has now for one changed path: the run's original masked with the
 * secrets registered now (null when the run created the file), and the file as it is now, its
 * SHA-256 and its text masked now (null when it cannot be read as text).
 */
export interface ChangeNow {
  readonly original: string | null;
  readonly current: { readonly sha256: ContentHash; readonly masked: string } | null;
}

/**
 * DR-29: true when a view may show the masked texts of a changed path: the run recorded how it
 * masked them (`shown` with `next`), the file is still the text the run left (same SHA-256), and
 * the secrets registered now leave exactly the same text visible in both, the original and the
 * current file (sameMaskedParts), as DR-28 does for plans. Otherwise the view shows the path and
 * its state only. A created file needs `shown.original` null and `now.original` null.
 */
export function changeShownMatches(shown: ChangeShown | undefined, now: ChangeNow): boolean {
  if (shown === undefined || shown.next === null || now.current === null) return false;
  if (now.current.sha256 !== shown.next.sha256) return false;
  if (!sameMaskedParts(maskedParts(now.current.masked), shown.next.parts)) return false;
  if (shown.original === null || now.original === null) return shown.original === null && now.original === null;
  return sameMaskedParts(maskedParts(now.original), shown.original);
}

/**
 * Signature of `revertRun`, exported by `src/store/index.ts`.
 *
 * - Reads `<root>/.codaryn/runs/<runId>/journal.jsonl`. Every distinct path of its
 *   `file_changed` records is handled once, in order of first appearance. The `newHash` of the
 *   path's last `file_changed` record is the state the run left.
 * - When the file's current hash equals that `newHash`, the snapshot is written back as UTF-8
 *   (the original bytes), or the file is deleted when the snapshot says it did not exist.
 *   Otherwise the file is not touched and is reported in `skipped`.
 * - A path recorded with a privacy token cannot be matched to its snapshot and is reported as
 *   `missing_snapshot`.
 * - A path in the snapshot index that has no `file_changed` record is reported as
 *   `missing_record` and not touched, so the outcome is partial (T-10). A path recorded with a
 *   token therefore shows up twice: masked as `missing_snapshot`, unmasked as `missing_record`.
 * - A last journal line that was cut off (no final LF, not parseable) is ignored (T-10).
 * - A failure on one file is reported for that file and the others continue. It rejects only
 *   when the journal cannot be read or another line cannot be parsed, or (an apply run) its plan
 *   cannot be used, and then nothing was changed. The codes are REVERT_ERROR_CODES.
 * - The caller holds the workspace lock while it runs. Nothing is written to the run's journal.
 * - With `dryRun` (N-7) the same decisions are made and reported, and nothing is changed; the
 *   caller takes no lock. Errors are the same.
 * - G-A, an apply run (its journal starts with `apply_started`, ApplyJournalEvent): its
 *   `file_moved` and `file_discarded` records are handled in reverse order. A moved file goes back
 *   from `to` to `from` when the file at `to` has the recorded SHA-256 and nothing exists at
 *   `from`; a discarded file goes back from `.codaryn/discarded/<runId>/` (DR-9) the same way.
 *   Otherwise it is skipped (`changed_since_run`, `original_path_taken`). Renames only: nothing is
 *   copied or replaced. Directories the apply created are left in place.
 *   - DR-24 (f): the records' paths are masked, so the real paths come from the plan run's
 *     plan.json (StoredPlan.actions, by `index`). Before any of it is used, the SHA-256 of
 *     plan.json's bytes must equal the apply journal's `apply_started.digest`, and the plan must
 *     name `apply_started.planRunId`; otherwise the revert rejects as `invalid_run_record` and
 *     changes nothing (also with `dryRun`). R-9c C-1: when the plan run's directory or its
 *     plan.json does not exist at all, it rejects as `plan_run_missing` instead, so the person
 *     learns the cause (a deleted plan run), not "damaged records". Each record's `sha256` must equal the plan action's.
 *   - DR-24 (a): a discarded file is read only at `.codaryn/discarded/<runId>/<stored>`, where the
 *     discarded directory and the run's directory in it are plain directories (not links) and
 *     `stored` is one segment matching DISCARDED_STORED_NAME_PATTERN_SOURCE and equal to the
 *     record's `index` (plan.ts). A record whose `stored` is anything else is `invalid_run_record`;
 *     a file there that is a link is skipped (`changed_since_run`).
 *   - DR-24 (b): a move back is made like an apply's move (refusing an existing destination). When
 *     that cannot be done on the volume, the file is skipped as `unsafe_move`; nothing falls back
 *     to "check, then rename" on its own.
 *   - DR-25: with the person's consent for this revert (`unsafeMoveConsent` naming this `runId`),
 *     such a file goes back by a plain rename made right after checking that its original path is
 *     still free, and is reported `unsafe: true`. A consent for another run counts as none. Files
 *     that can go back safely are moved safely either way. The CLI writes the consent channel and
 *     the number of unsafe moves into revert.json (RevertRecord).
 *   - With `dryRun` nothing is created, not even a probe (N-7), so whether the volume has hard links
 *     is not judged: a file that could go back is listed in `reverted` without `unsafe`, no file is
 *     skipped as `unsafe_move`, and the consent is not used. The outcome says so with
 *     `moveSafetyUnchecked` whenever it lists such a file. The real revert checks it.
 *   - R-9 I-4: an action with a `plan_item_started` record (PlanItemStartedEvent) but neither a
 *     `file_moved`/`file_discarded` nor a `plan_item_failed` for its index may or may not have
 *     been done (the process ended in between). It is handled in the same reverse order, with the
 *     real paths from the plan as above and the masked paths of the start record:
 *     - done: the file with the action's SHA-256 is at `to` (a move) or at
 *       `.codaryn/discarded/<runId>/<discardedStoredName(index)>` (a discard), and nothing exists
 *       at the original path. It goes back as a recorded one would (`moved_back`,
 *       `restored_from_discard`).
 *     - not done: the file with that SHA-256 is still at its original path and nothing is at the
 *       destination. Nothing is to be reverted and it is not listed.
 *     - cut between the link and the removal of the source (R-15 L-1): see below.
 *     - anything else: skipped as `changed_since_run`; nothing is touched.
 *   - R-15 L-1: a move is a hard link and then the removal of the source, so a process that ends
 *     between the two leaves one file under two names. When the original path and the name the
 *     action added (the destination of a move, or the discarded copy of a discard) both hold the
 *     action's SHA-256 and are one file (the same device and file id), the added name is removed and
 *     the file stays at its original path (`moved_back`, `restored_from_discard`). This holds for a
 *     started action and for a recorded one (a revert's own move back cut at the same point). The
 *     added name is first moved to a new name inside the state directory and removed only while it
 *     is still that file there; otherwise it is put back without replacing anything and is not
 *     removed. Two names that hold the same content but are different files are not this case:
 *     a started action is then `changed_since_run`, a recorded one `original_path_taken`.
 *   - An action with a `plan_item_failed` record was not done and is not listed.
 */
export type RevertRun = (request: RevertRequest) => Promise<RevertOutcome>;
