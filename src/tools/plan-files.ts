/**
 * File checks and moves shared by `propose_plan`, `inspect_files` and the plan executor (G-C).
 * Design: docs/design/general-tasks.md 5.3 and 6. Contracts: src/contracts/plan.ts, tool.ts.
 *
 * Every path a caller works on comes from `Workspace.resolve`, so it is inside the root and not
 * in the state directory. These helpers add what the workspace does not offer: file type and size
 * without following the last link, a streaming SHA-256 bound to the file that was checked, and a
 * rename that never replaces an existing file.
 */

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import type { BigIntStats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { ContentHash, PathAccess, PlanItemProblem, ResolvedPath, Workspace } from "../contracts/index.js";

/** Bytes read per step while hashing. */
const HASH_CHUNK_BYTES = 1024 * 1024;

export function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** ENOTDIR counts as missing: some parent is a file, so nothing exists at the path. */
export function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Comparison key for a root-relative path. Windows and (by default) macOS ignore case, so two
 * paths that differ only in case name one file there. Folding is conservative on case-sensitive
 * macOS volumes: a plan that only changes a name's case is refused as `same_path`.
 */
export function pathKey(relative: string, platform: NodeJS.Platform): string {
  return platform === "win32" || platform === "darwin" ? relative.toLowerCase() : relative;
}

/** The parts of the file system the moves use. Tests replace them to simulate failures. */
export interface PlanFileOps {
  lstat(target: string): Promise<BigIntStats>;
  link(existing: string, created: string): Promise<void>;
  /**
   * Used only by `renameIfAbsent`, the unsafe move a person consented to (DR-21): `rename` can
   * replace a file (DR-18 b). Tests replace it to show when it is and is not called.
   */
  rename(from: string, to: string): Promise<void>;
  unlink(target: string): Promise<void>;
  /** Creates one directory; rejects with EEXIST when the name exists. */
  mkdir(target: string): Promise<void>;
}

export const nodePlanFileOps: PlanFileOps = {
  lstat: (target) => fs.lstat(target, { bigint: true }),
  link: (existing, created) => fs.link(existing, created),
  rename: (from, to) => fs.rename(from, to),
  unlink: (target) => fs.unlink(target),
  mkdir: async (target) => {
    await fs.mkdir(target);
  },
};

/** Identity of a checked file: a later open must reach the same file. */
export interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
}

export function identityOf(stat: BigIntStats): FileIdentity {
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeNs: stat.mtimeNs };
}

export function sameIdentity(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs;
}

export type HashOutcome =
  | { readonly ok: true; readonly hash: ContentHash; readonly bytes: number }
  | {
      readonly ok: false;
      /**
       * missing: gone, or no longer a regular file. changed: the opened file is not the one
       * checked (a link or another file was put in its place). too_large: more than `maxBytes`.
       * aborted: the signal ended the read. io_error: anything else.
       */
      readonly reason: "missing" | "changed" | "too_large" | "aborted" | "io_error";
    };

