/**
 * Workspace lock `<root>/.codaryn/lock.json` (`{pid, runId, startedAt, processStartedAt}`), P-4,
 * T-9 and N-25(b).
 *
 * - Taking a free lock: the complete content is written to a unique temporary file and hard-linked
 *   to `lock.json`. The link fails when the lock exists, so two runs never both create it, and a
 *   reader never sees a half-written lock.
 * - DR-27 (b): on a volume without hard links (isLinkUnsupported) the same file is made by an
 *   exclusive create (`wx`) instead; it still fails when the name exists. A reader may then see the
 *   file before its content is complete. Text without the final newline that every lock and
 *   reclaim text ends with, and that is not a whole JSON value yet, is still being written: the
 *   attempt waits for it and never reclaims or clears it. A whole lock without the newline (written
 *   by hand or by other tools) is judged as before.
 * - Reclaiming a lock whose pid is dead (T-9): only one process at a time may reclaim. It holds
 *   `lock.json.reclaim` (taken the same way), reads `lock.json` again, moves it to a unique name,
 *   checks that the moved content is the dead lock it read, and deletes it. Then it competes for
 *   the free lock like anyone else. Under the reclaim file nobody else can move or replace a dead
 *   lock: a link cannot replace an existing file, and only its owner removes a live lock.
 * - A reclaim file whose owner is dead (a reclaimer that crashed) is removed the same way: moved
 *   to a unique name and deleted only when its content is the one that was read.
 * - W-4: a reclaim file written by this process is judged by what this process holds right now,
 *   not by its pid (which is always alive here). One left behind by a finished attempt (its
 *   removal failed with EPERM or EBUSY) is cleared like a dead reclaimer's, so contenders in one
 *   process keep making progress. Every attempt writes a unique reclaim text for this.
 * - Liveness is `process.kill(pid, 0)`, and since N-25(b) also the holder's process start time:
 *   a lock records when its process started (`processStartedAt`, from `performance.timeOrigin`).
 *   When the pid is alive but the process now using it started at another time (more than
 *   PROCESS_START_TOLERANCE_MS apart), the system gave the pid to a new process (Z-2) and the lock
 *   is dead. When that start time cannot be learned, the pid alone decides, as before. A lock in
 *   the old format (no `processStartedAt`) is judged by its pid alone.
 * - N-27 (d), Linux: `ps` counts elapsed time from boot, so the start it gives moves when the wall
 *   clock is stepped. The lock therefore also records the start in ticks since boot and the boot id
 *   (`/proc`), which decide exactly when both the lock and the system have them.
 *   Tests inject `isProcessAlive` and `processStartTime` so that they do not depend on pid reuse.
 * - EPERM and EBUSY (Windows reports them for files that are being deleted or are in use) are
 *   retried a few times and then end as `workspace_locked`, never as an exception.
 * - A lock file that cannot be understood is never reclaimed.
 * - U-176: releasing tries again, briefly, when removing the lock fails with EPERM or EBUSY (a handle
 *   that does not share deletion, as some scanners open files), and throws when it still cannot.
 * - U-176: a lock of this very process that no attempt here holds any more (its release failed) is
 *   taken back like a dead lock: its pid is this process's, its recorded start is this process's to
 *   the letter (and its Linux identity, when it has one), and it is not in this process's list of
 *   held locks. A lock is listed before the link that makes it, and leaves the list when it is
 *   released (also when that failed). No other process's lock is judged differently: no other live
 *   process has this pid, a previous process with it has another start, and a lock without a
 *   recorded start is never taken back by this rule.
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { link, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { LOCK_FILE_NAME, STATE_DIR_NAME } from "../contracts/index.js";
import type { Clock } from "../contracts/index.js";
import { assertRunId, ensureStateDir, errorCode, isLinkUnsupported } from "./common.js";
import { isRunTimestamp } from "./runs.js";

export interface LockInfo {
  readonly pid: number;
  readonly runId: string;
  /** ISO 8601 UTC time. */
  readonly startedAt: string;
  /**
   * N-25(b): when the holder's process started, ISO 8601 UTC. Absent in locks written before
   * N-25(b); those are judged by their pid alone.
   */
  readonly processStartedAt?: string;
  /**
   * N-27 (d), Linux: the holder's start in clock ticks since boot (`/proc/<pid>/stat` field 22) and
   * the boot id. Unlike `processStartedAt` they do not move with the wall clock. Present together.
   */
  readonly processStartTicks?: string;
  readonly bootId?: string;
}

