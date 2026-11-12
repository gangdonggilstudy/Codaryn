/**
 * N-7 in the app layer (DR-14): the run list and which run a reference (`latest`) names.
 *
 * Which runs are listed, which are damaged and which one `latest` names are decided by the store
 * (`listRuns`, `latestRunId`) and the CLI's `resolveRunRef` (N-18, N-23, N-26), never here, so
 * their rules reach the app layer as they change. The revert itself is the CLI's revert command
 * (app.ts), with the options main.ts gives it.
 */

import { LATEST_RUN_ALIAS, RUNS_DEFAULT_LIMIT, RUNS_EXIT_CODES, RUNS_MAX_LIMIT } from "../contracts/index.js";
import type { RunListing, RunsOutput } from "../contracts/index.js";
import { listRuns as storeListRuns } from "../store/index.js";
import { RUN_ID_PATTERN } from "../cli/args.js";
import { resolveRunRef, resolveWorkspaceRoot } from "../cli/runs.js";
import { knownKeyValues } from "../cli/settings.js";
import { hideKeys } from "../cli/text-safety.js";
import type { KnownKeys } from "../cli/security/index.js";
import { copyEnvironment } from "./environment.js";
import { appError, fromCliError } from "./errors.js";
import type { AppCallOutcome, AppEnvironment, AppError, ListRunsRequest, ResolvedRun, ResolveRunRequest } from "./types.js";

type Resolved<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AppError };

const RUN_ID_MESSAGE = "the run must be a run id (1-128 characters of letters, digits, '.', '_' and '-') or latest";

/** The workspace's real path, as `runs`, `report` and `revert` resolve it (S-5 first). */
export async function workspaceRootOf(workspace: string, cwd: string): Promise<Resolved<string>> {
  const root = await resolveWorkspaceRoot(workspace, cwd);
  if (!root.ok) {
    const output = root.error.output;
    return { ok: false, error: output.kind === "error" ? fromCliError(output) : appError("internal_error", "the workspace could not be resolved") };
  }
  return { ok: true, value: root.value };
}

/** A run id as given, or the id `latest` names (store and CLI rules, N-7, N-18, N-23). */
export async function runIdOf(workspaceRoot: string, run: string): Promise<Resolved<string>> {
  if (run !== LATEST_RUN_ALIAS && (!RUN_ID_PATTERN.test(run) || run.includes(".."))) {
    return { ok: false, error: appError("invalid_arguments", RUN_ID_MESSAGE) };
  }
  const resolved = await resolveRunRef(workspaceRoot, run);
  if (!resolved.ok) {
    const output = resolved.error.output;
    return { ok: false, error: output.kind === "error" ? fromCliError(output) : appError("internal_error", "the run could not be resolved") };
  }
  return { ok: true, value: resolved.value };
}

/** Every string in `value` with key shapes and the current key hidden, as `runs --json` does (N-23 a). */
function hideKeysInStrings<T>(value: T, currentKey: KnownKeys): T {
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") return hideKeys(item, currentKey);
    if (Array.isArray(item)) return item.map(walk);
    if (typeof item === "object" && item !== null) return Object.fromEntries(Object.entries(item).map(([name, child]) => [name, walk(child)]));
    return item;
  };
  return walk(value) as T;
}

async function listing(workspaceRoot: string): Promise<Resolved<RunListing>> {
  try {
    return { ok: true, value: await storeListRuns({ workspaceRoot }) };
  } catch {
    return { ok: false, error: appError("invalid_run_record", "the run records directory cannot be listed, or it is a link") };
  }
}

export async function listRunsIn(environment: AppEnvironment, request: ListRunsRequest): Promise<AppCallOutcome<RunsOutput>> {
  const limit = request.limit ?? RUNS_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > RUNS_MAX_LIMIT) {
    return { ok: false, error: appError("invalid_arguments", `the limit must be a whole number from 1 to ${RUNS_MAX_LIMIT}`) };
  }
  const root = await workspaceRootOf(request.workspace, environment.cwd);
  if (!root.ok) return root;
  const listed = await listing(root.value);
  if (!listed.ok) return listed;
  const output: RunsOutput = {
    schemaVersion: 1,
    kind: "runs",
    status: "listed",
    exitCode: RUNS_EXIT_CODES.listed,
    runs: listed.value.runs.slice(0, limit),
    omitted: Math.max(0, listed.value.runs.length - limit),
  };
  // SP-2: every API provider's key, as the CLI's `runs` hides them.
  return { ok: true, output: hideKeysInStrings(output, knownKeyValues(copyEnvironment(environment.env, environment.platform))) };
}

/** N-23(b): which run a reference names, with its start time, so an adapter can show it before acting. */
export async function resolveRunIn(environment: AppEnvironment, request: ResolveRunRequest): Promise<AppCallOutcome<ResolvedRun>> {
  const root = await workspaceRootOf(request.workspace, environment.cwd);
  if (!root.ok) return root;
  const id = await runIdOf(root.value, request.run);
  if (!id.ok) return id;
  const listed = await listing(root.value);
  const entry = listed.ok ? listed.value.runs.find((run) => run.runId === id.value) : undefined;
  return {
    ok: true,
    output: {
      runId: id.value,
      latest: request.run === LATEST_RUN_ALIAS,
      startedAt: entry !== undefined && entry.state === "checked" ? entry.startedAt : null,
      damaged: entry !== undefined && entry.state === "damaged",
    },
  };
}
