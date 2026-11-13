/**
 * U-210 (P1 bundle A, A-6; R-2, Q-4, review R-102 M-1): the run's unreadable paths and its group size
 * k (ResolvedTaskSpec.unreadablePaths, .minGroupSize), from every source a run has. Shared by the
 * task's preparation (run.ts) and doctor, so both see the same list.
 */

import { ANALYZE_PRIVATE_WORKFLOW_ID, effectiveMinGroupSize, unreadablePathsOf } from "../contracts/index.js";
import type { PolicyConfig } from "../contracts/index.js";
import type { WritableSources } from "./writable.js";

/**
 * U-210 (bundle A, P-1): what follows `policy.unreadablePaths` when a run of `analyze-private` has
 * no unreadable path (WORKFLOW_PROBLEMS `unreadable_paths_required`), in the run's error and in
 * doctor's check where a run would refuse.
 */
export const UNREADABLE_PATHS_REQUIRED_TEXT =
  "must not be empty under the analyze-private task type: put the folder of the tables with personal data in it (the task file, the config file or a profile)";

/**
 * The sources' policies in the contract's order (unreadablePathsOf): the config file's own policy,
 * the applied profile's, the task type definition's, the task file's. The config file's and the
 * profile's count under a task file too, whose own policy otherwise replaces the config's (R-2).
 */
function policiesOf(sources: WritableSources): readonly (PolicyConfig | undefined)[] {
  return [
    sources.config?.policy,
    sources.profile === null ? undefined : sources.config?.profiles?.[sources.profile]?.policy,
    sources.definition?.policy,
    sources.taskFilePolicy ?? undefined,
  ];
}

/** Every source's unreadable entries united, each once, in that order; empty when no source states any. */
export function runUnreadablePaths(sources: WritableSources): readonly string[] {
  return unreadablePathsOf(policiesOf(sources).map((policy) => policy?.unreadablePaths));
}

/**
 * U-210 (P-1): true when the task type is `analyze-private` and the run would have no unreadable
 * path, which the resolution refuses (resolveWorkflow, unreadable_paths_required).
 */
export function privateAnalysisWithoutData(workflowRef: string | null | undefined, sources: WritableSources): boolean {
  return workflowRef === ANALYZE_PRIVATE_WORKFLOW_ID && runUnreadablePaths(sources).length === 0;
}

/**
 * The run's k when any source states one: the largest of them, never below 5
 * (effectiveMinGroupSize, the config file's as the base). Undefined when none does, which the run
 * reads as DEFAULT_MIN_GROUP_SIZE, so a task without one is as before.
 */
export function runMinGroupSize(sources: WritableSources): number | undefined {
  const [configured, ...raises] = policiesOf(sources).map((policy) => policy?.minGroupSize);
  return configured === undefined && raises.every((value) => value === undefined) ? undefined : effectiveMinGroupSize(configured, raises);
}
