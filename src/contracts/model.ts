/**
 * Provider-neutral model interface and the scripted model file format.
 * A request holds MaskedText only: it is the model-bound context, never a local snapshot.
 */

import type { ModelProviderName } from "./task.js";
import type { JsonObject, MaskedText } from "./text.js";
import type { ToolCall, ToolName, ToolResult } from "./tool.js";

/** A tool call echoed back to the model. Args are kept as masked JSON text. */
export interface MaskedToolCall {
  readonly id: string;
  readonly name: string;
  readonly argsJson: MaskedText;
}

export type ModelMessage =
  | { readonly role: "user"; readonly content: MaskedText }
  | {
      readonly role: "assistant";
      readonly text: MaskedText;
      readonly toolCalls: readonly MaskedToolCall[];
    }
  | { readonly role: "tool"; readonly results: readonly ToolResult[] };

export interface ModelRequest {
  readonly system: MaskedText;
  readonly messages: readonly ModelMessage[];
  /** Tools offered in this request. A provider describes each one with `TOOL_DEFINITIONS`. */
  readonly tools: readonly ToolName[];
}

export type ModelStop = "tool_calls" | "final" | "length";

export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Model output is untrusted. The engine masks it again before recording or echoing it. */
export interface ModelResponse {
  readonly stop: ModelStop;
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  /** `null` means unknown. It is never treated as zero. */
  readonly usage: ModelUsage | null;
}

export const MODEL_ERROR_KINDS = [
  "not_configured",
  "not_implemented",
  "script_exhausted",
  "malformed_response",
  "aborted",
  /** The API rejected the key (HTTP 401 or 403). */
  "auth_failed",
  /** HTTP 429 after the allowed retries. */
  "rate_limited",
  /** HTTP 529 (or 503) after the allowed retries. */
  "overloaded",
  /** A request did not finish within `requestTimeoutMs`, after the allowed retries. */
  "timeout",
  /** Any other API or network failure. */
  "api_error",
] as const;
export type ModelErrorKind = (typeof MODEL_ERROR_KINDS)[number];

export type ModelOutcome =
  | { readonly ok: true; readonly response: ModelResponse }
  | { readonly ok: false; readonly kind: ModelErrorKind; readonly message: string };

export interface ModelProvider {
  readonly name: ModelProviderName;
  /** Never throws for provider-level failures. Rejects nothing: errors come back as an outcome. */
  complete(request: ModelRequest, signal: AbortSignal): Promise<ModelOutcome>;
}

/**
 * Settings the CLI resolves before it creates the anthropic provider. Every field is set:
 * the CLI refuses to start (nothing is sent) when the key, the model or the output cap is missing.
 */
export interface ResolvedAnthropicSettings {
  /** From ANTHROPIC_API_KEY. Memory only: never logged, recorded, printed or put in an error message. */
  readonly apiKey: string;
  readonly model: string;
  /** Sent as `max_tokens` on every request. */
  readonly maxOutputTokens: number;
  /** Without a trailing slash. The provider appends the API path. */
  readonly apiBaseUrl: string;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
}

/** Injection points for tests. Defaults: the global `fetch` and a timer-based sleep. */
export interface AnthropicProviderDeps {
  readonly fetch?: typeof fetch;
  /** Waits between retries. Should end early when `signal` aborts. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Signature of `createAnthropicProvider`, exported by `src/model/anthropic/index.ts`. */
export type CreateAnthropicProvider = (
  settings: ResolvedAnthropicSettings,
  deps?: AnthropicProviderDeps,
) => ModelProvider;

export const SCRIPT_SCHEMA_VERSION = 1;

/** Scripted model file. Step N answers the Nth model request of the run. */
export interface ScriptedModelScript {
  readonly schemaVersion: 1;
  readonly steps: readonly ScriptStep[];
}

export interface ScriptStep {
  /** Defaults to "". */
  readonly text?: string;
  /** Defaults to []. */
  readonly toolCalls?: readonly ScriptToolCall[];
  /** Defaults to "tool_calls" when toolCalls is non-empty, otherwise "final". */
  readonly stop?: ModelStop;
  /** Defaults to null (unknown). */
  readonly usage?: ModelUsage | null;
  /** Wait this long before answering. The wait ends early when the run is cancelled. */
  readonly delayMs?: number;
}

export interface ScriptToolCall {
  /** Defaults to `call_<step number>_<call number>`, both 1-based. */
  readonly id?: string;
  readonly name: string;
  readonly args: JsonObject;
}

/**
 * Placeholder usable in `text` and in string values of `args`: `{{secret_token:N}}`.
 * It expands to the Nth distinct privacy token (1-based, by first appearance) found in the
 * requests the scripted provider has received so far. It only repeats what a model was shown.
 * An index with no such token makes the step fail with `script_exhausted`.
 */
export const SCRIPT_TOKEN_PLACEHOLDER_SOURCE = "\\{\\{secret_token:([1-9][0-9]*)\\}\\}";
