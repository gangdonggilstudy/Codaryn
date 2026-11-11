/**
 * The single place where real modules are put together for one run.
 * Other modules are used through their public `index.ts` exports only.
 */

import { createPolicyGate } from "../policy/index.js";
import { createPrivacyGateway } from "../privacy/index.js";
import { acquireLock, createJournal, releaseLock, writeResult } from "../store/index.js";
import { createCommandRunner, createToolRunner } from "../tools/index.js";
import { createVerifierRunner } from "../verify/index.js";
import { createWorkspace } from "../workspace/index.js";
import type {
  CliErrorCode,
  Clock,
  EngineDeps,
  EngineResult,
  ModelProvider,
  TaskSpec,
  Workspace,
} from "../contracts/index.js";

export interface AssemblyInput {
  readonly task: TaskSpec;
  readonly runId: string;
  readonly model: ModelProvider;
  /** Secret values registered for this run. Never printed or recorded. */
  readonly secrets: readonly string[];
  readonly clock: Clock;
  readonly signal: AbortSignal;
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
  if (!lock.ok) {
    const holder = lock.holder === null ? "an unreadable lock file" : `run ${lock.holder.runId} (pid ${lock.holder.pid})`;
    return { ok: false, code: "workspace_locked", message: `the workspace is locked by ${holder}` };
  }

  try {
    const privacy = createPrivacyGateway({ secrets });
    const policy = createPolicyGate({ config: task.policy, workspace });
    const commandRunner = createCommandRunner();
    const tools = createToolRunner({ workspace, privacy, commandRunner });
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
