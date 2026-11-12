/**
 * createHumanOutput with N-B's real catalogs (src/i18n), to find what the strict stand-in in
 * output.test.ts hides: how the real words sit in the layout (colons, separators, codes in
 * parentheses), that every parameter is accepted (the real catalog shows "?" instead of throwing
 * for a value outside its kind), and that no record value reaches the text. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type {
  CliErrorOutput,
  EngineResult,
  HumanOutput,
  JournalEvent,
  MaskedText,
  MessageLanguage,
  RevertOutput,
  RunId,
  RunsOutput,
} from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { displayWidth, formatLocalTime } from "../../../../src/cli/human/format.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const SECRET = "fake-secret-N22-VALUE-0001";
const masked = (text: string): MaskedText => text as MaskedText;
const RUN = toRunId("20261112T030405Z-0a1b2c3d") as RunId;
const human = (language: MessageLanguage): HumanOutput => createHumanOutput(createMessageCatalog(language));

function result(extra: Partial<EngineResult> = {}): EngineResult {
  return {
    schemaVersion: 1,
    kind: "run",
    runId: RUN,
    taskId: `task-${SECRET}`.slice(0, 40),
    status: "done",
    reason: "verified",
    exitCode: 0,
    provider: "scripted",
    verifiers: [
      { id: `id-${SECRET}`, kind: "file_rules", outcome: "pass", evidence: masked(SECRET), checked: [], limits: [] },
      { id: "second", kind: "command", outcome: "pass", evidence: masked(""), checked: [], limits: [] },
    ],
    changes: [
      { path: masked("README.md"), previousHash: "a".repeat(64), newHash: "b".repeat(64), created: false },
      { path: masked("docs/new.md"), previousHash: null, newHash: "c".repeat(64), created: true },
    ],
    usage: { modelTurns: 4, toolCalls: 2, inputTokens: null, outputTokens: null, durationMs: 78 },
    journalPath: ".codaryn/runs/x/journal.jsonl",
    notices: [masked(`notice ${SECRET}`)],
    ...extra,
  };
}

function revert(extra: Partial<RevertOutput> = {}): RevertOutput {
  return {
    schemaVersion: 1,
    kind: "revert",
    runId: RUN,
    status: "partial",
    exitCode: 3,
    reverted: [{ path: "README.md", action: "restored" }],
    skipped: [
      { path: "notes.txt", reason: "changed_since_run" },
      { path: `raw-${SECRET}.txt`, reason: "missing_record" },
    ],
    ...extra,
  };
}

const EVENTS: JournalEvent[] = [
  { type: "run_started", schemaVersion: 1, taskId: "t", workflow: masked(SECRET), provider: "scripted", limits: { maxModelTurns: 1, maxToolCalls: 1, maxTotalTokens: null, maxDurationMs: 1 } },
  { type: "model_request", turn: 2, system: null, newMessages: [] },
  { type: "model_error", turn: 2, kind: "rate_limited", message: masked(SECRET) },
  { type: "tool_decision", callId: "c", tool: "read_file", stage: "policy_effective", allowed: true, permission: null, code: null },
  { type: "tool_decision", callId: "c", tool: "run_command", stage: "policy_effective", allowed: false, permission: "command", code: "command_not_allowed" },
  { type: "file_changed", callId: "c", path: masked("notes.txt"), previousHash: null, newHash: "c".repeat(64), created: true },
  { type: "verifier_result", result: { id: `v-${SECRET}`, kind: "command", outcome: "fail", evidence: masked(SECRET), checked: [], limits: [] } },
  { type: "repair_started", attempt: 1, failedVerifiers: [`v-${SECRET}`], feedbackTruncated: false },
  { type: "integrity_checked", phase: "before_verify", changed: [] },
  { type: "integrity_checked", phase: "after_verify", changed: [masked("a"), masked("b")] },
  { type: "run_finished", status: "failed", reason: "verifier_failed", usage: { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 1 } },
];

const STARTED = "2026-11-12T03:04:05.000Z";
const RUNS: RunsOutput = {
  schemaVersion: 1,
  kind: "runs",
  status: "listed",
  exitCode: 0,
  runs: [
    { state: "checked", runId: RUN, startedAt: STARTED, taskId: `t-${SECRET}`.slice(0, 40), status: "done", reason: "verified", changes: 2, reverted: { at: STARTED, status: "complete" } },
    { state: "checked", runId: toRunId("20261112T030400Z-00000000") as RunId, startedAt: STARTED, taskId: "t", status: null, reason: null, changes: null, reverted: null },
    { state: "damaged", runId: toRunId("20261112T030300Z-ffffffff") as RunId },
  ],
  omitted: 4,
};

const ERROR: CliErrorOutput = {
  schemaVersion: 1,
  kind: "error",
  code: "invalid_config",
  exitCode: 2,
  message: `english detail ${SECRET}`,
  diagnostic: { code: "json_syntax", file: "config", field: null, line: 3, column: 14 },
};

/** Everything the renderer can print, in one language. */
function renderAll(language: MessageLanguage): string {
  const out = human(language);
  return [
    out.error(ERROR),
    out.runSummary(result(), { workspaceForm: "given", configDefault: "%APPDATA%\\Codaryn\\config.json", profileApplied: true, deniedToolCalls: 2 }),
    ...EVENTS.map((event) => `${out.progressLine(event) ?? ""}\n`),
    out.revertSummary(revert({ skipped: [{ path: "notes.txt", reason: "changed_since_run" }] })),
    out.revertSummary(revert({ dryRun: true, status: "complete", exitCode: 0, skipped: [], revertedBefore: { at: STARTED, status: "complete" } })),
    out.runsText(RUNS),
  ].join("");
}

