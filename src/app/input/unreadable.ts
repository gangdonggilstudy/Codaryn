/**
 * U-210 (P1 bundle A, A-6; R-2, Q-4, review R-102 M-1): the run's unreadable paths and its group size
 * k (ResolvedTaskSpec.unreadablePaths, .minGroupSize), from every source a run has. Shared by the
 * task's preparation (run.ts) and doctor, so both see the same list. Review R-108 H-1: and the one
 * place that gives them to the parts of a run that judge or read (runGuards).
 */

import { ANALYZE_PRIVATE_WORKFLOW_ID, effectiveMinGroupSize, integrityPathsOf, unreadablePathsOf } from "../../contracts/index.js";
import type { PolicyConfig, PolicyGate, ResolvedTaskSpec, WritablePathSet, Workspace } from "../../contracts/index.js";
import { createPolicyGate } from "../../policy/index.js";
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
 * U-210 (review R-108 H-1): what the run's unreadable paths and k give each part of a run that judges
 * or reads, so no part is made without them (R-108 found the gate of a carried-out plan made without
 * the list). The CLI makes every one of these from it: a run's assembly (src/cli/assemble.ts: the
 * gate, the tool runner, the verifier runner, the integrity checks, and a carried-out plan's gate),
 * and a plan of moves' apply (src/cli/plan-commands.ts: its gate, its verifier runner and its
 * integrity checks). A revert makes none of them. The app's assembly and its checks can make theirs
 * from it too (p5a). Without unreadable paths and k every part is as before.
 */
export interface RunGuards {
  /** The policy gate: these writable lists (a carried-out plan's, from the engine), else the task's. */
  gate(writablePathSets?: readonly WritablePathSet[]): PolicyGate;
  /** For createToolRunner: the run's unreadable paths (listing tools, query_table) and k (query_table). */
  readonly tools: { readonly unreadablePaths?: readonly string[]; readonly minGroupSize?: number };
  /**
   * For createVerifierRunner: the run's unreadable paths (data_checks' evidence, U-223) and k (U-258: a
   * grouped data check over an unreadable source compares the groups of at least k rows, as query_table).
   */
  readonly verifiers: { readonly unreadablePaths?: readonly string[]; readonly minGroupSize?: number };
  /** For createIntegrityChecker's protectedPaths: the policy's protected paths and the unreadable ones. */
  readonly protectedPaths: readonly string[];
}

export function runGuards(task: Pick<ResolvedTaskSpec, "policy" | "writablePathSets" | "unreadablePaths" | "minGroupSize">, workspace: Workspace): RunGuards {
  const unreadable = task.unreadablePaths === undefined ? {} : { unreadablePaths: task.unreadablePaths };
  return {
    gate: (writablePathSets = task.writablePathSets) =>
      createPolicyGate({ config: task.policy, workspace, ...(writablePathSets === undefined ? {} : { writablePathSets }), ...unreadable }),
    tools: { ...unreadable, ...(task.minGroupSize === undefined ? {} : { minGroupSize: task.minGroupSize }) },
    verifiers: { ...unreadable, ...(task.minGroupSize === undefined ? {} : { minGroupSize: task.minGroupSize }) },
    protectedPaths: integrityPathsOf(task.policy.protectedPaths, task.unreadablePaths),
  };
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
