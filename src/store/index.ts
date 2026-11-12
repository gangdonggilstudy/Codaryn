/**
 * Run store under `<workspaceRoot>/.codaryn/`: append-only journal, result.json, the workspace lock,
 * and the change snapshots with revert (changes.ts).
 * Recording functions accept only the contract's JournalEvent and EngineResult,
 * whose free text fields are MaskedText. A raw string cannot be passed to them.
 */

import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { JOURNAL_FILE_NAME, RESULT_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../contracts/index.js";
import type { Clock, EngineResult, Journal, JournalEvent } from "../contracts/index.js";
import { assertRunId, ensureStateDir, errorCode, runDir } from "./common.js";

export { RevertRunError, createChangeRecorder, revertRun, snapshotsRelativePath } from "./changes.js";
export type { RevertRunErrorCode } from "./changes.js";
export { RUN_START_TOLERANCE_MS, RunListError, inspectRun, isRunTimestamp, isStoredRunId, latestRun, latestRunId, listRuns, listRunsAt, readRevertRecord, runIdSecond, writeRevertRecord } from "./runs.js";
export type { RunInspection } from "./runs.js";
export { PROCESS_START_TOLERANCE_MS, acquireLock, nodeLockFileSystem, processStartTime, releaseLock } from "./lock.js";
export type { AcquireLockOptions, AcquireLockOutcome, LockFileSystem, LockInfo, ReleaseLockOptions } from "./lock.js";

export interface JournalOptions {
  /** Real absolute path of the workspace root. */
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly clock: Clock;
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
