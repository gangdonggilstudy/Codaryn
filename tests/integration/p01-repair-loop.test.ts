/**
 * Phase 2 repair loop (R-1 to R-3) with the scripted model and the practice project
 * (tests/fixtures/repair-project.ts). Judged by exit code, stdout JSON, file bytes and journal.
 *
 * Each script ends with spare final texts. A run that stops when it should never asks for them,
 * which `usage.modelTurns` shows.
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { RUN_EXIT_CODES } from "../../src/contracts/index.js";
import type { CommandVerifierConfig, JournalRecord } from "../../src/contracts/index.js";
import { createSandbox, writeTask } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { writeProgram } from "../fixtures/programs.js";
import {
  DISCOUNT_TEST_NAME,
  EDIT_BACK_TO_WRONG_FIX,
  EDIT_NO_PROGRESS,
  EDIT_RIGHT_FIX,
  EDIT_WRONG_FIX,
  EDITS_MORE_NO_PROGRESS,
  EDITS_STILL_WRONG,
  PRICE_BUG,
  PRICE_CHECK_PATH,
  PRICE_FIXED,
  PRICE_PATH,
  PRICE_TEST,
  PRICE_TEST_PATH,
  PRICE_WRONG_FIX,
  writeRepairProject,
} from "../fixtures/repair-project.js";
import type { FileEdit } from "../fixtures/repair-project.js";
import {
  NODE,
  expectRunResult,
  readLiveRecords,
  readRunFiles,
  runTask,
  sha256Hex,
  startTask,
  waitFor,
} from "../support/cli.js";
import { repairMessages, repairStarts, roundOutcomes, verifierResults } from "../support/repair-check.js";
import { attemptSteps, attemptTurns, editStep, finalStep, spareSteps } from "../support/repair-script.js";
import type { Attempt } from "../support/repair-script.js";

/** `node --test test/`: the project's own tests. Its output holds timings, so it differs per run. */
const TESTS_VERIFIER: CommandVerifierConfig = {
  id: "tests",
  kind: "command",
  executable: NODE,
  args: ["--test", "test/"],
  timeoutMs: 60_000,
};

/** The deterministic checker: the same code always prints the same bytes. */
const CHECK_VERIFIER: CommandVerifierConfig = {
  id: "check",
  kind: "command",
  executable: NODE,
  args: [PRICE_CHECK_PATH],
  timeoutMs: 30_000,
};

function nth<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`fixture list has no item ${index}`);
  return item;
}

function fileText(sb: Sandbox, path: string): string {
  return readFileSync(join(sb.workspace, ...path.split("/")), "utf8");
}

function verifierFailEvidence(records: readonly JournalRecord[]): string[] {
  return verifierResults(records)
    .filter((result) => result.outcome === "fail")
    .map((result) => result.evidence);
}

interface LoopRun {
  readonly sb: Sandbox;
  readonly exitCode: number | null;
  readonly result: ReturnType<typeof expectRunResult>;
  readonly records: readonly JournalRecord[];
}

async function runLoop(
  t: Parameters<typeof createSandbox>[0],
  id: string,
  attempts: readonly Attempt[],
  limits: Parameters<typeof writeTask>[1]["limits"],
  verifier: CommandVerifierConfig,
  spare = 2,
): Promise<LoopRun> {
  const sb = createSandbox(t);
  writeRepairProject(sb);
  const taskPath = writeTask(
    sb,
    { id, goal: "src/price.js의 totalPrice를 고쳐 테스트를 통과시킨다", workflow: "code", limits, verifiers: [verifier] },
    [...attemptSteps(attempts), ...spareSteps(spare)],
  );
  const run = await runTask(taskPath, { cwd: sb.base, timeoutMs: 170_000 });
  const result = expectRunResult(run);
  const { records } = readRunFiles(sb.workspace, result);
  return { sb, exitCode: run.exitCode, result, records };
}

