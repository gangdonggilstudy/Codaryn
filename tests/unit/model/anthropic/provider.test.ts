import assert from "node:assert/strict";
import { test } from "node:test";

import { TOOL_DEFINITIONS, TOOL_NAMES } from "../../../../src/contracts/index.js";
import type {
  MaskedText,
  ModelOutcome,
  ModelRequest,
  ResolvedAnthropicSettings,
  ToolResult,
} from "../../../../src/contracts/index.js";
import {
  ANTHROPIC_API_VERSION,
  MAX_ERROR_MESSAGE_CHARS,
  createAnthropicProvider,
} from "../../../../src/model/anthropic/index.js";

/** Fake credential. It does not have the shape of a real key. */
const FAKE_KEY = "codaryn-fake-key-0123456789abcdef-not-a-credential";
const BASE_URL = "http://127.0.0.1:9";

/** Stand-in for `PrivacyGateway.mask` (PM decision P-5). The provider never produces MaskedText. */
function masked(text: string): MaskedText {
  return text as MaskedText;
}

function settings(overrides: Partial<ResolvedAnthropicSettings> = {}): ResolvedAnthropicSettings {
  return {
    apiKey: FAKE_KEY,
    model: "test-model-id",
    maxOutputTokens: 1024,
    apiBaseUrl: BASE_URL,
    requestTimeoutMs: 5_000,
    maxRetries: 2,
    ...overrides,
  };
}

interface SentRequest {
  readonly url: string;
  readonly method: string | undefined;
  readonly redirect: string | undefined;
  readonly headers: Headers;
  readonly body: string;
  readonly signal: AbortSignal | undefined;
}

type Reply = (sent: SentRequest) => Response | Promise<Response>;

/** Fake transport: answers the Nth request with replies[N] (the last reply repeats). */
function fakeFetch(replies: readonly Reply[]): { fetch: typeof fetch; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request: SentRequest = {
      url: String(input),
      method: init?.method,
      redirect: init?.redirect,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : "",
      signal: init?.signal ?? undefined,
    };
    sent.push(request);
    const reply = replies[Math.min(sent.length - 1, replies.length - 1)];
    if (reply === undefined) throw new Error("no reply configured");
    return reply(request);
  };
  return { fetch: fetchImpl as typeof fetch, sent };
}

