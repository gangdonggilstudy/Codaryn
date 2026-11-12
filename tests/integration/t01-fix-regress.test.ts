/**
 * Fix batch T (docs/work-orders/phase-2-repair-loop.md, "단계 2 교차 검토(F6) 결함 수정"):
 * process-level regressions for T-3, T-9, T-10, T-12, T-13 and T-14. T-1, T-2 and T-4 are in
 * g01-windows-cmd, T-5 and T-8 in p01-repair-loop, T-6 in p02-repair-feedback, T-15 in m02 and
 * s01. Cases that need the anthropic provider use the local fake server (mock API, not the real
 * API) with the network guard. Only fake keys and fake secrets.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  ANTHROPIC_KEY_REFUSAL_PATTERN_SOURCE,
  MAX_COMMAND_TIMEOUT_MS,
  MAX_OUTPUT_TOKENS_LIMIT,
  REVERT_EXIT_CODES,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
} from "../../src/contracts/index.js";
import type { CliErrorCode, VerifierConfig } from "../../src/contracts/index.js";
import { ANTHROPIC_REFUSED_SHAPE, FAKE_MODEL_CONFIG, fakeApiConfig, writeAnthropicTask, writeConfigFile } from "../fixtures/anthropic.js";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { writeProgram } from "../fixtures/programs.js";
import {
  EDIT_WEAKEN_TEST,
  EDIT_WRONG_FIX,
  PRICE_BUG,
  PRICE_PATH,
  PRICE_TEST,
  writeRepairProject,
} from "../fixtures/repair-project.js";
import { FAKE_API_KEY } from "../fixtures/secrets.js";
import {
  NODE,
  assertRefused,
  cliEnv,
  deniedDecision,
  expectCliError,
  expectRunResult,
  isProcessAlive,
  lockPath,
  parseCliOutput,
  readRunFiles,
  runTask,
  startCli,
  toolResultFor,
  UNASSIGNABLE_PID,
} from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { MOCK_LABEL, replyText, runGuarded, sentMaxTokens, startFakeAnthropic } from "../support/fake-anthropic.js";
import { expectRevertOutput, revertSummary, runRevert, treeBytes } from "../support/repair-check.js";
import { callStep, editStep, finalStep, replaceAllStep } from "../support/repair-script.js";

const IS_WINDOWS = process.platform === "win32";
const README_EXISTS: readonly VerifierConfig[] = [
  { id: "readme", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] },
];

function runCli(sb: Sandbox, args: readonly string[], env: NodeJS.ProcessEnv = cliEnv()): Promise<CliRun> {
  return startCli(args, { cwd: sb.base, env }).done;
}

function assertNoRun(sb: Sandbox): void {
  assert.equal(existsSync(join(sb.workspace, STATE_DIR_NAME, RUNS_DIR_NAME)), false, "no run may start");
}

function assertPreRun(run: CliRun, code: CliErrorCode, sb: Sandbox): string {
  const output = expectCliError(run, code);
  assertNoRun(sb);
  return output.message;
}

test("T-3 모델이 준 run_command timeoutMs는 MAX_COMMAND_TIMEOUT_MS 이하만 받는다", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  writeProgram(sb, "exit-code.mjs");
  const command = (id: string, timeoutMs: number) =>
    callStep(id, "run_command", { executable: NODE, args: ["exit-code.mjs", "0"], timeoutMs });
  const taskPath = writeTask(
    sb,
    {
      id: "t3-timeout",
      commands: [{ executable: NODE, argsPrefix: ["exit-code.mjs"], allowExtraArgs: true }],
      verifiers: README_EXISTS,
    },
    [command("c-over", MAX_COMMAND_TIMEOUT_MS + 1), command("c-at", MAX_COMMAND_TIMEOUT_MS), finalStep("끝")],
  );
  const result = expectRunResult(await runTask(taskPath, { cwd: sb.base }));
  const { records } = readRunFiles(sb.workspace, result);
  assertRefused(records, "c-over", ["invalid_args"]);
  assert.equal(toolResultFor(records, "c-at").ok, true, "the cap itself is allowed");
});

test("T-9 죽은 잠금을 여러 프로세스가 동시에 회수해도 하나만 실행한다", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  const taskPath = writeTask(sb, { id: "t9-reclaim", verifiers: README_EXISTS }, [
    { text: "잠금을 쥐고 기다린다", delayMs: 4_000 },
    finalStep("끝"),
  ]);
  // Not the pid of an exited process: one the system may hand out again during the run (Z-2).
  const deadPid = UNASSIGNABLE_PID;
  assert.ok(!isProcessAlive(deadPid), "test assumption: the lock holder is dead");
  mkdirSync(join(sb.workspace, STATE_DIR_NAME), { recursive: true });
  writeFileSync(
    lockPath(sb.workspace),
    JSON.stringify({ pid: deadPid, runId: "20000101T000000Z-deadbeef", startedAt: "2000-01-01T00:00:00Z" }),
  );

  const contenders = 6;
  const runs = await Promise.all(
    Array.from({ length: contenders }, () => runTask(taskPath, { cwd: sb.base, timeoutMs: 90_000 })),
  );
  const outputs = runs.map((run) => parseCliOutput(run));
  const winners = outputs.filter((output) => output.kind === "run");
  const losers = outputs.flatMap((output) => (output.kind === "error" ? [output.code] : []));
  t.diagnostic(`outcomes: ${outputs.map((output) => (output.kind === "run" ? output.status : output.code)).join(", ")}`);
  t.diagnostic(
    `dead holder pid ${deadPid}, alive after the runs ${String(isProcessAlive(deadPid))}; ` +
      `contender pids ${runs.map((run) => String(run.pid)).join(", ")}; ` +
      `messages ${outputs.map((output) => (output.kind === "error" ? output.message : output.status)).join(" | ")}`,
  );
  assert.equal(winners.length, 1, "exactly one process may take over the dead lock");
  assert.deepEqual(losers, Array.from({ length: contenders - 1 }, () => "workspace_locked"));
  assert.equal(readdirSync(join(sb.workspace, STATE_DIR_NAME, RUNS_DIR_NAME)).length, 1, "only one run directory");
  assert.equal(existsSync(lockPath(sb.workspace)), false, "the winner released the lock");
});

test("T-10 되돌리기: 기록 없는 스냅샷은 missing_record, journal의 잘린 마지막 줄은 무시", { timeout: 120_000 }, async (t) => {
  /** A run that changes src/price.js and then creates notes/new.md. */
  async function changingRun(sb: Sandbox, id: string): Promise<{ runId: string; journal: string }> {
    const taskPath = writeTask(sb, { id, verifiers: README_EXISTS }, [
      editStep("w-price", EDIT_WRONG_FIX),
      replaceAllStep("c-new", "notes/new.md", null, "새 메모\n"),
      finalStep("바꿨다"),
    ]);
    const result = expectRunResult(await runTask(taskPath, { cwd: sb.base }));
    const { runDir } = readRunFiles(sb.workspace, result);
    return { runId: result.runId, journal: join(runDir, "journal.jsonl") };
  }

  await t.test("스냅샷 뒤 기록 전에 멈춘 경로 → missing_record, partial", async (st) => {
    const sb = createSandbox(st);
    writeRepairProject(sb);
    writeWorkspaceFile(sb, "README.md", "# 연습\n");
    const { runId, journal } = await changingRun(sb, "t10-missing-record");
    // As if the process died while it wrote the record of notes/new.md: the snapshot exists, the
    // journal ends in the middle of that line.
    const lines = readFileSync(journal, "utf8").split("\n");
    const cutAt = lines.findIndex((line) => line.includes('"type":"file_changed"') && line.includes("notes/new.md"));
    assert.ok(cutAt > 0, "test assumption: the journal records the created file");
    const cutLine = lines[cutAt] ?? "";
    writeFileSync(journal, `${lines.slice(0, cutAt).join("\n")}\n${cutLine.slice(0, Math.floor(cutLine.length / 2))}`);

    const revert = await runRevert(sb.workspace, runId, { cwd: sb.base });
    const output = expectRevertOutput(revert, runId);
    assert.equal(output.status, "partial");
    assert.equal(revert.exitCode, REVERT_EXIT_CODES.partial);
    assert.deepEqual(revertSummary(output), {
      reverted: [`${PRICE_PATH}:restored`],
      skipped: ["notes/new.md:missing_record"],
    });
    assert.equal(readFileSync(join(sb.workspace, "src", "price.js"), "utf8"), PRICE_BUG);
    assert.ok(existsSync(join(sb.workspace, "notes", "new.md")), "a path without a record is not touched");
  });

  await t.test("잘린 마지막 줄만 있는 journal도 되돌린다 → complete", async (st) => {
    const sb = createSandbox(st);
    writeRepairProject(sb);
    writeWorkspaceFile(sb, "README.md", "# 연습\n");
    const { runId, journal } = await changingRun(sb, "t10-cut-tail");
    const text = readFileSync(journal, "utf8").replace(/\n$/, "");
    const lastStart = text.lastIndexOf("\n") + 1;
    writeFileSync(journal, text.slice(0, lastStart + Math.floor((text.length - lastStart) / 2)));

    const revert = await runRevert(sb.workspace, runId, { cwd: sb.base });
    const output = expectRevertOutput(revert, runId);
    assert.equal(output.status, "complete");
    assert.equal(revert.exitCode, REVERT_EXIT_CODES.complete);
    assert.equal(readFileSync(join(sb.workspace, "src", "price.js"), "utf8"), PRICE_BUG);
    assert.equal(existsSync(join(sb.workspace, "notes", "new.md")), false);
  });
});

