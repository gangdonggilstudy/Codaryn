/**
 * Change snapshots and revert (phase 2, R-6 to R-8).
 *
 * Before a file tool changes a file, it hands the file's original text to a ChangeRecorder.
 * The recorder keeps it under `<workspaceRoot>/.codaryn/runs/<runId>/snapshots/`. A revert puts
 * the originals back later, also after the process that ran the task has ended.
 *
 * Snapshots are raw local text and may hold secrets (R-8). They are kept like the workspace files
 * themselves: never written to the journal, never sent to a model, never printed. No tool can
 * reach them, because they live in the state directory. They stay until the user deletes the run
 * directory; nothing removes them automatically.
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
}

export type RevertAction = "restored" | "deleted";

/**
 * changed_since_run: the file's current state is not what the run left (a later edit, or the
 * file is gone). missing_snapshot: no original was kept for this path. io_error: reading or
 * writing this file failed.
 */
export type RevertSkipReason = "changed_since_run" | "missing_snapshot" | "io_error";

/**
 * `path` is the path from the journal's `file_changed` record: relative to the workspace root,
 * `/` separated, masked when it was recorded. It never comes from the snapshot.
 */
export interface RevertedFile {
  readonly path: string;
  /** `deleted`: the run created the file (its original is `null`). */
  readonly action: RevertAction;
}

export interface SkippedFile {
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
 * - A failure on one file is reported for that file and the others continue. It rejects only
 *   when the journal cannot be read or parsed, and then nothing was changed.
 * - The caller holds the workspace lock while it runs. Nothing is written to the run's journal.
 */
export type RevertRun = (request: RevertRequest) => Promise<RevertOutcome>;
