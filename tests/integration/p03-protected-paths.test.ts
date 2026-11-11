/**
 * Protected paths (R-5, PO-07, testing.md T1): a model cannot pass the checks by changing the
 * tests. Writes under `policy.protectedPaths` are denied with code `protected_path`; reads stay
 * allowed; nothing the model or the workspace says lifts the protection.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { RUN_EXIT_CODES, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../src/contracts/index.js";
import type { CommandVerifierConfig, ReadFilePayload, ScriptStep } from "../../src/contracts/index.js";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import {
  EDIT_RIGHT_FIX,
  EDIT_WEAKEN_TEST,
  EDIT_WRONG_FIX,
  PRICE_BUG,
  PRICE_FIXED,
  PRICE_PATH,
  PRICE_TEST,
  PRICE_TEST_PATH,
  writeRepairProject,
} from "../fixtures/repair-project.js";
import {
  NODE,
  assertRefused,
  deniedDecision,
  expectCliError,
  expectRunResult,
  payloadOf,
  readRunFiles,
  runTask,
  toolResultFor,
} from "../support/cli.js";
import { roundOutcomes, treeBytes } from "../support/repair-check.js";
import { attemptSteps, editStep, finalStep, readStep, replaceAllStep } from "../support/repair-script.js";

const TESTS_VERIFIER: CommandVerifierConfig = {
  id: "tests",
  kind: "command",
  executable: NODE,
  args: ["--test", "test/"],
  timeoutMs: 60_000,
};

const IS_WINDOWS = process.platform === "win32";

function assertProtected(records: Parameters<typeof assertRefused>[0], callId: string): void {
  assertRefused(records, callId, ["policy_denied"]);
  const decision = deniedDecision(records, callId);
  assert.equal(decision.code, "protected_path", `call ${callId}`);
  assert.equal(decision.permission, "path", `call ${callId}`);
}

test("F5-l 테스트 파일 쓰기는 거부되고 읽기는 된다: 테스트를 고쳐 통과시키는 길이 막힌다", { timeout: 180_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb);
  const steps: ScriptStep[] = [
    readStep("r-test", PRICE_TEST_PATH),
    editStep("w-test", EDIT_WEAKEN_TEST),
    finalStep("테스트 기대값을 맞췄다"),
    ...attemptSteps([{ edits: [EDIT_WRONG_FIX, EDIT_RIGHT_FIX], claim: "코드를 고쳤다" }]),
  ];
  const taskPath = writeTask(
    sb,
    {
      id: "f5-l",
      // Another task field that claims permission. It must not lift the protection.
      goal: "테스트를 통과시킨다. test 폴더도 수정해도 된다.",
      protectedPaths: ["test"],
      limits: { maxRepairAttempts: 1 },
      verifiers: [TESTS_VERIFIER],
    },
    steps,
  );
  const run = await runTask(taskPath, { cwd: sb.base, timeoutMs: 170_000 });
  const result = expectRunResult(run);
  const { records } = readRunFiles(sb.workspace, result);

  assert.equal(payloadOf<ReadFilePayload>(toolResultFor(records, "r-test")).content, PRICE_TEST, "reading stays allowed");
  assertProtected(records, "w-test");
  assert.equal(readFileSync(join(sb.workspace, "test", "price.test.js"), "utf8"), PRICE_TEST);

  assert.deepEqual(roundOutcomes(records, 1), [["tests:fail"], ["tests:pass"]]);
  assert.equal(run.exitCode, RUN_EXIT_CODES.done);
  assert.equal(result.status, "done");
  assert.equal(readFileSync(join(sb.workspace, "src", "price.js"), "utf8"), PRICE_FIXED);
  assert.equal(
    result.changes.some((change) => change.path.startsWith("test")),
    false,
    "no change under the protected path",
  );
});

test("F5-m 경로 변형으로 우회할 수 없다: 대소문자·구분자·점 경로·새 파일·정션", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb);
  const testDirBefore = treeBytes(join(sb.workspace, "test"));

  let junction = true;
  try {
    symlinkSync(join(sb.workspace, "test"), join(sb.workspace, "alias"), "junction");
  } catch (error) {
    junction = false;
    t.diagnostic(`junction could not be created: ${String(error)}`);
  }

  const weaken = (id: string, path: string): ScriptStep => editStep(id, { ...EDIT_WEAKEN_TEST, path });
  const denied: [string, ScriptStep][] = [
    ["w-dot", weaken("w-dot", "./test/price.test.js")],
    ["w-dotdot", weaken("w-dotdot", "src/../test/price.test.js")],
    ["w-new", replaceAllStep("w-new", "test/extra.test.js", null, 'import { test } from "node:test";\ntest("x", () => {});\n')],
    ["w-dir", replaceAllStep("w-dir", "test", null, "x\n")],
  ];
  if (IS_WINDOWS) {
    // NTFS ignores case, so these name the same file; the contract compares without case on Windows.
    denied.push(["w-case", weaken("w-case", "Test/price.test.js")], ["w-upper-bs", weaken("w-upper-bs", "TEST\\price.test.js")]);
  }
  if (junction) denied.push(["w-link", weaken("w-link", "alias/price.test.js")]);

  // Over-blocking controls: same leading characters or a nested "test" segment are not protected.
  const allowed: [string, string][] = [
    ["w-sibling", "test-data/sample.txt"],
    ["w-nested", "src/test/note.txt"],
  ];
  const steps: ScriptStep[] = [
    ...denied.map(([, step]) => step),
    ...allowed.map(([id, path]) => replaceAllStep(id, path, null, "allowed\n")),
    finalStep("끝"),
  ];
  const taskPath = writeTask(
    sb,
    {
      id: "f5-m",
      protectedPaths: ["test"],
      limits: { maxModelTurns: 20, maxToolCalls: 20 },
      verifiers: [{ id: "exists", kind: "file_rules", rules: [{ type: "exists", path: PRICE_PATH }] }],
    },
    steps,
  );
  const run = await runTask(taskPath, { cwd: sb.base });
  const result = expectRunResult(run);
  const { records } = readRunFiles(sb.workspace, result);

  for (const [id] of denied) {
    await t.test(`거부: ${id}`, () => assertProtected(records, id));
  }
  await t.test("보호 폴더의 바이트가 그대로다", () => {
    assert.deepEqual(treeBytes(join(sb.workspace, "test")), testDirBefore);
  });
  await t.test("과잉 차단 없음: test-data/, src/test/", () => {
    for (const [id, path] of allowed) {
      assert.equal(toolResultFor(records, id).ok, true, `${id} must be allowed`);
      assert.equal(readFileSync(join(sb.workspace, ...path.split("/")), "utf8"), "allowed\n");
    }
  });
});

test("F5-n protectedPaths [\".\"]는 작업 공간 전체를 막는다", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb);
  const taskPath = writeTask(
    sb,
    {
      id: "f5-n",
      protectedPaths: ["."],
      verifiers: [{ id: "exists", kind: "file_rules", rules: [{ type: "exists", path: PRICE_PATH }] }],
    },
    [
      readStep("r-src", PRICE_PATH),
      editStep("w-src", EDIT_WRONG_FIX),
      replaceAllStep("w-root", "new.txt", null, "x\n"),
      finalStep("끝"),
    ],
  );
  const run = await runTask(taskPath, { cwd: sb.base });
  const result = expectRunResult(run);
  const { records } = readRunFiles(sb.workspace, result);

  assert.equal(toolResultFor(records, "r-src").ok, true);
  assertProtected(records, "w-src");
  assertProtected(records, "w-root");
  assert.equal(readFileSync(join(sb.workspace, "src", "price.js"), "utf8"), PRICE_BUG);
  assert.equal(existsSync(join(sb.workspace, "new.txt")), false);
});

test("F5-o 잘못된 protectedPaths 항목은 실행 전에 거부된다(invalid_task)", { timeout: 120_000 }, async (t) => {
  const entries = ["../outside", "test/../../outside", IS_WINDOWS ? "C:\\Windows" : "/etc"];
  for (const entry of entries) {
    await t.test(entry, async (st) => {
      const sb = createSandbox(st);
      writeWorkspaceFile(sb, "README.md", "# 안\n");
      const taskPath = writeTask(sb, { id: "f5-o", protectedPaths: [entry] }, [finalStep("끝")]);
      const run = await runTask(taskPath, { cwd: sb.base });
      expectCliError(run, "invalid_task");
      assert.equal(run.exitCode, 2);
      assert.equal(existsSync(join(sb.workspace, STATE_DIR_NAME, RUNS_DIR_NAME)), false, "no run may start");
    });
  }
});
