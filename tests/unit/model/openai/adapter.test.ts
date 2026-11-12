/**
 * SP-5: the OpenAI Responses API adapter (docs/design/second-provider.md 10, SP-U08 to SP-U11), with
 * a fake transport only. Nothing is sent to any network; the key below is not a credential.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { REPLACED_CALL_ID_PREFIX, TOOL_DEFINITIONS, WORKFLOW_TOOL_DEFINITIONS } from "../../../../src/contracts/index.js";
import type { MaskedText, ModelOutcome, ModelRequest, ResolvedApiSettings, ToolName, WorkflowToolName } from "../../../../src/contracts/index.js";
import { runTask } from "../../../../src/engine/index.js";
import { OPENAI_QUOTA_ERROR_CODES, createOpenAIProvider, listOpenAIModels } from "../../../../src/model/openai/index.js";
import { FakeVerifiers, harness } from "../../engine/fakes.js";

const FAKE_KEY = "codaryn-fake-openai-key-0123456789-not-a-credential";
const BASE = "https://api.openai.test/v1";
const SETTINGS: ResolvedApiSettings = {
  apiKey: FAKE_KEY,
  model: "test-model-a",
  maxOutputTokens: 1024,
  apiBaseUrl: BASE,
  requestTimeoutMs: 5_000,
  maxRetries: 2,
};

type Reply = { readonly status: number; readonly body?: unknown; readonly headers?: Record<string, string> };
interface SentRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly raw: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly body: any;
}

/** A fake transport answering request N with reply N (the last one repeats). */
function fake(replies: readonly Reply[]) {
  const sent: SentRequest[] = [];
  const delays: number[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const raw = init?.body === undefined || init.body === null ? undefined : String(init.body);
    sent.push({
      url: String(url),
      method: String(init?.method),
      headers: { ...(init?.headers as Record<string, string>) },
      raw,
      body: raw === undefined ? undefined : JSON.parse(raw),
    });
    const reply = replies[Math.min(sent.length - 1, replies.length - 1)] as Reply;
    const text = reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return new Response(text, { status: reply.status, headers: reply.headers ?? {} });
  }) as typeof globalThis.fetch;
  const sleep = async (ms: number) => {
    delays.push(ms);
  };
  return { deps: { fetch, sleep }, sent, delays };
}

const message = (...texts: string[]) => ({
  type: "message",
  id: "msg_0001",
  status: "completed",
  role: "assistant",
  content: texts.map((text) => ({ type: "output_text", text, annotations: [] })),
});
const functionCall = (callId: string, name: string, args: object) => ({
  type: "function_call",
  id: "fc_0001",
  call_id: callId,
  name,
  arguments: JSON.stringify(args),
  status: "completed",
});
const reasoning = (n: number) => ({ type: "reasoning", id: `rs_000${n}`, summary: [], encrypted_content: `opaque-reasoning-${n}` });
const USAGE = { input_tokens: 10, input_tokens_details: { cached_tokens: 4 }, output_tokens: 7, output_tokens_details: { reasoning_tokens: 3 }, total_tokens: 17 };
const completed = (output: unknown[], extra: object = {}): Reply => ({
  status: 200,
  body: { id: "resp_0001", object: "response", status: "completed", output, usage: USAGE, ...extra },
});
const apiError = (status: number, error: object, headers?: Record<string, string>): Reply => ({
  status,
  body: { error: { message: "something", param: null, ...error } },
  ...(headers === undefined ? {} : { headers }),
});

const masked = (text: string): MaskedText => text as MaskedText;
const REQUEST: ModelRequest = { system: masked("be brief"), messages: [{ role: "user", content: masked("hello") }], tools: ["read_file"] };
const signal = () => new AbortController().signal;

async function once(replies: readonly Reply[], request: ModelRequest = REQUEST, settings: ResolvedApiSettings = SETTINGS) {
  const transport = fake(replies);
  const outcome = await createOpenAIProvider(settings, transport.deps).complete(request, signal());
  return { outcome, ...transport };
}

