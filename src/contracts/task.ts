/**
 * The resolved task the engine runs, and the task file (task.json) it comes from.
 * The file has this shape, except that `limits` and each of its fields may be left out when the
 * config file supplies them (see `CodarynConfig`). The quick form (`--workspace`, `--goal`)
 * builds a TaskSpec from the config file instead.
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
}

export interface CommandRule {
  /** Exact, case-sensitive match against `run_command.executable`. No shell is used. */
  readonly executable: string;
  /** The call's args must start with exactly these values. */
  readonly argsPrefix: readonly string[];
  /** When false the call's args must equal `argsPrefix`. */
  readonly allowExtraArgs: boolean;
}

/** Every limit is a positive integer. Exceeding one ends the run as `budget-exhausted`. */
export interface Limits {
  readonly maxModelTurns: number;
  readonly maxToolCalls: number;
  /** `null` states explicitly that no token limit applies. */
  readonly maxTotalTokens: number | null;
  readonly maxDurationMs: number;
}
