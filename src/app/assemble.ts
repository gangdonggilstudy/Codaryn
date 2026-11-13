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
import { acquireLock, createRunRecorders, releaseLock, writeResult } from "../store/index.js";
import type { LockInfo } from "../store/index.js";
import { createCommandRunner, createToolRunner, envValueFreeOfSecrets } from "../tools/index.js";
import { createIntegrityChecker, createVerifierRunner } from "../verify/index.js";
import { createWorkspace } from "../workspace/index.js";
import type { EngineDeps, PrivacyGateway, Workspace } from "../contracts/index.js";
import type { Assemble } from "../cli/assemble.js";

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
 */
export function createAppAssemble(
  parentEnv: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  onAssembled: (assembled: { readonly privacy: PrivacyGateway; readonly workspaceRoot: string }) => void,
  onLockLeft: () => void = () => undefined,
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
      const { journal, changeRecorder, planRecorder, stateGuard } = createRunRecorders({ workspaceRoot, runId, clock });
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
      onAssembled({ privacy, workspaceRoot });
      return {
        ok: true,
        deps,
        async finish(result) {
          try {
            if (result !== null) await writeResult(workspaceRoot, result);
          } finally {
            // U-193: a lock left is told, never a reason to lose the run's result.
            let released = false;
            try {
              released = (await releaseLock({ workspaceRoot, runId })) === true;
            } catch {
              released = false;
            }
            if (!released) onLockLeft();
          }
        },
      };
    } catch (error) {
      await releaseLock({ workspaceRoot, runId });
      throw error;
    }
  };
}