function failure(outcome: ModelOutcome) {
  assert.equal(outcome.ok, false);
  return outcome as Extract<ModelOutcome, { ok: false }>;
}

describe("SP-U08: the request", () => {
  test("POST /responses, the key in the Bearer header only, the documented fields in order", async () => {
    const { outcome, sent } = await once([completed([message("hi")])]);
    assert.equal(outcome.ok, true);
    assert.equal(sent.length, 1);
    const [request] = sent as [SentRequest];
    assert.equal(request.url, `${BASE}/responses`);
    assert.equal(request.method, "POST");
    assert.deepEqual(request.headers, { "content-type": "application/json", authorization: `Bearer ${FAKE_KEY}` });
    assert.deepEqual(Object.keys(request.body), ["model", "instructions", "input", "tools", "max_output_tokens", "store"]);
    assert.equal(request.body.model, "test-model-a");
    assert.equal(request.body.instructions, "be brief");
    assert.deepEqual(request.body.input, [{ type: "message", role: "user", content: "hello" }]);
    assert.deepEqual(request.body.tools, [
      { type: "function", name: "read_file", description: TOOL_DEFINITIONS.read_file.description, parameters: TOOL_DEFINITIONS.read_file.inputSchema, strict: false },
    ]);
    assert.equal(request.body.max_output_tokens, 1024);
    assert.equal(request.body.store, false, "DR-31 (c): the provider keeps no copy");
    assert.equal(request.raw?.includes(FAKE_KEY), false);
    assert.equal(request.url.includes(FAKE_KEY), false);
  });

  test("no system text gives no instructions; workflow tools follow; a repeated tool is sent once", async () => {
    const workflow = Object.keys(WORKFLOW_TOOL_DEFINITIONS)[0] as WorkflowToolName;
    const { sent } = await once([completed([message("hi")])], {
      system: masked(""),
      messages: [{ role: "user", content: masked("hello") }],
      tools: ["read_file", "write_file", "read_file"] as ToolName[],
      workflowTools: [workflow],
    });
    const body = (sent[0] as SentRequest).body;
    assert.equal(Object.hasOwn(body, "instructions"), false);
    assert.deepEqual(
      body.tools.map((tool: { name: string }) => tool.name),
      ["read_file", "write_file", workflow],
    );
    assert.ok(body.tools.every((tool: { strict: unknown; type: unknown }) => tool.strict === false && tool.type === "function"));
  });

  test("a tool without a definition sends nothing", async () => {
    const { outcome, sent } = await once([completed([])], { ...REQUEST, tools: ["no_such_tool" as ToolName] });
    assert.match(failure(outcome).message, /^request not sent: tool "no_such_tool" has no definition$/);
    assert.equal(sent.length, 0);
  });

  test("settings: at least 16 output tokens (the provider table), https unless loopback", () => {
    assert.throws(() => createOpenAIProvider({ ...SETTINGS, maxOutputTokens: 15 }), TypeError);
    assert.doesNotThrow(() => createOpenAIProvider({ ...SETTINGS, maxOutputTokens: 16 }));
    assert.throws(() => createOpenAIProvider({ ...SETTINGS, apiBaseUrl: "http://api.openai.test/v1" }), TypeError);
    assert.doesNotThrow(() => createOpenAIProvider({ ...SETTINGS, apiBaseUrl: "http://127.0.0.1:8080/v1" }));
    assert.throws(() => createOpenAIProvider({ ...SETTINGS, model: " " }), TypeError);
  });

  test("an unusable key or a cancel before sending: nothing is sent", async () => {
    const spaced = await once([completed([])], REQUEST, { ...SETTINGS, apiKey: "has a space" });
    assert.equal(failure(spaced.outcome).kind, "not_configured");
    assert.equal(spaced.sent.length, 0);
    const transport = fake([completed([])]);
    const controller = new AbortController();
    controller.abort();
    const outcome = await createOpenAIProvider(SETTINGS, transport.deps).complete(REQUEST, controller.signal);
    assert.equal(failure(outcome).kind, "aborted");
    assert.equal(transport.sent.length, 0);
  });
});

