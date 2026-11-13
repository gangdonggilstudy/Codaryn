/**
 * General tasks: task types (stage 4, G-A). Design: docs/design/general-tasks.md sections 4 and 8,
 * decisions GT-D1 to GT-D3, GT-D6, GT-D7, GT-D10, GT-D12 (docs/work-orders/phase-4-5-design.md).
 *
 * DR-50 (U-28): people read this as the task type (작업 종류), and these comments use that word.
 * The names in code keep `workflow`, as option names and JSON field names do: `workflowRef`,
 * `--workflow`, the config file's `workflows`, WorkflowDefinition, WorkflowSettings, the text ids.
 *
 * A task type definition is a named set of task defaults and ceilings. The CLI expands the one that
 * `workflowRef` names (task file, profile or `--workflow`) into the explicit fields of
 * WorkflowSettings on the resolved task. The engine never sees a definition and never branches on
 * a task type id; it reads `workflowSettingsOf(task)`. The free label `TaskSpec.workflow` keeps its
 * meaning (GT-D2).
 *
 * A task without `workflowRef` and without the task type fields is interpreted exactly as before
 * stage 4: LEGACY_WORKFLOW_SETTINGS (the four built-in tools, no instructions, no plan, verifiers
 * decide).
 *
 * P1: `writablePaths` is a policy field of this contract (task.ts, U-170; DR-69 B-4) and plan mode
 * `run` a plan mode (plan.ts). Named here only, not yet part of it: `unreadablePaths`, the
 * `query_table` tool, Markdown file rules, the `analyze-private` definition.
 */

import type { PlanActionKind, PlanMode } from "./plan.js";
import type { CommandRule, ConfirmableCommandRule, ConfirmablePolicyConfig, Limits, PolicyConfig, ResolvedTaskSpec } from "./task.js";
import { TOOL_NAMES } from "./tool.js";
import type { AnyToolName } from "./tool.js";
import type { MaskedText } from "./text.js";
import type { VerifierConfig } from "./verify.js";

/** Task type ids: as profile names. Letters, digits, `.`, `_`, `-`; starts with a letter or digit; 1-64. */
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
 * What a task type changes in a run, fully resolved. The engine reads it with `workflowSettingsOf`.
 * - tools: offered to the model and the only tools it may call; a call to another tool is
 *   `unknown_tool`. Built-in names (TOOL_NAMES) and task type tools (WORKFLOW_TOOL_NAMES).
 * - instructions: appended after the fixed system prompt, masked, so the first `model_request`
 *   records it (GT-D3). User config text: it must not spell the privacy token marker.
 * - plan: see plan.ts. With "apply" the run offers only read tools and `propose_plan`; with "run"
 *   (P1, B-1) only read tools and `propose_changes` (ToolDescriptor.planMode).
 * - completion, humanReview: see COMPLETION_MODES.
 */
export interface WorkflowSettings {
  readonly tools: readonly AnyToolName[];
  readonly instructions: string | null;
  readonly plan: PlanMode;
  readonly completion: CompletionMode;
  readonly humanReview: HumanReviewConfig | null;
}

/** A task with no task type: the behaviour before stage 4. */
export const LEGACY_WORKFLOW_SETTINGS: WorkflowSettings = Object.freeze({
  tools: TOOL_NAMES,
  instructions: null,
  plan: "none",
  completion: "verifiers",
  humanReview: null,
});

