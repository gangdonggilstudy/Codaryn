/**
 * Run journal: append-only, masked records under `<workspaceRoot>/.codaryn/`.
 * Free text fields are MaskedText, so raw text cannot be recorded by construction.
 * AC-D15: tool names and call ids (`tool`, `callId`, `MaskedToolCall.name` and `id`) are plain
 * strings, but the engine records only a tool name from a tool list or UNKNOWN_TOOL_RECORD_NAME, and
 * only an id that passes CALL_ID_PATTERN_SOURCE and masking (else a replacement), see `ToolCall`.
 * File originals kept for revert (`SNAPSHOTS_DIR_NAME`) are never part of the journal.
 */

import type { IntegrityPhase } from "./integrity.js";
import type { Limits, ModelProviderName } from "./task.js";
import type { ContentHash, MaskedText } from "./text.js";
import type { ModelMessage, ModelStop, ModelUsage, MaskedToolCall } from "./model.js";
import type { PermissionKind, PolicyDenialCode } from "./policy.js";
import type { ToolErrorCode, ToolResult } from "./tool.js";
import type { VerifierResult } from "./verify.js";
import type { RunReason, RunUsage, TerminalRunStatus } from "./engine.js";
import type { PlanMode } from "./plan.js";
import type { AnyToolName } from "./tool.js";
import type { CompletionMode } from "./workflow.js";

/** State directory inside the workspace root. No tool may read, list, write or run in it. */
export const STATE_DIR_NAME = ".codaryn";
export const RUNS_DIR_NAME = "runs";
/** `<root>/.codaryn/runs/<runId>/journal.jsonl`: one JSON record per line, UTF-8, LF. */
export const JOURNAL_FILE_NAME = "journal.jsonl";
/** `<root>/.codaryn/runs/<runId>/result.json`: the same object the CLI prints on stdout. */
export const RESULT_FILE_NAME = "result.json";
/** `<root>/.codaryn/lock.json`: held while a run is active in this workspace. */
export const LOCK_FILE_NAME = "lock.json";

export const JOURNAL_SCHEMA_VERSION = 1;

/** Stage at which a tool call was stopped or allowed. */
export type ToolDecisionStage = "validate" | "policy_requested" | "restore" | "policy_effective";

export type JournalEvent =
  | {
      readonly type: "run_started";
      readonly schemaVersion: 1;
      readonly taskId: string;
      readonly workflow: MaskedText;
      readonly provider: ModelProviderName;
      /** The resolved limits. Phase 2 records all six fields; earlier journals have four. */
      readonly limits: Limits;
      /**
       * G-A: present only when the task has workflow settings (a `workflowRef` or any of its
       * workflow fields): the definition used (or null) and the resolved settings, `instructions`
       * excepted (the first `model_request.system` holds them). Absent: the legacy settings.
       */
      readonly workflowRef?: string | null;
      /**
       * DR-37 (d): ResolvedTaskSpec.profile, when a profile was applied and its name passes
       * PROFILE_NAME_PATTERN_SOURCE. Absent: none (and every journal written before DR-37).
       */
      readonly profile?: string;
      readonly tools?: readonly AnyToolName[];
      readonly plan?: PlanMode;
      readonly completion?: CompletionMode;
    }
  | {
      readonly type: "model_request";
      readonly turn: number;
      /** Present on the first turn only. */
      readonly system: MaskedText | null;
      /** Messages added since the previous request. */
      readonly newMessages: readonly ModelMessage[];
    }
  | {
      readonly type: "model_response";
      readonly turn: number;
      readonly stop: ModelStop;
      readonly text: MaskedText;
      readonly toolCalls: readonly MaskedToolCall[];
      readonly usage: ModelUsage | null;
      /** SP-5, DR-31 (c): the count of reasoning items the provider returned (ModelResponse.reasoningItems); never their content. Absent when none were reported. */
      readonly reasoningItems?: number;
    }
  | {
      readonly type: "model_error";
      readonly turn: number;
      readonly kind: string;
      readonly message: MaskedText;
    }
  | {
      readonly type: "tool_decision";
      readonly callId: string;
      readonly tool: string;
      readonly stage: ToolDecisionStage;
      readonly allowed: boolean;
      readonly permission: PermissionKind | null;
      readonly code: PolicyDenialCode | ToolErrorCode | null;
    }
  | { readonly type: "tool_result"; readonly result: ToolResult }
  | {
      readonly type: "file_changed";
      readonly callId: string;
      readonly path: MaskedText;
      readonly previousHash: ContentHash | null;
      readonly newHash: ContentHash;
      readonly created: boolean;
    }
  | { readonly type: "verifier_result"; readonly result: VerifierResult }
  | {
      /**
       * A failed verification is sent back to the model (R-1). Recorded before the repair
       * message is sent. The message itself is recorded by the next `model_request`.
       */
      readonly type: "repair_started";
      /** 1 for the first repair of the run, then 2, 3, ... */
      readonly attempt: number;
      /** Ids of the verifiers that failed, in task order. */
      readonly failedVerifiers: readonly string[];
      /** True when evidence in the repair message was cut at its share of MAX_FEEDBACK_BYTES. */
      readonly feedbackTruncated: boolean;
    }
  | {
      /** U-1: one integrity check, recorded only when `EngineDeps.integrity` is present. */
      readonly type: "integrity_checked";
      readonly phase: IntegrityPhase;
      /** `IntegrityChecker.compare` for this check, masked, in its order. Empty: nothing changed. */
      readonly changed: readonly MaskedText[];
    }
  | {
      readonly type: "run_finished";
      readonly status: TerminalRunStatus;
      readonly reason: RunReason;
      readonly usage: RunUsage;
    };

export type JournalEventType = JournalEvent["type"];

/** A stored line: the event plus fields the journal adds. */
export type JournalRecord = JournalEvent & {
  /** 1-based, increasing by one per record within a run. */
  readonly seq: number;
  /** ISO 8601 UTC time. */
  readonly at: string;
  readonly runId: string;
};

export interface Journal {
  /** Appends one record and resolves after it was handed to the operating system. */
  append(event: JournalEvent): Promise<void>;
  close(): Promise<void>;
}