function recordingSleep(): { sleep: (ms: number, signal?: AbortSignal) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    async sleep(ms: number) {
      waits.push(ms);
    },
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Reply {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
}

/** Passed as `usage` to leave the field out of the response body. */
const NO_USAGE = Symbol("no usage");

function message(
  content: unknown[],
  stopReason: unknown = "end_turn",
  usage: unknown = { input_tokens: 10, output_tokens: 5 },
): Record<string, unknown> {
  return {
    id: "msg_fake_01",
    type: "message",
    role: "assistant",
    model: "test-model-id",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    ...(usage === NO_USAGE ? {} : { usage }),
  };
}

function apiError(type: string, text: string): Record<string, unknown> {
  return { type: "error", error: { type, message: text }, request_id: "req_fake_01" };
}

const SIMPLE_REQUEST: ModelRequest = {
  system: masked("You are a test agent."),
  messages: [{ role: "user", content: masked("Add a heading to README.md") }],
  tools: TOOL_NAMES,
};

function live(): AbortSignal {
  return new AbortController().signal;
}

function assertFailure(outcome: ModelOutcome, kind: string): string {
  assert.equal(outcome.ok, false, "expected a failure outcome");
  if (outcome.ok) throw new Error("unreachable");
  assert.equal(outcome.kind, kind, outcome.message);
  assert.ok(outcome.message.length <= MAX_ERROR_MESSAGE_CHARS);
  assert.ok(!outcome.message.includes(FAKE_KEY));
  return outcome.message;
}

test("AD-01 request: endpoint, headers, body, tool definitions and tool_use/tool_result pairs", async () => {
  const transport = fakeFetch([json(200, message([{ type: "text", text: "done" }]))]);
  const provider = createAnthropicProvider(settings(), { fetch: transport.fetch, sleep: recordingSleep().sleep });

  const readResult: ToolResult = {
    callId: "toolu_A",
    tool: "read_file",
    ok: true,
    content: masked('{"path":"README.md","content":"# T\\n"}'),
    errorCode: null,
  };
  const searchResult: ToolResult = {
    callId: "toolu_B",
    tool: "search_files",
    ok: false,
    content: masked("directory not found"),
    errorCode: "not_found",
  };
  const request: ModelRequest = {
    system: masked("You are a test agent."),
    messages: [
      { role: "user", content: masked("Add a heading to README.md") },
      {
        role: "assistant",
        text: masked("Reading first."),
        toolCalls: [
          { id: "toolu_A", name: "read_file", argsJson: masked('{"path":"README.md"}') },
          { id: "toolu_B", name: "search_files", argsJson: masked('{"path":"docs","text":"x"}') },
        ],
      },
      { role: "tool", results: [readResult, searchResult] },
      { role: "assistant", text: masked(""), toolCalls: [{ id: "toolu_C", name: "read_file", argsJson: masked('{"path":"a.md"}') }] },
      { role: "tool", results: [{ ...readResult, callId: "toolu_C" }] },
      { role: "user", content: masked("Keep going.") },
    ],
    tools: TOOL_NAMES,
  };

  const outcome = await provider.complete(request, live());
  assert.equal(outcome.ok, true);
  assert.equal(transport.sent.length, 1);

  const sent = transport.sent[0];
  assert.ok(sent !== undefined);
  assert.equal(sent.url, `${BASE_URL}/v1/messages`);
  assert.equal(sent.method, "POST");
  assert.equal(sent.redirect, "manual");
  assert.equal(sent.headers.get("x-api-key"), FAKE_KEY);
  assert.equal(sent.headers.get("anthropic-version"), ANTHROPIC_API_VERSION);
  assert.equal(sent.headers.get("content-type"), "application/json");

  const body = JSON.parse(sent.body) as Record<string, unknown>;
  assert.deepEqual(body, {
    model: "test-model-id",
    max_tokens: 1024,
    system: "You are a test agent.",
    messages: [
      { role: "user", content: [{ type: "text", text: "Add a heading to README.md" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Reading first." },
          { type: "tool_use", id: "toolu_A", name: "read_file", input: { path: "README.md" } },
          { type: "tool_use", id: "toolu_B", name: "search_files", input: { path: "docs", text: "x" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_A", content: '{"path":"README.md","content":"# T\\n"}', is_error: false },
          { type: "tool_result", tool_use_id: "toolu_B", content: "directory not found", is_error: true },
        ],
      },
      // An empty assistant text is left out; it is not sent as an empty text block.
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_C", name: "read_file", input: { path: "a.md" } }] },
      // A user message right after tool results joins them, results first.
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_C", content: '{"path":"README.md","content":"# T\\n"}', is_error: false },
          { type: "text", text: "Keep going." },
        ],
      },
    ],
    tools: TOOL_NAMES.map((name) => ({
      name,
      description: TOOL_DEFINITIONS[name].description,
      input_schema: TOOL_DEFINITIONS[name].inputSchema,
    })),
  });

  // Every tool_result answers a tool_use of the assistant message right before it.
  const messages = body.messages as { role: string; content: { type: string; id?: string; tool_use_id?: string }[] }[];
  messages.forEach((entry, index) => {
    const resultIds = entry.content.filter((block) => block.type === "tool_result").map((block) => block.tool_use_id);
    if (resultIds.length === 0) return;
    const previous = messages[index - 1];
    assert.ok(previous !== undefined && previous.role === "assistant");
    const useIds = previous.content.filter((block) => block.type === "tool_use").map((block) => block.id);
    assert.deepEqual(resultIds, useIds);
  });
});

test("AD-01 request: no system field when it is empty, no tools field when none are offered", async () => {
  const transport = fakeFetch([json(200, message([{ type: "text", text: "ok" }]))]);
  const provider = createAnthropicProvider(settings({ apiBaseUrl: `${BASE_URL}/` }), { fetch: transport.fetch });
  await provider.complete({ system: masked(""), messages: SIMPLE_REQUEST.messages, tools: [] }, live());
  const sent = transport.sent[0];
  assert.ok(sent !== undefined);
  assert.equal(sent.url, `${BASE_URL}/v1/messages`);
  const body = JSON.parse(sent.body) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), ["model", "max_tokens", "messages"]);
});

test("AD-01 request: arguments that are not a JSON object are not sent", async () => {
  const transport = fakeFetch([json(200, message([{ type: "text", text: "ok" }]))]);
  const provider = createAnthropicProvider(settings(), { fetch: transport.fetch });
  const outcome = await provider.complete(
    {
      ...SIMPLE_REQUEST,
      messages: [
        ...SIMPLE_REQUEST.messages,
        { role: "assistant", text: masked(""), toolCalls: [{ id: "t1", name: "read_file", argsJson: masked("[1]") }] },
      ],
    },
    live(),
  );
  assertFailure(outcome, "api_error");
  assert.equal(transport.sent.length, 0);
});

