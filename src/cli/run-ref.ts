/**
 * N-7, N-18, N-23: what `--run <runId|latest>` names in `report` and `revert`.
 *
 * - A run id is used as it is. N-27 (a): when the caller passes the store's `inspectRun`, an id
 *   with no entry of exactly that name (a case variant on a volume that ignores case) is
 *   `run_not_found`; whether a damaged run is refused stays with the caller (revert N-26, report
 *   N-27 b, plan/apply/review G-F).
 * - `latest` is the store's `latestRun` over `listRuns` (the rule lives in the store only: the
 *   first checked run with a result, N-23 b; damaged runs are never chosen, N-16).
 * - N-18: when `<root>/.codaryn/runs/latest` exists, `latest` is not treated as the alias: the
 *   command stops with `invalid_arguments` and changes nothing, since it cannot tell which run
 *   was meant.
 * - N-23: the caller shows the chosen run (id and start time) before it acts.
 * - U-22 (R-51 M-2): this is the one rule for `latest`. Every command and the app layer resolve it
 *   here (STORE_RUN_REFERENCE_DEPS gives the store's functions), not with a rule of their own.
 * - U-22 (DR-48, AXM-8): `latest` is the newest run. When a checked run without a result that is
 *   newer than the finished run `latestRun` would choose (or there is none) holds the workspace lock
 *   with a live holder, the answer is `run_in_progress` (try again when it ends), not that older
 *   run and not `run_not_found` (PM decision). A newer run that stopped without a result (no live
 *   lock) is passed over as before. A run id given as it is shows that run.
 */

import { lstat } from "node:fs/promises";
import path from "node:path";
import { LATEST_RUN_ALIAS, RUNS_DIR_NAME, STATE_DIR_NAME } from "../contracts/index.js";
import type { CliErrorCode, ListRuns, RunListEntry } from "../contracts/index.js";
import { inspectLock, latestRun, listRuns } from "../store/index.js";
import type { RunInspection } from "../store/index.js";

export type CheckedRun = Extract<RunListEntry, { readonly state: "checked" }>;

export interface RunReferenceDeps {
  /** True when anything (file, directory, link) exists at the path. Never throws. */
  readonly exists: (target: string) => Promise<boolean>;
  /** The store's `listRuns`. Absent: `latest` is not available in this build. */
  readonly listRuns?: ListRuns;
  /** N-27 (a): the store's `inspectRun`. Absent: an explicit id is used as it is. */
  readonly inspect?: (workspaceRoot: string, runId: string) => Promise<RunInspection>;
  /**
   * U-22: whether that run holds the workspace lock with a live holder. Absent: the store's
   * `inspectLock` (reads only). Asked only for runs without a result newer than the latest finished one.
   */
  readonly runInProgress?: (workspaceRoot: string, runId: string) => Promise<boolean>;
}

/** True when anything (file, directory, link) exists at the path. Never throws. */
async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * U-22 (R-51 M-2): the store's functions for resolveRunReference, for a caller that has no others
 * (the app layer, the run list). `inspect` is left out: an explicit id is used as it is, as before;
 * a caller that checks the id's exact form (N-27 a) adds the store's `inspectRun`.
 */
export const STORE_RUN_REFERENCE_DEPS: RunReferenceDeps = { exists: pathExists, listRuns };

async function holdsLock(workspaceRoot: string, runId: string): Promise<boolean> {
  const lock = await inspectLock(workspaceRoot);
  return lock.state === "held" && lock.holder.runId === runId;
}

export type RunReferenceOutcome =
  | { readonly ok: true; readonly runId: string; readonly latest: CheckedRun | null }
  | { readonly ok: false; readonly code: CliErrorCode; readonly message: string };

/** `workspaceRoot` is the real path of an existing workspace. */
export async function resolveRunReference(workspaceRoot: string, runId: string, deps: RunReferenceDeps): Promise<RunReferenceOutcome> {
  if (runId !== LATEST_RUN_ALIAS) {
    if (deps.inspect !== undefined) {
      let inspection: RunInspection;
      try {
        inspection = await deps.inspect(workspaceRoot, runId);
      } catch {
        inspection = "damaged";
      }
      if (inspection === "missing") {
        return { ok: false, code: "run_not_found", message: "the workspace has no run directory of exactly that id; nothing was changed" };
      }
    }
    return { ok: true, runId, latest: null };
  }
  if (await deps.exists(path.join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME, LATEST_RUN_ALIAS))) {
    return {
      ok: false,
      code: "invalid_arguments",
      message: `a run directory named "${LATEST_RUN_ALIAS}" exists, so --run ${LATEST_RUN_ALIAS} is ambiguous; give the run id from \`codaryn runs\`. Nothing was changed`,
    };
  }
  if (deps.listRuns === undefined) {
    return { ok: false, code: "internal_error", message: `--run ${LATEST_RUN_ALIAS} is not connected in this build; give a run id. Nothing was changed` };
  }
  let listing: Awaited<ReturnType<ListRuns>>;
  try {
    listing = await deps.listRuns({ workspaceRoot });
  } catch {
    return { ok: false, code: "invalid_run_record", message: "the workspace's run records cannot be listed; nothing was changed" };
  }
  const latest = latestRun(listing.runs);
  // U-22 (AXM-8, PM): a run still going that is newer than `latest` (listRuns: newest first) is the
  // newest run; it is not passed over for an older one, and it is not "no run".
  const inProgress = deps.runInProgress ?? holdsLock;
  for (const run of listing.runs) {
    if (latest !== null && run.runId === latest.runId) break;
    if (run.state !== "checked" || run.status !== null) continue;
    let going: boolean;
    try {
      going = await inProgress(workspaceRoot, run.runId);
    } catch {
      going = false;
    }
    if (going) {
      return {
        ok: false,
        code: "run_in_progress",
        message: `the latest run (${run.runId}) is still going and has no result yet; nothing was changed. Try again when it ends, or give a run id`,
      };
    }
  }
  if (latest === null) {
    return { ok: false, code: "run_not_found", message: "the workspace has no finished run whose records could be checked; nothing was changed" };
  }
  return { ok: true, runId: latest.runId, latest };
}
