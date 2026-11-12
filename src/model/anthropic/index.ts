/**
 * Anthropic Messages API provider (phase 1b).
 *
 * - Transport is the built-in `fetch` (decision C-7). Both `fetch` and the retry `sleep` are injectable.
 * - The API key goes into the `x-api-key` header only. It never appears in a request body, an outcome
 *   message or a thrown error: every message is cut and has the key, its fragments and key-shaped
 *   strings removed before it leaves this module.
 * - A request carries only what the engine passed in `ModelRequest` (MaskedText) plus the fixed
 *   `TOOL_DEFINITIONS` and, for `ModelRequest.workflowTools` (G-A), `WORKFLOW_TOOL_DEFINITIONS`
 *   after them. Thinking blocks the API returns are not echoed back on later requests.
 *
 * Review fixes (decisions S-10 to S-12, 2026-11-12):
 * - Bodies are read as a byte stream and the read stops at a limit: 8 MiB for a success body
 *   (more is `malformed_response`), 4096 bytes for an error body. Nothing past the limit is buffered.
 * - A key outside printable ASCII (0x21-0x7E) is refused before any request (`not_configured`).
 * - A transport error is a connection failure only when its cause carries a known connection code;
 *   such failures are retried. Any other `TypeError` from fetch is a format error and is not retried.
 *   No text of a transport error is copied into a message, only fixed phrases and allowlisted codes.
 * - Before key fragments are removed, control characters and white space are ignored, so a key split
 *   by line breaks or spaces is still found. A body that is not a JSON error object is not quoted.
 *
 * Model listing (Y-1): `listAnthropicModels` reads every page of `GET /v1/models` through the same
 * transport (headers, time limit, retries, body limits, redirect refusal, error kinds, redaction).
 */

import {
  ANTHROPIC_KEY_PATTERN_SOURCE,
  MAX_MODEL_LIST_PAGES,
  MAX_RETRIES_LIMIT,
  TOOL_DEFINITIONS,
  WORKFLOW_TOOL_DEFINITIONS,
} from "../../contracts/index.js";
import type {
  AnyToolName,
  AnthropicListSettings,
  AnthropicProviderDeps,
  CreateAnthropicProvider,
  JsonObject,
  ListAnthropicModels,
  ListModelsOutcome,
  ModelErrorKind,
  ModelInfo,
  ModelMessage,
  ModelOutcome,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStop,
  ModelUsage,
  ResolvedAnthropicSettings,
  ToolCall,
} from "../../contracts/index.js";

/** Value of the `anthropic-version` header. */
export const ANTHROPIC_API_VERSION = "2026-10-21";
/** Appended to `ResolvedAnthropicSettings.apiBaseUrl`. */
export const ANTHROPIC_MESSAGES_PATH = "/v1/messages";
/** Models API list path (Y-1), appended to `AnthropicListSettings.apiBaseUrl`. */
export const ANTHROPIC_MODELS_PATH = "/v1/models";

/** Longest message an outcome carries. */
export const MAX_ERROR_MESSAGE_CHARS = 300;
/** A success body larger than this is `malformed_response`. The read stops at the limit. */
export const MAX_SUCCESS_BODY_BYTES = 8 * 1024 * 1024;
/** Only this much of an error body is read. */
export const MAX_ERROR_BODY_BYTES = 4096;
/** Only this much of any text is looked at before it becomes a message. */
const MAX_ERROR_SOURCE_CHARS = 4096;
/** A run of this many characters that also occurs in the key is removed from messages. */
const KEY_FRAGMENT_CHARS = 8;
const REDACTED = "[redacted]";

/** One character that separates nothing in a key: control characters, white space, invisible marks. */
const SEPARATOR = /[\s\u0000-\u001f\u007f-\u009f​-‍⁠﻿]/;
const SEPARATOR_RUN = /[\s\u0000-\u001f\u007f-\u009f​-‍⁠﻿]+/g;

/** A key may hold printable ASCII only (0x21-0x7E): no space, no control or non-ASCII character. */
const USABLE_KEY = /^[\x21-\x7e]+$/;

/** True when `apiKey` can be sent in a header as is. The CLI may call this before building a provider. */
export function isUsableApiKey(apiKey: string): boolean {
  return USABLE_KEY.test(apiKey);
}