test("F5-a 실패 → 재수정 → 통과: 첫 수정은 틀리고 실패 근거를 받은 뒤 고친다", { timeout: 180_000 }, async (t) => {
  const attempts: Attempt[] = [
    { reads: [PRICE_PATH], edits: [EDIT_WRONG_FIX], claim: "수량 계산을 고쳤다" },
    { edits: [EDIT_RIGHT_FIX], claim: "할인 계산도 고쳤다" },
  ];
  const { sb, exitCode, result, records } = await runLoop(t, "f5-a", attempts, { maxRepairAttempts: 2 }, TESTS_VERIFIER);

  assert.equal(exitCode, RUN_EXIT_CODES.done);
  assert.equal(result.status, "done");
  assert.equal(result.reason, "verified");
  assert.equal(fileText(sb, PRICE_PATH), PRICE_FIXED);
  assert.equal(fileText(sb, PRICE_TEST_PATH), PRICE_TEST, "the test file is never touched");

  assert.deepEqual(roundOutcomes(records, 1), [["tests:fail"], ["tests:pass"]]);
  const repairs = repairStarts(records);
  assert.deepEqual(
    repairs.map((record) => ({ attempt: record.attempt, failed: record.failedVerifiers })),
    [{ attempt: 1, failed: ["tests"] }],
  );
  assert.equal(result.usage.repairAttempts, 1);
  assert.equal(result.usage.modelTurns, attemptTurns(attempts), "no spare step may be requested after the pass");

  const types = records.map((record) => record.type);
  const firstVerifier = types.indexOf("verifier_result");
  assert.deepEqual(
    types.slice(firstVerifier, firstVerifier + 3),
    ["verifier_result", "repair_started", "model_request"],
    "a failed verification is recorded, then the repair, then the request that carries it",
  );
  const [message] = repairMessages(records);
  assert.ok(message?.includes(DISCOUNT_TEST_NAME), "the repair message must carry the failing test from the evidence");

  assert.deepEqual(
    result.changes.map((change) => [change.previousHash, change.newHash]),
    [
      [sha256Hex(PRICE_BUG), sha256Hex(PRICE_WRONG_FIX)],
      [sha256Hex(PRICE_WRONG_FIX), sha256Hex(PRICE_FIXED)],
    ],
  );
  assert.equal(result.verifiers.at(-1)?.outcome, "pass", "the result reports the last verification");
});

test("F5-b 재수정 한도 소진: 매번 다른 실패로 한도까지 고치고 failed/verifier_failed", { timeout: 180_000 }, async (t) => {
  const attempts: Attempt[] = [
    { edits: [EDIT_WRONG_FIX] },
    { edits: [nth(EDITS_STILL_WRONG, 0)] },
    { edits: [nth(EDITS_STILL_WRONG, 1)] },
  ];
  const { sb, exitCode, result, records } = await runLoop(t, "f5-b", attempts, { maxRepairAttempts: 2 }, TESTS_VERIFIER);

  assert.equal(exitCode, RUN_EXIT_CODES.failed);
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "verifier_failed");
  assert.deepEqual(roundOutcomes(records, 1), [["tests:fail"], ["tests:fail"], ["tests:fail"]]);
  assert.deepEqual(
    repairStarts(records).map((record) => record.attempt),
    [1, 2],
  );
  assert.equal(result.usage.repairAttempts, 2);
  assert.equal(result.usage.modelTurns, attemptTurns(attempts), "no request after the last allowed repair");
  assert.equal(fileText(sb, PRICE_PATH), nth(EDITS_STILL_WRONG, 1).after, "applied changes are kept on failure");
});

test("F5-c maxRepairAttempts 생략: 기본 0이라 단계 1처럼 첫 실패에서 끝난다", { timeout: 120_000 }, async (t) => {
  const attempts: Attempt[] = [{ edits: [EDIT_WRONG_FIX] }];
  const { exitCode, result, records } = await runLoop(t, "f5-c", attempts, {}, TESTS_VERIFIER);

  assert.equal(exitCode, RUN_EXIT_CODES.failed);
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "verifier_failed");
  assert.equal(repairStarts(records).length, 0);
  assert.equal(result.usage.repairAttempts, 0);
  assert.equal(result.usage.modelTurns, attemptTurns(attempts));
  const started = records[0];
  assert.ok(started?.type === "run_started");
  assert.equal(started.limits.maxRepairAttempts, 0, "run_started records the resolved default");
  assert.equal(started.limits.maxSameFailures, 2, "run_started records the resolved default");
});

test("F5-d 같은 실패 반복: 같은 근거가 연속 2번이면 failed/repeated_failure", { timeout: 120_000 }, async (t) => {
  const attempts: Attempt[] = [{ edits: [EDIT_WRONG_FIX] }, { edits: [EDIT_NO_PROGRESS], claim: "주석을 달았다" }];
  const { exitCode, result, records } = await runLoop(t, "f5-d", attempts, { maxRepairAttempts: 5 }, CHECK_VERIFIER, 3);

  const failures = verifierFailEvidence(records);
  assert.equal(failures.length, 2);
  assert.equal(failures[0], failures[1], "test assumption: the checker printed the same failure twice");

  assert.equal(exitCode, RUN_EXIT_CODES.failed);
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "repeated_failure");
  assert.deepEqual(
    repairStarts(records).map((record) => record.attempt),
    [1],
    "with maxSameFailures 2 the same failure is repaired at most once",
  );
  assert.equal(result.usage.repairAttempts, 1);
  assert.equal(result.usage.modelTurns, attemptTurns(attempts), "repairs were left, but none may be started");
});

