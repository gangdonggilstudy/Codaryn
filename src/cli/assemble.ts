/**
 * The single place where real modules are put together for one run.
 *
 * Step 1 (now): the privacy, policy, workspace, tool, verifier and journal modules are built in
 * other branches, so they are not imported here yet. `assembleRun` reports that the run cannot
 * be assembled. Step 2 replaces its body after those modules are merged.
 */

import type { CliErrorCode, Clock, EngineDeps, EngineResult, ModelProvider, TaskSpec } from "../contracts/index.js";

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
      /** Stores result.json and releases the workspace lock. Called once after the run. */
      finish(result: EngineResult): Promise<void>;
    }
  | { readonly ok: false; readonly code: CliErrorCode; readonly message: string };

export type Assemble = (input: AssemblyInput) => Promise<AssemblyOutcome>;

export const assembleRun: Assemble = async () => ({
  ok: false,
  code: "internal_error",
  message: "core modules are not assembled yet (phase 1a step 2)",
});
