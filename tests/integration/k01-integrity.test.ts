/**
 * U-1, U-2 (docs/work-orders/phase-3-self-development.md, src/contracts/integrity.ts): protected
 * material is hashed at run start and before and after each verification round. A command the
 * policy allows can still change it; the engine then ends the run as needs-input/protected_changed,
 * runs no further verifier, repairs nothing and asks the model nothing more.
 * Practice project: tests/fixtures/repair-project.ts. Changes are made with tamper.mjs
 * (tests/fixtures/self-dev.ts), an allowed command.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { MAX_INTEGRITY_PATHS, PRIVACY_TOKEN_PREFIX, RUN_EXIT_CODES, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../src/contracts/index.js";
import type { CliErrorCode, CommandRule, EngineResult, JournalRecord, Limits, ScriptStep, VerifierConfig } from "../../src/contracts/index.js";
import { writeConfigFile } from "../fixtures/anthropic.js";
import { createSandbox, writeTask } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { EDIT_RIGHT_FIX, EDIT_WRONG_FIX, PRICE_CHECK_PATH, PRICE_FIXED, PRICE_PATH, writeRepairProject } from "../fixtures/repair-project.js";
import { FAKE_SECRET_A, FAKE_SECRET_ENV_A } from "../fixtures/secrets.js";
import { writeTamperProgram } from "../fixtures/self-dev.js";
import { NODE, cliEnv, expectCliError, expectRunResult, readRunFiles, startCli } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { decodedSource, findLeaks, stateRecordTexts } from "../support/leak.js";
import { integrityChecks, repairStarts, verifierResults } from "../support/repair-check.js";
import { editStep, finalStep, spareSteps } from "../support/repair-script.js";
import { tamperStep } from "../support/self-dev-script.js";

const IS_WINDOWS = process.platform === "win32";
const PROTECTED = ["test", "checks"];
const PROTECTED_TEST = "test/price.test.js";
const CHECK_VERIFIER: VerifierConfig = { id: "check", kind: "command", executable: NODE, args: [PRICE_CHECK_PATH], timeoutMs: 30_000 };
const FIX_STEPS: ScriptStep[] = [editStep("w-wrong", EDIT_WRONG_FIX), editStep("w-right", EDIT_RIGHT_FIX)];

interface Setup {
  readonly sb: Sandbox;
  readonly tamper: CommandRule;
  /** `<base>/material`: verification material outside the workspace. */
  readonly material: string;
}

function setup(t: TestContext): Setup {
  const sb = createSandbox(t);
  writeRepairProject(sb);
  const tamper = writeTamperProgram(sb);
  const material = join(sb.base, "material");
  mkdirSync(join(material, "suite"), { recursive: true });
  writeFileSync(join(material, "rules.txt"), "baseline rules\n");
  writeFileSync(join(material, "suite", "a.txt"), "baseline suite\n");
  return { sb, tamper, material };
}

interface RunOptions {
  readonly id: string;
  readonly steps: readonly ScriptStep[];
  readonly protectedPaths?: readonly string[];
  /** Written to a config file's `integrity.paths` when given. */
  readonly integrityPaths?: readonly string[];
  readonly limits?: Partial<Limits>;
  readonly verifiers?: readonly VerifierConfig[];
  readonly commands?: readonly CommandRule[];
  readonly secretEnv?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
}

function startRun(s: Setup, options: RunOptions): Promise<CliRun> {
  const taskPath = writeTask(
    s.sb,
    {
      id: options.id,
      workflow: "code",
      commands: options.commands ?? [s.tamper],
      ...(options.protectedPaths === undefined ? {} : { protectedPaths: options.protectedPaths }),
      ...(options.secretEnv === undefined ? {} : { secretEnv: options.secretEnv }),
      limits: { maxRepairAttempts: 3, ...options.limits },
      verifiers: options.verifiers ?? [CHECK_VERIFIER],
    },
    options.steps,
  );
  const args = ["run", "--task", taskPath];
  if (options.integrityPaths !== undefined) {
    args.push("--config", writeConfigFile(s.sb, { schemaVersion: 1, integrity: { paths: options.integrityPaths } }));
  }
  return startCli(args, { cwd: s.sb.base, env: options.env ?? cliEnv(), timeoutMs: 110_000 }).done;
}

