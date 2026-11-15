/**
 * DR-38: the records-changed mark of a run (`runs/<runId>/records-changed.json`, state.ts). Any entry
 * at that name counts as a mark, a readable one or not (fail closed: a mark that cannot be read or
 * checked still says the run's records are not to be trusted).
 */

import { lstat } from "node:fs/promises";
import { join } from "node:path";

import { RECORDS_CHANGED_FILE_NAME } from "../contracts/index.js";
import { assertRunId, errorCode, runDir } from "./common.js";

/** Whether the run directory `dir` holds a records-changed mark (or anything else at its name). */
export async function recordsChangedMarkIn(dir: string): Promise<boolean> {
  try {
    await lstat(join(dir, RECORDS_CHANGED_FILE_NAME));
    return true;
  } catch (error) {
    const code = errorCode(error);
    return !(code === "ENOENT" || code === "ENOTDIR");
  }
}

/**
 * DR-38: whether a run has a records-changed mark. For `report`, `revert` and the app, which say so
 * (RevertOutput, ReportOutput `recordsChanged`). `workspaceRoot` is the real absolute path.
 */
export async function hasRecordsChangedMark(workspaceRoot: string, runId: string): Promise<boolean> {
  assertRunId(runId);
  return recordsChangedMarkIn(runDir(workspaceRoot, runId));
}
