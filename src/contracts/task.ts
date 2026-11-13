/**
 * The task file (task.json) and the resolved task the engine runs (`ResolvedTaskSpec`).
 * The file has the TaskSpec shape, except that `limits` and each of its fields may be left out
 * when the config file supplies them (see `CodarynConfig`). The quick form (`--workspace`,
 * `--goal`, and G-A's `--workflow <id>` for `workflowRef`) builds the task from the config file
 * instead.
 * Neither file ever contains secret values or API keys.
 */

import type { ApiProviderName, MODEL_PROVIDER_NAMES } from "./config.js";
import type { PlanActionKind, PlanMode } from "./plan.js";
import type { AnyToolName } from "./tool.js";
import type { VerifierConfig } from "./verify.js";
import type { CompletionMode, HumanReviewConfig, PolicyNarrowing } from "./workflow.js";

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
   * G-A (GT-D2): id of a task type definition (workflow.ts): a built-in or an entry of the config
   * file's `workflows`. The CLI expands it into the fields below on the resolved task. Absent, and
   * none of the fields below set: the task runs as before stage 4 (LEGACY_WORKFLOW_SETTINGS).
   * `workflow` stays a free label either way. In the quick form it comes from `--workflow <id>`
   * (QUICK_WORKFLOW_ARGUMENT, DR-2); the other task type fields have no quick form argument.
   */
  readonly workflowRef?: string;
  /** G-A: narrows the definition's tools (never widens them). See WorkflowSettings. */
  readonly tools?: readonly AnyToolName[];
  /**
   * G-A: "apply" may strengthen a definition's "none", never the reverse. See plan.ts. U-170 (B-1):
   * "run" likewise; a definition's "apply" or "run" never becomes "none" (`plan_weakened`).
   */
  readonly plan?: PlanMode;
  /** G-A: see COMPLETION_MODES. */
  readonly completion?: CompletionMode;
  /** G-A: required with `completion: "human_review"`. */
  readonly humanReview?: HumanReviewConfig;
}

/**
 * The task as the CLI hands it to the engine: paths are absolute and every limit is set.
 * `EngineDeps.task` has this type. A task file may leave the repair limits out (defaults below).
 * G-A: when a task type applies, the CLI sets every WorkflowSettings field (`tools`, `instructions`,
 * `plan`, `completion`, `humanReview`) to its resolved value. A field left out means the legacy
 * value; the engine reads them through `workflowSettingsOf`.
 */
export interface ResolvedTaskSpec extends TaskSpec {
  readonly limits: ResolvedLimits;
  /**
   * U-74: the policy the run uses. In the quick form the config's or the profile's, whose command
   * rules may carry `confirm` (merged with a task type definition's by mergeWorkflowPolicy, which
   * keeps it); from a task file its own, which cannot.
   */
  readonly policy: ConfirmablePolicyConfig;
  /** G-A: the definition's instructions (a task file cannot set them), or null. */
  readonly instructions?: string | null;
  /**
   * DR-41: what merging the given policy with the task type definition's left out
   * (workflowPolicyNarrowings), set by the CLI or the app. Absent: nothing was left out. The engine
   * records it in `run_started` so the run's start can tell the person.
   */
  readonly policyNarrowings?: readonly PolicyNarrowing[];
  /**
   * DR-37 (d): the name of the config profile (N-8) the CLI or the app applied to build this task
   * (`--profile`, or the profile the GUI chose), of PROFILE_NAME_PATTERN_SOURCE. Absent: none was
   * applied. The engine records it in `run_started`; it changes nothing else.
   */
  readonly profile?: string;
  /**
   * P1 (DR-69, B-4): every list of writable paths the run must satisfy, in WRITABLE_PATH_SOURCES
   * order, each source once: a file tool may write a path only when every list covers it (the
   * intersection, PolicyConfig.writablePaths). Absent or empty: no such limit. The policy gate
   * judges it (PolicyGateOptions.writablePathSets), never the merged `policy.writablePaths`:
   * mergeWorkflowPolicy does not combine the lists. Not set yet: the CLI and the app set it with B-4.
   */
  readonly writablePathSets?: readonly WritablePathSet[];
}

