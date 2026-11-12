/**
 * The task file (task.json) and the resolved task the engine runs (`ResolvedTaskSpec`).
 * The file has the TaskSpec shape, except that `limits` and each of its fields may be left out
 * when the config file supplies them (see `CodarynConfig`). The quick form (`--workspace`,
 * `--goal`, and G-A's `--workflow <id>` for `workflowRef`) builds the task from the config file
 * instead.
 * Neither file ever contains secret values or API keys.
 */

import type { PlanActionKind, PlanMode } from "./plan.js";
import type { AnyToolName } from "./tool.js";
import type { VerifierConfig } from "./verify.js";
import type { CompletionMode, HumanReviewConfig } from "./workflow.js";

export const TASK_SCHEMA_VERSION = 1;

/** Regular expression source for `TaskSpec.id`. */
export const TASK_ID_PATTERN_SOURCE = "^[A-Za-z0-9._-]{1,64}$";

export interface TaskSpec {
  readonly schemaVersion: 1;
  readonly id: string;
  /** What the agent should achieve. Masked before it reaches a model. */
  readonly goal: string;
  /** Free-form label such as "code" or "document". The engine never branches on it. */
  readonly workflow: string;
  /** The single allowed root. Absolute, or relative to the directory of the task file. */
  readonly workspaceRoot: string;
  readonly model: ModelConfig;
  readonly policy: PolicyConfig;
  readonly privacy: PrivacyConfig;
  readonly limits: Limits;
  /** May be empty. An empty list ends the run as `needs-input` with reason `no_verifier`. */
  readonly verifiers: readonly VerifierConfig[];
  /**
   * G-A (GT-D2): id of a workflow definition (workflow.ts): a built-in or an entry of the config
   * file's `workflows`. The CLI expands it into the fields below on the resolved task. Absent, and
   * none of the fields below set: the task runs as before stage 4 (LEGACY_WORKFLOW_SETTINGS).
   * `workflow` stays a free label either way. In the quick form it comes from `--workflow <id>`
   * (QUICK_WORKFLOW_ARGUMENT, DR-2); the other workflow fields have no quick form argument.
   */
  readonly workflowRef?: string;
  /** G-A: narrows the definition's tools (never widens them). See WorkflowSettings. */
  readonly tools?: readonly AnyToolName[];
  /** G-A: "apply" may strengthen a definition's "none", never the reverse. See plan.ts. */
  readonly plan?: PlanMode;
  /** G-A: see COMPLETION_MODES. */
  readonly completion?: CompletionMode;
  /** G-A: required with `completion: "human_review"`. */
  readonly humanReview?: HumanReviewConfig;
}

/**
 * The task as the CLI hands it to the engine: paths are absolute and every limit is set.
 * `EngineDeps.task` has this type. A task file may leave the repair limits out (defaults below).
 * G-A: when a workflow applies, the CLI sets every WorkflowSettings field (`tools`, `instructions`,
 * `plan`, `completion`, `humanReview`) to its resolved value. A field left out means the legacy
 * value; the engine reads them through `workflowSettingsOf`.
 */
export interface ResolvedTaskSpec extends TaskSpec {
  readonly limits: ResolvedLimits;
  /** G-A: the definition's instructions (a task file cannot set them), or null. */
  readonly instructions?: string | null;
}

export type ModelProviderName = "scripted" | "anthropic";

export type ModelConfig =
  | {
      readonly provider: "scripted";
      /** Scripted model file. Absolute, or relative to the directory of the task file. */
      readonly scriptPath: string;
    }
  | {
      readonly provider: "anthropic";
      /** Model id. First in the model order: task, then CODARYN_MODEL, then the config file. */
      readonly model?: string;
      /** Output token cap per request, at most MAX_OUTPUT_TOKENS_LIMIT. Overrides the config file's value. */
      readonly maxOutputTokens?: number;
    };

export interface PrivacyConfig {
  /**
   * Names of environment variables whose values are registered as secrets for this run.
   * Only names appear in the task. A listed variable that is unset or empty is an input error.
   */
  readonly secretEnv: readonly string[];
}

