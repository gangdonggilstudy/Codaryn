/**
 * Final review fixes (docs/work-orders/phase-3-self-development.md, "투입 전 최종 검토(L1) 결함 수정"):
 * - V-1: the failure signature normalizes only numbers that change from run to run (times,
 *   durations, dates, addresses). A failure that moves (a different actual value) is progress,
 *   not the same failure.
 * - V-2: a command whose output the runner stopped reading (exit grace, time limit, cancel) is
 *   `truncated`, so the slack rule drops a secret cut at that point; complete lines before stay.
 * - V-3: `--env-file-if-exists` is refused like `--env-file` (Node reads both names itself).
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { RUN_EXIT_CODES } from "../../src/contracts/index.js";
import type { CommandVerifierConfig, RunCommandPayload } from "../../src/contracts/index.js";
import { writeEnvFile } from "../fixtures/anthropic.js";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import {
  CUT_AFTER_EXIT_PATH,
  CUT_COMPLETE_MARK,
  CUT_LATE_MARK,
  EDIT_WRONG_FIX,
  PRICE_CHECK_PATH,
  PRICE_FIXED,
  PRICE_PATH,
  PRICE_WRONG_FIX,
  fileEdit,
  writeRepairProject,
} from "../fixtures/repair-project.js";
import { FAKE_ENV_FILE_VALUE, FAKE_SECRET_ENV_A, FRAGMENT_SECRET } from "../fixtures/secrets.js";
import {
  NODE,
  cliEnv,
  expectCliError,
  expectRunResult,
  payloadOf,
  readRunFiles,
  runTask,
  startCli,
  toolResultFor,
} from "../support/cli.js";
import { decodedSource, findFragments, findLeaks, stateRecordTexts } from "../support/leak.js";
import { repairStarts, roundOutcomes, verifierResults } from "../support/repair-check.js";
import { attemptSteps, callStep, finalStep, readStep, spareSteps } from "../support/repair-script.js";
import type { Attempt } from "../support/repair-script.js";

const CHECK_VERIFIER: CommandVerifierConfig = { id: "check", kind: "command", executable: NODE, args: [PRICE_CHECK_PATH], timeoutMs: 30_000 };

test("V-1 실패 지점이 옮겨 가면(실제 값이 바뀜) 같은 실패로 묶지 않는다", { timeout: 180_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb);
  // 999.9 (subtracts the rate) → 1000.1 (adds it) → fixed. Only the actual value changes between
  // the two failures; with every number normalized they would look the same.
  const toPlus = fileEdit(PRICE_PATH, PRICE_WRONG_FIX, "return sum - discountRate;", "return sum + discountRate;");
  const toFixed = fileEdit(PRICE_PATH, toPlus.after, "return sum + discountRate;", "return Math.round(sum * (1 - discountRate));");
  const attempts: Attempt[] = [{ edits: [EDIT_WRONG_FIX] }, { edits: [toPlus] }, { edits: [toFixed] }];
  const taskPath = writeTask(sb, { id: "v1-moving", limits: { maxRepairAttempts: 3 }, verifiers: [CHECK_VERIFIER] }, [
    ...attemptSteps(attempts),
    ...spareSteps(1),
  ]);
  const result = expectRunResult(await runTask(taskPath, { cwd: sb.base, timeoutMs: 170_000 }));
  const { records } = readRunFiles(sb.workspace, result);

  const failures = verifierResults(records)
    .filter((verifier) => verifier.outcome === "fail")
    .map((verifier) => verifier.evidence);
  assert.equal(failures.length, 2);
  const allDigits = (text: string): string => text.replace(/\d+(?:\.\d+)?/g, "#");
  assert.notEqual(failures[0], failures[1], "test assumption: the failure moved");
  assert.equal(allDigits(failures[0] ?? ""), allDigits(failures[1] ?? ""), "test assumption: only numbers differ");

  assert.equal(result.status, "done", `reason ${result.reason}`);
  assert.equal(result.reason, "verified");
  assert.deepEqual(roundOutcomes(records, 1), [["check:fail"], ["check:fail"], ["check:pass"]]);
  assert.equal(repairStarts(records).length, 2);
  assert.equal(result.usage.repairAttempts, 2);
  assert.equal(result.exitCode, RUN_EXIT_CODES.done);
  assert.equal(PRICE_FIXED, toFixed.after, "test assumption: the last edit is the real fix");
});

test("V-2 실행기가 끝까지 읽지 못한 출력: 끊긴 비밀의 앞부분은 없고 완전한 줄은 남는다", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb, { secret: FRAGMENT_SECRET });
  const taskPath = writeTask(
    sb,
    {
      id: "v2-cut",
      secretEnv: [FAKE_SECRET_ENV_A],
      commands: [{ executable: NODE, argsPrefix: [CUT_AFTER_EXIT_PATH], allowExtraArgs: false }],
      verifiers: [{ id: "cut", kind: "command", executable: NODE, args: [CUT_AFTER_EXIT_PATH], timeoutMs: 30_000 }],
    },
    [
      callStep("c-cut", "run_command", { executable: NODE, args: [CUT_AFTER_EXIT_PATH], timeoutMs: 30_000 }),
      finalStep("끝"),
    ],
  );
  const run = await runTask(taskPath, { cwd: sb.base, env: cliEnv({ extra: { [FAKE_SECRET_ENV_A]: FRAGMENT_SECRET } }) });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);

  const payload = payloadOf<RunCommandPayload>(toolResultFor(files.records, "c-cut"));
  t.diagnostic(`c-cut: exitCode ${String(payload.exitCode)}, truncated ${String(payload.truncated)}, stdout ${payload.stdout.length} chars`);
  assert.equal(payload.truncated, true, "output the runner stopped reading is marked truncated (V-2)");
  assert.ok(payload.stdout.includes(CUT_COMPLETE_MARK), "complete lines well before the cut stay");
  assert.equal(payload.stdout.includes(CUT_LATE_MARK), false, "test assumption: the late line came after the cut");

  const sources = [
    { label: "stdout", text: run.stdout },
    { label: "stderr", text: run.stderr },
    ...stateRecordTexts(sb.workspace),
    decodedSource("journal", files.journalText, true),
  ];
  assert.deepEqual(findLeaks(sources, [FRAGMENT_SECRET], { extended: true }), []);
  assert.deepEqual(findFragments(sources, FRAGMENT_SECRET, 4), [], "no piece of the cut secret in any record");
});

test("V-3 --env-file-if-exists도 받지 않는다: invalid_arguments, 값은 읽히지 않음", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  writeWorkspaceFile(sb, "data/conf.txt", `service=${FAKE_ENV_FILE_VALUE}\n`);
  const taskPath = writeTask(
    sb,
    { id: "v3-if-exists", verifiers: [{ id: "r", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }] },
    [readStep("r-conf", "data/conf.txt"), finalStep("끝")],
  );
  const existing = writeEnvFile(join(sb.base, "vars.env"), { CODARYN_IT_SERVICE_TOKEN: FAKE_ENV_FILE_VALUE });
  const missing = join(sb.base, "missing.env");
  for (const [label, args] of [
    ["--env-file-if-exists <있는 파일>", ["--env-file-if-exists", existing]],
    ["--env-file-if-exists <없는 파일>", ["--env-file-if-exists", missing]],
    ["--env-file-if-exists=<있는 파일>", [`--env-file-if-exists=${existing}`]],
    ["--env-file=<있는 파일>", [`--env-file=${existing}`]],
  ] as const) {
    await t.test(label, async () => {
      const run = await startCli(["run", "--task", taskPath, ...args], { cwd: sb.base, env: cliEnv() }).done;
      const output = expectCliError(run, "invalid_arguments");
      assert.ok(output.message.includes("--vars-file"), "the message points to --vars-file");
      assert.deepEqual(findLeaks([{ label: "stdout", text: run.stdout }, { label: "stderr", text: run.stderr }], [FAKE_ENV_FILE_VALUE]), []);
    });
  }
});
