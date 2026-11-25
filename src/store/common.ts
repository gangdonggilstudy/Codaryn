/** Helpers shared by the journal, the lock and the change snapshots. Not exported from index.ts. */

import { createHash, randomBytes } from "node:crypto";
import { realpath as realpathCallback } from "node:fs";
import { link, lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import { PRIVACY_TOKEN_PATTERN_SOURCE, RUNS_DIR_NAME, STATE_DIR_NAME } from "../contracts/index.js";
import type { ContentHash, MaskedParts } from "../contracts/index.js";

const realpathNative = promisify(realpathCallback.native);

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertRunId(runId: string): void {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId) || runId.includes("..")) {
    throw new TypeError("runId must be 1-128 characters of [A-Za-z0-9._-] and must not contain '..'");
  }
}

export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

/**
 * IR-E1: the state directory, or its `runs` directory, is a link, a junction or not a plain
 * directory. Thrown before anything is written through it (the lock answers state_dir_not_plain).
 */
export class StateDirNotPlainError extends Error {
  readonly code = "state_dir_not_plain";
  constructor() {
    super("the state directory or its runs directory is a link or not a plain directory; nothing was written");
    this.name = "StateDirNotPlainError";
  }
}

/**
 * IR-E1: `dir` is a directory of its own below its parent: not a link or junction, and its real path
 * is its parent's real path with its name (so a link anywhere from the parent down is found, however
 * the parent itself was named).
 */
async function isPlainChildDirectory(dir: string): Promise<boolean> {
  try {
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
    const [real, parent] = await Promise.all([realpathNative(dir), realpathNative(dirname(dir))]);
    return sameFsPath(real, join(parent, basename(dir)));
  } catch {
    return false;
  }
}

