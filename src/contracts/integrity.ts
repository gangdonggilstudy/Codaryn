/**
 * Integrity of protected material (U-1, U-2). The policy gate keeps the file tools from writing
 * `policy.protectedPaths`, but commands allowed by the policy can still change files. The engine
 * therefore takes a SHA-256 list of the protected material when the run starts and compares it
 * again before and after each verification round. A difference makes that verification invalid.
 * This is detection after the fact, not isolation: it cannot stop a change, only refuse to trust
 * a verification that ran on changed material.
 */

import type { ContentHash, RawText } from "./text.js";
import type { Workspace } from "./workspace.js";

/** Most entries in the config file's `integrity.paths`. More is `invalid_config`. */
export const MAX_INTEGRITY_PATHS = 64;

/** Most files (and links) one capture hashes, over all protected entries together. */
export const MAX_INTEGRITY_FILES = 10_000;

/** Most bytes one capture hashes, over all files together (256 MiB). */
export const MAX_INTEGRITY_BYTES = 256 * 1024 * 1024;

/**
 * One path of a manifest. `path` is local text (file names read from disk), so it is RawText:
 * the engine masks it before it is recorded or printed.
 *
 * - file: a regular file and the SHA-256 of its exact bytes
 * - link: a symbolic link or junction below a protected entry; `sha256` is the SHA-256 of its
 *   target text as the link stores it. W-2 (architecture 11, A-3): when its real target is inside
 *   the workspace and outside the state directory, the target's content is listed too, under the
 *   target's own workspace-relative path; a target outside the workspace is not (only
 *   `externalPaths` checks such content). See `IntegrityChecker.capture`.
 * - absent: a protected entry that does not exist
 * - unchecked: a path that could not be hashed. `unreadable`: it could not be read or listed
 *   (permissions, a lock, an I/O error, a special file, a link whose target cannot be resolved for
 *   another reason than being missing). `limit`: MAX_INTEGRITY_FILES or MAX_INTEGRITY_BYTES was
 *   reached, see `IntegrityChecker.capture`.
 */
export type IntegrityEntry =
  | { readonly path: RawText; readonly kind: "file"; readonly sha256: ContentHash }
  | { readonly path: RawText; readonly kind: "link"; readonly sha256: ContentHash }
  | { readonly path: RawText; readonly kind: "absent" }
  | { readonly path: RawText; readonly kind: "unchecked"; readonly why: "unreadable" | "limit" };

/**
 * Local-only list of protected material at one moment. Never recorded, printed or sent.
 * Directories have no entry of their own: a directory is the set of entries below it.
 */
export interface IntegrityManifest {
  /** Sorted by `path` in code unit order. No two entries have the same `path`. */
  readonly entries: readonly IntegrityEntry[];
}

export const INTEGRITY_PHASES = ["run_start", "before_verify", "after_verify"] as const;
/** When the engine checks, see `EngineDeps.integrity`. */
export type IntegrityPhase = (typeof INTEGRITY_PHASES)[number];

export interface IntegrityChecker {
  /**
   * Hashes every protected entry as it is now. Never rejects for a file-level problem: such a
   * path becomes an `unchecked` entry. Display paths:
   * - a `protectedPaths` entry and everything below it: relative to the workspace root, `/`
   *   separated, starting with the entry normalized (`\` becomes `/`, empty and "." segments are
   *   dropped, so "./tests/" is "tests"); an entry that normalizes to nothing (".") lists the
   *   root's contents and is itself shown as ".". The state directory (`STATE_DIR_NAME` at the
   *   root) is never entered, and an entry at or under it adds nothing.
   * - an `externalPaths` entry and everything below it: absolute, `/` separated.
   * A protected entry that is itself a link is followed to its real path (T-13). A link below an
   * entry is recorded as `link` and, W-2, its real target inside the workspace is listed too under
   * the target's own path (a directory reached so is entered once per capture, which ends cycles;
   * that content counts toward the entry's limits). When the file or byte limit is reached, the
   * entry being listed and every later entry each become one `unchecked`/`limit` entry at the
   * entry's own display path, and their other entries are dropped.
   */
  capture(): Promise<IntegrityManifest>;

  /**
   * Display paths that changed from `before` to `after`, sorted in code unit order, no duplicates:
   * a path present in only one manifest, a path whose kind or sha256 differs, and every path that
   * is `unchecked` in either manifest (it cannot be shown unchanged). Pure; reads nothing.
   * `compare(m, m)` therefore lists exactly the `unchecked` paths of `m`.
   */
  compare(before: IntegrityManifest, after: IntegrityManifest): readonly RawText[];
}

export interface IntegrityCheckerOptions {
  readonly workspace: Workspace;
  /** `policy.protectedPaths` as the task or config file gave it (format already checked). */
  readonly protectedPaths: readonly string[];
  /**
   * The config file's `integrity.paths` after the CLI's checks: absolute, local, existing when
   * the run started, and outside the workspace (see `IntegrityConfig`).
   */
  readonly externalPaths: readonly string[];
}

/** Signature of `createIntegrityChecker`, exported by `src/verify/index.ts` (K2). */
export type CreateIntegrityChecker = (options: IntegrityCheckerOptions) => IntegrityChecker;