interface Outcome {
  readonly run: CliRun;
  readonly result: EngineResult;
  readonly records: readonly JournalRecord[];
  readonly journalText: string;
  readonly resultText: string;
}

async function runToResult(s: Setup, options: RunOptions): Promise<Outcome> {
  const run = await startRun(s, options);
  const result = expectRunResult(run);
  const files = readRunFiles(s.sb.workspace, result);
  return { run, result, records: files.records, journalText: files.journalText, resultText: files.resultText };
}

/** needs-input/protected_changed with `changed` as the last check, no repair, no verifier after it. */
function assertProtectedChanged(outcome: Outcome, changed: readonly string[], turns: number): void {
  const { run, result, records } = outcome;
  assert.equal(run.exitCode, RUN_EXIT_CODES["needs-input"]);
  assert.equal(result.status, "needs-input");
  assert.equal(result.reason, "protected_changed");
  assert.deepEqual(result.protectedChanged, changed);
  const checks = integrityChecks(records);
  assert.deepEqual(checks.at(-1)?.changed, changed, "the last integrity_checked names the changed paths");
  assert.deepEqual(checks[0], { phase: "run_start", changed: [] });
  assert.equal(repairStarts(records).length, 0, "a protected change is not something to repair");
  assert.equal(result.usage.modelTurns, turns, "no model request after the change was found");
  let lastCheck = -1;
  records.forEach((record, index) => {
    if (record.type === "integrity_checked") lastCheck = index;
  });
  assert.equal(
    records.slice(lastCheck + 1).some((record) => record.type === "verifier_result" || record.type === "model_request"),
    false,
    "nothing runs after a non-empty check",
  );
}

/** `/` separated, as the checker shows paths outside the workspace. */
function shown(absolute: string): string {
  return absolute.split(sep).join("/");
}

test("U-1·U-2 허용된 명령이 보호 테스트를 고치면 검증하지 않고 needs-input/protected_changed", { timeout: 180_000 }, async (t) => {
  for (const [mode, path] of [
    ["append", PROTECTED_TEST],
    ["delete", PROTECTED_TEST],
    ["create", "test/planted.test.js"],
  ] as const) {
    await t.test(`${mode} ${path}`, async (st) => {
      const s = setup(st);
      const steps = [tamperStep("c-tamper", mode, path), ...FIX_STEPS, finalStep("고쳤다"), ...spareSteps(2)];
      const outcome = await runToResult(s, { id: `k01-${mode}`, steps, protectedPaths: PROTECTED });
      assertProtectedChanged(outcome, [path], 4);
      assert.deepEqual(
        integrityChecks(outcome.records).map((check) => check.phase),
        ["run_start", "before_verify"],
      );
      assert.equal(verifierResults(outcome.records).length, 0, "the round's verifiers are not run");
    });
  }
});

test("U-2 검증기 자신이 보호 자료를 고치면 결과가 통과여도 protected_changed", { timeout: 120_000 }, async (t) => {
  const s = setup(t);
  const tamperingVerifier: VerifierConfig = {
    id: "passes-but-tampers",
    kind: "command",
    executable: NODE,
    args: ["tamper.mjs", "append", PROTECTED_TEST],
    timeoutMs: 30_000,
  };
  const outcome = await runToResult(s, {
    id: "k01-verify-tamper",
    steps: [finalStep("끝"), ...spareSteps(2)],
    protectedPaths: PROTECTED,
    verifiers: [tamperingVerifier],
  });
  assert.deepEqual(
    verifierResults(outcome.records).map((result) => result.outcome),
    ["pass"],
    "test assumption: the verifier itself passed",
  );
  assertProtectedChanged(outcome, [PROTECTED_TEST], 1);
  assert.deepEqual(
    integrityChecks(outcome.records).map((check) => check.phase),
    ["run_start", "before_verify", "after_verify"],
  );
});