describe("createHumanOutput with the real catalogs (N-B)", () => {
  for (const language of MESSAGE_LANGUAGES) {
    test(`${language}: every parameter is accepted, so no "?" stands in for a value`, () => {
      const text = renderAll(language);
      assert.equal(/(^|[\s(—:])\?([\s)—:,]|$)/m.test(text), false, text);
    });

    test(`${language}: no record value other than masked paths reaches the text`, () => {
      const text = renderAll(language) + human(language).revertSummary(revert());
      assert.equal(text.includes(SECRET), false);
      assert.equal(text.includes("english detail"), false);
    });

    test(`${language}: a renderer used for a long run keeps accepting its own text`, () => {
      const out = human(language);
      for (let turn = 1; turn <= 2000; turn += 1) out.progressLine({ type: "model_request", turn, system: null, newMessages: [] });
      const finished = out.progressLine(EVENTS[EVENTS.length - 1] as JournalEvent) ?? "";
      assert.equal(finished.includes("?"), false, finished);
      const summary = out.runSummary(result(), { workspaceForm: "current", configDefault: null, profileApplied: false, deniedToolCalls: 0 });
      assert.equal(/(^|[\s(—:])\?([\s)—:,]|$)/m.test(summary), false, summary);
    });
  }

  test("ko: an error puts the diagnostic after the file with a dash, not a second colon", () => {
    assert.equal(
      human("ko").error(ERROR),
      [
        "codaryn: 오류 — 설정 파일을 읽을 수 없거나 값이 올바르지 않습니다 (invalid_config)",
        "  설정 파일 — JSON 문법 오류: 3줄 14열",
        "  고치는 법: 설정 파일에서 알려 준 필드를 고치세요. 설정 파일이 없으면 codaryn init으로 만들 수 있습니다.",
        "  점검: codaryn doctor",
        "",
      ].join("\n"),
    );
  });

  for (const language of MESSAGE_LANGUAGES) {
    test(`${language}: codaryn doctor is named once per error, by the fix text or by the hint`, () => {
      const out = human(language);
      for (const code of ["invalid_config", "invalid_task", "key_in_file", "secret_env_missing", "workspace_is_install_dir", "provider_not_configured", "model_list_failed"] as const) {
        const lines = out.error({ ...ERROR, code, diagnostic: undefined }).split("\n");
        const naming = lines.filter((line) => line.includes("codaryn doctor"));
        assert.equal(naming.length, 1, `${language} ${code}:\n${lines.join("\n")}`);
      }
      const hint = createMessageCatalog(language).format("error.doctor_hint");
      assert.equal(out.error({ ...ERROR, code: "run_not_found", diagnostic: undefined }).includes(hint), false);
    });
  }

  test("ko: the run summary gives each labelled fact its own line, paths under the change count", () => {
    const text = human("ko").runSummary(result(), { workspaceForm: "given", configDefault: null, profileApplied: false, deniedToolCalls: 2 });
    assert.equal(
      text,
      [
        "── 결과: 완료 — 지정한 검증 모두 통과 (done/verified) ──",
        "검증: 2개 중 2개 통과(지정한 검증 범위에서)",
        "바뀐 파일: 2개",
        "  README.md (파일 바꿈)",
        "  docs/new.md (파일 만듦)",
        "거부된 호출: 2건",
        "명령을 허용하려면 설정의 policy.commands에 규칙을 더하세요. 인자까지 고정하길 권합니다.",
        "사용: 모델 4턴 · 도구 호출 2회 · 78 ms",
        "보고서를 확인하고, 필요하면 되돌리세요.",
        `실행 id: ${RUN}`,
        `보고서: codaryn report --workspace <workspace> --run ${RUN}`,
        `되돌리기: codaryn revert --workspace <workspace> --run ${RUN}`,
        "",
      ].join("\n"),
    );
  });

  test("ko: progress lines read as words with one code in parentheses", () => {
    const out = human("ko");
    assert.deepEqual(
      EVENTS.map((event) => out.progressLine(event)),
      [
        "실행 시작 — 모델 제공자 scripted",
        "2턴",
        "2턴 — 모델 호출 오류 (rate_limited)",
        "파일 읽기 — 허용 (read_file)",
        "명령 실행 — 거부 (command/command_not_allowed)",
        "파일 만듦 notes.txt",
        "검증 1번 — 미통과 (fail)",
        "재수정 1회차 — 검증 1개 미통과",
        "보호 대상 확인 — 바뀌지 않음 (before_verify)",
        "보호 대상 확인 — 2개가 바뀌었거나 확인할 수 없음 (after_verify)",
        "끝 — 실패 (verifier_failed)",
      ],
    );
  });

  test("ko: a revert lists restored files under their title and skipped files under theirs; the code stays before the colon", () => {
    assert.equal(
      human("ko").revertSummary(revert()),
      [
        "codaryn: 되돌린 파일 1개 (partial):",
        "  README.md — 실행 전 내용으로 되돌림",
        "건너뛰는 파일 2개:",
        "  notes.txt — 실행 뒤에 다시 바뀜 (changed_since_run)",
        "  ? — 기록 없음 (missing_record)",
        "",
      ].join("\n"),
    );
    const time = formatLocalTime(Date.parse(STARTED));
    assert.equal(
      human("ko").revertSummary(revert({ dryRun: true, status: "complete", exitCode: 0, skipped: [], revertedBefore: { at: STARTED, status: "complete" } })),
      [
        "codaryn: 되돌릴 파일 1개(미리보기, 아무것도 바꾸지 않음) (complete):",
        "  README.md — 실행 전 내용으로 되돌림",
        `이 실행은 이미 되돌린 적이 있습니다. 그래서 파일이 실행 뒤에 바뀐 것으로 보일 수 있습니다. (complete, ${time})`,
        "실행하려면 --dry-run 없이 다시 실행하세요.",
        "",
      ].join("\n"),
    );
  });

  test("en: titles without a colon keep the code at the end", () => {
    assert.equal(
      human("en").revertSummary(revert()),
      [
        "codaryn: Files reverted: 1 (partial)",
        "  README.md — restored to the content from before the run",
        "Files skipped: 2",
        "  notes.txt — changed again after the run (changed_since_run)",
        "  ? — record missing (missing_record)",
        "",
      ].join("\n"),
    );
  });

  for (const language of MESSAGE_LANGUAGES) {
    test(`${language}: the run table lines up in display columns with the real headers`, () => {
      const rows = human(language).runsText(RUNS).trimEnd().split("\n");
      assert.equal(rows.length, 5);
      const done = createMessageCatalog(language).format("status.done");
      const incomplete = createMessageCatalog(language).format("runs.incomplete");
      const damaged = createMessageCatalog(language).format("runs.damaged");
      const status = createMessageCatalog(language).format("runs.column.status");
      const cells = [status, `${done} (done/verified)`, incomplete, damaged];
      const starts = rows.slice(0, 4).map((row, index) => displayWidth(row.slice(0, row.indexOf(cells[index] as string))));
      assert.equal(new Set(starts).size, 1, `${language} aligned: ${starts.join(",")}\n${rows.join("\n")}`);
    });
  }
});
