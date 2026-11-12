/**
 * OpenAI Responses API provider (SP-5, DR-31; docs/design/second-provider.md 4.6-4.10, facts in
 * docs/design/second-provider-facts.md).
 *
 * - Requests go through the shared transport (`../http/index.ts`): built-in `fetch`, the time limit,
 *   retries, body limits, redirect refusal and message redaction are the ones the Anthropic adapter
 *   uses. `retry-after` is a minimum wait (facts C-6, DR-31 (f)).
 * - The API key goes into the `authorization: Bearer` header only (facts C-2). It never appears in a
 *   request body, a URL, an outcome message or a thrown error. The optional organization and project
 *   headers are not sent.
 * - `POST <apiBaseUrl>/responses` (the address includes `/v1`, facts C-4) with `model`, `instructions`
 *   (the system text), `input` (items), `tools` (flat function tools with `strict: false`, DR-31 (d)),
 *   `max_output_tokens` and `store: false` (DR-31 (c)): the provider keeps no copy of the response.
 * - Without stored responses the next request must carry the previous responses' `output` items,
 *   reasoning items included (facts C-11). This provider keeps them in memory, for the provider
 *   object's life (one run), and sends them back as they came, up to MAX_KEPT_OUTPUT_BYTES (DR-35 (d)). They never reach the engine, the run
 *   record, the result or a report: the engine sees text and calls, and the count of reasoning items
 *   (ModelResponse.reasoningItems). Reasoning items are opaque to the privacy gateway (encrypted by
 *   the provider); they go back only to the same provider within the same run.
 * - Call ids (DR-31 (e), DR-35 (c)): a call's `call_id` is passed as ToolCall.id. One that passes
 *   AC-D15 is recorded as given, as for Anthropic. When the engine records one under another id, its
 *   assistant message carries that id; the provider pairs the message with the response it kept and
 *   answers the call with the original `call_id`. That pairing is in memory only.
 * - Stop (DR-31 (h)): `completed` with a `function_call` item is `tool_calls`, without one `final`;
 *   `incomplete` for `max_output_tokens` is `length`. A refusal part or `incomplete` for
 *   `content_filter` is `api_error` with a fixed phrase (the refusal text is not quoted); other
 *   `incomplete` reasons, `failed` and `cancelled` are `api_error`, quoting a reason or code only when
 *   it is a short identifier.
 * - Errors: 401 and 403 `auth_failed`, with a fixed phrase (DR-35 (a)); 429 `quota_exhausted` (not retried) when the error type is
 *   `insufficient_quota` or its code is one of OPENAI_QUOTA_ERROR_CODES, otherwise `rate_limited`
 *   (retried); 503 `overloaded`; 408, 409 and other 5xx `api_error`, retried. Only a JSON error
 *   object is quoted: its type and code when they are identifiers, its message, and the
 *   `x-request-id` header when it is a short identifier.
 *
 * Model listing: `listOpenAIModels` reads `GET <apiBaseUrl>/models` once (the API documents no
 * paging, facts C-12) through the same transport.
 */

import {
  API_KEY_MASK_PATTERN_SOURCES,
  API_PROVIDERS,
  REPLACED_CALL_ID_PREFIX,
  TOOL_DEFINITIONS,
  UNKNOWN_TOOL_RECORD_NAME,
  WORKFLOW_TOOL_DEFINITIONS,
} from "../../contracts/index.js";
import type {
  AnyToolName,
  ApiProviderDeps,
  CreateApiProvider,
  JsonObject,
  ListModels,
  ListModelsOutcome,
  ListModelsSettings,
  MaskedToolCall,
  ModelErrorKind,
  ModelInfo,
  ModelOutcome,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStop,
  ModelUsage,
  ResolvedApiSettings,
  ToolCall,
} from "../../contracts/index.js";

import {
  AUTH_REFUSED_MESSAGE,
  createKeyMaterialCheck,
  createRedactor,
  decoder,
  defaultSleep,
  isPlainObject,
  isUsableApiKey,
  sendWithRetries,
  UNUSABLE_KEY_MESSAGE,
  validateConnection,
} from "../http/index.js";
import type { Failure, LimitedBody, Transport } from "../http/index.js";

/** Appended to `ResolvedApiSettings.apiBaseUrl` (which includes `/v1`). */
export const OPENAI_RESPONSES_PATH = "/responses";
/** Appended to `ListModelsSettings.apiBaseUrl`. */
export const OPENAI_MODELS_PATH = "/models";

