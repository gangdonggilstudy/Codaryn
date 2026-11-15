/**
 * U-143 (SP-U05, design gap survey C-7): the shared transport's invariants, seen through the
 * OpenAI adapter. The shared module has its own tests; these show the OpenAI path keeps them too:
 * the key in the header only, redirects not followed, the success body limit, the request time
 * limit, connection, TLS and format errors told apart and retried or not, the provider's message
 * cleaned. A fake fetch only: nothing is sent to any network, and the key is not a credential.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { MaskedText, ModelOutcome, ModelRequest, ResolvedApiSettings } from "../../../../src/contracts/index.js";
import { MAX_SUCCESS_BODY_BYTES } from "../../../../src/model/http/index.js";
import { createOpenAIProvider } from "../../../../src/model/openai/index.js";

const FAKE_KEY = ["codaryn", "fake", "openai", "u143", "0123456789", "not", "a", "credential"].join("-");
const BASE = "https://api.openai.test/v1";
const SETTINGS: ResolvedApiSettings = { apiKey: FAKE_KEY, model: "test-model-a", maxOutputTokens: 1024, apiBaseUrl: BASE, requestTimeoutMs: 5_000, maxRetries: 2 };
const REQUEST: ModelRequest = { system: "be brief" as MaskedText, messages: [{ role: "user", content: "hello" as MaskedText }], tools: ["read_file"] };

type Answer = Response | { readonly throws: unknown } | "hang";
interface Seen {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly redirect: string | undefined;
}

/** A fake fetch answering call N with answer N (the last one repeats); "hang" waits for the abort. */
function transport(answers: readonly (() => Answer)[]) {
  const seen: Seen[] = [];
  const delays: number[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) }, body: String(init?.body ?? ""), redirect: init?.redirect });
    const answer = (answers[Math.min(seen.length - 1, answers.length - 1)] as () => Answer)();
    if (answer === "hang") {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }
    if ("throws" in answer) throw answer.throws;
    return answer;
  }) as typeof globalThis.fetch;
  return { deps: { fetch, sleep: async (ms: number) => void delays.push(ms) }, seen, delays };
}

