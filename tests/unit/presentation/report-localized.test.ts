import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunId, RunReportOutput } from "../../../src/contracts/index.js";
import { MAX_FINAL_MESSAGE_CHARS, PLAN_APPLY_STATES } from "../../../src/contracts/index.js";
import { FINAL_MESSAGE_MAX_LINES } from "../../../src/app/model-text.js";
import { renderReport, renderApplyReport, REPORT_FIXED_LIMITS, APPLY_REPORT_FIXED_LIMITS } from "../../../src/presentation/report.js";
import { renderLocalizedReport as run, renderLocalizedApplyReport as apply } from "../../../src/presentation/report-localized.js";
import type { ReportPlanApply } from "../../../src/presentation/report.js";
import { reportWords } from "../../../src/presentation/report-words.js";
import { applyFixture, completedApply, engineResult, masked, runFixture } from "./report-localized-support.js";
const APPLY_ID = "20261115T000000Z-0123abcd" as RunId;

const RUN_LIMITS = [
  "통과는 지정한 검증기가 통과했다는 뜻입니다. 변경 내용을 검토했다는 뜻은 아닙니다.",
  "변경 목록은 파일 도구가 쓴 것만 담습니다. 권한 규칙이 허용한 명령이 다른 파일을 바꿨을 수 있습니다.",
  "OS 격리가 없습니다. 허용한 명령은 사용자의 권한으로 실행됐으며 네트워크에 접근할 수 있었습니다.",
  "이 보고서는 실행 자체의 기록을 읽습니다. 실행 중 허용한 명령이 그 기록을 바꿨을 수 있습니다.",
  "가림은 이 실행에 등록한 값과 가림 기능이 찾는 변형만 가립니다. 등록하지 않은 비밀값, 그 밖의 변형, 다른 인코딩(예: UTF-16)의 글은 가리지 않습니다.",
];
const APPLY_LIMITS = [
  "통과는 파일 목록 확인과 지정한 검증기가 통과했다는 뜻입니다. 계획을 검토했다는 뜻은 아닙니다.",
  "OS 격리가 없습니다. 명령 검증기는 사용자의 권한으로 실행됐으며 네트워크에 접근할 수 있었습니다.",
  "이 보고서는 적용 실행 자체의 기록을 읽습니다. 다른 실행에서 허용한 명령이 그 기록을 바꿨을 수 있습니다.",
];

test("Korean run golden: complete text, original codes and five precise limitations", () => {
  assert.equal(run("ko", runFixture()), [
    "# Codaryn 실행 보고서", "", "- 실행: `r`", "- 작업: `task` (작업 종류 `coding`)", "- 제공자: `scripted` (대본 모델, API 호출 없음)",
    "- 결과: 없음. 실행의 result.json이 없습니다. 아직 실행 중이거나 결과를 쓰지 않고 멈췄습니다.", "- 실행 기록에 끝 기록이 없습니다.",
    "- 보고서: 불완전 (incomplete) (실행 기록 1건)", "", "## 검증", "", "마지막 검증 회차의 검증기 결과가 기록되지 않았습니다.",
    "", "## 보호 대상", "", "확인하지 않음: 실행에 무결성 확인이 없었습니다(보호 대상이 없었거나 확인 없이 실행됨).",
    "", "## 변경 (0개)", "", "파일 도구가 쓴 기록이 없습니다.", "", "## 사용량", "", "- 기록된 모델 요청: 0 (한도 2)", "- 거부된 도구 호출: 0", "- 재수정: 0",
    "", "## 확인하지 않은 범위", "", ...RUN_LIMITS.map(s => "- " + s), "",
  ].join("\n"));
});

