/**
 * General task workflows (stage 4, G-A). Design: docs/design/general-tasks.md sections 4 and 8,
 * decisions GT-D1 to GT-D3, GT-D6, GT-D7, GT-D10, GT-D12 (docs/work-orders/phase-4-5-design.md).
 *
 * A workflow definition is a named set of task defaults and ceilings. The CLI expands the one that
 * `workflowRef` names (task file, profile or `--workflow`) into the explicit fields of
 * WorkflowSettings on the resolved task. The engine never sees a definition and never branches on
 * a workflow id; it reads `workflowSettingsOf(task)`. The free label `TaskSpec.workflow` keeps its
 * meaning (GT-D2).
 *
 * A task without `workflowRef` and without the workflow fields is interpreted exactly as before
 * stage 4: LEGACY_WORKFLOW_SETTINGS (the four built-in tools, no instructions, no plan, verifiers
 * decide).
 *
 * P1 (named here only, not part of this contract): `writablePaths` and `unreadablePaths` in the
 * policy, the `query_table` tool, Markdown file rules, the `analyze-private` definition.
 */

import type { PlanActionKind, PlanMode } from "./plan.js";
import type { CommandRule, Limits, PolicyConfig, ResolvedTaskSpec } from "./task.js";
import { TOOL_NAMES } from "./tool.js";
import type { AnyToolName } from "./tool.js";
import type { MaskedText } from "./text.js";
import type { VerifierConfig } from "./verify.js";

/** Workflow ids: as profile names. Letters, digits, `.`, `_`, `-`; starts with a letter or digit; 1-64. */
export const WORKFLOW_ID_PATTERN_SOURCE = "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$";
/** Largest number of entries in the config file's `workflows`. More is `invalid_config`. */
export const MAX_WORKFLOWS = 32;

/**
 * Definitions that ship with Codaryn (data only, `src/workflows`, G-F). A config file entry with
 * one of these ids is `invalid_config`: copy the definition under a new id to change it.
 * - general: the quick form's settings (QUICK_TASK_WORKFLOW), equal to LEGACY_WORKFLOW_SETTINGS
 * - code: the four tools, verifiers decide
 * - document: read_file, search_files, write_file; verifiers decide (no verifier: "no automatic
 *   verification")
 * - analyze: read_file, search_files, write_file; `human_review` after the verifiers (GT-D7).
 *   Data with personal information is out of scope until the P1 aggregate tool (GT-D8)
 * - organize: read_file, search_files, inspect_files, propose_plan; `plan: "apply"`; no command
 *   rules allowed (GT-D10)
 */
export const BUILTIN_WORKFLOW_IDS = ["general", "code", "document", "analyze", "organize"] as const;
export type BuiltinWorkflowId = (typeof BUILTIN_WORKFLOW_IDS)[number];

/**
 * How a run ends after its verifiers.
 * - verifiers: as before. All pass → `done`/`verified`; no verifier → `needs-input`/`no_verifier`.
 * - human_review (GT-D6): when the verifiers all pass, or there is none, the run ends as
 *   `needs-input`/`awaiting_review` with `EngineResult.review`. A person records a verdict with
 *   `codaryn review` (ReviewRecord). The run never becomes `done` by a review. A failed or
 *   inconclusive verification ends as without review (repair, `failed`, `needs-input`).
 */
export const COMPLETION_MODES = ["verifiers", "human_review"] as const;
export type CompletionMode = (typeof COMPLETION_MODES)[number];

/** Most checklist entries, and the longest entry in characters. */
export const MAX_REVIEW_CHECKLIST_ITEMS = 20;
export const MAX_REVIEW_CHECKLIST_ITEM_CHARS = 200;
/** Longest `instructions`, in characters. */
export const MAX_WORKFLOW_INSTRUCTIONS_CHARS = 4000;

