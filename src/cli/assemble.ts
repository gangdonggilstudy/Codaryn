/**
 * The single place where real modules are put together for one run.
 * Other modules are used through their public `index.ts` exports only.
 */

import { lstat, stat } from "node:fs/promises";
import path from "node:path";
import { JOURNAL_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../contracts/index.js";
import { createPolicyGate } from "../policy/index.js";
import { createPrivacyGateway } from "../privacy/index.js";
import {
  RevertRunError,
  acquireLock,
  createChangeRecorder,
  createJournal,
  releaseLock,
  writeResult,
} from "../store/index.js";
import type { LockInfo } from "../store/index.js";
import { createCommandRunner, createToolRunner, envValueFreeOfSecrets } from "../tools/index.js";
import { createIntegrityChecker, createVerifierRunner } from "../verify/index.js";
import { createWorkspace } from "../workspace/index.js";
import type {
  CliErrorCode,
  Clock,
  EngineDeps,
  EngineResult,
  ListRuns,
  ModelProvider,
  ResolvedTaskSpec,
  RevertOutcome,
  RevertRun,
  RevertStatus,
  Workspace,
} from "../contracts/index.js";
import { readRevertRecord, writeRevertRecord } from "./revert-record.js";
import { resolveRunReference } from "./run-ref.js";

export interface AssemblyInput {
  readonly task: ResolvedTaskSpec;
  readonly runId: string;
  readonly model: ModelProvider;
  /** Secret values registered for this run. Never printed or recorded. */
  readonly secrets: readonly string[];
  readonly clock: Clock;
  readonly signal: AbortSignal;
  /** U-1: the config file's `integrity.paths`, already checked by the CLI. Absent means none. */
  readonly integrityPaths?: readonly string[];
}

export type AssemblyOutcome =
  | {
      readonly ok: true;
      readonly deps: EngineDeps;
      /**
       * Called exactly once after the run. Stores result.json when a result exists,
       * then releases the workspace lock (also when the run threw and `result` is null).
       */
      finish(result: EngineResult | null): Promise<void>;
    }
  | { readonly ok: false; readonly code: CliErrorCode; readonly message: string };

export type Assemble = (input: AssemblyInput) => Promise<AssemblyOutcome>;

function lockedMessage(holder: LockInfo | null): string {
  const who = holder === null ? "an unreadable lock file" : `run ${holder.runId} (pid ${holder.pid})`;
  return `the workspace is locked by ${who}`;
}

export interface RevertCommandInput {
  /** Absolute path of an existing directory. */
  readonly workspace: string;
  /** The run to revert, or LATEST_RUN_ALIAS. Already checked against RUN_ID_PATTERN. */
  readonly runId: string;
  /** Id under which this revert holds the workspace lock. */
  readonly lockId: string;
  readonly clock: Clock;
  /** N-7: decide and report, change nothing; no lock and no revert record. */
  readonly dryRun?: boolean;
}

export type RevertCommandOutcome =
  | {
      readonly ok: true;
      readonly outcome: RevertOutcome;
      /** The run that was (or would be) reverted: `latest` resolved. */
      readonly runId: string;
      /** N-7: the run's checked revert record from before this command, or null. */
      readonly revertedBefore: { readonly at: string; readonly status: RevertStatus } | null;
    }
  | { readonly ok: false; readonly code: CliErrorCode; readonly message: string };

export type RevertCommand = (input: RevertCommandInput) => Promise<RevertCommandOutcome>;

export interface RevertCommandOptions {
  /**
   * N-7: the store's `revertRun` when it honours `RevertRequest.dryRun` (it changes nothing then).
   * Absent: `--dry-run` stops before anything is read, because a store that ignored the flag
   * would really revert.
   */
  readonly dryRun?: RevertRun;
  /** N-7: the store's `listRuns`, for `--run latest`. Absent: `latest` is not available. */
  readonly listRuns?: ListRuns;
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * `codaryn revert` around the store's `revertRun` (R-7). The run must have a journal in this
 * workspace. The workspace lock is held while files are put back, so no run can start meanwhile,
 * and a running task makes the revert stop with `workspace_locked` before anything changes.
 */
export function createRevertCommand(revertRun: RevertRun, options: RevertCommandOptions = {}): RevertCommand {
  const failed = (error: unknown): RevertCommandOutcome => {
    // revertRun rejects only before it changes anything. Its text is not passed on.
    const code = error instanceof RevertRunError && error.code === "run_not_found" ? "run_not_found" : "invalid_run_record";
    const message =
      code === "run_not_found"
        ? "the workspace has no journal for that run id; nothing was changed"
        : "the run's journal cannot be read; nothing was changed";
    return { ok: false, code, message };
  };
  return async ({ workspace, runId: requested, lockId, clock, dryRun = false }) => {
    if (dryRun && options.dryRun === undefined) {
      return { ok: false, code: "internal_error", message: "--dry-run is not connected in this build; nothing was read or changed" };
    }
    let workspaceRoot: string;
    try {
      workspaceRoot = (await createWorkspace({ root: workspace })).root;
    } catch {
      return { ok: false, code: "workspace_not_found", message: "the workspace is not an existing directory" };
    }
    // N-7, N-18: `latest` is resolved first; an ambiguous one stops here.
    const resolved = await resolveRunReference(workspaceRoot, requested, { exists, ...(options.listRuns === undefined ? {} : { listRuns: options.listRuns }) });
    if (!resolved.ok) return resolved;
    const runId = resolved.runId;
    const journal = path.join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME, runId, JOURNAL_FILE_NAME);
    if (!(await isFile(journal))) {
      return { ok: false, code: "run_not_found", message: "the workspace has no journal for that run id; nothing was changed" };
    }
    const revertedBefore = await readRevertRecord(workspaceRoot, runId);

    if (dryRun && options.dryRun !== undefined) {
      // N-7: no lock, no record, nothing written.
      try {
        return { ok: true, outcome: await options.dryRun({ workspaceRoot, runId, dryRun: true }), runId, revertedBefore };
      } catch (error) {
        return failed(error);
      }
    }

    const lock = await acquireLock({ workspaceRoot, runId: lockId, clock });
    if (!lock.ok) return { ok: false, code: "workspace_locked", message: `${lockedMessage(lock.holder)}; nothing was changed` };
    try {
      const outcome = await revertRun({ workspaceRoot, runId });
      // N-7: the revert record, written while the lock is held; best effort.
      await writeRevertRecord(workspaceRoot, {
        schemaVersion: 1,
        kind: "revert_record",
        runId,
        at: new Date(clock.now()).toISOString(),
        status: outcome.skipped.length === 0 ? "complete" : "partial",
        reverted: outcome.reverted.length,
        skipped: outcome.skipped.length,
      });
      return { ok: true, outcome, runId, revertedBefore };
    } catch (error) {
      return failed(error);
    } finally {
      await releaseLock({ workspaceRoot, runId: lockId });
    }
  };
}

export const assembleRun: Assemble = async (input) => {
  const { task, runId, model, secrets, clock, signal } = input;

  let workspace: Workspace;
  try {
    workspace = await createWorkspace({ root: task.workspaceRoot });
  } catch {
    return { ok: false, code: "workspace_not_found", message: "workspaceRoot is not an existing directory" };
  }
  const workspaceRoot = workspace.root;

  const lock = await acquireLock({ workspaceRoot, runId, clock });
  if (!lock.ok) return { ok: false, code: "workspace_locked", message: lockedMessage(lock.holder) };

  try {
    const privacy = createPrivacyGateway({ secrets });
    const policy = createPolicyGate({ config: task.policy, workspace });
    // T-1: one runner for tools and verifiers. The value check keeps registered secrets out of
    // the child environment; the workspace root lets .cmd/.bat run (and refuses those inside it).
    const commandRunner = createCommandRunner({ allowEnvValue: envValueFreeOfSecrets(privacy), workspaceRoot });
    // R-6: write_file keeps each file's original under runs/<runId>/snapshots/ before it writes.
    const changeRecorder = createChangeRecorder({ workspaceRoot, runId });
    const tools = createToolRunner({ workspace, privacy, commandRunner, changeRecorder });
    const verifiers = createVerifierRunner({ workspace, commandRunner });
    const journal = createJournal({ workspaceRoot, runId, clock });
    // U-1 (K1 connection): only when something is protected, so runs without protection keep
    // the phase 2 journal. The engine checks at run start and around each verification round.
    const protectedPaths = task.policy.protectedPaths ?? [];
    const externalPaths = input.integrityPaths ?? [];
    const integrity =
      protectedPaths.length > 0 || externalPaths.length > 0
        ? createIntegrityChecker({ workspace, protectedPaths, externalPaths })
        : undefined;

    const deps: EngineDeps = {
      task,
      runId,
      model,
      privacy,
      policy,
      tools,
      verifiers,
      journal,
      clock,
      signal,
      ...(integrity === undefined ? {} : { integrity }),
    };
    return {
      ok: true,
      deps,
      async finish(result) {
        try {
          if (result !== null) await writeResult(workspaceRoot, result);
        } finally {
          await releaseLock({ workspaceRoot, runId });
        }
      },
    };
  } catch (error) {
    await releaseLock({ workspaceRoot, runId });
    throw error;
  }
};
