/**
 * N-7 in the app layer (DR-14): the run list, `latest`, and the revert with its dry run and its
 * revert record.
 *
 * Which runs are listed, which are damaged and which one `latest` names are decided by the store
 * (`listRuns`, `latestRunId`) and the CLI's `resolveRunRef` (N-18 ambiguity), never here. So the
 * N-23 corrections in progress (forged or future start times are damaged; only runs with a result
 * can be `latest`) reach the app layer as soon as they reach those functions.
 *
 * The revert follows the contract (src/contracts/changes.ts, engine.ts RevertOutput):
 * - dry run: the same decisions, nothing changed, no lock, no revert record;
 * - revert: the workspace lock is held while files are put back and while the revert record is
 *   written, and released afterwards;
 * - `revertedBefore`: the run's revert record from before this call, when it passes its checks.
 */

import path from "node:path";
import { lstat } from "node:fs/promises";
import {
  ANTHROPIC_API_KEY_ENV,
  JOURNAL_FILE_NAME,
  LATEST_RUN_ALIAS,
  REVERT_EXIT_CODES,
  RUNS_DEFAULT_LIMIT,
  RUNS_DIR_NAME,
  RUNS_EXIT_CODES,
  RUNS_MAX_LIMIT,
  STATE_DIR_NAME,
} from "../contracts/index.js";
import type { Clock, RevertOutcome, RevertOutput, RevertRecord, RunListing, RunsOutput } from "../contracts/index.js";
import {
  RevertRunError,
  acquireLock,
  listRuns as storeListRuns,
  readRevertRecord,
  releaseLock,
  revertRun,
  writeRevertRecord,
} from "../store/index.js";
import { RUN_ID_PATTERN } from "../cli/args.js";
import { createRunId } from "../cli/run-id.js";
import { resolveRunRef, resolveWorkspaceRoot } from "../cli/runs.js";
import { hideKeys } from "../cli/text-safety.js";
import { lookupEnv } from "./environment.js";
import { appError, fromCliError } from "./errors.js";
import type { AppCallOutcome, AppEnvironment, AppError, ListRunsRequest, ResolvedRun, ResolveRunRequest, RevertRequest } from "./types.js";

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
function hideKeysInStrings<T>(value: T, currentKey: string | null): T {
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
  const currentKey = lookupEnv(environment.env, ANTHROPIC_API_KEY_ENV, environment.platform)?.trim() || null;
  return { ok: true, output: hideKeysInStrings(output, currentKey) };
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

async function isFile(file: string): Promise<boolean> {
  try {
    return (await lstat(file)).isFile();
  } catch {
    return false;
  }
}

function revertError(error: unknown): AppError {
  return error instanceof RevertRunError && error.code === "run_not_found"
    ? appError("run_not_found", "the workspace has no journal for that run id; nothing was changed")
    : appError("invalid_run_record", "the run's journal cannot be read; nothing was changed");
}

function lockedMessage(holder: { readonly runId: string; readonly pid: number } | null): string {
  const who = holder === null ? "an unreadable lock file" : `run ${holder.runId} (pid ${holder.pid})`;
  return `the workspace is locked by ${who}; nothing was changed`;
}

export async function revertIn(environment: AppEnvironment, request: RevertRequest): Promise<AppCallOutcome<RevertOutput>> {
  const root = await workspaceRootOf(request.workspace, environment.cwd);
  if (!root.ok) return root;
  const workspaceRoot = root.value;
  const id = await runIdOf(workspaceRoot, request.runId);
  if (!id.ok) return id;
  const runId = id.value;
  if (!(await isFile(path.join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME, runId, JOURNAL_FILE_NAME)))) {
    return { ok: false, error: appError("run_not_found", "the workspace has no journal for that run id; nothing was changed") };
  }
  // N-16, N-23(g): a revert record that fails its checks only takes the mark away.
  const before: RevertRecord | null = await readRevertRecord(workspaceRoot, runId).catch(() => null);
  const dryRun = request.dryRun === true;

  let outcome: RevertOutcome;
  if (dryRun) {
    try {
      outcome = await revertRun({ workspaceRoot, runId, dryRun: true });
    } catch (error) {
      return { ok: false, error: revertError(error) };
    }
  } else {
    const clock: Clock = environment.clock;
    const lockId = createRunId(new Date(clock.now()), environment.randomBytes);
    const lock = await acquireLock({ workspaceRoot, runId: lockId, clock });
    if (!lock.ok) return { ok: false, error: appError("workspace_locked", lockedMessage(lock.holder)) };
    try {
      try {
        outcome = await revertRun({ workspaceRoot, runId });
      } catch (error) {
        return { ok: false, error: revertError(error) };
      }
      const record: RevertRecord = {
        schemaVersion: 1,
        kind: "revert_record",
        runId,
        at: new Date(clock.now()).toISOString(),
        status: outcome.skipped.length === 0 ? "complete" : "partial",
        reverted: outcome.reverted.length,
        skipped: outcome.skipped.length,
      };
      // The record only marks the run as reverted in the list; the files are already back.
      await writeRevertRecord(workspaceRoot, record).catch(() => undefined);
    } finally {
      await releaseLock({ workspaceRoot, runId: lockId });
    }
  }

  const status = outcome.skipped.length === 0 ? "complete" : "partial";
  return {
    ok: true,
    output: {
      schemaVersion: 1,
      kind: "revert",
      runId,
      status,
      exitCode: REVERT_EXIT_CODES[status],
      reverted: outcome.reverted,
      skipped: outcome.skipped,
      ...(dryRun ? { dryRun: true as const } : {}),
      ...(before === null ? {} : { revertedBefore: { at: before.at, status: before.status } }),
    },
  };
}