/**
 * Facts C-5, DR-31 (f): the error codes of a 429 that waiting does not cure (billing and quota). The
 * last one is the older form (not in the current documents), matched to be safe.
 */
export const OPENAI_QUOTA_ERROR_CODES: readonly string[] = [
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "insufficient_quota",
];

/**
 * DR-35 (b), R-22 L-2: the bytes of an error body read to classify it (quota or rate limit) and to
 * describe it. A quota error with a long message is still found; the message is cut as before.
 */
export const MAX_OPENAI_ERROR_BODY_BYTES = 64 * 1024;

/** Every key shape Codaryn hides in output (DR-32 (a)): removed from messages, refused in listed values. */
const KEY_SHAPES: readonly string[] = API_KEY_MASK_PATTERN_SOURCES;

/** An error type, code or reason quoted in a message. */
const IDENTIFIER = /^[A-Za-z0-9_]{1,64}$/;
/** A request id quoted in a message. */
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validateSettings(settings: ResolvedApiSettings): string {
  if (typeof settings.apiKey !== "string" || settings.apiKey.length === 0) {
    throw new TypeError("openai provider: apiKey must be a non-empty string");
  }
  if (typeof settings.model !== "string" || settings.model.trim().length === 0) {
    throw new TypeError("openai provider: model must be a non-empty string");
  }
  const least = API_PROVIDERS.openai.minOutputTokens;
  if (!Number.isSafeInteger(settings.maxOutputTokens) || settings.maxOutputTokens < least) {
    throw new TypeError(`openai provider: maxOutputTokens must be an integer of at least ${least}`);
  }
  return `${validateConnection(settings, "openai")}${OPENAI_RESPONSES_PATH}`;
}

// ---------------------------------------------------------------------------------------------
// Responses kept in memory (DR-31 (c), (e))

/**
 * DR-35 (d), R-22 L-4: the most bytes of output items (their JSON as UTF-8) this provider keeps to
 * send back over a run. Twice the limit of one response body (8 MiB) and far below the provider's
 * request limit (128 MiB, facts C-13). When the kept items pass it, the next request is not sent and
 * fails with a fixed message: the provider keeps no copy (`store: false`), so the conversation
 * cannot go on without them. The response that passed it is still returned (a final answer ends
 * the run without another request). Memory stays within this limit and one more response.
 */
export const MAX_KEPT_OUTPUT_BYTES = 16 * 1024 * 1024;

const encoder = new TextEncoder();

/** One response this provider returned, kept for the rest of the run. */
interface KeptResponse {
  /** Its `output` items exactly as received, reasoning items included. Sent back as they are. */
  readonly items: readonly unknown[];
  /** The size of `items` as JSON in UTF-8 bytes (DR-35 (d)). */
  readonly bytes: number;
  /** Its function calls in order: the original `call_id` and name. */
  readonly calls: readonly { readonly callId: string; readonly name: string }[];
}

/**
 * True when an assistant message of the conversation is the engine's copy of `kept`: the same calls
 * in the same order, each under its own `call_id` or an id the engine put in its place
 * (REPLACED_CALL_ID_PREFIX), and under its own name or UNKNOWN_TOOL_RECORD_NAME (AC-D15).
 */
function echoes(toolCalls: readonly MaskedToolCall[], kept: KeptResponse): boolean {
  if (toolCalls.length !== kept.calls.length) return false;
  return toolCalls.every((call, index) => {
    const original = kept.calls[index];
    if (original === undefined) return false;
    const sameId = call.id === original.callId || call.id.startsWith(REPLACED_CALL_ID_PREFIX);
    const sameName = call.name === original.name || call.name === UNKNOWN_TOOL_RECORD_NAME;
    return sameId && sameName;
  });
}

// ---------------------------------------------------------------------------------------------
// Request

type Tool = { type: "function"; name: AnyToolName; description: string; parameters: JsonObject; strict: false };

/**
 * Serializes the request once; every attempt sends exactly these bytes. An assistant message the
 * provider recognizes (in order, among the responses it kept) is replaced by that response's items;
 * any other one is sent as the engine has it (its text and calls, no reasoning items).
 */
