/**
 * N-7, N-18: what `--run <runId|latest>` names in `report` and `revert`.
 *
 * - A run id is used as it is.
 * - `latest` is the first `checked` run `listRuns` returns (damaged runs are never chosen, N-16).
 * - N-18: when `<root>/.codaryn/runs/latest` exists, `latest` is not treated as the alias: the
 *   command stops with `invalid_arguments` and changes nothing, since it cannot tell which run
 *   was meant.
 */

import path from "node:path";
import { LATEST_RUN_ALIAS, RUNS_DIR_NAME, STATE_DIR_NAME } from "../contracts/index.js";
import type { CliErrorCode, ListRuns } from "../contracts/index.js";

export interface RunReferenceDeps {
  /** True when anything (file, directory, link) exists at the path. Never throws. */
  readonly exists: (target: string) => Promise<boolean>;
  /** The store's `listRuns`. Absent: `latest` is not available in this build. */
  readonly listRuns?: ListRuns;
}

export type RunReferenceOutcome =
  | { readonly ok: true; readonly runId: string }
  | { readonly ok: false; readonly code: CliErrorCode; readonly message: string };

/** `workspaceRoot` is the real path of an existing workspace. */
export async function resolveRunReference(workspaceRoot: string, runId: string, deps: RunReferenceDeps): Promise<RunReferenceOutcome> {
  if (runId !== LATEST_RUN_ALIAS) return { ok: true, runId };
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
  const latest = listing.runs.find((entry) => entry.state === "checked");
  if (latest === undefined) return { ok: false, code: "run_not_found", message: "the workspace has no run whose records could be checked; nothing was changed" };
  return { ok: true, runId: latest.runId };
}