/**
 * The task type settings of a resolved task. Each field the task leaves out takes its value from
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
 * DR-41 (A-8, F-5): the effective policy wherever a task type definition applies and another policy
 * is given: in the quick form the profile's, else the config's; in a task file that names a task type
 * (`workflowRef`), the task's own policy (PM, after 27afb01). A definition's rules are its safety
 * rules, so no policy, however given, loosens them. A task naming no task type keeps its policy as
 * it is. Pure.
 * - Either absent: the other, as before.
 * - protectedPaths: both lists (union), the definition's first, each entry once.
 * - commands: only command lines both allow (the intersection of the two allow lists, rule by rule).
 *   Under a definition that allows no command (`allowCommands: false`, organize) every given rule
 *   is dropped. A task file's own rules there are still refused first (`commands_not_allowed`,
 *   GT-D10: ResolveWorkflowInput.commandRules counts the task's rules before the merge); the
 *   profile's or config's are dropped and the person is told (workflowPolicyNarrowings).
 * - planActions: the configured policy narrows the definition's when it states planActions (only
 *   kinds both list stay); when it does not state them it leaves the definition's as they are, so a
 *   general policy that only adds a protected path does not take organize's move and discard away.
 * - restorePathTokens: true only when both allow it. network, destructive: "deny".
 * - U-74: a configured rule's `confirm: true` stays on every rule its intersection gives, so a
 *   definition never turns a question into a plain allow. A definition's rules cannot ask.
 * - writablePaths (P1, B-4): not combined here. Each source's list stays its own list in
 *   ResolvedTaskSpec.writablePathSets, and a write must be covered by all of them; the merged
 *   policy's `writablePaths` is not what the gate reads.
 * - unreadablePaths (P1, U-197, R-2): both lists (union), the definition's first, each entry once:
 *   no source takes one away. Review R-102 M-1: this union is not what the run reads (in a task
 *   file's run it lacks the config file's own entries); ResolvedTaskSpec.unreadablePaths is.
 * - minGroupSize (P1, R-102 M-1): not combined here, since neither side holds the config file's base;
 *   ResolvedTaskSpec.minGroupSize (effectiveMinGroupSize over every source) is what the run reads.
 */