/** Cause codes of Node's fetch that mean the connection failed. These attempts are retried. */
const CONNECTION_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
]);
/** Cause codes that mean the TLS handshake or certificate check failed. Not retried. */
const TLS_CODE = /^(CERT_[A-Z_]{1,40}|ERR_TLS_[A-Z_]{1,40}|ERR_SSL_[A-Z_]{1,40}|UNABLE_TO_[A-Z_]{1,40}|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN)$/;

type TransportError =
  | { readonly kind: "connection"; readonly code: string }
  | { readonly kind: "tls"; readonly code: string }
  | { readonly kind: "format" }
  | { readonly kind: "unknown" };

function causeCode(error: unknown): string | null {
  const cause = (error as { cause?: unknown } | null)?.cause;
  const code = (cause as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : null;
}

/**
 * Connection and format errors both arrive as `TypeError` (often "fetch failed"). Only the cause's
 * code tells them apart: a known connection code is a connection failure; any other `TypeError`
 * (invalid header, ByteString conversion, invalid URL, blocked port) is a format error.
 */
function classifyTransportError(error: unknown): TransportError {
  const code = causeCode(error);
  if (code !== null && CONNECTION_CODES.has(code)) return { kind: "connection", code };
  if (code !== null && TLS_CODE.test(code)) return { kind: "tls", code };
  if (error instanceof TypeError) return { kind: "format" };
  return { kind: "unknown" };
}

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;
const MAX_RETRY_AFTER_MS = 60_000;

/** Stop reasons of the Messages API and what the engine sees. `refusal` is handled separately. */
const STOP_MAP: { readonly [reason: string]: ModelStop } = {
  end_turn: "final",
  stop_sequence: "final",
  tool_use: "tool_calls",
  max_tokens: "length",
  model_context_window_exceeded: "length",
};

type ApiBlock = { readonly type: string } & { readonly [field: string]: unknown };

interface ApiMessage {
  readonly role: "user" | "assistant";
  readonly content: ApiBlock[];
}

type Failure = { readonly ok: false; readonly kind: ModelErrorKind; readonly message: string };

/**
 * One HTTP attempt. `body`: a 2xx body read within MAX_SUCCESS_BODY_BYTES, for the caller to parse.
 * `final`: an end that is neither retried nor counted in the message (an oversized success body).
 */
type Attempt =
  | { readonly type: "body"; readonly text: string }
  | { readonly type: "final"; readonly kind: ModelErrorKind; readonly message: string }
  | { readonly type: "aborted" }
  | {
      readonly type: "failed";
      readonly kind: ModelErrorKind;
      readonly message: string;
      readonly retryable: boolean;
      readonly retryAfterMs?: number;
    };

function isPlainObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Builds the function every outgoing message passes through.
 *
 * Matching runs on a compact view of the text with every separator (control character, white space,
 * invisible mark) left out, so a key split by line breaks or spaces is still found. A match marks
 * the original range it spans, separators included. Only then are separator runs turned into one space.
 */
function createRedactor(apiKey: string): (text: string) => string {
  const fragments = new Set<string>();
  for (let index = 0; index + KEY_FRAGMENT_CHARS <= apiKey.length; index += 1) {
    fragments.add(apiKey.slice(index, index + KEY_FRAGMENT_CHARS));
  }
  const keyShape = new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE, "g");

  return (input: string): string => {
    const text = input.length > MAX_ERROR_SOURCE_CHARS ? input.slice(0, MAX_ERROR_SOURCE_CHARS) : input;

    // Compact view: kept characters and where each one sits in `text`.
    const positions: number[] = [];
    let compact = "";
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index] as string;
      if (SEPARATOR.test(char)) continue;
      positions.push(index);
      compact += char;
    }

    const covered = new Uint8Array(text.length);
    const cover = (start: number, length: number): void => {
      const from = positions[start];
      const to = positions[start + length - 1];
      if (from !== undefined && to !== undefined) covered.fill(1, from, to + 1);
    };
    for (let at = compact.indexOf(apiKey); apiKey.length > 0 && at !== -1; at = compact.indexOf(apiKey, at + 1)) {
      cover(at, apiKey.length);
    }
    for (let index = 0; fragments.size > 0 && index + KEY_FRAGMENT_CHARS <= compact.length; index += 1) {
      if (fragments.has(compact.slice(index, index + KEY_FRAGMENT_CHARS))) cover(index, KEY_FRAGMENT_CHARS);
    }
    for (const match of compact.matchAll(keyShape)) cover(match.index, match[0].length);

    let out = "";
    let index = 0;
    while (index < text.length) {
      if (covered[index] === 1) {
        out += REDACTED;
        while (index < text.length && covered[index] === 1) index += 1;
      } else {
        out += text[index];
        index += 1;
      }
    }

    out = out.replace(SEPARATOR_RUN, " ").trim();
    return out.length > MAX_ERROR_MESSAGE_CHARS ? `${out.slice(0, MAX_ERROR_MESSAGE_CHARS - 3)}...` : out;
  };
}

