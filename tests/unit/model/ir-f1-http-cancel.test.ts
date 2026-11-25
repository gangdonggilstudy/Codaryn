/**
 * IR-F1: a cancel that came before an HTTP attempt sends nothing. An abort listener added to a signal
 * that is already aborted never fires, so the attempt must look at the signal itself. Fake fetch only:
 * no network, no real key (the fake key has no real key shape; the base URL is a closed loopback port).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { AnthropicListSettings } from "../../../src/contracts/index.js";
import { listAnthropicModels } from "../../../src/model/anthropic/index.js";
import { MAX_ERROR_BODY_BYTES, sendWithRetries } from "../../../src/model/http/index.js";
import type { Transport } from "../../../src/model/http/index.js";

const FAKE_KEY = "codaryn-fake-key-0123456789abcdef-not-a-credential";
const BASE_URL = "http://127.0.0.1:9";

interface Sent {
  readonly url: string;
  readonly signalAborted: boolean | undefined;
}

/** Answers every request with `reply(n)` (n counts from 0) and records what was sent. */
function fakeFetch(reply: (n: number) => Response): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sent.push({ url: String(input), signalAborted: init?.signal?.aborted });
    return reply(sent.length - 1);
  };
  return { fetch: impl as typeof fetch, sent };
}

function transportOf(fetchImpl: typeof fetch): Transport {
  return {
    fetch: fetchImpl,
    sleep: async () => undefined,
    headers: {},
    timeoutMs: 5_000,
    maxRetries: 2,
    classifyStatus: () => ({ kind: "api_error", retryable: true }),
    errorBodyLimit: MAX_ERROR_BODY_BYTES,
    describeError: (status) => `HTTP ${status}`,
  };
}

const ok = (body: string): Response => new Response(body, { status: 200, headers: { "content-type": "application/json" } });

test("IR-F1 transport: a signal already aborted sends nothing and answers aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const fake = fakeFetch(() => ok("{}"));
  const sent = await sendWithRetries(transportOf(fake.fetch), { method: "GET", url: `${BASE_URL}/x` }, controller.signal);
  assert.equal(fake.sent.length, 0, JSON.stringify(fake.sent));
  assert.equal(sent.ok, false);
  assert.equal(sent.ok ? "" : sent.kind, "aborted");
});

test("IR-F1 transport control: a live signal sends the same request once and gives its body", async () => {
  const fake = fakeFetch(() => ok('{"a":1}'));
  const sent = await sendWithRetries(transportOf(fake.fetch), { method: "GET", url: `${BASE_URL}/x` }, new AbortController().signal);
  assert.deepEqual(sent, { ok: true, text: '{"a":1}' });
  assert.deepEqual(fake.sent, [{ url: `${BASE_URL}/x`, signalAborted: false }]);
});

const model = (id: string) => ({ type: "model", id, display_name: `Fake ${id}`, created_at: "2026-09-21T00:00:00Z" });
const settings = (): AnthropicListSettings => ({ apiKey: FAKE_KEY, apiBaseUrl: BASE_URL, requestTimeoutMs: 5_000, maxRetries: 2 });

test("IR-F1 Anthropic model list: a cancel between page 1 and page 2 sends no page 2", async () => {
  const controller = new AbortController();
  const signal = controller.signal;
  // The cancel arrives right after page 1's attempt has ended (its abort listener is taken off),
  // before the list goes on to page 2: page 1's own checks cannot see it.
  const remove = signal.removeEventListener.bind(signal);
  let removals = 0;
  signal.removeEventListener = ((...args: Parameters<AbortSignal["removeEventListener"]>) => {
    remove(...args);
    removals += 1;
    if (removals === 1) controller.abort();
  }) as AbortSignal["removeEventListener"];
  const pages = [
    { data: [model("fake-model-a")], has_more: true, first_id: "fake-model-a", last_id: "fake-model-a" },
    { data: [model("fake-model-b")], has_more: false, first_id: "fake-model-b", last_id: "fake-model-b" },
  ];
  const fake = fakeFetch((n) => ok(JSON.stringify(pages[Math.min(n, 1)])));
  const outcome = await listAnthropicModels(settings(), { fetch: fake.fetch }, signal);
  assert.equal(removals >= 1, true);
  assert.equal(fake.sent.length, 1, `page requests sent: ${JSON.stringify(fake.sent)}`);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok ? "" : outcome.kind, "aborted");
});

test("IR-F1 Anthropic model list control: two pages without a cancel are joined in order", async () => {
  const pages = [
    { data: [model("fake-model-a")], has_more: true, first_id: "fake-model-a", last_id: "fake-model-a" },
    { data: [model("fake-model-b")], has_more: false, first_id: "fake-model-b", last_id: "fake-model-b" },
  ];
  const fake = fakeFetch((n) => ok(JSON.stringify(pages[Math.min(n, 1)])));
  const outcome = await listAnthropicModels(settings(), { fetch: fake.fetch }, new AbortController().signal);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  assert.deepEqual(outcome.models.map((info) => info.id), ["fake-model-a", "fake-model-b"]);
  assert.equal(fake.sent.length, 2);
  assert.equal(fake.sent.every((request) => request.signalAborted === false), true);
});
