/**
 * Workspace lock `<root>/.codaryn/lock.json` (`{pid, runId, startedAt, processStartedAt}`), P-4,
 * T-9 and N-25(b).
 *
 * - Taking a free lock: the complete content is written to a unique temporary file and hard-linked
 *   to `lock.json`. The link fails when the lock exists, so two runs never both create it, and a
 *   reader never sees a half-written lock.
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
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { link, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { LOCK_FILE_NAME, STATE_DIR_NAME } from "../contracts/index.js";
import type { Clock } from "../contracts/index.js";
import { assertRunId, ensureStateDir, errorCode } from "./common.js";
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

export interface AcquireLockOptions {
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
const START_QUERY_TIMEOUT_MS = 5_000;

function windowsPowerShell(): string {
  const systemRoot = process.env["SystemRoot"] ?? process.env["SYSTEMROOT"] ?? "C:\\Windows";
  return join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** Runs a fixed system tool by its absolute path and returns its stdout, or null on any failure. */
function systemQuery(file: string, args: readonly string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(
        file,
        [...args],
        { timeout: START_QUERY_TIMEOUT_MS, windowsHide: true, cwd, env: { ...process.env, LC_ALL: "C" }, maxBuffer: 64 * 1024 },
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
 */
export async function processStartTime(pid: number): Promise<number | null> {
  if (pid === process.pid) return performance.timeOrigin;
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (process.platform === "win32") {
    const powershell = windowsPowerShell();
    const script = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p -and $p.StartTime) { [DateTimeOffset]::new($p.StartTime).ToUnixTimeMilliseconds() }`;
    const out = await systemQuery(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], join(powershell, ".."));
    const value = out === null ? Number.NaN : Number(out.trim());
    return out !== null && out.trim().length > 0 && Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  for (const ps of ["/bin/ps", "/usr/bin/ps"]) {
    const asked = Date.now();
    const out = await systemQuery(ps, ["-o", "etime=", "-p", String(pid)], "/");
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

/** Links `temporary` to `target`. False when `target` exists. */
async function tryLink(fs: LockFileSystem, temporary: string, target: string): Promise<boolean> {
  try {
    await guarded(() => fs.link(temporary, target));
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
      } catch {
        // Someone took the name meanwhile. Their file stays; the moved one is dropped.
      }
    }
  } finally {
    await fs.remove(moved).catch(() => undefined);
  }
}

type Step = { readonly kind: "acquired" } | { readonly kind: "locked"; readonly holder: LockInfo | null } | { readonly kind: "retry" };

export async function acquireLock(options: AcquireLockOptions): Promise<AcquireLockOutcome> {
  const { workspaceRoot, runId, clock } = options;
  const fs = options.fileSystem ?? nodeLockFileSystem;
  const alive = options.isProcessAlive ?? isProcessAlive;
  const startTimeOf = options.processStartTime ?? processStartTime;
  const identityOf = options.processIdentity ?? ((pid: number) => linuxProcessIdentity(pid));
  /** One answer per pid for this attempt. */
  const startTimes = new Map<number, Promise<number | null>>();
  assertRunId(runId);

  /** Whether the lock's holder (or a reclaim file's owner) still runs (N-25(b)). */
  async function holderAlive(holder: LockInfo): Promise<boolean> {
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
  }
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
      taken = await tryLink(fs, reclaimTemporary, reclaimFile);
    } finally {
      if (!taken) heldReclaims.delete(reclaimText);
    }
    if (taken) return "taken";
    const held = await readState(fs, reclaimFile);
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
      const now = await readState(fs, lockFile);
      if (now === "missing" || now.text !== deadText) return;
      await removeIfUnchanged(fs, stateDir, lockFile, deadText);
    } finally {
      await releaseReclaim();
    }
  }

  async function attempt(): Promise<Step> {
    if (await tryLink(fs, temporary, lockFile)) return { kind: "acquired" };
    const seen = await readState(fs, lockFile);
    if (seen === "missing") return { kind: "retry" };
    if (seen.holder === null || (await holderAlive(seen.holder))) return { kind: "locked", holder: seen.holder };
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
  try {
    for (let first = true; first || Date.now() < deadline; first = false) {
      let step: Step;
      try {
        step = await attempt();
      } catch (error) {
        if (!(error instanceof TransientLockError)) throw error;
        step = { kind: "retry" };
      }
      if (step.kind === "acquired") return { ok: true, lock };
      if (step.kind === "locked") return locked(step.holder);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS + Math.floor(Math.random() * RETRY_DELAY_MS)));
      const seen = await readState(fs, lockFile).catch(() => "missing" as const);
      lastHolder = seen === "missing" ? lastHolder : seen.holder;
    }
    return locked(lastHolder);
  } finally {
    await fs.remove(temporary).catch(() => undefined);
    await fs.remove(reclaimTemporary).catch(() => undefined);
  }
}

/** Removes the lock only when this process and this run hold it. Resolves to whether it was removed. */
export async function releaseLock(options: ReleaseLockOptions): Promise<boolean> {
  const { workspaceRoot, runId } = options;
  assertRunId(runId);
  const lockFile = join(workspaceRoot, STATE_DIR_NAME, LOCK_FILE_NAME);
  const held = await readState(nodeLockFileSystem, lockFile);
  if (held === "missing" || held.holder === null) return false;
  if (held.holder.runId !== runId || held.holder.pid !== process.pid) return false;
  await rm(lockFile, { force: true });
  return true;
}
