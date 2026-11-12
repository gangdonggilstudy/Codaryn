/**
 * SP-0 (docs/design/second-provider.md 7절): scenarios whose results pin the Anthropic adapter's
 * behaviour byte for byte before the shared HTTP module is split out (SP-3). Each scenario returns a
 * plain JSON value; `sp0-pins.test.ts` compares it with `sp0-golden.ts`. Fake transport only: no
 * real API request, no network. Key-shaped text is assembled at run time so no source line holds one.
 */

import { createHash } from "node:crypto";

import { TOOL_NAMES } from "../../../../src/contracts/index.js";
import type { MaskedText, ModelOutcome, ModelRequest, ResolvedAnthropicSettings } from "../../../../src/contracts/index.js";
import { createAnthropicProvider, listAnthropicModels } from "../../../../src/model/anthropic/index.js";

export const FAKE_KEY = "codaryn-fake-key-0123456789abcdef-not-a-credential";
/** Key-shaped text (the Anthropic key pattern), built so that this file holds no such line. */
export const KEY_SHAPED = ["sk", "ant", "Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2"].join("-");

const SETTINGS: ResolvedAnthropicSettings = {
  apiKey: FAKE_KEY,
  model: "test-model-id",
  maxOutputTokens: 1024,
  apiBaseUrl: "https://api.example.test",
  requestTimeoutMs: 5_000,
  maxRetries: 3,
};

const m = (text: string): MaskedText => text as MaskedText;
const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const TOKEN = "[[CODARYN_SECRET:0123456789abcdef]]";

type Reply =
  | { readonly status: number; readonly body?: string; readonly headers?: Record<string, string> }
  /** A thrown error: a TypeError, with `cause.code` when given (as Node's fetch reports network failures). */
  | { readonly throws: string; readonly code?: string; readonly plainError?: true }
  | { readonly hang: true };

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly redirect: string | null;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
}

function headerList(init: RequestInit | undefined): [string, string][] {
  const raw = init?.headers;
  let entries: [string, string][];
  if (raw === undefined) entries = [];
  else if (raw instanceof Headers) entries = [...raw.entries()];
  else if (Array.isArray(raw)) entries = raw.map(([name, value]) => [String(name), String(value)]);
  else entries = Object.entries(raw as Record<string, string>);
  return entries.map(([name, value]) => [name, value === FAKE_KEY ? "<key>" : value]);
}

/** A transport that answers from `replies` in order (the last one repeats) and records every request. */
function transport(replies: readonly Reply[]) {
  const sent: Sent[] = [];
  const delays: number[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sent.push({
      method: init?.method ?? "GET",
      url: String(input),
      redirect: init?.redirect ?? null,
      headers: headerList(init),
      body: typeof init?.body === "string" ? init.body : "",
    });
    const reply = replies[Math.min(sent.length - 1, replies.length - 1)] as Reply;
    if ("throws" in reply) {
      const options = reply.code === undefined ? undefined : { cause: { code: reply.code } };
      throw reply.plainError === true ? new Error(reply.throws, options) : new TypeError(reply.throws, options);
    }
    if ("hang" in reply) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")), { once: true });
      });
    }
    return new Response(reply.body ?? "", { status: reply.status, headers: reply.headers ?? { "content-type": "application/json" } });
  };
  const sleep = async (ms: number): Promise<void> => {
    delays.push(ms);
  };
  return { deps: { fetch: fetchImpl as typeof fetch, sleep }, sent, delays };
}

function message(content: unknown[], stopReason: string | null, usage: unknown = { input_tokens: 3, output_tokens: 2 }): string {
  return JSON.stringify({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "test-model-id",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage,
  });
}

const OK = message([{ type: "text", text: "done" }], "end_turn");

function outcomeJson(outcome: ModelOutcome): unknown {
  return JSON.parse(JSON.stringify(outcome));
}

async function complete(request: ModelRequest, replies: readonly Reply[], settings: Partial<ResolvedAnthropicSettings> = {}) {
  const t = transport(replies);
  const provider = createAnthropicProvider({ ...SETTINGS, ...settings }, t.deps);
  const outcome = await provider.complete(request, new AbortController().signal);
  return { outcome, sent: t.sent, delays: t.delays };
}