/** Result of reading a body up to a byte limit. */
interface LimitedBody {
  readonly bytes: Uint8Array;
  /** True when the body had more bytes than the limit. The rest was neither read nor kept. */
  readonly over: boolean;
}

/**
 * Reads at most `limit` bytes of the body, then cancels the stream so the transfer stops.
 * A body that is `null` (no content) is empty. A response without a readable body throws.
 */
async function readLimited(response: Response, limit: number): Promise<LimitedBody> {
  const stream = response.body;
  if (stream === null) return { bytes: new Uint8Array(0), over: false };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let over = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = limit - size;
    if (value.byteLength > room) {
      if (room > 0) chunks.push(value.subarray(0, room));
      size += Math.max(room, 0);
      over = true;
      // Stop the transfer. Waiting for the cancellation is not needed and could hang.
      reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  return { bytes: Buffer.concat(chunks, size), over };
}

/** Lets go of a body that will not be read. */
function discardBody(response: Response): void {
  try {
    response.body?.cancel().catch(() => undefined);
  } catch {
    // A locked or broken body is left to the garbage collector.
  }
}

const decoder = new TextDecoder("utf-8");

function validateSettings(settings: ResolvedAnthropicSettings): string {
  if (typeof settings.apiKey !== "string" || settings.apiKey.length === 0) {
    throw new TypeError("anthropic provider: apiKey must be a non-empty string");
  }
  if (typeof settings.model !== "string" || settings.model.trim().length === 0) {
    throw new TypeError("anthropic provider: model must be a non-empty string");
  }
  if (!Number.isSafeInteger(settings.maxOutputTokens) || settings.maxOutputTokens <= 0) {
    throw new TypeError("anthropic provider: maxOutputTokens must be a positive integer");
  }
  return `${validateConnection(settings)}${ANTHROPIC_MESSAGES_PATH}`;
}

/**
 * Checks shared by Messages requests and model listing: the key is a non-empty string, the time
 * limit and retry count are in range, and the base URL is https (http for a loopback host only)
 * without credentials, a query or a fragment. Returns the base URL without a trailing slash.
 * Messages are fixed text: they never carry a value from the settings.
 */
function validateConnection(settings: AnthropicListSettings): string {
  if (typeof settings.apiKey !== "string" || settings.apiKey.length === 0) {
    throw new TypeError("anthropic provider: apiKey must be a non-empty string");
  }
  if (!Number.isSafeInteger(settings.requestTimeoutMs) || settings.requestTimeoutMs <= 0) {
    throw new TypeError("anthropic provider: requestTimeoutMs must be a positive integer");
  }
  if (
    !Number.isSafeInteger(settings.maxRetries) ||
    settings.maxRetries < 0 ||
    settings.maxRetries > MAX_RETRIES_LIMIT
  ) {
    throw new TypeError(`anthropic provider: maxRetries must be an integer from 0 to ${MAX_RETRIES_LIMIT}`);
  }
  let base: URL;
  try {
    base = new URL(settings.apiBaseUrl);
  } catch {
    throw new TypeError("anthropic provider: apiBaseUrl is not a valid URL");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (!(base.protocol === "https:" || (base.protocol === "http:" && loopback))) {
    throw new TypeError("anthropic provider: apiBaseUrl must use https (http only for a loopback host)");
  }
  if (base.username !== "" || base.password !== "" || base.search !== "" || base.hash !== "") {
    throw new TypeError("anthropic provider: apiBaseUrl must not carry credentials, a query or a fragment");
  }
  return settings.apiBaseUrl.replace(/\/+$/, "");
}

function toolUseInput(argsJson: string): JsonObject | null {
  try {
    const value: unknown = JSON.parse(argsJson);
    return isPlainObject(value) ? (value as JsonObject) : null;
  } catch {
    return null;
  }
}

function blocksOf(message: ModelMessage): { role: "user" | "assistant"; blocks: ApiBlock[] } | string {
  switch (message.role) {
    case "user":
      return { role: "user", blocks: message.content.length > 0 ? [{ type: "text", text: message.content }] : [] };
    case "assistant": {
      const blocks: ApiBlock[] = [];
      if (message.text.length > 0) blocks.push({ type: "text", text: message.text });
      for (const call of message.toolCalls) {
        const input = toolUseInput(call.argsJson);
        if (input === null) return `tool call ${JSON.stringify(call.id)} has arguments that are not a JSON object`;
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input });
      }
      return { role: "assistant", blocks };
    }
    case "tool":
      return {
        role: "user",
        blocks: message.results.map((result) => ({
          type: "tool_result",
          tool_use_id: result.callId,
          content: result.content,
          is_error: !result.ok,
        })),
      };
  }
}

