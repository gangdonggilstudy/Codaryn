/**
 * The repair loop over the mock Messages API (a local fake server). This is mock API
 * verification, not real API verification: every test name starts with MOCK_LABEL.
 * It shows the repair request is a valid Messages API request that carries the failure evidence,
 * and that file originals kept for revert never appear in any request body.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CODARYN_API_BASE_URL_ENV, RUN_EXIT_CODES } from "../../src/contracts/index.js";
import type { CommandVerifierConfig, PolicyConfig } from "../../src/contracts/index.js";
import { createSandbox, writeWorkspaceFile } from "../fixtures/builders.js";
import { FAKE_MODEL_CONFIG, FAKE_MODEL_TASK, fakeApiConfig, writeAnthropicTask, writeConfigFile } from "../fixtures/anthropic.js";
import {
  DISCOUNT_TEST_NAME,
  EDIT_RIGHT_FIX,
  EDIT_WEAKEN_TEST,
  EDIT_WRONG_FIX,
  NOTES_ORIGINAL,
  NOTES_PATH,
  NOTES_REPLACEMENT,
  PRICE_FIXED,
  PRICE_PATH,
  PRICE_TEST,
  SNAPSHOT_MARKER,
  writeRepairProject,
} from "../fixtures/repair-project.js";
import { FAKE_API_KEY } from "../fixtures/secrets.js";
import { NODE, cliEnv, deniedDecision, expectRunResult, readRunFiles } from "../support/cli.js";
import {
  MOCK_LABEL,
  assertProtocolClean,
  bodyOf,
  bodySources,
  cliOutputSources,
  requestAt,
  runGuarded,
  startFakeAnthropic,
} from "../support/fake-anthropic.js";
import { findLeaks } from "../support/leak.js";
import { repairStarts } from "../support/repair-check.js";
import { editStep, finalStep, readStep, replaceAllStep, stepsToReplies } from "../support/repair-script.js";

const TESTS_VERIFIER: CommandVerifierConfig = {
  id: "tests",
  kind: "command",
  executable: NODE,
  args: ["--test", "test/"],
  timeoutMs: 60_000,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Text of every text block (or string content) of one Messages API message. */
function messageText(message: unknown): string {
  if (!isRecord(message)) return "";
  const content = message["content"];
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (isRecord(block) && block["type"] === "text" && typeof block["text"] === "string" ? block["text"] : ""))
    .join("\n");
}

function messagesOf(body: Record<string, unknown>): unknown[] {
  const messages = body["messages"];
  assert.ok(Array.isArray(messages), "messages must be a list");
  return messages;
}

