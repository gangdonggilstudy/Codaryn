/**
 * Run journal: append-only, masked records under `<workspaceRoot>/.codaryn/`.
 * Free text fields are MaskedText, so raw text cannot be recorded by construction.
 */

import type { Limits, ModelProviderName } from "./task.js";
import type { ContentHash, MaskedText } from "./text.js";
import type { ModelMessage, ModelStop, ModelUsage, MaskedToolCall } from "./model.js";
import type { PermissionKind, PolicyDenialCode } from "./policy.js";
import type { ToolErrorCode, ToolResult } from "./tool.js";
import type { VerifierResult } from "./verify.js";
import type { RunReason, RunUsage, TerminalRunStatus } from "./engine.js";

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
      readonly limits: Limits;
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
