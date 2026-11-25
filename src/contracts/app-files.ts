/** App-layer file views and workspace text contracts. Type-only; re-exported by app.ts. */

import type { ChangesApplyRun } from "./commands.js";
import type { ContentHash, MaskedText } from "./text.js";
import type { TaskForm } from "./app-core.js";

/**
 * DR-7: the changes of one run, masked again with the secrets a run with the same settings
 * registers now (the run's own mapping is gone when it ends). Adapters show these texts only; they
 * never read the snapshot directory themselves.
 */
export interface ChangesRequest {
  /** The task form the run was started with; it decides the secrets and the workspace (DR-17). */
  readonly settings: TaskForm;
  /** A run id or "latest". */
  readonly runId: string;
}

/**
 * U-234 (R-107 O-1): how a changes view may be given up. `signal`, once aborted, ends the waits of a
 * read in a burst of changes (U-213: up to GUARD_PAUSES_MS, 750 ms, per file) and starts no try more;
 * a file still changing is then `unreadable`, as when its tries ran out. Absent: the reads wait.
 */
export interface ChangesOptions {
  readonly signal?: AbortSignal;
}

export type ChangedFileUnavailable =
  /** The recorded path holds a privacy token, so the file cannot be found from it. */
  | "masked_path"
  /** No usable original was kept (none recorded, or it is not the state the run replaced). */
  | "snapshot_missing"
  /** The original or the current file is not UTF-8 text. */
  | "not_text"
  /** Larger than MAX_READ_BYTES. */
  | "too_large"
  | "unreadable"
  /** Masking failed; no text is given. */
  | "mask_failed"
  /**
   * R-11, DR-28 principle, DR-29: the text is shown only when the secrets registered now mask it as
   * the run did, by the run's record (changeShownMatches). Not so here: other secrets, a file
   * changed after the run, a run without a record, or a record that does not match. The path and
   * the state are given.
   */
  | "masking_unverified";

export interface ChangedFileView {
  /** As the journal recorded it (masked). */
  readonly path: MaskedText;
  /** The run created the file: there is no original. */
  readonly created: boolean;
  /**
   * as_run_left: the file's hash is the one the run left. changed_since_run: it was changed later.
   * missing: it no longer exists. unknown: it could not be read.
   */
  readonly state: "as_run_left" | "changed_since_run" | "missing" | "unknown";
  /** The original, masked. Null when the run created the file or it is unavailable. */
  readonly before: MaskedText | null;
  /** The current content, masked. Null when the file is missing or unavailable. */
  readonly after: MaskedText | null;
  /** Why `before` or `after` is missing although the file has one; null when both are given as expected. */
  readonly unavailable: ChangedFileUnavailable | null;
}

export interface ChangesOutput {
  readonly schemaVersion: 1;
  readonly kind: "changes";
  readonly runId: string;
  /** Always 0: reading the changes is not a judgement of them. */
  readonly exitCode: 0;
  /** Always "current_secrets": masked with the secrets registered now, not with the run's table. */
  readonly masking: "current_secrets";
  /** One entry per changed path, in the order the run first changed them. */
  readonly files: readonly ChangedFileView[];
  /**
   * U-16 (UXM-4): for an apply run only, the plan run it applied and how many actions it applied
   * (ChangesApplyRun). Its moves and discards are its plan's actions, not file writes of its own, so
   * `files` is empty; its report lists them. Judged as the run list judges the run; absent while
   * the apply has no result yet (the number of actions is not known then).
   */
  readonly applyRun?: ChangesApplyRun;
  /**
   * U-43 (DR-38): the run has a records-changed mark (contracts/state.ts), judged by the store's
   * hasRecordsChangedMark as `report` and `revert` judge it; a mark that cannot be checked counts.
   * Such a run has no text of its files (the store gives no `shown` record), only paths and states.
   * Absent: no mark.
   */
  readonly recordsChanged?: true;
}

