/**
 * U-82 (DR-68, the user's decision; U-55 survey Q-2 (b)): the transport already decides, for every
 * failed attempt, whether trying again can help (src/model/http), but the outcome dropped it, so an
 * api_error without an HTTP status (a refused connection, which it retries, against a TLS failure
 * or a refusal, which it does not) could not be told apart. Now a model outcome and a model listing
 * carry that verdict as `retryable`: the transport's for what it sent, the adapter's where it is
 * plain (a malformed response, a refusal, no usable key, a request it could not build: false), and
 * none where it is not known (an unexpected failure, a cancel, OpenAI's failed, cancelled or
 * incomplete response). The engine's modelError and the CLI's facts take it before the kind's rule.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { cliErrorFacts, modelErrorRetryable } from "../../../src/contracts/index.js";
import type { ModelOutcome, ModelRequest, MaskedText, ResolvedApiSettings } from "../../../src/contracts/index.js";
import { createOpenAIProvider } from "../../../src/model/openai/index.js";
import { collectPins } from "./anthropic/sp0-scenarios.js";

/** Every failure outcome in a pinned result, by its path. */
function failures(value: unknown, at = ""): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  if (typeof value !== "object" || value === null) return out;
  const record = value as Record<string, unknown>;
  if (record["ok"] === false && typeof record["kind"] === "string") {
    out.set(at, record);
    return out;
  }
  for (const [key, inner] of Object.entries(record)) for (const [path, found] of failures(inner, `${at}.${key}`)) out.set(path, found);
  return out;
}

describe("U-82: the Anthropic adapter's failures carry the verdict (the SP-0 scenarios)", () => {
  test("all thirty-two failures say retryable, and api_errors without a status are told apart", async () => {
    const found = failures(await collectPins());
    assert.equal(found.size, 32);
    for (const [path, failure] of found) assert.equal(typeof failure["retryable"], "boolean", path);
    const at = (suffix: string) => [...found].find(([path]) => path.endsWith(suffix))?.[1];
    assert.equal(at(".connectionRefusedAlways.outcome")?.["retryable"], true, "the transport retries a refused connection");
    assert.equal(at(".tlsFailure.outcome")?.["retryable"], false);
    assert.equal(at(".formatRefusal.outcome")?.["retryable"], false);
    assert.equal(at(".unknownFailure.outcome")?.["retryable"], false);
    assert.equal(at(".refusal")?.["retryable"], false);
    for (const [path, failure] of found) {
      if (failure["kind"] === "malformed_response") assert.equal(failure["retryable"], false, path);
      if (failure["httpStatus"] === 500 || failure["httpStatus"] === 502 || failure["httpStatus"] === 529) assert.equal(failure["retryable"], true, path);
      if (failure["httpStatus"] === 400 || failure["httpStatus"] === 401 || failure["httpStatus"] === 404) assert.equal(failure["retryable"], false, path);
    }
  });
});

describe("U-82: the OpenAI adapter", () => {
  const SETTINGS: ResolvedApiSettings = { apiKey: "codaryn-fake-openai-key-0123456789-not-a-credential", model: "m", maxOutputTokens: 64, apiBaseUrl: "https://api.openai.test/v1", requestTimeoutMs: 5_000, maxRetries: 0 };
  const REQUEST: ModelRequest = { system: "s" as MaskedText, messages: [{ role: "user", content: "hi" as MaskedText }], tools: ["read_file"] };
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const refused = (async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  }) as unknown as typeof fetch;
  const run = async (fetchImpl: typeof fetch): Promise<Extract<ModelOutcome, { ok: false }>> => {
    const outcome = await createOpenAIProvider(SETTINGS, { fetch: fetchImpl, sleep: async () => {} }).complete(REQUEST, new AbortController().signal);
    assert.equal(outcome.ok, false);
    return outcome as Extract<ModelOutcome, { ok: false }>;
  };

  test("the transport's verdict: a refused connection yes, a 400 no, a 503 yes", async () => {
    assert.equal((await run(refused)).retryable, true);
    assert.equal((await run(reply(400, { error: { message: "bad", type: "invalid_request_error" } }))).retryable, false);
    assert.equal((await run(reply(503, { error: { message: "busy", type: "server_error" } }))).retryable, true);
  });

  test("plain adapter verdicts: malformed and refused no; a failed or cancelled response unknown", async () => {
    assert.equal((await run(reply(200, "not an object"))).retryable, false);
    const failed = await run(reply(200, { id: "r", object: "response", status: "failed", error: { code: "server_error" }, output: [] }));
    assert.equal(Object.hasOwn(failed, "retryable"), false);
    const cancelled = await run(reply(200, { id: "r", object: "response", status: "cancelled", output: [] }));
    assert.equal(Object.hasOwn(cancelled, "retryable"), false);
  });
});

describe("U-82: the verdict comes before the kind's rule; R-71 L1", () => {
  test("modelErrorRetryable takes the outcome's verdict when there is one", () => {
    assert.equal(modelErrorRetryable("api_error"), undefined);
    assert.equal(modelErrorRetryable("api_error", undefined, true), true);
    assert.equal(modelErrorRetryable("api_error", undefined, false), false);
    assert.equal(modelErrorRetryable("api_error", 500, false), false, "the transport's word wins");
  });

  test("cliErrorFacts passes a listing's verdict; config_write_failed has none (unknown)", () => {
    assert.deepEqual(cliErrorFacts("model_list_failed", { kind: "api_error", retryable: true }), { category: "environment", retryable: true });
    assert.deepEqual(cliErrorFacts("model_list_failed", { kind: "api_error" }), { category: "environment" });
    assert.deepEqual(cliErrorFacts("config_write_failed"), { category: "environment" });
  });
});
