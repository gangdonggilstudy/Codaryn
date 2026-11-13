/**
 * U-295 (before the CLI migration's step C-6a, docs/reviews/2026-11-13-cli-migration-plan.md 4 and 6.1
 * to 6.4): what a run prints and records today where C-6a moves its life into the app layer and no
 * integration case held the expected values (the board comparison holds two boards equal, U-289; U-291
 * pins the end summary's counts). Real CLI processes, the scripted model or the local fake API, every
 * command behind the network guard, English and Korean. The texts are main 82e8285b's, as they are.
 * 1. A permission question with no terminal to ask at: denied by default, recorded so, told so.
 * 2. A cancel file there before the run: stopped before the first turn; what is recorded and said.
 * 3. A cancel during a run: the change made stays, and the summary says revert undoes it.
 * 4. Y-4: a 404 from the API adds its line after the last progress line, before the end summary.
 * 5. N-1: the default config location's line comes right after "run started", and in the summary.
 * 6. The config's language (ko) for a refusal of a held lock and for a script file that is not JSON.
 * One case is a todo: a cancelled run whose task has a check says "Checks: none configured".
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { RUNS_DIR_NAME, STATE_DIR_NAME } from "../../src/contracts/index.js";
import type { JournalRecord, ScriptStep, VerifierConfig } from "../../src/contracts/index.js";
import { fakeApiConfig, writeConfigFile } from "../fixtures/anthropic.js";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { FAKE_API_KEY } from "../fixtures/secrets.js";
import { NODE, cliEnv, describeRun, expectCliError, expectRunResult, lockPath, readLiveRecords, readRunFiles, startCli, waitFor } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { MOCK_LABEL, replyError, replyText, replyTools, runGuarded, startFakeAnthropic, toolUse } from "../support/fake-anthropic.js";

type Lang = "en" | "ko";
const LANGS: readonly Lang[] = ["en", "ko"];
const README_CHECK: VerifierConfig = { id: "readme", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] };
const QUICK_LIMITS = { maxModelTurns: 6, maxToolCalls: 6, maxTotalTokens: 200_000, maxDurationMs: 60_000 };

/** The progress lines: every stderr line before the end summary's first ("── "). */
function progressOf(run: CliRun): string[] {
  const lines = run.stderr.split(/\r?\n/).filter((line) => line !== "");
  const end = lines.findIndex((line) => line.startsWith("── "));
  return end < 0 ? lines : lines.slice(0, end);
}

/** The end summary's lines, from its first ("── "). */
function summaryOf(run: CliRun): string[] {
  const lines = run.stderr.split(/\r?\n/).filter((line) => line !== "");
  const start = lines.findIndex((line) => line.startsWith("── "));
  assert.ok(start >= 0, `no end summary on stderr. ${describeRun(run)}`);
  return lines.slice(start);
}

/** `expected` stands in `lines` as consecutive lines (the first where its first one is). */
function assertConsecutive(lines: readonly string[], expected: readonly string[], what: string): void {
  const at = lines.indexOf(expected[0] ?? "");
  assert.ok(at >= 0, `${what}: ${JSON.stringify(expected[0])} not in ${JSON.stringify(lines)}`);
  assert.deepEqual(lines.slice(at, at + expected.length), expected, what);
}

function typesOf(records: readonly JournalRecord[]): string[] {
  return records.map((record) => record.type);
}

const guarded = (sb: Sandbox, args: readonly string[], env: NodeJS.ProcessEnv): Promise<CliRun> => runGuarded(sb, args, env, 120_000);

// ---------------------------------------------------------------------------------------------
// 1. A permission question with no terminal

/** A command the config's rule allows only after a person's yes; it would leave a file if it ran. */
const askedCall = (word: string) => toolUse(`toolu_${word}`, "run_command", { executable: NODE, args: ["-e", `require('fs').writeFileSync('ran-${word}.txt', '')`] });

