import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { MaskedText } from "../../../src/contracts/index.js";
import { anthropicAvailability, createAnthropicProvider } from "../../../src/model/index.js";

/** Fake values only. They do not have a real key format. */
const FAKE_KEY = "fake-api-key-not-real-0001";
const FAKE_MODEL = "fake-model-id";

const originalFetch = globalThis.fetch;
let fetchCalls = 0;

beforeEach(() => {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("network use is not allowed in unit tests");
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const request = { system: "s" as MaskedText, messages: [], tools: [] };

test("AD-07 a missing key or model setting is rejected without sending", async () => {
  for (const env of [{}, { ANTHROPIC_API_KEY: FAKE_KEY }, { CODARYN_MODEL: FAKE_MODEL }, { ANTHROPIC_API_KEY: " ", CODARYN_MODEL: FAKE_MODEL }]) {
    assert.equal(anthropicAvailability(env), "not_configured");
    const outcome = await createAnthropicProvider(env).complete(request, new AbortController().signal);
    assert.equal(outcome.ok ? "ok" : outcome.kind, "not_configured");
  }
  assert.equal(fetchCalls, 0);
});

test("AD-07 with settings present, phase 1a still sends nothing and does not reveal the key", async () => {
  const env = { ANTHROPIC_API_KEY: FAKE_KEY, CODARYN_MODEL: FAKE_MODEL };
  assert.equal(anthropicAvailability(env), "not_implemented");
  const outcome = await createAnthropicProvider(env).complete(request, new AbortController().signal);
  assert.equal(outcome.ok ? "ok" : outcome.kind, "not_implemented");
  assert.equal(JSON.stringify(outcome).includes(FAKE_KEY), false);
  assert.equal(fetchCalls, 0);
});
