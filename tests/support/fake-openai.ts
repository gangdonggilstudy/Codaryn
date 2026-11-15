/**
 * Local fake of the OpenAI Responses API for process-level tests of the second provider
 * (docs/design/second-provider.md, DR-31).
 *
 * 모의 API 검증 전용이며 실제 API 검증이 아니다. The server listens on 127.0.0.1 with a random
 * port, answers POST /v1/responses from a script and GET /v1/models from a catalog, and records every
 * request. Shapes follow docs/design/second-provider-facts.md; rules and messages name the item they
 * come from (C-n). Passing against it shows how the CLI talks to a server of that shape, not how
 * the real service behaves.
 *
 * A request that breaks a rule is answered HTTP 400 with an OpenAI error body, recorded with its
 * violations, and uses no script step. Two kinds of rules:
 * - Facts (C-n): method and path, `Authorization: Bearer`, a JSON object with `model`, `input`,
 *   `max_output_tokens` of at least 16 and `store: false`, flat function tools with `strict: false`
 *   and names in ^[a-zA-Z0-9_-]{1,64}$, `function_call_output` items with a `call_id` and a string
 *   `output`, no Chat Completions fields.
 * - The design's expectations, marked DESIGN_RULE: every output item of the previous response sent
 *   back unchanged and in order (SP-D8; reasoning items included), every function_call paired with
 *   one function_call_output by call_id, no other provider's headers, no paging on the models list.
 * The conversation chain (each request starts with the previous request's input and output) is not
 * enforced here; cases assert it with continuationProblems (PM decision on Q-3).
 * Violation messages name fields and positions only, never header or body values.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";
import {
  FAKE_ENCRYPTED_CONTENT,
  MIN_MAX_OUTPUT_TOKENS,
  OPENAI_MODELS_PATH,
  OPENAI_RESPONSES_PATH,
  OPENAI_TOOL_NAME_PATTERN,
  OPENAI_VERSION_PATH,
  RATE_LIMIT_CODE,
  RATE_LIMIT_TYPE,
} from "../fixtures/openai.js";
import type { FakeOpenAIModel, QuotaCase } from "../fixtures/openai.js";
import type { FloodCounter } from "./fake-anthropic.js";
import { decodedSource } from "./leak.js";
import type { TextSource } from "./leak.js";

/** Ends the message of every rule that comes from the design rather than the facts document. */
export const DESIGN_RULE = "(expected by the design)";

type JsonRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// Answers

/** C-9: usage of one response. Cached input is inside input_tokens, reasoning inside output_tokens. */
export interface FakeOpenAIUsage {
  readonly input_tokens: number;
  readonly input_tokens_details: { readonly cached_tokens: number };
  readonly output_tokens: number;
  readonly output_tokens_details: { readonly reasoning_tokens: number };
  readonly total_tokens: number;
}

export type FakeContentPart =
  | { readonly type: "output_text"; readonly text: string; readonly annotations: readonly never[] }
  /** C-15: a refusal is a content part of a message. */
  | { readonly type: "refusal"; readonly refusal: string };

/** C-8, C-11: items of a response's `output`. */
export type FakeOutputItem =
  | {
      readonly type: "function_call";
      readonly id: string;
      readonly call_id: string;
      readonly name: string;
      /** A JSON string. */
      readonly arguments: string;
      readonly status: "completed";
    }
  | {
      readonly type: "message";
      readonly id: string;
      readonly role: "assistant";
      readonly status: "completed";
      readonly content: readonly FakeContentPart[];
    }
  | { readonly type: "reasoning"; readonly id: string; readonly summary: readonly never[]; readonly encrypted_content: string };