/** A process's start as Linux counts it: ticks since boot and the boot it belongs to. */
export interface ProcessIdentity {
  readonly startTicks: string;
  readonly bootId: string;
}

/** File operations the lock uses. Tests replace single operations to inject errors. */
export interface LockFileSystem {
  /** Creates a new file with this text. Fails when the name exists. */
  writeNew(path: string, text: string): Promise<void>;
  /** Hard link. Fails with EEXIST when `newPath` exists. */
  link(existingPath: string, newPath: string): Promise<void>;
  readText(path: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  /** Removes a file. A missing file is not an error. */
  remove(path: string): Promise<void>;
}

export const nodeLockFileSystem: LockFileSystem = {
  writeNew: (path, text) => writeFile(path, text, { encoding: "utf8", flag: "wx" }),
  link: (existingPath, newPath) => link(existingPath, newPath),
  readText: (path) => readFile(path, "utf8"),
  rename: (from, to) => rename(from, to),
  remove: (path) => rm(path, { force: true }),
};

/** How a lock's holder is judged alive. acquireLock, inspectLock and lockHolderAlive share it. */
export interface LockLivenessOptions {
  /**
   * Whether the process with this pid is alive. Defaults to `process.kill(pid, 0)`. Tests pass a
   * fixed answer, because the system may give an exited process's pid to a new process at any time.
   */
  readonly isProcessAlive?: (pid: number) => boolean;
  /**
   * N-25(b): when the process using this pid now started, in milliseconds since 1970, or null when
   * it cannot be learned. Defaults to `processStartTime`. Asked only for a live pid of a lock that
   * records its start time.
   */
  readonly processStartTime?: (pid: number) => Promise<number | null>;
  /**
   * N-27 (d): the identity of the process using this pid (Linux), or null where it cannot be read.
   * Defaults to `linuxProcessIdentity`. When both the lock and this answer have one, they decide
   * exactly, before any wall-clock comparison.
   */
  readonly processIdentity?: (pid: number) => Promise<ProcessIdentity | null>;
}

export interface AcquireLockOptions extends LockLivenessOptions {
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly clock: Clock;
  /** Defaults to the real file system. */
  readonly fileSystem?: LockFileSystem;
  /**
   * How long to keep trying while the lock is being reclaimed or a file operation reports EPERM or
   * EBUSY. A live holder ends the attempt at once. Defaults to DEFAULT_LOCK_RETRY_MS.
   */
  readonly retryForMs?: number;
}

export type AcquireLockOutcome =
  | { readonly ok: true; readonly lock: LockInfo }
  | {
      readonly ok: false;
      readonly code: "workspace_locked";
      /** `null` when the existing lock file could not be read or understood. It is never reclaimed then. */
      readonly holder: LockInfo | null;
    };

export interface ReleaseLockOptions {
  readonly workspaceRoot: string;
  readonly runId: string;
}

/**
 * Time budget for retries. Retries happen only after a transient error, while another process
 * reclaims, or after this process reclaimed; a free or a live lock answers on the first attempt.
 */
export const DEFAULT_LOCK_RETRY_MS = 2_000;
const RETRY_DELAY_MS = 10;
const RECLAIM_FILE_NAME = `${LOCK_FILE_NAME}.reclaim`;

class TransientLockError extends Error {}

function isTransient(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EPERM" || code === "EBUSY";
}

/**
 * N-25(b): how far a recorded process start time may be from the one the system reports for the
 * pid and still be the same process. The recorded time is `performance.timeOrigin`, a little
 * after the process was created; `ps` reports whole seconds.
 */
export const PROCESS_START_TOLERANCE_MS = 5_000;
/** How long a start-time query may take before its answer counts as unknown (null). */
export const START_QUERY_TIMEOUT_MS = 5_000;

function windowsPowerShell(): string {
  const systemRoot = process.env["SystemRoot"] ?? process.env["SYSTEMROOT"] ?? "C:\\Windows";
  return join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** Runs a fixed system tool by its absolute path and returns its stdout, or null on any failure. */
function systemQuery(file: string, args: readonly string[], cwd: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(
        file,
        [...args],
        { timeout: timeoutMs, windowsHide: true, cwd, env: { ...process.env, LC_ALL: "C" }, maxBuffer: 64 * 1024 },
        (error, stdout) => resolve(error === null ? String(stdout) : null),
      );
    } catch {
      resolve(null);
    }
  });
}