const PERMISSION_TEXT: Record<Lang, { readonly progress: readonly string[]; readonly summary: readonly string[] }> = {
  en: {
    progress: [
      "codaryn: run started — provider anthropic",
      "codaryn: turn 1",
      "codaryn: permission question — denied by default (no answer, could not ask, or time ran out)",
      "codaryn: run command — denied (command/confirmation_required)",
      "codaryn: turn 2",
      "codaryn: permission question — denied by default (no answer, could not ask, or time ran out)",
      "codaryn: run command — denied (command/confirmation_required)",
      "codaryn: turn 3",
      "codaryn: finished — needs input (no_verifier)",
    ],
    summary: [
      "── Result: needs input — no check is configured (needs-input/no_verifier) ──",
      "Checks: none configured",
      "Files changed: 0",
      "Denied calls: 2",
      "Denied without asking: 2 call(s) whose rule asks first (not at a terminal, or --quiet).",
    ],
  },
  ko: {
    progress: [
      "codaryn: 실행 시작 — 모델 제공자 anthropic",
      "codaryn: 1턴",
      "codaryn: 권한 확인 — 기본값으로 거부함(답이 없었거나, 물을 수 없었거나, 시간 한도에 닿음)",
      "codaryn: 명령 실행 — 거부 (command/confirmation_required)",
      "codaryn: 2턴",
      "codaryn: 권한 확인 — 기본값으로 거부함(답이 없었거나, 물을 수 없었거나, 시간 한도에 닿음)",
      "codaryn: 명령 실행 — 거부 (command/confirmation_required)",
      "codaryn: 3턴",
      "codaryn: 끝 — 확인 필요 (no_verifier)",
    ],
    summary: [
      "── 결과: 확인 필요 — 검증 없음 (needs-input/no_verifier) ──",
      "검증: 지정한 검증 없음",
      "바뀐 파일: 0개",
      "거부된 호출: 2건",
      "확인을 받게 된 명령의 호출 2건을 묻지 않고 거부했습니다(터미널이 아니거나 --quiet 옵션을 줌).",
    ],
  },
};

for (const lang of LANGS) {
  test(`${MOCK_LABEL} U-295 터미널 없는 권한 질문(${lang}): 기본 거부로 기록하고, 명령은 돌지 않으며, 진행 줄과 끝 요약이 그렇다고 한다`, { timeout: 120_000 }, async (t) => {
    const sb = createSandbox(t);
    const api = await startFakeAnthropic(t, [replyTools([askedCall("one")]), replyTools([askedCall("two")]), replyText("Both checks are asked.")]);
    writeWorkspaceFile(sb, "notes.md", "# Weekly notes\n");
    const config = writeConfigFile(
      sb,
      fakeApiConfig(api.url, {
        model: "fake-model",
        maxRetries: 0,
        limits: QUICK_LIMITS,
        policy: { commands: [{ executable: NODE, argsPrefix: ["-e"], allowExtraArgs: true, confirm: true }], network: "deny", destructive: "deny", restorePathTokens: false },
      }),
    );
    const run = await guarded(sb, ["run", "--config", config, "--workspace", sb.workspace, "--goal", "Run the two checks."], cliEnv({ fakeApiKey: FAKE_API_KEY, extra: { CODARYN_LANG: lang } }));
    const result = expectRunResult(run, "anthropic");
    assert.deepEqual([result.status, result.reason, run.exitCode, result.usage.toolCalls], ["needs-input", "no_verifier", 3, 0]);
    assert.deepEqual(progressOf(run), PERMISSION_TEXT[lang].progress);
    assertConsecutive(summaryOf(run), PERMISSION_TEXT[lang].summary, "the end summary's counts");
    assert.deepEqual(["ran-one.txt", "ran-two.txt"].filter((name) => existsSync(join(sb.workspace, name))), [], "no asked command ran");

    const asked = readRunFiles(sb.workspace, result).records.filter((record) =>
      ["confirmation_requested", "confirmation_answered", "tool_decision", "tool_result"].includes(record.type),
    );
    const expected = ["one", "two"].flatMap((word, index) => [
      { type: "confirmation_requested", kind: "permission", id: `q${index + 1}`, callId: `toolu_${word}`, tool: "run_command", permission: "command" },
      { type: "confirmation_answered", id: `q${index + 1}`, decision: "deny", by: "default" },
      { type: "tool_decision", callId: `toolu_${word}`, stage: "policy_effective", allowed: false, permission: "command", code: "confirmation_required" },
      { type: "tool_result", callId: `toolu_${word}`, ok: false, errorCode: "policy_denied" },
    ]);
    assert.deepEqual(
      asked.map((record) => {
        if (record.type === "confirmation_requested") return { type: record.type, kind: record.kind, id: record.id, callId: record.callId, tool: record.tool, permission: record.permission };
        if (record.type === "confirmation_answered") return { type: record.type, id: record.id, decision: record.decision, by: record.by };
        if (record.type === "tool_decision") return { type: record.type, callId: record.callId, stage: record.stage, allowed: record.allowed, permission: record.permission, code: record.code };
        if (record.type === "tool_result") return { type: record.type, callId: record.result.callId, ok: record.result.ok, errorCode: record.result.errorCode };
        return { type: record.type };
      }),
      expected,
    );
  });
}

