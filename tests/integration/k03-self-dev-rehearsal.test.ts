/**
 * Self-development rehearsal (phase 3, work order "자기 개발 예행"): a copy of part of this
 * repository (src/contracts, src/privacy and their unit tests, tests/fixtures/self-dev.ts) is the
 * candidate workspace; a protected verifier outside it compiles the copy with this repository's
 * TypeScript and runs the unit tests. The model is scripted (or the local fake server).
 * This is a rehearsal with a mock model. It is not evidence of real self-development.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { CODARYN_API_BASE_URL_ENV, REVERT_EXIT_CODES } from "../../src/contracts/index.js";
import type { CommandRule, EngineResult, JournalRecord, ScriptStep } from "../../src/contracts/index.js";
import { FAKE_MODEL_TASK, writeAnthropicTask, writeConfigFile } from "../fixtures/anthropic.js";
import { createSandbox, writeTask } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { FAKE_API_KEY } from "../fixtures/secrets.js";
import {
  CANDIDATE_PROTECTED_PATHS,
  REHEARSAL_TARGET,
  candidateText,
  copyCandidateSource,
  writeProtectedVerifier,
  writeTamperProgram,
} from "../fixtures/self-dev.js";
import type { CandidateVerifier } from "../fixtures/self-dev.js";
import { cliEnv, expectRunResult, readRunFiles, startCli } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { expectReportOutput, runReport } from "../support/commands.js";
import { MOCK_LABEL, assertProtocolClean, runGuarded, startFakeAnthropic } from "../support/fake-anthropic.js";
import {
  expectRevertOutput,
  integrityChecks,
  repairMessages,
  repairStarts,
  roundOutcomes,
  runRevert,
  treeBytes,
} from "../support/repair-check.js";
import { finalStep, spareSteps, stepsToReplies } from "../support/repair-script.js";
import { passingRehearsal, rehearsalTexts, repairRehearsal, tamperStep } from "../support/self-dev-script.js";

const LABEL = "[예행·모의 모델]";
const CANDIDATE_TEST = "tests/unit/privacy/gateway.test.ts";

interface Candidate {
  readonly sb: Sandbox;
  readonly verifier: CandidateVerifier;
  readonly configPath: string;
  readonly original: string;
  readonly testsBefore: Map<string, Buffer>;
}

function candidate(t: TestContext): Candidate {
  const sb = createSandbox(t);
  copyCandidateSource(sb);
  const verifier = writeProtectedVerifier(sb);
  const configPath = writeConfigFile(sb, { schemaVersion: 1, integrity: { paths: verifier.integrityPaths } });
  return {
    sb,
    verifier,
    configPath,
    original: candidateText(sb, REHEARSAL_TARGET),
    testsBefore: treeBytes(join(sb.workspace, "tests")),
  };
}

interface Rehearsal {
  readonly run: CliRun;
  readonly result: EngineResult;
  readonly records: readonly JournalRecord[];
}

async function rehearse(
  c: Candidate,
  id: string,
  steps: readonly ScriptStep[],
  options: { readonly maxRepairAttempts?: number; readonly commands?: readonly CommandRule[] } = {},
): Promise<Rehearsal> {
  const taskPath = writeTask(
    c.sb,
    {
      id,
      goal: "src/privacy/index.ts를 조금 고친다",
      workflow: "code",
      protectedPaths: CANDIDATE_PROTECTED_PATHS,
      commands: options.commands ?? [],
      limits: { maxRepairAttempts: options.maxRepairAttempts ?? 0, maxDurationMs: 300_000 },
      verifiers: [c.verifier.config],
    },
    steps,
  );
  const run = await startCli(["run", "--task", taskPath, "--config", c.configPath], { cwd: c.sb.base, timeoutMs: 290_000 }).done;
  const result = expectRunResult(run);
  const { records } = readRunFiles(c.sb.workspace, result);
  return { run, result, records };
}

function targetText(c: Candidate): string {
  return readFileSync(join(c.sb.workspace, ...REHEARSAL_TARGET.split("/")), "utf8");
}

test(`${LABEL} 작은 변경 → 보호된 검증(후보 컴파일과 유닛) 통과 → report와 revert`, { timeout: 300_000 }, async (t) => {
  const c = candidate(t);
  const r = await rehearse(c, "k03-pass", [...passingRehearsal(c.original), ...spareSteps(1)]);

  assert.equal(r.result.status, "done", `stderr: ${r.run.stderr.slice(0, 500)}`);
  assert.equal(r.result.reason, "verified");
  assert.equal(targetText(c), rehearsalTexts(c.original).benign);
  assert.deepEqual(treeBytes(join(c.sb.workspace, "tests")), c.testsBefore, "the candidate's tests are untouched");
  assert.deepEqual(r.result.protectedChanged, []);
  assert.deepEqual(
    integrityChecks(r.records).map((check) => `${check.phase}:${check.changed.length}`),
    ["run_start:0", "before_verify:0", "after_verify:0"],
  );

  await t.test("report --json이 같은 실행을 complete로 요약한다", async () => {
    const report = expectReportOutput(await runReport(c.sb.workspace, r.result.runId, { cwd: c.sb.base }), r.result.runId);
    assert.equal(report.status, "complete");
    assert.deepEqual(report.journal.lastRound.map((verifier) => verifier.outcome), ["pass"]);
    assert.equal(report.journal.integrityChecks.length, 3);
  });
  await t.test("revert가 후보 원문을 되돌린다", async () => {
    const revert = await runRevert(c.sb.workspace, r.result.runId, { cwd: c.sb.base });
    const output = expectRevertOutput(revert, r.result.runId);
    assert.equal(output.status, "complete");
    assert.equal(revert.exitCode, REVERT_EXIT_CODES.complete);
    assert.equal(targetText(c), c.original);
  });
});

test(`${LABEL} 타입 오류를 넣음 → 보호된 검증 실패 → 재수정 → 통과`, { timeout: 300_000 }, async (t) => {
  const c = candidate(t);
  const r = await rehearse(c, "k03-repair", [...repairRehearsal(c.original), ...spareSteps(1)], { maxRepairAttempts: 1 });

  assert.equal(r.result.status, "done", `stderr: ${r.run.stderr.slice(0, 500)}`);
  assert.deepEqual(roundOutcomes(r.records, 1), [[`${c.verifier.config.id}:fail`], [`${c.verifier.config.id}:pass`]]);
  assert.equal(repairStarts(r.records).length, 1);
  const [message] = repairMessages(r.records);
  assert.ok(message?.includes("TS2322"), "the repair message carries the compiler's error");
  assert.equal(targetText(c), rehearsalTexts(c.original).benign);
  assert.deepEqual(treeBytes(join(c.sb.workspace, "tests")), c.testsBefore);
});

test(`${LABEL} 허용된 명령이 후보의 보호 테스트를 고치면 protected_changed`, { timeout: 300_000 }, async (t) => {
  const c = candidate(t);
  const tamper = writeTamperProgram(c.sb);
  const r = await rehearse(c, "k03-tamper-test", [tamperStep("c-tamper", "append", CANDIDATE_TEST), finalStep("끝"), ...spareSteps(1)], {
    maxRepairAttempts: 2,
    commands: [tamper],
  });
  assert.equal(r.result.status, "needs-input");
  assert.equal(r.result.reason, "protected_changed");
  assert.deepEqual(r.result.protectedChanged, [CANDIDATE_TEST]);
  assert.equal(roundOutcomes(r.records, 1).length, 0, "the protected verifier did not run");
});

test(`${LABEL} 허용된 명령이 작업 공간 밖 검증기를 고치면 protected_changed`, { timeout: 300_000 }, async (t) => {
  const c = candidate(t);
  const tamper = writeTamperProgram(c.sb);
  const r = await rehearse(
    c,
    "k03-tamper-verifier",
    [tamperStep("c-tamper", "append", c.verifier.scriptPath), finalStep("끝"), ...spareSteps(1)],
    { maxRepairAttempts: 2, commands: [tamper] },
  );
  assert.equal(r.result.reason, "protected_changed");
  assert.deepEqual(r.result.protectedChanged, [c.verifier.scriptPath.split(sep).join("/")]);
});

test(`${MOCK_LABEL} ${LABEL} 가짜 서버 모델로 같은 통과 흐름`, { timeout: 300_000 }, async (t) => {
  const c = candidate(t);
  const api = await startFakeAnthropic(t, stepsToReplies(passingRehearsal(c.original)));
  const taskPath = writeAnthropicTask(c.sb, {
    id: "k03-pass-api",
    goal: "src/privacy/index.ts를 조금 고친다",
    workflow: "code",
    model: FAKE_MODEL_TASK,
    maxOutputTokens: 800,
    limits: { maxModelTurns: 8, maxToolCalls: 8, maxTotalTokens: 200_000, maxDurationMs: 300_000 },
    verifiers: [c.verifier.config],
  });
  const run = await runGuarded(
    c.sb,
    ["run", "--task", taskPath, "--config", c.configPath],
    cliEnv({ fakeApiKey: FAKE_API_KEY, extra: { [CODARYN_API_BASE_URL_ENV]: api.url } }),
    290_000,
  );
  const result = expectRunResult(run, "anthropic");
  readRunFiles(c.sb.workspace, result);
  assert.equal(result.status, "done");
  assertProtocolClean(api);
  assert.equal(targetText(c), rehearsalTexts(c.original).benign);
});