test("U-1 작업 공간 밖 검증 자료(integrity.paths)가 바뀌어도 protected_changed", { timeout: 180_000 }, async (t) => {
  for (const [label, mode, relative] of [
    ["파일 항목 수정", "append", "rules.txt"],
    ["디렉터리 항목 아래 새 파일", "create", "suite/new.txt"],
    ["디렉터리 항목 아래 삭제", "delete", "suite/a.txt"],
  ] as const) {
    await t.test(label, async (st) => {
      const s = setup(st);
      const target = join(s.material, ...relative.split("/"));
      const steps = [tamperStep("c-outside", mode, target), finalStep("끝"), ...spareSteps(2)];
      const outcome = await runToResult(s, {
        id: "k01-outside",
        steps,
        integrityPaths: [join(s.material, "rules.txt"), join(s.material, "suite")],
      });
      assertProtectedChanged(outcome, [shown(target)], 2);
      const [changed] = outcome.result.protectedChanged ?? [];
      assert.ok(changed !== undefined && !changed.includes("\\"), "outside paths are shown `/` separated");
    });
  }
});

test("U-2 비교 기준은 run_start: 한 번 재수정한 뒤의 변경도 잡는다", { timeout: 180_000 }, async (t) => {
  const s = setup(t);
  const steps = [
    editStep("w-wrong", EDIT_WRONG_FIX),
    finalStep("첫 수정"),
    tamperStep("c-tamper", "append", PROTECTED_TEST),
    editStep("w-right", EDIT_RIGHT_FIX),
    finalStep("다시 고쳤다"),
    ...spareSteps(2),
  ];
  const run = await startRun(s, { id: "k01-after-repair", steps, protectedPaths: PROTECTED });
  const result = expectRunResult(run);
  const { records } = readRunFiles(s.sb.workspace, result);
  assert.equal(result.reason, "protected_changed");
  assert.deepEqual(
    integrityChecks(records).map((check) => `${check.phase}:${check.changed.length}`),
    ["run_start:0", "before_verify:0", "after_verify:0", "before_verify:1"],
  );
  assert.equal(repairStarts(records).length, 1, "the first, ordinary failure was repaired");
  assert.equal(result.usage.modelTurns, 5);
});

test("U-2 바뀐 경로는 가림본으로 남는다(파일 이름에 든 가짜 비밀)", { timeout: 120_000 }, async (t) => {
  const s = setup(t);
  const planted = `test/${FAKE_SECRET_A}.txt`;
  const outcome = await runToResult(s, {
    id: "k01-masked-path",
    steps: [tamperStep("c-plant", "create", planted), finalStep("끝"), ...spareSteps(1)],
    protectedPaths: PROTECTED,
    secretEnv: [FAKE_SECRET_ENV_A],
    env: cliEnv({ extra: { [FAKE_SECRET_ENV_A]: FAKE_SECRET_A } }),
  });
  assert.equal(outcome.result.reason, "protected_changed");
  const [changed] = outcome.result.protectedChanged ?? [];
  assert.ok(changed?.startsWith("test/") && changed.includes(PRIVACY_TOKEN_PREFIX), `masked path expected, got ${String(changed)}`);
  const sources = [
    { label: "stdout", text: outcome.run.stdout },
    { label: "stderr", text: outcome.run.stderr },
    ...stateRecordTexts(s.sb.workspace),
    decodedSource("journal", outcome.journalText, true),
  ];
  assert.deepEqual(findLeaks(sources, [FAKE_SECRET_A], { extended: true }), []);
});