// ---------------------------------------------------------------------------------------------
// 2 and 3. Cancelling

/** A task with a check whose script writes made.txt, then waits a minute for its second turn. */
function cancelTask(sb: Sandbox, id: string): string {
  writeWorkspaceFile(sb, "README.md", "# a\n");
  const steps: ScriptStep[] = [
    { toolCalls: [{ id: "w1", name: "write_file", args: { path: "made.txt", expectedHash: null, change: { kind: "replace_all", content: "x\n" } } }] },
    { delayMs: 60_000, text: "never" },
  ];
  return writeTask(sb, { id, verifiers: [README_CHECK] }, steps);
}

function runCancelled(sb: Sandbox, task: string, lang: Lang) {
  return startCli(["run", "--task", task, "--cancel-file", sb.cancelFile], { cwd: sb.base, env: cliEnv({ extra: { CODARYN_LANG: lang } }), timeoutMs: 120_000, netGuardLog: join(sb.base, "net-guard.log") });
}

test("U-295 시작 전부터 있는 취소 파일: 첫 턴 전에 멈추고, 기록 넷, 아무것도 바꾸지 않으며, 끝 요약이 그렇다고 한다", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  const task = cancelTask(sb, "u295-cancel-before");
  writeFileSync(sb.cancelFile, "cancel");
  const run = await runCancelled(sb, task, "en").done;
  const result = expectRunResult(run);
  assert.deepEqual([result.status, result.reason, run.exitCode, result.usage.modelTurns, result.changes.length], ["cancelled", "cancelled", 5, 0, 0]);
  const records = readRunFiles(sb.workspace, result).records;
  assert.deepEqual(typesOf(records), ["run_started", "state_checked", "state_checked", "run_finished"]);
  assert.deepEqual(records.flatMap((record) => (record.type === "state_checked" ? [record.phase] : [])), ["run_start", "run_end"]);
  assert.equal(existsSync(join(sb.workspace, "made.txt")), false);
  assert.equal(existsSync(lockPath(sb.workspace)), false, "the lock is released");
  assert.deepEqual(progressOf(run), ["codaryn: run started — provider scripted", "codaryn: finished — cancelled (cancelled)"]);
  const summary = summaryOf(run);
  assert.equal(summary[0], "── Result: cancelled — cancellation was requested (cancelled/cancelled) ──");
  assert.ok(summary.includes("Files changed: 0"));
  assert.ok(summary.includes("Changes already made are kept. codaryn revert undoes them."));
  assert.ok(!summary.some((line) => line.startsWith("Revert:")), "nothing changed, so no revert command");

  await t.test("todo: 검증을 둔 task의 취소된 실행이 \"Checks: none configured\"라고 한다", { todo: "U-295 finding for nc-human: the summary says no check is configured when the checks did not run (output.ts: result.verifiers is empty)" }, () => {
    assert.ok(!summary.includes("Checks: none configured"), JSON.stringify(summary));
  });
});

const CANCEL_TEXT: Record<Lang, { readonly progress: readonly string[]; readonly advice: string; readonly revert: string }> = {
  en: {
    progress: ["codaryn: run started — provider scripted", "codaryn: turn 1", "codaryn: write file — allowed (write_file)", "codaryn: created made.txt", "codaryn: turn 2", "codaryn: finished — cancelled (cancelled)"],
    advice: "Changes already made are kept. codaryn revert undoes them.",
    revert: "Revert: codaryn revert --workspace <workspace> --run ",
  },
  ko: {
    progress: ["codaryn: 실행 시작 — 모델 제공자 scripted", "codaryn: 1턴", "codaryn: 파일 쓰기 — 허용 (write_file)", "codaryn: 파일 만듦 made.txt", "codaryn: 2턴", "codaryn: 끝 — 취소됨 (cancelled)"],
    advice: "이미 한 변경은 남아 있습니다. codaryn revert로 되돌릴 수 있습니다.",
    revert: "되돌리기: codaryn revert --workspace <workspace> --run ",
  },
};