test("T-12 revert의 --workspace UNC 거부, run의 --cancel-file이 작업 공간 안이면 거부", { timeout: 60_000 }, async (t) => {
  await t.test("revert --workspace UNC → invalid_arguments", { skip: IS_WINDOWS ? false : "Windows paths" }, async (st) => {
    const sb = createSandbox(st);
    const revert = await runRevert("\\\\127.0.0.1\\codaryn-it-absent\\ws", "20000101T000000Z-deadbeef", { cwd: sb.base });
    expectCliError(revert, "invalid_arguments");
    assert.ok(revert.durationMs < 15_000, `refused only after ${revert.durationMs} ms`);
  });
  await t.test("run --cancel-file 작업 공간 안 → invalid_arguments", async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "README.md", "# 연습\n");
    const taskPath = writeTask(sb, { id: "t12-cancel", verifiers: README_EXISTS }, [finalStep("끝")]);
    const run = await runCli(sb, ["run", "--task", taskPath, "--cancel-file", join(sb.workspace, "cancel.flag")]);
    assertPreRun(run, "invalid_arguments", sb);
  });
});

test("T-13 protectedPaths 항목이 링크면 실경로도 보호하고, 밖을 가리키면 모든 쓰기 거부", { skip: IS_WINDOWS ? false : "junctions", timeout: 60_000 }, async (t) => {
  await t.test("작업 공간 안 정션 → 실경로(test/) 쓰기도 protected_path", async (st) => {
    const sb = createSandbox(st);
    writeRepairProject(sb);
    try {
      symlinkSync(join(sb.workspace, "test"), join(sb.workspace, "spec"), "junction");
    } catch (error) {
      st.skip(`junction could not be created: ${String(error)}`);
      return;
    }
    const taskPath = writeTask(
      sb,
      { id: "t13-link", protectedPaths: ["spec"], verifiers: [{ id: "x", kind: "file_rules", rules: [{ type: "exists", path: PRICE_PATH }] }] },
      [editStep("w-real", EDIT_WEAKEN_TEST), editStep("w-link", { ...EDIT_WEAKEN_TEST, path: "spec/price.test.js" }), finalStep("끝")],
    );
    const result = expectRunResult(await runTask(taskPath, { cwd: sb.base }));
    const { records } = readRunFiles(sb.workspace, result);
    for (const id of ["w-real", "w-link"]) {
      assertRefused(records, id, ["policy_denied"]);
      assert.equal(deniedDecision(records, id).code, "protected_path", id);
    }
    assert.equal(readFileSync(join(sb.workspace, "test", "price.test.js"), "utf8"), PRICE_TEST);
  });
  // T-13 (settled after integration): the format check stays lexical, so the run starts; the gate
  // then denies every write (fail closed). Before this decision the case expected invalid_task.
  await t.test("작업 공간 밖을 가리키는 정션 → 실행은 시작되고 모든 쓰기가 거부된다(fail closed)", async (st) => {
    const sb = createSandbox(st);
    writeRepairProject(sb);
    const outside = join(sb.base, "outside");
    mkdirSync(outside);
    try {
      symlinkSync(outside, join(sb.workspace, "out-link"), "junction");
    } catch (error) {
      st.skip(`junction could not be created: ${String(error)}`);
      return;
    }
    const before = treeBytes(sb.workspace, true);
    const writes = ["w-src", "c-new", "w-through-link"];
    const taskPath = writeTask(
      sb,
      {
        id: "t13-outside",
        protectedPaths: ["out-link"],
        verifiers: [{ id: "x", kind: "file_rules", rules: [{ type: "exists", path: PRICE_PATH }] }],
      },
      [
        editStep("w-src", EDIT_WRONG_FIX),
        replaceAllStep("c-new", "new.txt", null, "x\n"),
        replaceAllStep("w-through-link", "out-link/planted.txt", null, "x\n"),
        finalStep("끝"),
      ],
    );
    const run = await runTask(taskPath, { cwd: sb.base });
    const result = expectRunResult(run);
    const { records } = readRunFiles(sb.workspace, result);
    st.diagnostic(`outcome: ${result.status}/${result.reason}`);

    for (const id of writes) assertRefused(records, id, ["policy_denied"]);
    for (const id of ["w-src", "c-new"]) {
      const decision = deniedDecision(records, id);
      assert.equal(decision.code, "protected_path", id);
      assert.equal(decision.permission, "path", id);
    }
    assert.equal(result.changes.length, 0, "no change was applied");
    assert.equal(readFileSync(join(sb.workspace, "src", "price.js"), "utf8"), PRICE_BUG);
    assert.deepEqual(treeBytes(sb.workspace, true), before, "the workspace is byte for byte unchanged");
    assert.deepEqual(readdirSync(outside), [], "nothing was written through the link");
  });
});