// ------------------------------------------------------------------------------------------------
// P-1: request bodies

const BASIC: ModelRequest = { system: m("You are a test agent."), messages: [{ role: "user", content: m("Say hi") }], tools: TOOL_NAMES };

const REQUESTS: Record<string, ModelRequest> = {
  basicAllTools: BASIC,
  noTools: { ...BASIC, tools: [] },
  workflowTools: { ...BASIC, tools: ["read_file", "search_files"], workflowTools: ["inspect_files", "propose_plan"] },
  toolRound: {
    system: m("sys"),
    messages: [
      { role: "user", content: m("Fix a.txt") },
      {
        role: "assistant",
        text: m("Two reads."),
        toolCalls: [
          { id: "toolu_A", name: "read_file", argsJson: m('{"path":"a.txt"}') },
          { id: "toolu_B", name: "search_files", argsJson: m('{"query":"x","mode":"text"}') },
        ],
      },
      {
        role: "tool",
        results: [
          { callId: "toolu_A", tool: "read_file", ok: true, content: m('{"path":"a.txt","content":"line\\n"}'), errorCode: null },
          { callId: "toolu_B", tool: "search_files", ok: false, content: m("denied by policy"), errorCode: "policy_denied" },
        ],
      },
    ],
    tools: TOOL_NAMES,
  },
  sameRoleInARow: {
    system: m("sys"),
    messages: [
      { role: "user", content: m("first") },
      { role: "user", content: m("second") },
      { role: "assistant", text: m(""), toolCalls: [{ id: "toolu_C", name: "read_file", argsJson: m('{"path":"b.txt"}') }] },
      { role: "tool", results: [{ callId: "toolu_C", tool: "read_file", ok: true, content: m("{}"), errorCode: null }] },
      { role: "user", content: m("after the tool") },
    ],
    tools: TOOL_NAMES,
  },
  maskedAndUnicode: {
    system: m(`Secret ${TOKEN} stays masked. 한국어 é "quotes" \\ backslash\nnew line\ttab`),
    messages: [{ role: "user", content: m(`path ${TOKEN}/a.txt and emoji \u{1F600}`) }],
    tools: ["read_file"],
  },
  emptySystem: { system: m(""), messages: [{ role: "user", content: m("x") }], tools: ["write_file"] },
  assistantTextOnly: {
    system: m("sys"),
    messages: [
      { role: "user", content: m("q") },
      { role: "assistant", text: m("an answer"), toolCalls: [] },
      { role: "user", content: m("follow-up") },
    ],
    tools: TOOL_NAMES,
  },
  longConversation: {
    system: m("sys"),
    messages: Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0
        ? ({ role: "user", content: m(`turn ${i}`) } as const)
        : ({ role: "assistant", text: m(`reply ${i}`), toolCalls: [] } as const),
    ),
    tools: TOOL_NAMES,
  },
  bigToolResult: {
    system: m("sys"),
    messages: [
      { role: "user", content: m("read") },
      { role: "assistant", text: m(""), toolCalls: [{ id: "toolu_D", name: "read_file", argsJson: m('{"path":"big.txt"}') }] },
      { role: "tool", results: [{ callId: "toolu_D", tool: "read_file", ok: true, content: m(JSON.stringify({ path: "big.txt", content: "x".repeat(50_000) })), errorCode: null }] },
    ],
    tools: TOOL_NAMES,
  },
};

export async function p1Bodies(): Promise<Record<string, { sha256: string; length: number }>> {
  const out: Record<string, { sha256: string; length: number }> = {};
  for (const [name, request] of Object.entries(REQUESTS)) {
    const { sent } = await complete(request, [{ status: 200, body: OK }]);
    const body = sent[0]?.body ?? "";
    out[name] = { sha256: sha(body), length: body.length };
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// P-2: request line and headers

export async function p2RequestLine(): Promise<unknown> {
  const messages = await complete(BASIC, [{ status: 200, body: OK }]);
  const listing = transport([{ status: 200, body: JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }) }]);
  await listAnthropicModels(SETTINGS, listing.deps, new AbortController().signal);
  const line = (s: Sent | undefined) => (s === undefined ? null : { method: s.method, url: s.url, redirect: s.redirect, headers: s.headers });
  return { messages: line(messages.sent[0]), models: line(listing.sent[0]) };
}