/** `ps -o etime=`: `[[dd-]hh:]mm:ss` → seconds, or null. */
function parseElapsed(text: string): number | null {
  const match = /^\s*(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)\s*$/.exec(text);
  if (match === null) return null;
  const [days, hours, minutes, seconds] = [match[1], match[2], match[3], match[4]].map((part) => Number(part ?? 0)) as [number, number, number, number];
  return ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
}

/**
 * N-25(b): when the process with this pid started, in milliseconds since 1970, or null when there
 * is no such process or its start time cannot be learned. This process: `performance.timeOrigin`.
 * Others: Windows PowerShell's Get-Process, or `ps -o etime=` elsewhere, run by absolute path with
 * a fixed command line that holds nothing but the pid number.
 * `timeoutMs` (default START_QUERY_TIMEOUT_MS): a query that takes longer answers null, which a lock
 * judgment treats as "unknown, so held" (the safe side). Z-1: on a heavily loaded machine Windows
 * PowerShell alone can take longer than the default; tests that need the real answer wait longer.
 */
export async function processStartTime(pid: number, options: { readonly timeoutMs?: number } = {}): Promise<number | null> {
  const timeoutMs = options.timeoutMs ?? START_QUERY_TIMEOUT_MS;
  if (pid === process.pid) return performance.timeOrigin;
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (process.platform === "win32") {
    const powershell = windowsPowerShell();
    const script = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p -and $p.StartTime) { [DateTimeOffset]::new($p.StartTime).ToUnixTimeMilliseconds() }`;
    const out = await systemQuery(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], join(powershell, ".."), timeoutMs);
    const value = out === null ? Number.NaN : Number(out.trim());
    return out !== null && out.trim().length > 0 && Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  for (const ps of ["/bin/ps", "/usr/bin/ps"]) {
    const asked = Date.now();
    const out = await systemQuery(ps, ["-o", "etime=", "-p", String(pid)], "/", timeoutMs);
    if (out === null) continue;
    const elapsed = parseElapsed(out);
    return elapsed === null ? null : asked - elapsed * 1000;
  }
  return null;
}

const START_TICKS = /^[0-9]{1,20}$/;
const BOOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Field 22 (starttime) of a `/proc/<pid>/stat` line, or null. The command name (field 2) is in
 * parentheses and may hold spaces and parentheses itself, so fields are counted after the last ")".
 */
export function parseProcStartTicks(stat: string): string | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  const fields = stat.slice(close + 1).trim().split(/\s+/);
  // fields[0] is field 3 (state), so field 22 is fields[19].
  const ticks = fields[19];
  return ticks !== undefined && START_TICKS.test(ticks) ? ticks : null;
}

/**
 * N-27 (d): a process's identity on Linux, read from /proc; null on other platforms, for a pid with
 * no process, or when /proc cannot be read. `options` are for tests.
 */
export async function linuxProcessIdentity(
  pid: number,
  options: { readonly platform?: NodeJS.Platform; readonly read?: (file: string) => Promise<string> } = {},
): Promise<ProcessIdentity | null> {
  if ((options.platform ?? process.platform) !== "linux" || !Number.isSafeInteger(pid) || pid <= 0) return null;
  const read = options.read ?? ((file: string) => readFile(file, "utf8"));
  try {
    const startTicks = parseProcStartTicks(await read(`/proc/${pid}/stat`));
    const bootId = (await read("/proc/sys/kernel/random/boot_id")).trim().toLowerCase();
    return startTicks !== null && BOOT_ID.test(bootId) ? { startTicks, bootId } : null;
  } catch {
    return null;
  }
}

function parseLock(text: string): LockInfo | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { pid, runId, startedAt, processStartedAt } = value as Record<string, unknown>;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
  if (typeof runId !== "string" || typeof startedAt !== "string") return null;
  const { processStartTicks, bootId } = value as Record<string, unknown>;
  // An identity of the wrong shape, or only half of one: the lock is not understood.
  if ((processStartTicks === undefined) !== (bootId === undefined)) return null;
  if (processStartTicks !== undefined && (typeof processStartTicks !== "string" || !START_TICKS.test(processStartTicks))) return null;
  if (bootId !== undefined && (typeof bootId !== "string" || !BOOT_ID.test(bootId))) return null;
  const identity = processStartTicks === undefined ? {} : { processStartTicks: processStartTicks as string, bootId: bootId as string };
  if (processStartedAt === undefined) return { pid, runId, startedAt, ...identity };
  // A start time that is not a real timestamp: the lock is not understood and never reclaimed.
  if (!isRunTimestamp(processStartedAt)) return null;
  return { pid, runId, startedAt, processStartedAt, ...identity };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return errorCode(error) === "EPERM";
  }
}

/**
 * Reclaim texts that attempts in this process hold right now (W-4). Shared through `globalThis`
 * so that two copies of this module in one process still agree.
 */
const HELD_RECLAIMS_KEY = Symbol.for("codaryn.store.lock.heldReclaims");
const heldReclaims: Set<string> = (() => {
  const shared = globalThis as { [HELD_RECLAIMS_KEY]?: Set<string> };
  shared[HELD_RECLAIMS_KEY] ??= new Set<string>();
  return shared[HELD_RECLAIMS_KEY];
})();

/**
 * U-176: the locks (lock file and text) that attempts in this process hold right now. Shared through
 * `globalThis` as heldReclaims is, so that two copies of this module in one process agree.
 */
const HELD_LOCKS_KEY = Symbol.for("codaryn.store.lock.heldLocks");
const heldLocks: Set<string> = (() => {
  const shared = globalThis as { [HELD_LOCKS_KEY]?: Set<string> };
  shared[HELD_LOCKS_KEY] ??= new Set<string>();
  return shared[HELD_LOCKS_KEY];
})();
const heldLockKey = (lockFile: string, text: string): string => `${lockFile}\u0000${text}`;
/** The start this process records in its locks (acquireLock writes exactly this). */
const OWN_PROCESS_STARTED_AT = new Date(performance.timeOrigin).toISOString();

/**
 * U-176: whether a lock read from `lockFile` is this very process's and held by no attempt here: the
 * pid and the recorded start are this process's (the start to the letter), the Linux identity too
 * when the lock has one, and the lock is not listed as held. Such a lock is left over (its release
 * failed) and is taken back as a dead one. Anything else is judged by liveness as before.
 */
async function isOwnLeftOver(
  lockFile: string,
  read: { readonly text: string; readonly holder: LockInfo },
  identityOf: (pid: number) => Promise<ProcessIdentity | null>,
): Promise<boolean> {
  const holder = read.holder;
  if (holder.pid !== process.pid || holder.processStartedAt !== OWN_PROCESS_STARTED_AT) return false;
  if (heldLocks.has(heldLockKey(lockFile, read.text))) return false;
  if (holder.processStartTicks !== undefined || holder.bootId !== undefined) {
    const own = await identityOf(process.pid).catch(() => null);
    if (own === null || own.startTicks !== holder.processStartTicks || own.bootId !== holder.bootId) return false;
  }
  return true;
}

function uniqueSuffix(): string {
  return `${process.pid}.${randomBytes(6).toString("hex")}`;
}

type Read = { readonly text: string; readonly holder: LockInfo | null } | "missing";

/** Reads a lock-shaped file. Transient errors become TransientLockError; others are thrown. */
async function readState(fs: LockFileSystem, file: string): Promise<Read> {
  try {
    const text = await fs.readText(file);
    return { text, holder: parseLock(text) };
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return "missing";
    if (isTransient(error)) throw new TransientLockError();
    throw error;
  }
}

/** Runs a file operation, turning EPERM and EBUSY into TransientLockError. */
async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isTransient(error)) throw new TransientLockError();
    throw error;
  }
}

/**
 * Whether a lock-shaped text may still be growing: no final newline and not yet a whole JSON value.
 * A cut-off JSON object never parses, so text that parses is complete; a lock written without the
 * newline (by hand or by other tools) is therefore judged as before.
 */
function stillWritten(text: string): boolean {
  if (text.endsWith("\n")) return false;
  try {
    JSON.parse(text);
    return false;
  } catch {
    return true;
  }
}

/**
 * Reads a lock-shaped file whose writer has finished. One still being written (on a volume without
 * hard links, DR-27 b) is waited for (TransientLockError), never judged or cleared.
 */
async function readSettled(fs: LockFileSystem, file: string): Promise<Read> {
  const read = await readState(fs, file);
  if (read !== "missing" && stillWritten(read.text)) throw new TransientLockError();
  return read;
}

/**
 * Makes `target` with `text` (already in `temporary`) without replacing anything: a hard link, or
 * an exclusive create where the volume has no hard links (DR-27 b). False when `target` exists.
 */
async function tryCreate(fs: LockFileSystem, temporary: string, target: string, text: string): Promise<boolean> {
  try {
    await fs.link(temporary, target);
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    if (!isLinkUnsupported(error)) {
      if (isTransient(error)) throw new TransientLockError();
      throw error;
    }
  }
  try {
    await guarded(() => fs.writeNew(target, text));
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
}

/**
 * Moves `file` away and deletes it only when its content is `expected`. Content that differs was
 * written after `expected` was read; it is linked back (best effort) and kept.
 */
async function removeIfUnchanged(fs: LockFileSystem, stateDir: string, file: string, expected: string): Promise<void> {
  const moved = join(stateDir, `${LOCK_FILE_NAME}.${uniqueSuffix()}.stale`);
  try {
    await guarded(() => fs.rename(file, moved));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  try {
    let content: string | null = null;
    try {
      content = await fs.readText(moved);
    } catch {
      content = null;
    }
    if (content !== expected) {
      try {
        await fs.link(moved, file);
      } catch (error) {
        // DR-27 (b): without hard links the content goes back by an exclusive create. When someone
        // took the name meanwhile, their file stays and the moved one is dropped.
        if (content !== null && isLinkUnsupported(error)) await fs.writeNew(file, content).catch(() => undefined);
      }
    }
  } finally {
    await fs.remove(moved).catch(() => undefined);
  }
}

type Step = { readonly kind: "acquired" } | { readonly kind: "locked"; readonly holder: LockInfo | null } | { readonly kind: "retry" };

/**
 * Whether a lock's holder (or a reclaim file's owner) still runs (N-25 b, N-27 d). One judge per
 * attempt: it asks each pid's start time once.
 */
function livenessJudge(options: LockLivenessOptions): (holder: LockInfo) => Promise<boolean> {
  const alive = options.isProcessAlive ?? isProcessAlive;
  const startTimeOf = options.processStartTime ?? processStartTime;
  const identityOf = options.processIdentity ?? ((pid: number) => linuxProcessIdentity(pid));
  const startTimes = new Map<number, Promise<number | null>>();
  return async (holder) => {
    if (!alive(holder.pid)) return false;
    // N-27 (d): the Linux identity does not move with the wall clock; when both sides have one it
    // decides exactly.
    if (holder.processStartTicks !== undefined && holder.bootId !== undefined) {
      const now = await identityOf(holder.pid).catch(() => null);
      if (now !== null) return now.bootId === holder.bootId && now.startTicks === holder.processStartTicks;
    }
    if (holder.processStartedAt === undefined) return true;
    let asked = startTimes.get(holder.pid);
    if (asked === undefined) {
      asked = startTimeOf(holder.pid).catch(() => null);
      startTimes.set(holder.pid, asked);
    }
    const actual = await asked;
    if (actual === null) return true;
    return Math.abs(actual - Date.parse(holder.processStartedAt)) <= PROCESS_START_TOLERANCE_MS;
  };
}

/**
 * Whether the holder of a lock (a parsed `lock.json`) still runs, by the rule acquireLock uses:
 * the Linux identity (ticks since boot and boot id) when both sides have it, then the process start
 * time within PROCESS_START_TOLERANCE_MS, then the pid alone. An unknown start time counts as alive.
 */
export function lockHolderAlive(holder: LockInfo, options: LockLivenessOptions = {}): Promise<boolean> {
  return livenessJudge(options)(holder);
}

/**
 * What the next run would find, judged by acquireLock's rules:
 * - `none`: no lock; the next run takes it.
 * - `held`: a holder that still runs; the next run ends as `workspace_locked`.
 * - `stale`: a holder that has ended; the next run reclaims the lock.
 * - `unreadable`: a lock that is not understood or still being written, or cannot be read; it is
 *   never reclaimed, so the next run ends as `workspace_locked` until it is removed.
 * - `reclaim_left`: `lock.json.reclaim` is still being written (DR-27 b), cannot be read, or belongs
 *   to a reclaimer that still runs; while it stays, no lock is reclaimed. One left by a reclaimer that
 *   ended, or a whole one that is not understood, is cleared by the next run, so `lock.json` decides.
 */
export type LockInspection =
  | { readonly state: "none" }
  | { readonly state: "held"; readonly holder: LockInfo }
  | { readonly state: "stale"; readonly holder: LockInfo }
  | { readonly state: "unreadable" }
  | { readonly state: "reclaim_left" };

export interface InspectLockOptions extends LockLivenessOptions {
  /** Defaults to the real file system. Only `readText` is used. */
  readonly fileSystem?: LockFileSystem;
}

/**
 * Reads `<root>/.codaryn/lock.json` and `lock.json.reclaim` without changing anything and judges them
 * as acquireLock would (for `codaryn doctor`). Never rejects.
 */
export async function inspectLock(workspaceRoot: string, options: InspectLockOptions = {}): Promise<LockInspection> {
  const fs = options.fileSystem ?? nodeLockFileSystem;
  const holderAlive = livenessJudge(options);
  const stateDir = join(workspaceRoot, STATE_DIR_NAME);
  let reclaim: Read;
  try {
    reclaim = await readState(fs, join(stateDir, RECLAIM_FILE_NAME));
  } catch {
    return { state: "reclaim_left" };
  }
  if (reclaim !== "missing") {
    if (stillWritten(reclaim.text)) return { state: "reclaim_left" };
    // As reclaimInUse: this process's own reclaim counts only while an attempt holds it.
    const owner = reclaim.holder;
    if (owner !== null && (owner.pid === process.pid ? heldReclaims.has(reclaim.text) : await holderAlive(owner))) return { state: "reclaim_left" };
  }
  let lock: Read;
  try {
    lock = await readState(fs, join(stateDir, LOCK_FILE_NAME));
  } catch {
    return { state: "unreadable" };
  }
  if (lock === "missing") return { state: "none" };
  if (stillWritten(lock.text) || lock.holder === null) return { state: "unreadable" };
  // U-176: a lock of this process that nothing here holds any more is taken back by the next run.
  const identityOf = options.processIdentity ?? ((pid: number) => linuxProcessIdentity(pid));
  if (await isOwnLeftOver(join(stateDir, LOCK_FILE_NAME), { text: lock.text, holder: lock.holder }, identityOf)) return { state: "stale", holder: lock.holder };
  return (await holderAlive(lock.holder)) ? { state: "held", holder: lock.holder } : { state: "stale", holder: lock.holder };
}

export async function acquireLock(options: AcquireLockOptions): Promise<AcquireLockOutcome> {
  const { workspaceRoot, runId, clock } = options;
  const fs = options.fileSystem ?? nodeLockFileSystem;
  const identityOf = options.processIdentity ?? ((pid: number) => linuxProcessIdentity(pid));
  const holderAlive = livenessJudge(options);
  assertRunId(runId);
  const locked = (holder: LockInfo | null): AcquireLockOutcome => ({ ok: false, code: "workspace_locked", holder });

  let stateDir: string;
  try {
    stateDir = await ensureStateDir(workspaceRoot);
  } catch (error) {
    if (isTransient(error)) return locked(null);
    throw error;
  }
  const lockFile = join(stateDir, LOCK_FILE_NAME);
  const reclaimFile = join(stateDir, RECLAIM_FILE_NAME);
  const ownIdentity = await identityOf(process.pid).catch(() => null);
  const lock: LockInfo = {
    pid: process.pid,
    runId,
    startedAt: new Date(clock.now()).toISOString(),
    processStartedAt: new Date(performance.timeOrigin).toISOString(),
    ...(ownIdentity === null ? {} : { processStartTicks: ownIdentity.startTicks, bootId: ownIdentity.bootId }),
  };
  const lockText = `${JSON.stringify(lock)}\n`;
  // Unique per attempt, so this process can tell its own held reclaim from a left-over one (W-4).
  const reclaimText = `${JSON.stringify({ ...lock, reclaim: uniqueSuffix() })}\n`;
  const temporary = join(stateDir, `${LOCK_FILE_NAME}.${runId}.${uniqueSuffix()}.tmp`);
  const reclaimTemporary = join(stateDir, `${RECLAIM_FILE_NAME}.${runId}.${uniqueSuffix()}.tmp`);

  /** Whether the reclaim file read is held by a reclaimer that is still at work. */
  async function reclaimInUse(held: { readonly text: string; readonly holder: LockInfo | null }): Promise<boolean> {
    if (held.holder === null) return false;
    // This process: only an attempt that holds it right now counts, whatever the pid says.
    if (held.holder.pid === process.pid) return heldReclaims.has(held.text);
    return holderAlive(held.holder);
  }

  /** Takes the reclaim file. "busy" while a reclaimer at work holds it. */
  async function takeReclaim(): Promise<"taken" | "busy"> {
    // Registered before the link, so no reader in this process can see it unregistered.
    heldReclaims.add(reclaimText);
    let taken = false;
    try {
      taken = await tryCreate(fs, reclaimTemporary, reclaimFile, reclaimText);
    } finally {
      if (!taken) heldReclaims.delete(reclaimText);
    }
    if (taken) return "taken";
    const held = await readSettled(fs, reclaimFile);
    if (held === "missing") return "busy";
    if (await reclaimInUse(held)) return "busy";
    // A reclaimer that died or finished without removing it (or a file that is not ours to
    // understand) is cleared, then retried.
    await removeIfUnchanged(fs, stateDir, reclaimFile, held.text);
    return "busy";
  }

  async function releaseReclaim(): Promise<void> {
    try {
      const held = await readState(fs, reclaimFile).catch(() => "missing" as const);
      if (held !== "missing" && held.text === reclaimText) await fs.remove(reclaimFile).catch(() => undefined);
    } finally {
      // Not held any more, also when the removal failed: the file is then cleared as left over.
      heldReclaims.delete(reclaimText);
    }
  }

  /** With the reclaim file held: removes `lock.json` only when it is still the dead lock read before. */
  async function reclaim(deadText: string): Promise<void> {
    if ((await takeReclaim()) !== "taken") return;
    try {
      const now = await readSettled(fs, lockFile);
      if (now === "missing" || now.text !== deadText) return;
      await removeIfUnchanged(fs, stateDir, lockFile, deadText);
    } finally {
      await releaseReclaim();
    }
  }

  async function attempt(): Promise<Step> {
    if (await tryCreate(fs, temporary, lockFile, lockText)) return { kind: "acquired" };
    const seen = await readSettled(fs, lockFile);
    if (seen === "missing") return { kind: "retry" };
    if (seen.holder === null) return { kind: "locked", holder: null };
    // U-176: this process's own lock that no attempt here holds any more is reclaimed as a dead one.
    if (!(await isOwnLeftOver(lockFile, { text: seen.text, holder: seen.holder }, identityOf)) && (await holderAlive(seen.holder))) {
      return { kind: "locked", holder: seen.holder };
    }
    await reclaim(seen.text);
    return { kind: "retry" };
  }

  try {
    await guarded(() => fs.writeNew(temporary, lockText));
    await guarded(() => fs.writeNew(reclaimTemporary, reclaimText));
  } catch (error) {
    await fs.remove(temporary).catch(() => undefined);
    await fs.remove(reclaimTemporary).catch(() => undefined);
    if (error instanceof TransientLockError) return locked(null);
    throw error;
  }

  let lastHolder: LockInfo | null = null;
  const deadline = Date.now() + (options.retryForMs ?? DEFAULT_LOCK_RETRY_MS);
  // U-176: listed before any link can make it, so no attempt in this process sees it unlisted.
  const ownKey = heldLockKey(lockFile, lockText);
  heldLocks.add(ownKey);
  let acquired = false;
  try {
    for (let first = true; first || Date.now() < deadline; first = false) {
      let step: Step;
      try {
        step = await attempt();
      } catch (error) {
        if (!(error instanceof TransientLockError)) throw error;
        step = { kind: "retry" };
      }
      if (step.kind === "acquired") {
        acquired = true;
        return { ok: true, lock };
      }
      if (step.kind === "locked") return locked(step.holder);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS + Math.floor(Math.random() * RETRY_DELAY_MS)));
      const seen = await readSettled(fs, lockFile).catch(() => "missing" as const);
      lastHolder = seen === "missing" ? lastHolder : seen.holder;
    }
    return locked(lastHolder);
  } finally {
    if (!acquired) heldLocks.delete(ownKey);
    await fs.remove(temporary).catch(() => undefined);
    await fs.remove(reclaimTemporary).catch(() => undefined);
  }
}

/** U-176: the waits between the tries of a release that meets EPERM or EBUSY (about 0.8 s in all). */
export const RELEASE_RETRY_DELAYS_MS: readonly number[] = [25, 50, 100, 200, 400];

/**
 * Removes the lock only when this process and this run hold it. Resolves to whether it was removed.
 * U-176: reading and removing are tried again after RELEASE_RETRY_DELAYS_MS when they fail with EPERM or
 * EBUSY; when they still fail, the last error is thrown and the lock is left, no longer listed as held
 * by this process, so this process's next acquire takes it back.
 */
export async function releaseLock(options: ReleaseLockOptions): Promise<boolean> {
  const { workspaceRoot, runId } = options;
  assertRunId(runId);
  const lockFile = join(workspaceRoot, STATE_DIR_NAME, LOCK_FILE_NAME);
  for (let attempt = 0; ; attempt += 1) {
    let ownText: string | null = null;
    try {
      const held = await readState(nodeLockFileSystem, lockFile);
      if (held === "missing" || held.holder === null) return false;
      if (held.holder.runId !== runId || held.holder.pid !== process.pid) return false;
      ownText = held.text;
      await rm(lockFile, { force: true });
      heldLocks.delete(heldLockKey(lockFile, held.text));
      return true;
    } catch (error) {
      const delay = RELEASE_RETRY_DELAYS_MS[attempt];
      if ((error instanceof TransientLockError || isTransient(error)) && delay !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      // Left: not held by this process any more (its operation is over), so it can be taken back.
      if (ownText !== null) heldLocks.delete(heldLockKey(lockFile, ownText));
      throw error;
    }
  }
}
