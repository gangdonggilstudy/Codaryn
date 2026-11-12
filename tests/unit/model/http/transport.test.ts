/**
 * SP-5 (docs/design/second-provider.md 5절, DR-31 (f)): the shared transport's retry-after modes and
 * the error body given to the provider's status reading. Fake transport only; nothing is sent.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ANTHROPIC_KEY_PATTERN_SOURCE, API_KEY_MASK_PATTERN_SOURCES } from "../../../../src/contracts/index.js";
import { MAX_RETRY_AFTER_MS, createKeyMaterialCheck, createRedactor, sendWithRetries } from "../../../../src/model/http/index.js";
import type { LimitedBody, Transport } from "../../../../src/model/http/index.js";

type Reply = { status: number; body?: string; headers?: Record<string, string> };

function transport(replies: readonly Reply[], options: Partial<Pick<Transport, "retryAfter" | "maxRetries">> = {}) {
  const delays: number[] = [];
  const seenBodies: string[] = [];
  let calls = 0;
  const t: Transport = {
    fetch: (async () => {
      const reply = replies[Math.min(calls, replies.length - 1)] as Reply;
      calls += 1;
      return new Response(reply.body ?? "", { status: reply.status, headers: reply.headers ?? {} });
    }) as typeof fetch,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
    headers: {},
    timeoutMs: 5_000,
    maxRetries: options.maxRetries ?? 3,
    classifyStatus: (status: number, body: LimitedBody) => {
      seenBodies.push(new TextDecoder().decode(body.bytes));
      return status === 429 ? { kind: "rate_limited", retryable: true } : { kind: "api_error", retryable: false };
    },
    describeError: (status: number) => `HTTP ${status}`,
    ...(options.retryAfter === undefined ? {} : { retryAfter: options.retryAfter }),
  };
  return { t, delays, seenBodies, calls: () => calls };
}

const limited = (retryAfter?: string): Reply => ({ status: 429, body: '{"error":{"type":"rate_limit_error"}}', headers: retryAfter === undefined ? {} : { "retry-after": retryAfter } });
const ok: Reply = { status: 200, body: "{}" };
const send = (t: Transport) => sendWithRetries(t, { method: "GET", url: "https://api.example.test/x" }, new AbortController().signal);

describe("SP-5: the shared transport's retry-after modes", () => {
  test("cap (the default, Anthropic): the header replaces the backoff, up to the cap", async () => {
    const a = transport([limited("2"), ok]);
    assert.equal((await send(a.t)).ok, true);
    assert.deepEqual(a.delays, [2000]);
    const b = transport([limited("120"), ok]);
    await send(b.t);
    assert.deepEqual(b.delays, [MAX_RETRY_AFTER_MS]);
  });

  test("minimum (OpenAI): the larger of the header and the backoff", async () => {
    const short = transport([limited("0.2"), limited("2"), ok], { retryAfter: "minimum" });
    assert.equal((await send(short.t)).ok, true);
    assert.deepEqual(short.delays, [500, 2000], "200 ms asked, 500 ms backoff; then 2000 ms asked, 1000 ms backoff");
    const none = transport([limited(), limited(), ok], { retryAfter: "minimum" });
    await send(none.t);
    assert.deepEqual(none.delays, [500, 1000], "no header: the backoff");
  });

  test("minimum: a header asking for more than the cap ends the retries instead of retrying early", async () => {
    const long = transport([limited("120"), ok], { retryAfter: "minimum" });
    const sent = await send(long.t);
    assert.equal(sent.ok, false);
    assert.equal(long.calls(), 1);
    assert.deepEqual(long.delays, []);
    assert.deepEqual(sent.ok ? null : [sent.kind, sent.httpStatus], ["rate_limited", 429]);
  });

  test("SP-5: a key shape that needs a word start is found after a space too; a split key still is", () => {
    const key = "codaryn-fake-key-not-a-credential";
    const shaped = ["sk", "proj", "Ab3_Cd4-".repeat(4)].join("-");
    const redact = createRedactor(key, API_KEY_MASK_PATTERN_SOURCES);
    // Like the Anthropic shape, a match in the compact view runs on into the next word.
    assert.equal(redact(`no model; and ${shaped} here`), "no model; and [redacted]");
    assert.equal(redact(`no model; and ${shaped}. Next`), "no model; and [redacted]. Next");
    assert.equal(redact(`split ${shaped.slice(0, 12)}
${shaped.slice(12)} . end`), "split [redacted] . end", "after a word and split");
    assert.equal(redact(`(${shaped.slice(0, 12)}
${shaped.slice(12)})`), "([redacted])", "after a bracket and split, as before");
    assert.equal(redact("run task-runner-for-long-names-and-more-words-here"), "run task-runner-for-long-names-and-more-words-here", "sk- inside a word stays");
    const holds = createKeyMaterialCheck(key, API_KEY_MASK_PATTERN_SOURCES);
    assert.equal(holds(`model and ${shaped}`), true);
    assert.equal(holds(`model ${shaped.slice(0, 12)} ${shaped.slice(12)}`), true);
    assert.equal(holds("model-one"), false);
  });

  test("SP-5: the Anthropic shape (no word start) redacts as before, the word after it included", () => {
    // The compact view runs the match on into the next word; that over-redaction is the pinned behaviour.
    const shaped = ["sk", "ant", "Zz9Yy8Xx7Ww6"].join("-");
    const redact = createRedactor("codaryn-fake-key-not-a-credential", [ANTHROPIC_KEY_PATTERN_SOURCE]);
    assert.equal(redact(`key ${shaped} end`), "key [redacted]");
    assert.equal(redact(`key${shaped}end`), "key[redacted]");
    assert.equal(redact(`key ${shaped.slice(0, 9)}
${shaped.slice(9)} . end`), "key [redacted] . end");
  });

  test("the provider's status reading gets the error body", async () => {
    const a = transport([limited(), ok]);
    await send(a.t);
    assert.deepEqual(a.seenBodies, ['{"error":{"type":"rate_limit_error"}}']);
  });
});
