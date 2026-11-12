/**
 * N-7, N-18, N-23: what `--run <runId|latest>` names in `report` and `revert`.
 *
 * - A run id is used as it is.
 * - `latest` is the first run `listRuns` returns that is `checked` and has a result (N-23 b: a run
 *   without result.json is never chosen; damaged runs never are, N-16).
 * - N-18: when `<root>/.codaryn/runs/latest` exists, `latest` is not treated as the alias: the
 *   command stops with `invalid_arguments` and changes nothing, since it cannot tell which run
 *   was meant.
 * - N-23: the caller shows the chosen run (id and start time) before it acts.
 */

import path from "node:path";
import { LATEST_RUN_ALIAS, RUNS_DIR_NAME, STATE_DIR_NAME } from "../contracts/index.js";
import type { CliErrorCode, ListRuns, RunListEntry } from "../contracts/index.js";

export type CheckedRun = Extract<RunListEntry, { readonly state: "checked" }>;

export interface RunReferenceDeps {
  /** True when anything (file, directory, link) exists at the path. Never throws. */
  readonly exists: (target: string) => Promise<boolean>;
  /** The store's `listRuns`. Absent: `latest` is not available in this build. */
  readonly listRuns?: ListRuns;
}

export type RunReferenceOutcome =
  | { readonly ok: true; readonly runId: string; readonly latest: CheckedRun | null }
  | { readonly ok: false; readonly code: CliErrorCode; readonly message: string };

/** `workspaceRoot` is the real path of an existing workspace. */
export async function resolveRunReference(workspaceRoot: string, runId: string, deps: RunReferenceDeps): Promise<RunReferenceOutcome> {
  if (runId !== LATEST_RUN_ALIAS) return { ok: true, runId, latest: null };
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
  const latest = listing.runs.find((entry): entry is CheckedRun => entry.state === "checked" && entry.status !== null);
  if (latest === undefined) {
    return { ok: false, code: "run_not_found", message: "the workspace has no finished run whose records could be checked; nothing was changed" };
  }
  return { ok: true, runId: latest.runId, latest };
}
