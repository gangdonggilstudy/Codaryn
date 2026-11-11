/**
 * Run store under `<workspaceRoot>/.codaryn/`: append-only journal, result.json and the workspace lock.
 * Recording functions accept only the contract's JournalEvent and EngineResult,
 * whose free text fields are MaskedText. A raw string cannot be passed to them.
 */

import { link, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";

import {
  JOURNAL_FILE_NAME,
  LOCK_FILE_NAME,
  RESULT_FILE_NAME,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
} from "../contracts/index.js";
import type { Clock, EngineResult, Journal, JournalEvent } from "../contracts/index.js";

export interface JournalOptions {
  /** Real absolute path of the workspace root. */
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly clock: Clock;
}

export interface LockInfo {
  readonly pid: number;
  readonly runId: string;
  /** ISO 8601 UTC time. */
  readonly startedAt: string;
}

export interface AcquireLockOptions {
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly clock: Clock;
}

export type AcquireLockOutcome =
  | { readonly ok: true; readonly lock: LockInfo }
  | {
      readonly ok: false;
      readonly code: "workspace_locked";
      /** `null` when the existing lock file could not be understood. It is never reclaimed then. */
      readonly holder: LockInfo | null;
    };

export interface ReleaseLockOptions {
  readonly workspaceRoot: string;
  readonly runId: string;
}

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertRunId(runId: string): void {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId) || runId.includes("..")) {
    throw new TypeError("runId must be 1-128 characters of [A-Za-z0-9._-] and must not contain '..'");
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

/** Creates the state directory and keeps its content out of version control tools. */
async function ensureStateDir(workspaceRoot: string): Promise<string> {
  const stateDir = join(workspaceRoot, STATE_DIR_NAME);
  await mkdir(stateDir, { recursive: true });
  try {
    await writeFile(join(stateDir, ".gitignore"), "*\n", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  return stateDir;
}

function runDir(workspaceRoot: string, runId: string): string {
  return join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME, runId);
}

/** Value for `EngineResult.journalPath`: relative to the workspace root, `/` separated. */
export function journalRelativePath(runId: string): string {
  assertRunId(runId);
  return [STATE_DIR_NAME, RUNS_DIR_NAME, runId, JOURNAL_FILE_NAME].join("/");
}

/**
 * Append-only JSONL journal. Each line is `{seq, at, runId, ...event}` followed by LF.
 * The file is opened in append mode on the first record. An existing journal of the same
 * run is continued, never rewritten.
 */
export function createJournal(options: JournalOptions): Journal {
  const { workspaceRoot, runId, clock } = options;
  assertRunId(runId);
  const dir = runDir(workspaceRoot, runId);
  const file = join(dir, JOURNAL_FILE_NAME);

  let handle: FileHandle | null = null;
  let seq = 0;
  let closed = false;
  let queue: Promise<void> = Promise.resolve();

  async function openForAppend(): Promise<FileHandle> {
    await ensureStateDir(workspaceRoot);
    await mkdir(dir, { recursive: true });
    let existing = "";
    try {
      existing = await readFile(file, "utf8");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    if (existing.length > 0 && !existing.endsWith("\n")) {
      throw new Error("journal ends with an incomplete line; refusing to append to it");
    }
    seq = existing.length === 0 ? 0 : existing.split("\n").length - 1;
    return open(file, "a");
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    const next = queue.then(task);
    queue = next.catch(() => undefined);
    return next;
  }

  return {
    append(event: JournalEvent): Promise<void> {
      return enqueue(async () => {
        if (closed) throw new Error("journal is closed");
        handle ??= await openForAppend();
        const record = {
          seq: seq + 1,
          at: new Date(clock.now()).toISOString(),
          runId,
          ...event,
        };
        await handle.appendFile(`${JSON.stringify(record)}\n`, "utf8");
        seq += 1;
      });
    },
    close(): Promise<void> {
      return enqueue(async () => {
        closed = true;
        if (handle !== null) {
          const current = handle;
          handle = null;
          await current.close();
        }
      });
    },
  };
}

/** Writes `<root>/.codaryn/runs/<result.runId>/result.json`: the object the CLI prints, plus LF. */
export async function writeResult(workspaceRoot: string, result: EngineResult): Promise<void> {
  assertRunId(result.runId);
  await ensureStateDir(workspaceRoot);
  const dir = runDir(workspaceRoot, result.runId);
  await mkdir(dir, { recursive: true });
  const target = join(dir, RESULT_FILE_NAME);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(result)}\n`, "utf8");
  await rename(temporary, target);
}

function parseLock(text: string): LockInfo | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { pid, runId, startedAt } = value as Record<string, unknown>;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
  if (typeof runId !== "string" || typeof startedAt !== "string") return null;
  return { pid, runId, startedAt };
}

async function readLock(lockFile: string): Promise<LockInfo | null | "missing"> {
  try {
    return parseLock(await readFile(lockFile, "utf8"));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "missing";
    throw error;
  }
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
 * Takes `<root>/.codaryn/lock.json` (`{pid, runId, startedAt}`).
 * A lock whose pid is not alive is reclaimed. A lock whose pid is alive, or a lock file that
 * cannot be parsed, makes this fail with `workspace_locked`.
 */
export async function acquireLock(options: AcquireLockOptions): Promise<AcquireLockOutcome> {
  const { workspaceRoot, runId, clock } = options;
  assertRunId(runId);
  const stateDir = await ensureStateDir(workspaceRoot);
  const lockFile = join(stateDir, LOCK_FILE_NAME);
  const lock: LockInfo = {
    pid: process.pid,
    runId,
    startedAt: new Date(clock.now()).toISOString(),
  };
  // The complete content is written first and then linked into place, so a reader never
  // sees a half-written lock and creation fails when the lock already exists.
  const temporary = join(stateDir, `${LOCK_FILE_NAME}.${process.pid}.${runId}.tmp`);
  await writeFile(temporary, `${JSON.stringify(lock)}\n`, "utf8");
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await link(temporary, lockFile);
        return { ok: true, lock };
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
      const holder = await readLock(lockFile);
      if (holder === "missing") continue;
      if (holder === null || isProcessAlive(holder.pid)) {
        return { ok: false, code: "workspace_locked", holder };
      }
      await rm(lockFile, { force: true });
    }
    const holder = await readLock(lockFile);
    return { ok: false, code: "workspace_locked", holder: holder === "missing" ? null : holder };
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Removes the lock only when this process and this run hold it. Resolves to whether it was removed. */
export async function releaseLock(options: ReleaseLockOptions): Promise<boolean> {
  const { workspaceRoot, runId } = options;
  assertRunId(runId);
  const lockFile = join(workspaceRoot, STATE_DIR_NAME, LOCK_FILE_NAME);
  const holder = await readLock(lockFile);
  if (holder === "missing" || holder === null) return false;
  if (holder.runId !== runId || holder.pid !== process.pid) return false;
  await rm(lockFile, { force: true });
  return true;
}