/** U-89 (GUI 3.3): one directory of the workspace these settings resolve to (adapter-contract 5.12). */
export interface ListWorkspaceDirRequest {
  /** The workspace, the values registered now for masking and the protected paths (DR-17, U-17). */
  readonly settings: TaskForm;
  /** "" for the root, else plain relative segments joined by "/" (workspace-dir.ts isWorkspaceDir). */
  readonly dir: string;
  /** From 0: the previous page's `nextOffset`. */
  readonly offset: number;
  /** 1 to WORKSPACE_PAGE_SIZE (500); 500 when left out. */
  readonly limit?: number;
}

/** U-89: what an entry is. A `link` (link or junction) and the root's `state` are never listed in turn. */
export type WorkspaceEntryKind = "dir" | "file" | "link" | "state" | "other";

export interface WorkspaceEntry {
  /** The real name, for the adapter's own child paths only. Null for a masked entry: its real name never leaves the app layer. */
  readonly name: string | null;
  /** The name as shown (masked); "" when it cannot be shown at all. */
  readonly shown: MaskedText;
  readonly kind: WorkspaceEntryKind;
  /** The shown name is not the real one: the entry cannot be opened or chosen. */
  readonly masked: boolean;
  /** The effective policy's protected paths cover it. */
  readonly protected: boolean;
}

/**
 * U-89: a page of the directory, or why it is not listed. These are outcomes of reading, not call
 * errors: `refused` (outside the root, the state directory, a name the workspace rules reject, or a
 * link or junction on the way), `not_found`, `not_dir`, `too_large` (more than
 * MAX_WORKSPACE_DIR_ENTRIES entries; never listed in part) and `unreadable`.
 */
export type WorkspaceDirListing =
  | {
      readonly kind: "workspace_dir";
      readonly status: "listed";
      readonly masking: "current_secrets";
      /** Directories (and `state`) first, then the rest, each in a fixed order. */
      readonly entries: readonly WorkspaceEntry[];
      readonly total: number;
      readonly offset: number;
      readonly nextOffset: number | null;
    }
  | { readonly kind: "workspace_dir"; readonly status: "not_found" | "not_dir" | "too_large" | "refused" | "unreadable" };

/** U-172 (DR-72, GUI text editing): a text file of the workspace these settings resolve to, for a person (adapter-contract 5.15). */
export interface ReadWorkspaceTextRequest {
  /** The workspace, the values registered now for masking, the protected paths and the files the settings name (DR-17, U-17). */
  readonly settings: TaskForm;
  /** Plain relative segments joined by "/", as a listing's names give them (workspace-text.ts isWorkspaceFile). */
  readonly path: string;
}

/**
 * U-172: the file's line ending. `none`: no line break at all. `mixed`: CRLF with LF, or a CR alone;
 * such a file is read only (a textarea gives LF everywhere, so one ending could not be put back).
 */
export type WorkspaceTextLineEnding = "lf" | "crlf" | "none" | "mixed";

/**
 * U-172 (DR-72): why an opened file cannot be edited here, in this order:
 * - `masked`: the registered values, a key value or a key shape are in it (the shown text is not the file's);
 * - `control_characters`: a control, line separator or bidirectional character is shown replaced;
 * - `mixed_line_endings`: see WorkspaceTextLineEnding;
 * - `protected`: the effective policy's protected paths cover it (first version: read only);
 * - `settings_file`: the config, task or variables file these settings name;
 * - `read_only`: the file itself cannot be written (its read-only attribute or permissions);
 * - `hard_link`: it has more than one name; an atomic write would part them;
 * - `workspace_locked`: a run, apply or revert holds the workspace now.
 */
export type WorkspaceTextReadOnlyReason =
  | "masked"
  | "control_characters"
  | "mixed_line_endings"
  | "protected"
  | "settings_file"
  | "read_only"
  | "hard_link"
  | "workspace_locked";

/**
 * U-172: the file as shown, or why it is not opened: `refused` (outside the root, the state
 * directory, a name the workspace rules reject, a link or junction on the way), `not_found`,
 * `not_file`, `too_large` (more than MAX_READ_BYTES), `not_text` (not UTF-8, or a NUL byte),
 * `unreadable`, `mask_failed`. A file not opened gives no text.
 */