test("Korean apply golden: no model, original approval and three precise limitations", () => {
  assert.equal(apply("ko", applyFixture()), [
    "# Codaryn 적용 실행 보고서", "", "- 실행: `a` (적용 실행, 모델이 참여하지 않음)", "- 계획 실행: `p`, 다이제스트 `abc`", "- 작업: `task`",
    "- 승인 경로: `cli-flag`; 덮어쓸 위험이 있는 이동에 대한 동의: 없음",
    "- 결과: 없음. 적용 실행의 result.json이 없습니다. 아직 실행 중이거나 결과를 쓰지 않고 멈췄습니다.", "- 실행 기록에 끝 기록이 없습니다.",
    "- 보고서: 불완전 (incomplete) (실행 기록 1건)", "", "## 사전 확인", "", "사전 확인 기록이 없습니다. 확인하거나 옮긴 것이 없습니다.",
    "", "## 동작 (0개 중 0개 완료)", "", "적용된 동작이 없습니다.", "", "## 검증", "", "마지막 검증 회차의 검증기 결과가 기록되지 않았습니다.",
    "", "## 보호 대상", "", "확인하지 않음: 적용 실행에 무결성 확인이 없었습니다(보호 대상이 없었거나 확인 없이 실행됨).",
    "", "## 사용량", "", "- 시간 한도: 10 ms", "", "## 되돌리기", "", "`codaryn revert --workspace <workspace> --run a`로 이 적용을 되돌리세요.",
    "", "## 확인하지 않은 범위", "", ...APPLY_LIMITS.map(s => "- " + s), "",
  ].join("\n"));
});

test("English matches the public renderer for incomplete/finished results and twelve plan paths", () => {
  for (const result of [null, engineResult(), { ...engineResult(), status: "failed" as const, reason: "model_error" as const, exitCode: 5 }]) {
    const report = { ...runFixture(), result };
    assert.equal(run("en", report), renderReport(report));
  }
  const states: ReportPlanApply[] = [null, ...PLAN_APPLY_STATES.map(state => ({ state, applyRunId: APPLY_ID, ...(state === "unfinished" ? { reason: "no_verifier" as const } : {}) }))];
  for (const kind of [undefined, "changes"] as const) for (const state of states) {
    const report = { ...runFixture(), result: { ...engineResult(), plan: { actions: 2, digest: "abc", ...(kind === undefined ? {} : { kind }) } } };
    assert.equal(run("en", report, null, 2, state), renderReport(report, null, 2, state));
    const ko = run("ko", report, null, 2, state);
    assert.ok(ko.includes(kind === "changes" ? "파일 2개" : "동작 2개"));
    assert.ok(ko.includes(state === null ? "승인을 기다립니다" : "`" + APPLY_ID + "`"));
  }
  const unfinished = { state: "unfinished", applyRunId: APPLY_ID } as const;
  const report = { ...runFixture(), result: { ...engineResult(), plan: { actions: 0, digest: "abc", kind: "changes" as const } } };
  assert.equal(run("en", report, null, 0, unfinished), renderReport(report, null, 0, unfinished));
  assert.ok(run("ko", report, null, 0, unfinished).includes("완료 이외의 상태"));
  for (const r of [applyFixture(), completedApply()]) assert.equal(apply("en", r), renderApplyReport(r));
});

test("Korean rich branches preserve payloads, status/reason codes, verdicts and parameters", () => {
  const f = runFixture(), e = engineResult("## Usage\n# Codaryn run report\n{0} model words");
  const report: RunReportOutput = { ...f, status: "complete", recordsChanged: true,
    result: { ...e, status: "needs-input", reason: "awaiting_review", review: { checklist: [masked("## Usage")] },
      usage: { ...e.usage, inputTokens: 3, outputTokens: 4 }, planRunId: "original-plan", planDigest: "digest123",
      verifiers: [{ id: "not-shown", kind: "command", outcome: "fail", checked: [masked("original checked")], limits: [masked("original limit")], evidence: masked("evidence\n```") }],
      changes: [{ path: masked("## Usage"), created: true, previousHash: null, newHash: "1234567890abcdef" }, { path: masked("old"), created: false, previousHash: null, newHash: "abcdef1234567890" }],
      protectedChanged: [masked("original protected")], notices: [masked("original notice")] },
    journal: { ...f.journal, limits: { ...f.journal.limits, maxTotalTokens: 99, maxRepairAttempts: 2 }, repairs: 1,
      integrityChecks: [{ phase: "run_start", changed: [] }, { phase: "before_verify", changed: [] }, { phase: "after_verify", changed: [] }] } };
  const before = JSON.stringify(report);
  for (const verdict of [null, ...(["accepted", "rejected"] as const).map(verdict => ({ schemaVersion: 1 as const, kind: "review_record" as const, runId: "r", at: "2026-11-15T00:00:00Z", verdict, note: masked("original note") }))]) {
    const r = { ...report, verdict }, ko = run("ko", r, null, 2);
    assert.equal(run("en", r, null, 2), renderReport(r, null, 2));
    for (const fragment of ["확인 필요 (`needs-input`)", "사람의 검토를 기다림 (`awaiting_review`)", "완전 (complete)", "기록 변경 표시", "- 검증기 1 (command): **실패 (fail)**", "original checked", "original limit", "original protected", "original notice", "- `## Usage` 만듦 (1234567890ab)", "- `old` 바꿈 (없음 -> abcdef123456)", "입력 3, 출력 4", "한도: 99", "재수정: 1 / 2", "실행 시작 때, 검증 전, 검증 후", "  | ## Usage\n  | # Codaryn run report\n  | {0} model words"]) assert.ok(ko.includes(fragment), fragment);
    assert.ok(ko.includes(verdict === null ? "사람의 판정이 없습니다" : `${verdict.verdict === "accepted" ? "수락" : "거절"} (${verdict.verdict})`));
    assert.equal(ko.includes("not-shown"), false);
  }
  assert.equal(JSON.stringify(report), before);
  const incomplete = { ...f, journal: { ...f.journal, finished: { status: "failed" as const, reason: "model_error" as const } } };
  assert.ok(run("ko", incomplete).includes("실패 (`failed`) / 모델 호출 오류 (`model_error`)"));
  const pending = { ...f, result: { ...e, reason: "plan_pending" as const } };
  assert.equal(run("ko", pending).includes("## 에이전트의 마지막 답"), false);
});