/** What the person is asked to confirm. Required with `completion: "human_review"`. */
export interface HumanReviewConfig {
  /** 1 to MAX_REVIEW_CHECKLIST_ITEMS non-blank lines. Masked before they are recorded or shown. */
  readonly checklist: readonly string[];
}

/**
 * What a workflow changes in a run, fully resolved. The engine reads it with `workflowSettingsOf`.
 * - tools: offered to the model and the only tools it may call; a call to another tool is
 *   `unknown_tool`. Built-in names (TOOL_NAMES) and workflow tools (WORKFLOW_TOOL_NAMES).
 * - instructions: appended after the fixed system prompt, masked, so the first `model_request`
 *   records it (GT-D3). User config text: it must not spell the privacy token marker.
 * - plan: see plan.ts. With "apply" the run offers only read tools and `propose_plan`.
 * - completion, humanReview: see COMPLETION_MODES.
 */
export interface WorkflowSettings {
  readonly tools: readonly AnyToolName[];
  readonly instructions: string | null;
  readonly plan: PlanMode;
  readonly completion: CompletionMode;
  readonly humanReview: HumanReviewConfig | null;
}

/** A task with no workflow: the behaviour before stage 4. */
export const LEGACY_WORKFLOW_SETTINGS: WorkflowSettings = Object.freeze({
  tools: TOOL_NAMES,
  instructions: null,
  plan: "none",
  completion: "verifiers",
  humanReview: null,
});

/**
 * The workflow settings of a resolved task. Each field the task leaves out takes its value from
 * LEGACY_WORKFLOW_SETTINGS, so a task without them runs as before stage 4. Pure.
 */
export function workflowSettingsOf(task: ResolvedTaskSpec): WorkflowSettings {
  return {
    tools: task.tools ?? LEGACY_WORKFLOW_SETTINGS.tools,
    instructions: task.instructions ?? LEGACY_WORKFLOW_SETTINGS.instructions,
    plan: task.plan ?? LEGACY_WORKFLOW_SETTINGS.plan,
    completion: task.completion ?? LEGACY_WORKFLOW_SETTINGS.completion,
    humanReview: task.humanReview ?? LEGACY_WORKFLOW_SETTINGS.humanReview,
  };
}

/** DR-41: one command line set allowed by both rules, as a rule, or null when they share none. */
function commandRuleIntersection(a: CommandRule, b: CommandRule): CommandRule | null {
  if (a.executable !== b.executable) return null;
  const [shorter, longer] = a.argsPrefix.length <= b.argsPrefix.length ? [a, b] : [b, a];
  if (!shorter.argsPrefix.every((arg, index) => longer.argsPrefix[index] === arg)) return null;
  if (shorter.argsPrefix.length === longer.argsPrefix.length) {
    return { executable: a.executable, argsPrefix: [...a.argsPrefix], allowExtraArgs: a.allowExtraArgs && b.allowExtraArgs };
  }
  // The longer prefix allows its own lines only; the shorter one covers them only with extra args.
  return shorter.allowExtraArgs ? { executable: longer.executable, argsPrefix: [...longer.argsPrefix], allowExtraArgs: longer.allowExtraArgs } : null;
}

/**
 * DR-41 (A-8, F-5): the effective policy wherever a workflow definition applies and another policy
 * is given: in the quick form the profile's, else the config's; in a task file that names a workflow
 * (`workflowRef`), the task's own policy (PM, after 27afb01). A definition's rules are its safety
 * rules, so no policy, however given, loosens them. A task naming no workflow keeps its policy as
 * it is. Pure.
 * - Either absent: the other, as before.
 * - protectedPaths: both lists (union), the definition's first, each entry once.
 * - commands: only command lines both allow (the intersection of the two allow lists, rule by rule).
 *   Under a definition that allows no command (`allowCommands: false`, organize) every given rule
 *   is dropped. A task file's own rules there are still refused first (`commands_not_allowed`,
 *   GT-D10: ResolveWorkflowInput.commandRules counts the task's rules before the merge); the
 *   profile's or config's are dropped.
 * - planActions: the configured policy narrows the definition's when it states planActions (only
 *   kinds both list stay); when it does not state them it leaves the definition's as they are, so a
 *   general policy that only adds a protected path does not take organize's move and discard away.
 * - restorePathTokens: true only when both allow it. network, destructive: "deny".
 */
