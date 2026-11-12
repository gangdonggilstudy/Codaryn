/**
 * U-29 (R-44 R44-L1): whether a run since a plan was made could not check the state directory, so
 * the plan run's records may have changed without a records-changed mark. The apply tells it
 * (ApplyDeps.planRecordsUnchecked, notice kind plan_records_unchecked) and goes on.
 */

import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { JOURNAL_FILE_NAME, MAX_REPORT_FILE_BYTES, RUNS_DIR_NAME, STATE_DIR_NAME } from "../contracts/index.js";
import type { StateUncheckedSince } from "../contracts/index.js";
import { assertRunId } from "./common.js";
import { isStoredRunId, runIdSecond } from "./runs.js";

/**
 * Whether the journal at `file` cannot be read (missing, not a plain file, too large, empty, a line
 * that is not a JSON object, a last line without its line break) or records a limited state check.
 */
async function uncheckedIn(file: string): Promise<boolean> {
  let text: string;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size === 0 || info.size > MAX_REPORT_FILE_BYTES) return true;
    text = await readFile(file, "utf8");
  } catch {
    return true;
  }
  // A journal is appended one whole line at a time; a last line without its break was cut off.
  if (!text.endsWith("\n")) return true;
  for (const line of text.slice(0, -1).split("\n")) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      return true;
    }
    if (typeof record !== "object" || record === null || Array.isArray(record)) return true;
    const { type, limited } = record as { type?: unknown; limited?: unknown };
    if (type === "state_checked" && limited === true) return true;
  }
  return false;
}

/**
 * U-33 (R-56 R56-L1, PM Q-2): whether the run `name` counts as one since the plan run. A run id names
 * the second its run started (runIdSecond), and within a second its random part says nothing of
 * the order, so every run of the plan run's second or later counts, before it or after it. A run id
 * that names no second counts, and every run does when the plan run's id names none (fail closed).
 */
function since(name: string, planSecond: number | null): boolean {
  if (!isStoredRunId(name)) return false;
  const second = runIdSecond(name);
  return planSecond === null || second === null || second >= planSecond;
}

/**
 * See StateUncheckedSince. The runs counted are the plan run and every entry of the runs folder
 * named as a run id of the plan run's second or later (later runs and apply runs, the apply asking
 * among them; see `since`); other names are not runs. An entry that is not a plain directory, and a
 * missing plan run, count as unchecked (fail closed). Reads only.
 */
export const stateUncheckedSince: StateUncheckedSince = async ({ workspaceRoot, planRunId }) => {
  assertRunId(planRunId);
  const runsDir = join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME);
  let names: string[];
  try {
    names = await readdir(runsDir);
  } catch {
    return true;
  }
  if (!names.includes(planRunId)) return true;
  const planSecond = runIdSecond(planRunId);
  for (const name of names.filter((entry) => since(entry, planSecond)).sort()) {
    const dir = join(runsDir, name);
    try {
      if (!(await lstat(dir)).isDirectory()) return true;
    } catch {
      return true;
    }
    if (await uncheckedIn(join(dir, JOURNAL_FILE_NAME))) return true;
  }
  return false;
};