/** IR-E1: makes `dir` when it is missing (not recursively), then requires it to be plain. */
async function ensurePlainChild(dir: string): Promise<void> {
  try {
    await mkdir(dir);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  if (!(await isPlainChildDirectory(dir))) throw new StateDirNotPlainError();
}

/**
 * Creates the state directory and keeps its content out of version control tools. IR-E1: the state
 * directory must be plain before anything is written in it, and so must `runs` when it is there
 * (StateDirNotPlainError); nothing, not even `.gitignore`, is written otherwise.
 */
export async function ensureStateDir(workspaceRoot: string): Promise<string> {
  const stateDir = join(workspaceRoot, STATE_DIR_NAME);
  await ensurePlainChild(stateDir);
  const runs = join(stateDir, RUNS_DIR_NAME);
  let runsThere = true;
  try {
    await lstat(runs);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    runsThere = false;
  }
  if (runsThere && !(await isPlainChildDirectory(runs))) throw new StateDirNotPlainError();
  try {
    await writeFile(join(stateDir, ".gitignore"), "*\n", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  return stateDir;
}

export function runDir(workspaceRoot: string, runId: string): string {
  return join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME, runId);
}

export function sha256Hex(data: Uint8Array | string): ContentHash {
  return createHash("sha256").update(data).digest("hex") as ContentHash;
}

export function sameFsPath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * The directory exists and is the workspace's own: not a link or junction, and its real path is
 * the path itself, so nothing is read from or written to another place through it.
 */
export async function isPlainDirectory(dir: string): Promise<boolean> {
  try {
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
    return sameFsPath(await realpathNative(dir), dir);
  } catch {
    return false;
  }
}

/**
 * Errors from link() that mean the volume does not make hard links (or not here). DR-27 (b): one
 * rule for every exclusive create, the workspace lock and a revert's move. EISDIR is what libuv
 * makes of Windows' ERROR_INVALID_FUNCTION, which FAT32 and exFAT give for CreateHardLink [assumed;
 * this host has NTFS only]. EPERM is also a passing error on Windows (a file being deleted); callers
 * that fall back to an exclusive create see that error again there.
 */
const LINK_UNSUPPORTED: ReadonlySet<string> = new Set(["EPERM", "EXDEV", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EMLINK", "EISDIR"]);

/** Whether a link() error means that hard links cannot be made there (DR-24 c, DR-27 b). */
export function isLinkUnsupported(error: unknown): boolean {
  return LINK_UNSUPPORTED.has(errorCode(error) ?? "");
}

function temporaryBeside(target: string): string {
  return join(dirname(target), `.${randomBytes(8).toString("hex")}.tmp`);
}

/**
 * Creates `target` with this complete content, only when it does not exist: the content is
 * written to a temporary file in the same directory and hard-linked to `target`, which fails when
 * `target` exists. A reader never sees a half-written file, and of several callers exactly one
 * creates it. False when `target` exists. Other failures reject.
 */
export async function createExclusive(
  target: string,
  data: string | Uint8Array,
  operations: { readonly link?: (existing: string, created: string) => Promise<void> } = {},
): Promise<boolean> {
  const linkFile = operations.link ?? link;
  const temporary = temporaryBeside(target);
  try {
    await writeFile(temporary, data, { flag: "wx" });
    try {
      await linkFile(temporary, target);
      return true;
    } catch (error) {
      if (errorCode(error) === "EEXIST") return false;
      if (!isLinkUnsupported(error)) throw error;
      // DR-24 (c): a volume without hard links still gets an exclusive create; a reader may then
      // see the file before it is complete, which loadPlan's digest check turns into
      // invalid_run_record, and applied.json counts by its presence.
      try {
        await writeFile(target, data, { flag: "wx" });
        return true;
      } catch (fallback) {
        if (errorCode(fallback) === "EEXIST") return false;
        throw fallback;
      }
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

/** Replaces `target` with this complete content (temporary file and rename). */
export async function replaceAtomically(target: string, data: string | Uint8Array): Promise<void> {
  const temporary = temporaryBeside(target);
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * N-27 (a): whether `.codaryn/runs` has an entry named exactly `runId`. On volumes that ignore
 * case (NTFS, APFS by default) a run id that differs only in case would open another run's
 * directory; every reader and writer that takes a run id from outside checks this first.
 */
export async function hasExactRunEntry(workspaceRoot: string, runId: string): Promise<boolean> {
  try {
    const names = await readdir(join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME));
    return names.includes(runId);
  } catch {
    return false;
  }
}

/** The run's own directory: an entry of exactly this name, a plain directory (no link). */
export async function isOwnRunDir(workspaceRoot: string, runId: string): Promise<boolean> {
  return (await hasExactRunEntry(workspaceRoot, runId)) && (await isPlainDirectory(runDir(workspaceRoot, runId)));
}

/** IR-E1: the state directory and its `runs` directory, made when missing and required to be plain. */
export async function ensureRunsDir(workspaceRoot: string): Promise<string> {
  const runs = join(await ensureStateDir(workspaceRoot), RUNS_DIR_NAME);
  await ensurePlainChild(runs);
  return runs;
}

/** Creates the state directory and `runs/<runId>/` when missing; the run directory must then be plain. */
export async function ensureRunDir(workspaceRoot: string, runId: string): Promise<string> {
  assertRunId(runId);
  await ensureRunsDir(workspaceRoot);
  const dir = runDir(workspaceRoot, runId);
  try {
    await mkdir(dir);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  if (!(await isPlainChildDirectory(dir))) throw new Error("the run directory is a link or not a directory; nothing was written");
  return dir;
}

const PRIVACY_TOKEN = new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE);

/**
 * DR-28, DR-29: visible parts (MaskedParts) as a reader or writer of them checks them: an array of
 * 1 to `maxParts` strings, none holding a privacy token (the text was split at the tokens), at most
 * `maxText` characters in all. A copy, or null for anything else.
 */
export function maskedPartsOf(value: unknown, maxParts: number, maxText: number): MaskedParts | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxParts) return null;
  let total = 0;
  for (const part of value) {
    if (typeof part !== "string" || PRIVACY_TOKEN.test(part)) return null;
    total += part.length;
    if (total > maxText) return null;
  }
  return [...(value as string[])];
}