test("apply branches keep action order, unverified records, consent, notices and known outcomes", () => {
  const f = completedApply(), ko = apply("ko", f);
  for (const fragment of ["완료 (`done`) / 지정한 검증 모두 통과 (`verified`)", "적용할 수 없었던 동작: 1개", "작업 공간이 너무 커 확인하지 못함: 예", "하드 링크 없음): 1개", "동작 (4개 중 2개 완료)", "동작 1: 폐기 `old` (`.codaryn/discarded/a/saved`로 보관)", "동작 3: 이동 `src` -> `dst` (동의를 받아 보장 없이 옮김)", "동작 2 실패: `source_missing`", "동작 1개가 시작됐으나", "소요 시간: 1 ms / 10 ms", "바뀐 보호 경로가 없습니다", "original notice"]) assert.ok(ko.includes(fragment), fragment);
  for (const outcome of ["pass", "inconclusive"] as const) {
    const r = { ...f, result: { ...f.result!, verifiers: [{ id: "v", kind: "file_rules" as const, outcome, checked: [], limits: [], evidence: masked("evidence") }] }, journal: { ...f.journal, unsafeMoveConsent: "adapter" as const, checked: { problems: 0, inventoryLimitReached: false, unsafeMoves: 0 } } };
    assert.equal(apply("en", r), renderApplyReport(r));
    assert.ok(apply("ko", r).includes(`**${outcome === "pass" ? "통과" : "판단 불가"} (${outcome})**`));
    assert.ok(apply("ko", r).includes("동의: `adapter`"));
    assert.ok(apply("ko", r).includes("확인하지 못함: 아니요"));
    assert.equal(apply("ko", r).includes("  evidence"), outcome !== "pass");
  }
});

test("both languages mask before controls, retain safe fences and apply the same row/character notices", () => {
  const f = runFixture(), key = "synthetic-e3-value", shape = ["sk", "ant", "test"].join("-") + "x".repeat(40);
  const report = { ...f, runId: shape, journal: { ...f.journal, taskId: "synthetic-\te3-value", lastRound: [{ id: "v", kind: "command" as const, outcome: "fail" as const, checked: [], limits: [], evidence: masked("before\n```\u001b\nafter") }] }, result: { ...engineResult(Array.from({ length: 25 }, (_, i) => `row${i}`).join("\n")), finalMessage: { text: masked(Array.from({ length: 25 }, (_, i) => `row${i}`).join("\n")), truncated: true } } };
  for (const language of ["en", "ko"] as const) {
    const output = run(language, report, key);
    assert.ok(output.includes("[key]")); assert.equal(output.includes(shape), false); assert.equal(output.includes(key), false); assert.equal(output.includes("\u001b"), false);
    // Result verifiers take precedence; use the journal evidence path separately.
    const evidence = run(language, { ...report, result: null }, key);
    assert.ok(evidence.includes("  ````\n  before\n  ```?\n  after\n  ````"));
    const inline = run(language, { ...runFixture(), runId: "`x``\u001b", journal: { ...f.journal, workflow: masked("") } });
    assert.ok(inline.includes("``` `x``? ```")); assert.ok(inline.includes("`  `"));
    assert.ok(output.includes(`  | row${FINAL_MESSAGE_MAX_LINES - 1}\n`)); assert.equal(output.includes("row20"), false); assert.ok(output.includes("… (+5)"));
    assert.ok(output.includes(language === "en" ? `first ${MAX_FINAL_MESSAGE_CHARS} characters` : `앞 ${MAX_FINAL_MESSAGE_CHARS}자`));
  }
});