function buildBody(settings: ResolvedApiSettings, request: ModelRequest, kept: readonly KeptResponse[]): { body: string } | string {
  const keptBytes = kept.reduce((total, response) => total + response.bytes, 0);
  if (keptBytes > MAX_KEPT_OUTPUT_BYTES) {
    return `the output items to send back come to more than ${MAX_KEPT_OUTPUT_BYTES} bytes; the provider keeps no copy, so the conversation cannot go on`;
  }
  const input: unknown[] = [];
  /** The engine's id of a call -> the `call_id` the provider gave it. */
  const callIds = new Map<string, string>();
  let next = 0;
  for (const message of request.messages) {
    switch (message.role) {
      case "user":
        if (message.content.length > 0) input.push({ type: "message", role: "user", content: message.content });
        break;
      case "assistant": {
        let found = -1;
        for (let index = next; index < kept.length; index += 1) {
          if (echoes(message.toolCalls, kept[index] as KeptResponse)) {
            found = index;
            break;
          }
        }
        if (found >= 0) {
          const response = kept[found] as KeptResponse;
          input.push(...response.items);
          message.toolCalls.forEach((call, index) => callIds.set(call.id, (response.calls[index] as { callId: string }).callId));
          next = found + 1;
          break;
        }
        if (message.text.length > 0) input.push({ type: "message", role: "assistant", content: message.text });
        for (const call of message.toolCalls) {
          input.push({ type: "function_call", call_id: call.id, name: call.name, arguments: call.argsJson });
        }
        break;
      }
      case "tool":
        for (const result of message.results) {
          input.push({ type: "function_call_output", call_id: callIds.get(result.callId) ?? result.callId, output: result.content });
        }
        break;
    }
  }

  const seen = new Set<string>();
  const tools: Tool[] = [];
  for (const name of request.tools) {
    const definition = TOOL_DEFINITIONS[name];
    if (definition === undefined) return `tool ${JSON.stringify(String(name))} has no definition`;
    if (seen.has(name)) continue;
    seen.add(name);
    tools.push({ type: "function", name, description: definition.description, parameters: definition.inputSchema, strict: false });
  }
  for (const name of request.workflowTools ?? []) {
    const definition = Object.hasOwn(WORKFLOW_TOOL_DEFINITIONS, name) ? WORKFLOW_TOOL_DEFINITIONS[name] : undefined;
    if (definition === undefined) return `tool ${JSON.stringify(String(name))} has no definition`;
    if (seen.has(name)) continue;
    seen.add(name);
    tools.push({ type: "function", name, description: definition.description, parameters: definition.inputSchema, strict: false });
  }

  const body: { [field: string]: unknown } = { model: settings.model };
  if (request.system.length > 0) body.instructions = request.system;
  body.input = input;
  if (tools.length > 0) body.tools = tools;
  body.max_output_tokens = settings.maxOutputTokens;
  body.store = false;
  return { body: JSON.stringify(body) };
}

// ---------------------------------------------------------------------------------------------
// Response

/** Facts C-9: `input_tokens` includes cached input, `output_tokens` includes reasoning; nothing is added. */
function parseUsage(value: unknown): ModelUsage | null {
  if (!isPlainObject(value)) return null;
  const { input_tokens, output_tokens } = value;
  if (!isCount(input_tokens) || !isCount(output_tokens)) return null;
  return { inputTokens: input_tokens, outputTokens: output_tokens };
}

function malformed(message: string): Failure {
  return { ok: false, kind: "malformed_response", message: `malformed response: ${message}` };
}

function declined(why: string): Failure {
  return { ok: false, kind: "api_error", message: `the model declined the request (${why})` };
}

const quoted = (value: string): string => JSON.stringify(value.slice(0, 40));

type Parsed = { readonly ok: true; readonly response: ModelResponse; readonly kept: KeptResponse | null } | Failure;