/** Serializes the request once. Every attempt sends exactly these bytes. */
function buildBody(settings: ResolvedAnthropicSettings, request: ModelRequest): { body: string } | string {
  const messages: ApiMessage[] = [];
  for (const message of request.messages) {
    const converted = blocksOf(message);
    if (typeof converted === "string") return converted;
    if (converted.blocks.length === 0) continue;
    const previous = messages[messages.length - 1];
    // Consecutive messages of one role are sent as one message, blocks kept in order.
    if (previous !== undefined && previous.role === converted.role) {
      previous.content.push(...converted.blocks);
    } else {
      messages.push({ role: converted.role, content: converted.blocks });
    }
  }

  const seen = new Set<string>();
  const tools: { name: AnyToolName; description: string; input_schema: JsonObject }[] = [];
  for (const name of request.tools) {
    const definition = TOOL_DEFINITIONS[name];
    if (definition === undefined) return `tool ${JSON.stringify(String(name))} has no definition`;
    if (seen.has(name)) continue;
    seen.add(name);
    tools.push({ name, description: definition.description, input_schema: definition.inputSchema });
  }
  // G-A, GT-E1: workflow tools follow the built-in ones. Absent or empty: the body is exactly as
  // before stage 4 (pinned by tests/unit/model/anthropic/g-workflow-tools.test.ts).
  for (const name of request.workflowTools ?? []) {
    const definition = Object.hasOwn(WORKFLOW_TOOL_DEFINITIONS, name) ? WORKFLOW_TOOL_DEFINITIONS[name] : undefined;
    if (definition === undefined) return `tool ${JSON.stringify(String(name))} has no definition`;
    if (seen.has(name)) continue;
    seen.add(name);
    tools.push({ name, description: definition.description, input_schema: definition.inputSchema });
  }

  const body: { [field: string]: unknown } = {
    model: settings.model,
    max_tokens: settings.maxOutputTokens,
  };
  if (request.system.length > 0) body.system = request.system;
  body.messages = messages;
  if (tools.length > 0) body.tools = tools;
  return { body: JSON.stringify(body) };
}

function parseUsage(value: unknown): ModelUsage | null {
  if (!isPlainObject(value)) return null;
  const { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } = value;
  if (!isCount(input_tokens) || !isCount(output_tokens)) return null;
  let inputTokens = input_tokens;
  for (const extra of [cache_creation_input_tokens, cache_read_input_tokens]) {
    if (extra === undefined || extra === null) continue;
    if (!isCount(extra)) return null;
    inputTokens += extra;
  }
  return { inputTokens, outputTokens: output_tokens };
}

function malformed(message: string): Failure {
  return { ok: false, kind: "malformed_response", message: `malformed response: ${message}` };
}