for (const lang of LANGS) {
  test(`U-295 실행 중 취소(${lang}): 한 변경은 남고, 끝 요약이 되돌리기를 안내하며, 기록은 기다리던 턴의 답 없이 끝난다`, { timeout: 120_000 }, async (t) => {
    const sb = createSandbox(t);
    const started = runCancelled(sb, cancelTask(sb, `u295-cancel-during-${lang}`), lang);
    await waitFor(() => readLiveRecords(sb.workspace).some((record) => record.type === "file_changed"), 30_000, "file_changed in the journal");
    writeFileSync(sb.cancelFile, "cancel");
    const run = await started.done;
    const result = expectRunResult(run);
    assert.deepEqual([result.status, result.reason, run.exitCode, result.changes.map((change) => change.path)], ["cancelled", "cancelled", 5, ["made.txt"]]);
    const records = readRunFiles(sb.workspace, result).records;
    assert.deepEqual(typesOf(records).slice(-4), ["file_changed", "model_request", "state_checked", "run_finished"], "the second turn was asked and never answered");
    assert.equal(existsSync(lockPath(sb.workspace)), false, "the lock is released");
    assert.deepEqual(progressOf(run), CANCEL_TEXT[lang].progress);
    assertConsecutive(summaryOf(run), [CANCEL_TEXT[lang].advice], "the advice after a cancel");
    const summary = summaryOf(run);
    assert.equal(summary.at(-1), `${CANCEL_TEXT[lang].revert}${result.runId}`, "the revert command closes the summary");
  });
}

// ---------------------------------------------------------------------------------------------
// 4. Y-4 and 5. N-1

const NOT_FOUND_TEXT: Record<Lang, readonly string[]> = {
  en: [
    "codaryn: run started — provider anthropic",
    "codaryn: turn 1",
    "codaryn: turn 1 — model request failed (api_error)",
    "codaryn: finished — failed (model_error)",
    "codaryn: The model was not found (HTTP 404). codaryn models lists the models the key can use.",
  ],
  ko: [
    "codaryn: 실행 시작 — 모델 제공자 anthropic",
    "codaryn: 1턴",
    "codaryn: 1턴 — 모델 호출 오류 (api_error)",
    "codaryn: 끝 — 실패 (model_error)",
    "codaryn: 모델을 찾지 못했습니다(HTTP 404). codaryn models로 키가 쓸 수 있는 모델을 보세요.",
  ],
};

for (const lang of LANGS) {
  test(`${MOCK_LABEL} U-295 Y-4(${lang}): 404의 안내 줄은 마지막 진행 줄 뒤, 끝 요약 앞에 그 언어로 나온다`, { timeout: 120_000 }, async (t) => {
    const sb = createSandbox(t);
    const api = await startFakeAnthropic(t, [replyError(404, "not_found_error")]);
    writeWorkspaceFile(sb, "README.md", "# a\n");
    const config = writeConfigFile(sb, fakeApiConfig(api.url, { model: "cdy-fake-model-retired", maxRetries: 0, limits: QUICK_LIMITS }));
    const run = await guarded(sb, ["run", "--config", config, "--workspace", sb.workspace, "--goal", "Say hello."], cliEnv({ fakeApiKey: FAKE_API_KEY, extra: { CODARYN_LANG: lang } }));
    const result = expectRunResult(run, "anthropic");
    assert.deepEqual([result.status, result.reason, run.exitCode], ["failed", "model_error", 1]);
    assert.deepEqual(progressOf(run), NOT_FOUND_TEXT[lang]);
    assert.ok(result.notices.some((notice) => notice.includes("codaryn models")), "the result's notice (English) is as before");
  });
}

const DEFAULT_TEXT: Record<Lang, { readonly line: string; readonly summary: string }> = {
  en: { line: "codaryn: using the config file in the default location: %APPDATA%\\Codaryn\\config.json", summary: "Used the config file in the default location: %APPDATA%\\Codaryn\\config.json" },
  ko: { line: "codaryn: 기본 위치의 설정 파일을 씁니다: %APPDATA%\\Codaryn\\config.json", summary: "기본 위치의 설정 파일을 썼습니다: %APPDATA%\\Codaryn\\config.json" },
};

