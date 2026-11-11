/**
 * Local fake of the Anthropic Messages API for process-level tests.
 *
 * 모의 API 검증 전용이며 실제 API 검증이 아니다. The server listens on 127.0.0.1 with a random
 * port, answers POST /v1/messages from a script and records every request (method, path,
 * headers, body). Passing against it shows how the CLI talks to a server shaped like the
 * Messages API. It says nothing about the real service, its limits or its exact error texts.
 *
 * Requests are checked against rules the real API also applies (required headers, a positive
 * `max_tokens`, non-empty text blocks, tool_use/tool_result pairing, the last message from the
 * user). A request that breaks one is answered with HTTP 400 `invalid_request_error` and
 * recorded with its violations. The rules are an approximation written for these tests.
 *
 * Both answer forms are supported: a JSON message, or server-sent events when the body has
 * `stream: true`.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { TOOL_DEFINITIONS, TOOL_NAMES } from "../../src/contracts/index.js";
import type { ToolName } from "../../src/contracts/index.js";
import type { Sandbox } from "../fixtures/builders.js";
import { startCli } from "./cli.js";
import type { CliRun } from "./cli.js";
import { decodedSource, stateRecordTexts } from "./leak.js";
import type { TextSource } from "./leak.js";

/** Prefix of every mock API test name. */
export const MOCK_LABEL = "[모의 API·실제 API 아님]";

export const MESSAGES_PATH = "/v1/messages";

export interface FakeUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
}

export type FakeBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: Readonly<Record<string, unknown>>;
    };

export type FakeReply =
  | {
      readonly kind: "message";
      readonly content: readonly FakeBlock[];
      /** Defaults to "tool_use" when a tool_use block is present, otherwise "end_turn". */
      readonly stopReason?: string;
      /** `null` leaves `usage` out of the answer. */
      readonly usage: FakeUsage | null;
    }
  | {
      readonly kind: "error";
      readonly status: number;
      readonly errorType: string;
      /** Sent as the `retry-after` header when set. */
      readonly retryAfterSeconds?: number;
    }
  /** Never answers. Only the client's own time limit ends the request. */
  | { readonly kind: "hang" }
  /**
   * Streams a JSON-looking body of `totalBytes` filler bytes, or one that never ends (`null`),
   * honouring backpressure. `sent` counts what the connection accepted before the client hung up.
   */
  | { readonly kind: "flood"; readonly status: number; readonly totalBytes: number | null; readonly sent: FloodCounter };

export interface FloodCounter {
  /** Bytes the server handed to the connection. */
  bytes: number;
  /** True when the client closed the connection before the body ended. */
  closedEarly: boolean;
}

/**
 * scripted: answered with the next script step (which may itself be an error).
 * violation: the request broke a protocol rule and got HTTP 400. No step was used.
 * exhausted: the script had no step left and the request got HTTP 400.
 */
export type RequestOutcome = "scripted" | "violation" | "exhausted";

export interface RecordedRequest {
  /** 1-based arrival order. */
  readonly index: number;
  readonly method: string;
  readonly path: string;
  /** Lowercase names. Repeated headers are joined with ", ". */
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
  /** Parsed body, or `null` when it is not JSON. */
  readonly body: unknown;
  readonly streamed: boolean;
  readonly outcome: RequestOutcome;
  readonly violations: readonly string[];
}

export interface FakeAnthropic {
  /** `http://127.0.0.1:<port>`, without a trailing slash. */
  readonly url: string;
  readonly requests: readonly RecordedRequest[];
  close(): Promise<void>;
}

export const DEFAULT_USAGE: FakeUsage = { input_tokens: 100, output_tokens: 20 };

export function text(value: string): FakeBlock {
  return { type: "text", text: value };
}

export function toolUse(id: string, name: string, input: Readonly<Record<string, unknown>>): FakeBlock {
  return { type: "tool_use", id, name, input };
}

/** An answer that asks for tools (stop_reason "tool_use"). */
export function replyTools(blocks: readonly FakeBlock[], usage: FakeUsage | null = DEFAULT_USAGE): FakeReply {
  return { kind: "message", content: blocks, usage };
}

/** A final text answer (stop_reason "end_turn"). */
export function replyText(value: string, usage: FakeUsage | null = DEFAULT_USAGE): FakeReply {
  return { kind: "message", content: [text(value)], usage };
}