/** Turns a 2xx body into a response. Unknown structure is `malformed_response`. */
function parseMessageBody(text: string): ModelOutcome {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return malformed("the body is not JSON");
  }
  if (!isPlainObject(value)) return malformed("the body is not a JSON object");
  if (value.type !== "message") return malformed("the body is not a message object");

  const reason = value.stop_reason;
  if (reason === "refusal") {
    return { ok: false, kind: "api_error", message: "the model declined the request (stop_reason refusal)" };
  }
  if (typeof reason !== "string" || !Object.hasOwn(STOP_MAP, reason)) {
    return malformed(`unexpected stop_reason ${typeof reason === "string" ? JSON.stringify(reason.slice(0, 40)) : String(reason)}`);
  }
  const stop = STOP_MAP[reason] as ModelStop;

  if (!Array.isArray(value.content)) return malformed("content is not an array");
  const texts: string[] = [];
  const toolCalls: ToolCall[] = [];
  const ids = new Set<string>();
  for (const [index, block] of value.content.entries()) {
    if (!isPlainObject(block) || typeof block.type !== "string") {
      return malformed(`content block ${index} has no type`);
    }
    switch (block.type) {
      case "text":
        if (typeof block.text !== "string") return malformed(`text block ${index} has no text`);
        texts.push(block.text);
        break;
      case "tool_use": {
        const { id, name, input } = block;
        if (typeof id !== "string" || id.length === 0) return malformed(`tool_use block ${index} has no id`);
        if (typeof name !== "string" || name.length === 0) return malformed(`tool_use block ${index} has no name`);
        if (!isPlainObject(input)) return malformed(`tool_use block ${index} input is not an object`);
        if (ids.has(id)) return malformed(`tool_use id ${JSON.stringify(id)} appears twice`);
        ids.add(id);
        // Unregistered names are passed through: the engine decides (unknown_tool).
        toolCalls.push({ id, name, args: input as JsonObject });
        break;
      }
      case "thinking":
        if (typeof block.thinking !== "string") return malformed(`thinking block ${index} has no thinking text`);
        break;
      case "redacted_thinking":
        if (typeof block.data !== "string") return malformed(`redacted_thinking block ${index} has no data`);
        break;
      default:
        return malformed(`unexpected content block type ${JSON.stringify(block.type.slice(0, 40))}`);
    }
  }
  if (stop === "tool_calls" && toolCalls.length === 0) {
    return malformed("stop_reason tool_use without a tool_use block");
  }

  const response: ModelResponse = {
    stop,
    text: texts.join(""),
    toolCalls,
    usage: parseUsage(value.usage),
  };
  return { ok: true, response };
}

function retryAfterMs(header: string | null, now: number): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * Describes an error response. Only a JSON error object is quoted: its `error.type` (when it is a
 * plain identifier), its `error.message` and a well-formed request id. Any other body (HTML from a
 * proxy, plain text, a body cut at the limit) is not quoted at all.
 */
function describeHttpError(status: number, body: LimitedBody): string {
  if (!body.over) {
    try {
      const value: unknown = JSON.parse(decoder.decode(body.bytes));
      if (isPlainObject(value) && isPlainObject(value.error)) {
        const type =
          typeof value.error.type === "string" && /^[A-Za-z0-9_]{1,64}$/.test(value.error.type)
            ? ` ${value.error.type}`
            : "";
        const message = typeof value.error.message === "string" ? `: ${value.error.message}` : "";
        const requestId =
          typeof value.request_id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value.request_id)
            ? ` (request ${value.request_id})`
            : "";
        return `HTTP ${status}${type}${message}${requestId}`;
      }
    } catch {
      // Not JSON: not quoted.
    }
  }
  if (body.bytes.byteLength === 0) return `HTTP ${status}`;
  const why = body.over ? `longer than ${MAX_ERROR_BODY_BYTES} bytes` : "not a JSON error object";
  return `HTTP ${status} (the error body is ${why} and is not shown)`;
}

function classifyStatus(status: number): { kind: ModelErrorKind; retryable: boolean } {
  if (status === 401 || status === 403) return { kind: "auth_failed", retryable: false };
  if (status === 429) return { kind: "rate_limited", retryable: true };
  if (status === 529 || status === 503) return { kind: "overloaded", retryable: true };
  if (status === 408 || status === 409 || status >= 500) return { kind: "api_error", retryable: true };
  return { kind: "api_error", retryable: false };
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** What one HTTP exchange needs. Shared by Messages requests and model listing. */
interface Transport {
  readonly fetch: typeof fetch;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** `x-api-key` and `anthropic-version`, plus `content-type` for a request with a body. */
  readonly headers: { readonly [name: string]: string };
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

interface HttpRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  /** Sent exactly as given on every attempt. Absent for GET. */
  readonly body?: string;
}

/** A request that ended: the 2xx body, or a failure whose message is not yet redacted. */
type Sent = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly kind: ModelErrorKind; readonly message: string };

/**
 * One attempt: the request time limit, no redirects (the key is not sent elsewhere), the body read
 * within its byte limit, the status classified. Transport errors become fixed phrases (S-12).
 */
