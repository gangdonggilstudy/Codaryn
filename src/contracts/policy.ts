/**
 * Policy gate: independent permission checks before and after restoration.
 * Order per call: checkRequested -> restore permitted fields -> checkEffective -> execute.
 */

import type { ConfirmablePolicyConfig, WritablePathSet } from "./task.js";
import type { JsonObject, MaskedText } from "./text.js";
import type { EffectiveToolCall, EffectiveWorkflowToolCall, ToolCall, ToolDescriptor, ToolName } from "./tool.js";
import type { Workspace } from "./workspace.js";

export const PERMISSION_KINDS = ["path", "command", "network", "destructive", "restore"] as const;
export type PermissionKind = (typeof PERMISSION_KINDS)[number];

export const POLICY_DENIAL_CODES = [
  "outside_root",
  "state_dir",
  "invalid_path",
  "command_not_allowed",
  "args_not_allowed",
  "network_denied",
  "destructive_denied",
  "restore_denied",
  /** A write under `PolicyConfig.protectedPaths` (R-5). Permission `path`. */
  "protected_path",
  /** G-A: a plan action whose kind `PolicyConfig.planActions` does not list. Permission `destructive`. */
  "plan_action_not_allowed",
  /**
   * U-74 (DR-3): a command a `confirm: true` rule allows only after a person allowed this one call
   * (PolicyDecision `confirm`), and that was not allowed: the person denied or closed the question,
   * nobody could be asked, the run was cancelled or hit its time limit while it waited. Permission
   * `command`. Why is in the journal's `confirmation_answered.by`.
   */
  "confirmation_required",
  /**
   * U-175 (DR-69 B-2): a write that one of the run's writable lists does not cover
   * (PolicyGateOptions.writablePathSets, PolicyConfig.writablePaths). Permission `path`. Judged after
   * links are resolved only (checkEffective); a protected path is reported first.
   */
  "path_not_writable",
] as const;
export type PolicyDenialCode = (typeof POLICY_DENIAL_CODES)[number];

/**
 * U-15 (AXM-6): what the model is told to do next after a refusal, one sentence with no value in it.
 * The engine adds it after the code of a policy denial (`denied by policy: <permission>/<code>`) and
 * of a placeholder refusal before execution (`token not usable in field: <field>`, the restore codes
 * of ResolveArgsOutcome). Fixed model-bound text (FIXED_MODEL_TEXTS).
 */
export const REFUSAL_HINTS: { readonly [C in PolicyDenialCode | "unresolved_token" | "invalid_token"]: string } = {
  outside_root: "Paths must stay inside the workspace.",
  state_dir: "Codaryn's own records folder cannot be used; work on the task's files only.",
  invalid_path: "Give a relative path inside the workspace with plain names.",
  command_not_allowed: "Only the commands this task allows can be run.",
  args_not_allowed: "This command can be run only with the arguments this task allows.",
  network_denied: "This task does not allow network access.",
  destructive_denied: "This task does not allow destructive actions.",
  restore_denied: "A protected placeholder cannot be used in this field.",
  protected_path: "This path is protected in this task; do not write to it.",
  plan_action_not_allowed: "This task does not allow this kind of plan action.",
  confirmation_required: "The person did not allow this call during the run; do not repeat it.",
  path_not_writable: "This task may write only certain files and this is not one of them; do not write to it.",
  unresolved_token: "A protected placeholder cannot be used in this field.",
  invalid_token: "Keep protected placeholders exactly as they were given, or leave them out.",
};

/**
 * A decision is allow or deny. Plan approval happens between runs (plan.ts, DR-1), not here.
 * U-74 (DR-3): the in-run permission question is a denial with a mark: `confirm: true`, only with
 * permission `command` and code `confirmation_required`, only from checkEffective, and only when the
 * command is allowed by a `confirm: true` rule of the user's settings (ConfirmableCommandRule) and
 * by no rule without it. A part that does not know the mark denies (the safe default). The engine
 * asks (EngineDeps.confirm); after `allow_once` it judges the same call with checkEffective again
 * and runs it only when that again allows it or gives the same mark (the answer is for that call
 * once). What the policy denies outright (outside the root, the state directory, a protected path,
 * a refused restore) is never asked. Without any `confirm` rule the mark never comes.
 */
export type PolicyDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly permission: PermissionKind; readonly code: PolicyDenialCode; readonly confirm?: true };

/** U-74: the request id of a question: `q` and its number in the run, from 1. */
export const CONFIRM_ID_PATTERN_SOURCE = "^q[1-9][0-9]{0,5}$";

/**
 * U-74 (DR-1, DR-3, adapter-contract 5.9): the one question asked during a run, a permission
 * question. Fixed fields only: `subject` is the call's executable as the gateway masks it (the same
 * text as the user's rule, which matches it exactly) and `argumentCount` the number of its
 * arguments. The arguments themselves are the model's text and are never in it. Not restored for
 * display. U-106 (R-79 L-2): a screen shows `subject` as it is, so the engine makes it safe as the
 * final message (safeModelText): control and invisible characters other than LF and TAB left out,
 * masked, key shapes hidden as HIDDEN_KEY_MARKER. Renderers need not hide keys in it again.
 */
export interface ConfirmRequest {
  readonly kind: "permission";
  /** CONFIRM_ID_PATTERN_SOURCE. */
  readonly id: string;
  readonly callId: string;
  readonly tool: ToolName;
  readonly permission: PermissionKind;
  readonly subject: MaskedText;
  readonly argumentCount: number;
}