export function replyError(status: number, errorType: string, retryAfterSeconds?: number): FakeReply {
  return retryAfterSeconds === undefined
    ? { kind: "error", status, errorType }
    : { kind: "error", status, errorType, retryAfterSeconds };
}

export const HANG: FakeReply = { kind: "hang" };

/** A body of `totalBytes` filler (`null`: endless). Read `sent` after the run. */
export function replyFlood(status: number, totalBytes: number | null): { reply: FakeReply; sent: FloodCounter } {
  const sent: FloodCounter = { bytes: 0, closedEarly: false };
  return { reply: { kind: "flood", status, totalBytes, sent }, sent };
}

const FLOOD_CHUNK = Buffer.alloc(64 * 1024, "x");

function writeFlood(response: ServerResponse, reply: Extract<FakeReply, { kind: "flood" }>, hanging: Set<ServerResponse>): void {
  const { sent, totalBytes } = reply;
  let finished = false;
  hanging.add(response);
  response.on("close", () => {
    hanging.delete(response);
    if (!finished) sent.closedEarly = true;
  });
  response.writeHead(reply.status, { "content-type": "application/json" });
  const head = Buffer.from('{"type":"message","content":[{"type":"text","text":"', "utf8");
  response.write(head);
  sent.bytes += head.length;
  const pump = (): void => {
    while (!response.destroyed) {
      if (totalBytes !== null && sent.bytes >= totalBytes) {
        finished = true;
        response.end('"}]}');
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

export function repeatReply(reply: FakeReply, count: number): FakeReply[] {
  return Array.from({ length: count }, () => reply);
}

type JsonRecord = Record<string, unknown>;

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

/** Content blocks of a message; a string content counts as one text block. */
function blocksOf(message: JsonRecord): unknown[] | null {
  const content = message["content"];
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : null;
}

function idsOf(message: unknown, type: "tool_use" | "tool_result"): string[] {
  if (!isRecord(message)) return [];
  const field = type === "tool_use" ? "id" : "tool_use_id";
  return (blocksOf(message) ?? [])
    .filter((block): block is JsonRecord => isRecord(block) && block["type"] === type)
    .map((block) => String(block[field]));
}

function toolViolations(tools: unknown): string[] {
  if (tools === undefined) return [];
  if (!Array.isArray(tools)) return ["tools is not a list"];
  const out: string[] = [];
  const names = new Set<string>();
  tools.forEach((tool, index) => {
    if (!isRecord(tool)) {
      out.push(`tools[${index}] is not an object`);
      return;
    }
    const name = tool["name"];
    if (typeof name !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) out.push(`tools[${index}].name is invalid`);
    else if (names.has(name)) out.push(`tools[${index}].name is repeated`);
    else names.add(name);
    const schema = tool["input_schema"];
    if (!isRecord(schema) || schema["type"] !== "object") out.push(`tools[${index}].input_schema is not an object schema`);
  });
  return out;
}

function blockViolations(role: string, blocks: readonly unknown[], at: string): string[] {
  const out: string[] = [];
  let otherContentSeen = false;
  blocks.forEach((block, index) => {
    const where = `${at}.content[${index}]`;
    if (!isRecord(block) || typeof block["type"] !== "string") {
      out.push(`${where} is not a content block`);
      return;
    }
    switch (block["type"]) {
      case "text":
        if (typeof block["text"] !== "string" || block["text"].trim() === "") out.push(`${where} is an empty text block`);
        otherContentSeen = true;
        break;
      case "tool_use":
        if (role !== "assistant") out.push(`${where} is a tool_use outside an assistant message`);
        if (typeof block["id"] !== "string" || typeof block["name"] !== "string" || !isRecord(block["input"])) {
          out.push(`${where} tool_use needs a string id, a string name and an input object`);
        }
        otherContentSeen = true;
        break;
      case "tool_result":
        if (role !== "user") out.push(`${where} is a tool_result outside a user message`);
        if (otherContentSeen) out.push(`${where} tool_result comes after other content`);
        if (typeof block["tool_use_id"] !== "string") out.push(`${where} tool_result has no tool_use_id`);
        break;
      default:
        otherContentSeen = true;
    }
  });
  return out;
}

function messageViolations(messages: unknown): string[] {
  if (!Array.isArray(messages) || messages.length === 0) return ["messages is missing or empty"];
  const out: string[] = [];
  messages.forEach((message, index) => {
    const at = `messages[${index}]`;
    if (!isRecord(message)) {
      out.push(`${at} is not an object`);
      return;
    }
    const role = message["role"];
    if (role !== "user" && role !== "assistant") {
      out.push(`${at}.role is neither user nor assistant`);
      return;
    }
    const blocks = blocksOf(message);
    if (blocks === null || blocks.length === 0) {
      out.push(`${at} has no content`);
      return;
    }
    out.push(...blockViolations(role, blocks, at));
  });
  if (out.length > 0) return out;

  const roleAt = (index: number): unknown => {
    const message: unknown = messages[index];
    return isRecord(message) ? message["role"] : undefined;
  };
  if (roleAt(0) !== "user") out.push("the first message is not from the user");
  if (roleAt(messages.length - 1) !== "user") out.push("the last message is not from the user");
  messages.forEach((message, index) => {
    if (roleAt(index) === "assistant") {
      const answered = roleAt(index + 1) === "user" ? idsOf(messages[index + 1], "tool_result") : [];
      for (const id of idsOf(message, "tool_use")) {
        if (!answered.includes(id)) out.push(`messages[${index}] has a tool_use without a tool_result in the next message`);
      }
    } else {
      const asked = index > 0 && roleAt(index - 1) === "assistant" ? idsOf(messages[index - 1], "tool_use") : [];
      for (const id of idsOf(message, "tool_result")) {
        if (!asked.includes(id)) out.push(`messages[${index}] has a tool_result without a tool_use in the previous message`);
      }
    }
  });
  return out;
}

/** Protocol problems of one request. Messages name fields only, never header or body values. */
export function protocolViolations(
  method: string,
  path: string,
  headers: Readonly<Record<string, string>>,
  body: unknown,
): string[] {
  const out: string[] = [];
  if (method !== "POST") out.push("method is not POST");
  if (path !== MESSAGES_PATH) out.push(`path is not ${MESSAGES_PATH}`);
  if ((headers["x-api-key"] ?? "") === "") out.push("x-api-key header is missing");
  if ((headers["anthropic-version"] ?? "") === "") out.push("anthropic-version header is missing");
  if (!(headers["content-type"] ?? "").toLowerCase().includes("application/json")) {
    out.push("content-type is not application/json");
  }
  if (!isRecord(body)) {
    out.push("body is not a JSON object");
    return out;
  }
  const model = body["model"];
  if (typeof model !== "string" || model === "") out.push("model is missing");
  const maxTokens = body["max_tokens"];
  if (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens < 1) {
    out.push("max_tokens is missing or not a positive integer");
  }
  if ("stream" in body && typeof body["stream"] !== "boolean") out.push("stream is not a boolean");
  const system = body["system"];
  if (system !== undefined && typeof system !== "string" && !Array.isArray(system)) {
    out.push("system is neither a string nor a list of blocks");
  }
  out.push(...toolViolations(body["tools"]));
  out.push(...messageViolations(body["messages"]));
  return out;
}

interface AnswerContext {
  readonly index: number;
  readonly model: string;
  readonly streamed: boolean;
  readonly errorMessage: string;
}

function messageObject(reply: Extract<FakeReply, { kind: "message" }>, context: AnswerContext): JsonRecord {
  const hasToolUse = reply.content.some((block) => block.type === "tool_use");
  const message: JsonRecord = {
    id: `msg_fake_${context.index}`,
    type: "message",
    role: "assistant",
    model: context.model,
    content: reply.content,
    stop_reason: reply.stopReason ?? (hasToolUse ? "tool_use" : "end_turn"),
    stop_sequence: null,
  };
  if (reply.usage !== null) message["usage"] = { ...reply.usage };
  return message;
}

/** Server-sent events in the order the Messages API uses for a streamed answer. */
function writeStream(response: ServerResponse, reply: Extract<FakeReply, { kind: "message" }>, context: AnswerContext): void {
  const message = messageObject(reply, context);
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "request-id": `req_fake_${context.index}` });
  const send = (event: string, data: JsonRecord): void => {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const start: JsonRecord = { ...message, content: [], stop_reason: null, stop_sequence: null };
  if (reply.usage !== null) start["usage"] = { input_tokens: reply.usage.input_tokens, output_tokens: 1 };
  send("message_start", { type: "message_start", message: start });
  reply.content.forEach((block, index) => {
    if (block.type === "text") {
      send("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
      send("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    } else {
      send("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
      });
      send("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
      });
    }
    send("content_block_stop", { type: "content_block_stop", index });
  });
  const delta: JsonRecord = { type: "message_delta", delta: { stop_reason: message["stop_reason"], stop_sequence: null } };
  if (reply.usage !== null) delta["usage"] = { output_tokens: reply.usage.output_tokens };
  send("message_delta", delta);
  send("message_stop", { type: "message_stop" });
  response.end();
}

function answer(response: ServerResponse, reply: FakeReply, context: AnswerContext, hanging: Set<ServerResponse>): void {
  switch (reply.kind) {
    case "hang":
      hanging.add(response);
      response.on("close", () => hanging.delete(response));
      return;
    case "flood":
      writeFlood(response, reply, hanging);
      return;
    case "error": {
      const headers: Record<string, string> = { "content-type": "application/json", "request-id": `req_fake_${context.index}` };
      if (reply.retryAfterSeconds !== undefined) headers["retry-after"] = String(reply.retryAfterSeconds);
      response.writeHead(reply.status, headers);
      response.end(
        JSON.stringify({
          type: "error",
          error: { type: reply.errorType, message: context.errorMessage },
          request_id: `req_fake_${context.index}`,
        }),
      );
      return;
    }
    case "message":
      if (context.streamed) {
        writeStream(response, reply, context);
        return;
      }
      response.writeHead(200, { "content-type": "application/json", "request-id": `req_fake_${context.index}` });
      response.end(JSON.stringify(messageObject(reply, context)));
  }
}

/**
 * Starts the fake server. Step N answers the Nth request that passes the protocol checks.
 * The server is closed after the test (hanging answers are dropped).
 */
export async function startFakeAnthropic(t: TestContext, steps: readonly FakeReply[]): Promise<FakeAnthropic> {
  const requests: RecordedRequest[] = [];
  const hanging = new Set<ServerResponse>();
  let nextStep = 0;

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = parseJson(bodyText);
      const headers = headerMap(request);
      const method = request.method ?? "";
      const path = request.url ?? "";
      const violations = protocolViolations(method, path, headers, body);
      const streamed = isRecord(body) && body["stream"] === true;
      const index = requests.length + 1;
      let outcome: RequestOutcome;
      let reply: FakeReply;
      let errorMessage: string;
      const step = steps[nextStep];
      if (violations.length > 0) {
        outcome = "violation";
        reply = replyError(400, "invalid_request_error");
        errorMessage = `fake server: ${violations.join("; ")}`;
      } else if (step === undefined) {
        outcome = "exhausted";
        reply = replyError(400, "invalid_request_error");
        errorMessage = "fake server: no scripted answer left";
      } else {
        outcome = "scripted";
        reply = step;
        nextStep += 1;
        errorMessage = step.kind === "error" ? `fake ${step.errorType}` : "";
      }
      requests.push({ index, method, path, headers, bodyText, body, streamed, outcome, violations });
      const model = isRecord(body) && typeof body["model"] === "string" ? body["model"] : "unknown";
      answer(response, reply, { index, model, streamed: streamed && outcome === "scripted", errorMessage }, hanging);
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
  return { url: `http://127.0.0.1:${port}`, requests, close };
}

export interface GuardedRun extends CliRun {
  /** Origins of non-loopback hosts the CLI tried to reach. Asserted to be empty. */
  readonly blockedOrigins: readonly string[];
}

/**
 * Runs `node dist/src/cli/main.js <args>` from the sandbox base with the network guard preloaded,
 * then asserts that the CLI tried to reach no host other than 127.0.0.1.
 */
export async function runGuarded(
  sandbox: Sandbox,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 60_000,
): Promise<GuardedRun> {
  const log = join(sandbox.base, "net-guard.log");
  const run = await startCli(args, { cwd: sandbox.base, env, timeoutMs, netGuardLog: log }).done;
  const blockedOrigins = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((line) => line !== "") : [];
  assert.deepEqual(blockedOrigins, [], "the CLI tried to reach a host other than the local fake server");
  return { ...run, blockedOrigins };
}

export function requestAt(api: FakeAnthropic, position: number): RecordedRequest {
  const request = api.requests[position];
  if (request === undefined) assert.fail(`the fake server received only ${api.requests.length} request(s)`);
  return request;
}

export function bodyOf(request: RecordedRequest): JsonRecord {
  if (!isRecord(request.body)) assert.fail(`request ${request.index} has no JSON object body`);
  return request.body;
}

/** Every request followed the protocol rules and was answered from the script. */
export function assertProtocolClean(api: FakeAnthropic): void {
  const problems = api.requests
    .filter((request) => request.outcome !== "scripted")
    .map((request) => `request ${request.index}: ${request.outcome} ${request.violations.join("; ")}`);
  assert.deepEqual(problems, [], "every request must follow the Messages API rules and stay within the script");
}

/**
 * Tools offered in the request match TOOL_DEFINITIONS exactly (name, description, input_schema),
 * and every tool in `expected` is offered.
 */
export function assertToolDefinitions(request: RecordedRequest, expected: readonly ToolName[]): void {
  const tools = bodyOf(request)["tools"];
  assert.ok(Array.isArray(tools) && tools.length > 0, "the request must offer tools");
  const offered: string[] = [];
  for (const tool of tools) {
    assert.ok(isRecord(tool), "each tool must be an object");
    const name = tool["name"];
    assert.ok(typeof name === "string" && (TOOL_NAMES as readonly string[]).includes(name), `unknown tool offered: ${String(name)}`);
    const definition = TOOL_DEFINITIONS[name as ToolName];
    assert.equal(tool["description"], definition.description, `${name}: description must equal TOOL_DEFINITIONS`);
    assert.deepEqual(tool["input_schema"], definition.inputSchema, `${name}: input_schema must equal TOOL_DEFINITIONS`);
    offered.push(name);
  }
  for (const name of expected) assert.ok(offered.includes(name), `tool ${name} must be offered`);
}

/** Text of the tool_result block for `toolUseId` in the request's last message. */
export function toolResultText(request: RecordedRequest, toolUseId: string): string {
  const messages = bodyOf(request)["messages"];
  assert.ok(Array.isArray(messages), "messages must be a list");
  const last = messages[messages.length - 1];
  assert.ok(isRecord(last), "the last message must be an object");
  for (const block of blocksOf(last) ?? []) {
    if (!isRecord(block) || block["type"] !== "tool_result" || block["tool_use_id"] !== toolUseId) continue;
    const content = block["content"];
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => (isRecord(part) && typeof part["text"] === "string" ? part["text"] : ""))
        .join("\n");
    }
    return "";
  }
  assert.fail(`request ${request.index} has no tool_result for ${toolUseId} in its last message`);
}

/** The body as sent and fully decoded (nested JSON strings parsed), for leak scans. */
export function bodySources(api: FakeAnthropic): TextSource[] {
  return api.requests.flatMap((request) => [
    { label: `request ${request.index} body`, text: request.bodyText },
    decodedSource(`request ${request.index} body`, request.bodyText, false),
  ]);
}

/** Header values other than `x-api-key`, for leak scans. */
export function otherHeaderSources(api: FakeAnthropic): TextSource[] {
  return api.requests.flatMap((request) =>
    Object.entries(request.headers)
      .filter(([name]) => name !== "x-api-key")
      .map(([name, value]) => ({ label: `request ${request.index} header ${name}`, text: value })),
  );
}

/**
 * stdout, stderr and every record under `<workspace>/.codaryn/` (journal, result.json, lock), each
 * also fully decoded when it is JSON. Used to show that a fake key or secret never left memory.
 * Change snapshots are raw copies of workspace files by contract (R-8) and are not scanned.
 */
export function cliOutputSources(workspace: string, run: CliRun): TextSource[] {
  const files = stateRecordTexts(workspace);
  const decodedFiles = files
    .filter((file) => file.label.endsWith(".json") || file.label.endsWith(".jsonl"))
    .map((file) => decodedSource(file.label, file.text, file.label.endsWith(".jsonl")));
  return [
    { label: "stdout", text: run.stdout },
    { label: "stderr", text: run.stderr },
    decodedSource("stdout", run.stdout, true),
    ...files,
    ...decodedFiles,
  ];
}

export function sentModels(api: FakeAnthropic): unknown[] {
  return api.requests.map((request) => bodyOf(request)["model"]);
}

export function sentMaxTokens(api: FakeAnthropic): unknown[] {
  return api.requests.map((request) => bodyOf(request)["max_tokens"]);
}