test("key state clears after localized exceptions and nested cross-language renderers share the legacy state", () => {
  const sentinel = Symbol("e3 sentinel"), key = "synthetic-e3-value";
  for (const language of ["en", "ko"] as const) for (const invoke of [
    () => run(language, { ...runFixture(), get runId(): string { throw sentinel; } }, key),
    () => apply(language, { ...applyFixture(), get runId(): string { throw sentinel; } }, key),
  ]) {
    assert.throws(invoke, error => error === sentinel);
    assert.ok(renderReport({ ...runFixture(), runId: key }).includes(key));
    assert.ok(apply("ko", { ...applyFixture(), runId: key }).includes(key));
  }
  const nested = { ...runFixture(), get runId() { apply("ko", applyFixture(), "inner fixture"); return key; } };
  assert.ok(renderReport(nested, key).includes(key), "nested rendering clears to null, does not restore outer key");
});

test("English localized rendering observes the original mutable fixed-limit array objects", () => {
  for (const [limits, normal, localized] of [
    [REPORT_FIXED_LIMITS, () => renderReport(runFixture()), () => run("en", runFixture())],
    [APPLY_REPORT_FIXED_LIMITS, () => renderApplyReport(applyFixture()), () => apply("en", applyFixture())],
  ] as const) {
    const mutable = limits as string[], marker = "synthetic appended limit";
    try { mutable.push(marker); assert.equal(localized(), normal()); assert.ok(localized().includes(marker)); }
    finally { assert.equal(mutable.pop(), marker); }
  }
  const koRun = run("ko", runFixture()), koApply = apply("ko", applyFixture());
  assert.equal(RUN_LIMITS.filter(s => koRun.includes(s)).length, REPORT_FIXED_LIMITS.length);
  assert.equal(APPLY_LIMITS.filter(s => koApply.includes(s)).length, APPLY_REPORT_FIXED_LIMITS.length);
});

test("Korean renderers retain inherited names and unknown sentences in both mutable limit arrays", () => {
  const additions = ["__proto__", "toString", "constructor", "unregistered original sentence"];
  for (const [limits, render] of [
    [REPORT_FIXED_LIMITS, () => run("ko", runFixture())],
    [APPLY_REPORT_FIXED_LIMITS, () => apply("ko", applyFixture())],
  ] as const) {
    const mutable = limits as string[], before = [...limits];
    try {
      mutable.push(...additions);
      const text = render();
      for (const literal of additions) assert.ok(text.includes("- " + literal + "\n"), literal);
      assert.equal(text.includes("[object Object]"), false);
      assert.equal(text.includes("[native code]"), false);
    } finally {
      assert.deepEqual(mutable.splice(before.length), additions);
      assert.deepEqual(limits, before, "array contents and original object survive the test");
    }
  }
});

test("public word factory keeps unregistered template and code names as strings without widening report enums", () => {
  const words = reportWords("ko");
  assert.equal(words`__proto__`, "__proto__");
  assert.equal(words`toString`, "toString");
  assert.equal(words`constructor`, "constructor");
  assert.equal(words`unregistered original sentence`, "unregistered original sentence");
  for (const name of ["__proto__", "toString", "constructor", "unregistered-code"]) {
    const code = "`" + name + "`";
    assert.equal(words`- Report: ${name} (${"1"} journal records)`, "- 보고서: " + name + " (실행 기록 1건)");
    assert.equal(words`- Result: ${code} / ${code}, exit code ${"3"}`, "- 결과: " + code + " / " + code + ", 종료 코드 3");
    assert.equal(words`- The journal's end record: ${code} / ${code}`, "- 실행 기록의 끝 기록: " + code + " / " + code);
    assert.equal(words`Verdict: **${name}** (${"`at`"})${""}`, "판정: **" + name + "** (`at`)");
    assert.equal(words`- verifier ${"1"} (${"command"}): **${name}**`, "- 검증기 1 (command): **" + name + "**");
  }
});
