/**
 * Self-test of the fake OpenAI Responses API (tests/support/fake-openai.ts) before the OpenAI
 * adapter exists (SP-5). No CLI runs here: requests are sent with fetch to the local fake server,
 * so the fake's own shapes and rules are checked against docs/design/second-provider-facts.md, and
 * a fake that passes everything cannot hide behind o01 to o04 later. Mock API only, not the real API.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ANTHROPIC_API_KEY_ENV, ANTHROPIC_KEY_PATTERN_SOURCE, CALL_ID_PATTERN_SOURCE } from "../../src/contracts/index.js";
import { sharesKeyRun } from "../fixtures/anthropic.js";
import {
  CALL_ID_LONG,
  CALL_ID_ODD,
  CALL_ID_PLAIN,
  CREATED_2026_01_01,
  FAKE_ENCRYPTED_CONTENT,
  FAKE_OPENAI_MODEL_CATALOG,
  LISTED_OPENAI_MODEL_PREFIX,
  LOOSE_SK_SHAPE,
  OPENAI_KEY_ENV,
  OPENAI_MODELS_PATH,
  OPENAI_RESPONSES_PATH,
  QUOTA_CASES,
  skShapedValue,
} from "../fixtures/openai.js";
import { FAKE_API_KEYS, FAKE_OPENAI_KEY, FAKE_SECRET_A } from "../fixtures/secrets.js";
import { REPO_ROOT, cliEnv } from "../support/cli.js";
import { MOCK_LABEL } from "../support/fake-anthropic.js";
import {
  DESIGN_RULE,
  OPENAI_HANG,
  assertContinuation,
  assertOpenAIProtocolClean,
  bearerKeysOf,
  continuationProblems,
  fakeUsage,
  fnCall,
  functionCallOutputsOf,
  openAIModelsRequests,
  replyCalls,
  replyFailed,
  replyFinal,
  replyIncomplete,
  replyOpenAIError,
  replyOpenAIFlood,
  replyQuota,
  replyRateLimit,
  replyRefusal,
  responsesRequests,
  startFakeOpenAI,
  toolNamesOf,
} from "../support/fake-openai.js";
import type { FakeOpenAI } from "../support/fake-openai.js";

const LABEL = `${MOCK_LABEL} 가짜 OpenAI 서버 자체 시험:`;
type Json = Record<string, unknown>;

function rec(value: unknown, what: string): Json {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${what} must be an object`);
  return value as Json;
}
function list(value: unknown, what: string): unknown[] {
  assert.ok(Array.isArray(value), `${what} must be a list`);
  return value;
}

const TOOL: Json = {
  type: "function",
  name: "read_file",
  description: "Read a file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  strict: false,
};
const GOAL_ITEM: Json = { role: "user", content: `goal with ${FAKE_SECRET_A}` };

function validBody(overrides: Json = {}): Json {
  return { model: `${LISTED_OPENAI_MODEL_PREFIX}alpha`, instructions: "system text", input: [GOAL_ITEM], tools: [TOOL], max_output_tokens: 1024, store: false, ...overrides };
}
function validHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${FAKE_OPENAI_KEY}`, "content-type": "application/json", ...extra };
}

interface Sent {
  readonly status: number;
  readonly headers: Headers;
  readonly json: unknown;
}
async function send(
  api: FakeOpenAI,
  body: unknown,
  options: { readonly headers?: Record<string, string>; readonly method?: string; readonly path?: string; readonly raw?: boolean } = {},
): Promise<Sent> {
  const method = options.method ?? "POST";
  const response = await fetch(`${api.url}${options.path ?? OPENAI_RESPONSES_PATH}`, {
    method,
    headers: options.headers ?? validHeaders(),
    ...(method === "GET" ? {} : { body: options.raw === true ? String(body) : JSON.stringify(body) }),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, json };
}
function errorOf(sent: Sent): Json {
  return rec(rec(sent.json, "error answer")["error"], "error");
}
function outputOf(sent: Sent): Json[] {
  return list(rec(sent.json, "response")["output"], "output").map((item, index) => rec(item, `output[${index}]`));
}

test(`${LABEL} 규약대로 이어 가는 두 요청(추론 항목과 도구 호출 → 결과 → 최종 답), 응답 모양이 사실 문서와 같다`, async (t) => {
  const usage = fakeUsage(100, 30, { cached: 40, reasoning: 10 });
  const api = await startFakeOpenAI(t, [replyCalls([fnCall(CALL_ID_PLAIN, "read_file", { path: "a.txt" })], { reasoning: 1, usage }), replyFinal("done")]);
  assert.equal(api.baseUrl, `${api.url}/v1`);

  const first = await send(api, validBody());
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-request-id"), "req_fake_1", "C-6: x-request-id on every answer");
  const response = rec(first.json, "response");
  assert.equal(response["object"], "response");
  assert.equal(response["status"], "completed", "C-10: tool calls end as completed too");
  assert.equal(response["model"], `${LISTED_OPENAI_MODEL_PREFIX}alpha`);
  assert.equal(response["incomplete_details"], null);
  assert.equal(response["error"], null);
  assert.deepEqual(response["usage"], {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 40 },
    output_tokens: 30,
    output_tokens_details: { reasoning_tokens: 10 },
    total_tokens: 130,
  });
  const output = outputOf(first);
  assert.deepEqual(output.map((item) => item["type"]), ["reasoning", "function_call"]);
  assert.equal(output[0]?.["encrypted_content"], FAKE_ENCRYPTED_CONTENT, "C-11: reasoning comes as encrypted content");
  assert.deepEqual(output[0]?.["summary"], []);
  assert.equal(output[1]?.["call_id"], CALL_ID_PLAIN);
  assert.equal(output[1]?.["name"], "read_file");
  assert.equal(output[1]?.["arguments"], JSON.stringify({ path: "a.txt" }), "C-8: arguments is a JSON string");
  assert.notEqual(output[1]?.["id"], output[1]?.["call_id"], "C-8: id and call_id are different fields");

  const second = await send(api, validBody({ input: [GOAL_ITEM, ...output, { type: "function_call_output", call_id: CALL_ID_PLAIN, output: "file text" }] }));
  assert.equal(second.status, 200);
  const final = outputOf(second);
  assert.equal(final.length, 1);
  assert.equal(final[0]?.["type"], "message");
  assert.equal(final[0]?.["role"], "assistant");
  assert.deepEqual(final[0]?.["content"], [{ type: "output_text", text: "done", annotations: [] }]);

  assertOpenAIProtocolClean(api);
  assertContinuation(api);
  const requests = responsesRequests(api);
  assert.equal(requests.length, 2);
  assert.deepEqual(functionCallOutputsOf(requests[1] ?? assert.fail()), [{ callId: CALL_ID_PLAIN, output: "file text" }]);
  assert.deepEqual(toolNamesOf(requests[0] ?? assert.fail()), ["read_file"]);
  assert.deepEqual(bearerKeysOf(api), [FAKE_OPENAI_KEY, FAKE_OPENAI_KEY]);
});

test(`${LABEL} 사실 문서 규칙을 어긴 요청은 400과 OpenAI 오류 본문, 대본을 쓰지 않고, 메시지에 키·본문 값이 없다`, async (t) => {
  const api = await startFakeOpenAI(t, []);
  const nestedTool = { type: "function", function: { name: "read_file", parameters: { type: "object" } }, strict: false };
  const cases: { label: string; body?: unknown; headers?: Record<string, string>; method?: string; path?: string; raw?: boolean; expect: string }[] = [
    { label: "PUT", method: "PUT", expect: "method is not POST (C-1)" },
    { label: "query", path: `${OPENAI_RESPONSES_PATH}?trace=1`, expect: `the request has a query string ${DESIGN_RULE}` },
    { label: "no bearer", headers: { "content-type": "application/json" }, expect: 'authorization is not "Bearer <key>" (C-2)' },
    { label: "key in x-api-key", headers: validHeaders({ "x-api-key": FAKE_OPENAI_KEY }), expect: `x-api-key header is sent ${DESIGN_RULE}` },
    { label: "anthropic-version", headers: validHeaders({ "anthropic-version": "2023-06-01" }), expect: `anthropic-version header is sent ${DESIGN_RULE}` },
    { label: "organization", headers: validHeaders({ "openai-organization": "org-cdy" }), expect: `openai-organization header is sent ${DESIGN_RULE}` },
    { label: "project", headers: validHeaders({ "openai-project": "proj-cdy" }), expect: `openai-project header is sent ${DESIGN_RULE}` },
    { label: "content-type", headers: validHeaders({ "content-type": "text/plain" }), expect: "content-type is not application/json" },
    { label: "not JSON", body: "{", raw: true, expect: "body is not a JSON object" },
    { label: "no model", body: validBody({ model: "" }), expect: "model is missing" },
    { label: "input text", body: validBody({ input: "hello" }), expect: "input is not a list (C-8)" },
    { label: "instructions number", body: validBody({ instructions: 3 }), expect: "instructions is not a string" },
    { label: "max_output_tokens 15", body: validBody({ max_output_tokens: 15 }), expect: "max_output_tokens is missing, not an integer or below 16 (C-10)" },
    { label: "max_output_tokens left out", body: validBody({ max_output_tokens: undefined }), expect: "below 16 (C-10)" },
    { label: "max_output_tokens 16.5", body: validBody({ max_output_tokens: 16.5 }), expect: "below 16 (C-10)" },
    { label: "store left out", body: validBody({ store: undefined }), expect: "store is not false (C-11" },
    { label: "store true", body: validBody({ store: true }), expect: "store is not false (C-11" },
    { label: "messages", body: validBody({ messages: [] }), expect: "messages is sent, a Chat Completions field (C-1)" },
    { label: "previous_response_id", body: validBody({ previous_response_id: "resp_1" }), expect: "previous_response_id is sent while nothing is stored (C-11)" },
    { label: "stream", body: validBody({ stream: true }), expect: `stream is not false ${DESIGN_RULE}` },
    { label: "nested tool", body: validBody({ tools: [nestedTool] }), expect: 'tools[0] wraps its definition in "function", the Chat Completions shape (C-7)' },
    { label: "strict left out", body: validBody({ tools: [{ ...TOOL, strict: undefined }] }), expect: "tools[0].strict is not false (C-7: left out means strict; SP-D6)" },
    { label: "strict true", body: validBody({ tools: [{ ...TOOL, strict: true }] }), expect: "tools[0].strict is not false" },
    { label: "tool name space", body: validBody({ tools: [{ ...TOOL, name: "read file" }] }), expect: "tools[0].name is missing or outside ^[a-zA-Z0-9_-]{1,64}$ (C-7)" },
    { label: "tool name 65", body: validBody({ tools: [{ ...TOOL, name: "n".repeat(65) }] }), expect: "tools[0].name is missing or outside" },
    { label: "tool repeated", body: validBody({ tools: [TOOL, TOOL] }), expect: "tools[1].name is repeated" },
    { label: "parameters", body: validBody({ tools: [{ ...TOOL, parameters: { type: "string" } }] }), expect: "tools[0].parameters is not an object schema (C-7)" },
    {
      label: "output not text",
      body: validBody({ input: [GOAL_ITEM, { type: "function_call", call_id: "c1", name: "read_file", arguments: "{}" }, { type: "function_call_output", call_id: "c1", output: { text: 1 } }] }),
      expect: "input[2].output is not a string (C-8)",
    },
    { label: "unknown item", body: validBody({ input: [GOAL_ITEM, { type: "input_image" }] }), expect: `input[1].type is not a message, function_call, function_call_output or reasoning item ${DESIGN_RULE}` },
    { label: "bad role", body: validBody({ input: [{ role: "tool", content: "x" }] }), expect: "input[0].role is not a message role" },
  ];
  for (const one of cases) {
    const sent = await send(api, one.body ?? validBody(), {
      ...(one.headers === undefined ? {} : { headers: one.headers }),
      ...(one.method === undefined ? {} : { method: one.method }),
      ...(one.path === undefined ? {} : { path: one.path }),
      ...(one.raw === undefined ? {} : { raw: one.raw }),
    });
    assert.equal(sent.status, 400, one.label);
    const error = errorOf(sent);
    assert.equal(error["type"], "invalid_request_error", one.label);
    assert.equal(error["code"], null, one.label);
    assert.equal(error["param"], null, one.label);
    const message = String(error["message"]);
    assert.ok(message.includes(one.expect), `${one.label}: ${message}`);
    assert.ok(!message.includes(FAKE_OPENAI_KEY) && !message.includes(FAKE_SECRET_A), `${one.label}: no header or body value in the message`);
    const recorded = api.requests.at(-1) ?? assert.fail();
    assert.equal(recorded.outcome, "violation", one.label);
    assert.ok(recorded.violations.some((line) => line.includes(one.expect)), one.label);
  }
  assert.ok(
    api.requests.every((request) => request.answeredOutput === null),
    "no violation used a script step",
  );

  const unknown = await send(api, validBody(), { path: "/v1/chat/completions" });
  assert.equal(unknown.status, 404);
  assert.equal(api.requests.at(-1)?.endpoint, "other");
  assert.equal(api.requests.at(-1)?.outcome, "violation");
});

test(`${LABEL} 설계 규칙: 직전 응답의 출력 항목을 모두 같은 순서·같은 JSON으로 되돌리고, call_id로 짝을 맞춘다(규칙 밖 call_id 포함)`, async (t) => {
  const api = await startFakeOpenAI(t, [replyCalls([fnCall(CALL_ID_ODD, "read_file", { path: "a.txt" })], { reasoning: 1 }), replyFinal("ok")]);
  const first = await send(api, validBody());
  assert.equal(first.status, 200);
  const [reasoning, call] = outputOf(first);
  assert.ok(reasoning !== undefined && call !== undefined);
  const answer = (callId: string): Json => ({ type: "function_call_output", call_id: callId, output: "text" });
  const attempts: { label: string; input: unknown[]; expect: readonly string[] }[] = [
    { label: "reasoning left out", input: [GOAL_ITEM, call, answer(CALL_ID_ODD)], expect: ["does not carry every output item of the previous response"] },
    { label: "encrypted content changed", input: [GOAL_ITEM, { ...reasoning, encrypted_content: "changed" }, call, answer(CALL_ID_ODD)], expect: ["does not carry every output item"] },
    { label: "order swapped", input: [GOAL_ITEM, call, reasoning, answer(CALL_ID_ODD)], expect: ["does not carry every output item"] },
    {
      label: "call_id changed in the answer",
      input: [GOAL_ITEM, reasoning, call, answer(CALL_ID_PLAIN)],
      expect: ["input[3] function_call_output has no earlier function_call with that call_id", "input has 1 function_call(s) without a function_call_output"],
    },
    { label: "answered twice", input: [GOAL_ITEM, reasoning, call, answer(CALL_ID_ODD), answer(CALL_ID_ODD)], expect: ["input[4] answers a function_call a second time"] },
  ];
  for (const attempt of attempts) {
    const sent = await send(api, validBody({ input: attempt.input }));
    assert.equal(sent.status, 400, attempt.label);
    const recorded = api.requests.at(-1) ?? assert.fail();
    for (const expected of attempt.expect) {
      const line = recorded.violations.find((one) => one.includes(expected));
      assert.ok(line !== undefined, `${attempt.label}: ${recorded.violations.join(" | ")}`);
      assert.ok(line.endsWith(DESIGN_RULE), `${attempt.label}: a design rule says so`);
    }
  }
  const good = await send(api, validBody({ input: [GOAL_ITEM, reasoning, call, answer(CALL_ID_ODD)] }));
  assert.equal(good.status, 200, "the right request still gets the second step");
  assert.equal(outputOf(good)[0]?.["type"], "message");
  assert.deepEqual(functionCallOutputsOf(responsesRequests(api).at(-1) ?? assert.fail()), [{ callId: CALL_ID_ODD, output: "text" }], "the odd call_id is kept as sent");
});

function textOf(sent: Sent): unknown {
  return outputOf(sent)[0]?.["content"];
}
const REPAIR_ITEM: Json = { role: "user", content: "the check failed; fix it" };

test(`${LABEL} 위반은 대본을 쓰지 않고, 앞 응답과 무관한 새 대화는 받으며, 대본이 다하면 exhausted`, async (t) => {
  const api = await startFakeOpenAI(t, [replyFinal("one"), replyFinal("two")]);
  assert.equal((await send(api, validBody({ store: true }))).status, 400, "a violation first");
  assert.deepEqual(textOf(await send(api, validBody())), [{ type: "output_text", text: "one", annotations: [] }], "the violation used no step");
  const fresh = await send(api, validBody({ input: [GOAL_ITEM, REPAIR_ITEM] }));
  assert.equal(fresh.status, 200, "a request without any model item starts a new conversation (another run on the same server)");
  assert.deepEqual(textOf(fresh), [{ type: "output_text", text: "two", annotations: [] }]);
  const exhausted = await send(api, validBody());
  assert.equal(exhausted.status, 400);
  assert.equal(api.requests.at(-1)?.outcome, "exhausted");
  assert.ok(String(errorOf(exhausted)["message"]).includes("no scripted answer left"));
});

test(`${LABEL} 최종 답 뒤의 재수정 요청은 그 메시지 항목을 보낸 그대로 되돌려야 한다`, async (t) => {
  const api = await startFakeOpenAI(t, [replyFinal("one"), replyFinal("fixed")]);
  const start = await send(api, validBody());
  const reply = outputOf(start);
  const rewritten = await send(api, validBody({ input: [GOAL_ITEM, { role: "assistant", content: "one" }, REPAIR_ITEM] }));
  assert.equal(rewritten.status, 400, "the reply rewritten as a plain assistant message is not the item that was sent");
  assert.ok(api.requests.at(-1)?.violations.some((line) => line.includes("does not carry every output item")));
  const repaired = await send(api, validBody({ input: [GOAL_ITEM, ...reply, REPAIR_ITEM] }));
  assert.equal(repaired.status, 200);
  assert.deepEqual(textOf(repaired), [{ type: "output_text", text: "fixed", annotations: [] }]);
  assertContinuation(api);
});

test(`${LABEL} 대화 사슬은 서버가 막지 않고 continuationProblems가 찾는다`, async (t) => {
  const api = await startFakeOpenAI(t, [replyCalls([fnCall("c1", "read_file", { path: "a" })]), replyFinal("x")]);
  const first = await send(api, validBody());
  const otherStart: Json = { role: "user", content: "a different goal" };
  const second = await send(api, validBody({ input: [otherStart, ...outputOf(first), { type: "function_call_output", call_id: "c1", output: "t" }] }));
  assert.equal(second.status, 200, "the server accepts it (Q-3: the chain is a case assertion)");
  assert.deepEqual(continuationProblems(api), ["request 2 does not start with request 1's input and the output it was answered with"]);
});

test(`${LABEL} 응답 모양: incomplete 이유, failed의 error, 거부 조각, 사용량 없음`, async (t) => {
  const api = await startFakeOpenAI(t, [
    replyIncomplete("max_output_tokens"),
    replyIncomplete("content_filter"),
    replyFailed("server_error", "the model failed"),
    replyRefusal("I cannot help with that"),
    replyFinal("no usage", null),
  ]);
  const incomplete = rec((await send(api, validBody())).json, "incomplete");
  assert.equal(incomplete["status"], "incomplete");
  assert.deepEqual(incomplete["incomplete_details"], { reason: "max_output_tokens" });
  assert.deepEqual(rec((await send(api, validBody())).json, "filtered")["incomplete_details"], { reason: "content_filter" });
  const failed = rec((await send(api, validBody())).json, "failed");
  assert.equal(failed["status"], "failed");
  assert.deepEqual(failed["error"], { code: "server_error", message: "the model failed" });
  assert.deepEqual(failed["output"], []);
  const refusal = outputOf(await send(api, validBody()));
  assert.deepEqual(refusal[0]?.["content"], [{ type: "refusal", refusal: "I cannot help with that" }], "C-15");
  const noUsage = rec((await send(api, validBody())).json, "no usage");
  assert.equal("usage" in noUsage, false);
  assertOpenAIProtocolClean(api);
});

test(`${LABEL} 오류 본문과 머리글: 429 빈도(code slow_down·없음), 할당량 여섯 가지, 503과 retry-after`, async (t) => {
  const api = await startFakeOpenAI(t, [
    replyRateLimit({ retryAfter: "2" }),
    replyRateLimit({ withCode: false }),
    ...QUOTA_CASES.map((quota) => replyQuota(quota)),
    replyOpenAIError(503, "server_error", null, { retryAfter: "1" }),
    replyOpenAIError(401, "invalid_request_error", "invalid_api_key"),
  ]);
  const limited = await send(api, validBody());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "2", "C-6");
  assert.ok((limited.headers.get("x-request-id") ?? "").startsWith("req_fake_"));
  assert.deepEqual(errorOf(limited), { message: "fake rate_limit_error", type: "rate_limit_error", code: "slow_down", param: null });
  const noCode = await send(api, validBody());
  assert.equal(errorOf(noCode)["code"], null);
  assert.equal(noCode.headers.get("retry-after"), null);
  assert.equal(QUOTA_CASES.length, 6);
  for (const quota of QUOTA_CASES) {
    const sent = await send(api, validBody());
    assert.equal(sent.status, 429, quota.label);
    assert.equal(errorOf(sent)["type"], quota.type, quota.label);
    assert.equal(errorOf(sent)["code"], quota.code, quota.label);
  }
  const unavailable = await send(api, validBody());
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("retry-after"), "1");
  const rejected = await send(api, validBody());
  assert.equal(rejected.status, 401);
  assert.equal(errorOf(rejected)["code"], "invalid_api_key");
  assertOpenAIProtocolClean(api);
});

test(`${LABEL} 모델 목록: 사실 문서 모양, 쪽 넘김 없음, Bearer, 목록 없음·오류·형식 오류`, async (t) => {
  const api = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
  const listed = await send(api, null, { method: "GET", path: OPENAI_MODELS_PATH });
  assert.equal(listed.status, 200);
  const page = rec(listed.json, "models list");
  assert.equal(page["object"], "list");
  assert.equal("has_more" in page, false, "C-12: no paging fields");
  const data = list(page["data"], "data").map((model, index) => rec(model, `data[${index}]`));
  assert.deepEqual(data.map((model) => model["id"]), FAKE_OPENAI_MODEL_CATALOG.map((model) => model.id));
  assert.deepEqual(data[0], { id: `${LISTED_OPENAI_MODEL_PREFIX}alpha`, object: "model", created: CREATED_2026_01_01, owned_by: "cdy-owner" });
  assert.equal(data[1]?.["shutdown_date"], "2027-04-01");

  const paged = await send(api, null, { method: "GET", path: `${OPENAI_MODELS_PATH}?limit=2` });
  assert.equal(paged.status, 400);
  assert.ok(api.requests.at(-1)?.violations.some((line) => line.includes("no paging parameters (C-12)") && line.endsWith(DESIGN_RULE)));
  assert.equal((await send(api, null, { method: "GET", path: OPENAI_MODELS_PATH, headers: { "x-api-key": FAKE_OPENAI_KEY } })).status, 400);
  assert.equal(openAIModelsRequests(api).length, 3);

  const none = await startFakeOpenAI(t, []);
  const missing = await send(none, null, { method: "GET", path: OPENAI_MODELS_PATH });
  assert.equal(missing.status, 404);
  assert.equal(none.requests.at(-1)?.outcome, "exhausted");

  const failing = await startFakeOpenAI(t, [], { models: { models: [], failWith: { status: 401, type: "invalid_request_error", code: "invalid_api_key" } } });
  const refused = await send(failing, null, { method: "GET", path: OPENAI_MODELS_PATH });
  assert.equal(refused.status, 401);
  assert.equal(errorOf(refused)["code"], "invalid_api_key");

  const notList = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG, malformed: "data_not_list" } });
  assert.deepEqual(rec((await send(notList, null, { method: "GET", path: OPENAI_MODELS_PATH })).json, "list")["data"], {});
  const badId = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG, malformed: "id_not_string" } });
  const badData = list(rec((await send(badId, null, { method: "GET", path: OPENAI_MODELS_PATH })).json, "list")["data"], "data");
  assert.equal(rec(badData[0], "data[0]")["id"], 42);
});

test(`${LABEL} 응답하지 않는 요청은 클라이언트가 끊고, 큰 본문은 다 보내며, 끝없는 본문은 끊긴 것을 센다`, async (t) => {
  const finite = replyOpenAIFlood(200, 300_000);
  const endless = replyOpenAIFlood(200, null);
  const api = await startFakeOpenAI(t, [OPENAI_HANG, finite.reply, endless.reply]);
  await assert.rejects(
    fetch(`${api.url}${OPENAI_RESPONSES_PATH}`, { method: "POST", headers: validHeaders(), body: JSON.stringify(validBody()), signal: AbortSignal.timeout(300) }),
    (error: Error) => error.name === "TimeoutError" || error.name === "AbortError",
  );
  const big = await fetch(`${api.url}${OPENAI_RESPONSES_PATH}`, { method: "POST", headers: validHeaders(), body: JSON.stringify(validBody()) });
  const bigText = await big.text();
  assert.ok(bigText.length >= 300_000);
  assert.equal(rec(JSON.parse(bigText) as unknown, "flood")["object"], "response");
  assert.equal(finite.sent.closedEarly, false);

  const controller = new AbortController();
  const flowing = await fetch(`${api.url}${OPENAI_RESPONSES_PATH}`, { method: "POST", headers: validHeaders(), body: JSON.stringify(validBody()), signal: controller.signal });
  const reader = flowing.body?.getReader() ?? assert.fail("a body");
  await reader.read();
  controller.abort();
  await reader.cancel().catch(() => undefined);
  for (let waited = 0; !endless.sent.closedEarly && waited < 5_000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(endless.sent.closedEarly, true, "the server saw the client hang up");
  assert.equal(responsesRequests(api).length, 3);
});

test(`${LABEL} cliEnv는 가짜 OpenAI 키만 OPENAI_API_KEY로 넣고, 키 변수는 extra로도 개발자 환경에서도 넘어가지 않는다`, () => {
  const env = cliEnv({ fakeOpenAiKey: FAKE_OPENAI_KEY });
  assert.equal(env[OPENAI_KEY_ENV], FAKE_OPENAI_KEY);
  assert.equal(env[ANTHROPIC_API_KEY_ENV], undefined);
  assert.throws(() => cliEnv({ fakeOpenAiKey: "cdy-not-a-listed-fake-key" }), /fake API keys/);
  assert.throws(() => cliEnv({ fakeOpenAiKey: skShapedValue("guard") }), /fake API keys/);
  assert.throws(() => cliEnv({ extra: { [OPENAI_KEY_ENV]: FAKE_OPENAI_KEY } }), /never set an API key/);
  assert.throws(() => cliEnv({ extra: { openai_api_key: FAKE_OPENAI_KEY } }), /never set an API key/);
  const saved = process.env[OPENAI_KEY_ENV];
  process.env[OPENAI_KEY_ENV] = "cdy-developer-sentinel-value";
  try {
    assert.equal(Object.values(cliEnv()).includes("cdy-developer-sentinel-value"), false, "a developer's OPENAI_API_KEY never reaches the CLI");
  } finally {
    if (saved === undefined) delete process.env[OPENAI_KEY_ENV];
    else process.env[OPENAI_KEY_ENV] = saved;
  }
});

test(`${LABEL} fixture 불변식: 가짜 키는 키 모양이 아니고, 목록 id는 키와 8자를 겹치지 않으며, sk- 모양은 실행 중에만 생긴다`, () => {
  for (const key of FAKE_API_KEYS) {
    assert.equal(LOOSE_SK_SHAPE.test(key), false, "no fake key has the loose sk- shape");
    assert.equal(new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE).test(key), false);
    for (const model of FAKE_OPENAI_MODEL_CATALOG) assert.equal(sharesKeyRun(model.id, key), false, `${model.id} shares eight characters with a fake key`);
  }
  assert.ok(FAKE_OPENAI_MODEL_CATALOG.every((model) => model.id.startsWith(LISTED_OPENAI_MODEL_PREFIX)));
  const shaped = skShapedValue("probe");
  assert.match(shaped, new RegExp(["\\bs", "k-[A-Za-z0-9_-]{20,}"].join("")), "the loose shape of design 4.3");
  assert.ok(LOOSE_SK_SHAPE.test(shaped));
  const literal = new RegExp(["s", "k-[A-Za-z0-9]"].join(""));
  for (const file of ["tests/fixtures/openai.ts", "tests/support/fake-openai.ts", "tests/integration/o00-fake-openai.test.ts"]) {
    assert.equal(literal.test(readFileSync(join(REPO_ROOT, file), "utf8")), false, `${file} holds no key-shaped text`);
  }
  const callId = new RegExp(CALL_ID_PATTERN_SOURCE);
  assert.equal(CALL_ID_LONG.length, 100);
  assert.equal(callId.test(CALL_ID_LONG), false, "DR-31 (e): outside the record's id rule");
  assert.equal(callId.test(CALL_ID_ODD), false);
  assert.equal(callId.test(CALL_ID_PLAIN), true);
});
