/**
 * OpenAI runs through the CLI (SP-6) against the fake Responses API (tests/support/fake-openai.ts):
 * OI-01 a tool-call round trip with store: false and strict: false, OI-02 reasoning items sent back
 * and kept out of every record, call ids outside AC-D15 (DR-31 (e)). The address comes from
 * CODARYN_OPENAI_API_BASE_URL; every run is behind the network guard, so nothing goes past 127.0.0.1.
 * Mock API verification only, not the real API.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CALL_ID_PATTERN_SOURCE, CODARYN_OPENAI_API_BASE_URL_ENV, REPLACED_CALL_ID_PREFIX } from "../../src/contracts/index.js";
import type { JournalRecord } from "../../src/contracts/index.js";
import { createSandbox, writeWorkspaceFile } from "../fixtures/builders.js";
import { createFileArgs } from "../fixtures/general-tasks.js";
import { CALL_ID_LONG, CALL_ID_ODD, FAKE_ENCRYPTED_CONTENT, FAKE_OPENAI_MODEL_TASK, writeOpenAITask } from "../fixtures/openai.js";
import { FAKE_OPENAI_KEY } from "../fixtures/secrets.js";
import { cliEnv, expectRunResult, readRunFiles } from "../support/cli.js";
import { MOCK_LABEL, cliOutputSources, runGuarded } from "../support/fake-anthropic.js";
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
  openAIOtherHeaderSources,
  replyCalls,
  replyFinal,
  responsesRequests,
  startFakeOpenAI,
} from "../support/fake-openai.js";
import type { FakeOpenAI } from "../support/fake-openai.js";
import { findLeaks } from "../support/leak.js";

const NOTE = "summary.md";
const NOTE_RULE = { id: "note", kind: "file_rules" as const, rules: [{ type: "contains" as const, path: NOTE, text: "alpha" }] };

function openAIEnv(api: FakeOpenAI): NodeJS.ProcessEnv {
  return cliEnv({ fakeOpenAiKey: FAKE_OPENAI_KEY, extra: { [CODARYN_OPENAI_API_BASE_URL_ENV]: api.baseUrl } });
}

test(`${MOCK_LABEL} OI-01 도구 호출 왕복: 읽기 → 쓰기 → 최종 답이 done/verified, store:false·strict:false, 대화 사슬, 사용량, 키는 Bearer에만`, { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "notes.txt", "alpha beta\n");
  const api = await startFakeOpenAI(t, [
    replyCalls([fnCall("call_r1", "read_file", { path: "notes.txt" })], { usage: fakeUsage(100, 30, { cached: 40, reasoning: 10 }) }),
    replyCalls([fnCall("call_w1", "write_file", createFileArgs(NOTE, "alpha summary\n"))], { usage: fakeUsage(150, 20) }),
    replyFinal("summary written", fakeUsage(180, 10, { cached: 120 })),
  ]);
  const taskPath = writeOpenAITask(sb, { id: "o01-round-trip", verifiers: [NOTE_RULE] });
  const run = await runGuarded(sb, ["run", "--task", taskPath], openAIEnv(api));
  const result = expectRunResult(run, "openai");
  assert.equal(run.exitCode, 0);
  assert.deepEqual([result.status, result.reason], ["done", "verified"]);
  assert.equal(readFileSync(join(sb.workspace, NOTE), "utf8"), "alpha summary\n");
  assert.equal(result.usage.inputTokens, 430, "C-9: the reported input totals, cached tokens inside them");
  assert.equal(result.usage.outputTokens, 60, "C-9: the reported output totals, reasoning tokens inside them");

  assertOpenAIProtocolClean(api);
  assertContinuation(api);
  const requests = responsesRequests(api);
  assert.equal(requests.length, 3);
  for (const request of requests) {
    const body = openAIBodyOf(request);
    assert.equal(request.path, "/v1/responses");
    assert.equal(body["store"], false, "C-11: nothing stored at the provider");
    assert.equal(body["model"], FAKE_OPENAI_MODEL_TASK);
    assert.equal(body["max_output_tokens"], 512);
    assert.equal(typeof body["instructions"], "string");
    const tools = body["tools"];
    assert.ok(Array.isArray(tools) && tools.length > 0);
    for (const tool of tools as Record<string, unknown>[]) {
      assert.equal(tool["type"], "function");
      assert.equal(tool["strict"], false, "SP-D6: strict is sent as false");
      assert.equal("function" in tool, false, "flat tool definitions");
    }
  }
  assert.deepEqual(functionCallOutputsOf(requests[1] ?? assert.fail()).map((output) => output.callId), ["call_r1"]);
  assert.deepEqual(functionCallOutputsOf(requests[2] ?? assert.fail()).map((output) => output.callId), ["call_r1", "call_w1"]);
  assert.ok(functionCallOutputsOf(requests[1] ?? assert.fail())[0]?.output.includes("alpha beta"), "the tool result reaches the model");

  assert.ok(bearerKeysOf(api).every((key) => key === FAKE_OPENAI_KEY));
  const sources = [...openAIBodySources(api), ...openAIOtherHeaderSources(api), ...cliOutputSources(sb.workspace, run)];
  assert.deepEqual(findLeaks(sources, [FAKE_OPENAI_KEY], { extended: true }), [], "the key is in the Authorization header only");
});

test(`${MOCK_LABEL} OI-02 추론 항목은 같은 JSON으로 되돌리고 기록에는 개수만, 규칙 밖 call_id는 기록에 대체 id·요청에 원래 값`, { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  const api = await startFakeOpenAI(t, [
    replyCalls([fnCall(CALL_ID_ODD, "write_file", createFileArgs(NOTE, "alpha one\n"))], { reasoning: 2 }),
    replyCalls([fnCall(CALL_ID_LONG, "read_file", { path: NOTE })], { reasoning: 1 }),
    replyFinal("done"),
  ]);
  const taskPath = writeOpenAITask(sb, { id: "o01-reasoning", verifiers: [NOTE_RULE] });
  const run = await runGuarded(sb, ["run", "--task", taskPath], openAIEnv(api));
  const result = expectRunResult(run, "openai");
  assert.deepEqual([result.status, result.reason], ["done", "verified"]);

  // The fake refuses a request that drops or changes an earlier output item (DESIGN_RULE), so a
  // clean protocol already shows the items went back; the counts below show they were all there.
  assertOpenAIProtocolClean(api);
  assertContinuation(api);
  const [, second, third] = responsesRequests(api);
  const encrypted = (request: typeof second): unknown[] =>
    inputItemsOf(request ?? assert.fail()).filter((item) => item["type"] === "reasoning").map((item) => item["encrypted_content"]);
  assert.deepEqual(encrypted(second), [FAKE_ENCRYPTED_CONTENT, FAKE_ENCRYPTED_CONTENT]);
  assert.deepEqual(encrypted(third), [FAKE_ENCRYPTED_CONTENT, FAKE_ENCRYPTED_CONTENT, FAKE_ENCRYPTED_CONTENT]);
  assert.deepEqual(functionCallOutputsOf(third ?? assert.fail()).map((output) => output.callId), [CALL_ID_ODD, CALL_ID_LONG], "DR-31 (e): answered under the original call_id");

  const files = readRunFiles(sb.workspace, result);
  const responses = files.records.filter((record): record is Extract<JournalRecord, { type: "model_response" }> => record.type === "model_response");
  assert.deepEqual(
    responses.map((record) => record.reasoningItems),
    [2, 1, undefined],
    "SP-D8: the record keeps how many reasoning items came, not what they hold",
  );
  const recordedIds = responses.flatMap((record) => record.toolCalls.map((call) => call.id));
  assert.deepEqual(recordedIds, [`${REPLACED_CALL_ID_PREFIX}1`, `${REPLACED_CALL_ID_PREFIX}2`], "AC-D15: ids outside the rule are replaced in the record");
  assert.ok(recordedIds.every((id) => new RegExp(CALL_ID_PATTERN_SOURCE).test(id)));
  for (const id of recordedIds) assert.equal(JSON.stringify(api.requests.map((request) => request.bodyText)).includes(id), false, "the engine's id never reaches the provider");

  assert.deepEqual(
    findLeaks(cliOutputSources(sb.workspace, run), [FAKE_ENCRYPTED_CONTENT, CALL_ID_ODD, CALL_ID_LONG, FAKE_OPENAI_KEY]),
    [],
    "no reasoning content, original call id or key in stdout, stderr, the journal, result.json or any state file",
  );
});

test(`${MOCK_LABEL} OI-03 OpenAI 실행도 runs·report·changes·revert가 읽는다: 손상으로 보지 않고, 보고서에 추론 내용이 없으며, 되돌릴 수 있다`, { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  const api = await startFakeOpenAI(t, [
    replyCalls([fnCall("call_w1", "write_file", createFileArgs(NOTE, "alpha note\n"))], { reasoning: 1 }),
    replyFinal("done"),
  ]);
  const taskPath = writeOpenAITask(sb, { id: "o01-records", verifiers: [NOTE_RULE] });
  const env = openAIEnv(api);
  const result = expectRunResult(await runGuarded(sb, ["run", "--task", taskPath], env), "openai");
  assert.deepEqual([result.status, result.reason], ["done", "verified"]);

  const runs = await runGuarded(sb, ["runs", "--workspace", sb.workspace, "--json"], env);
  const listed = (JSON.parse(runs.stdout.trim()) as { runs: { runId: string; state: string }[] }).runs;
  assert.notEqual(listed.find((entry) => entry.runId === result.runId)?.state, "damaged", "a finished OpenAI run is not damaged (store's provider list, SP-1)");

  const outputs: { label: string; text: string }[] = [];
  for (const args of [
    ["report", "--workspace", sb.workspace, "--run", result.runId, "--json"],
    ["report", "--workspace", sb.workspace, "--run", result.runId],
    ["changes", "--task", taskPath, "--run", result.runId, "--json"],
    ["revert", "--workspace", sb.workspace, "--run", result.runId, "--dry-run"],
  ]) {
    const one = await runGuarded(sb, args, env);
    assert.equal(one.exitCode, 0, `${args.join(" ")}: ${one.stdout.slice(0, 300)}`);
    outputs.push({ label: `${args[0]} stdout`, text: one.stdout }, { label: `${args[0]} stderr`, text: one.stderr });
  }
  assert.deepEqual(findLeaks(outputs, [FAKE_ENCRYPTED_CONTENT, FAKE_OPENAI_KEY]), [], "no reasoning content or key in a report or a view");
  const revert = await runGuarded(sb, ["revert", "--workspace", sb.workspace, "--run", result.runId], env);
  assert.equal(revert.exitCode, 0, revert.stdout.slice(0, 300));
  assert.equal(existsSync(join(sb.workspace, NOTE)), false, "the file the OpenAI run created is removed again");
});