test("AD-02 response: text, tool_use and stop reasons map to ModelResponse", async () => {
  const toolTurn = message(
    [
      { type: "thinking", thinking: "", signature: "fake-signature" },
      { type: "text", text: "Let me " },
      { type: "text", text: "read it." },
      { type: "tool_use", id: "toolu_01", name: "read_file", input: { path: "README.md" } },
      { type: "tool_use", id: "toolu_02", name: "not_a_registered_tool", input: {} },
    ],
    "tool_use",
  );
  const transport = fakeFetch([
    json(200, toolTurn),
    json(200, message([{ type: "text", text: "All done." }], "end_turn")),
    json(200, message([{ type: "redacted_thinking", data: "opaque" }, { type: "text", text: "x" }], "stop_sequence")),
  ]);
  const provider = createAnthropicProvider(settings(), { fetch: transport.fetch });

  assert.deepEqual(await provider.complete(SIMPLE_REQUEST, live()), {
    ok: true,
    response: {
      stop: "tool_calls",
      text: "Let me read it.",
      toolCalls: [
        { id: "toolu_01", name: "read_file", args: { path: "README.md" } },
        // The engine, not the provider, decides about unregistered tool names.
        { id: "toolu_02", name: "not_a_registered_tool", args: {} },
      ],
      usage: { inputTokens: 10, outputTokens: 5 },
    },
  });
  assert.deepEqual(await provider.complete(SIMPLE_REQUEST, live()), {
    ok: true,
    response: { stop: "final", text: "All done.", toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 } },
  });
  const third = await provider.complete(SIMPLE_REQUEST, live());
  assert.ok(third.ok);
  assert.equal(third.response.stop, "final");
  assert.equal(third.response.text, "x");
});

test("AD-03 length stops map to length", async () => {
  for (const reason of ["max_tokens", "model_context_window_exceeded"]) {
    const transport = fakeFetch([json(200, message([{ type: "text", text: "partial" }], reason))]);
    const provider = createAnthropicProvider(settings(), { fetch: transport.fetch });
    const outcome = await provider.complete(SIMPLE_REQUEST, live());
    assert.ok(outcome.ok, reason);
    assert.equal(outcome.response.stop, "length");
    assert.equal(outcome.response.text, "partial");
  }
});

test("AD-03 malformed responses are malformed_response and are not retried", async () => {
  const bodies: readonly [string, Reply][] = [
    ["not JSON", () => new Response("<html>gateway</html>", { status: 200 })],
    ["array body", json(200, [1, 2])],
    ["not a message", json(200, { type: "completion", content: [], stop_reason: "end_turn" })],
    ["content not an array", json(200, { ...message([]), content: "text" })],
    ["unknown block", json(200, message([{ type: "server_tool_use", id: "s1", name: "web_search", input: {} }]))],
    ["block without type", json(200, message([{ text: "x" }]))],
    ["text without text", json(200, message([{ type: "text" }]))],
    ["tool_use without id", json(200, message([{ type: "tool_use", name: "read_file", input: {} }], "tool_use"))],
    ["tool_use input array", json(200, message([{ type: "tool_use", id: "t", name: "read_file", input: [] }], "tool_use"))],
    [
      "duplicate tool ids",
      json(
        200,
        message(
          [
            { type: "tool_use", id: "t", name: "read_file", input: {} },
            { type: "tool_use", id: "t", name: "read_file", input: {} },
          ],
          "tool_use",
        ),
      ),
    ],
    ["tool_use stop without tool_use", json(200, message([{ type: "text", text: "x" }], "tool_use"))],
    ["unknown stop reason", json(200, message([{ type: "text", text: "x" }], "something_new"))],
    ["missing stop reason", json(200, message([{ type: "text", text: "x" }], null))],
    ["pause_turn without server tools", json(200, message([{ type: "text", text: "x" }], "pause_turn"))],
  ];
  for (const [label, reply] of bodies) {
    const transport = fakeFetch([reply]);
    const timer = recordingSleep();
    const provider = createAnthropicProvider(settings(), { fetch: transport.fetch, sleep: timer.sleep });
    const outcome = await provider.complete(SIMPLE_REQUEST, live());
    assert.equal(outcome.ok, false, label);
    if (!outcome.ok) assert.equal(outcome.kind, "malformed_response", `${label}: ${outcome.message}`);
    assert.equal(transport.sent.length, 1, label);
    assert.equal(timer.waits.length, 0, label);
  }
});

