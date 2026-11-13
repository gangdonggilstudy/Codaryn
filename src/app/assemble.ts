/**
 * Assembly of one run for the app layer: the same modules in the same order as the CLI's
 * `assembleRun` (src/cli/assemble.ts), with one difference (DR-4): the command runner
 * takes its parent environment from the run's environment copy, not from `process.env`.
 *
 * Why: the CLI loads `--vars-file` into `process.env`, and the runner passes the variables on its
 * allowlist (CHILD_ENV_ALLOWLIST) from there to the child commands. The app layer loads the file
 * into a copy instead, so it hands that copy to the runner to keep the same result; in a process
 * shared with other code it also keeps the host's own variables out of the children.
 *
 * What actually reaches a child from the variables file (R-4 I-1): only an allowlisted variable
 * whose value is shorter than 8 characters. A value of 8 or more characters that the file newly
 * sets is registered as a secret (S-4), and the runner leaves out every variable whose value holds
 * a registered secret (T-1, `envValueFreeOfSecrets`). So a long PATH or TEMP from the file does not
 * reach the child, in the CLI and in the app layer alike.
 *
 * Interim: migration step 2 moves `assembleRun` here and removes the CLI's copy.
 */

import { createPolicyGate } from "../policy/index.js";
import { createPrivacyGateway } from "../privacy/index.js";
import { acquireLock, createRunRecorders, hasRecordsChangedMark, releaseLock, stateUncheckedSince, writeResult } from "../store/index.js";
import { retryLockRelease } from "./lock-retry.js";
import type { LockRetryOptions } from "./lock-retry.js";
import type { LockInfo } from "../store/index.js";
import { createCommandRunner, createPlannedFileProbe, createToolRunner, envValueFreeOfSecrets } from "../tools/index.js";
import { createIntegrityChecker, createVerifierRunner } from "../verify/index.js";
import { createWorkspace } from "../workspace/index.js";
import type { EngineDeps, PrivacyGateway, Workspace } from "../contracts/index.js";
import type { ApprovedPlanParts, Assemble } from "../cli/assemble.js";

function lockedMessage(holder: LockInfo | null): string {
  const who = holder === null ? "an unreadable lock file" : `run ${holder.runId} (pid ${holder.pid})`;
  return `the workspace is locked by ${who}`;
}

/**
 * `parentEnv` is the run's environment after the variables file was loaded. `onAssembled` receives
 * the run's privacy gateway and the real workspace root once the lock is held.
 * U-193 (after U-176): when the run's lock cannot be released at its end (the release threw after
 * its retries, or answered false), `onLockLeft` is called and the run's end goes on: its result
 * (written to result.json first) stays, not an internal error. The lock is then held while this
 * process lives, and a later run of another process finds it stale once it has ended.
 * U-211: a release that threw is tried again a few seconds later (retryLockRelease, `lockRetry`),
 * for this run's lock only; an answer of false (the lock is not this run's) is not.
 * U-229 (after U-220): finish then also resolves with `{ lockLeft: true }`, as the CLI's assembly
 * does, and with nothing when it released the lock.
 * U-218 (DR-69 B-4): with AssemblyInput.planRunId (a run that carries out an approved run plan), the
 * outcome has `approvedPlan` as the CLI's assembly gives it (U-195): the gate for the given writable
 * lists, the recorders' claim of the plan, the planned file probe and the store's two questions about
 * the plan run. The CLI refuses such a run without them.
 */
export function createAppAssemble(
  parentEnv: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  onAssembled: (assembled: { readonly privacy: PrivacyGateway; readonly workspaceRoot: string }) => void,
  onLockLeft: () => void = () => undefined,
  lockRetry: LockRetryOptions = {},
): Assemble {
  return async (input) => {
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
      // U-186 (DR-69 B-4, after U-182): the task's writable path lists, as the CLI's run gate gets them.
      const policy = createPolicyGate({ config: task.policy, workspace, ...(task.writablePathSets === undefined ? {} : { writablePathSets: task.writablePathSets }) });
      // T-1 as in the CLI, and DR-4: the parent environment is the run's copy.
      const commandRunner = createCommandRunner({
        allowEnvValue: envValueFreeOfSecrets(privacy),
        workspaceRoot,
        parentEnv: parentEnv as NodeJS.ProcessEnv,
        platform,
      });
      // DR-38 as in the CLI (b8c9c1d): the journal, change recorder and plan recorder come with the
      // state guard that knows what they write, so the engine's checks of the state directory count
      // only what the run did not write. G-A, G-F: propose_plan stores plan.json for this run.
      // U-218 (as the CLI, U-195): with the plan run, the recorders can claim its plan (markApplied).
      const planRunId = input.planRunId;
      const recorders = createRunRecorders({ workspaceRoot, runId, clock, ...(planRunId === undefined ? {} : { planRunId }) });
      const { journal, changeRecorder, planRecorder, stateGuard } = recorders;
      const tools = createToolRunner({ workspace, privacy, commandRunner, changeRecorder, planRecorder });
      const verifiers = createVerifierRunner({ workspace, commandRunner });
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
        stateGuard,
        ...(integrity === undefined ? {} : { integrity }),
      };
      let approvedPlan: ApprovedPlanParts | undefined;
      if (planRunId !== undefined) {
        const markApplied = recorders.markApplied;
        if (markApplied === undefined) throw new Error("the recorders cannot claim the plan");
        approvedPlan = {
          policyFor: (writablePathSets) => createPolicyGate({ config: task.policy, workspace, writablePathSets }),
          markApplied: () => markApplied(),
          fileNow: createPlannedFileProbe({ workspace }),
          planRecordsUnchecked: () => stateUncheckedSince({ workspaceRoot, planRunId, applyRunId: runId }),
          planRecordsChanged: () => hasRecordsChangedMark(workspaceRoot, planRunId),
        };
      }
      onAssembled({ privacy, workspaceRoot });
      return {
        ok: true,
        deps,
        ...(approvedPlan === undefined ? {} : { approvedPlan }),
        async finish(result) {
          let released = false;
          try {
            if (result !== null) await writeResult(workspaceRoot, result);
          } finally {
            // U-193: a lock left is told, never a reason to lose the run's result.
            let threw = false;
            try {
              released = (await releaseLock({ workspaceRoot, runId })) === true;
            } catch {
              threw = true;
            }
            if (!released) onLockLeft();
            // U-211: the file may be held a moment longer than the store's retries; tried again later.
            if (threw) void retryLockRelease({ workspaceRoot, runId }, lockRetry);
          }
          // U-229 (U-220's contract): the CLI reads a lock left from finish (its end summary).
          return released ? undefined : { lockLeft: true as const };
        },
      };
    } catch (error) {
      await releaseLock({ workspaceRoot, runId });
      throw error;
    }
  };
}
