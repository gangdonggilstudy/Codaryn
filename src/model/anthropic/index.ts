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
 * Review fixes (decisions S-10 to S-12, 2026-11-12), carried out by the shared transport since SP-3
 * (`../http/index.ts`):
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

import {
  AUTH_REFUSED_MESSAGE,
  createKeyMaterialCheck,
  createRedactor,
  decoder,
  defaultSleep,
  isPlainObject,
  isUsableApiKey,
  MAX_ERROR_BODY_BYTES,
  sendWithRetries,
  UNUSABLE_KEY_MESSAGE,
  validateConnection,
} from "../http/index.js";
import type { Failure, LimitedBody, Transport } from "../http/index.js";

/** SP-3: kept here for the importers of this module; they live in the shared transport now. */
export { isUsableApiKey, MAX_ERROR_BODY_BYTES, MAX_ERROR_MESSAGE_CHARS, MAX_SUCCESS_BODY_BYTES } from "../http/index.js";

/** The key shapes the Anthropic adapter removes from messages and refuses in listed values. */
const ANTHROPIC_KEY_SHAPES: readonly string[] = [ANTHROPIC_KEY_PATTERN_SOURCE];

/** Value of the `anthropic-version` header. */
export const ANTHROPIC_API_VERSION = "2026-10-21";
/** Appended to `ResolvedAnthropicSettings.apiBaseUrl`. */
export const ANTHROPIC_MESSAGES_PATH = "/v1/messages";
/** Models API list path (Y-1), appended to `AnthropicListSettings.apiBaseUrl`. */
export const ANTHROPIC_MODELS_PATH = "/v1/models";

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

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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
  return `${validateConnection(settings, "anthropic")}${ANTHROPIC_MESSAGES_PATH}`;
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
  // G-A, GT-E1: task type tools follow the built-in ones. Absent or empty: the body is exactly as
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

/** ` (request <id>)` for a well-formed `request_id` of a whole JSON body, else nothing. */
function requestIdOf(body: LimitedBody): string {
  if (body.over) return "";
  try {
    const value: unknown = JSON.parse(decoder.decode(body.bytes));
    return isPlainObject(value) && typeof value.request_id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value.request_id)
      ? ` (request ${value.request_id})`
      : "";
  } catch {
    return "";
  }
}

/**
 * Describes an error response. Only a JSON error object is quoted: its `error.type` (when it is a
 * plain identifier), its `error.message` and a well-formed request id. Any other body (HTML from a
 * proxy, plain text, a body cut at the limit) is not quoted at all.
 * DR-37 (a): a 401 or 403 quotes nothing of the body (neither its message nor its error type), only
 * AUTH_REFUSED_MESSAGE and the request id, as for OpenAI (DR-35 (a)).
 */
function describeHttpError(status: number, body: LimitedBody): string {
  if (status === 401 || status === 403) return `HTTP ${status}: ${AUTH_REFUSED_MESSAGE}${requestIdOf(body)}`;
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
    classifyStatus,
    describeError: describeHttpError,
  };
  const redact = createRedactor(settings.apiKey, ANTHROPIC_KEY_SHAPES);

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
    const built = buildBody(settings, request);
    if (typeof built === "string") return fail("api_error", `request not sent: ${built}`);

    const sent = await sendWithRetries(transport, { method: "POST", url, body: built.body }, signal);
    if (!sent.ok) return fail(sent.kind, sent.message, sent.httpStatus);
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
  const redact = createRedactor(apiKey, ANTHROPIC_KEY_SHAPES);
  const fail = (kind: ModelErrorKind, message: string, httpStatus?: number): ListModelsOutcome => ({
    ok: false,
    kind,
    message: redact(message),
    ...(httpStatus === undefined ? {} : { httpStatus }),
  });

  try {
    let base: string;
    try {
      base = validateConnection(settings, "anthropic");
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
      classifyStatus,
      describeError: describeHttpError,
    };
    const holdsKeyMaterial = createKeyMaterialCheck(apiKey, ANTHROPIC_KEY_SHAPES);
    const models: ModelInfo[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;

    for (let pageNumber = 1; pageNumber <= MAX_MODEL_LIST_PAGES; pageNumber += 1) {
      const where = pageNumber > 1 ? ` (page ${pageNumber})` : "";
      const query = `?limit=${MODEL_LIST_PAGE_SIZE}${cursor === null ? "" : `&after_id=${encodeURIComponent(cursor)}`}`;
      const sent = await sendWithRetries(transport, { method: "GET", url: `${base}${ANTHROPIC_MODELS_PATH}${query}` }, signal);
      if (!sent.ok) return fail(sent.kind, `${sent.message}${where}`, sent.httpStatus);

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
