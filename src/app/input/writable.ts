/**
 * U-182 (DR-69 B-4): the writable lists of a run or an apply (ResolvedTaskSpec.writablePathSets).
 * Shared by the task's preparation (run.ts) and doctor, so both see the same lists.
 */

import type { CodarynConfig, PolicyConfig, WorkflowDefinition, WritablePathSet, WritablePathSource } from "../contracts/index.js";

export interface WritableSources {
  /** The config file as parsed, before `--profile` is applied (its own `policy`). */
  readonly config: CodarynConfig | null;
  /** The `--profile` name, or null. */
  readonly profile: string | null;
  /** The task type definition that applies, if any. */
  readonly definition: WorkflowDefinition | undefined;
  /** The task file's own policy as parsed; null in the quick form, whose policy is the settings'. */
  readonly taskFilePolicy: PolicyConfig | null;
}

/**
 * One list per source that states `policy.writablePaths`, in WRITABLE_PATH_SOURCES order: the config
 * file's own policy, the applied profile's, the task type definition's, the task file's. Each stays
 * its own list and a file tool's write must be covered by every one (PolicyConfig.writablePaths);
 * they are not merged into one (mergeWorkflowPolicy does not combine them). The config's and the
 * profile's hold under a task file too: a task file can narrow the user's settings, never widen
 * them. An empty list is kept (it allows no write). Empty when no source states one: no such limit.
 * The `plan` source (an approved run plan's files) is B-3's and never comes from here.
 */
export function writablePathSetsOf(sources: WritableSources): readonly WritablePathSet[] {
  const lists: [WritablePathSource, readonly string[] | undefined][] = [
    ["config", sources.config?.policy?.writablePaths],
    ["profile", sources.profile === null ? undefined : sources.config?.profiles?.[sources.profile]?.policy?.writablePaths],
    ["definition", sources.definition?.policy?.writablePaths],
    ["task", sources.taskFilePolicy?.writablePaths],
  ];
  return lists.flatMap(([source, entries]) => (entries === undefined ? [] : [{ source, entries: [...entries] }]));
}