export function mergeWorkflowPolicy(definition: PolicyConfig | undefined, configured: PolicyConfig | undefined): PolicyConfig | undefined {
  if (definition === undefined) return configured;
  if (configured === undefined) return definition;
  const protectedPaths = [...new Set([...(definition.protectedPaths ?? []), ...(configured.protectedPaths ?? [])])];
  const commands: CommandRule[] = [];
  const seen = new Set<string>();
  for (const own of definition.commands) {
    for (const given of configured.commands) {
      const both = commandRuleIntersection(own, given);
      if (both === null) continue;
      const key = JSON.stringify(both);
      if (seen.has(key)) continue;
      seen.add(key);
      commands.push(both);
    }
  }
  const ownActions: readonly PlanActionKind[] = definition.planActions ?? [];
  const planActions =
    configured.planActions === undefined ? [...ownActions] : ownActions.filter((kind) => (configured.planActions as readonly PlanActionKind[]).includes(kind));
  return {
    commands,
    network: "deny",
    destructive: "deny",
    restorePathTokens: definition.restorePathTokens && configured.restorePathTokens,
    ...(protectedPaths.length > 0 ? { protectedPaths } : {}),
    ...(planActions.length > 0 ? { planActions } : {}),
  };
}

/**
 * One entry of the config file's `workflows` (or a built-in). Unknown fields are rejected.
 * - tools: required, the ceiling for every task that uses the definition.
 * - plan, completion: defaults "none" and "verifiers". `humanReview` is required with
 *   `completion: "human_review"` and not allowed otherwise.
 * - allowCommands: default true. false (organize) means the effective policy may have no command
 *   rule; one is `invalid_task` or `invalid_config` (GT-D10). `run_command` is then not offered.
 * - policy, verifiers, limits: defaults, laid under a profile's and the task's own values as
 *   `ResolveWorkflow` says. Limits follow S-7 like the config's own. DR-41: its policy is merged
 *   with the profile's or the config's (quick form) or the task file's own (mergeWorkflowPolicy),
 *   never replaced by it.
 */
export interface WorkflowDefinition {
  /** Display only. */
  readonly label?: string;
  readonly tools: readonly AnyToolName[];
  readonly instructions?: string;
  readonly plan?: PlanMode;
  readonly completion?: CompletionMode;
  readonly humanReview?: HumanReviewConfig;
  readonly allowCommands?: boolean;
  readonly policy?: PolicyConfig;
  readonly verifiers?: readonly VerifierConfig[];
  readonly limits?: Partial<Limits>;
}

/**
 * Why a workflow cannot be resolved (`invalid_task` or `invalid_config`; the message names the
 * field position, never a value).
 * - unknown_workflow: `workflowRef` names no built-in and no config entry
 * - tool_not_allowed: a task lists a tool its definition does not list (tools only narrow)
 * - plan_weakened: a task sets `plan: "none"` under a definition with `plan: "apply"`
 * - commands_not_allowed: command rules under `allowCommands: false`
 * - review_without_checklist, checklist_without_review: humanReview and completion disagree
 * - instructions_too_long, checklist_too_long: over the MAX_ constants above
 */
export const WORKFLOW_PROBLEMS = [
  "unknown_workflow",
  "tool_not_allowed",
  "plan_weakened",
  "commands_not_allowed",
  "review_without_checklist",
  "checklist_without_review",
  "instructions_too_long",
  "checklist_too_long",
] as const;
export type WorkflowProblem = (typeof WORKFLOW_PROBLEMS)[number];

