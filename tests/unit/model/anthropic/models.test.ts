/**
 * Y-1: `listAnthropicModels` (src/contracts/model.ts `ListAnthropicModels`, docs/cli-contract.md 16).
 * Injected fake fetch only: no network, no real key. The fake key has no real key shape.
 * Response shapes follow the Models API reference (GET /v1/models: data, has_more, first_id,
 * last_id; model objects with type, id, display_name, created_at, max_input_tokens, max_tokens,
 * capabilities).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_MODEL_LIST_PAGES } from "../../../../src/contracts/index.js";
import type { AnthropicListSettings, ListModelsOutcome } from "../../../../src/contracts/index.js";
import {
  ANTHROPIC_API_VERSION,
  MAX_ERROR_MESSAGE_CHARS,
  MAX_SUCCESS_BODY_BYTES,
  MODEL_LIST_PAGE_SIZE,
  listAnthropicModels,
} from "../../../../src/model/anthropic/index.js";

const FAKE_KEY = "codaryn-fake-key-0123456789abcdef-not-a-credential";
const BASE_URL = "http://127.0.0.1:9";
const FIRST_URL = `${BASE_URL}/v1/models?limit=${MODEL_LIST_PAGE_SIZE}`;

function settings(overrides: Partial<AnthropicListSettings> = {}): AnthropicListSettings {
  return { apiKey: FAKE_KEY, apiBaseUrl: BASE_URL, requestTimeoutMs: 5_000, maxRetries: 2, ...overrides };
}

interface SentRequest {
  readonly url: string;
  readonly method: string | undefined;
  readonly redirect: string | undefined;
  readonly headers: Headers;
  readonly body: unknown;
  readonly signal: AbortSignal | undefined;
}

type Reply = (sent: SentRequest) => Response | Promise<Response>;

/** Answers the Nth request with replies[N] (the last reply repeats). */
function fakeFetch(replies: readonly Reply[]): { fetch: typeof fetch; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request: SentRequest = {
      url: String(input),
      method: init?.method,
      redirect: init?.redirect,
      headers: new Headers(init?.headers),
      body: init?.body,
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
  return () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** A model object as the Models API returns it, capabilities included. */
function model(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "model",
    id,
    display_name: `Fake ${id}`,
    created_at: "2026-09-21T00:00:00Z",
    max_input_tokens: 1_000_000,
    max_tokens: 128_000,
    capabilities: { image_input: { supported: true }, thinking: { supported: true, types: { adaptive: { supported: true } } } },
    lifecycle: "active",
    line: null,
    ...extra,
  };
}

function page(models: readonly Record<string, unknown>[], hasMore = false): Record<string, unknown> {
  const ids = models.map((item) => item["id"]);
  return { data: models, has_more: hasMore, first_id: ids[0] ?? null, last_id: ids.at(-1) ?? null };
}

function apiError(type: string, text: string): Record<string, unknown> {
  return { type: "error", error: { type, message: text }, request_id: "req_fake_01" };
}

const hangUntilAborted: Reply = (sent) =>
  new Promise<Response>((_resolve, reject) => {
    sent.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });

function assertFailure(outcome: ListModelsOutcome, kind: string): string {
  assert.equal(outcome.ok, false, "expected a failure");
  if (outcome.ok) throw new Error("unreachable");
  assert.equal(outcome.kind, kind, outcome.message);
  assert.ok(outcome.message.length <= MAX_ERROR_MESSAGE_CHARS);
  assert.ok(!outcome.message.includes(FAKE_KEY));
  for (let index = 0; index + 8 <= FAKE_KEY.length; index += 1) {
    assert.ok(!outcome.message.includes(FAKE_KEY.slice(index, index + 8)), `key fragment in: ${outcome.message}`);
  }
  return outcome.message;
}

function models(outcome: ListModelsOutcome): readonly unknown[] {
  assert.equal(outcome.ok, true, outcome.ok ? "" : `${outcome.kind}: ${outcome.message}`);
  return outcome.ok ? outcome.models : [];
}

test("Y-01 one page: GET /v1/models with the key in x-api-key only; fields mapped, capabilities dropped", async () => {
  const transport = fakeFetch([json(200, page([model("fake-model-b"), model("fake-model-a")]))]);
  const outcome = await listAnthropicModels(settings(), { fetch: transport.fetch });

  assert.deepEqual(models(outcome), [
    { id: "fake-model-b", displayName: "Fake fake-model-b", createdAt: "2026-09-21T00:00:00Z", maxInputTokens: 1_000_000, maxOutputTokens: 128_000 },
    { id: "fake-model-a", displayName: "Fake fake-model-a", createdAt: "2026-09-21T00:00:00Z", maxInputTokens: 1_000_000, maxOutputTokens: 128_000 },
  ]);
  assert.equal(transport.sent.length, 1);
  const sent = transport.sent[0];
  assert.ok(sent !== undefined);
  assert.equal(sent.url, FIRST_URL);
  assert.equal(sent.method, "GET");
  assert.equal(sent.redirect, "manual");
  assert.equal(sent.body, undefined);
  assert.equal(sent.headers.get("x-api-key"), FAKE_KEY);
  assert.equal(sent.headers.get("anthropic-version"), ANTHROPIC_API_VERSION);
  assert.equal(sent.headers.get("content-type"), null);
  assert.ok(!sent.url.includes(FAKE_KEY));
});

test("Y-02 several pages: last_id is passed as after_id, models are joined in API order", async () => {
  const transport = fakeFetch([
    json(200, page([model("m-1"), model("m-2")], true)),
    json(200, page([model("m-3")], true)),
    json(200, page([model("m-4")], false)),
  ]);
  const outcome = await listAnthropicModels(settings(), { fetch: transport.fetch });
  assert.deepEqual(
    models(outcome).map((item) => (item as { id: string }).id),
    ["m-1", "m-2", "m-3", "m-4"],
  );
  assert.deepEqual(
    transport.sent.map((sent) => sent.url),
    [FIRST_URL, `${FIRST_URL}&after_id=m-2`, `${FIRST_URL}&after_id=m-3`],
  );
  for (const sent of transport.sent) assert.equal(sent.headers.get("x-api-key"), FAKE_KEY);
});

test("Y-03 the cursor is URL-encoded", async () => {
  const transport = fakeFetch([
    json(200, { data: [model("m-1")], has_more: true, first_id: "m-1", last_id: "c&limit=1#x" }),
    json(200, page([model("m-2")])),
  ]);
  models(await listAnthropicModels(settings(), { fetch: transport.fetch }));
  assert.equal(transport.sent[1]?.url, `${FIRST_URL}&after_id=c%26limit%3D1%23x`);
});

test("Y-04 an empty list is a success with no models", async () => {
  const transport = fakeFetch([json(200, { data: [], has_more: false, first_id: null, last_id: null })]);
  assert.deepEqual(models(await listAnthropicModels(settings(), { fetch: transport.fetch })), []);
});

test("Y-05 missing or unusable optional fields become null (limits, created_at) or the id (display name)", async () => {
  const transport = fakeFetch([
    json(
      200,
      page([
        model("no-limits", { max_input_tokens: null, max_tokens: null }),
        { type: "model", id: "bare" },
        model("odd", { display_name: 42, created_at: 1_700_000_000, max_input_tokens: 0, max_tokens: -5 }),
        model("fraction", { max_input_tokens: 1.5, max_tokens: "128000" }),
      ]),
    ),
  ]);
  assert.deepEqual(models(await listAnthropicModels(settings(), { fetch: transport.fetch })), [
    { id: "no-limits", displayName: "Fake no-limits", createdAt: "2026-09-21T00:00:00Z", maxInputTokens: null, maxOutputTokens: null },
    { id: "bare", displayName: "bare", createdAt: null, maxInputTokens: null, maxOutputTokens: null },
    { id: "odd", displayName: "odd", createdAt: null, maxInputTokens: null, maxOutputTokens: null },
    { id: "fraction", displayName: "Fake fraction", createdAt: "2026-09-21T00:00:00Z", maxInputTokens: null, maxOutputTokens: null },
  ]);
});

test("Y-06 401 is auth_failed and is not retried", async () => {
  const transport = fakeFetch([json(401, apiError("authentication_error", "invalid x-api-key"))]);
  const timer = recordingSleep();
  const text = assertFailure(await listAnthropicModels(settings(), { fetch: transport.fetch, sleep: timer.sleep }), "auth_failed");
  assert.match(text, /401/);
  assert.equal(transport.sent.length, 1);
  assert.deepEqual(timer.waits, []);
});

test("Y-07 429 waits for retry-after and retries the same page; exhausted retries are rate_limited", async () => {
  const recovered = fakeFetch([
    json(200, page([model("m-1")], true)),
    json(429, apiError("rate_limit_error", "slow down"), { "retry-after": "2" }),
    json(200, page([model("m-2")])),
  ]);
  const timer = recordingSleep();
  const outcome = await listAnthropicModels(settings(), { fetch: recovered.fetch, sleep: timer.sleep });
  assert.equal(models(outcome).length, 2);
  assert.deepEqual(timer.waits, [2000]);
  assert.deepEqual(
    recovered.sent.map((sent) => sent.url),
    [FIRST_URL, `${FIRST_URL}&after_id=m-1`, `${FIRST_URL}&after_id=m-1`],
  );

  const limited = fakeFetch([json(429, apiError("rate_limit_error", "slow down"))]);
  const text = assertFailure(
    await listAnthropicModels(settings({ maxRetries: 1 }), { fetch: limited.fetch, sleep: recordingSleep().sleep }),
    "rate_limited",
  );
  assert.match(text, /after 2 attempts/);
  assert.equal(limited.sent.length, 2);
});

test("Y-08 a request over requestTimeoutMs is a timeout after the allowed retries", async () => {
  const transport = fakeFetch([hangUntilAborted]);
  const timer = recordingSleep();
  const text = assertFailure(
    await listAnthropicModels(settings({ requestTimeoutMs: 20, maxRetries: 1 }), { fetch: transport.fetch, sleep: timer.sleep }),
    "timeout",
  );
  assert.match(text, /20 ms/);
  assert.equal(transport.sent.length, 2);
  assert.equal(timer.waits.length, 1);
});

test("Y-09 malformed responses are malformed_response and are not retried", async () => {
  const cases: readonly [string, Reply][] = [
    ["not JSON", () => new Response("<html>proxy</html>", { status: 200 })],
    ["a JSON array", json(200, [model("m-1")])],
    ["data is not an array", json(200, { data: { id: "m-1" }, has_more: false })],
    ["data is missing", json(200, { models: [model("m-1")], has_more: false })],
    ["has_more is not a boolean", json(200, { data: [model("m-1")], has_more: "no" })],
    ["an entry without an id", json(200, page([model("m-1"), { type: "model", display_name: "No id" }]))],
    ["an entry whose id is not a string", json(200, { data: [{ type: "model", id: 7 }], has_more: false })],
    ["an entry that is not an object", json(200, { data: ["m-1"], has_more: false })],
    ["an id with a control character", json(200, page([model("m-1\u001b[31m")]))],
    ["an empty id", json(200, page([model("")]))],
    ["more pages but no last_id", json(200, { data: [model("m-1")], has_more: true, first_id: "m-1", last_id: null })],
  ];
  for (const [label, reply] of cases) {
    const transport = fakeFetch([reply]);
    const outcome = await listAnthropicModels(settings(), { fetch: transport.fetch, sleep: recordingSleep().sleep });
    assertFailure(outcome, "malformed_response");
    assert.equal(transport.sent.length, 1, label);
  }
});

test("Y-10 a cursor that does not advance and an id listed twice are malformed_response", async () => {
  const stuck = fakeFetch([json(200, { data: [model("m-1")], has_more: true, first_id: "m-1", last_id: "m-1" }), json(200, { data: [model("m-2")], has_more: true, first_id: "m-2", last_id: "m-1" })]);
  assertFailure(await listAnthropicModels(settings(), { fetch: stuck.fetch }), "malformed_response");
  assert.equal(stuck.sent.length, 2);

  const twice = fakeFetch([json(200, page([model("m-1"), model("m-2")], true)), json(200, page([model("m-2")]))]);
  assertFailure(await listAnthropicModels(settings(), { fetch: twice.fetch }), "malformed_response");
});

test("Y-11 more than MAX_MODEL_LIST_PAGES pages is api_error after exactly that many requests", async () => {
  let n = 0;
  const transport = fakeFetch([
    () => {
      n += 1;
      return new Response(JSON.stringify(page([model(`m-${n}`)], true)), { status: 200 });
    },
  ]);
  const text = assertFailure(await listAnthropicModels(settings(), { fetch: transport.fetch }), "api_error");
  assert.match(text, new RegExp(String(MAX_MODEL_LIST_PAGES)));
  assert.equal(transport.sent.length, MAX_MODEL_LIST_PAGES);
});

test("Y-12 a success body over the limit is malformed_response; a redirect is not followed", async () => {
  const big = fakeFetch([
    () => new Response(new Uint8Array(MAX_SUCCESS_BODY_BYTES + 1).fill(0x20), { status: 200 }),
  ]);
  assertFailure(await listAnthropicModels(settings(), { fetch: big.fetch }), "malformed_response");

  const redirect = fakeFetch([() => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/v1/models" } })]);
  const text = assertFailure(await listAnthropicModels(settings(), { fetch: redirect.fetch }), "api_error");
  assert.match(text, /redirect/);
  assert.equal(redirect.sent.length, 1);
});

test("Y-13 the fake key appears only in the x-api-key header", async () => {
  const scenarios: readonly [string, Reply, string][] = [
    ["an error body echoes the key", json(400, apiError("invalid_request_error", `bad header ${FAKE_KEY} rejected`)), "api_error"],
    ["a plain text error body with the key", () => new Response(`upstream said ${FAKE_KEY}`, { status: 418 }), "api_error"],
    ["a model name holds the key", json(200, page([model("m-1", { display_name: `leak ${FAKE_KEY}` })])), "malformed_response"],
    ["a model id holds a key fragment", json(200, page([model(`m-${FAKE_KEY.slice(10, 30)}`)])), "malformed_response"],
    ["a cursor holds the key", json(200, { data: [model("m-1")], has_more: true, first_id: "m-1", last_id: FAKE_KEY }), "malformed_response"],
  ];
  for (const [label, reply, kind] of scenarios) {
    const transport = fakeFetch([reply]);
    assertFailure(await listAnthropicModels(settings({ maxRetries: 0 }), { fetch: transport.fetch }), kind);
    for (const sent of transport.sent) {
      assert.ok(!sent.url.includes(FAKE_KEY), label);
      assert.equal(sent.body, undefined, label);
      assert.equal(sent.headers.get("x-api-key"), FAKE_KEY, label);
    }
  }
});

test("Y-14 a key outside printable ASCII is not_configured and nothing is sent", async () => {
  const transport = fakeFetch([json(200, page([model("m-1")]))]);
  const outcome = await listAnthropicModels(settings({ apiKey: "fake key with spaces" }), { fetch: transport.fetch });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.kind, "not_configured");
  assert.equal(transport.sent.length, 0);
});

test("Y-15 invalid settings are not_configured without a request or a throw", async () => {
  for (const override of [
    { apiBaseUrl: "ftp://api.example.com" },
    { apiBaseUrl: "http://api.example.com" },
    { apiBaseUrl: `https://user:${FAKE_KEY}@api.example.com` },
    { requestTimeoutMs: 0 },
    { maxRetries: -1 },
    { apiKey: "" },
  ]) {
    const transport = fakeFetch([json(200, page([model("m-1")]))]);
    const outcome = await listAnthropicModels(settings(override), { fetch: transport.fetch });
    assertFailure(outcome, "not_configured");
    assert.equal(transport.sent.length, 0, JSON.stringify(override).slice(0, 40));
  }
});

test("Y-16 an aborted signal gives aborted, before or during a request", async () => {
  const before = new AbortController();
  before.abort();
  const unsent = fakeFetch([json(200, page([model("m-1")]))]);
  assertFailure(await listAnthropicModels(settings(), { fetch: unsent.fetch }, before.signal), "aborted");
  assert.equal(unsent.sent.length, 0);

  const during = new AbortController();
  const inFlight = fakeFetch([
    (sent) => {
      setTimeout(() => during.abort(), 5);
      return hangUntilAborted(sent);
    },
  ]);
  assertFailure(await listAnthropicModels(settings(), { fetch: inFlight.fetch, sleep: recordingSleep().sleep }, during.signal), "aborted");
  assert.equal(inFlight.sent.length, 1);
});

test("Y-17 a connection failure is retried; a broken transport never throws", async () => {
  const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  const flaky = fakeFetch([
    () => {
      throw refused;
    },
    json(200, page([model("m-1")])),
  ]);
  assert.equal(models(await listAnthropicModels(settings(), { fetch: flaky.fetch, sleep: recordingSleep().sleep })).length, 1);
  assert.equal(flaky.sent.length, 2);

  const broken = (async () => ({ status: 200 })) as unknown as typeof fetch;
  const outcome = await listAnthropicModels(settings(), { fetch: broken });
  assert.equal(outcome.ok, false);
});