export type FakeOpenAIReply =
  | {
      readonly kind: "response";
      /** C-10. `completed` for both a final answer and tool calls (C-10: no finish_reason). */
      readonly status: "completed" | "incomplete" | "failed";
      readonly output: readonly FakeOutputItem[];
      /** `null` leaves `usage` out of the answer. */
      readonly usage: FakeOpenAIUsage | null;
      /** `incomplete_details.reason` when the status is `incomplete` (C-10). */
      readonly incompleteReason?: string;
      /** `error` when the status is `failed` (C-15). */
      readonly error?: { readonly code: string; readonly message: string };
    }
  | {
      readonly kind: "error";
      readonly status: number;
      readonly type: string;
      readonly code: string | null;
      readonly message: string;
      /** Sent as the `retry-after` header, as written (C-6: seconds). */
      readonly retryAfter?: string;
    }
  /** Never answers. Only the client's own time limit or cancel ends the request. */
  | { readonly kind: "hang" }
  /** A response-looking body of `totalBytes` filler bytes, or an endless one (`null`). */
  | { readonly kind: "flood"; readonly status: number; readonly totalBytes: number | null; readonly sent: FloodCounter };

let itemNumber = 0;
function nextItemId(prefix: string): string {
  itemNumber += 1;
  return `${prefix}_fake_${itemNumber}`;
}

export function fakeUsage(input: number, output: number, details: { readonly cached?: number; readonly reasoning?: number } = {}): FakeOpenAIUsage {
  return {
    input_tokens: input,
    input_tokens_details: { cached_tokens: details.cached ?? 0 },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: details.reasoning ?? 0 },
    total_tokens: input + output,
  };
}

export const DEFAULT_OPENAI_USAGE: FakeOpenAIUsage = fakeUsage(100, 20);

/** C-8: a tool call. `args` becomes the `arguments` JSON string. */
export function fnCall(callId: string, name: string, args: Readonly<Record<string, unknown>>): FakeOutputItem {
  return { type: "function_call", id: nextItemId("fc"), call_id: callId, name, arguments: JSON.stringify(args), status: "completed" };
}

