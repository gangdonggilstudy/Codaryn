/**
 * DR-37 (a): a 401 or 403 from Anthropic quotes nothing of the provider's body, neither its message
 * nor its error type, only a fixed phrase and the request id, as for OpenAI (DR-35 (a)). Fake
 * transport only; the key below is not a credential.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { MaskedText, ModelOutcome, ResolvedAnthropicSettings } from "../../../../src/contracts/index.js";
import { createAnthropicProvider, listAnthropicModels } from "../../../../src/model/anthropic/index.js";

const FAKE_KEY = "codaryn-fake-anthropic-key-0123456789-not-a-credential";
const SETTINGS: ResolvedAnthropicSettings = {
  apiKey: FAKE_KEY,
  model: "test-model",
  maxOutputTokens: 64,
  apiBaseUrl: "https://api.anthropic.test",
  requestTimeoutMs: 5_000,
  maxRetries: 2,
};
const masked = (text: string) => text as MaskedText;

/** The partial echo R-22 L-1 reproduced, here in an Anthropic error body. */
const echo = `invalid x-api-key ${FAKE_KEY.slice(0, 12)}${"*".repeat(30)}${FAKE_KEY.slice(-4)}`;
const body = (status: number) =>
  JSON.stringify({ type: "error", error: { type: status === 401 ? "authentication_error" : "permission_error", message: echo }, request_id: "req_011CAuthTest" });

function fake(status: number) {
  let calls = 0;
  const fetch = (async () => {
    calls += 1;
    return new Response(body(status), { status });
  }) as typeof globalThis.fetch;
  return { deps: { fetch, sleep: async () => {} }, calls: () => calls };
}

describe("DR-37 (a): Anthropic 401 and 403 quote nothing of the provider's body", () => {
  test("a request: the fixed phrase and the request id; no error type, no end of the key", async () => {
    for (const status of [401, 403]) {
      const transport = fake(status);
      const outcome: ModelOutcome = await createAnthropicProvider(SETTINGS, transport.deps).complete(
        { system: masked(""), messages: [{ role: "user", content: masked("hello") }], tools: [] },
        new AbortController().signal,
      );
      assert.equal(outcome.ok, false);
      const failure = outcome as Extract<ModelOutcome, { ok: false }>;
      assert.equal(failure.message, `HTTP ${status}: the key or its access was refused; the provider's message is not shown (request req_011CAuthTest)`);
      assert.deepEqual([failure.kind, failure.httpStatus, transport.calls()], ["auth_failed", status, 1]);
      for (const leaked of [FAKE_KEY.slice(-4), "authentication_error", "permission_error", "invalid x-api-key"]) {
        assert.equal(failure.message.includes(leaked), false, leaked);
      }
    }
  });

  test("the model listing too", async () => {
    const outcome = await listAnthropicModels(SETTINGS, fake(401).deps);
    assert.deepEqual(outcome.ok ? null : [outcome.kind, outcome.message], [
      "auth_failed",
      "HTTP 401: the key or its access was refused; the provider's message is not shown (request req_011CAuthTest)",
    ]);
  });
});
