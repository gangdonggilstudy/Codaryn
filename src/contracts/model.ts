/**
 * Provider-neutral model interface and the scripted model file format.
 * A request holds MaskedText only: it is the model-bound context, never a local snapshot.
 */

import type { ModelProviderName } from "./task.js";
import type { JsonObject, MaskedText } from "./text.js";
import type { ToolCall, ToolName, ToolResult, WorkflowToolName } from "./tool.js";

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
  /**
   * G-A: task type tools offered in this request, after `tools`. A provider describes each one with
   * `WORKFLOW_TOOL_DEFINITIONS`. Absent or empty for a task without task type tools, so its requests
   * stay as before stage 4.
   */
  readonly workflowTools?: readonly WorkflowToolName[];
}

export type ModelStop = "tool_calls" | "final" | "length";

/**
 * SP-1: `inputTokens` is the whole input, cached input read and written included; `outputTokens`
 * is the whole output, reasoning tokens included. An adapter maps its provider's fields to this and
 * never counts a part twice.
 */
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
  /**
   * SP-5, DR-31 (c): how many reasoning items the provider returned with this response. The adapter
   * keeps them (opaque, encrypted by the provider) in memory for the rest of the run and sends them
   * back with the next requests; their content never reaches the engine. The engine records the
   * count only. Absent: none, or a provider without such items.
   */
  readonly reasoningItems?: number;
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
  /**
   * DR-31 (f): the account's quota or spending limit is used up, so retrying does not help (openai:
   * HTTP 429 with error type `insufficient_quota`, or code `credit_balance_exhausted`,
   * `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`,
   * `organization_usage_limit_exceeded`, or the older code `insufficient_quota`). Not retried.
   */
  "quota_exhausted",
  /** The provider said it is overloaded (anthropic: HTTP 529 or 503; openai: HTTP 503), after the allowed retries. */
  "overloaded",
  /** A request did not finish within `requestTimeoutMs`, after the allowed retries. */
  "timeout",
  /** Any other API or network failure. */
  "api_error",
] as const;
export type ModelErrorKind = (typeof MODEL_ERROR_KINDS)[number];

/**
 * U-55 (AXM-9): whether trying again later may help after a model error, by the adapters' own
 * classification (`classifyStatus` of each provider and the transport, src/model; facts C-5, C-6).
 * The adapter has already retried what it could (`maxRetries`, `Retry-After`); true says a later
 * run may succeed, not that it will.
 * - true: rate_limited (HTTP 429), overloaded (529, 503), timeout, and api_error with HTTP 408, 409
 *   or 5xx.
 * - false: auth_failed, quota_exhausted (a 429 that retrying does not lift, DR-31 (f)),
 *   not_configured, not_implemented, script_exhausted, malformed_response, aborted, and api_error
 *   with any other HTTP status.
 * - undefined, unknown: api_error without an HTTP status. A connection failure (which the transport
 *   retries) and a TLS failure, a refused request format, a refusal or a failed response (which it
 *   does not) look the same in a ModelOutcome. Absent means unknown, never false.
 * U-82 (DR-68): `verdict`, the outcome's own `retryable` (the transport's or the adapter's), comes
 * first when it is given; the rule above is for outcomes without one.
 */
export function modelErrorRetryable(kind: ModelErrorKind, httpStatus?: number, verdict?: boolean): boolean | undefined {
  if (verdict !== undefined) return verdict;
  switch (kind) {
    case "rate_limited":
    case "overloaded":
    case "timeout":
      return true;
    case "api_error":
      if (httpStatus === undefined) return undefined;
      // As the adapters' classifyStatus (`status >= 500`).
      return httpStatus === 408 || httpStatus === 409 || httpStatus >= 500;
    default:
      return false;
  }
}

export type ModelOutcome =
  | { readonly ok: true; readonly response: ModelResponse }
  | {
      readonly ok: false;
      readonly kind: ModelErrorKind;
      readonly message: string;
      /**
       * SP-1: the HTTP status when the failure is an HTTP response (after redirects were refused),
       * absent for a connection failure, a timeout, a cancel or a check before sending. Adapters
       * fill it from SP-3 on; until then it is absent.
       */
      readonly httpStatus?: number;
      /**
       * U-82 (DR-68): whether trying again later can help, as the adapter knows it: the transport's
       * verdict on its last attempt for what it sent (src/model/http: 429, 503 and 529, 408, 409,
       * 5xx, a timeout, a refused or reset connection yes; others no), and the adapter's own where
       * it is plain (a malformed response, a refusal, an unusable key, a request it could not build:
       * no). Absent where it is not known (an unexpected failure, a cancel, a response the provider
       * says failed, was cancelled or is incomplete, and, review R-75 L2, a transport failure of no
       * known kind, which the transport does not retry out of care) and from a provider that does not
       * say (the scripted one). Absent means unknown, never false.
       */
      readonly retryable?: boolean;
    };

export interface ModelProvider {
  readonly name: ModelProviderName;
  /** Never throws for provider-level failures. Rejects nothing: errors come back as an outcome. */
  complete(request: ModelRequest, signal: AbortSignal): Promise<ModelOutcome>;
}

