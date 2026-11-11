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

export interface Workspace {
  /** Real absolute path of the workspace root. */
  readonly root: string;

  /** Resolves links and `..`, then rejects paths outside the root or inside the state directory. */
  resolve(path: string, access: PathAccess): Promise<ResolvePathOutcome>;

  /** Reads a UTF-8 text file up to MAX_READ_BYTES. */
  readText(path: ResolvedPath): Promise<ReadTextOutcome>;

  /** Lists a directory recursively up to MAX_SEARCH_ENTRIES, skipping the state directory. */
  list(dir: ResolvedPath): Promise<ListOutcome>;

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
