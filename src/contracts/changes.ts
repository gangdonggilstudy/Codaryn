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

import type { RawText } from "./text.js";
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
   */
  saveOriginal(path: ResolvedPath, original: RawText | null): Promise<void>;
}

export interface ChangeRecorderOptions {
  /** Real absolute path of the workspace root. */
  readonly workspaceRoot: string;
  readonly runId: string;
}

/** Signature of `createChangeRecorder`, exported by `src/store/index.ts`. */
export type CreateChangeRecorder = (options: ChangeRecorderOptions) => ChangeRecorder;

export interface RevertRequest {
  /** Real absolute path of the workspace root. */
  readonly workspaceRoot: string;
  readonly runId: string;
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
  /** When the revert finished, ISO 8601 UTC. */
  readonly at: string;
  readonly status: "complete" | "partial";
  /** Number of files reverted and skipped. */
  readonly reverted: number;
  readonly skipped: number;
}

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
 * original_path_taken (G-A): a moved or discarded file cannot go back because something now
 * exists at its original path; nothing is replaced.
 */
export const REVERT_SKIP_REASONS = ["changed_since_run", "missing_snapshot", "io_error", "missing_record", "original_path_taken"] as const;
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
 *   when the journal cannot be read or another line cannot be parsed, and then nothing was
 *   changed.
 * - The caller holds the workspace lock while it runs. Nothing is written to the run's journal.
 * - With `dryRun` (N-7) the same decisions are made and reported, and nothing is changed; the
 *   caller takes no lock. Errors are the same.
 * - G-A, an apply run (its journal starts with `apply_started`, ApplyJournalEvent): its
 *   `file_moved` and `file_discarded` records are handled in reverse order. A moved file goes back
 *   from `to` to `from` when the file at `to` has the recorded SHA-256 and nothing exists at
 *   `from`; a discarded file goes back from `.codaryn/discarded/<runId>/` (DR-9) the same way.
 *   Otherwise it is skipped (`changed_since_run`, `original_path_taken`). Renames only: nothing is
 *   copied or replaced. Directories the apply created are left in place.
 */
export type RevertRun = (request: RevertRequest) => Promise<RevertOutcome>;