test("T-14 키 검사: 이스케이프한 키의 중복 필드, 위치에 모르는 필드 이름 없음, 대체 데이터 스트림", { timeout: 60_000 }, async (t) => {
  const escapeAll = (value: string): string =>
    [...value].map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
  const keyShaped = ANTHROPIC_REFUSED_SHAPE;
  assert.ok(new RegExp(ANTHROPIC_KEY_REFUSAL_PATTERN_SOURCE).test(keyShaped), "test assumption: the value has the key shape");

  for (const [label, value] of [
    ["키 모양 값", keyShaped],
    ["현재 키 값", FAKE_API_KEY],
  ] as const) {
    await t.test(`이스케이프한 ${label}를 앞선 중복 goal에 둠 → key_in_file`, async (st) => {
      const sb = createSandbox(st);
      writeWorkspaceFile(sb, "README.md", "# 연습\n");
      const taskPath = writeTask(sb, { id: "t14-dup", verifiers: README_EXISTS }, [finalStep("끝")]);
      // JSON.parse keeps the later "goal", so the escaped key is gone after parsing.
      const text = readFileSync(taskPath, "utf8");
      writeFileSync(taskPath, `{"goal":"${escapeAll(value)}",${text.trimStart().slice(1)}`);
      const message = assertPreRun(await runTask(taskPath, { cwd: sb.base, env: cliEnv({ fakeApiKey: FAKE_API_KEY }) }), "key_in_file", sb);
      assert.equal(message.includes(value), false);
    });
  }

  await t.test("모르는 필드 아래의 키 필드: 위치에 그 필드 이름을 적지 않는다", async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "README.md", "# 연습\n");
    const taskPath = writeTask(sb, { id: "t14-location", verifiers: README_EXISTS }, [finalStep("끝")]);
    const config = writeConfigFile(sb, { schemaVersion: 1, cdyPrivateFieldName: { apiKey: "not-a-real-value" } });
    const message = assertPreRun(await runCli(sb, ["run", "--task", taskPath, "--config", config]), "key_in_file", sb);
    assert.equal(message.includes("cdyPrivateFieldName"), false, `location names an unknown field: ${message}`);
    assert.equal(message.includes("not-a-real-value"), false);
  });

  await t.test("작업 공간 루트의 대체 데이터 스트림에 둔 설정 → invalid_config", { skip: IS_WINDOWS ? false : "NTFS streams" }, async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "README.md", "# 연습\n");
    const taskPath = writeTask(sb, { id: "t14-ads", verifiers: README_EXISTS }, [finalStep("끝")]);
    const stream = `${sb.workspace}:cfg.json`;
    try {
      writeFileSync(stream, JSON.stringify({ schemaVersion: 1 }));
    } catch (error) {
      st.skip(`an alternate data stream could not be written: ${String(error)}`);
      return;
    }
    assertPreRun(await runCli(sb, ["run", "--task", taskPath, "--config", stream]), "invalid_config", sb);
  });
});

