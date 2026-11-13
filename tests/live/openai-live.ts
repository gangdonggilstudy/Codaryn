/**
 * 실제 API 점검 (REAL OpenAI API, 모의 아님). Not part of any default npm command. Never run in this
 * repository so far (written in U-101; only the skip without the variables was checked).
 *
 * - Runs only when CODARYN_LIVE=1, OPENAI_API_KEY and CODARYN_OPENAI_MODEL are all set in the
 *   environment. Otherwise every test is reported as skipped and nothing is sent.
 * - `npm test`, `test:unit` and `test:integration` never pick it up: the file name does not end in
 *   `.test.ts`, and it compiles to dist/tests/live/. The user runs it on purpose, see README.md.
 * - Three checks, at most 10 HTTP requests in all:
 *   1. the model list (`codaryn models --provider openai --json`): 1 request, 1 retry at most;
 *   2. one tool round through the CLI (read_file, write_file, then a final reply on a small
 *      document task): at most 4 model turns, 1 retry per request;
 *   3. second-provider-facts C-11: the requests go without storing (`store: false`, the adapter's
 *      own setting), so a reasoning model's reasoning items must be sent back with the next request.
 *      Read from check 2's journal: a response that returned reasoning items, then a later response
 *      of the same run. No request of its own. With a model that returns none it is skipped.
 * - Caps: 4 model turns, 4 tool calls, 1 retry per request, 4096 output tokens per request
 *   (reasoning tokens count as output, facts C-10), 40000 total tokens, 3 minutes per run.
 * - The key is passed to the CLI processes only. It is never printed: outputs and records are
 *   scanned for it before anything else and only variant names are reported.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CODARYN_OPENAI_MODEL_ENV, JOURNAL_FILE_NAME, OPENAI_API_KEY_ENV, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../src/contracts/index.js";
import type { CliErrorOutput, JournalEvent, Limits, ModelsOutput } from "../../src/contracts/index.js";
import { writeConfigFile } from "../fixtures/anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../fixtures/builders.js";
import { writeOpenAITask } from "../fixtures/openai.js";
import { startCli } from "../support/cli.js";
import { findLeaks, readTreeTexts } from "../support/leak.js";
import { jsonLine, liveEnvWith, liveSkipReason } from "./live-support.js";

export const OPENAI_LIVE_LIMITS: Limits = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 40_000, maxDurationMs: 180_000 };
export const OPENAI_LIVE_MAX_OUTPUT_TOKENS = 4096;
export const OPENAI_LIVE_MAX_RETRIES = 1;

const NAMES = [OPENAI_API_KEY_ENV, CODARYN_OPENAI_MODEL_ENV] as const;
const skipReason = (): string | false => liveSkipReason("OpenAI", NAMES);
/** No CODARYN_OPENAI_API_BASE_URL is passed: the official address. */
const liveEnv = (): NodeJS.ProcessEnv => liveEnvWith(NAMES);

/** The config file of every check: openai, its caps, the official address. */
const CONFIG = {
  schemaVersion: 1,
  provider: "openai",
  providers: { openai: { maxOutputTokens: OPENAI_LIVE_MAX_OUTPUT_TOKENS, maxRetries: OPENAI_LIVE_MAX_RETRIES, requestTimeoutMs: 120_000 } },
};

/** Check 2's journal, for check 3. Null when check 2 did not run or did not get as far. */
let roundJournal: JournalEvent[] | null = null;

const README_BEFORE = "# 점검용 문서\n\n소개 문단.\n";

test("실제 API 점검(OpenAI, 모의 아님) 1: 모델 목록", { skip: skipReason(), timeout: 180_000 }, async (t) => {
  const key = process.env[OPENAI_API_KEY_ENV] ?? "";
  const model = process.env[CODARYN_OPENAI_MODEL_ENV] ?? "";
  const sb = createSandbox(t);
  const configPath = writeConfigFile(sb, CONFIG);
  const run = await startCli(["models", "--provider", "openai", "--config", configPath, "--json"], { cwd: sb.base, env: liveEnv(), timeoutMs: 150_000 }).done;
  assert.deepEqual(findLeaks([{ label: "stdout", text: run.stdout }, { label: "stderr", text: run.stderr }], [key]), [], "the API key must not appear in any output");
  assert.equal(run.timedOut, false);
  const output = jsonLine<ModelsOutput | CliErrorOutput>(run.stdout);
  if (output.kind !== "models") assert.fail(`the CLI stopped: ${output.code} (${output.message})`);
  t.diagnostic(`status=${output.status} models=${output.models.length} configuredModelListed=${output.models.some((entry) => entry.id === model)}`);
  assert.equal(output.status, "listed");
  assert.ok(output.models.length >= 1, "the key can use at least one model");
  assert.ok(output.models.some((entry) => entry.id === model), `${CODARYN_OPENAI_MODEL_ENV} names a model this key can use`);
});