describe("SP-U09: the response", () => {
  test("completed without a call is final: the texts joined, usage as given (nothing added), no reasoning count", async () => {
    const { outcome } = await once([completed([message("one ", "two"), message(" three")])]);
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.response, { stop: "final", text: "one two three", toolCalls: [], usage: { inputTokens: 10, outputTokens: 7 } });
  });

  test("completed with function calls is tool_calls; reasoning items are counted, not read", async () => {
    const { outcome } = await once([completed([reasoning(1), message("let me look"), functionCall("call_a", "read_file", { path: "a.txt" }), functionCall("call_b", "search_files", { query: "x" })])]);
    assert.ok(outcome.ok);
    assert.equal(outcome.response.stop, "tool_calls");
    assert.equal(outcome.response.text, "let me look");
    assert.deepEqual(outcome.response.toolCalls, [
      { id: "call_a", name: "read_file", args: { path: "a.txt" } },
      { id: "call_b", name: "search_files", args: { query: "x" } },
    ]);
    assert.equal(outcome.response.reasoningItems, 1);
    assert.equal(JSON.stringify(outcome).includes("opaque-reasoning"), false);
  });

  test("usage missing or not counts is unknown (null)", async () => {
    const { outcome } = await once([completed([message("hi")], { usage: { input_tokens: -1, output_tokens: 2 } })]);
    assert.ok(outcome.ok);
    assert.equal(outcome.response.usage, null);
  });

  test("incomplete at max_output_tokens is length; its calls are not read", async () => {
    const { outcome } = await once([
      { status: 200, body: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [message("partial"), { type: "function_call", call_id: "c", name: "read_file", arguments: '{"pa' }], usage: USAGE } },
    ]);
    assert.ok(outcome.ok);
    assert.deepEqual([outcome.response.stop, outcome.response.text, outcome.response.toolCalls.length], ["length", "partial", 0]);
  });

  test("a refusal or a content filter: declined, the refusal text is not quoted", async () => {
    const refusal = await once([completed([{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "private reason text" }] }])]);
    assert.deepEqual([failure(refusal.outcome).kind, failure(refusal.outcome).message], ["api_error", "the model declined the request (refusal)"]);
    const filtered = await once([{ status: 200, body: { status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] } }]);
    assert.equal(failure(filtered.outcome).message, "the model declined the request (incomplete: content_filter)");
  });

  test("other incomplete reasons, failed and cancelled are api_error, quoting identifiers only", async () => {
    const cases: [unknown, string][] = [
      [{ status: "incomplete", incomplete_details: { reason: "max_messages" }, output: [] }, "the response is incomplete (reason max_messages)"],
      [{ status: "incomplete", incomplete_details: { reason: "not an identifier!" }, output: [] }, "the response is incomplete"],
      [{ status: "failed", error: { code: "server_error", message: "private detail" }, output: [] }, "the response failed (code server_error)"],
      [{ status: "cancelled", output: [] }, "the provider cancelled the response"],
    ];
    for (const [body, expected] of cases) {
      const { outcome } = await once([{ status: 200, body }]);
      assert.deepEqual([failure(outcome).kind, failure(outcome).message], ["api_error", expected], expected);
    }
  });

  test("structure the adapter does not know is malformed_response", async () => {
    const cases: [unknown, RegExp][] = [
      ["not json", /the body is not JSON/],
      [[1], /not a JSON object/],
      [{ output: [] }, /status is not a string/],
      [{ status: "queued", output: [] }, /unexpected status "queued"/],
      [{ status: "completed", output: {} }, /output is not an array/],
      [{ status: "completed", output: [{ id: 1 }] }, /output item 0 has no type/],
      [{ status: "completed", output: [{ type: "web_search_call" }] }, /unexpected output item type "web_search_call"/],
      [{ status: "completed", output: [{ type: "message", content: "x" }] }, /message item 0 has no content list/],
      [{ status: "completed", output: [{ type: "message", content: [{ type: "output_audio" }] }] }, /unexpected content part type/],
      [{ status: "completed", output: [{ type: "function_call", name: "read_file", arguments: "{}" }] }, /has no call_id/],
      [{ status: "completed", output: [{ type: "function_call", call_id: "c", name: "read_file", arguments: "{" }] }, /arguments are not JSON/],
      [{ status: "completed", output: [{ type: "function_call", call_id: "c", name: "read_file", arguments: "[]" }] }, /arguments are not a JSON object/],
      [{ status: "completed", output: [functionCall("c", "read_file", {}), functionCall("c", "read_file", {})] }, /repeats an earlier call_id/],
    ];
    for (const [body, pattern] of cases) {
      const { outcome } = await once([{ status: 200, body }]);
      assert.equal(failure(outcome).kind, "malformed_response", String(pattern));
      assert.match(failure(outcome).message, pattern);
    }
  });
});