/**
 * P1 (DR-69, B-4): where a list of writable paths came from. config, profile, definition, task: a
 * policy's `writablePaths` (the config file's, the applied profile's, the task type definition's,
 * the task file's); an entry covers itself and everything below it. plan: the files of the approved
 * `run` plan the run carries out (B-3); an entry covers exactly that file, nothing below it (B-5).
 */
export const WRITABLE_PATH_SOURCES = ["config", "profile", "definition", "task", "plan"] as const;
export type WritablePathSource = (typeof WRITABLE_PATH_SOURCES)[number];

/** B-4: one list of writable paths (ResolvedTaskSpec.writablePathSets). */
export interface WritablePathSet {
  readonly source: WritablePathSource;
  /** As the source gave them, format checked (checkProtectedPaths); for `plan`, the plan's resolved paths. */
  readonly entries: readonly string[];
}

/** SP-1: the names in MODEL_PROVIDER_NAMES (config.ts). */
export type ModelProviderName = (typeof MODEL_PROVIDER_NAMES)[number];

export type ModelConfig =
  | {
      readonly provider: "scripted";
      /** Scripted model file. Absolute, or relative to the directory of the task file. */
      readonly scriptPath: string;
    }
  | ApiModelConfig;

/**
 * SP-1, DR-31: the model settings of one API provider (API_PROVIDER_NAMES). A union with one member
 * per provider, so `Extract<ModelConfig, { provider: "anthropic" }>` keeps working.
 */
export type ApiModelConfig = {
  readonly [P in ApiProviderName]: {
    readonly provider: P;
    /** Model id. First in the model order: task, then the provider's model variable (DR-34), then the config file. */
    readonly model?: string;
    /** Output token cap per request, within the provider's limits (API_PROVIDERS). Overrides the config file's value. */
    readonly maxOutputTokens?: number;
  };
}[ApiProviderName];

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
  /**
   * P1 (DR-69, B-4): workspace-relative paths that file tools may write; they may write nothing
   * else. The format, the matching and the platform rules are protectedPaths' (checkProtectedPaths;
   * whole `/` separated segments, an entry covers itself and everything below it; judged on the
   * text, then on the real path, and an entry that is a link covers its real path; on Windows
   * ignoring case). It is an allow list and fails closed (review R-101 L-1): a list the format rule
   * rejects covers nothing as a whole, and an entry whose real path is outside the workspace, a
   * dangling link or not found (V-3 M-1: an entry allows only once its real path was found) covers
   * nothing on its own. A path that does not exist yet (a file to create) resolves as usual.
   * - Absent: no such limit. Present and empty: no file tool may write.
   * - Only narrows: each source that states it (the config file, the applied profile, the task type
   *   definition, the task file) is one more list, and a write must be covered by every list
   *   (ResolvedTaskSpec.writablePathSets). A task file can narrow the user's settings, never widen them.
   * - Protected paths and the other denials still apply under it.
   * - It guards the file tools only (B-8): a command the policy allows can write wherever it can.
   * - U-175 (B-2): the gate judges the lists it is given (PolicyGateOptions.writablePathSets,
   *   `path_not_writable`). The parsers still refuse the field (`unknown_field`) and nothing builds
   *   the lists until the CLI and the app (B-4).
   */
  readonly writablePaths?: readonly string[];
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
 * U-74 (DR-3, M-9): a command rule of the user's own settings, the config file's `policy` or a
 * profile's: with `confirm: true` a call it allows runs only after a person allowed that one call
 * during the run (ConfirmRequest, src/contracts/policy.ts). Absent: allowed as before. A task file's
 * policy and a task type definition's rules use CommandRule, which has no such field, so their
 * schema refuses it (`unknown_field`): neither can make a question.
 */
export interface ConfirmableCommandRule extends CommandRule {
  readonly confirm?: true;
}

/** U-74: PolicyConfig whose command rules may ask (the config file, a profile, the resolved task). */
export interface ConfirmablePolicyConfig extends PolicyConfig {
  readonly commands: readonly ConfirmableCommandRule[];
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