test("AD-03 a refusal is never reported as a finished turn", async () => {
  const transport = fakeFetch([
    json(200, message([{ type: "tool_use", id: "t", name: "write_file", input: { path: "a" } }], "refusal")),
  ]);
  const provider = createAnthropicProvider(settings(), { fetch: transport.fetch });
  const text = assertFailure(await provider.complete(SIMPLE_REQUEST, live()), "api_error");
  assert.match(text, /refusal/);
  assert.equal(transport.sent.length, 1);
});

test("AD-04 status codes map to error kinds; non-retryable ones are sent once", async () => {
  const cases: readonly [number, string, boolean][] = [
    [401, "auth_failed", false],
    [403, "auth_failed", false],
    [400, "api_error", false],
    [404, "api_error", false],
    [413, "api_error", false],
    [429, "rate_limited", true],
    [529, "overloaded", true],
    [503, "overloaded", true],
    [500, "api_error", true],
    [502, "api_error", true],
  ];
  for (const [status, kind, retryable] of cases) {
    const transport = fakeFetch([json(status, apiError("some_error", `status ${status}`))]);
    const timer = recordingSleep();
    const provider = createAnthropicProvider(settings({ maxRetries: 2 }), { fetch: transport.fetch, sleep: timer.sleep });
    const text = assertFailure(await provider.complete(SIMPLE_REQUEST, live()), kind);
    assert.match(text, new RegExp(`HTTP ${status}`));
    assert.equal(transport.sent.length, retryable ? 3 : 1, `status ${status}`);
    assert.equal(timer.waits.length, retryable ? 2 : 0, `status ${status}`);
  }
});

test("AD-04 retries stay within maxRetries and resend byte-identical bodies and headers", async () => {
  const transport = fakeFetch([json(429, apiError("rate_limit_error", "slow down"))]);
  const timer = recordingSleep();
  const provider = createAnthropicProvider(settings({ maxRetries: 3 }), { fetch: transport.fetch, sleep: timer.sleep });
  const text = assertFailure(await provider.complete(SIMPLE_REQUEST, live()), "rate_limited");
  assert.match(text, /after 4 attempts/);
  assert.equal(transport.sent.length, 4);
  assert.deepEqual(timer.waits, [500, 1000, 2000]);
  const first = transport.sent[0];
  assert.ok(first !== undefined);
  for (const sent of transport.sent) {
    assert.equal(sent.body, first.body);
    assert.deepEqual([...sent.headers.entries()], [...first.headers.entries()]);
    assert.equal(sent.url, first.url);
  }

  const none = fakeFetch([json(529, apiError("overloaded_error", "busy"))]);
  const zero = createAnthropicProvider(settings({ maxRetries: 0 }), { fetch: none.fetch, sleep: recordingSleep().sleep });
  assertFailure(await zero.complete(SIMPLE_REQUEST, live()), "overloaded");
  assert.equal(none.sent.length, 1);
});

test("AD-04 a retry that succeeds returns the response; retry-after is honoured", async () => {
  const transport = fakeFetch([
    json(429, apiError("rate_limit_error", "slow down"), { "retry-after": "3" }),
    json(529, apiError("overloaded_error", "busy")),
    json(200, message([{ type: "text", text: "fine" }])),
  ]);
  const timer = recordingSleep();
  const provider = createAnthropicProvider(settings({ maxRetries: 2 }), { fetch: transport.fetch, sleep: timer.sleep });
  const outcome = await provider.complete(SIMPLE_REQUEST, live());
  assert.ok(outcome.ok);
  assert.equal(outcome.response.text, "fine");
  assert.deepEqual(timer.waits, [3000, 1000]);
  assert.equal(new Set(transport.sent.map((sent) => sent.body)).size, 1);
});

/**
 * The shape Node's fetch uses for a connection failure: TypeError "fetch failed" whose cause carries
 * a system error code (observed on Node 26 against a closed loopback port).
 */
function connectionError(code = "ECONNREFUSED"): TypeError {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error(`connect ${code} 127.0.0.1:59999`), { code }),
  });
}