describe("SP-U09: errors, quota and retry-after", () => {
  test("429 rate limits are retried; retry-after is a minimum wait", async () => {
    const short = await once([apiError(429, { type: "rate_limit_error", code: "slow_down" }, { "retry-after": "0.2" }), completed([message("ok")])]);
    assert.equal(short.outcome.ok, true);
    assert.deepEqual(short.delays, [500], "200 ms asked, the 500 ms backoff is longer");
    const long = await once([apiError(429, { type: "rate_limit_error" }, { "retry-after": "2" }), completed([message("ok")])]);
    assert.deepEqual(long.delays, [2000]);
    const tooLong = await once([apiError(429, { type: "rate_limit_error" }, { "retry-after": "120" }), completed([message("ok")])]);
    assert.deepEqual([failure(tooLong.outcome).kind, tooLong.sent.length, tooLong.delays.length], ["rate_limited", 1, 0]);
    const usedUp = await once([apiError(429, { type: "rate_limit_error" })]);
    assert.deepEqual([failure(usedUp.outcome).kind, failure(usedUp.outcome).httpStatus, usedUp.sent.length], ["rate_limited", 429, 3]);
  });

  test("quota: type insufficient_quota or a billing code is quota_exhausted and not retried", async () => {
    const bodies = [{ type: "insufficient_quota" }, ...OPENAI_QUOTA_ERROR_CODES.map((code) => ({ type: "invalid_request_error", code }))];
    assert.equal(OPENAI_QUOTA_ERROR_CODES.length, 5);
    for (const error of bodies) {
      const { outcome, sent, delays } = await once([apiError(429, error), completed([message("ok")])]);
      assert.deepEqual([failure(outcome).kind, failure(outcome).httpStatus, sent.length, delays.length], ["quota_exhausted", 429, 1, 0], JSON.stringify(error));
    }
  });

  test("statuses: 401 and 403 auth_failed, 503 overloaded (retried), 500 retried, 400 and 404 not", async () => {
    const cases: [number, string, number][] = [
      [401, "auth_failed", 1],
      [403, "auth_failed", 1],
      [503, "overloaded", 3],
      [500, "api_error", 3],
      [400, "api_error", 1],
      [404, "api_error", 1],
    ];
    for (const [status, kind, attempts] of cases) {
      const { outcome, sent } = await once([apiError(status, { type: "x" })]);
      assert.deepEqual([failure(outcome).kind, failure(outcome).httpStatus, sent.length], [kind, status, attempts], String(status));
    }
  });

  test("an error quotes its type, code, message and request id; the key and key shapes are removed", async () => {
    const keyShaped = ["sk", "proj", "Ab3_Cd4-".repeat(4)].join("-");
    const { outcome } = await once([
      apiError(400, { type: "invalid_request_error", code: "model_not_found", message: `no model; key ${FAKE_KEY} and ${keyShaped}` }, { "x-request-id": "req_abc123" }),
    ]);
    const text = failure(outcome).message;
    assert.match(text, /^HTTP 400 invalid_request_error \(code model_not_found\): no model; key \[redacted\] and \[redacted\] \(request req_abc123\)$/);
    assert.equal(text.includes(FAKE_KEY), false);
    const html = await once([{ status: 502, body: "<html>proxy</html>", headers: { "x-request-id": "bad id!" } }], REQUEST, { ...SETTINGS, maxRetries: 0 });
    assert.equal(failure(html.outcome).message, "HTTP 502 (the error body is not a JSON error object and is not shown)");
  });
});

