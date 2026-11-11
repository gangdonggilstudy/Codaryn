/**
 * Anthropic Messages API provider (phase 1b).
 *
 * - Transport is the built-in `fetch` (decision C-7). Both `fetch` and the retry `sleep` are injectable.
 * - The API key goes into the `x-api-key` header only. It never appears in a request body, an outcome
 *   message or a thrown error: every message is cut and has the key, its fragments and key-shaped
 *   strings removed before it leaves this module.
 * - A request carries only what the engine passed in `ModelRequest` (MaskedText) plus the fixed
 *   `TOOL_DEFINITIONS`. Thinking blocks the API returns are not echoed back on later requests.
 */

import {
  ANTHROPIC_KEY_PATTERN_SOURCE,
  MAX_RETRIES_LIMIT,
  TOOL_DEFINITIONS,
} from "../../contracts/index.js";
import type {
  AnthropicProviderDeps,
  CreateAnthropicProvider,
  JsonObject,
  ModelErrorKind,
  ModelMessage,
  ModelOutcome,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStop,
  ModelUsage,
  ResolvedAnthropicSettings,
  ToolCall,
  ToolName,
} from "../../contracts/index.js";

/** Value of the `anthropic-version` header. */
export const ANTHROPIC_API_VERSION = "2026-10-21";
/** Appended to `ResolvedAnthropicSettings.apiBaseUrl`. */
export const ANTHROPIC_MESSAGES_PATH = "/v1/messages";

/** Longest message an outcome carries. */
export const MAX_ERROR_MESSAGE_CHARS = 300;
/** Only this much of an error body is looked at. */
const MAX_ERROR_SOURCE_CHARS = 4096;
/** A run of this many characters that also occurs in the key is removed from messages. */
const KEY_FRAGMENT_CHARS = 8;
const REDACTED = "[redacted]";

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

type Attempt =
  | { readonly type: "done"; readonly outcome: ModelOutcome }
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

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  const causeText = cause instanceof Error ? cause.message : cause === undefined ? "" : String(cause);
  return causeText.length > 0 && causeText !== error.message
    ? `${error.message} (${causeText})`
    : error.message;
}

/** Builds the function every outgoing message passes through. */
function createRedactor(apiKey: string): (text: string) => string {
  const fragments = new Set<string>();
  for (let index = 0; index + KEY_FRAGMENT_CHARS <= apiKey.length; index += 1) {
    fragments.add(apiKey.slice(index, index + KEY_FRAGMENT_CHARS));
  }
  const keyShape = new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE, "g");

  return (input: string): string => {
    let text = input.length > MAX_ERROR_SOURCE_CHARS ? input.slice(0, MAX_ERROR_SOURCE_CHARS) : input;
    text = text.split(apiKey).join(REDACTED);

    if (fragments.size > 0 && text.length >= KEY_FRAGMENT_CHARS) {
      const covered = new Uint8Array(text.length);
      for (let index = 0; index + KEY_FRAGMENT_CHARS <= text.length; index += 1) {
        if (fragments.has(text.slice(index, index + KEY_FRAGMENT_CHARS))) {
          covered.fill(1, index, index + KEY_FRAGMENT_CHARS);
        }
      }
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
      text = out;
    }

    text = text.replace(keyShape, REDACTED);
    text = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
    return text.length > MAX_ERROR_MESSAGE_CHARS
      ? `${text.slice(0, MAX_ERROR_MESSAGE_CHARS - 3)}...`
      : text;
  };
}

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
  return `${settings.apiBaseUrl.replace(/\/+$/, "")}${ANTHROPIC_MESSAGES_PATH}`;
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
  const tools: { name: ToolName; description: string; input_schema: JsonObject }[] = [];
  for (const name of request.tools) {
    const definition = TOOL_DEFINITIONS[name];
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

function describeHttpError(status: number, text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    if (isPlainObject(value) && isPlainObject(value.error)) {
      const type = typeof value.error.type === "string" ? ` ${value.error.type}` : "";
      const message = typeof value.error.message === "string" ? `: ${value.error.message}` : "";
      const requestId =
        typeof value.request_id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value.request_id)
          ? ` (request ${value.request_id})`
          : "";
      return `HTTP ${status}${type}${message}${requestId}`;
    }
  } catch {
    // Not JSON: fall through to the raw text.
  }
  const snippet = text.trim();
  return snippet.length > 0 ? `HTTP ${status}: ${snippet}` : `HTTP ${status}`;
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