/** U-74: the answers. `dismissed`: closed without answering, recorded as `deny` by `default`. */
export const CONFIRM_ANSWER_DECISIONS = ["allow_once", "deny", "dismissed"] as const;
export type ConfirmAnswer = { readonly decision: (typeof CONFIRM_ANSWER_DECISIONS)[number] };

/** U-74: what `confirmation_answered` records. There is no "always": an answer is for one call. */
export const CONFIRMATION_DECISIONS = ["allow_once", "deny"] as const;
export type ConfirmationDecision = (typeof CONFIRMATION_DECISIONS)[number];
/**
 * U-74 (DR-10): who decided. `user`: a person answered allow_once or deny. `default`: nobody could
 * be asked (no EngineDeps.confirm, not a terminal), the question was dismissed, the answer was not
 * one of the decisions or the asking failed, or the run's time limit (maxDurationMs, which the wait
 * counts in) ended the wait; always `deny`. `cancelled`: the run was cancelled while it waited.
 */
export const CONFIRMATION_BY = ["user", "default", "cancelled"] as const;
export type ConfirmationBy = (typeof CONFIRMATION_BY)[number];

/**
 * U-74: EngineDeps.confirm, as the app layer's RunObserver.confirm. `signal` aborts when the run is
 * cancelled or its time is up; the engine treats a throw or an answer that is not one of
 * CONFIRM_ANSWER_DECISIONS as `dismissed`. U-106 (R-79 L-3): the engine reads the answer's
 * `decision` once, right after it came, and only as an own property: a read that throws or a
 * `decision` on the prototype is `dismissed` too. U-120 (R-86 L-1): `request` is a frozen copy of
 * the engine's question (a change in place throws in strict mode); the records are written from the
 * engine's own question, so nothing an asker does to it reaches the journal.
 */
export type ConfirmPermission = (request: ConfirmRequest, signal: AbortSignal) => Promise<ConfirmAnswer>;

export interface PolicyGate {
  /**
   * First check on the call as requested (tokens still in place): fixed requirements of the
   * tool against the config, command and args, and paths that contain no token.
   * Every required permission is checked. One denial denies the call.
   */
  checkRequested(call: ToolCall, descriptor: ToolDescriptor): PolicyDecision;

  /** Fields the policy permits to restore for this tool. Empty when restoration is denied. */
  restorableFields(descriptor: ToolDescriptor): readonly string[];

  /**
   * Second check on the effective arguments after restoration: real paths after resolving
   * links, and the actual command and args. Only an allowed result may be executed.
   * G-A: besides built-in tool calls it judges task type tool calls and single plan actions
   * (PlanActionCall); like the first check it reads the descriptor's fields from `args`.
   */
  checkEffective(call: EffectiveToolCall | EffectiveWorkflowToolCall | PlanActionCall, descriptor: ToolDescriptor): Promise<PolicyDecision>;
}

/**
 * G-A: one plan action as the policy gate judges it, with a name from PLAN_ACTION_DESCRIPTORS and
 * the action's path fields only (`from` and `to`, or `path`), effective after restoration.
 */
export interface PlanActionCall {
  readonly id: string;
  readonly name: string;
  readonly args: JsonObject;
}

export interface PolicyGateOptions {
  /** U-74: command rules may carry `confirm` (ConfirmableCommandRule). */
  readonly config: ConfirmablePolicyConfig;
  readonly workspace: Workspace;
  /**
   * P1 (DR-69, B-2, B-4): ResolvedTaskSpec.writablePathSets. U-175: the gate denies a write that one
   * of the lists does not cover (`path`/`path_not_writable`), on the resolved path only
   * (checkEffective): the path's text first, then each entry's real path, so a link entry covers its
   * target. A policy's list covers what is below its entries; the plan's files only themselves. An
   * unusable list or entry covers nothing. Absent or empty: no such limit. Every write access is
   * judged, a plan action's paths too.
   */
  readonly writablePathSets?: readonly WritablePathSet[];
}

/** Signature of `createPolicyGate`, exported by `src/policy/index.ts`. */
export type CreatePolicyGate = (options: PolicyGateOptions) => PolicyGate;

/**
 * Why a `protectedPaths` value or entry is not usable:
 * - not_a_list: the value is not an array (`index` is null)
 * - not_a_string, empty: the entry is not a non-empty string
 * - absolute: absolute, drive-relative, UNC or device path
 * - parent_segment: a `..` segment
 * - invalid_name: a name that cannot address an ordinary file (on Windows: forbidden characters,
 *   a colon, a trailing dot or space, a DOS device name)
 */
export const PROTECTED_PATH_PROBLEMS = [
  "not_a_list",
  "not_a_string",
  "empty",
  "absolute",
  "parent_segment",
  "invalid_name",
] as const;
export type ProtectedPathProblemReason = (typeof PROTECTED_PATH_PROBLEMS)[number];

export interface ProtectedPathProblem {
  /** Position of the entry in the list, or null when the value itself is not a list. */
  readonly index: number | null;
  readonly reason: ProtectedPathProblemReason;
}

/**
 * Signature of `checkProtectedPaths`, exported by `src/policy/index.ts` (T-13). The single format
 * check for `PolicyConfig.protectedPaths`: the CLI rejects the task or config file when it returns
 * a problem, and `createPolicyGate` denies every write (fail closed) for a value it would reject.
 * Pure and lexical: no file system access. `undefined` and an empty list have no problem.
 * Problems are in list order; an empty result means the value is usable.
 * Messages built from it name the position only, never the entry.
 */
export type CheckProtectedPaths = (value: unknown) => readonly ProtectedPathProblem[];