test("실제 API 점검(OpenAI, 모의 아님) 2: 도구 호출 → 결과 → 완료 한 바퀴", { skip: skipReason(), timeout: 300_000 }, async (t) => {
  const key = process.env[OPENAI_API_KEY_ENV] ?? "";
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", README_BEFORE);
  const configPath = writeConfigFile(sb, CONFIG);
  const taskPath = writeOpenAITask(sb, {
    id: "live-openai-round",
    goal:
      "README.md 끝에 '## 점검' 제목과 그 아래 한 줄 설명을 추가한다. " +
      "read_file로 읽고 그 hash를 expectedHash로 넣어 write_file의 replace_text로 바꾼다. 다른 파일은 건드리지 않는다. 다 하면 도구 없이 짧게 답한다.",
    model: null,
    maxOutputTokens: null,
    limits: OPENAI_LIVE_LIMITS,
    verifiers: [{ id: "doc", kind: "file_rules", rules: [{ type: "contains", path: "README.md", text: "## 점검" }] }],
  });
  const run = await startCli(["run", "--task", taskPath, "--config", configPath], { cwd: sb.base, env: liveEnv(), timeoutMs: 240_000 }).done;

  // The key check comes first, so a leak is reported by variant name before any output is shown.
  const stateDir = join(sb.workspace, STATE_DIR_NAME);
  const sources = [{ label: "stdout", text: run.stdout }, { label: "stderr", text: run.stderr }, ...(existsSync(stateDir) ? readTreeTexts(stateDir, sb.workspace) : [])];
  assert.deepEqual(findLeaks(sources, [key]), [], "the API key must not appear in any output or record");

  assert.equal(run.timedOut, false, "the CLI must finish within 4 minutes");
  const output = jsonLine(run.stdout);
  if (output.kind !== "run") assert.fail(`the CLI stopped before the run: ${output.code} (${output.message})`);
  const journalPath = join(sb.workspace, STATE_DIR_NAME, RUNS_DIR_NAME, output.runId, JOURNAL_FILE_NAME);
  const journal = readFileSync(journalPath, "utf8").split(/\r?\n/).filter((line) => line !== "").map((line) => JSON.parse(line) as JournalEvent);
  roundJournal = journal;
  const responses = journal.filter((event): event is Extract<JournalEvent, { type: "model_response" }> => event.type === "model_response");
  t.diagnostic(
    `status=${output.status} reason=${output.reason} turns=${output.usage.modelTurns} toolCalls=${output.usage.toolCalls} ` +
      `inputTokens=${String(output.usage.inputTokens)} outputTokens=${String(output.usage.outputTokens)} ` +
      `reasoningItems=${responses.map((event) => event.reasoningItems ?? 0).join(",")}`,
  );
  assert.equal(output.provider, "openai");
  assert.ok(output.usage.modelTurns <= OPENAI_LIVE_LIMITS.maxModelTurns, "the turn cap must hold");
  assert.ok(journal.some((event) => event.type === "tool_result" && event.result.ok), "a tool call ran and its result went back");
  assert.equal(responses.at(-1)?.stop, "final", "the round ends with a final reply");
  assert.equal(output.status, "done", "the live document task should be verified");
  assert.ok(readFileSync(join(sb.workspace, "README.md"), "utf8").startsWith(README_BEFORE), "the original text stays");
});

test("실제 API 점검(OpenAI, 모의 아님) 3: 저장 없는 연속 요청에 추론 항목을 다시 보냄(C-11)", { skip: skipReason(), timeout: 10_000 }, (t) => {
  if (roundJournal === null) {
    t.skip("check 2 did not get as far as a journal");
    return;
  }
  const responses = roundJournal.filter((event): event is Extract<JournalEvent, { type: "model_response" }> => event.type === "model_response");
  const first = responses.findIndex((event) => (event.reasoningItems ?? 0) > 0);
  if (first === -1) {
    t.skip("the model returned no reasoning items, so C-11 was not exercised; run again with a reasoning model");
    return;
  }
  t.diagnostic(`reasoning items first returned at response ${first + 1} of ${responses.length}`);
  // The adapter keeps those items in memory and sends them back with the next request (SP-5,
  // DR-31 (c)). A later response of the same run is the API accepting them without a stored state.
  assert.ok(responses.length > first + 1, "a later request carried the reasoning items back and got a response");
  assert.equal(roundJournal.some((event) => event.type === "model_error"), false, "no model error in the run");
});
