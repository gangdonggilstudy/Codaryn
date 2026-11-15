/**
 * U-285 (CLI migration C-4; plan docs/reviews/2026-11-13-cli-migration-plan.md): the assembly of one
 * run, the app layer's now. The text below is as it was in src/cli/assemble.ts (U-195 made it the one
 * assembly; U-210 and R-108 H-1 gave every part the run's unreadable paths and k through runGuards); only
 * lockedMessage is exported now, for the CLI's revert command until it moves too (C-9a). The CLI's
 * src/cli/assemble.ts re-exports these names for the tests, the pinned file and the app layer's wrapper
 * (plan A). The CLI's runs call createAssemble() without hooks, as before (DR-4: process.env).
 */

import { createPrivacyGateway } from "../privacy/index.js";
import { acquireLock, createRunRecorders, hasRecordsChangedMark, releaseLock, stateUncheckedSince, writeResult } from "../store/index.js";
import type { LockInfo } from "../store/index.js";
import { createCommandRunner, createPlannedFileProbe, createToolRunner, envValueFreeOfSecrets } from "../tools/index.js";
import { createIntegrityChecker, createVerifierRunner } from "../verify/index.js";
import { createWorkspace } from "../workspace/index.js";
import type {
  CliErrorCode,
  Clock,
  EngineDeps,
  EngineResult,
  ModelProvider,
  PlannedFileProbe,
  PolicyGate,
  PrivacyGateway,
  ResolvedTaskSpec,
  Workspace,
  WritablePathSet,
} from "../contracts/index.js";
import { runGuards } from "./input/unreadable.js";

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
  /**
   * U-195 (DR-69 B-3, B-4): the plan run whose approved `run` plan this run carries out. The outcome
   * then has `approvedPlan`. Absent: an ordinary run, as before.
   */
  readonly planRunId?: string;
}

/**
 * U-195: what the engine's runApprovedPlan needs beside EngineDeps (ApprovedPlanRunDeps,
 * ApprovedChangesPlan), made where the workspace and the recorders are.
 * - policyFor: the run's gate with the given writable lists (the engine adds the plan's files).
 * - markApplied: the recorders' claim of the plan (RunRecorders.markApplied, with planRunId).
 * - fileNow: the tools' probe of a planned file (B-6).
 * - planRecordsUnchecked: the store's question for the plan run, with this run as the apply run.
 * - planRecordsChanged: the store's records-changed mark of the plan run (hasRecordsChangedMark), which
 *   the CLI asks under the lock before the engine starts, as an apply of a plan of moves does (U-1).
 */
export interface ApprovedPlanParts {
  policyFor(writablePathSets: readonly WritablePathSet[]): PolicyGate;
  markApplied(): Promise<"marked" | "already_applied">;
  readonly fileNow: PlannedFileProbe;
  planRecordsUnchecked(): Promise<boolean>;
  planRecordsChanged(): Promise<boolean>;
}

export type AssemblyOutcome =
  | {
      readonly ok: true;
      readonly deps: EngineDeps;
      /**
       * Called exactly once after the run. Stores result.json when a result exists,
       * then releases the workspace lock (also when the run threw and `result` is null).
       * U-220 (U-176, U-201): a release that throws after its retries, or answers false, leaves the
       * lock; finish then resolves with `{ lockLeft: true }` instead of throwing, the result being
       * stored all the same, and the run's end summary says so. A finish that resolves with nothing
       * (an older or a test assembly) released the lock.
       */
      finish(result: EngineResult | null): Promise<void | { readonly lockLeft: true }>;
      /** U-195: present exactly when AssemblyInput.planRunId was given. */
      readonly approvedPlan?: ApprovedPlanParts;
    }
  | { readonly ok: false; readonly code: CliErrorCode; readonly message: string };

export type Assemble = (input: AssemblyInput) => Promise<AssemblyOutcome>;

export function lockedMessage(holder: LockInfo | null): string {
  const who = holder === null ? "an unreadable lock file" : `run ${holder.runId} (pid ${holder.pid})`;
  return `the workspace is locked by ${who}`;
}

/**
 * U-195 (PM decision on the app layer, U-196): what a host other than the CLI's own process gives the
 * assembly, so there is one assembly (createAssemble) and the app layer does not keep its own copy,
 * also for a run that carries out an approved run plan (AssemblyInput.planRunId).
 * - parentEnv, platform (DR-4): the command runner's parent environment, the run's environment copy
 *   with its variables file loaded, and the platform it was made for. Absent: `process.env` and this
 *   process's platform, as the CLI.
 * - onAssembled: told the run's privacy gateway and the real workspace root once the lock is held.
 */