async function attemptOnce(transport: Transport, request: HttpRequest, signal: AbortSignal): Promise<Attempt> {
  const controller = new AbortController();
  let timedOut = false;
  const forward = (): void => controller.abort();
  signal.addEventListener("abort", forward, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, transport.timeoutMs);

  /** `stage` says whether the request was being sent or its response body read. */
  const transportFailure = (error: unknown, stage: "send" | "read"): Attempt => {
    if (signal.aborted) return { type: "aborted" };
    if (timedOut) {
      return {
        type: "failed",
        kind: "timeout",
        message: `the request did not finish within ${transport.timeoutMs} ms`,
        retryable: true,
      };
    }
    // Fixed phrases only: the error's own text may hold a header value or a character code.
    const failure = classifyTransportError(error);
    switch (failure.kind) {
      case "connection":
        return { type: "failed", kind: "api_error", message: `network error: connection failed (${failure.code})`, retryable: true };
      case "tls":
        return { type: "failed", kind: "api_error", message: `network error: TLS connection failed (${failure.code})`, retryable: false };
      case "format":
        return {
          type: "failed",
          kind: "api_error",
          message:
            stage === "send"
              ? "the transport refused the request format (header, URL or port); nothing was sent"
              : "the response body could not be read",
          retryable: false,
        };
      case "unknown":
        return { type: "failed", kind: "api_error", message: "network error: unknown transport failure", retryable: false };
    }
  };

  try {
    let response: Response;
    try {
      response = await transport.fetch(request.url, {
        method: request.method,
        headers: transport.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: controller.signal,
        redirect: "manual",
      });
    } catch (error) {
      return transportFailure(error, "send");
    }
    if (signal.aborted) {
      discardBody(response);
      return { type: "aborted" };
    }

    const status = response.status;
    const success = status >= 200 && status < 300;
    if (!success && (response.type === "opaqueredirect" || status === 0 || (status >= 300 && status < 400))) {
      discardBody(response);
      return {
        type: "failed",
        kind: "api_error",
        message: `HTTP ${status}: redirects are not followed, so the key is not sent elsewhere`,
        retryable: false,
      };
    }

    let read: LimitedBody;
    try {
      read = await readLimited(response, success ? MAX_SUCCESS_BODY_BYTES : MAX_ERROR_BODY_BYTES);
    } catch (error) {
      return transportFailure(error, "read");
    }
    if (signal.aborted) return { type: "aborted" };

    if (success) {
      if (read.over) {
        const failure = malformed(`the response body is larger than ${MAX_SUCCESS_BODY_BYTES} bytes`);
        return { type: "final", kind: failure.kind, message: failure.message };
      }
      return { type: "body", text: decoder.decode(read.bytes) };
    }
    const { kind, retryable } = classifyStatus(status);
    const after = retryable ? retryAfterMs(response.headers.get("retry-after"), Date.now()) : undefined;
    return {
      type: "failed",
      kind,
      message: describeHttpError(status, read),
      retryable,
      ...(after === undefined ? {} : { retryAfterMs: after }),
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", forward);
  }
}

/** Attempts until a body, a final failure, or the retries (`maxRetries`) are used up. */
async function sendWithRetries(transport: Transport, request: HttpRequest, signal: AbortSignal): Promise<Sent> {
  const attempts = transport.maxRetries + 1;
  for (let attempt = 1; ; attempt += 1) {
    const result = await attemptOnce(transport, request, signal);
    if (result.type === "aborted") return { ok: false, kind: "aborted", message: "cancelled while the request was in flight" };
    if (result.type === "body") return { ok: true, text: result.text };
    if (result.type === "final") return { ok: false, kind: result.kind, message: result.message };
    if (!result.retryable || attempt >= attempts) {
      const suffix = attempt > 1 ? ` (after ${attempt} attempts)` : "";
      return { ok: false, kind: result.kind, message: `${result.message}${suffix}` };
    }
    const delay =
      result.retryAfterMs !== undefined
        ? Math.min(result.retryAfterMs, MAX_RETRY_AFTER_MS)
        : Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
    try {
      await transport.sleep(delay, signal);
    } catch {
      // A sleep that rejects is treated like one that ended early.
    }
    if (signal.aborted) return { ok: false, kind: "aborted", message: "cancelled while waiting to retry" };
  }
}

const UNUSABLE_KEY_MESSAGE =
  "the API key may hold printable ASCII characters only (0x21-0x7E, no spaces); nothing was sent";

export const createAnthropicProvider: CreateAnthropicProvider = (
  settings: ResolvedAnthropicSettings,
  deps: AnthropicProviderDeps = {},
): ModelProvider => {
  const url = validateSettings(settings);
  const keyUsable = isUsableApiKey(settings.apiKey);
  const transport: Transport = {
    fetch: deps.fetch ?? globalThis.fetch,
    sleep: deps.sleep ?? defaultSleep,
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    timeoutMs: settings.requestTimeoutMs,
    maxRetries: settings.maxRetries,
  };
  const redact = createRedactor(settings.apiKey);

  const fail = (kind: ModelErrorKind, message: string): Failure => ({ ok: false, kind, message: redact(message) });
  const aborted = (when: string): Failure => fail("aborted", `cancelled ${when}`);

  async function complete(request: ModelRequest, signal: AbortSignal): Promise<ModelOutcome> {
    if (signal.aborted) return aborted("before the request was sent");
    if (!keyUsable) {
      // No position, length or character code: any of them would describe the key.
      return fail("not_configured", UNUSABLE_KEY_MESSAGE);
    }
    const built = buildBody(settings, request);
    if (typeof built === "string") return fail("api_error", `request not sent: ${built}`);

    const sent = await sendWithRetries(transport, { method: "POST", url, body: built.body }, signal);
    if (!sent.ok) return fail(sent.kind, sent.message);
    const outcome = parseMessageBody(sent.text);
    return outcome.ok ? outcome : fail(outcome.kind, outcome.message);
  }

  return {
    name: "anthropic",
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
// Model listing (Y-1)

/** Models per page asked of `GET /v1/models` (the API allows 1 to 1000). */
export const MODEL_LIST_PAGE_SIZE = 1000;

/**
 * A model id or a list cursor as this module accepts it: 1-256 printable ASCII characters, no
 * space. The id is written into a config file and shown in a terminal; a cursor goes into a URL.
 */
const MODEL_ID = /^[\x21-\x7e]{1,256}$/;

/**
 * True when `text` holds the key, a run of KEY_FRAGMENT_CHARS characters of it, or a key-shaped
 * string, ignoring separators as the redactor does. Used to refuse values from a response that
 * would carry key material out of this module.
 */
function createKeyMaterialCheck(apiKey: string): (text: string) => boolean {
  const fragments = new Set<string>();
  for (let index = 0; index + KEY_FRAGMENT_CHARS <= apiKey.length; index += 1) {
    fragments.add(apiKey.slice(index, index + KEY_FRAGMENT_CHARS));
  }
  const keyShape = new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE);
  return (text: string): boolean => {
    const compact = text.replace(SEPARATOR_RUN, "");
    if (apiKey.length > 0 && compact.includes(apiKey)) return true;
    for (let index = 0; fragments.size > 0 && index + KEY_FRAGMENT_CHARS <= compact.length; index += 1) {
      if (fragments.has(compact.slice(index, index + KEY_FRAGMENT_CHARS))) return true;
    }
    return keyShape.test(compact);
  };
}

function positiveCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

type ModelPage =
  | { readonly ok: true; readonly models: readonly ModelInfo[]; readonly hasMore: boolean; readonly lastId: string | null }
  | { readonly ok: false; readonly message: string };

/**
 * One page of `GET /v1/models`: `{ data: Model[], has_more, first_id, last_id }`. Only the fields
 * of ModelInfo are kept. Messages are fixed text with positions; no value from the body is quoted.
 */
function parseModelPage(text: string, holdsKeyMaterial: (text: string) => boolean): ModelPage {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, message: "the body is not JSON" };
  }
  if (!isPlainObject(value)) return { ok: false, message: "the body is not a JSON object" };
  if (!Array.isArray(value.data)) return { ok: false, message: "data is not an array" };
  if (typeof value.has_more !== "boolean") return { ok: false, message: "has_more is not a boolean" };

  const models: ModelInfo[] = [];
  for (const [index, entry] of value.data.entries()) {
    if (!isPlainObject(entry)) return { ok: false, message: `entry ${index} is not an object` };
    const id = entry.id;
    if (typeof id !== "string") return { ok: false, message: `entry ${index} has no string id` };
    if (!MODEL_ID.test(id)) {
      return { ok: false, message: `entry ${index} has an id that is empty, too long or not printable ASCII` };
    }
    const displayName = typeof entry.display_name === "string" ? entry.display_name : id;
    const createdAt = typeof entry.created_at === "string" ? entry.created_at : null;
    if ([id, displayName, createdAt ?? ""].some(holdsKeyMaterial)) {
      return { ok: false, message: `entry ${index} holds key material` };
    }
    models.push({
      id,
      displayName,
      createdAt,
      maxInputTokens: positiveCount(entry.max_input_tokens),
      maxOutputTokens: positiveCount(entry.max_tokens),
    });
  }

  if (!value.has_more) return { ok: true, models, hasMore: false, lastId: null };
  const lastId = value.last_id;
  if (typeof lastId !== "string" || !MODEL_ID.test(lastId) || holdsKeyMaterial(lastId)) {
    return { ok: false, message: "has_more is true but last_id is not a usable cursor" };
  }
  return { ok: true, models, hasMore: true, lastId };
}