describe("SP-U11: kept output items and call ids, with the real engine", () => {
  const ODD_ID = "call id with spaces";

  test("a call id outside AC-D15 is recorded under another id, answered under its own; reasoning goes back as it came", async () => {
    const first = [reasoning(1), functionCall(ODD_ID, "read_file", { path: "a.txt" })];
    const transport = fake([completed(first), completed([reasoning(2), message("done")])]);
    const run = harness({ steps: [] });
    const result = await runTask({ ...run.deps, model: createOpenAIProvider(SETTINGS, transport.deps) });
    assert.deepEqual([result.status, result.reason], ["done", "verified"]);
    assert.equal(transport.sent.length, 2);

    const [one, two] = transport.sent as [SentRequest, SentRequest];
    const before = one.body.input.length;
    assert.deepEqual(two.body.input.slice(0, before), one.body.input, "the conversation so far, unchanged");
    assert.deepEqual(two.body.input.slice(before, before + 2), first, "the first response's items, reasoning included, as they came");
    const output = two.body.input[before + 2];
    assert.equal(output.type, "function_call_output");
    assert.equal(output.call_id, ODD_ID, "answered under the provider's own call_id");
    assert.equal(typeof output.output, "string");
    assert.equal(two.body.input.length, before + 3);

    const responses = run.journal.ofType("model_response");
    assert.ok(responses[0]?.toolCalls[0]?.id.startsWith(REPLACED_CALL_ID_PREFIX), "recorded under the engine's id");
    assert.deepEqual(responses.map((r) => r.reasoningItems), [1, 1], "the count is recorded");
    const recorded = JSON.stringify(run.journal.events) + JSON.stringify(result);
    assert.equal(recorded.includes("opaque-reasoning"), false, "no reasoning content in the record or the result");
    assert.equal(recorded.includes(ODD_ID), false, "the pairing is not recorded");
    assert.equal(recorded.includes(FAKE_KEY), false);
  });

  test("a final answer followed by a repair message: the answer's items go back before the repair", async () => {
    const answer = [reasoning(1), message("first answer")];
    const transport = fake([completed(answer), completed([message("fixed")])]);
    const run = harness({ steps: [], task: { limits: { maxRepairAttempts: 1 } }, verifiers: new FakeVerifiers({ v1: ["fail", "pass"] }) });
    const result = await runTask({ ...run.deps, model: createOpenAIProvider(SETTINGS, transport.deps) });
    assert.equal(result.status, "done");
    const [one, two] = transport.sent as [SentRequest, SentRequest];
    const before = one.body.input.length;
    assert.deepEqual(two.body.input.slice(before, before + 2), answer);
    assert.equal(two.body.input[before + 2].role, "user", "then the repair message");
  });

  test("an assistant message this provider did not return is sent as the engine has it", async () => {
    const { sent } = await once([completed([message("ok")])], {
      system: masked(""),
      tools: ["read_file"],
      messages: [
        { role: "user", content: masked("hello") },
        { role: "assistant", text: masked("looking"), toolCalls: [{ id: "codaryn-call-1", name: "read_file", argsJson: masked('{"path":"a.txt"}') }] },
        { role: "tool", results: [{ callId: "codaryn-call-1", tool: "read_file", ok: true, content: masked('{"content":"x"}'), errorCode: null }] },
      ],
    });
    assert.deepEqual((sent[0] as SentRequest).body.input.slice(1), [
      { type: "message", role: "assistant", content: "looking" },
      { type: "function_call", call_id: "codaryn-call-1", name: "read_file", arguments: '{"path":"a.txt"}' },
      { type: "function_call_output", call_id: "codaryn-call-1", output: '{"content":"x"}' },
    ]);
  });
});

