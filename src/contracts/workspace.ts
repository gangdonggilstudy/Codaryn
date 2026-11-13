/**
 * Workspace: safe file primitives under one root.
 * It knows nothing about masking, models or Git.
 */

import type { ContentHash, RawText } from "./text.js";
import type { PathAccess } from "./tool.js";

declare const resolvedPathBrand: unique symbol;

/** A path proven to be inside the workspace root. Obtain it only from `Workspace.resolve`. */
export interface ResolvedPath {
  readonly [resolvedPathBrand]: true;
  /** Absolute path after resolving links and `..` segments. */
  readonly absolute: string;
  /** Path relative to the root, `/` separated. "." is the root itself. */
  readonly relative: string;
}

export type ResolvePathOutcome =
  | { readonly ok: true; readonly path: ResolvedPath }
  | { readonly ok: false; readonly code: "outside_root" | "state_dir" | "invalid_path" };

/**
 * Local-only snapshot of a file at read time. It holds raw text and never leaves the process:
 * not to a model, not to the journal, not to Git. Phase 1a keeps snapshots in memory only.
 */
export interface LocalSnapshot {
  readonly path: ResolvedPath;
  readonly hash: ContentHash;
  /** Exact UTF-8 decoding of the file bytes, including a leading U+FEFF when the file has a BOM. */
  readonly text: RawText;
}

export type ReadTextOutcome =
  | { readonly ok: true; readonly snapshot: LocalSnapshot }
  | { readonly ok: false; readonly code: "not_found" | "not_text" | "too_large" | "io_error" };

export interface ListEntry {
  readonly relative: string;
  readonly kind: "file" | "dir";
}

export type ListOutcome =
  | {
      readonly ok: true;
      /** Recursive, sorted by `relative` in code unit order. Links are listed but not followed. */
      readonly entries: readonly ListEntry[];
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly code: "not_found" | "io_error" };

export interface WriteTextRequest {
  readonly path: ResolvedPath;
  /** Hash the caller last read, or `null` to state that the file must not exist. Required. */
  readonly expectedHash: ContentHash | null;
  /** Complete new text. It is encoded as UTF-8 exactly as given. */
  readonly text: RawText;
}

export type WriteTextOutcome =
  | {
      readonly ok: true;
      readonly previousHash: ContentHash | null;
      readonly newHash: ContentHash;
      readonly created: boolean;
    }
  | {
      readonly ok: false;
      /** `conflict`: the current state differs from `expectedHash`. Nothing was written. */
      readonly code: "conflict" | "io_error";
      /** Current hash on conflict, `null` when the file does not exist. */
      readonly currentHash?: ContentHash | null;
    };

/**
 * U-213 (ne-verify's measurement of read refusals, P5): how a read or a listing that saw the folders
 * on its path change may try again (src/workspace/guard.ts). Both are optional; a caller that gives
 * neither gets the tries and waits alone (a listing is still limited in time, see `list`).
 * - `signal`: aborted, the waits between tries end at once and no try more starts (a run cancelled).
 * - `retryUntil`: a time of `performance.now()` at or after which no try after the first starts, so
 *   a search's listing and its many reads share one time limit.
 */
export interface GuardedCallOptions {
  readonly signal?: AbortSignal;
  readonly retryUntil?: number;
}

/**
 * U-242: Workspace.list's options, GuardedCallOptions and `leaveOut`, through which search_files
 * keeps a run's unreadable paths out of its listing (U-203, Codex V-13): one listing, the
 * workspace's, with or without them.
 */
export interface ListOptions extends GuardedCallOptions {
  /**
   * Asked once for each entry the listing meets, with its root-relative path and whether it is a
   * link (neither a folder nor a file: a link, a junction, another special entry), before the entry
   * is kept. True leaves it out: it is not listed, not counted toward MAX_SEARCH_ENTRIES, and a
   * folder is not read, so what it leaves out changes neither `entries`, `truncated` nor the outcome.
   * A throw ends the listing as io_error. Absent: nothing is left out, as without options.
   */
  readonly leaveOut?: (entry: { readonly relative: string; readonly link: boolean }) => boolean | Promise<boolean>;
}

export interface Workspace {
  /** Real absolute path of the workspace root. */
  readonly root: string;

  /** Resolves links and `..`, then rejects paths outside the root or inside the state directory. */
  resolve(path: string, access: PathAccess): Promise<ResolvePathOutcome>;

  /** Reads a UTF-8 text file up to MAX_READ_BYTES. */
  readText(path: ResolvedPath, options?: GuardedCallOptions): Promise<ReadTextOutcome>;

  /**
   * Lists a directory recursively up to MAX_SEARCH_ENTRIES, skipping the state directory. U-213: its
   * tries again are limited in time too, by `retryUntil` or else 2 s from the call. U-242: what
   * `options.leaveOut` answers true for is left out before it is counted (ListOptions).
   */
  list(dir: ResolvedPath, options?: ListOptions): Promise<ListOutcome>;

  /**
   * Compares the current hash with `expectedHash` and replaces the file atomically.
   * On any failure the previous content stays intact.
   */
  writeText(request: WriteTextRequest): Promise<WriteTextOutcome>;
}

export interface WorkspaceOptions {
  /** Existing directory. Absolute path. */
  readonly root: string;
}

/** Signature of `createWorkspace`, exported by `src/workspace/index.ts`. */
export type CreateWorkspace = (options: WorkspaceOptions) => Promise<Workspace>;