test("AD-04 network errors are retried as api_error; redirects are not followed", async () => {
  const failing = fakeFetch([
    () => {
      throw connectionError();
    },
  ]);
  const timer = recordingSleep();
  const provider = createAnthropicProvider(settings({ maxRetries: 1 }), { fetch: failing.fetch, sleep: timer.sleep });
  const text = assertFailure(await provider.complete(SIMPLE_REQUEST, live()), "api_error");
  assert.match(text, /ECONNREFUSED/);
  assert.equal(failing.sent.length, 2);

  const recovering = fakeFetch([
    () => {
      throw connectionError("ECONNRESET");
    },
    json(200, message([{ type: "text", text: "ok" }])),
  ]);
  const second = createAnthropicProvider(settings({ maxRetries: 1 }), { fetch: recovering.fetch, sleep: recordingSleep().sleep });
  assert.equal((await second.complete(SIMPLE_REQUEST, live())).ok, true);

  const redirect = fakeFetch([() => new Response(null, { status: 307, headers: { location: "https://elsewhere.invalid/" } })]);
  const third = createAnthropicProvider(settings(), { fetch: redirect.fetch, sleep: recordingSleep().sleep });
  assertFailure(await third.complete(SIMPLE_REQUEST, live()), "api_error");
  assert.equal(redirect.sent.length, 1);
});

/** A transport that never answers until its request signal aborts. */
const hangUntilAborted: Reply = (sent) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = sent.signal;
    if (signal === undefined) return;
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });

test("AD-04 a request over requestTimeoutMs is a timeout after the allowed retries", async () => {
  const transport = fakeFetch([hangUntilAborted]);
  const timer = recordingSleep();
  const provider = createAnthropicProvider(settings({ requestTimeoutMs: 20, maxRetries: 1 }), {
    fetch: transport.fetch,
    sleep: timer.sleep,
  });
  const text = assertFailure(await provider.complete(SIMPLE_REQUEST, live()), "timeout");
  assert.match(text, /20 ms/);
  assert.equal(transport.sent.length, 2);
  assert.equal(timer.waits.length, 1);
});

test("AD-05 usage is read when present and null when absent or invalid", async () => {
  const cases: readonly [unknown, unknown][] = [
    [{ input_tokens: 12, output_tokens: 7 }, { inputTokens: 12, outputTokens: 7 }],
    [
      { input_tokens: 12, output_tokens: 7, cache_creation_input_tokens: 100, cache_read_input_tokens: 3 },
      { inputTokens: 115, outputTokens: 7 },
    ],
    [{ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: null }, { inputTokens: 0, outputTokens: 0 }],
    [NO_USAGE, null],
    [null, null],
    [{ input_tokens: 12 }, null],
    [{ input_tokens: "12", output_tokens: 7 }, null],
    [{ input_tokens: -1, output_tokens: 7 }, null],
    [{ input_tokens: 1.5, output_tokens: 7 }, null],
  ];
  for (const [usage, expected] of cases) {
    const transport = fakeFetch([json(200, message([{ type: "text", text: "x" }], "end_turn", usage))]);
    const provider = createAnthropicProvider(settings(), { fetch: transport.fetch });
    const outcome = await provider.complete(SIMPLE_REQUEST, live());
    const label = usage === NO_USAGE ? "no usage field" : String(JSON.stringify(usage));
    assert.ok(outcome.ok, label);
    assert.deepEqual(outcome.response.usage, expected, label);
  }
});

test("AD-06 the fake key is only in the x-api-key header, never in a body or a message", async () => {
  const fragment = FAKE_KEY.slice(4, 22);
  const scenarios: readonly [string, Reply, string][] = [
    ["error body echoes the key", json(400, apiError("invalid_request_error", `bad header ${FAKE_KEY} rejected`)), "api_error"],
    ["error body echoes part of the key", json(401, apiError("authentication_error", `key ...${fragment}... invalid`)), "auth_failed"],
    ["plain text error body", () => new Response(`upstream said ${FAKE_KEY}`, { status: 418 }), "api_error"],
    ["unknown block type carries the key", json(200, message([{ type: FAKE_KEY }])), "malformed_response"],
    [
      "transport error message carries the key",
      () => {
        throw new TypeError(`Headers.append: "${FAKE_KEY}" is an invalid header value.`);
      },
      "api_error",
    ],
    ["very long error body", json(500, apiError("api_error", `${"x".repeat(5000)}${FAKE_KEY}`)), "api_error"],
  ];
  for (const [label, reply, kind] of scenarios) {
    const transport = fakeFetch([reply]);
    const provider = createAnthropicProvider(settings({ maxRetries: 0 }), {
      fetch: transport.fetch,
      sleep: recordingSleep().sleep,
    });
    const text = assertFailure(await provider.complete(SIMPLE_REQUEST, live()), kind);
    assert.ok(!text.includes(fragment), label);
    assert.ok(!text.includes(FAKE_KEY.slice(-12)), label);
    for (const sent of transport.sent) {
      assert.ok(!sent.body.includes(FAKE_KEY), label);
      assert.ok(!sent.body.includes(fragment), label);
      assert.equal(sent.headers.get("x-api-key"), FAKE_KEY, label);
      assert.equal(sent.headers.get("authorization"), null, label);
    }
  }
});