test("F5-d2 maxSameFailures 3: 같은 실패를 두 번 고쳐 보고 세 번째에 멈춘다", { timeout: 150_000 }, async (t) => {
  const attempts: Attempt[] = [
    { edits: [EDIT_WRONG_FIX] },
    { edits: [EDIT_NO_PROGRESS] },
    { edits: [nth(EDITS_MORE_NO_PROGRESS, 0)] },
  ];
  const { exitCode, result, records } = await runLoop(
    t,
    "f5-d2",
    attempts,
    { maxRepairAttempts: 5, maxSameFailures: 3 },
    CHECK_VERIFIER,
    3,
  );

  const failures = verifierFailEvidence(records);
  assert.equal(new Set(failures).size, 1, "test assumption: the checker printed the same failure every time");
  assert.equal(exitCode, RUN_EXIT_CODES.failed);
  assert.equal(result.reason, "repeated_failure");
  assert.deepEqual(
    repairStarts(records).map((record) => record.attempt),
    [1, 2],
  );
  assert.equal(result.usage.modelTurns, attemptTurns(attempts));
});

test("F5-d3 T-5 node --test의 같은 실패도 반복으로 본다(소요 시간 숫자만 다름) → repeated_failure", { timeout: 150_000 }, async (t) => {
  const attempts: Attempt[] = [{ edits: [EDIT_WRONG_FIX] }, { edits: [EDIT_NO_PROGRESS], claim: "주석을 달았다" }];
  const { exitCode, result, records } = await runLoop(t, "f5-d3", attempts, { maxRepairAttempts: 5 }, TESTS_VERIFIER, 3);

  const failures = verifierFailEvidence(records);
  assert.equal(failures.length, 2);
  const digitsOut = (text: string): string => text.replace(/\d+(?:\.\d+)?/g, "#");
  assert.equal(digitsOut(failures[0] ?? ""), digitsOut(failures[1] ?? ""), "test assumption: only numbers differ between the two runs");
  t.diagnostic(`raw evidence identical: ${String(failures[0] === failures[1])} (before T-5 a difference here defeated R-3)`);

  assert.equal(exitCode, RUN_EXIT_CODES.failed);
  assert.equal(result.reason, "repeated_failure");
  assert.deepEqual(
    repairStarts(records).map((record) => record.attempt),
    [1],
  );
  assert.equal(result.usage.modelTurns, attemptTurns(attempts));
});

test("F5-g2 T-8 검증 도중 실행 시간 한도가 끝나면 budget-exhausted/max_duration", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb);
  writeProgram(sb, "sleep.mjs");
  const taskPath = writeTask(
    sb,
    {
      id: "f5-g2",
      limits: { maxDurationMs: 4_000, maxRepairAttempts: 2 },
      verifiers: [{ id: "slow", kind: "command", executable: NODE, args: ["sleep.mjs"], timeoutMs: 60_000 }],
    },
    [finalStep("끝났다"), ...spareSteps(2)],
  );
  const run = await runTask(taskPath, { cwd: sb.base, timeoutMs: 100_000 });
  const result = expectRunResult(run);
  readRunFiles(sb.workspace, result);
  assert.equal(run.exitCode, RUN_EXIT_CODES["budget-exhausted"]);
  assert.equal(result.status, "budget-exhausted");
  assert.equal(result.reason, "max_duration");
  assert.ok(run.durationMs < 30_000, `the run took ${run.durationMs} ms; the verifier was not stopped at the limit`);
});

test("F5-e 연속이 아닌 같은 실패는 멈추지 않는다: A, B, A 뒤 통과", { timeout: 180_000 }, async (t) => {
  const attempts: Attempt[] = [
    { edits: [EDIT_WRONG_FIX] },
    { edits: [nth(EDITS_STILL_WRONG, 0)] },
    { edits: [EDIT_BACK_TO_WRONG_FIX] },
    { edits: [EDIT_RIGHT_FIX] },
  ];
  const { sb, exitCode, result, records } = await runLoop(t, "f5-e", attempts, { maxRepairAttempts: 3 }, CHECK_VERIFIER);

  const failures = verifierFailEvidence(records);
  assert.equal(failures.length, 3);
  assert.equal(failures[0], failures[2], "test assumption: the first failure came back");
  assert.notEqual(failures[0], failures[1], "test assumption: but not right after itself");

  assert.equal(exitCode, RUN_EXIT_CODES.done);
  assert.equal(result.reason, "verified");
  assert.equal(result.usage.repairAttempts, 3);
  assert.equal(fileText(sb, PRICE_PATH), PRICE_FIXED);
});