/**
 * Permissions are judged independently: path, command (executable and args), network, destructive.
 * Allowing one never implies another. The path permission is the workspace root itself.
 */
export interface PolicyConfig {
  /** Allow list for `run_command`. Empty means no command may run. */
  readonly commands: readonly CommandRule[];
  /** Phase 1a has no tool that uses the network. This is not OS-level network blocking. */
  readonly network: "deny";
  /** Deleting files and overwriting without a version check. */
  readonly destructive: "deny";
  /** Whether privacy tokens inside path fields may be restored before execution. */
  readonly restorePathTokens: boolean;
  /**
   * Workspace-relative path prefixes that no file tool may write (R-5). Reading stays allowed.
   * A write under one of them is denied with permission `path` and code `protected_path`.
   *
   * - A prefix covers itself and everything below it, by whole `/` separated segments:
   *   "tests" covers "tests" and "tests/a.ts", not "tests2". `.` covers the whole workspace.
   * - It is compared with `ResolvedPath.relative`, after links are resolved, so a link cannot
   *   lead around it. On Windows the comparison ignores case.
   * - An entry that is itself a link (junction, symbolic link) also protects its real path. A
   *   real path outside the workspace makes the entry unusable: every write is denied (T-13).
   * - Entries are relative, use `/` or the platform separator, and have no `..` segment. The
   *   format rule is `checkProtectedPaths` (policy.ts), shared by the CLI and the policy gate.
   * - Absent or empty: nothing is protected. Only the task or config file sets it. A model,
   *   the other task fields and files in the workspace cannot change it.
   * - Commands allowed by `commands` can still change these paths. It guards the file tools only.
   */
  readonly protectedPaths?: readonly string[];
  /**
   * G-A: plan action kinds an approved plan may carry out (plan.ts). Absent or empty: none, so a
   * plan with any action is denied (`destructive`/`plan_action_not_allowed`). Only the task or
   * config file sets it. It never gives a model a tool that moves or deletes: actions run only in
   * an apply run, after a person approved the plan's digest.
   */
  readonly planActions?: readonly PlanActionKind[];
}

export interface CommandRule {
  /** Exact, case-sensitive match against `run_command.executable`. No shell is used. */
  readonly executable: string;
  /** The call's args must start with exactly these values. */
  readonly argsPrefix: readonly string[];
  /** When false the call's args must equal `argsPrefix`. */
  readonly allowExtraArgs: boolean;
}

/**
 * Limits as a task or config file states them.
 * The four budget limits are positive integers and cover the whole run, repairs included.
 * Exceeding one ends the run as `budget-exhausted`.
 * The two repair limits may be left out of both files; see `ResolvedLimits` for the defaults.
 */
export interface Limits {
  readonly maxModelTurns: number;
  readonly maxToolCalls: number;
  /** `null` states explicitly that no token limit applies. */
  readonly maxTotalTokens: number | null;
  readonly maxDurationMs: number;
  /**
   * Integer >= 0. How many times a failed verification may be sent back to the model (R-1, R-2).
   * 0 ends the run at the first failed verification, as in phase 1.
   */
  readonly maxRepairAttempts?: number;
  /**
   * Integer >= 1. A failure signature that has occurred this many times in a row is not repaired
   * again: the run ends as `failed`/`repeated_failure` (R-3). With 2, the same failure is repaired
   * at most once. With 1, no failure is repaired.
   */
  readonly maxSameFailures?: number;
}

/** Limits of a resolved task. Every field is set. */
export interface ResolvedLimits extends Limits {
  readonly maxRepairAttempts: number;
  readonly maxSameFailures: number;
}

/** Used when neither the task file nor the config file sets `maxRepairAttempts`. */
export const DEFAULT_MAX_REPAIR_ATTEMPTS = 0;
/** Used when neither the task file nor the config file sets `maxSameFailures`. */
export const DEFAULT_MAX_SAME_FAILURES = 2;