/** Turns a 2xx body into a response and what to keep of it. Unknown structure is `malformed_response`. */
function parseResponseBody(text: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return malformed("the body is not JSON");
  }
  if (!isPlainObject(value)) return malformed("the body is not a JSON object");

  const status = value.status;
  if (typeof status !== "string") return malformed("status is not a string");
  if (status === "failed") {
    const code = isPlainObject(value.error) && typeof value.error.code === "string" && IDENTIFIER.test(value.error.code) ? ` (code ${value.error.code})` : "";
    return { ok: false, kind: "api_error", message: `the response failed${code}` };
  }
  if (status === "cancelled") return { ok: false, kind: "api_error", message: "the provider cancelled the response" };
  if (status !== "completed" && status !== "incomplete") return malformed(`unexpected status ${quoted(status)}`);
  if (status === "incomplete") {
    const details = value.incomplete_details;
    const reason = isPlainObject(details) && typeof details.reason === "string" ? details.reason : null;
    if (reason === "content_filter") return declined("incomplete: content_filter");
    if (reason !== "max_output_tokens") {
      const why = reason !== null && IDENTIFIER.test(reason) ? ` (reason ${reason})` : "";
      return { ok: false, kind: "api_error", message: `the response is incomplete${why}` };
    }
  }

  if (!Array.isArray(value.output)) return malformed("output is not an array");
  const texts: string[] = [];
  const toolCalls: ToolCall[] = [];
  const calls: { callId: string; name: string }[] = [];
  const ids = new Set<string>();
  let reasoningItems = 0;
  for (const [index, item] of value.output.entries()) {
    if (!isPlainObject(item) || typeof item.type !== "string") return malformed(`output item ${index} has no type`);
    switch (item.type) {
      case "message": {
        if (!Array.isArray(item.content)) return malformed(`message item ${index} has no content list`);
        for (const [partIndex, part] of item.content.entries()) {
          if (!isPlainObject(part) || typeof part.type !== "string") {
            return malformed(`content part ${partIndex} of output item ${index} has no type`);
          }
          if (part.type === "refusal") return declined("refusal");
          if (part.type !== "output_text") return malformed(`unexpected content part type ${quoted(part.type)}`);
          if (typeof part.text !== "string") return malformed(`output_text part ${partIndex} of output item ${index} has no text`);
          texts.push(part.text);
        }
        break;
      }
      case "function_call": {
        // A response cut at its token limit ends the run (`length`); its calls are not read.
        if (status === "incomplete") break;
        const { call_id: callId, name, arguments: argsText } = item;
        if (typeof callId !== "string" || callId.length === 0) return malformed(`function_call item ${index} has no call_id`);
        if (typeof name !== "string" || name.length === 0) return malformed(`function_call item ${index} has no name`);
        if (typeof argsText !== "string") return malformed(`function_call item ${index} arguments are not a string`);
        let args: unknown;
        try {
          args = JSON.parse(argsText);
        } catch {
          return malformed(`function_call item ${index} arguments are not JSON`);
        }
        if (!isPlainObject(args)) return malformed(`function_call item ${index} arguments are not a JSON object`);
        if (ids.has(callId)) return malformed(`function_call item ${index} repeats an earlier call_id`);
        ids.add(callId);
        // Unregistered names are passed through: the engine decides (unknown_tool).
        toolCalls.push({ id: callId, name, args: args as JsonObject });
        calls.push({ callId, name });
        break;
      }
      case "reasoning":
        // Opaque: kept and sent back, never read (DR-31 (c)).
        reasoningItems += 1;
        break;
      default:
        return malformed(`unexpected output item type ${quoted(item.type)}`);
    }
  }

  const stop: ModelStop = status === "incomplete" ? "length" : toolCalls.length > 0 ? "tool_calls" : "final";
  const response: ModelResponse = {
    stop,
    text: texts.join(""),
    toolCalls,
    usage: parseUsage(value.usage),
    ...(reasoningItems > 0 ? { reasoningItems } : {}),
  };
  const kept = stop === "length" ? null : { items: value.output, bytes: encoder.encode(JSON.stringify(value.output)).byteLength, calls };
  return { ok: true, response, kept };
}

// ---------------------------------------------------------------------------------------------
// Errors

/** The `error` object of an error body, when the body is a whole JSON object with one. */
function errorObject(body: LimitedBody): { readonly [field: string]: unknown } | null {
  if (body.over) return null;
  try {
    const value: unknown = JSON.parse(decoder.decode(body.bytes));
    return isPlainObject(value) && isPlainObject(value.error) ? value.error : null;
  } catch {
    return null;
  }
}

function classifyStatus(status: number, body: LimitedBody): { kind: ModelErrorKind; retryable: boolean } {
  if (status === 401 || status === 403) return { kind: "auth_failed", retryable: false };
  if (status === 429) {
    const error = errorObject(body);
    const quota =
      error !== null &&
      (error.type === "insufficient_quota" || (typeof error.code === "string" && OPENAI_QUOTA_ERROR_CODES.includes(error.code)));
    return quota ? { kind: "quota_exhausted", retryable: false } : { kind: "rate_limited", retryable: true };
  }
  if (status === 503) return { kind: "overloaded", retryable: true };
  if (status === 408 || status === 409 || status >= 500) return { kind: "api_error", retryable: true };
  return { kind: "api_error", retryable: false };
}