export interface HashFileOptions {
  /** The file must still be this one (device and inode) when it is opened. */
  readonly expected?: FileIdentity;
  /** Stop and report `too_large` after this many bytes. */
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

/**
 * SHA-256 of a file's bytes, the same form as `Workspace` hashes (64 lowercase hex characters).
 * The last path component is not followed where the platform allows it (O_NOFOLLOW), and the
 * opened file is compared with `expected`, so a link swapped in after the check is not read.
 */
function aborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

export async function hashFile(absolute: string, options: HashFileOptions = {}): Promise<HashOutcome> {
  if (aborted(options.signal)) return { ok: false, reason: "aborted" };
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(absolute, flags);
  } catch (error) {
    const code = errorCode(error);
    if (isMissing(error)) return { ok: false, reason: "missing" };
    // O_NOFOLLOW on a link fails with ELOOP (Linux) or EMLINK (BSD, macOS).
    if (code === "ELOOP" || code === "EMLINK") return { ok: false, reason: "changed" };
    if (code === "EISDIR") return { ok: false, reason: "missing" };
    return { ok: false, reason: "io_error" };
  }
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) return { ok: false, reason: "missing" };
    const expected = options.expected;
    if (expected !== undefined && (stat.dev !== expected.dev || stat.ino !== expected.ino)) {
      return { ok: false, reason: "changed" };
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    let total = 0;
    for (;;) {
      if (aborted(options.signal)) return { ok: false, reason: "aborted" };
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (options.maxBytes !== undefined && total > options.maxBytes) return { ok: false, reason: "too_large" };
      hash.update(buffer.subarray(0, bytesRead));
    }
    return { ok: true, hash: hash.digest("hex"), bytes: total };
  } catch {
    return { ok: false, reason: "io_error" };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** A plan source as it is now. */
export type SourceInspection =
  | { readonly ok: true; readonly path: ResolvedPath; readonly identity: FileIdentity }
  | { readonly ok: false; readonly problem: "denied" | "source_missing" | "source_not_file" | "io_error" };

/**
 * Checks a plan source: inside the root (Workspace.resolve, write access), the named entry is not
 * a link (links are not moved), and the target is a regular file.
 */
export async function inspectSource(
  workspace: Workspace,
  given: string,
  ops: PlanFileOps,
): Promise<SourceInspection> {
  const resolved = await workspace.resolve(given, "write");
  if (!resolved.ok) return { ok: false, problem: "denied" };
  // The entry as named (parents may be links inside the root; the last name may not be one).
  const named = path.resolve(workspace.root, given);
  let stat: BigIntStats;
  try {
    const namedStat = await ops.lstat(named);
    if (namedStat.isSymbolicLink()) return { ok: false, problem: "source_not_file" };
    stat = await ops.lstat(resolved.path.absolute);
  } catch (error) {
    return { ok: false, problem: isMissing(error) ? "source_missing" : "io_error" };
  }
  if (!stat.isFile()) return { ok: false, problem: "source_not_file" };
  return { ok: true, path: resolved.path, identity: identityOf(stat) };
}

/** A move destination as it is now. */
export type DestinationInspection =
  | { readonly ok: true; readonly path: ResolvedPath }
  | {
      readonly ok: false;
      readonly problem: "denied" | "destination_exists" | "destination_parent_not_dir" | "io_error";
    };

async function exists(target: string, ops: PlanFileOps): Promise<boolean | "io_error"> {
  try {
    await ops.lstat(target);
    return true;
  } catch (error) {
    return isMissing(error) ? false : "io_error";
  }
}

/**
 * Checks a move destination: inside the root, nothing at the path (not even a dangling link),
 * and every existing parent up to the root is a directory.
 */
export async function inspectDestination(
  workspace: Workspace,
  given: string,
  ops: PlanFileOps,
): Promise<DestinationInspection> {
  const access: PathAccess = "write";
  const resolved = await workspace.resolve(given, access);
  if (!resolved.ok) return { ok: false, problem: "denied" };
  for (const candidate of [path.resolve(workspace.root, given), resolved.path.absolute]) {
    const found = await exists(candidate, ops);
    if (found === "io_error") return { ok: false, problem: "io_error" };
    if (found) return { ok: false, problem: "destination_exists" };
  }
  const parent = await firstExistingParent(workspace.root, resolved.path.absolute, ops);
  if (parent === "io_error") return { ok: false, problem: "io_error" };
  if (parent === "not_dir") return { ok: false, problem: "destination_parent_not_dir" };
  return { ok: true, path: resolved.path };
}

/** Walks up from `absolute`'s parent to the root. "dir" when the first existing one is a directory. */
async function firstExistingParent(
  root: string,
  absolute: string,
  ops: PlanFileOps,
): Promise<"dir" | "not_dir" | "io_error"> {
  let current = path.dirname(absolute);
  for (;;) {
    try {
      const stat = await ops.lstat(current);
      return stat.isDirectory() ? "dir" : "not_dir";
    } catch (error) {
      if (!isMissing(error)) return "io_error";
    }
    if (samePath(current, root)) return "dir";
    const up = path.dirname(current);
    if (up === current) return "io_error";
    current = up;
  }
}

function samePath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Creates the missing parents of `absolute` one by one, from the root down. Fails with
 * `destination_parent_not_dir` when something that is not a directory is in the way.
 */
export async function createParents(
  root: string,
  absolute: string,
  ops: PlanFileOps,
): Promise<null | "destination_parent_not_dir" | "io_error"> {
  const missing: string[] = [];
  let current = path.dirname(absolute);
  for (;;) {
    try {
      const stat = await ops.lstat(current);
      if (!stat.isDirectory()) return "destination_parent_not_dir";
      break;
    } catch (error) {
      if (!isMissing(error)) return "io_error";
    }
    if (samePath(current, root)) return "io_error";
    missing.unshift(current);
    const up = path.dirname(current);
    if (up === current) return "io_error";
    current = up;
  }
  for (const dir of missing) {
    try {
      await ops.mkdir(dir);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") return isMissing(error) ? "destination_parent_not_dir" : "io_error";
      try {
        const stat = await ops.lstat(dir);
        if (!stat.isDirectory()) return "destination_parent_not_dir";
      } catch {
        return "io_error";
      }
    }
  }
  return null;
}

/**
 * DR-18 (b), DR-21: the item problem for a move that stops because the file system offers no move
 * that refuses an existing destination (no hard links, or a source that cannot be unlinked), so the
 * file could only be moved by a rename that might replace one created in the meantime. The
 * contract's code is `unsafe_move` (plan.ts PLAN_ITEM_PROBLEMS). The preflight lists such moves and
 * the apply waits for a person's consent; only with it are they made (`renameIfAbsent`).
 */
export const HARD_LINK_UNAVAILABLE_PROBLEM: PlanItemProblem = "unsafe_move";

/**
 * Codes from `link` that mean "no hard links here" (FAT and exFAT volumes, some network shares,
 * too many links), not "this move cannot work". EACCES is not one of them: a permission problem
 * would stop any other way of moving too.
 */
const LINK_UNSUPPORTED = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EMLINK", "EINVAL"]);

export type MoveOutcome = "moved" | "destination_exists" | "cross_device" | "no_hard_link" | "io_error";

/** True when `link` failed because hard links cannot be used here (not for any other reason). */
export function isLinkUnsupported(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && LINK_UNSUPPORTED.has(code);
}

/**
 * Moves a file without ever replacing an existing one and without copying: `link(from, to)`,
 * which fails when anything exists at `to`, then `unlink(from)`.
 *
 * DR-18 (b), R-5 L-1: there is no other safe way. Node's `rename` replaces an existing file on
 * every platform, so "check that nothing is there, then rename" would replace a file created
 * between the two steps; that is `renameIfAbsent`, used only with a person's consent (DR-21). Where hard links cannot be used the move stops as `no_hard_link` and nothing
 * changes. Where the source cannot be unlinked after the link (a read-only file on Windows), the
 * second name is taken back and the move also stops as `no_hard_link` (the contract's
 * `unsafe_move`); if the second name cannot be taken back, both names stay and it is `io_error`.
 *
 * Hard links are also why a file inside the workspace that shares its content with a file
 * outside (an existing hard link, R-5 I-1) can be moved: only the workspace name changes; the
 * outside name and its content stay as they were.
 */
export async function moveNoReplace(from: string, to: string, ops: PlanFileOps): Promise<MoveOutcome> {
  try {
    await ops.link(from, to);
  } catch (error) {
    const code = errorCode(error);
    if (code === "EEXIST") return "destination_exists";
    if (code === "EXDEV") return "cross_device";
    if (isLinkUnsupported(error)) return "no_hard_link";
    return "io_error";
  }
  try {
    await ops.unlink(from);
    return "moved";
  } catch {
    try {
      await ops.unlink(to);
    } catch {
      // Both names now point at the file. Nothing was lost; report it.
      return "io_error";
    }
    return "no_hard_link";
  }
}

/**
 * DR-21: the unsafe move, only after a person's consent for this apply (UnsafeMoveConsent) and
 * only where `moveNoReplace` reported `no_hard_link`. It looks once more that nothing is at `to`
 * and then renames. A file created between that look and the rename can still be replaced: that
 * window is the risk the person consented to. Nothing is copied: another volume is `cross_device`.
 */
export async function renameIfAbsent(from: string, to: string, ops: PlanFileOps): Promise<Exclude<MoveOutcome, "no_hard_link">> {
  try {
    await ops.lstat(to);
    return "destination_exists";
  } catch (error) {
    if (!isMissing(error)) return "io_error";
  }
  try {
    await ops.rename(from, to);
    return "moved";
  } catch (error) {
    const code = errorCode(error);
    if (code === "EXDEV") return "cross_device";
    if (code === "EEXIST" || code === "ENOTEMPTY") return "destination_exists";
    return "io_error";
  }
}

/** Name of a hard link probe. Starts with the state directory's name so nobody mistakes it for a file of theirs. */
function probeName(): string {
  return `.codaryn-link-probe-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * PQ-6: can `source` get a second name in `dir` (on the same volume)? Makes the link and takes it
 * back at once. "unsupported" only for the codes that mean "no hard links here"; any other failure
 * is "unknown" and the apply decides on the move itself. A probe that cannot be taken back stays
 * as a second name of the same file; it is reported as "unknown".
 * U-105: `onLeft`, when given, is called once for such a probe (the removal failed, and not because
 * the probe was already gone), so the executor can count it. The answer is the same either way.
 */
export async function probeHardLink(
  source: string,
  dir: string,
  ops: PlanFileOps,
  onLeft?: () => void,
): Promise<"supported" | "unsupported" | "unknown"> {
  const probe = path.join(dir, probeName());
  try {
    await ops.link(source, probe);
  } catch (error) {
    return isLinkUnsupported(error) ? "unsupported" : "unknown";
  }
  try {
    await ops.unlink(probe);
    return "supported";
  } catch (error) {
    if (!isMissing(error)) onLeft?.();
    return "unknown";
  }
}

/** Maps a hash failure of a plan source to the item problem the executor reports. */
export function hashProblem(reason: Exclude<HashOutcome, { ok: true }>["reason"]): PlanItemProblem {
  switch (reason) {
    case "missing":
      return "source_missing";
    case "changed":
      return "source_changed";
    case "too_large":
    case "aborted":
    case "io_error":
      return "io_error";
  }
}
