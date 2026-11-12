/**
 * Run store under `<workspaceRoot>/.codaryn/`: append-only journal, result.json, the workspace lock,
 * and the change snapshots with revert (changes.ts).
 * Recording functions accept only the contract's JournalEvent and EngineResult,
 * whose free text fields are MaskedText. A raw string cannot be passed to them.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { JOURNAL_FILE_NAME, RESULT_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../contracts/index.js";
import type { ApplyJournal, ApplyJournalEntry, EngineResult, Journal, JournalEvent } from "../contracts/index.js";
import { assertRunId, ensureStateDir, runDir } from "./common.js";
import { appendOnlyJournal } from "./journal.js";
import type { JournalOptions } from "./journal.js";

export { RevertRunError, createChangeRecorder, readRunOriginals, revertRun, snapshotsRelativePath } from "./changes.js";
export type { OriginalUnavailable, RevertRunErrorCode, RunOriginal } from "./changes.js";
export { RUN_START_TOLERANCE_MS, RunListError, inspectRun, isRunTimestamp, isStoredRunId, latestRun, latestRunId, listRuns, listRunsAt, readRevertRecord, runIdSecond, writeRevertRecord } from "./runs.js";
export type { RunInspection } from "./runs.js";
export { PROCESS_START_TOLERANCE_MS, acquireLock, inspectLock, linuxProcessIdentity, lockHolderAlive, nodeLockFileSystem, parseProcStartTicks, processStartTime, releaseLock } from "./lock.js";
export { canonicalActions, createPlanRecorder, isWorkspaceRelativePath, loadPlan, markPlanApplied } from "./plan.js";
export type { MarkPlanAppliedRequest } from "./plan.js";
export { readReviewRecord, writeReviewRecord } from "./review.js";
export { discardedRootPath, prepareDiscardedRoot } from "./discarded.js";
export type { AcquireLockOptions, AcquireLockOutcome, InspectLockOptions, LockFileSystem, LockInfo, LockInspection, LockLivenessOptions, ProcessIdentity, ReleaseLockOptions } from "./lock.js";

export type { JournalOptions } from "./journal.js";

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
  return appendOnlyJournal<JournalEvent>(options);
}

/**
 * G-E, DR-12: the journal of an apply run (ApplyJournal). Same file, same record layout
 * (`{seq, at, runId, ...event}`) and same rules as `createJournal`; its first record is
 * `apply_started`, which is how readers tell an apply run from a model run.
 */
export function createApplyJournal(options: JournalOptions): ApplyJournal {
  return appendOnlyJournal<ApplyJournalEntry>(options);
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
export { listParkedFiles } from "./apply-revert.js";
export { createApplyRecorders, createRunRecorders } from "./state-guard.js";
export type { ApplyRecorders, RunRecorders, RunRecordersOptions, StateGuardLimits } from "./state-guard.js";
export { hasRecordsChangedMark } from "./marks.js";
export { applyCleanup, planCleanup, summarizeState } from "./cleanup.js";