/** DR-35 (a): what a 401 or 403 says, whatever the provider's message (shared with Anthropic, DR-37 (a)). */
export { AUTH_REFUSED_MESSAGE };

/**
 * Describes an error response. Only a JSON error object is quoted: its `type` and `code` when they
 * are identifiers, its `message`, and an `x-request-id` header of identifier characters. Any other
 * body (HTML from a proxy, plain text, a body cut at the limit) is not quoted at all.
 * DR-35 (a), R-22 L-1: a 401 or 403 quotes nothing of the body, only AUTH_REFUSED_MESSAGE and the
 * request id: its message may echo part of the key (its start and its last characters), and a run
 * of fewer than KEY_FRAGMENT_CHARS characters is not found by the redactor.
 */
function describeHttpError(status: number, body: LimitedBody, headers?: Headers): string {
  const header = headers?.get("x-request-id") ?? null;
  const requestId = header !== null && REQUEST_ID.test(header) ? ` (request ${header})` : "";
  if (status === 401 || status === 403) return `HTTP ${status}: ${AUTH_REFUSED_MESSAGE}${requestId}`;
  const error = errorObject(body);
  if (error !== null) {
    const type = typeof error.type === "string" && IDENTIFIER.test(error.type) ? ` ${error.type}` : "";
    const code =
      typeof error.code === "string" && IDENTIFIER.test(error.code) && error.code !== error.type ? ` (code ${error.code})` : "";
    const message = typeof error.message === "string" ? `: ${error.message}` : "";
    return `HTTP ${status}${type}${code}${message}${requestId}`;
  }
  if (body.bytes.byteLength === 0) return `HTTP ${status}${requestId}`;
  const why = body.over ? `longer than ${MAX_OPENAI_ERROR_BODY_BYTES} bytes` : "not a JSON error object";
  return `HTTP ${status} (the error body is ${why} and is not shown)${requestId}`;
}

function transportFor(apiKey: string, settings: ListModelsSettings, deps: ApiProviderDeps, withBody: boolean): Transport {
  return {
    fetch: deps.fetch ?? globalThis.fetch,
    sleep: deps.sleep ?? defaultSleep,
    headers: withBody ? { "content-type": "application/json", authorization: `Bearer ${apiKey}` } : { authorization: `Bearer ${apiKey}` },
    timeoutMs: settings.requestTimeoutMs,
    maxRetries: settings.maxRetries,
    classifyStatus,
    retryAfter: "minimum",
    errorBodyLimit: MAX_OPENAI_ERROR_BODY_BYTES,
    describeError: describeHttpError,
  };
}

// ---------------------------------------------------------------------------------------------
// Provider

