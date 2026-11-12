/**
 * OpenAI failures through the CLI (SP-5, SP-6, DR-31 (f), (h)) against the fake Responses API:
 * quota exhausted (six forms, never retried), rate limits retried with the same bytes and
 * Retry-After as a minimum wait (measured on the server), 503 overloaded, a response cut at
 * max_output_tokens, a refusal and a content filter. Every run is behind the network guard.
 * Mock API verification only, not the real API.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CODARYN_OPENAI_API_BASE_URL_ENV } from "../../src/contracts/index.js";
import type { JournalRecord } from "../../src/contracts/index.js";
import { createSandbox, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { QUOTA_CASES, writeOpenAITask } from "../fixtures/openai.js";
import { FAKE_OPENAI_KEY } from "../fixtures/secrets.js";
import { cliEnv, expectRunResult, readRunFiles } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { MOCK_LABEL, cliOutputSources, runGuarded } from "../support/fake-anthropic.js";
import {
  assertOpenAIProtocolClean,
  outputMessage,
  repeatOpenAIReply,
  replyFinal,
  replyIncomplete,
  replyOpenAIError,
  replyQuota,
  replyRateLimit,
  replyRefusal,
  responsesGapsMs,
  responsesRequests,
  startFakeOpenAI,
} from "../support/fake-openai.js";
import type { FakeOpenAI, FakeOpenAIReply } from "../support/fake-openai.js";
import { findLeaks } from "../support/leak.js";

const SEED = "seed.txt";
const SEED_RULE = { id: "seed", kind: "file_rules" as const, rules: [{ type: "exists" as const, path: SEED }] };

interface Outcome {
  readonly run: CliRun;
  readonly status: string;
  readonly reason: string;
  readonly errors: readonly Extract<JournalRecord, { type: "model_error" }>[];
}

async function openAIRun(t: Parameters<typeof createSandbox>[0], steps: readonly FakeOpenAIReply[]): Promise<{ sb: Sandbox; api: FakeOpenAI; outcome: Outcome }> {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, SEED, "seed\n");
  const api = await startFakeOpenAI(t, steps);
  const run = await runGuarded(
    sb,
    ["run", "--task", writeOpenAITask(sb, { id: "o03-errors", verifiers: [SEED_RULE] })],
    cliEnv({ fakeOpenAiKey: FAKE_OPENAI_KEY, extra: { [CODARYN_OPENAI_API_BASE_URL_ENV]: api.baseUrl } }),
  );
  const result = expectRunResult(run, "openai");
  const records = readRunFiles(sb.workspace, result).records;
  const errors = records.filter((record): record is Extract<JournalRecord, { type: "model_error" }> => record.type === "model_error");
  assert.deepEqual(findLeaks(cliOutputSources(sb.workspace, run), [FAKE_OPENAI_KEY]), [], "the key is in no output or record");
  return { sb, api, outcome: { run, status: result.status, reason: result.reason, errors } };
}

/** failed/model_error with one model_error record of `kind`; the progress line names the kind (progress.model_error). */
function assertModelError(outcome: Outcome, kind: string): void {
  assert.deepEqual([outcome.status, outcome.reason, outcome.run.exitCode], ["failed", "model_error", 1]);
  assert.deepEqual(outcome.errors.map((record) => record.kind), [kind]);
  assert.ok(outcome.run.stderr.includes(`turn 1 — model request failed (${kind})`), `stderr names the kind: ${outcome.run.stderr.slice(0, 600)}`);
}

test(`${MOCK_LABEL} 할당량 소진 여섯 가지: failed/model_error, 기록 quota_exhausted, 요청 1건(다시 보내지 않음)`, { timeout: 120_000 }, async (t) => {
  for (const quota of QUOTA_CASES) {
    const { api, outcome } = await openAIRun(t, [replyQuota(quota)]);
    assertModelError(outcome, "quota_exhausted");
    assert.equal(responsesRequests(api).length, 1, `${quota.label}: not retried`);
    assertOpenAIProtocolClean(api);
  }
});

test(`${MOCK_LABEL} 빈도 한도 429: 1 + maxRetries번 같은 바이트로 보낸 뒤 rate_limited, Retry-After는 서버가 본 최소 간격, 503 뒤 회복`, { timeout: 120_000 }, async (t) => {
  const limited = await openAIRun(t, repeatOpenAIReply(replyRateLimit(), 3));
  assertModelError(limited.outcome, "rate_limited");
  const sent = responsesRequests(limited.api);
  assert.equal(sent.length, 3, "maxRetries 2 from the task's provider settings default");
  assert.equal(new Set(sent.map((request) => request.bodyText)).size, 1, "every retry sends the same bytes");

  const waited = await openAIRun(t, [replyRateLimit({ retryAfter: "2" }), replyFinal("after the wait")]);
  assert.deepEqual([waited.outcome.status, waited.outcome.reason], ["done", "verified"]);
  const gap = responsesGapsMs(waited.api)[0] ?? 0;
  assert.ok(gap >= 2_000, `C-6: Retry-After 2 is a minimum wait; the server saw ${Math.round(gap)} ms`);

  const busy = await openAIRun(t, [replyOpenAIError(503, "server_error", null, { retryAfter: "0" }), replyFinal("after 503")]);
  assert.deepEqual([busy.outcome.status, busy.outcome.reason], ["done", "verified"]);
  assert.equal(responsesRequests(busy.api).length, 2, "503 is retried");
  for (const api of [limited.api, waited.api, busy.api]) assertOpenAIProtocolClean(api);
});

test(`${MOCK_LABEL} 출력 한도 잘림(incomplete, max_output_tokens): failed/model_error, Anthropic max_tokens와 같은 malformed_response(stop=length), 사용량은 센다`, { timeout: 90_000 }, async (t) => {
  const { api, sb, outcome } = await openAIRun(t, [replyIncomplete("max_output_tokens", [outputMessage("a partial answ")])]);
  assertModelError(outcome, "malformed_response");
  assert.equal(outcome.errors[0]?.message, "malformed model response: stop=length");
  const result = expectRunResult(outcome.run, "openai");
  assert.deepEqual([result.usage.inputTokens, result.usage.outputTokens], [100, 20], "the cut response's usage still counts");
  assert.equal(responsesRequests(api).length, 1);
  assert.equal(sb.workspace.length > 0, true);
});

test(`${MOCK_LABEL} 거부와 내용 필터: api_error 고정 문구, 거부 글은 기록·출력에 없다, 다시 보내지 않는다`, { timeout: 90_000 }, async (t) => {
  const refusalText = "I will not help with that cdyRefusalMarker";
  const refused = await openAIRun(t, [replyRefusal(refusalText)]);
  assertModelError(refused.outcome, "api_error");
  assert.equal(refused.outcome.errors[0]?.message, "the model declined the request (refusal)");
  assert.deepEqual(findLeaks(cliOutputSources(refused.sb.workspace, refused.outcome.run), ["cdyRefusalMarker"]), [], "the refusal text is not quoted anywhere");

  const filtered = await openAIRun(t, [replyIncomplete("content_filter")]);
  assertModelError(filtered.outcome, "api_error");
  assert.equal(filtered.outcome.errors[0]?.message, "the model declined the request (incomplete: content_filter)");
  for (const api of [refused.api, filtered.api]) assert.equal(responsesRequests(api).length, 1, "a refusal is not retried");
});
