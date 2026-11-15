/**
 * The OpenAI adapter (src/model/openai, SP-5) wired to the fake Responses API (tests/support/
 * fake-openai.ts) without the CLI, which is not connected yet (SP-6). The adapter sends with Node's
 * own fetch to the local fake server; only the retry wait is injected where a case would otherwise
 * wait seconds, and one case lets it really wait and measures the gap on the server. Each case calls
 * `complete` the way the engine does: it echoes the assistant's calls under the engine's ids (AC-D15
 * replaces ids outside its rule) and answers them with tool results.
 * Mock API only, not the real API. The CLI cases o01 to o04 follow once SP-6 is connected.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ERROR_MESSAGE_CHARS } from "../../src/model/http/index.js";
import { REPLACED_CALL_ID_PREFIX, TOOL_NAMES } from "../../src/contracts/index.js";
import type { MaskedText, ModelMessage, ModelOutcome, ModelRequest, ModelResponse, ResolvedApiSettings } from "../../src/contracts/index.js";
import { createOpenAIProvider, listOpenAIModels } from "../../src/model/openai/index.js";
import { CALL_ID_ODD, CREATED_2026_01_01, FAKE_ENCRYPTED_CONTENT, FAKE_OPENAI_MODEL_CATALOG, QUOTA_CASES, skShapedValue } from "../fixtures/openai.js";
import { FAKE_OPENAI_KEY } from "../fixtures/secrets.js";
import { MOCK_LABEL } from "../support/fake-anthropic.js";
import {
  assertContinuation,
  assertOpenAIProtocolClean,
  bearerKeysOf,
  fakeUsage,
  fnCall,
  functionCallOutputsOf,
  inputItemsOf,
  openAIBodyOf,
  openAIBodySources,
  openAIModelsRequests,
  openAIOtherHeaderSources,
  outputMessage,
  repeatOpenAIReply,
  replyCalls,
  replyFailed,
  replyFinal,
  replyIncomplete,
  replyOpenAIError,
  replyQuota,
  replyRateLimit,
  replyRefusal,
  responsesGapsMs,
  responsesRequests,
  startFakeOpenAI,
  toolNamesOf,
} from "../support/fake-openai.js";
import type { FakeOpenAI } from "../support/fake-openai.js";
import { findLeaks } from "../support/leak.js";

const LABEL = `${MOCK_LABEL} OpenAI 어댑터 직접 연결(CLI 없음):`;
const masked = (text: string): MaskedText => text as MaskedText;
const SYSTEM = "SYSTEM TEXT for the fake";
const GOAL: ModelMessage = { role: "user", content: masked("read notes.txt and say what it holds") };
const MODEL = FAKE_OPENAI_MODEL_CATALOG[0]?.id ?? "unused";

function settingsFor(api: FakeOpenAI, overrides: Partial<ResolvedApiSettings> = {}): ResolvedApiSettings {
  return { apiKey: FAKE_OPENAI_KEY, model: MODEL, maxOutputTokens: 1024, apiBaseUrl: api.baseUrl, requestTimeoutMs: 5_000, maxRetries: 2, ...overrides };
}
function request(messages: readonly ModelMessage[]): ModelRequest {
  return { system: masked(SYSTEM), messages, tools: TOOL_NAMES };
}
const live = (): AbortSignal => new AbortController().signal;

/** Retry waits recorded instead of slept. */
function recordedSleep(): { readonly waits: number[]; readonly sleep: (ms: number) => Promise<void> } {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}
function success(outcome: ModelOutcome): ModelResponse {
  if (!outcome.ok) assert.fail(`expected a response, got ${outcome.kind}: ${outcome.message}`);
  return outcome.response;
}
function failure(outcome: ModelOutcome): Extract<ModelOutcome, { ok: false }> {
  if (outcome.ok) assert.fail(`expected a failure, got stop ${outcome.response.stop}`);
  return outcome;
}
/** The key went in `authorization: Bearer` only: never in a body, a path, another header or an outcome. */
function assertKeyInHeaderOnly(api: FakeOpenAI, outcomes: readonly unknown[]): void {
  assert.ok(bearerKeysOf(api).every((key) => key === FAKE_OPENAI_KEY), "every request carries the key as Bearer");
  const sources = [...openAIBodySources(api), ...openAIOtherHeaderSources(api), ...outcomes.map((outcome, index) => ({ label: `outcome ${index}`, text: JSON.stringify(outcome) }))];
  assert.deepEqual(findLeaks(sources, [FAKE_OPENAI_KEY]), []);
}