describe("listOpenAIModels", () => {
  test("GET /models with the Bearer header; the id names the model, created becomes RFC 3339, no token limits", async () => {
    const transport = fake([
      {
        status: 200,
        body: {
          object: "list",
          data: [
            { id: "model-one", object: "model", created: 1_700_000_000, owned_by: "system" },
            { id: "model-two", object: "model", owned_by: "system", shutdown_date: "2027-04-01" },
          ],
        },
      },
    ]);
    const listed = await listOpenAIModels(SETTINGS, transport.deps);
    assert.deepEqual(listed, {
      ok: true,
      models: [
        { id: "model-one", displayName: "model-one", createdAt: "2023-11-14T22:13:20Z", maxInputTokens: null, maxOutputTokens: null },
        { id: "model-two", displayName: "model-two", createdAt: null, maxInputTokens: null, maxOutputTokens: null },
      ],
    });
    const [request] = transport.sent as [SentRequest];
    assert.deepEqual([request.url, request.method, request.headers], [`${BASE}/models`, "GET", { authorization: `Bearer ${FAKE_KEY}` }]);
  });

  test("a list it does not know is malformed_response; an error keeps its kind and status", async () => {
    const cases: [unknown, RegExp][] = [
      [{ object: "list" }, /data is not an array/],
      [{ data: [{ object: "model" }] }, /entry 0 has no string id/],
      [{ data: [{ id: "has space" }] }, /entry 0 has an id that is empty/],
      [{ data: [{ id: "a" }, { id: "a" }] }, /entry 1 repeats an earlier id/],
      [{ data: [{ id: `m-${FAKE_KEY.slice(5, 15)}` }] }, /entry 0 holds key material/],
    ];
    for (const [body, pattern] of cases) {
      const outcome = await listOpenAIModels(SETTINGS, fake([{ status: 200, body }]).deps);
      assert.equal(outcome.ok, false);
      assert.match(outcome.ok ? "" : outcome.message, pattern);
      assert.equal(outcome.ok ? "" : outcome.message.includes(FAKE_KEY.slice(5, 15)), false);
    }
    const denied = await listOpenAIModels(SETTINGS, fake([apiError(401, { type: "invalid_request_error", code: "invalid_api_key" })]).deps);
    assert.deepEqual(denied.ok ? null : [denied.kind, denied.httpStatus], ["auth_failed", 401]);
  });

  test("bad settings or an unusable key: not_configured, nothing is sent", async () => {
    const plain = fake([]);
    const outcome = await listOpenAIModels({ ...SETTINGS, apiBaseUrl: "http://api.openai.test/v1" }, plain.deps);
    assert.deepEqual(outcome.ok ? null : [outcome.kind, plain.sent.length], ["not_configured", 0]);
    const spaced = await listOpenAIModels({ ...SETTINGS, apiKey: "has a space" }, plain.deps);
    assert.deepEqual(spaced.ok ? null : [spaced.kind, plain.sent.length], ["not_configured", 0]);
  });
});

describe("SP-U10 (names): every tool name fits the safe function name pattern", () => {
  test("built-in and workflow tools", () => {
    for (const name of [...Object.keys(TOOL_DEFINITIONS), ...Object.keys(WORKFLOW_TOOL_DEFINITIONS)]) {
      assert.match(name, /^[a-zA-Z0-9_-]{1,64}$/, name);
    }
  });
});
