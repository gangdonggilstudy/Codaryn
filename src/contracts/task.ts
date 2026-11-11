/**
 * The task file (task.json) and the resolved task the engine runs (`ResolvedTaskSpec`).
 * The file has the TaskSpec shape, except that `limits` and each of its fields may be left out
 * when the config file supplies them (see `CodarynConfig`). The quick form (`--workspace`,
 * `--goal`) builds the task from the config file instead.
 * Neither file ever contains secret values or API keys.
 */

import type { VerifierConfig } from "./verify.js";

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
}

/**
 * The task as the CLI hands it to the engine: paths are absolute and every limit is set.
 * `EngineDeps.task` has this type. A task file may leave the repair limits out (defaults below).
 */
export interface ResolvedTaskSpec extends TaskSpec {
  readonly limits: ResolvedLimits;
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
      /** Output token cap per request. Overrides the config file's value. */
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
   * - Entries are relative, use `/` or the platform separator, and have no `..` segment.
   * - Absent or empty: nothing is protected. Only the task or config file sets it. A model,
   *   the other task fields and files in the workspace cannot change it.
   * - Commands allowed by `commands` can still change these paths. It guards the file tools only.
   */
  readonly protectedPaths?: readonly string[];
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