test("U-1 대조군: 보호 대상이 그대로면 정상 판정, 보호가 없으면 확인도 기록도 없다", { timeout: 180_000 }, async (t) => {
  await t.test("보호 경로와 integrity.paths가 그대로 → done, 세 확인 모두 빈 목록", async (st) => {
    const s = setup(st);
    const outcome = await runToResult(s, {
      id: "k01-clean",
      steps: [...FIX_STEPS, finalStep("고쳤다")],
      protectedPaths: PROTECTED,
      integrityPaths: [join(s.material, "rules.txt")],
    });
    assert.equal(outcome.result.status, "done");
    assert.deepEqual(outcome.result.protectedChanged, []);
    assert.deepEqual(integrityChecks(outcome.records), [
      { phase: "run_start", changed: [] },
      { phase: "before_verify", changed: [] },
      { phase: "after_verify", changed: [] },
    ]);
    assert.equal(readFileSync(join(s.sb.workspace, ...PRICE_PATH.split("/")), "utf8"), PRICE_FIXED);
  });
  await t.test("보호 밖 파일만 명령이 고침 → done", async (st) => {
    const s = setup(st);
    const outcome = await runToResult(s, {
      id: "k01-unprotected",
      steps: [tamperStep("c-free", "create", "notes.txt"), ...FIX_STEPS, finalStep("고쳤다")],
      protectedPaths: PROTECTED,
    });
    assert.equal(outcome.result.status, "done");
    assert.deepEqual(outcome.result.protectedChanged, []);
  });
  await t.test("보호 없음(빈 integrity.paths 포함) → integrity_checked 없음, protectedChanged 없음", async (st) => {
    const s = setup(st);
    const outcome = await runToResult(s, {
      id: "k01-none",
      steps: [...FIX_STEPS, finalStep("고쳤다")],
      integrityPaths: [],
    });
    assert.equal(outcome.result.status, "done");
    assert.equal(integrityChecks(outcome.records).length, 0);
    assert.equal("protectedChanged" in outcome.result, false);
  });
});

test("U-1 integrity.paths 검사: 형식·위치 위반은 invalid_config, 메시지에 경로 없음, task 파일로는 못 정함", { timeout: 120_000 }, async (t) => {
  const refused = async (st: TestContext, paths: (s: Setup) => string[], code: CliErrorCode = "invalid_config") => {
    const s = setup(st);
    const given = paths(s);
    const run = await startRun(s, { id: "k01-bad", steps: [finalStep("끝")], integrityPaths: given });
    const output = expectCliError(run, code);
    assert.equal(existsSync(join(s.sb.workspace, STATE_DIR_NAME, RUNS_DIR_NAME)), false, "no run may start");
    for (const path of given) {
      if (path.length > 8) assert.equal(output.message.includes(path), false, "messages name the position, not the path");
    }
  };
  await t.test("상대 경로", (st) => refused(st, () => ["material/rules.txt"]));
  await t.test("없는 경로", (st) => refused(st, (s) => [join(s.material, "missing.txt")]));
  await t.test("작업 공간 안", (st) => refused(st, (s) => [join(s.sb.workspace, "test")]));
  await t.test("작업 공간 루트", (st) => refused(st, (s) => [s.sb.workspace]));
  await t.test("작업 공간을 포함", (st) => refused(st, (s) => [s.sb.base]));
  await t.test(`${MAX_INTEGRITY_PATHS + 1}개`, (st) =>
    refused(st, (s) => Array.from({ length: MAX_INTEGRITY_PATHS + 1 }, () => join(s.material, "rules.txt"))),
  );
  await t.test("UNC", { skip: IS_WINDOWS ? false : "Windows paths" }, (st) =>
    refused(st, () => ["\\\\127.0.0.1\\codaryn-it-absent\\rules.txt"]),
  );
  await t.test("task 파일의 integrity → invalid_task", async (st) => {
    const s = setup(st);
    const taskPath = writeTask(s.sb, { id: "k01-task-integrity", verifiers: [CHECK_VERIFIER] }, [finalStep("끝")]);
    const task = JSON.parse(readFileSync(taskPath, "utf8")) as Record<string, unknown>;
    task["integrity"] = { paths: [join(s.material, "rules.txt")] };
    writeFileSync(taskPath, JSON.stringify(task, null, 2));
    const run = await startCli(["run", "--task", taskPath], { cwd: s.sb.base }).done;
    expectCliError(run, "invalid_task");
  });
});