/**
 * SP-1: settings the CLI resolves before it creates an API provider. Every field is set: the CLI
 * refuses to start (nothing is sent) when the key, the model or the output cap is missing. The
 * provider is chosen apart from these values: the caller picks the provider's factory by the
 * resolved provider (the CLI's API_PROVIDER_FACTORIES, src/cli/provider.ts; the app layer runs
 * through it), so this type carries none (U-143: SP-4 and SP-6 resolved the provider this way
 * instead of adding it here).
 */
export interface ResolvedApiSettings {
  /** From the provider's key variable (API_PROVIDERS). Memory only: never logged, recorded, printed or put in an error message. */
  readonly apiKey: string;
  readonly model: string;
  /** The output cap sent on every request: Anthropic `max_tokens`, OpenAI `max_output_tokens`. */
  readonly maxOutputTokens: number;
  /** Without a trailing slash. The provider appends the API path. */
  readonly apiBaseUrl: string;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
}

/** The settings of the Anthropic provider. SP-1: the same type under its first name. */
export type ResolvedAnthropicSettings = ResolvedApiSettings;

/** Injection points for tests. Defaults: the global `fetch` and a timer-based sleep. */
export interface ApiProviderDeps {
  readonly fetch?: typeof fetch;
  /** Waits between retries. Should end early when `signal` aborts. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** SP-1: the same injection points under their first name. */
export type AnthropicProviderDeps = ApiProviderDeps;

/**
 * SP-1: what every API provider's factory looks like: `createAnthropicProvider`
 * (`src/model/anthropic/index.ts`) and, from SP-5, `createOpenAIProvider` (`src/model/openai/index.ts`).
 */
export type CreateApiProvider = (settings: ResolvedApiSettings, deps?: ApiProviderDeps) => ModelProvider;

/** Signature of `createAnthropicProvider`, exported by `src/model/anthropic/index.ts`. */
export type CreateAnthropicProvider = CreateApiProvider;

/**
 * One model of a provider's model list. Each adapter fills what its list gives; the rest is null.
 * - Anthropic Models API (Y-1): `GET /v1/models`, sent with the same `x-api-key` and
 *   `anthropic-version` headers as Messages requests. `capabilities` and anything else is dropped.
 * - OpenAI (SP-5, facts C-12): `GET /models` gives only `id` and `created`: `displayName` is the id,
 *   `createdAt` is `created` written as RFC 3339, and both token fields are null.
 */
export interface ModelInfo {
  /** `id`: the value for `model` in a task or config file. */
  readonly id: string;
  /** `display_name`, or the id when it is missing or not a string. */
  readonly displayName: string;
  /** `created_at` as the API gives it (RFC 3339 text), or null when it is missing or not a string. */
  readonly createdAt: string | null;
  /** `max_input_tokens` (context window), or null when missing or not a positive integer. */
  readonly maxInputTokens: number | null;
  /** `max_tokens` (output cap), or null when missing or not a positive integer. */
  readonly maxOutputTokens: number | null;
}

/** What listing needs: the resolved settings without a model or an output cap. */
export type ListModelsSettings = Pick<ResolvedApiSettings, "apiKey" | "apiBaseUrl" | "requestTimeoutMs" | "maxRetries">;
/** SP-1: the same type under its first name. */
export type AnthropicListSettings = ListModelsSettings;

export type ListModelsOutcome =
  | { readonly ok: true; readonly models: readonly ModelInfo[] }
  /** Same kinds as a model request (`auth_failed`, `rate_limited`, `timeout`, `aborted`, ...). */
  /** U-82: `retryable` as on a ModelOutcome failure. */
  | { readonly ok: false; readonly kind: ModelErrorKind; readonly message: string; readonly httpStatus?: number; readonly retryable?: boolean };

/**
 * SP-1: what every API provider's model listing looks like (the Anthropic one is below). SP-5:
 * `listOpenAIModels` (`src/model/openai/index.ts`) reads the one page the API documents.
 */
export type ListModels = (settings: ListModelsSettings, deps?: ApiProviderDeps, signal?: AbortSignal) => Promise<ListModelsOutcome>;

/** Most pages one listing reads. More is `api_error` (a bound on requests, not an expected size). */
export const MAX_MODEL_LIST_PAGES = 20;

/**
 * Signature of `listAnthropicModels`, exported by `src/model/anthropic/index.ts` (Y-1, p5).
 * - Reads every page: while `has_more` is true, the next request passes the previous `last_id` as
 *   `after_id`, up to MAX_MODEL_LIST_PAGES pages. Models keep the order the API gives.
 * - Same timeout per request, retries, and error kinds as Messages requests. Never throws for an
 *   API or network failure; `signal` aborting gives `aborted`.
 * - The key goes into the `x-api-key` header only: never into a message, URL or log.
 * - An entry without a string `id` makes the whole listing `malformed_response`.
 */
export type ListAnthropicModels = ListModels;

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