test("AD-06 invalid settings are refused without echoing the key", () => {
  const invalid: readonly Partial<ResolvedAnthropicSettings>[] = [
    { apiBaseUrl: "http://api.example.com" },
    { apiBaseUrl: `https://user:${FAKE_KEY}@api.example.com` },
    { apiBaseUrl: "not a url" },
    { model: "" },
    { maxOutputTokens: 0 },
    { requestTimeoutMs: -1 },
    { maxRetries: 11 },
    { apiKey: "" },
  ];
  for (const overrides of invalid) {
    assert.throws(
      () => createAnthropicProvider(settings(overrides)),
      (error: unknown) => error instanceof TypeError && !error.message.includes(FAKE_KEY),
      JSON.stringify(Object.keys(overrides)),
    );
  }
  assert.doesNotThrow(() => createAnthropicProvider(settings({ apiBaseUrl: "https://api.anthropic.com" })));
  assert.doesNotThrow(() => createAnthropicProvider(settings({ apiBaseUrl: "http://localhost:8080" })));
});

test("cancellation: before sending, while in flight and while waiting to retry", async () => {
  const before = new AbortController();
  before.abort();
  const unused = fakeFetch([json(200, message([{ type: "text", text: "x" }]))]);
  const provider = createAnthropicProvider(settings(), { fetch: unused.fetch });
  assertFailure(await provider.complete(SIMPLE_REQUEST, before.signal), "aborted");
  assert.equal(unused.sent.length, 0);

  const during = new AbortController();
  const inFlight = fakeFetch([
    (sent) => {
      setTimeout(() => during.abort(), 5);
      return hangUntilAborted(sent);
    },
  ]);
  const timer = recordingSleep();
  const second = createAnthropicProvider(settings({ maxRetries: 3 }), { fetch: inFlight.fetch, sleep: timer.sleep });
  assertFailure(await second.complete(SIMPLE_REQUEST, during.signal), "aborted");
  assert.equal(inFlight.sent.length, 1);
  assert.equal(timer.waits.length, 0);

  const waiting = new AbortController();
  const limited = fakeFetch([json(429, apiError("rate_limit_error", "slow down"))]);
  const third = createAnthropicProvider(settings({ maxRetries: 3 }), {
    fetch: limited.fetch,
    sleep: async () => {
      waiting.abort();
    },
  });
  assertFailure(await third.complete(SIMPLE_REQUEST, waiting.signal), "aborted");
  assert.equal(limited.sent.length, 1);
});

test("the provider never throws: a broken transport becomes an outcome", async () => {
  const broken = (async () => ({ status: 200 })) as unknown as typeof fetch;
  const provider = createAnthropicProvider(settings({ maxRetries: 0 }), { fetch: broken });
  const outcome = await provider.complete(SIMPLE_REQUEST, live());
  assertFailure(outcome, "api_error");
  assert.equal(provider.name, "anthropic");
});

// Regression cases from docs/reviews/2026-11-12-cross-review-anthropic-provider.md (S-10 to S-12).

const SUCCESS_BODY_LIMIT = 8 * 1024 * 1024;
const ERROR_BODY_LIMIT = 4096;

/**
 * A body that never ends. Each pull waits one turn of the event loop, so a reader that does not
 * stop is slowed down rather than racing. The stream errors when the request signal aborts, as a
 * real fetch body does.
 */
function endlessBody(sent: SentRequest, chunkBytes: number): { stream: ReadableStream<Uint8Array>; stats: { pulled: number; cancelled: boolean } } {
  const stats = { pulled: 0, cancelled: false };
  const chunk = new Uint8Array(chunkBytes).fill(0x78);
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        await new Promise((resolve) => setImmediate(resolve));
        if (sent.signal?.aborted) {
          controller.error(new DOMException("aborted", "AbortError"));
          return;
        }
        stats.pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        stats.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, stats };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