test("F5-f inconclusive는 재수정하지 않는다: 검증 명령 시간 초과 → needs-input", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb);
  writeProgram(sb, "sleep.mjs");
  const attempts: Attempt[] = [{ edits: [EDIT_WRONG_FIX] }];
  const taskPath = writeTask(
    sb,
    {
      id: "f5-f",
      limits: { maxRepairAttempts: 3 },
      verifiers: [{ id: "slow", kind: "command", executable: NODE, args: ["sleep.mjs"], timeoutMs: 1_500 }],
    },
    [...attemptSteps(attempts), ...spareSteps(2)],
  );
  const run = await runTask(taskPath, { cwd: sb.base, timeoutMs: 110_000 });
  const result = expectRunResult(run);
  const { records } = readRunFiles(sb.workspace, result);

  assert.equal(run.exitCode, RUN_EXIT_CODES["needs-input"]);
  assert.equal(result.status, "needs-input");
  assert.equal(result.reason, "verifier_inconclusive");
  assert.deepEqual(roundOutcomes(records, 1), [["slow:inconclusive"]]);
  assert.equal(repairStarts(records).length, 0, "an undecided verifier is not something the model can fix");
  assert.equal(result.usage.repairAttempts, 0);
  assert.equal(result.usage.modelTurns, attemptTurns(attempts));
});

test("F5-g 기존 한도는 반복 전체에 적용: 재수정이 남아도 maxModelTurns에서 멈춘다", { timeout: 180_000 }, async (t) => {
  const attempts: Attempt[] = [
    { edits: [EDIT_WRONG_FIX] },
    { edits: [nth(EDITS_STILL_WRONG, 0)] },
    { edits: [nth(EDITS_STILL_WRONG, 1)] },
  ];
  // Six turns are needed; five are allowed.
  const { exitCode, result, records } = await runLoop(
    t,
    "f5-g",
    attempts,
    { maxRepairAttempts: 5, maxModelTurns: 5 },
    TESTS_VERIFIER,
  );

  assert.equal(exitCode, RUN_EXIT_CODES["budget-exhausted"]);
  assert.equal(result.status, "budget-exhausted");
  assert.equal(result.reason, "max_model_turns");
  assert.ok(result.usage.modelTurns <= 5, `modelTurns ${result.usage.modelTurns} exceeds the limit`);
  assert.deepEqual(
    repairStarts(records).map((record) => record.attempt),
    [1, 2],
  );
  assert.deepEqual(roundOutcomes(records, 1), [["tests:fail"], ["tests:fail"]]);
});

test("F5-h 재수정 중 취소: repair_started 뒤 cancel-file → cancelled", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb);
  const steps = [
    ...attemptSteps([{ edits: [EDIT_WRONG_FIX] }]),
    { ...editStep("a2w1", EDIT_RIGHT_FIX), delayMs: 60_000 },
    finalStep("고쳤다"),
  ];
  const taskPath = writeTask(sb, { id: "f5-h", limits: { maxRepairAttempts: 2 }, verifiers: [TESTS_VERIFIER] }, steps);
  const started = startTask(taskPath, { cwd: sb.base, cancelFile: sb.cancelFile, timeoutMs: 100_000 });
  await waitFor(
    () => readLiveRecords(sb.workspace).some((record) => record.type === "repair_started"),
    60_000,
    "repair_started",
  );
  writeFileSync(sb.cancelFile, "cancel");
  const run = await started.done;
  const result = expectRunResult(run);
  const { records } = readRunFiles(sb.workspace, result);

  assert.equal(run.exitCode, RUN_EXIT_CODES.cancelled);
  assert.equal(result.status, "cancelled");
  assert.equal(result.reason, "cancelled");
  assert.ok(run.durationMs < 50_000, `cancel took effect late (${run.durationMs} ms)`);
  assert.equal(repairStarts(records).length, 1);
  assert.equal(fileText(sb, PRICE_PATH), PRICE_WRONG_FIX, "the delayed second fix must not be applied");
});

// Keeps the chain of fixture edits honest: a broken chain would make the scripts above fail for
// the wrong reason (conflict instead of a verifier result).
test("F5 fixture: 연습 프로젝트 수정 사슬이 이어진다", () => {
  const chains: FileEdit[][] = [
    [EDIT_WRONG_FIX, EDIT_RIGHT_FIX],
    [EDIT_WRONG_FIX, ...EDITS_STILL_WRONG],
    [EDIT_WRONG_FIX, EDIT_NO_PROGRESS, ...EDITS_MORE_NO_PROGRESS],
    [EDIT_WRONG_FIX, nth(EDITS_STILL_WRONG, 0), EDIT_BACK_TO_WRONG_FIX, EDIT_RIGHT_FIX],
  ];
  for (const chain of chains) assert.doesNotThrow(() => attemptSteps(chain.map((edit) => ({ edits: [edit] }))));
  assert.equal(EDIT_BACK_TO_WRONG_FIX.after, PRICE_WRONG_FIX);
});