// ------------------------------------------------------------------------------------------------
// P-3: retries

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Reply => ({
  status,
  body: JSON.stringify(body),
  headers: { "content-type": "application/json", ...headers },
});
const apiError = (type: string, msg: string) => ({ type: "error", error: { type, message: msg }, request_id: "req_011CAbCdEf" });

const RETRIES: Record<string, { replies: Reply[]; settings?: Partial<ResolvedAnthropicSettings> }> = {
  rateLimitedThenOk: { replies: [json(429, apiError("rate_limit_error", "slow down")), { status: 200, body: OK }] },
  retryAfterSeconds: { replies: [json(429, apiError("rate_limit_error", "slow down"), { "retry-after": "2" }), { status: 200, body: OK }] },
  retryAfterOverCap: { replies: [json(429, apiError("rate_limit_error", "slow down"), { "retry-after": "120" }), { status: 200, body: OK }] },
  overloadedAlways: { replies: [json(529, apiError("overloaded_error", "busy"))] },
  unavailableThenServerError: { replies: [json(503, apiError("api_error", "unavailable")), json(500, apiError("api_error", "boom")), { status: 200, body: OK }] },
  timeoutAndConflictStatuses: { replies: [json(408, apiError("api_error", "timeout")), json(409, apiError("api_error", "conflict")), { status: 200, body: OK }] },
  unauthorized: { replies: [json(401, apiError("authentication_error", "invalid x-api-key"))] },
  forbidden: { replies: [json(403, apiError("permission_error", "no"))] },
  badRequest: { replies: [json(400, apiError("invalid_request_error", "bad field"))] },
  notFound: { replies: [json(404, apiError("not_found_error", "model: test-model-id"))] },
  serverErrorAlways: { replies: [json(500, apiError("api_error", "boom"))] },
  connectionResetThenOk: { replies: [{ throws: "fetch failed", code: "ECONNRESET" }, { status: 200, body: OK }] },
  connectionRefusedAlways: { replies: [{ throws: "fetch failed", code: "ECONNREFUSED" }] },
  tlsFailure: { replies: [{ throws: "fetch failed", code: "CERT_HAS_EXPIRED" }] },
  formatRefusal: { replies: [{ throws: "invalid header value" }] },
  unknownFailure: { replies: [{ throws: "something else", code: "EWHATEVER", plainError: true }] },
  timeoutAlways: { replies: [{ hang: true }], settings: { requestTimeoutMs: 30, maxRetries: 1 } },
  redirect: { replies: [{ status: 302, body: "", headers: { location: "https://elsewhere.test/" } }] },
  noRetriesAllowed: { replies: [json(429, apiError("rate_limit_error", "slow down"))], settings: { maxRetries: 0 } },
};

