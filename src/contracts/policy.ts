/**
 * Policy gate: independent permission checks before and after restoration.
 * Order per call: checkRequested -> restore permitted fields -> checkEffective -> execute.
 */

import type { PolicyConfig } from "./task.js";
import type { JsonObject } from "./text.js";
import type { EffectiveToolCall, EffectiveWorkflowToolCall, ToolCall, ToolDescriptor } from "./tool.js";
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
  unresolved_token: "A protected placeholder cannot be used in this field.",
  invalid_token: "Keep protected placeholders exactly as they were given, or leave them out.",
};

/**
 * Phase 1a is non-interactive: a decision is allow or deny, never "ask".
 * G-A: unchanged in stage 4. Plan approval happens between runs (plan.ts, DR-1), not here. The
 * in-run permission question (N-11) is decided as DR-3 and comes at the start of stage 5; its
 * decision value and `EngineDeps.confirm` are named here only and not part of this contract yet.
 */
export type PolicyDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly permission: PermissionKind; readonly code: PolicyDenialCode };

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
   * G-A: besides built-in tool calls it judges workflow tool calls and single plan actions
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
  readonly config: PolicyConfig;
  readonly workspace: Workspace;
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
