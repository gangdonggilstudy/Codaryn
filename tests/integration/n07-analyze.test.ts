/**
 * G-G: data analysis with the built-in `analyze` workflow (docs/design/general-tasks.md 5.2 and 8,
 * src/contracts/verify.ts data_checks, workflow.ts review). The verifier checks the result table
 * against aggregates worked out by hand (fixtures), the run ends waiting for a person's review, and
 * `review` records the verdict without changing the run. Real CLI processes, scripted model, no
 * key, every command behind the network guard.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { ANTHROPIC_KEY_PATTERN_SOURCE, CLI_ERROR_EXIT_CODES, REVIEW_FILE_NAME } from "../../src/contracts/index.js";
import type { CliErrorCode, EngineResult } from "../../src/contracts/index.js";
import { createSandbox } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import {
  SALES_CSV,
  SALES_CSV_NOT_A_NUMBER,
  SALES_SUMMARY_CSV,
  analyzeRepairScript,
  analyzeScript,
  salesDataChecks,
  writeGeneralTask,
  writeSalesSource,
} from "../fixtures/general-tasks.js";
import { FAKE_SECRET_A, FAKE_SECRET_ENV_A } from "../fixtures/secrets.js";
import { cliEnv, expectCliError, expectRunResult, readRunFiles } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { runGuarded } from "../support/fake-anthropic.js";
import { expectReviewOutput, reviewArgs, runDirPath } from "../support/general.js";
import { decodedSource, findLeaks } from "../support/leak.js";
import { treeBytes } from "../support/repair-check.js";

interface Analysis {
  readonly sb: Sandbox;
  readonly task: string;
  readonly cli: (args: readonly string[]) => Promise<CliRun>;
}

/** The sales source under protected `data/`, an analyze task with the sales data_checks and `steps`. */
function analysis(t: TestContext, steps: ReturnType<typeof analyzeScript>, source = SALES_CSV, env: NodeJS.ProcessEnv = cliEnv(), extra: Record<string, unknown> = {}): Analysis {
  const sb = createSandbox(t);
  writeSalesSource(sb, source);
  const task = writeGeneralTask(
    sb,
    { id: "gg-analyze", label: "analyze", goal: "data/sales.csv로 지역별 합계 표와 보고서를 만든다", fields: { workflowRef: "analyze", ...extra }, policy: { protectedPaths: ["data"] }, verifiers: [salesDataChecks()], limits: { maxRepairAttempts: 1 } },
    steps,
  );
  return { sb, task, cli: (args) => runGuarded(sb, args, env) };
}

function assertRefused(run: CliRun, code: CliErrorCode): void {
  expectCliError(run, code);
  assert.equal(run.exitCode, CLI_ERROR_EXIT_CODES[code]);
}

test("G-G GI-06 자료 분석: data_checks 통과 → awaiting_review → review → report에 판정", { timeout: 120_000 }, async (t) => {
  const a = analysis(t, analyzeScript());
  let result: EngineResult | undefined;

  await t.test("실행: needs-input/awaiting_review, 확인 목록, 입력 무결성 변화 없음", async () => {
    const run = await a.cli(["run", "--task", a.task]);
    result = expectRunResult(run);
    assert.deepEqual([result.status, result.reason, run.exitCode], ["needs-input", "awaiting_review", 3]);
    assert.ok((result.review?.checklist.length ?? 0) > 0, "the result carries the checklist");
    assert.deepEqual(result.verifiers.map((verifier) => [verifier.id, verifier.kind, verifier.outcome]), [["sales", "data_checks", "pass"]]);
    assert.equal(readFileSync(join(a.sb.workspace, "out", "summary.csv"), "utf8"), SALES_SUMMARY_CSV);
    assert.equal(readFileSync(join(a.sb.workspace, "data", "sales.csv"), "utf8"), SALES_CSV, "the protected input is unchanged");
    const integrity = readRunFiles(a.sb.workspace, result).records.filter((record) => record.type === "integrity_checked");
    assert.ok(integrity.length > 0 && integrity.every((record) => record.type === "integrity_checked" && record.changed.length === 0));
  });

  await t.test("review --accept: review.json만 쓰고 결과와 기록은 그대로", async () => {
    assert.ok(result !== undefined, "the run step must pass first");
    const runDir = runDirPath(a.sb.workspace, result.runId);
    const resultBefore = readFileSync(join(runDir, "result.json"));
    const journalBefore = readFileSync(join(runDir, "journal.jsonl"));
    const output = expectReviewOutput(await a.cli(reviewArgs(a.task, result.runId, "accept", "해석이 표와 맞음")), result.runId);
    assert.deepEqual([output.verdict, output.replaced, output.exitCode], ["accepted", false, 0]);
    assert.deepEqual(output.checklist, result.review?.checklist);
    assert.ok(existsSync(join(runDir, REVIEW_FILE_NAME)));
    assert.deepEqual(readFileSync(join(runDir, "result.json")), resultBefore, "the run's status does not change (M-16)");
    assert.deepEqual(readFileSync(join(runDir, "journal.jsonl")), journalBefore, "the journal is append-only and untouched");
  });

  await t.test("report에 사람 확인이 보이고, 다시 --reject하면 바뀐다(replaced)", async () => {
    assert.ok(result !== undefined, "the run step must pass first");
    // The report's exit code follows the report (complete 0), not the run's status.
    const report = await a.cli(["report", "--workspace", a.sb.workspace, "--run", result.runId]);
    assert.equal(report.exitCode, 0, `report: ${report.stdout.slice(0, 300)}`);
    assert.match(report.stdout, /accepted/i, "the report shows the verdict");
    const output = expectReviewOutput(await a.cli(reviewArgs(a.task, result.runId, "reject")), result.runId);
    assert.deepEqual([output.verdict, output.replaced], ["rejected", true]);
    const stored = JSON.parse(readFileSync(join(runDirPath(a.sb.workspace, result.runId), REVIEW_FILE_NAME), "utf8")) as { verdict: string };
    assert.equal(stored.verdict, "rejected");
  });
});