test(`${MOCK_LABEL} F5-s 가짜 서버로 실패 → 재수정 → 통과`, { timeout: 180_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb);
  writeWorkspaceFile(sb, NOTES_PATH, NOTES_ORIGINAL);
  const steps = [
    readStep("toolu_r1", PRICE_PATH),
    // Replaced without reading: its original exists only in the snapshot.
    replaceAllStep("toolu_w0", NOTES_PATH, NOTES_ORIGINAL, NOTES_REPLACEMENT),
    editStep("toolu_w1", EDIT_WRONG_FIX),
    finalStep("수량 계산을 고쳤다"),
    editStep("toolu_w2", EDIT_RIGHT_FIX),
    finalStep("할인 계산도 고쳤다"),
  ];
  const api = await startFakeAnthropic(t, stepsToReplies(steps));
  const taskPath = writeAnthropicTask(sb, {
    id: "f5-s",
    goal: "src/price.js의 totalPrice를 고쳐 테스트를 통과시킨다",
    workflow: "code",
    model: FAKE_MODEL_TASK,
    limits: { maxModelTurns: 12, maxToolCalls: 12, maxTotalTokens: null, maxDurationMs: 150_000, maxRepairAttempts: 2 },
    verifiers: [TESTS_VERIFIER],
  });
  const run = await runGuarded(
    sb,
    ["run", "--task", taskPath],
    cliEnv({ fakeApiKey: FAKE_API_KEY, extra: { [CODARYN_API_BASE_URL_ENV]: api.url } }),
    170_000,
  );
  const result = expectRunResult(run, "anthropic");
  const files = readRunFiles(sb.workspace, result);

  await t.test("완료와 파일", () => {
    assert.equal(run.exitCode, RUN_EXIT_CODES.done);
    assert.equal(result.status, "done");
    assert.equal(readFileSync(join(sb.workspace, "src", "price.js"), "utf8"), PRICE_FIXED);
    assert.equal(repairStarts(files.records).length, 1);
    assert.equal(result.usage.repairAttempts, 1);
  });

  await t.test("모든 요청이 Messages API 규칙을 지키고 대본 안에 있다", () => {
    assertProtocolClean(api);
    assert.equal(api.requests.length, steps.length);
  });

  await t.test("재수정 요청: 마지막 메시지가 실패 근거를 담은 user 메시지", () => {
    // Request 5 answers the repair: requests 1-4 are the first attempt, the 4th ended with end_turn.
    const messages = messagesOf(bodyOf(requestAt(api, 4)));
    const last = messages[messages.length - 1];
    assert.ok(isRecord(last) && last["role"] === "user", "the repair message is a user message");
    assert.ok(messageText(last).includes(DISCOUNT_TEST_NAME), "it carries the failing test from the evidence");
    assert.ok(
      messages.length > messagesOf(bodyOf(requestAt(api, 3))).length,
      "the repair continues the same conversation instead of starting over",
    );
  });

  await t.test("스냅샷 원문은 어떤 요청 본문에도, 기록에도 없다", () => {
    for (const source of [...bodySources(api), ...cliOutputSources(sb.workspace, run)]) {
      assert.equal(source.text.includes(SNAPSHOT_MARKER), false, `the original reached ${source.label}`);
    }
    assert.deepEqual(findLeaks(bodySources(api), [FAKE_API_KEY]), [], "the key stays in the x-api-key header");
  });
});

test(`${MOCK_LABEL} F5-t 간편 형식: 설정 파일의 protectedPaths와 maxRepairAttempts가 적용된다`, { timeout: 180_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb);
  const steps = [
    editStep("toolu_wt", EDIT_WEAKEN_TEST),
    finalStep("테스트 기대값을 맞췄다"),
    editStep("toolu_w1", EDIT_WRONG_FIX),
    editStep("toolu_w2", EDIT_RIGHT_FIX),
    finalStep("코드를 고쳤다"),
  ];
  const api = await startFakeAnthropic(t, stepsToReplies(steps));
  const policy: PolicyConfig = {
    commands: [],
    network: "deny",
    destructive: "deny",
    restorePathTokens: false,
    protectedPaths: ["test"],
  };
  const configPath = writeConfigFile(
    sb,
    fakeApiConfig(api.url, {
      model: FAKE_MODEL_CONFIG,
      limits: { maxModelTurns: 12, maxToolCalls: 12, maxTotalTokens: null, maxDurationMs: 150_000, maxRepairAttempts: 1 },
      policy,
      verifiers: [TESTS_VERIFIER],
    }),
  );
  const run = await runGuarded(
    sb,
    ["run", "--workspace", sb.workspace, "--goal", "테스트를 통과시킨다", "--config", configPath],
    cliEnv({ fakeApiKey: FAKE_API_KEY }),
    170_000,
  );
  const result = expectRunResult(run, "anthropic");
  const files = readRunFiles(sb.workspace, result);

  assertProtocolClean(api);
  const decision = deniedDecision(files.records, "toolu_wt");
  assert.equal(decision.code, "protected_path");
  assert.equal(readFileSync(join(sb.workspace, "test", "price.test.js"), "utf8"), PRICE_TEST);
  assert.equal(result.status, "done");
  assert.equal(result.usage.repairAttempts, 1, "maxRepairAttempts 1 from the config file allowed one repair");
  assert.equal(readFileSync(join(sb.workspace, ...PRICE_PATH.split("/")), "utf8"), PRICE_FIXED);
});