export function mergeWorkflowPolicy(
  definition: PolicyConfig | undefined,
  configured: ConfirmablePolicyConfig | undefined,
): ConfirmablePolicyConfig | undefined {
  if (definition === undefined) return configured;
  if (configured === undefined) return definition;
  const protectedPaths = [...new Set([...(definition.protectedPaths ?? []), ...(configured.protectedPaths ?? [])])];
  // U-197 (R-2): unreadable paths only add up (k is not combined here, R-102 M-1).
  const unreadablePaths = [...new Set([...(definition.unreadablePaths ?? []), ...(configured.unreadablePaths ?? [])])];
  const commands: ConfirmableCommandRule[] = [];
  const seen = new Set<string>();
  for (const own of definition.commands) {
    for (const given of configured.commands) {
      const shared = commandRuleIntersection(own, given);
      if (shared === null) continue;
      const both: ConfirmableCommandRule = given.confirm === true ? { ...shared, confirm: true } : shared;
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
    ...(unreadablePaths.length > 0 ? { unreadablePaths } : {}),
  };
}

/**
 * DR-41 (PM after 27afb01): what mergeWorkflowPolicy left out of the given policy, so doctor and the
 * run's start can tell the person. Kinds and counts only, never a rule, a command or a path:
 * - commands_dropped: given command rules that share no command line with the definition's
 * - commands_narrowed: given command rules kept only in part (no single definition rule allows all
 *   of their lines)
 * - plan_actions_dropped: plan action kinds the given policy states that the definition does not list
 * - restore_path_tokens_off: the given policy allows restoring path tokens, the definition does not
 * - verifiers_dropped (DR-43 (a)): given verifiers left out because their id is one of the
 *   definition's own and they are not the same check (workflowVerifierNarrowings)
 */
export const POLICY_NARROWING_KINDS = [
  "commands_dropped",
  "commands_narrowed",
  "plan_actions_dropped",
  "restore_path_tokens_off",
  "verifiers_dropped",
] as const;
export type PolicyNarrowingKind = (typeof POLICY_NARROWING_KINDS)[number];

export interface PolicyNarrowing {
  readonly kind: PolicyNarrowingKind;
  /** At least 1. */
  readonly count: number;
}

function sameCommandRule(a: CommandRule, b: CommandRule): boolean {
  return (
    a.executable === b.executable &&
    a.allowExtraArgs === b.allowExtraArgs &&
    a.argsPrefix.length === b.argsPrefix.length &&
    a.argsPrefix.every((arg, index) => b.argsPrefix[index] === arg)
  );
}

/**
 * DR-41: the narrowings of `configured` by `definition` under mergeWorkflowPolicy, in
 * POLICY_NARROWING_KINDS order, each with a count of at least 1. Empty when either is absent or
 * nothing was left out. Pure.
 */
export function workflowPolicyNarrowings(definition: PolicyConfig | undefined, configured: PolicyConfig | undefined): readonly PolicyNarrowing[] {
  if (definition === undefined || configured === undefined) return [];
  let dropped = 0;
  let narrowed = 0;
  for (const given of configured.commands) {
    const kept = definition.commands.map((own) => commandRuleIntersection(own, given)).filter((rule): rule is CommandRule => rule !== null);
    if (kept.length === 0) dropped += 1;
    else if (!kept.some((rule) => sameCommandRule(rule, given))) narrowed += 1;
  }
  const own = definition.planActions ?? [];
  const planDropped = configured.planActions === undefined ? 0 : [...new Set(configured.planActions)].filter((kind) => !own.includes(kind)).length;
  const counts: { readonly [K in PolicyNarrowingKind]: number } = {
    commands_dropped: dropped,
    commands_narrowed: narrowed,
    plan_actions_dropped: planDropped,
    restore_path_tokens_off: configured.restorePathTokens && !definition.restorePathTokens ? 1 : 0,
    verifiers_dropped: 0,
  };
  return POLICY_NARROWING_KINDS.filter((kind) => counts[kind] > 0).map((kind) => ({ kind, count: counts[kind] }));
}

/** JSON with object keys in code unit order, for comparing two configurations. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as { [key: string]: unknown }).filter(([, field]) => field !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson(field)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * DR-43 (a), R-31 L-2: the verifiers a run uses where a task type definition's own checks meet a
 * given list (the profile's or the config's in the quick form, a task file's own when it names a
 * task type). The definition's checks always run: its verifiers first, then each given verifier whose
 * id is not one of the definition's. An empty given list removes none of them. Either absent (or the
 * definition's empty): the other, as before. Pure.
 */
export function mergeWorkflowVerifiers(
  definition: readonly VerifierConfig[] | undefined,
  given: readonly VerifierConfig[] | undefined,
): readonly VerifierConfig[] | undefined {
  if (definition === undefined || definition.length === 0) return given;
  if (given === undefined) return definition;
  const ids = new Set(definition.map((verifier) => verifier.id));
  return [...definition, ...given.filter((verifier) => !ids.has(verifier.id))];
}

/**
 * DR-43 (a): what mergeWorkflowVerifiers left out of the given list: `verifiers_dropped`, the given
 * verifiers whose id is one of the definition's and that are not the same check (compared as data,
 * key order aside). Empty when nothing was left out or either side is absent. Pure.
 */
export function workflowVerifierNarrowings(
  definition: readonly VerifierConfig[] | undefined,
  given: readonly VerifierConfig[] | undefined,
): readonly PolicyNarrowing[] {
  if (definition === undefined || given === undefined) return [];
  const own = new Map(definition.map((verifier) => [verifier.id, canonicalJson(verifier)]));
  const dropped = given.filter((verifier) => own.has(verifier.id) && own.get(verifier.id) !== canonicalJson(verifier)).length;
  return dropped === 0 ? [] : [{ kind: "verifiers_dropped", count: dropped }];
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
 *   never replaced by it. DR-43 (a): its verifiers likewise always run, the given ones added
 *   (mergeWorkflowVerifiers).
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
 * Why a task type cannot be resolved (`invalid_task` or `invalid_config`; the message names the
 * field position, never a value).
 * - unknown_workflow: `workflowRef` names no built-in and no config entry
 * - tool_not_allowed: a task lists a tool its definition does not list (tools only narrow). U-180
 *   (R-99 L-2): also a plan tool of another plan mode than the resolved one (ToolDescriptor.planMode:
 *   `propose_plan` under "run", `propose_changes` under "apply"), in the definition's tools or the
 *   task's; the field names its place. Such a tool would never be offered.
 * - plan_weakened: a task sets `plan: "none"` under a definition with `plan: "apply"`, or (U-170,
 *   B-1) with `plan: "run"`. U-180 (R-99 L-2): also a task that changes a definition's "apply" to
 *   "run" or "run" to "apply": a task may only keep the definition's plan mode, or set one under "none"
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

/** The task's own task type fields (TaskSpec), as `ResolveWorkflow` takes them. */
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