test(`${LABEL} 한 번의 도구 호출 왕복: 추론 항목과 규칙 밖 call_id를 보낸 그대로 되돌리고 최종 답으로 끝난다`, async (t) => {
  const args = { path: "notes.txt" };
  const api = await startFakeOpenAI(t, [
    replyCalls([fnCall(CALL_ID_ODD, "read_file", args)], { reasoning: 1, usage: fakeUsage(100, 30, { cached: 40, reasoning: 10 }) }),
    replyFinal("notes.txt says hello", fakeUsage(150, 20, { cached: 100 })),
  ]);
  const provider = createOpenAIProvider(settingsFor(api));
  assert.equal(provider.name, "openai");

  const firstOutcome = await provider.complete(request([GOAL]), live());
  const first = success(firstOutcome);
  assert.equal(first.stop, "tool_calls");
  assert.deepEqual(first.toolCalls, [{ id: CALL_ID_ODD, name: "read_file", args }], "the call_id comes to the engine as the provider gave it");
  assert.deepEqual(first.usage, { inputTokens: 100, outputTokens: 30 }, "C-9: cached and reasoning tokens are inside the totals, not added");
  assert.equal(first.reasoningItems, 1);

  // The engine records CALL_ID_ODD (outside AC-D15) under its own id, then echoes and answers it.
  const engineId = `${REPLACED_CALL_ID_PREFIX}1`;
  const echoed: ModelMessage = { role: "assistant", text: masked(""), toolCalls: [{ id: engineId, name: "read_file", argsJson: masked(JSON.stringify(args)) }] };
  const answered: ModelMessage = { role: "tool", results: [{ callId: engineId, tool: "read_file", ok: true, content: masked('{"text":"hello"}'), errorCode: null }] };
  const secondOutcome = await provider.complete(request([GOAL, echoed, answered]), live());
  const second = success(secondOutcome);
  assert.equal(second.stop, "final");
  assert.equal(second.text, "notes.txt says hello");
  assert.deepEqual(second.toolCalls, []);
  assert.deepEqual(second.usage, { inputTokens: 150, outputTokens: 20 });

  // The fake's fact and design rules held, and each request carried the whole conversation.
  assertOpenAIProtocolClean(api);
  assertContinuation(api);
  const [one, two] = responsesRequests(api);
  assert.ok(one !== undefined && two !== undefined);
  assert.equal(one.path, "/v1/responses");
  const body = openAIBodyOf(one);
  assert.equal(body["model"], MODEL);
  assert.equal(body["instructions"], SYSTEM);
  assert.equal(body["max_output_tokens"], 1024);
  assert.equal(body["store"], false);
  assert.deepEqual(toolNamesOf(one), [...TOOL_NAMES]);
  assert.deepEqual(functionCallOutputsOf(two), [{ callId: CALL_ID_ODD, output: '{"text":"hello"}' }], "DR-31 (e): answered under the original call_id");
  assert.equal(two.bodyText.includes(engineId), false, "the engine's id never reaches the provider");
  const reasoning = inputItemsOf(two).filter((item) => item["type"] === "reasoning");
  assert.deepEqual(reasoning.map((item) => item["encrypted_content"]), [FAKE_ENCRYPTED_CONTENT], "C-11: the reasoning item went back as it came");
  assert.equal(JSON.stringify([first, second]).includes(FAKE_ENCRYPTED_CONTENT), false, "the engine never sees the reasoning content");
  assertKeyInHeaderOnly(api, [firstOutcome, secondOutcome]);
});

test(`${LABEL} 할당량 소진 여섯 가지는 quota_exhausted(HTTP 429)이고 다시 보내지 않는다`, async (t) => {
  const api = await startFakeOpenAI(t, QUOTA_CASES.map((quota) => replyQuota(quota)));
  const { waits, sleep } = recordedSleep();
  const outcomes: ModelOutcome[] = [];
  for (const [index, quota] of QUOTA_CASES.entries()) {
    const outcome = await createOpenAIProvider(settingsFor(api), { sleep }).complete(request([GOAL]), live());
    outcomes.push(outcome);
    const failed = failure(outcome);
    assert.equal(failed.kind, "quota_exhausted", quota.label);
    assert.equal(failed.httpStatus, 429, quota.label);
    assert.equal(responsesRequests(api).length, index + 1, `${quota.label}: sent once`);
  }
  assert.deepEqual(waits, [], "no retry wait");
  assertOpenAIProtocolClean(api);
  assertKeyInHeaderOnly(api, outcomes);
});