test("S-10 an endless 200 body stops at 8 MiB as malformed_response without retry", { timeout: 30_000 }, async () => {
  let stats = { pulled: 0, cancelled: false };
  const transport = fakeFetch([
    (sent) => {
      const body = endlessBody(sent, 16 * 1024);
      stats = body.stats;
      return new Response(body.stream, { status: 200, headers: { "content-type": "application/json" } });
    },
  ]);
  const provider = createAnthropicProvider(settings({ requestTimeoutMs: 2_000, maxRetries: 2 }), {
    fetch: transport.fetch,
    sleep: recordingSleep().sleep,
  });
  const text = assertFailure(await provider.complete(SIMPLE_REQUEST, live()), "malformed_response");
  await settle();
  assert.match(text, /larger than/);
  assert.equal(transport.sent.length, 1);
  assert.ok(stats.pulled <= SUCCESS_BODY_LIMIT + 2 * 16 * 1024, `pulled ${stats.pulled} bytes`);
  assert.equal(stats.cancelled, true);
});

test("S-10 the success limit is exact: 8 MiB parses, one byte more is malformed_response", async () => {
  const base = JSON.stringify(message([{ type: "text", text: "" }]));
  const padding = SUCCESS_BODY_LIMIT - base.length;
  const exact = JSON.stringify(message([{ type: "text", text: "a".repeat(padding) }]));
  assert.equal(Buffer.byteLength(exact), SUCCESS_BODY_LIMIT);
  const over = JSON.stringify(message([{ type: "text", text: "a".repeat(padding + 1) }]));
  const reply = (body: string): Reply => () => new Response(body, { status: 200 });

  const fits = createAnthropicProvider(settings(), { fetch: fakeFetch([reply(exact)]).fetch });
  const ok = await fits.complete(SIMPLE_REQUEST, live());
  assert.ok(ok.ok);
  assert.equal(ok.response.text.length, padding);

  const tooBig = createAnthropicProvider(settings(), { fetch: fakeFetch([reply(over)]).fetch });
  assertFailure(await tooBig.complete(SIMPLE_REQUEST, live()), "malformed_response");
});

test("S-10 an error body is read only up to 4096 bytes", { timeout: 30_000 }, async () => {
  let stats = { pulled: 0, cancelled: false };
  const transport = fakeFetch([
    (sent) => {
      const body = endlessBody(sent, 1024);
      stats = body.stats;
      return new Response(body.stream, { status: 400 });
    },
  ]);
  const provider = createAnthropicProvider(settings({ requestTimeoutMs: 2_000, maxRetries: 0 }), {
    fetch: transport.fetch,
  });
  const text = assertFailure(await provider.complete(SIMPLE_REQUEST, live()), "api_error");
  await settle();
  assert.match(text, /HTTP 400/);
  assert.ok(stats.pulled <= ERROR_BODY_LIMIT + 2 * 1024, `pulled ${stats.pulled} bytes`);
  assert.equal(stats.cancelled, true);
});

test("S-11 a key outside printable ASCII is refused before any request, without position or code", async () => {
  const keys = [
    "fake-key-0000\u0007-codaryn-review", // control character (review input)
    "fake-key-한-codaryn-review", // Hangul (review input: index 9, value 54620)
    "fake-key-é-codaryn-review", // Latin-1, which fetch would send as is
    "fake key-codaryn-review", // inner space
    "fake-key-\u007f-codaryn-review", // DEL
  ];
  for (const apiKey of keys) {
    const transport = fakeFetch([json(200, message([{ type: "text", text: "x" }]))]);
    const provider = createAnthropicProvider(settings({ apiKey }), { fetch: transport.fetch, sleep: recordingSleep().sleep });
    const outcome = await provider.complete(SIMPLE_REQUEST, live());
    assert.equal(outcome.ok, false, JSON.stringify(apiKey));
    if (outcome.ok) continue;
    assert.equal(outcome.kind, "not_configured", JSON.stringify(apiKey));
    assert.equal(transport.sent.length, 0, JSON.stringify(apiKey));
    assert.ok(!/index|54620|\d{3,}|\\u/.test(outcome.message), outcome.message);
    assert.ok(!outcome.message.includes(apiKey));
  }
});