export const createAnthropicProvider: CreateAnthropicProvider = (
  settings: ResolvedAnthropicSettings,
  deps: AnthropicProviderDeps = {},
): ModelProvider => {
  const url = validateSettings(settings);
  const doFetch = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const redact = createRedactor(settings.apiKey);
  const headers = {
    "content-type": "application/json",
    "x-api-key": settings.apiKey,
    "anthropic-version": ANTHROPIC_API_VERSION,
  };

  const fail = (kind: ModelErrorKind, message: string): Failure => ({ ok: false, kind, message: redact(message) });
  const aborted = (when: string): Failure => fail("aborted", `cancelled ${when}`);

  async function attemptOnce(body: string, signal: AbortSignal): Promise<Attempt> {
    const controller = new AbortController();
    let timedOut = false;
    const forward = (): void => controller.abort();
    signal.addEventListener("abort", forward, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, settings.requestTimeoutMs);

    const transportFailure = (error: unknown): Attempt => {
      if (signal.aborted) return { type: "aborted" };
      if (timedOut) {
        return {
          type: "failed",
          kind: "timeout",
          message: `the request did not finish within ${settings.requestTimeoutMs} ms`,
          retryable: true,
        };
      }
      return { type: "failed", kind: "api_error", message: `network error: ${describeError(error)}`, retryable: true };
    };

    try {
      let response: Response;
      let text: string;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
          redirect: "manual",
        });
        text = await response.text();
      } catch (error) {
        return transportFailure(error);
      }
      if (signal.aborted) return { type: "aborted" };

      const status = response.status;
      if (status >= 200 && status < 300) return { type: "done", outcome: parseMessageBody(text) };
      if (response.type === "opaqueredirect" || status === 0 || (status >= 300 && status < 400)) {
        return {
          type: "failed",
          kind: "api_error",
          message: `HTTP ${status}: redirects are not followed, so the key is not sent elsewhere`,
          retryable: false,
        };
      }
      const { kind, retryable } = classifyStatus(status);
      const after = retryable ? retryAfterMs(response.headers.get("retry-after"), Date.now()) : undefined;
      return {
        type: "failed",
        kind,
        message: describeHttpError(status, text.slice(0, MAX_ERROR_SOURCE_CHARS)),
        retryable,
        ...(after === undefined ? {} : { retryAfterMs: after }),
      };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", forward);
    }
  }

  async function complete(request: ModelRequest, signal: AbortSignal): Promise<ModelOutcome> {
    if (signal.aborted) return aborted("before the request was sent");
    const built = buildBody(settings, request);
    if (typeof built === "string") return fail("api_error", `request not sent: ${built}`);

    const attempts = settings.maxRetries + 1;
    for (let attempt = 1; ; attempt += 1) {
      const result = await attemptOnce(built.body, signal);
      if (result.type === "aborted") return aborted("while the request was in flight");
      if (result.type === "done") {
        return result.outcome.ok ? result.outcome : fail(result.outcome.kind, result.outcome.message);
      }
      if (!result.retryable || attempt >= attempts) {
        const suffix = attempt > 1 ? ` (after ${attempt} attempts)` : "";
        return fail(result.kind, `${result.message}${suffix}`);
      }
      const delay =
        result.retryAfterMs !== undefined
          ? Math.min(result.retryAfterMs, MAX_RETRY_AFTER_MS)
          : Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
      try {
        await sleep(delay, signal);
      } catch {
        // A sleep that rejects is treated like one that ended early.
      }
      if (signal.aborted) return aborted("while waiting to retry");
    }
  }

  return {
    name: "anthropic",
    async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelOutcome> {
      try {
        return await complete(request, signal);
      } catch (error) {
        if (signal.aborted) return aborted("during the request");
        return fail("api_error", `unexpected provider failure: ${describeError(error)}`);
      }
    },
  };
};