export async function p3Retries(): Promise<unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, scenario] of Object.entries(RETRIES)) {
    const { outcome, sent, delays } = await complete(BASIC, scenario.replies, scenario.settings);
    out[name] = { attempts: sent.length, delays, outcome: outcomeJson(outcome) };
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// P-4: error messages

const ERRORS: Record<string, Reply> = {
  jsonWithKeyShapes: json(400, apiError("invalid_request_error", `bad key ${KEY_SHAPED} and ${FAKE_KEY} here`)),
  jsonLongMessage: json(400, apiError("invalid_request_error", "word ".repeat(200))),
  jsonOddType: json(400, { type: "error", error: { type: "not a plain id!", message: "m" }, request_id: "bad id with spaces" }),
  htmlBody: { status: 502, body: "<html><body>Bad gateway from a proxy</body></html>", headers: { "content-type": "text/html" } },
  emptyBody: { status: 500, body: "" },
  hugeBody: { status: 400, body: JSON.stringify(apiError("invalid_request_error", "y".repeat(2_000_000))) },
  successNotJson: { status: 200, body: "not json" },
  successWrongShape: { status: 200, body: JSON.stringify({ type: "message", content: "not a list" }) },
};

export async function p4Errors(): Promise<unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, reply] of Object.entries(ERRORS)) {
    const { outcome, sent } = await complete(BASIC, [reply], { maxRetries: 0 });
    out[name] = { attempts: sent.length, outcome: outcomeJson(outcome) };
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// P-5: response parsing

const RESPONSES: Record<string, string> = {
  textFinal: message([{ type: "text", text: "all done" }], "end_turn"),
  usageWithCache: message([{ type: "text", text: "ok" }], "end_turn", {
    input_tokens: 10,
    output_tokens: 5,
    cache_creation_input_tokens: 7,
    cache_read_input_tokens: 100,
  }),
  usageMissing: message([{ type: "text", text: "ok" }], "end_turn", null),
  toolUse: message(
    [
      { type: "text", text: "Reading." },
      { type: "tool_use", id: "toolu_01", name: "read_file", input: { path: "a.txt" } },
      { type: "tool_use", id: "toolu_02", name: "search_files", input: { query: "x", mode: "text" } },
    ],
    "tool_use",
  ),
  maxTokens: message([{ type: "text", text: "cut" }], "max_tokens"),
  refusal: message([{ type: "text", text: "no" }], "refusal"),
  thinkingDropped: message(
    [
      { type: "thinking", thinking: "private reasoning", signature: "sig" },
      { type: "redacted_thinking", data: "opaque" },
      { type: "text", text: "visible" },
    ],
    "end_turn",
  ),
  stopSequence: message([{ type: "text", text: "stopped" }], "stop_sequence"),
  unknownStop: message([{ type: "text", text: "?" }], "something_new"),
  nullStop: message([{ type: "text", text: "?" }], null),
  toolUseBadInput: message([{ type: "tool_use", id: "toolu_03", name: "read_file", input: "not an object" }], "tool_use"),
};

export async function p5Responses(): Promise<unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, body] of Object.entries(RESPONSES)) {
    const { outcome } = await complete(BASIC, [{ status: 200, body }], { maxRetries: 0 });
    out[name] = outcomeJson(outcome);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// P-6: model list

const model = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "model",
  id,
  display_name: `Model ${id}`,
  created_at: "2026-01-02T03:04:05Z",
  max_input_tokens: 200_000,
  max_tokens: 64_000,
  ...extra,
});

const LISTINGS: Record<string, Reply[]> = {
  twoPages: [
    json(200, { data: [model("m-1"), model("m-2")], has_more: true, first_id: "m-1", last_id: "m-2" }),
    json(200, { data: [model("m-3", { display_name: 5, created_at: null, max_input_tokens: -1, max_tokens: 1.5 })], has_more: false, first_id: "m-3", last_id: "m-3" }),
  ],
  errorOnSecondPage: [json(200, { data: [model("m-1")], has_more: true, first_id: "m-1", last_id: "m-1" }), json(401, apiError("authentication_error", "bad"))],
  entryWithoutId: [json(200, { data: [{ type: "model", display_name: "no id" }], has_more: false })],
  empty: [json(200, { data: [], has_more: false, first_id: null, last_id: null })],
};

export async function p6Models(): Promise<unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, replies] of Object.entries(LISTINGS)) {
    const t = transport(replies);
    const outcome = await listAnthropicModels({ ...SETTINGS, maxRetries: 0 }, t.deps, new AbortController().signal);
    out[name] = { urls: t.sent.map((s) => `${s.method} ${s.url}`), outcome: JSON.parse(JSON.stringify(outcome)) };
  }
  return out;
}

/** Every pinned scenario, in one value. */
export async function collectPins(): Promise<Record<string, unknown>> {
  return {
    p1Bodies: await p1Bodies(),
    p2RequestLine: await p2RequestLine(),
    p3Retries: await p3Retries(),
    p4Errors: await p4Errors(),
    p5Responses: await p5Responses(),
    p6Models: await p6Models(),
  };
}