/**
 * `ListAnthropicModels` (Y-1, docs/cli-contract.md 16): every page of `GET <apiBaseUrl>/v1/models`,
 * joined in API order. Same headers, time limit per request, retries, body limits, redirect refusal,
 * error kinds and message redaction as Messages requests. Never throws.
 * - Invalid settings, or a key outside printable ASCII: `not_configured`, nothing is sent.
 * - More than MAX_MODEL_LIST_PAGES pages: `api_error`.
 * - A page that is not the documented shape, an entry without a usable string id, a value holding
 *   key material, a cursor that does not advance, or an id listed twice: `malformed_response`.
 */
export const listAnthropicModels: ListAnthropicModels = async (
  settings: AnthropicListSettings,
  deps: AnthropicProviderDeps = {},
  signal: AbortSignal = new AbortController().signal,
): Promise<ListModelsOutcome> => {
  const apiKey = typeof settings?.apiKey === "string" ? settings.apiKey : "";
  const redact = createRedactor(apiKey);
  const fail = (kind: ModelErrorKind, message: string): ListModelsOutcome => ({ ok: false, kind, message: redact(message) });

  try {
    let base: string;
    try {
      base = validateConnection(settings);
    } catch (error) {
      // The checks throw fixed text only; anything else is not quoted.
      const reason = error instanceof TypeError ? error.message.replace(/^anthropic provider: /, "") : "invalid settings";
      return fail("not_configured", `model listing not started: ${reason}; nothing was sent`);
    }
    if (signal.aborted) return fail("aborted", "cancelled before the request was sent");
    if (!isUsableApiKey(apiKey)) return fail("not_configured", UNUSABLE_KEY_MESSAGE);

    const transport: Transport = {
      fetch: deps.fetch ?? globalThis.fetch,
      sleep: deps.sleep ?? defaultSleep,
      headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_API_VERSION },
      timeoutMs: settings.requestTimeoutMs,
      maxRetries: settings.maxRetries,
    };
    const holdsKeyMaterial = createKeyMaterialCheck(apiKey);
    const models: ModelInfo[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;

    for (let pageNumber = 1; pageNumber <= MAX_MODEL_LIST_PAGES; pageNumber += 1) {
      const where = pageNumber > 1 ? ` (page ${pageNumber})` : "";
      const query = `?limit=${MODEL_LIST_PAGE_SIZE}${cursor === null ? "" : `&after_id=${encodeURIComponent(cursor)}`}`;
      const sent = await sendWithRetries(transport, { method: "GET", url: `${base}${ANTHROPIC_MODELS_PATH}${query}` }, signal);
      if (!sent.ok) return fail(sent.kind, `${sent.message}${where}`);

      const parsed = parseModelPage(sent.text, holdsKeyMaterial);
      if (!parsed.ok) return fail("malformed_response", `malformed response: ${parsed.message}${where}`);
      for (const [index, info] of parsed.models.entries()) {
        if (seen.has(info.id)) return fail("malformed_response", `malformed response: entry ${index} repeats an earlier id${where}`);
        seen.add(info.id);
        models.push(info);
      }
      if (!parsed.hasMore) return { ok: true, models };
      if (parsed.lastId === cursor) return fail("malformed_response", `malformed response: the list cursor did not advance${where}`);
      cursor = parsed.lastId;
    }
    return fail("api_error", `the model list has more than ${MAX_MODEL_LIST_PAGES} pages; stopped without a result`);
  } catch {
    if (signal.aborted) return fail("aborted", "cancelled during the request");
    // Fixed phrase: the error's text is not copied (S-11).
    return fail("api_error", "unexpected provider failure");
  }
};