export const createOpenAIProvider: CreateApiProvider = (settings: ResolvedApiSettings, deps: ApiProviderDeps = {}): ModelProvider => {
  const url = validateSettings(settings);
  const keyUsable = isUsableApiKey(settings.apiKey);
  const transport = transportFor(settings.apiKey, settings, deps, true);
  const redact = createRedactor(settings.apiKey, KEY_SHAPES);
  /** The responses returned so far, in order (memory only; dropped with this object). */
  const kept: KeptResponse[] = [];

  const fail = (kind: ModelErrorKind, message: string, httpStatus?: number): Failure => ({
    ok: false,
    kind,
    message: redact(message),
    ...(httpStatus === undefined ? {} : { httpStatus }),
  });
  const aborted = (when: string): Failure => fail("aborted", `cancelled ${when}`);

  async function complete(request: ModelRequest, signal: AbortSignal): Promise<ModelOutcome> {
    if (signal.aborted) return aborted("before the request was sent");
    if (!keyUsable) {
      // No position, length or character code: any of them would describe the key.
      return fail("not_configured", UNUSABLE_KEY_MESSAGE);
    }
    const built = buildBody(settings, request, kept);
    if (typeof built === "string") return fail("api_error", `request not sent: ${built}`);

    const sent = await sendWithRetries(transport, { method: "POST", url, body: built.body }, signal);
    if (!sent.ok) return fail(sent.kind, sent.message, sent.httpStatus);
    const parsed = parseResponseBody(sent.text);
    if (!parsed.ok) return fail(parsed.kind, parsed.message);
    if (parsed.kept !== null) kept.push(parsed.kept);
    return { ok: true, response: parsed.response };
  }

  return {
    name: "openai",
    async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelOutcome> {
      try {
        return await complete(request, signal);
      } catch {
        if (signal.aborted) return aborted("during the request");
        // Fixed phrase: the error's text is not copied (S-11).
        return fail("api_error", "unexpected provider failure");
      }
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Model listing

/** A model id as this module accepts it: 1-256 printable ASCII characters, no space. */
const MODEL_ID = /^[\x21-\x7e]{1,256}$/;
/** The latest time a JavaScript date holds, in seconds. */
const MAX_DATE_SECONDS = 8_640_000_000_000;

/** `created` (Unix seconds) as RFC 3339 text, or null. */
function createdAt(value: unknown): string | null {
  if (!isCount(value) || value > MAX_DATE_SECONDS) return null;
  return new Date(value * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

type ModelList = { readonly ok: true; readonly models: readonly ModelInfo[] } | { readonly ok: false; readonly message: string };

/**
 * `{ object: "list", data: [{ id, object, created, owned_by }] }` (facts C-12). The list has no
 * display name, context length or output cap: `displayName` is the id and the token fields are null.
 * Messages are fixed text with positions; no value from the body is quoted.
 */
function parseModelList(text: string, holdsKeyMaterial: (text: string) => boolean): ModelList {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, message: "the body is not JSON" };
  }
  if (!isPlainObject(value)) return { ok: false, message: "the body is not a JSON object" };
  if (!Array.isArray(value.data)) return { ok: false, message: "data is not an array" };
  const models: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.data.entries()) {
    if (!isPlainObject(entry)) return { ok: false, message: `entry ${index} is not an object` };
    const id = entry.id;
    if (typeof id !== "string") return { ok: false, message: `entry ${index} has no string id` };
    if (!MODEL_ID.test(id)) return { ok: false, message: `entry ${index} has an id that is empty, too long or not printable ASCII` };
    if (holdsKeyMaterial(id)) return { ok: false, message: `entry ${index} holds key material` };
    if (seen.has(id)) return { ok: false, message: `entry ${index} repeats an earlier id` };
    seen.add(id);
    models.push({ id, displayName: id, createdAt: createdAt(entry.created), maxInputTokens: null, maxOutputTokens: null });
  }
  return { ok: true, models };
}

/**
 * ListModels for OpenAI: `GET <apiBaseUrl>/models`, models in API order. Same header, time limit,
 * retries, body limits, redirect refusal, error kinds and message redaction as response requests.
 * Never throws.
 * - Invalid settings, or a key outside printable ASCII: `not_configured`, nothing is sent.
 * - A body that is not the documented shape, an entry without a usable string id, an id holding key
 *   material, or an id listed twice: `malformed_response`.
 */
export const listOpenAIModels: ListModels = async (
  settings: ListModelsSettings,
  deps: ApiProviderDeps = {},
  signal: AbortSignal = new AbortController().signal,
): Promise<ListModelsOutcome> => {
  const apiKey = typeof settings?.apiKey === "string" ? settings.apiKey : "";
  const redact = createRedactor(apiKey, KEY_SHAPES);
  const fail = (kind: ModelErrorKind, message: string, httpStatus?: number): ListModelsOutcome => ({
    ok: false,
    kind,
    message: redact(message),
    ...(httpStatus === undefined ? {} : { httpStatus }),
  });

  try {
    let base: string;
    try {
      base = validateConnection(settings, "openai");
    } catch (error) {
      // The checks throw fixed text only; anything else is not quoted.
      const reason = error instanceof TypeError ? error.message.replace(/^openai provider: /, "") : "invalid settings";
      return fail("not_configured", `model listing not started: ${reason}; nothing was sent`);
    }
    if (signal.aborted) return fail("aborted", "cancelled before the request was sent");
    if (!isUsableApiKey(apiKey)) return fail("not_configured", UNUSABLE_KEY_MESSAGE);

    const transport = transportFor(apiKey, settings, deps, false);
    const sent = await sendWithRetries(transport, { method: "GET", url: `${base}${OPENAI_MODELS_PATH}` }, signal);
    if (!sent.ok) return fail(sent.kind, sent.message, sent.httpStatus);
    const parsed = parseModelList(sent.text, createKeyMaterialCheck(apiKey, KEY_SHAPES));
    if (!parsed.ok) return fail("malformed_response", `malformed response: ${parsed.message}`);
    return { ok: true, models: parsed.models };
  } catch {
    if (signal.aborted) return fail("aborted", "cancelled during the request");
    // Fixed phrase: the error's text is not copied (S-11).
    return fail("api_error", "unexpected provider failure");
  }
};