test(`${LABEL} 빈도 한도 429는 rate_limited로 같은 바이트를 다시 보내고, Retry-After는 최소 대기다`, async (t) => {
  // Every attempt limited: 1 + maxRetries requests with the same body, then rate_limited.
  const limited = await startFakeOpenAI(t, repeatOpenAIReply(replyRateLimit(), 3));
  const allLimited = recordedSleep();
  const exhausted = failure(await createOpenAIProvider(settingsFor(limited), { sleep: allLimited.sleep }).complete(request([GOAL]), live()));
  assert.equal(exhausted.kind, "rate_limited");
  assert.equal(exhausted.httpStatus, 429);
  const sent = responsesRequests(limited);
  assert.equal(sent.length, 3, "1 + maxRetries");
  assert.equal(new Set(sent.map((one) => one.bodyText)).size, 1, "a retry sends exactly the same bytes");
  assert.equal(allLimited.waits.length, 2);

  // A 429 without a code is retried too (C-5), and the next answer is used.
  const recovering = await startFakeOpenAI(t, [replyRateLimit({ withCode: false }), replyFinal("after the limit")]);
  const recovered = success(await createOpenAIProvider(settingsFor(recovering), { sleep: recordedSleep().sleep }).complete(request([GOAL]), live()));
  assert.equal(recovered.text, "after the limit");
  assert.equal(responsesRequests(recovering).length, 2);

  // Retry-After is a minimum (C-6, DR-31 (f)): the recorded wait is at least 3 s.
  const waiting = await startFakeOpenAI(t, [replyRateLimit({ retryAfter: "3" }), replyFinal("ok")]);
  const waited = recordedSleep();
  success(await createOpenAIProvider(settingsFor(waiting), { sleep: waited.sleep }).complete(request([GOAL]), live()));
  assert.equal(waited.waits.length, 1);
  assert.ok((waited.waits[0] ?? 0) >= 3_000, `waited ${String(waited.waits[0])} ms`);

  // With the adapter's own sleep, the server sees the second request at least 1 s after the first.
  const real = await startFakeOpenAI(t, [replyRateLimit({ retryAfter: "1" }), replyFinal("ok")]);
  success(await createOpenAIProvider(settingsFor(real)).complete(request([GOAL]), live()));
  const gap = responsesGapsMs(real)[0] ?? 0;
  assert.ok(gap >= 1_000, `the server saw a gap of ${Math.round(gap)} ms`);

  // 503 is overloaded, retried the same way.
  const busy = await startFakeOpenAI(t, repeatOpenAIReply(replyOpenAIError(503, "server_error", null, { retryAfter: "0" }), 3));
  const overloaded = failure(await createOpenAIProvider(settingsFor(busy), { sleep: recordedSleep().sleep }).complete(request([GOAL]), live()));
  assert.equal(overloaded.kind, "overloaded");
  assert.equal(overloaded.httpStatus, 503);
  assert.equal(responsesRequests(busy).length, 3);

  for (const api of [limited, recovering, waiting, real, busy]) assertOpenAIProtocolClean(api);
});

test(`${LABEL} 출력 한도 잘림(incomplete, max_output_tokens)은 length, 내용 필터와 다른 이유는 api_error`, async (t) => {
  const api = await startFakeOpenAI(t, [
    replyIncomplete("max_output_tokens", [outputMessage("a partial answ")]),
    replyIncomplete("content_filter"),
    replyIncomplete("max_messages"),
  ]);
  const cut = success(await createOpenAIProvider(settingsFor(api)).complete(request([GOAL]), live()));
  assert.equal(cut.stop, "length", "DR-31 (h): the engine ends such a run as it does Anthropic's max_tokens");
  const filtered = failure(await createOpenAIProvider(settingsFor(api)).complete(request([GOAL]), live()));
  assert.equal(filtered.kind, "api_error");
  assert.equal(filtered.message, "the model declined the request (incomplete: content_filter)");
  const other = failure(await createOpenAIProvider(settingsFor(api)).complete(request([GOAL]), live()));
  assert.equal(other.kind, "api_error");
  assert.equal(other.message, "the response is incomplete (reason max_messages)");
  assert.equal(responsesRequests(api).length, 3, "none of these is retried");
  assertOpenAIProtocolClean(api);
});

