/**
 * Policy gate: independent permission checks before and after restoration.
 * Order per call: checkRequested -> restore permitted fields -> checkEffective -> execute.
 */

import type { PolicyConfig } from "./task.js";
import type { EffectiveToolCall, ToolCall, ToolDescriptor } from "./tool.js";
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
] as const;
export type PolicyDenialCode = (typeof POLICY_DENIAL_CODES)[number];

/** Phase 1a is non-interactive: a decision is allow or deny, never "ask". */
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
   */
  checkEffective(call: EffectiveToolCall, descriptor: ToolDescriptor): Promise<PolicyDecision>;
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