test("G-G GI-07 틀린 합계는 data_checks가 잡아 재수정으로 돌려보내고, 근거에는 비교한 수만 있다", { timeout: 120_000 }, async (t) => {
  const a = analysis(t, analyzeRepairScript());
  const result = expectRunResult(await a.cli(["run", "--task", a.task]));
  assert.deepEqual([result.status, result.reason, result.usage.repairAttempts], ["needs-input", "awaiting_review", 1]);
  const records = readRunFiles(a.sb.workspace, result).records;
  const failed = records.flatMap((record) => (record.type === "verifier_result" && record.result.outcome === "fail" ? [record.result] : []));
  assert.equal(failed.length, 1, "the first round fails");
  const evidence = failed[0]?.evidence ?? "";
  assert.ok(evidence.includes("150") && evidence.includes("150.5"), "the evidence names the two numbers compared");
  for (const cell of ["Widget, large", 'Gadget "Pro"', "Doohickey"]) assert.ok(!evidence.includes(cell), `no other cell value: ${cell}`);
  assert.equal(readFileSync(join(a.sb.workspace, "out", "summary.csv"), "utf8"), SALES_SUMMARY_CSV, "the repair wrote the right total");
});

test("G-G GG-D03 원본을 해석하지 못하면 verifier_inconclusive, 재수정과 사람 확인 없음", { timeout: 120_000 }, async (t) => {
  const a = analysis(t, analyzeScript(), SALES_CSV_NOT_A_NUMBER);
  const run = await a.cli(["run", "--task", a.task]);
  const result = expectRunResult(run);
  assert.deepEqual([result.status, result.reason, run.exitCode, result.usage.repairAttempts], ["needs-input", "verifier_inconclusive", 3, 0]);
  assert.equal(result.review, undefined, "no review is asked without a passing check");
});

test("G-G GG-D04 review 오류: 확인 대기가 아닌 실행, 키가 든 메모, 긴 메모, 두 판정, 아무것도 쓰지 않음", { timeout: 120_000 }, async (t) => {
  const done = analysis(t, analyzeScript(), SALES_CSV, cliEnv(), { completion: "verifiers" });
  const plain = expectRunResult(await done.cli(["run", "--task", done.task]));
  assert.equal(plain.status, "done", "with completion verifiers the same analysis ends as done");
  const afterDone = treeBytes(done.sb.workspace);
  assertRefused(await done.cli(reviewArgs(done.task, plain.runId, "accept")), "run_not_awaiting_review");
  assert.deepEqual(treeBytes(done.sb.workspace), afterDone, "no review.json for a run that does not wait for one");

  // The same task file, now with the analyze definition's human review.
  const waitingTask = writeGeneralTask(done.sb, { id: "gg-analyze-2", label: "analyze", fields: { workflowRef: "analyze" }, policy: { protectedPaths: ["data"] }, verifiers: [salesDataChecks()] }, analyzeScript());
  const waiting = expectRunResult(await done.cli(["run", "--task", waitingTask]));
  assert.equal(waiting.reason, "awaiting_review");
  const afterRuns = treeBytes(done.sb.workspace);
  const keyShaped = ["sk", "ant", "codaryn0test0shape0only"].join("-");
  assert.ok(new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE).test(keyShaped));
  assertRefused(await done.cli(reviewArgs(waitingTask, waiting.runId, "accept", `메모 ${keyShaped}`)), "key_in_file");
  expectCliError(await done.cli(reviewArgs(waitingTask, waiting.runId, "accept", "가".repeat(501))), "invalid_arguments");
  expectCliError(await done.cli([...reviewArgs(waitingTask, waiting.runId, "accept"), "--reject"]), "invalid_arguments");
  assert.deepEqual(treeBytes(done.sb.workspace), afterRuns, "no review.json was written");
});

test("G-G GG-D05 원본 칸의 등록 비밀은 검증 근거·기록·출력에 원문으로 나오지 않는다", { timeout: 120_000 }, async (t) => {
  const source = SALES_CSV.replace("Doohickey", FAKE_SECRET_A);
  const a = analysis(t, analyzeScript(), source, cliEnv({ extra: { [FAKE_SECRET_ENV_A]: FAKE_SECRET_A } }));
  const taskJson = JSON.parse(readFileSync(a.task, "utf8")) as Record<string, unknown>;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(a.task, JSON.stringify({ ...taskJson, privacy: { secretEnv: [FAKE_SECRET_ENV_A] } }));
  const run = await a.cli(["run", "--task", a.task]);
  const result = expectRunResult(run);
  const files = readRunFiles(a.sb.workspace, result);
  const sources = [
    { label: "stdout", text: run.stdout },
    { label: "stderr", text: run.stderr },
    decodedSource("stdout", run.stdout, true),
    { label: "journal", text: files.journalText },
    decodedSource("journal", files.journalText, true),
  ];
  assert.deepEqual(findLeaks(sources, [FAKE_SECRET_A], { extended: true }), []);
});