test(`${LABEL} 거부는 거부 글 없이 고정 문구, failed는 code만 인용, 오류 문구에서 키와 키 모양을 지우고 줄인다`, async (t) => {
  const refusal = "I will not do that cdyRefusalMarker";
  const shaped = skShapedValue("redact");
  const api = await startFakeOpenAI(t, [
    replyRefusal(refusal),
    replyFailed("server_error", "cdyFailureDetail"),
    replyOpenAIError(400, "invalid_request_error", "bad_value", { message: `bad value ${FAKE_OPENAI_KEY} ${shaped} ${"x".repeat(2_000)}` }),
  ]);
  const outcomes: ModelOutcome[] = [];
  for (let index = 0; index < 3; index += 1) outcomes.push(await createOpenAIProvider(settingsFor(api), { sleep: recordedSleep().sleep }).complete(request([GOAL]), live()));
  const [declined, failedResponse, rejected] = outcomes.map((outcome) => failure(outcome));
  assert.ok(declined !== undefined && failedResponse !== undefined && rejected !== undefined);
  assert.equal(declined.kind, "api_error");
  assert.equal(declined.message, "the model declined the request (refusal)");
  assert.equal(failedResponse.kind, "api_error");
  assert.equal(failedResponse.message, "the response failed (code server_error)");
  assert.equal(rejected.kind, "api_error");
  assert.equal(rejected.httpStatus, 400);
  assert.ok(rejected.message.length <= MAX_ERROR_MESSAGE_CHARS, `${rejected.message.length} characters`);
  const texts = outcomes.map((outcome, index) => ({ label: `outcome ${index}`, text: JSON.stringify(outcome) }));
  assert.deepEqual(findLeaks(texts, [FAKE_OPENAI_KEY, shaped, "cdyRefusalMarker", "cdyFailureDetail"]), [], "no key, key shape, refusal text or failure detail in an outcome");
  assert.equal(responsesRequests(api).length, 3, "a 400 is not retried");
  assertOpenAIProtocolClean(api);
});

test(`${LABEL} 모델 목록: GET {주소}/models 한 번(쪽 넘김 없음), id와 생성 시각, 한도는 null, 401은 auth_failed`, async (t) => {
  const api = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
  const listing = { apiKey: FAKE_OPENAI_KEY, apiBaseUrl: api.baseUrl, requestTimeoutMs: 5_000, maxRetries: 2 };
  const outcome = await listOpenAIModels(listing);
  if (!outcome.ok) assert.fail(`${outcome.kind}: ${outcome.message}`);
  assert.deepEqual(outcome.models.map((model) => model.id), FAKE_OPENAI_MODEL_CATALOG.map((model) => model.id), "in API order");
  const first = outcome.models[0];
  assert.ok(first !== undefined);
  assert.equal(first.displayName, first.id, "4.6: the list has no display name");
  assert.equal(first.createdAt, new Date(CREATED_2026_01_01 * 1000).toISOString().replace(".000Z", "Z"), "created (Unix seconds) as RFC 3339");
  assert.equal(first.maxInputTokens, null);
  assert.equal(first.maxOutputTokens, null);
  assert.equal(openAIModelsRequests(api).length, 1);
  assertOpenAIProtocolClean(api);
  assertKeyInHeaderOnly(api, [outcome]);

  const refusing = await startFakeOpenAI(t, [], { models: { models: [], failWith: { status: 401, type: "invalid_request_error", code: "invalid_api_key" } } });
  const refused = await listOpenAIModels({ ...listing, apiBaseUrl: refusing.baseUrl });
  if (refused.ok) assert.fail("a 401 list must fail");
  assert.equal(refused.kind, "auth_failed");
  assert.equal(refused.httpStatus, 401);
  assert.equal(openAIModelsRequests(refusing).length, 1, "auth_failed is not retried");
});