export type WorkspaceText =
  | {
      readonly kind: "workspace_text";
      readonly status: "opened";
      /** The path asked for. */
      readonly path: string;
      /**
       * The text as shown: without the BOM, every CRLF as LF, then masked with the values registered
       * now, key values and key shapes hidden, and control characters replaced (LF and TAB kept).
       * When `editable`, it is exactly the file's text (BOM and CRLF aside): showing it changed
       * nothing, and showing it again changes nothing.
       */
      readonly text: MaskedText;
      readonly masking: "current_secrets";
      /** Masking (the registered values, key values, key shapes) changed the text. */
      readonly masked: boolean;
      readonly protected: boolean;
      readonly lineEnding: WorkspaceTextLineEnding;
      /** The file starts with a byte order mark (kept on a write). */
      readonly bom: boolean;
      /** SHA-256 of the bytes read: the `baseDigest` a write needs. */
      readonly digest: ContentHash;
      readonly bytes: number;
      readonly editable: boolean;
      /** Empty when `editable`. */
      readonly readOnlyReasons: readonly WorkspaceTextReadOnlyReason[];
    }
  | {
      readonly kind: "workspace_text";
      readonly status: "not_found" | "not_file" | "refused" | "too_large" | "not_text" | "unreadable" | "mask_failed";
      readonly path: string;
    };

/** U-172: a person's edit of a file read with readWorkspaceText (adapter-contract 5.15). */
export interface WriteWorkspaceTextRequest {
  readonly settings: TaskForm;
  readonly path: string;
  /** The whole new text as the window has it: LF line breaks (a textarea's), no BOM. */
  readonly text: string;
  /** The `digest` readWorkspaceText gave (or the last write's): the file must still be those bytes. */
  readonly baseDigest: string;
}

/** U-172: what in a new text keeps it from being written (the editor never holds text that showing would change). */
export type WorkspaceTextProblem =
  /** The registered values, a key value or a key shape: masking would change it. */
  | "masked"
  /** A CR or another control, line separator or bidirectional character. */
  | "control_characters"
  /** More than MAX_READ_BYTES once its line ending and BOM are put back. */
  | "too_large";

/**
 * U-172: the write's outcome.
 * - `written`: atomically; `digest` is the file's now (the next write's base).
 * - `unchanged`: the text is the file's already; nothing was written.
 * - `conflict`: the file is not the bytes of `baseDigest` (another editor or a run changed it).
 * - `workspace_locked`: a run, apply or revert holds the workspace; nothing was judged or written.
 * - `not_editable`: judged again now, it cannot be edited here (`readOnlyReasons`).
 * - `text_refused`: the new text cannot be written (`textProblems`).
 * - `not_found` .. `mask_failed`: as readWorkspaceText's (`refused` also when a folder on the path
 *   changed during the write's checks; nothing was written); `write_failed`: the write did not happen.
 * - `path_changed` (V-1 H-1): right after the rename a folder on the path is not the one opened, or
 *   the file there is not the one written. A swap in the instant before the rename cannot be
 *   prevented (no rename by folder handle in Node); it is told: where the text went cannot be said.
 * Nothing goes into the run records. `lockLeft`: the lock could not be taken back, the release failed
 * or answered false (told, never hidden).
 */
export interface WorkspaceTextWritten {
  readonly kind: "workspace_text_write";
  readonly status:
    | "written"
    | "unchanged"
    | "conflict"
    | "workspace_locked"
    | "not_editable"
    | "text_refused"
    | "not_found"
    | "not_file"
    | "refused"
    | "too_large"
    | "not_text"
    | "unreadable"
    | "mask_failed"
    | "write_failed"
    | "path_changed";
  readonly path: string;
  /** `written` and `unchanged`: the file's digest now. Null otherwise. */
  readonly digest: ContentHash | null;
  readonly readOnlyReasons: readonly WorkspaceTextReadOnlyReason[];
  readonly textProblems: readonly WorkspaceTextProblem[];
  readonly lockLeft: boolean;
}