for (const lang of LANGS) {
  test(`U-295 N-1 기본 설정 위치(${lang}): 줄은 \"run started\" 바로 뒤에, 끝 요약에는 사용 줄 바로 뒤에 나온다`, { timeout: 120_000, skip: process.platform === "win32" ? false : "the default location's display is %APPDATA% on Windows" }, async (t) => {
    const sb = createSandbox(t);
    const appData = join(sb.base, "appdata");
    mkdirSync(join(appData, "Codaryn"), { recursive: true });
    writeFileSync(join(appData, "Codaryn", "config.json"), JSON.stringify({ schemaVersion: 1 }));
    writeWorkspaceFile(sb, "README.md", "# a\n");
    const task = writeTask(sb, { id: `u295-default-${lang}`, verifiers: [README_CHECK] }, [{ text: "done" }]);
    const run = await guarded(sb, ["run", "--task", task], cliEnv({ extra: { APPDATA: appData, CODARYN_LANG: lang } }));
    const result = expectRunResult(run);
    assert.deepEqual([result.status, result.reason, run.exitCode], ["done", "verified", 0]);
    const progress = progressOf(run);
    assert.equal(progress[1], DEFAULT_TEXT[lang].line, JSON.stringify(progress));
    assert.equal(progress.filter((line) => line === DEFAULT_TEXT[lang].line).length, 1);
    const summary = summaryOf(run);
    const at = summary.indexOf(DEFAULT_TEXT[lang].summary);
    assert.ok(at > 0 && /^(Usage|사용): /.test(summary[at - 1] ?? ""), JSON.stringify(summary));
  });
}

// ---------------------------------------------------------------------------------------------
// 6. The config's language for refusals

const KO_CONFIG = { schemaVersion: 1, language: "ko" };

test("U-295 설정의 언어(ko)로 하는 거부: 잠금이 잡힌 작업 공간, JSON이 아닌 대본 파일", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# a\n");
  const task = writeTask(sb, { id: "u295-ko-refusals", verifiers: [README_CHECK] }, [{ delayMs: 60_000, text: "never" }]);
  const koConfig = writeConfigFile(sb, KO_CONFIG, "ko-config.json");
  // The config chooses the language: CODARYN_LANG is empty.
  const env = cliEnv({ extra: { CODARYN_LANG: "" } });

  await t.test("workspace_locked: 종료 6, 한국어 사람 오류, 새 실행 없음", async () => {
    const holder = startCli(["run", "--task", task, "--cancel-file", sb.cancelFile], { cwd: sb.base, env: cliEnv(), timeoutMs: 120_000 });
    try {
      await waitFor(() => existsSync(lockPath(sb.workspace)), 30_000, "the holder's lock");
      const run = await guarded(sb, ["run", "--task", task, "--config", koConfig], env);
      expectCliError(run, "workspace_locked");
      assert.equal(run.exitCode, 6);
      assert.deepEqual(run.stderr.split(/\r?\n/).filter((line) => line !== ""), [
        "codaryn: 오류 — 다른 실행이 이 작업 공간을 쓰고 있습니다 (workspace_locked)",
        "  고치는 법: 다른 실행이 끝난 뒤 다시 실행하세요.",
        "  이 작업 공간에서 실행 중인 Codaryn이 없으면 .codaryn/lock.json과, 있다면 .codaryn/lock.json.reclaim을 지우세요.",
      ]);
      assert.equal(readdirSync(join(sb.workspace, STATE_DIR_NAME, RUNS_DIR_NAME)).length, 1, "only the holder's run");
    } finally {
      writeFileSync(sb.cancelFile, "cancel");
      assert.equal(expectRunResult(await holder.done).status, "cancelled");
    }
  });

  await t.test("invalid_script(JSON 문법): 종료 2, 한국어 사람 오류와 위치", async () => {
    writeFileSync(sb.scriptPath, "{ not json");
    const runsBefore = readdirSync(join(sb.workspace, STATE_DIR_NAME, RUNS_DIR_NAME)).length;
    const run = await guarded(sb, ["run", "--task", task, "--config", koConfig], env);
    expectCliError(run, "invalid_script");
    assert.equal(run.exitCode, 2);
    assert.deepEqual(run.stderr.split(/\r?\n/).filter((line) => line !== ""), [
      "codaryn: 오류 — 대본 파일을 읽을 수 없거나 형식이 올바르지 않습니다 (invalid_script)",
      "  대본 파일 — JSON 문법 오류: 1줄 3열",
      "  고치는 법: docs/cli-contract.md 4절의 대본 형식을 확인하세요.",
    ]);
    assert.equal(readdirSync(join(sb.workspace, STATE_DIR_NAME, RUNS_DIR_NAME)).length, runsBefore, "no run starts");
  });
});