/** The task's own workflow fields (TaskSpec), as `ResolveWorkflow` takes them. */
export interface TaskWorkflowFields {
  readonly workflowRef?: string;
  readonly tools?: readonly AnyToolName[];
  readonly plan?: PlanMode;
  readonly completion?: CompletionMode;
  readonly humanReview?: HumanReviewConfig;
}

export interface ResolveWorkflowInput {
  /** Built-ins and the config file's `workflows`, by id. */
  readonly definitions: { readonly [id: string]: WorkflowDefinition };
  /** The task's fields. `workflowRef` absent: the task has no definition. */
  /** In the quick form the CLI passes `--workflow <id>` as `task.workflowRef` (DR-2). */
  readonly task: TaskWorkflowFields;
  /** `--profile`'s `workflowRef`, used when the task names none. */
  readonly profileWorkflowRef: string | null;
  /** Number of command rules in the effective policy, for `allowCommands: false`. */
  readonly commandRules: number;
}

export type ResolveWorkflowOutcome =
  | {
      readonly ok: true;
      /** The definition used, or null when neither the task nor the profile names one. */
      readonly workflowRef: string | null;
      readonly settings: WorkflowSettings;
    }
  | { readonly ok: false; readonly problem: WorkflowProblem; readonly field: string };

/**
 * Signature of `resolveWorkflow` (`src/workflows`, G-F). Pure. Order: the definition's values, then
 * the task's. With no definition the base is LEGACY_WORKFLOW_SETTINGS and the task's fields apply
 * under the same rules (a legacy task with none of them resolves to exactly the legacy settings).
 */
export type ResolveWorkflow = (input: ResolveWorkflowInput) => ResolveWorkflowOutcome;

/**
 * `codaryn review (--task <task.json> | --workspace <dir> [--profile <name>] [--workflow <id>]) [--config <file>]
 * [--vars-file <file>] --run <runId|latest> --accept|--reject [--note <text>] [--json]` records a
 * person's verdict on a run that ended as `needs-input`/`awaiting_review`. It writes
 * REVIEW_FILE_NAME only, under the workspace lock: result.json and the journal stay as they are,
 * and the run's status does not change (M-16). A later review replaces the earlier one.
 * R-4 L-4: it takes the task form like `plan` and `apply` (DR-17) and registers the same secrets
 * as `run`, and the note is masked with them before it is written, so review.json and every reader
 * hold masked text only. Without `--note` no secret is needed and none is read.
 * Errors (CliErrorOutput): `invalid_arguments`, `invalid_task`, `invalid_config`,
 * `secret_env_missing`, `workspace_not_found`, `run_not_found`, `invalid_run_record`,
 * `run_not_awaiting_review`, `key_in_file` (the note holds a key, S-8), `workspace_locked`.
 */
export const REVIEW_FILE_NAME = "review.json";
export const REVIEW_VERDICTS = ["accepted", "rejected"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];
/** Longest `--note`, in characters. */
export const MAX_REVIEW_NOTE_CHARS = 500;

/** review.json. */
export interface ReviewRecord {
  readonly schemaVersion: 1;
  readonly kind: "review_record";
  readonly runId: string;
  /** ISO 8601 UTC. */
  readonly at: string;
  readonly verdict: ReviewVerdict;
  /**
   * As typed, cleaned of control characters, then masked with the secrets the command registered
   * (R-4 L-4). Never sent to a model. Readers show it as it is.
   */
  readonly note: MaskedText | null;
}

export const REVIEW_EXIT_CODES: { readonly [V in ReviewVerdict]: number } = { accepted: 0, rejected: 0 };

/** Printed by `codaryn review --json`. Without `--json` one line of text. */
export interface ReviewOutput {
  readonly schemaVersion: 1;
  readonly kind: "review";
  readonly runId: string;
  readonly verdict: ReviewVerdict;
  readonly exitCode: number;
  /** The checklist the run asked about (EngineResult.review). */
  readonly checklist: readonly MaskedText[];
  /** An earlier review of this run was replaced. */
  readonly replaced: boolean;
}
