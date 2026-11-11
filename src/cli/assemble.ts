/**
 * The single place where real modules are put together for one run.
 * Other modules are used through their public `index.ts` exports only.
 */

import { stat } from "node:fs/promises";
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
import { createVerifierRunner } from "../verify/index.js";
import { createWorkspace } from "../workspace/index.js";
import type {
  CliErrorCode,
  Clock,
  EngineDeps,
  EngineResult,
  ModelProvider,
  ResolvedTaskSpec,
  RevertOutcome,
  RevertRun,
  Workspace,
} from "../contracts/index.js";

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

/**
 * Whether this build checks protected material (U-1). The checker (`createIntegrityChecker`,
 * K2) is connected after it is merged; until then a run that names `integrity.paths` is refused
 * before the lock is taken, so a configured check is never silently skipped.
 */
export const INTEGRITY_CONNECTED = false;

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
  /** The run to revert. Already checked against RUN_ID_PATTERN. */
  readonly runId: string;
  /** Id under which this revert holds the workspace lock. */
  readonly lockId: string;
  readonly clock: Clock;
}

export type RevertCommandOutcome =
  | { readonly ok: true; readonly outcome: RevertOutcome }
  | { readonly ok: false; readonly code: CliErrorCode; readonly message: string };

export type RevertCommand = (input: RevertCommandInput) => Promise<RevertCommandOutcome>;

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
export function createRevertCommand(revertRun: RevertRun): RevertCommand {
  return async ({ workspace, runId, lockId, clock }) => {
    let workspaceRoot: string;
    try {
      workspaceRoot = (await createWorkspace({ root: workspace })).root;
    } catch {
      return { ok: false, code: "workspace_not_found", message: "the workspace is not an existing directory" };
    }
    const journal = path.join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME, runId, JOURNAL_FILE_NAME);
    if (!(await isFile(journal))) {
      return { ok: false, code: "run_not_found", message: "the workspace has no journal for that run id; nothing was changed" };
    }

    const lock = await acquireLock({ workspaceRoot, runId: lockId, clock });
    if (!lock.ok) return { ok: false, code: "workspace_locked", message: `${lockedMessage(lock.holder)}; nothing was changed` };
    try {
      return { ok: true, outcome: await revertRun({ workspaceRoot, runId }) };
    } catch (error) {
      // revertRun rejects only before it changes anything. Its text is not passed on.
      const code = error instanceof RevertRunError && error.code === "run_not_found" ? "run_not_found" : "invalid_run_record";
      const message =
        code === "run_not_found"
          ? "the workspace has no journal for that run id; nothing was changed"
          : "the run's journal cannot be read; nothing was changed";
      return { ok: false, code, message };
    } finally {
      await releaseLock({ workspaceRoot, runId: lockId });
    }
  };
}

export const assembleRun: Assemble = async (input) => {
  const { task, runId, model, secrets, clock, signal } = input;
  if (!INTEGRITY_CONNECTED && (input.integrityPaths?.length ?? 0) > 0) {
    return {
      ok: false,
      code: "invalid_config",
      message: "integrity.paths is set, but this build does not check protected material yet; nothing was run",
    };
  }

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

    const deps: EngineDeps = { task, runId, model, privacy, policy, tools, verifiers, journal, clock, signal };
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
