/**
 * Run states, exit codes, the engine entry point and the CLI output objects.
 */

import type { Journal } from "./journal.js";
import type { ModelProvider } from "./model.js";
import type { PolicyGate } from "./policy.js";
import type { PrivacyGateway } from "./privacy.js";
import type { ModelProviderName, TaskSpec } from "./task.js";
import type { ContentHash, MaskedText } from "./text.js";
import type { ToolRunner } from "./tool.js";
import type { VerifierResult, VerifierRunner } from "./verify.js";

export const RUN_STATUSES = [
  "created",
  "running",
  "verifying",
  "done",
  "failed",
  "needs-input",
  "cancelled",
  "budget-exhausted",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_RUN_STATUSES = [
  "done",
  "failed",
  "needs-input",
  "cancelled",
  "budget-exhausted",
] as const;
export type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number];

/** Allowed transitions. Any transition not listed here is rejected. */
export const RUN_TRANSITIONS: { readonly [S in RunStatus]: readonly RunStatus[] } = {
  created: ["running", "cancelled"],
  running: ["verifying", "failed", "needs-input", "cancelled", "budget-exhausted"],
  verifying: ["done", "failed", "needs-input", "cancelled", "budget-exhausted"],
  done: [],
  failed: [],
  "needs-input": [],
  cancelled: [],
  "budget-exhausted": [],
};

/** Why a run ended in its status. */
export interface RunReasonByStatus {
  /** Every configured verifier passed. */
  readonly done: "verified";
  readonly failed: "verifier_failed" | "model_error";
  readonly "needs-input": "verifier_inconclusive" | "no_verifier" | "unknown_tool_outcome";
  readonly cancelled: "cancelled";
  readonly "budget-exhausted":
    | "max_model_turns"
    | "max_tool_calls"
    | "max_total_tokens"
    | "max_duration"
    | "usage_unknown";
}
export type RunReason = RunReasonByStatus[TerminalRunStatus];

/** Process exit code for each terminal status. */
export const RUN_EXIT_CODES: { readonly [S in TerminalRunStatus]: number } = {
  done: 0,
  failed: 1,
  "needs-input": 3,
  "budget-exhausted": 4,
  cancelled: 5,
};

/** Errors that end the CLI before a run starts. No journal is written for them. */
export const CLI_ERROR_EXIT_CODES = {
  invalid_arguments: 2,
  invalid_task: 2,
  /** The config file cannot be read, or a value in it is invalid. */
  invalid_config: 2,
  /** A task or config file has a key field or a key value. Nothing else is checked first. */
  key_in_file: 2,
  invalid_script: 2,
  secret_env_missing: 2,
  workspace_not_found: 2,
  workspace_locked: 6,
  provider_not_configured: 7,
  provider_not_implemented: 7,
  internal_error: 70,
} as const;
export type CliErrorCode = keyof typeof CLI_ERROR_EXIT_CODES;

export interface RunUsage {
  readonly modelTurns: number;
  readonly toolCalls: number;
  /** `null` when at least one response did not report usage. */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly durationMs: number;
}

export interface FileChangeRecord {
  readonly path: MaskedText;
  readonly previousHash: ContentHash | null;
  readonly newHash: ContentHash;
  readonly created: boolean;
}

export const RESULT_SCHEMA_VERSION = 1;

/** Result of one run. Printed on stdout as one JSON line and stored as result.json. */
export interface EngineResult {
  readonly schemaVersion: 1;
  readonly kind: "run";
  readonly runId: string;
  readonly taskId: string;
  readonly status: TerminalRunStatus;
  readonly reason: RunReason;
  readonly exitCode: number;
  /** "scripted" means no real API was called. */
  readonly provider: ModelProviderName;
  /** In task order. Empty when the run ended before verification or no verifier is configured. */
  readonly verifiers: readonly VerifierResult[];
  /** Applied changes in order. They are kept when a run is cancelled or fails. */
  readonly changes: readonly FileChangeRecord[];
  readonly usage: RunUsage;
  /** Relative to the workspace root, `/` separated. */
  readonly journalPath: string;
  /** Short masked notes, for example "no automatic verification". */
  readonly notices: readonly MaskedText[];
}

/** Printed on stdout as one JSON line when the CLI stops before a run starts. */
export interface CliErrorOutput {
  readonly schemaVersion: 1;
  readonly kind: "error";
  readonly code: CliErrorCode;
  readonly exitCode: number;
  /** Never contains secret values, keys or file contents. */
  readonly message: string;
}

export type CliOutput = EngineResult | CliErrorOutput;

/** Injected time source in milliseconds. */
export interface Clock {
  now(): number;
}

export interface EngineDeps {
  readonly task: TaskSpec;
  readonly runId: string;
  readonly model: ModelProvider;
  readonly privacy: PrivacyGateway;
  readonly policy: PolicyGate;
  readonly tools: ToolRunner;
  readonly verifiers: VerifierRunner;
  readonly journal: Journal;
  readonly clock: Clock;
  /** Aborting it cancels the run. */
  readonly signal: AbortSignal;
}

/** Signature of `runTask`, exported by `src/engine/index.ts`. */
export type RunTask = (deps: EngineDeps) => Promise<EngineResult>;