test(`${MOCK_LABEL} T-14 maxOutputTokens 절대 상한(task·설정), 상한 값은 허용`, { timeout: 60_000 }, async (t) => {
  for (const [label, where, value, code] of [
    ["task model.maxOutputTokens 초과", "task", MAX_OUTPUT_TOKENS_LIMIT + 1, "invalid_task"],
    ["설정 maxOutputTokens 초과", "config", MAX_OUTPUT_TOKENS_LIMIT + 1, "invalid_config"],
  ] as const) {
    await t.test(label, async (st) => {
      const sb = createSandbox(st);
      writeWorkspaceFile(sb, "README.md", "# 연습\n");
      const api = await startFakeAnthropic(st, [replyText("끝")]);
      const configPath = writeConfigFile(
        sb,
        fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG, ...(where === "config" ? { maxOutputTokens: value } : {}) }),
      );
      const taskPath = writeAnthropicTask(sb, {
        id: "t14-cap",
        verifiers: README_EXISTS,
        ...(where === "task" ? { maxOutputTokens: value } : {}),
      });
      const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }));
      assertPreRun(run, code, sb);
      assert.equal(api.requests.length, 0);
    });
  }
  await t.test("상한 값 그대로는 실행되고 그 값이 전송된다", async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "README.md", "# 연습\n");
    const api = await startFakeAnthropic(st, [replyText("끝")]);
    const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG }));
    const taskPath = writeAnthropicTask(sb, { id: "t14-cap-ok", verifiers: README_EXISTS, maxOutputTokens: MAX_OUTPUT_TOKENS_LIMIT });
    const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }));
    assert.equal(expectRunResult(run, "anthropic").status, "done");
    assert.deepEqual(sentMaxTokens(api), [MAX_OUTPUT_TOKENS_LIMIT]);
  });
});