export function outputMessage(text: string): FakeOutputItem {
  return { type: "message", id: nextItemId("msg"), role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
}

/** C-15: a message whose content is a refusal part. */
export function refusalMessage(text: string): FakeOutputItem {
  return { type: "message", id: nextItemId("msg"), role: "assistant", status: "completed", content: [{ type: "refusal", refusal: text }] };
}

/** C-11: a reasoning item with opaque `encrypted_content` and no readable text. */
export function reasoningItem(encrypted: string = FAKE_ENCRYPTED_CONTENT): FakeOutputItem {
  return { type: "reasoning", id: nextItemId("rs"), summary: [], encrypted_content: encrypted };
}

export function replyOutput(output: readonly FakeOutputItem[], usage: FakeOpenAIUsage | null = DEFAULT_OPENAI_USAGE): FakeOpenAIReply {
  return { kind: "response", status: "completed", output, usage };
}

/** Tool calls, after `reasoning` reasoning items (C-11). */
export function replyCalls(
  calls: readonly FakeOutputItem[],
  options: { readonly reasoning?: number; readonly usage?: FakeOpenAIUsage | null } = {},
): FakeOpenAIReply {
  const reasoning = Array.from({ length: options.reasoning ?? 0 }, () => reasoningItem());
  return replyOutput([...reasoning, ...calls], options.usage === undefined ? DEFAULT_OPENAI_USAGE : options.usage);
}

export function replyFinal(text: string, usage: FakeOpenAIUsage | null = DEFAULT_OPENAI_USAGE): FakeOpenAIReply {
  return replyOutput([outputMessage(text)], usage);
}

export function replyRefusal(text: string, usage: FakeOpenAIUsage | null = DEFAULT_OPENAI_USAGE): FakeOpenAIReply {
  return replyOutput([refusalMessage(text)], usage);
}

/** C-10: `status: "incomplete"` with this reason (for example max_output_tokens, content_filter). */
export function replyIncomplete(
  reason: string,
  output: readonly FakeOutputItem[] = [],
  usage: FakeOpenAIUsage | null = DEFAULT_OPENAI_USAGE,
): FakeOpenAIReply {
  return { kind: "response", status: "incomplete", output, usage, incompleteReason: reason };
}

/** C-15: `status: "failed"` with `error { code, message }`. */
export function replyFailed(code: string, message: string, usage: FakeOpenAIUsage | null = null): FakeOpenAIReply {
  return { kind: "response", status: "failed", output: [], usage, error: { code, message } };
}

/** C-5: an error status with `{ "error": { message, type, code, param } }`. */
export function replyOpenAIError(
  status: number,
  type: string,
  code: string | null = null,
  options: { readonly retryAfter?: string; readonly message?: string } = {},
): FakeOpenAIReply {
  return {
    kind: "error",
    status,
    type,
    code,
    message: options.message ?? `fake ${type}`,
    ...(options.retryAfter === undefined ? {} : { retryAfter: options.retryAfter }),
  };
}

/** C-5: a 429 that can be retried, with code `slow_down` or (withCode false) without a code. */
export function replyRateLimit(options: { readonly retryAfter?: string; readonly withCode?: boolean } = {}): FakeOpenAIReply {
  return replyOpenAIError(429, RATE_LIMIT_TYPE, options.withCode === false ? null : RATE_LIMIT_CODE, {
    ...(options.retryAfter === undefined ? {} : { retryAfter: options.retryAfter }),
  });
}

/** C-5, SP-D7: a 429 that retrying does not fix. */
export function replyQuota(quota: QuotaCase): FakeOpenAIReply {
  return replyOpenAIError(429, quota.type, quota.code);
}

export const OPENAI_HANG: FakeOpenAIReply = { kind: "hang" };

/** A body of `totalBytes` filler (`null`: endless). Read `sent` after the run. */
export function replyOpenAIFlood(status: number, totalBytes: number | null): { reply: FakeOpenAIReply; sent: FloodCounter } {
  const sent: FloodCounter = { bytes: 0, closedEarly: false };
  return { reply: { kind: "flood", status, totalBytes, sent }, sent };
}

export function repeatOpenAIReply(reply: FakeOpenAIReply, count: number): FakeOpenAIReply[] {
  return Array.from({ length: count }, () => reply);
}

// ---------------------------------------------------------------------------------------------
// Recording

export type OpenAIEndpoint = "responses" | "models" | "other";

/**
 * scripted: answered from the script (a response or a scripted error) or the catalog.
 * violation: the request broke a rule and got HTTP 400 (or 404 for an unknown path).
 * exhausted: no script step or catalog was left and the request got HTTP 400 (models: 404).
 */
export type OpenAIRequestOutcome = "scripted" | "violation" | "exhausted";

export interface OpenAIRequest {
  /** 1-based arrival order. */
  readonly index: number;
  readonly endpoint: OpenAIEndpoint;
  readonly method: string;
  /** As sent, query string included. */
  readonly path: string;
  /** Lowercase names. Repeated headers are joined with ", ". */
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
  /** Parsed body, or `null` when it is not JSON. */
  readonly body: unknown;
  /** `performance.now()` when the whole request had arrived. */
  readonly receivedAtMs: number;
  readonly outcome: OpenAIRequestOutcome;
  readonly violations: readonly string[];
  /** The `output` items of the answer when it was a response, else `null`. */
  readonly answeredOutput: readonly FakeOutputItem[] | null;
}

export interface FakeOpenAI {
  /** `http://127.0.0.1:<port>`, without a trailing slash. */
  readonly url: string;
  /** `<url>/v1`: the base address a CLI setting names (C-4). */
  readonly baseUrl: string;
  readonly requests: readonly OpenAIRequest[];
  close(): Promise<void>;
}

/** C-12: the models list. `failWith` answers every list request with that error instead. */
export interface FakeOpenAIModelsCatalog {
  readonly models: readonly FakeOpenAIModel[];
  readonly malformed?: "data_not_list" | "id_not_string";
  readonly failWith?: { readonly status: number; readonly type: string; readonly code: string | null };
}

export interface FakeOpenAIOptions {
  /** Without a catalog, GET /v1/models is answered 404 and recorded as `exhausted`. */
  readonly models?: FakeOpenAIModelsCatalog;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function headerMap(request: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

/** JSON with object keys sorted, so two values compare equal whatever their key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function pathOnly(path: string): string {
  const query = path.indexOf("?");
  return query === -1 ? path : path.slice(0, query);
}

function endpointOf(path: string): OpenAIEndpoint {
  const bare = pathOnly(path);
  if (bare === OPENAI_RESPONSES_PATH) return "responses";
  if (bare === OPENAI_MODELS_PATH) return "models";
  return "other";
}

// ---------------------------------------------------------------------------------------------
// Rules

const OTHER_PROVIDER_HEADERS = ["x-api-key", "anthropic-version"] as const;
/** Design 5: the optional organization and project headers are not sent at first. */
const OPTIONAL_HEADERS = ["openai-organization", "openai-project"] as const;
const MESSAGE_ROLES = ["user", "assistant", "system", "developer"];

function authViolations(headers: Readonly<Record<string, string>>): string[] {
  const out: string[] = [];
  if (!/^Bearer \S+$/.test(headers["authorization"] ?? "")) out.push('authorization is not "Bearer <key>" (C-2)');
  for (const name of [...OTHER_PROVIDER_HEADERS, ...OPTIONAL_HEADERS]) {
    if (name in headers) out.push(`${name} header is sent ${DESIGN_RULE}`);
  }
  return out;
}

function toolViolations(tools: unknown): string[] {
  if (tools === undefined) return [];
  if (!Array.isArray(tools)) return ["tools is not a list (C-7)"];
  const out: string[] = [];
  const names = new Set<string>();
  tools.forEach((tool, index) => {
    const at = `tools[${index}]`;
    if (!isRecord(tool)) {
      out.push(`${at} is not an object`);
      return;
    }
    if (tool["type"] !== "function") out.push(`${at}.type is not "function" (C-7)`);
    if ("function" in tool) out.push(`${at} wraps its definition in "function", the Chat Completions shape (C-7)`);
    const name = tool["name"];
    if (typeof name !== "string" || !OPENAI_TOOL_NAME_PATTERN.test(name)) out.push(`${at}.name is missing or outside ^[a-zA-Z0-9_-]{1,64}$ (C-7)`);
    else if (names.has(name)) out.push(`${at}.name is repeated`);
    else names.add(name);
    if ("description" in tool && typeof tool["description"] !== "string") out.push(`${at}.description is not a string`);
    const parameters = tool["parameters"];
    if (!isRecord(parameters) || parameters["type"] !== "object") out.push(`${at}.parameters is not an object schema (C-7)`);
    if (tool["strict"] !== false) out.push(`${at}.strict is not false (C-7: left out means strict; SP-D6)`);
  });
  return out;
}

function contentViolations(content: unknown, at: string): string[] {
  if (typeof content === "string") return [];
  if (!Array.isArray(content) || content.length === 0) return [`${at}.content is neither text nor a list of parts`];
  return content.flatMap((part, index) => (isRecord(part) && typeof part["type"] === "string" ? [] : [`${at}.content[${index}] has no type`]));
}

function inputItemViolations(input: readonly unknown[]): string[] {
  const out: string[] = [];
  input.forEach((item, index) => {
    const at = `input[${index}]`;
    if (!isRecord(item)) {
      out.push(`${at} is not an object`);
      return;
    }
    const type = item["type"];
    if (type === "function_call_output") {
      if (typeof item["call_id"] !== "string" || item["call_id"] === "") out.push(`${at}.call_id is missing (C-8)`);
      if (typeof item["output"] !== "string") out.push(`${at}.output is not a string (C-8)`);
    } else if (type === "function_call") {
      if (typeof item["call_id"] !== "string" || typeof item["name"] !== "string" || typeof item["arguments"] !== "string") {
        out.push(`${at} function_call needs a string call_id, name and arguments (C-8)`);
      }
    } else if (type === "reasoning") {
      if (typeof item["encrypted_content"] !== "string") out.push(`${at} reasoning item has no encrypted_content (C-11)`);
    } else if (type === undefined || type === "message") {
      if (!MESSAGE_ROLES.includes(String(item["role"]))) out.push(`${at}.role is not a message role`);
      out.push(...contentViolations(item["content"], at));
    } else {
      out.push(`${at}.type is not a message, function_call, function_call_output or reasoning item ${DESIGN_RULE}`);
    }
  });
  return out;
}

function typeOf(item: unknown): unknown {
  return isRecord(item) ? item["type"] : undefined;
}

/** A conversation's first request carries nothing the model produced (no call, reasoning or reply). */
function startsConversation(input: readonly unknown[]): boolean {
  return !input.some((item) => {
    const type = typeOf(item);
    if (type === "function_call" || type === "function_call_output" || type === "reasoning") return true;
    return isRecord(item) && item["role"] === "assistant";
  });
}

function containsInOrder(input: readonly unknown[], items: readonly unknown[]): boolean {
  if (items.length === 0) return true;
  const have = input.map(canonical);
  const want = items.map(canonical);
  for (let start = 0; start + want.length <= have.length; start += 1) {
    if (want.every((item, offset) => have[start + offset] === item)) return true;
  }
  return false;
}

function designViolations(input: readonly unknown[], previousOutput: readonly FakeOutputItem[] | null): string[] {
  const out: string[] = [];
  if (previousOutput !== null && !startsConversation(input) && !containsInOrder(input, previousOutput)) {
    out.push(`input does not carry every output item of the previous response, unchanged and in order (C-11, SP-D8) ${DESIGN_RULE}`);
  }
  const asked = new Set<string>();
  const answered = new Set<string>();
  input.forEach((item, index) => {
    if (!isRecord(item) || typeof item["call_id"] !== "string") return;
    const callId = item["call_id"];
    if (item["type"] === "function_call") {
      if (asked.has(callId)) out.push(`input[${index}] repeats an earlier function_call's call_id ${DESIGN_RULE}`);
      asked.add(callId);
    } else if (item["type"] === "function_call_output") {
      if (!asked.has(callId)) out.push(`input[${index}] function_call_output has no earlier function_call with that call_id (C-8) ${DESIGN_RULE}`);
      else if (answered.has(callId)) out.push(`input[${index}] answers a function_call a second time ${DESIGN_RULE}`);
      answered.add(callId);
    }
  });
  const open = [...asked].filter((callId) => !answered.has(callId)).length;
  if (open > 0) out.push(`input has ${open} function_call(s) without a function_call_output (C-8) ${DESIGN_RULE}`);
  return out;
}

/** Problems of one POST /v1/responses request, facts first. */
export function responsesViolations(
  method: string,
  path: string,
  headers: Readonly<Record<string, string>>,
  body: unknown,
  previousOutput: readonly FakeOutputItem[] | null = null,
): string[] {
  const out: string[] = [];
  if (method !== "POST") out.push("method is not POST (C-1)");
  if (pathOnly(path) !== OPENAI_RESPONSES_PATH) out.push(`path is not ${OPENAI_RESPONSES_PATH} (C-1, C-4)`);
  if (path.includes("?")) out.push(`the request has a query string ${DESIGN_RULE}`);
  out.push(...authViolations(headers));
  if (!(headers["content-type"] ?? "").toLowerCase().includes("application/json")) out.push("content-type is not application/json");
  if (!isRecord(body)) {
    out.push("body is not a JSON object");
    return out;
  }
  const model = body["model"];
  if (typeof model !== "string" || model === "") out.push("model is missing");
  const input = body["input"];
  if (!Array.isArray(input)) out.push("input is not a list (C-8)");
  if ("instructions" in body && typeof body["instructions"] !== "string") out.push("instructions is not a string");
  const maxOutput = body["max_output_tokens"];
  if (typeof maxOutput !== "number" || !Number.isInteger(maxOutput) || maxOutput < MIN_MAX_OUTPUT_TOKENS) {
    out.push(`max_output_tokens is missing, not an integer or below ${MIN_MAX_OUTPUT_TOKENS} (C-10)`);
  }
  if (body["store"] !== false) out.push("store is not false (C-11: left out, responses are stored for 30 days)");
  if ("messages" in body) out.push("messages is sent, a Chat Completions field (C-1)");
  if ("previous_response_id" in body) out.push("previous_response_id is sent while nothing is stored (C-11)");
  if ("stream" in body && body["stream"] !== false) out.push(`stream is not false ${DESIGN_RULE}`);
  out.push(...toolViolations(body["tools"]));
  if (Array.isArray(input)) {
    out.push(...inputItemViolations(input));
    out.push(...designViolations(input, previousOutput));
  }
  return out;
}

/** Problems of one GET /v1/models request (C-12). */
export function openAIModelsViolations(method: string, path: string, headers: Readonly<Record<string, string>>, bodyText: string): string[] {
  const out: string[] = [];
  if (method !== "GET") out.push("method is not GET (C-12)");
  if (pathOnly(path) !== OPENAI_MODELS_PATH) out.push(`path is not ${OPENAI_MODELS_PATH} (C-12)`);
  if (path.includes("?")) out.push(`the models request has a query string; the list has no paging parameters (C-12) ${DESIGN_RULE}`);
  out.push(...authViolations(headers));
  if (bodyText !== "") out.push("a GET request has a body");
  return out;
}

// ---------------------------------------------------------------------------------------------
// Server

function errorBody(type: string, code: string | null, message: string): JsonRecord {
  return { error: { message, type, code, param: null } };
}

function baseHeaders(index: number): Record<string, string> {
  return { "content-type": "application/json", "x-request-id": `req_fake_${index}`, "x-ratelimit-remaining-requests": "99" };
}

const FLOOD_CHUNK = Buffer.alloc(64 * 1024, "x");

function writeFlood(response: ServerResponse, reply: Extract<FakeOpenAIReply, { kind: "flood" }>, index: number, hanging: Set<ServerResponse>): void {
  const { sent, totalBytes } = reply;
  let finished = false;
  hanging.add(response);
  response.on("close", () => {
    hanging.delete(response);
    if (!finished) sent.closedEarly = true;
  });
  response.writeHead(reply.status, baseHeaders(index));
  const head = Buffer.from('{"id":"resp_flood","object":"response","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"', "utf8");
  response.write(head);
  sent.bytes += head.length;
  const pump = (): void => {
    while (!response.destroyed) {
      if (totalBytes !== null && sent.bytes >= totalBytes) {
        finished = true;
        response.end('"}]}]}');
        return;
      }
      const ok = response.write(FLOOD_CHUNK);
      sent.bytes += FLOOD_CHUNK.length;
      if (!ok) {
        response.once("drain", pump);
        return;
      }
    }
  };
  pump();
}

function answer(response: ServerResponse, reply: FakeOpenAIReply, index: number, model: string, hanging: Set<ServerResponse>): void {
  switch (reply.kind) {
    case "response": {
      const body: JsonRecord = {
        id: `resp_fake_${index}`,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        model,
        status: reply.status,
        output: reply.output,
        ...(reply.usage === null ? {} : { usage: reply.usage }),
        incomplete_details: reply.status === "incomplete" ? { reason: reply.incompleteReason ?? "max_output_tokens" } : null,
        error: reply.status === "failed" ? (reply.error ?? { code: "server_error", message: "fake failure" }) : null,
      };
      response.writeHead(200, baseHeaders(index));
      response.end(JSON.stringify(body));
      return;
    }
    case "error":
      response.writeHead(reply.status, { ...baseHeaders(index), ...(reply.retryAfter === undefined ? {} : { "retry-after": reply.retryAfter }) });
      response.end(JSON.stringify(errorBody(reply.type, reply.code, reply.message)));
      return;
    case "hang":
      hanging.add(response);
      response.on("close", () => hanging.delete(response));
      return;
    case "flood":
      writeFlood(response, reply, index, hanging);
      return;
  }
}

function modelsAnswer(catalog: FakeOpenAIModelsCatalog): { status: number; body: unknown } {
  if (catalog.failWith !== undefined) {
    const { status, type, code } = catalog.failWith;
    return { status, body: errorBody(type, code, `fake ${type}`) };
  }
  if (catalog.malformed === "data_not_list") return { status: 200, body: { object: "list", data: {} } };
  const data = catalog.models.map((model, position) => ({
    id: catalog.malformed === "id_not_string" && position === 0 ? 42 : model.id,
    object: "model",
    created: model.created,
    owned_by: model.owned_by,
    ...(model.shutdown_date === undefined ? {} : { shutdown_date: model.shutdown_date }),
  }));
  return { status: 200, body: { object: "list", data } };
}

export async function startFakeOpenAI(t: TestContext, steps: readonly FakeOpenAIReply[], options: FakeOpenAIOptions = {}): Promise<FakeOpenAI> {
  const requests: OpenAIRequest[] = [];
  const hanging = new Set<ServerResponse>();
  let nextStep = 0;
  let previousOutput: readonly FakeOutputItem[] | null = null;

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const receivedAtMs = performance.now();
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = parseJson(bodyText);
      const headers = headerMap(request);
      const method = request.method ?? "";
      const path = request.url ?? "";
      const index = requests.length + 1;
      const endpoint = endpointOf(path);
      const record = (outcome: OpenAIRequestOutcome, violations: readonly string[], answeredOutput: readonly FakeOutputItem[] | null): void => {
        requests.push({ index, endpoint, method, path, headers, bodyText, body, receivedAtMs, outcome, violations, answeredOutput });
      };

      if (endpoint === "other") {
        record("violation", [`path is neither ${OPENAI_RESPONSES_PATH} nor ${OPENAI_MODELS_PATH}`], null);
        response.writeHead(404, baseHeaders(index));
        response.end(JSON.stringify(errorBody("invalid_request_error", null, "fake server: unknown path")));
        return;
      }

      if (endpoint === "models") {
        const violations = openAIModelsViolations(method, path, headers, bodyText);
        const catalog = options.models;
        const outcome: OpenAIRequestOutcome = violations.length > 0 ? "violation" : catalog === undefined ? "exhausted" : "scripted";
        record(outcome, violations, null);
        const reply =
          outcome === "violation"
            ? { status: 400, body: errorBody("invalid_request_error", null, `fake server: ${violations.join("; ")}`) }
            : catalog === undefined
              ? { status: 404, body: errorBody("invalid_request_error", null, "fake server: no models catalog") }
              : modelsAnswer(catalog);
        response.writeHead(reply.status, baseHeaders(index));
        response.end(JSON.stringify(reply.body));
        return;
      }

      const violations = responsesViolations(method, path, headers, body, previousOutput);
      const step = steps[nextStep];
      let outcome: OpenAIRequestOutcome;
      let reply: FakeOpenAIReply;
      if (violations.length > 0) {
        outcome = "violation";
        reply = replyOpenAIError(400, "invalid_request_error", null, { message: `fake server: ${violations.join("; ")}` });
      } else if (step === undefined) {
        outcome = "exhausted";
        reply = replyOpenAIError(400, "invalid_request_error", null, { message: "fake server: no scripted answer left" });
      } else {
        outcome = "scripted";
        reply = step;
        nextStep += 1;
      }
      const answeredOutput = outcome === "scripted" && reply.kind === "response" ? reply.output : null;
      if (answeredOutput !== null) previousOutput = answeredOutput;
      record(outcome, violations, answeredOutput);
      const model = isRecord(body) && typeof body["model"] === "string" ? body["model"] : "unknown";
      answer(response, reply, index, model, hanging);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    for (const response of hanging) response.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  t.after(close);
  const url = `http://127.0.0.1:${port}`;
  return { url, baseUrl: `${url}${OPENAI_VERSION_PATH}`, requests, close };
}

// ---------------------------------------------------------------------------------------------
// Reading what was sent

export function responsesRequests(api: FakeOpenAI): OpenAIRequest[] {
  return api.requests.filter((request) => request.endpoint === "responses");
}

export function openAIModelsRequests(api: FakeOpenAI): OpenAIRequest[] {
  return api.requests.filter((request) => request.endpoint === "models");
}

export function openAIBodyOf(request: OpenAIRequest): JsonRecord {
  if (!isRecord(request.body)) assert.fail(`request ${request.index} has no JSON object body`);
  return request.body;
}

export function inputItemsOf(request: OpenAIRequest): JsonRecord[] {
  const input = openAIBodyOf(request)["input"];
  assert.ok(Array.isArray(input), `request ${request.index}: input must be a list`);
  return input.map((item, index) => {
    assert.ok(isRecord(item), `request ${request.index}: input[${index}] must be an object`);
    return item;
  });
}

/** `function_call_output` items of the request, in order. */
export function functionCallOutputsOf(request: OpenAIRequest): { readonly callId: string; readonly output: string }[] {
  return inputItemsOf(request)
    .filter((item) => item["type"] === "function_call_output")
    .map((item) => ({ callId: String(item["call_id"]), output: String(item["output"]) }));
}

export function toolNamesOf(request: OpenAIRequest): string[] {
  const tools = openAIBodyOf(request)["tools"];
  return Array.isArray(tools) ? tools.map((tool) => (isRecord(tool) ? String(tool["name"]) : "")) : [];
}

/** The key part of each `Authorization: Bearer <key>` header, in arrival order. */
export function bearerKeysOf(api: FakeOpenAI): string[] {
  return api.requests.map((request) => (request.headers["authorization"] ?? "").replace(/^Bearer /, ""));
}

/** Milliseconds between consecutive POST /v1/responses requests, as the server saw them. */
export function responsesGapsMs(api: FakeOpenAI): number[] {
  const times = responsesRequests(api).map((request) => request.receivedAtMs);
  return times.slice(1).map((time, index) => time - (times[index] ?? time));
}

/**
 * The conversation chain (design 4.10: nothing is stored, so every request sends the whole
 * conversation): a request that continues a conversation starts with the input of the latest
 * request answered with a response, followed by that response's output items. Retries of a
 * request carry the same prefix. Requests refused as violations are left out (assertOpenAIProtocolClean
 * reports them). Returns one line per broken link.
 */
export function continuationProblems(api: FakeOpenAI): string[] {
  const problems: string[] = [];
  let previous: OpenAIRequest | null = null;
  for (const request of responsesRequests(api).filter((one) => one.outcome !== "violation")) {
    const body = request.body;
    const input = isRecord(body) && Array.isArray(body["input"]) ? (body["input"] as unknown[]) : null;
    if (input === null) continue;
    if (previous !== null && !startsConversation(input)) {
      const before = isRecord(previous.body) && Array.isArray(previous.body["input"]) ? (previous.body["input"] as unknown[]) : [];
      const expected = [...before, ...(previous.answeredOutput ?? [])].map(canonical);
      const actual = input.map(canonical);
      if (actual.length < expected.length || expected.some((item, position) => actual[position] !== item)) {
        problems.push(`request ${request.index} does not start with request ${previous.index}'s input and the output it was answered with`);
      }
    }
    if (request.answeredOutput !== null) previous = request;
  }
  return problems;
}

export function assertContinuation(api: FakeOpenAI): void {
  assert.deepEqual(continuationProblems(api), [], "each request must carry the whole conversation so far (store: false)");
}

/** Every request followed the rules and stayed within the script and catalog. */
export function assertOpenAIProtocolClean(api: FakeOpenAI): void {
  const problems = api.requests
    .filter((request) => request.outcome !== "scripted")
    .map((request) => `request ${request.index}: ${request.outcome} ${request.violations.join("; ")}`);
  assert.deepEqual(problems, [], "every request must follow the Responses API rules and stay within the script");
}

/** Bodies as sent and fully decoded, for leak scans. */
export function openAIBodySources(api: FakeOpenAI): TextSource[] {
  return api.requests.flatMap((request) => [
    { label: `request ${request.index} body`, text: request.bodyText },
    decodedSource(`request ${request.index} body`, request.bodyText, false),
  ]);
}

/** Header values other than `authorization`, and the request paths, for leak scans. */
export function openAIOtherHeaderSources(api: FakeOpenAI): TextSource[] {
  return api.requests.flatMap((request) => [
    { label: `request ${request.index} path`, text: request.path },
    ...Object.entries(request.headers)
      .filter(([name]) => name !== "authorization")
      .map(([name, value]) => ({ label: `request ${request.index} header ${name}`, text: value })),
  ]);
}