const completed = (): Response =>
  new Response(JSON.stringify({ id: "resp_1", object: "response", status: "completed", output: [{ type: "message", id: "m1", status: "completed", role: "assistant", content: [{ type: "output_text", text: "hi", annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });

async function complete(answers: readonly (() => Answer)[], settings: ResolvedApiSettings = SETTINGS) {
  const fake = transport(answers);
  const outcome = await createOpenAIProvider(settings, fake.deps).complete(REQUEST, new AbortController().signal);
  return { outcome, ...fake };
}

function failure(outcome: ModelOutcome): Extract<ModelOutcome, { ok: false }> {
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  return outcome as Extract<ModelOutcome, { ok: false }>;
}

const connectionError = (code: string): unknown => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });

describe("U-143 SP-U05: the OpenAI path keeps the shared transport's invariants", () => {
  test("the key is in the Authorization header only: not in the URL or the body, on every attempt", async () => {
    const { seen } = await complete([() => new Response("{}", { status: 500 }), () => completed()]);
    assert.equal(seen.length, 2);
    for (const request of seen) {
      assert.equal(request.headers["authorization"], `Bearer ${FAKE_KEY}`);
      assert.equal(request.url.includes(FAKE_KEY), false);
      assert.equal(request.body.includes(FAKE_KEY), false);
      assert.deepEqual(Object.keys(request.headers).sort(), ["authorization", "content-type"]);
    }
  });

  test("redirects are not followed: fetch is told so, a 3xx is one attempt, nothing goes to its Location", async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const { outcome, seen } = await complete([() => new Response(null, { status, headers: { location: "https://elsewhere.test/steal" } })]);
      assert.equal(seen.length, 1, String(status));
      assert.equal(seen[0]?.redirect, "manual");
      assert.equal(seen.some((request) => request.url.includes("elsewhere.test")), false);
      const failed = failure(outcome);
      assert.deepEqual([failed.kind, failed.httpStatus, failed.retryable], ["api_error", status, false]);
      assert.match(failed.message, /redirects are not followed, so the key is not sent elsewhere/);
    }
  });

  test("a success body over the limit is a malformed response, not retried", async () => {
    const big = "x".repeat(MAX_SUCCESS_BODY_BYTES + 1);
    const { outcome, seen } = await complete([() => new Response(big, { status: 200 })]);
    assert.equal(seen.length, 1);
    const failed = failure(outcome);
    assert.deepEqual([failed.kind, failed.retryable], ["malformed_response", false]);
    assert.match(failed.message, new RegExp(`larger than ${MAX_SUCCESS_BODY_BYTES} bytes`));
  });

  test("the request time limit: timeout, retried up to maxRetries, then told with the attempts", async () => {
    const { outcome, seen, delays } = await complete([() => "hang"], { ...SETTINGS, requestTimeoutMs: 30 });
    assert.equal(seen.length, 3, "1 + maxRetries");
    assert.equal(delays.length, 2);
    const failed = failure(outcome);
    assert.deepEqual([failed.kind, failed.retryable], ["timeout", true]);
    assert.equal(failed.message, "the request did not finish within 30 ms (after 3 attempts)");
  });

  test("a connection error is retried and then told by its code; a recovery in between succeeds", async () => {
    const refused = await complete([() => ({ throws: connectionError("ECONNREFUSED") })]);
    assert.equal(refused.seen.length, 3);
    const failed = failure(refused.outcome);
    assert.deepEqual([failed.kind, failed.retryable, failed.httpStatus], ["api_error", true, undefined]);
    assert.equal(failed.message, "network error: connection failed (ECONNREFUSED) (after 3 attempts)");
    const recovered = await complete([() => ({ throws: connectionError("ECONNRESET") }), () => completed()]);
    assert.equal(recovered.seen.length, 2);
    assert.equal(recovered.outcome.ok, true);
  });

  test("a TLS failure and a format error are not retried", async () => {
    const tls = await complete([() => ({ throws: connectionError("CERT_HAS_EXPIRED") })]);
    assert.equal(tls.seen.length, 1);
    assert.deepEqual([failure(tls.outcome).kind, failure(tls.outcome).retryable, failure(tls.outcome).message], ["api_error", false, "network error: TLS connection failed (CERT_HAS_EXPIRED)"]);
    const format = await complete([() => ({ throws: new TypeError("Invalid header value") })]);
    assert.equal(format.seen.length, 1);
    assert.deepEqual(
      [failure(format.outcome).kind, failure(format.outcome).retryable, failure(format.outcome).message],
      ["api_error", false, "the transport refused the request format (header, URL or port); nothing was sent"],
    );
  });

  test("an error of no known kind is not retried and carries no verdict (R-75 L2)", async () => {
    const odd = await complete([() => ({ throws: new Error("something else") })]);
    assert.equal(odd.seen.length, 1);
    const failed = failure(odd.outcome);
    assert.equal(failed.message, "network error: unknown transport failure");
    assert.equal(Object.hasOwn(failed, "retryable"), false);
  });

  test("the provider's message is cleaned: no key, no control character, whatever the body holds", async () => {
    const body = JSON.stringify({ error: { type: "server_error", code: null, message: `bad things ${FAKE_KEY} \u001b[31mred\u0007 done` } });
    const { outcome } = await complete([() => new Response(body, { status: 500 })], { ...SETTINGS, maxRetries: 0 });
    const failed = failure(outcome);
    assert.equal(failed.httpStatus, 500);
    assert.equal(failed.message.includes(FAKE_KEY), false, failed.message);
    assert.equal(/[\u0000-\u001f\u007f]/.test(failed.message), false, JSON.stringify(failed.message));
  });

  test("a cancel while the request is in flight ends as aborted, not as a failure to retry", async () => {
    const controller = new AbortController();
    const fake = transport([() => "hang"]);
    const pending = createOpenAIProvider(SETTINGS, fake.deps).complete(REQUEST, controller.signal);
    setTimeout(() => controller.abort(), 10);
    const failed = failure(await pending);
    assert.equal(failed.kind, "aborted");
    assert.equal(fake.seen.length, 1);
  });
});