export interface AssembleHooks {
  readonly parentEnv?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly onAssembled?: (assembled: { readonly privacy: PrivacyGateway; readonly workspaceRoot: string }) => void;
}

/** The assembly of one run with a host's hooks (AssembleHooks); assembleRun is the CLI's, without any. */
export function createAssemble(hooks: AssembleHooks = {}): Assemble {
  return (input) => assembleWith(input, hooks);
}

export const assembleRun: Assemble = createAssemble();

async function assembleWith(input: AssemblyInput, hooks: AssembleHooks): Promise<AssemblyOutcome> {
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
    // U-182 (DR-69 B-4): the task's writable lists (one per source); none, no such limit.
    // U-210 (bundle A, A-6; R-102 M-1, R-108 H-1): the run's unreadable paths, every source's united,
    // and its k, for every part below that judges or reads, from one place (runGuards); none, as before.
    const guards = runGuards(task, workspace);
    const policy = guards.gate();
    // T-1: one runner for tools and verifiers. The value check keeps registered secrets out of
    // the child environment; the workspace root lets .cmd/.bat run (and refuses those inside it).
    const commandRunner = createCommandRunner({
      allowEnvValue: envValueFreeOfSecrets(privacy),
      workspaceRoot,
      ...(hooks.parentEnv === undefined ? {} : { parentEnv: hooks.parentEnv }),
      ...(hooks.platform === undefined ? {} : { platform: hooks.platform }),
    });
    // R-6: write_file keeps each file's original under runs/<runId>/snapshots/ before it writes.
    // G-A, G-F: propose_plan stores plan.json for this run (runs/<runId>/plan.json); the other tools never use it.
    // DR-38: the three recorders come with the state guard that knows what they write, so the
    // engine's checks of the state directory count only what the run did not write as a change.
    // U-195 (B-3, B-7): with the plan run, the recorders can claim its plan (markApplied).
    const planRunId = input.planRunId;
    const recorders = createRunRecorders({ workspaceRoot, runId, clock, ...(planRunId === undefined ? {} : { planRunId }) });
    const { journal, changeRecorder, planRecorder, stateGuard } = recorders;
    // U-210 (bundle A, Q-4): the listing tools and query_table get the run's list and k (absent, the runner's 5).
    const tools = createToolRunner({ workspace, privacy, commandRunner, changeRecorder, planRecorder, ...guards.tools });
    // U-210 (bundle A, A-7, R-6; U-223): data_checks writes no number read from a table under the
    // run's unreadable paths, so a repair cannot carry a small group's value to the model.
    const verifiers = createVerifierRunner({ workspace, commandRunner, ...guards.verifiers });
    // U-1 (K1 connection): only when something is protected, so runs without protection keep
    // the phase 2 journal. The engine checks at run start and around each verification round.
    // U-203 (R-3): the unreadable paths are watched as the protected ones are.
    const protectedPaths = guards.protectedPaths;
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
      stateGuard,
      ...(integrity === undefined ? {} : { integrity }),
    };
    let approvedPlan: ApprovedPlanParts | undefined;
    if (planRunId !== undefined) {
      const markApplied = recorders.markApplied;
      if (markApplied === undefined) throw new Error("the recorders cannot claim the plan");
      approvedPlan = {
        // R-108 H-1: the carried-out plan's gate has the run's unreadable paths too (runGuards).
        policyFor: (writablePathSets) => guards.gate(writablePathSets),
        markApplied: () => markApplied(),
        fileNow: createPlannedFileProbe({ workspace }),
        planRecordsUnchecked: () => stateUncheckedSince({ workspaceRoot, planRunId, applyRunId: runId }),
        planRecordsChanged: () => hasRecordsChangedMark(workspaceRoot, planRunId),
      };
    }
    hooks.onAssembled?.({ privacy, workspaceRoot });
    return {
      ok: true,
      deps,
      ...(approvedPlan === undefined ? {} : { approvedPlan }),
      async finish(result) {
        let released = false;
        try {
          if (result !== null) await writeResult(workspaceRoot, result);
        } finally {
          // U-220: a release that fails is told (lockLeft), never a reason to lose the run's end.
          released = (await releaseLock({ workspaceRoot, runId }).then((value) => value === true, () => false));
        }
        return released ? undefined : { lockLeft: true as const };
      },
    };
  } catch (error) {
    // U-220: the assembly's own error is the one told, not a release that failed after it.
    await releaseLock({ workspaceRoot, runId }).catch(() => false);
    throw error;
  }
}