test("S-11 a format TypeError from fetch is not retried and its text is not copied", async () => {
  const formatErrors: readonly [string, () => never][] = [
    [
      "invalid header (fetch failed, UND_ERR_INVALID_ARG)",
      () => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("invalid x-api-key header"), { code: "UND_ERR_INVALID_ARG" }),
        });
      },
    ],
    [
      "ByteString conversion",
      () => {
        throw new TypeError(
          "Cannot convert argument to a ByteString because the character at index 9 has a value of 54620 which is greater than 255.",
        );
      },
    ],
    [
      "invalid URL",
      () => {
        throw new TypeError("Failed to parse URL", { cause: Object.assign(new TypeError("Invalid URL"), { code: "ERR_INVALID_URL" }) });
      },
    ],
  ];
  for (const [label, thrower] of formatErrors) {
    const transport = fakeFetch([thrower]);
    const timer = recordingSleep();
    const provider = createAnthropicProvider(settings({ maxRetries: 2 }), { fetch: transport.fetch, sleep: timer.sleep });
    const text = assertFailure(await provider.complete(SIMPLE_REQUEST, live()), "api_error");
    assert.equal(transport.sent.length, 1, label);
    assert.equal(timer.waits.length, 0, label);
    assert.ok(!/x-api-key|ByteString|index 9|54620|Invalid URL|UND_ERR/.test(text), `${label}: ${text}`);
  }
});

test("S-11 connection errors are retried and reported with a fixed phrase only", async () => {
  const transport = fakeFetch([
    () => {
      throw connectionError("ECONNREFUSED");
    },
  ]);
  const timer = recordingSleep();
  const provider = createAnthropicProvider(settings({ maxRetries: 2 }), { fetch: transport.fetch, sleep: timer.sleep });
  const text = assertFailure(await provider.complete(SIMPLE_REQUEST, live()), "api_error");
  assert.equal(transport.sent.length, 3);
  assert.match(text, /ECONNREFUSED/);
  assert.ok(!text.includes("127.0.0.1:59999"), text);

  // A connection dropped while the body is read is a connection failure too.
  const dropped = fakeFetch([
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError("terminated", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) }));
          },
        }),
        { status: 200 },
      ),
    json(200, message([{ type: "text", text: "recovered" }])),
  ]);
  const second = createAnthropicProvider(settings({ maxRetries: 1 }), { fetch: dropped.fetch, sleep: recordingSleep().sleep });
  const outcome = await second.complete(SIMPLE_REQUEST, live());
  assert.ok(outcome.ok);
  assert.equal(outcome.response.text, "recovered");
  assert.equal(dropped.sent.length, 2);
});

test("S-12 a key split by line breaks or spaces leaves no fragment in the message", async () => {
  const chunks7 = FAKE_KEY.match(/.{1,7}/g) ?? [];
  const chunks5 = FAKE_KEY.match(/.{1,5}/g) ?? [];
  const variants: readonly [string, string][] = [
    ["every 7 chars with LF (review input)", chunks7.join("\n")],
    ["every 7 chars with CRLF", chunks7.join("\r\n")],
    ["every 5 chars with spaces", chunks5.join(" ")],
    ["every 7 chars with tabs and NBSP", chunks7.join("\t ")],
    ["two halves with a space", `${FAKE_KEY.slice(0, 25)} ${FAKE_KEY.slice(25)}`],
  ];
  for (const [label, echoed] of variants) {
    for (const reply of [
      json(401, apiError("authentication_error", `invalid key: ${echoed}`)),
      () => new Response(`upstream rejected ${echoed}`, { status: 401 }),
    ]) {
      const transport = fakeFetch([reply]);
      const provider = createAnthropicProvider(settings({ maxRetries: 0 }), { fetch: transport.fetch });
      const text = assertFailure(await provider.complete(SIMPLE_REQUEST, live()), "auth_failed");
      const compact = text.replace(/\s+/g, "");
      for (const chunk of [...chunks7, ...chunks5].filter((piece) => piece.length >= 5)) {
        assert.ok(!text.includes(chunk), `${label}: chunk ${chunk} in ${text}`);
      }
      for (let index = 0; index + 8 <= FAKE_KEY.length; index += 1) {
        assert.ok(!compact.includes(FAKE_KEY.slice(index, index + 8)), `${label}: ${text}`);
      }
      assert.ok(!/[\u0000-\u001f\u007f]/.test(text), label);
    }
  }
});
