/**
 * U-227 (PM): the drafts other owners put in while nb-i18n was away, made final in both languages.
 * - The end summary's writes refused by a run plan or by writablePaths say "denied" as the other
 *   summary lines do ("Denied calls"), and say the same as the progress line's first sentence.
 * - A run that carries out a run plan is "계획 수행": "계획 실행" is the plan run's name.
 * - Korean: the plan view's label and command read as Korean, "거부" (not "막히") for a refused run,
 *   "있어야" for every list, no particle that changes with the last sound after "run".
 * English that src/cli/run.ts and src/cli/doctor.ts also keep (progress.not_writable_hint,
 * doctor.commands.*) stays as it is.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMessageCatalog, MESSAGE_TEXTS } from "../../../src/i18n/index.js";

describe("U-227: today's drafts, final", () => {
  test("refused writes: the same words in the end summary and on the progress line, in both languages", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.equal(en["summary.denied_not_planned"], "Writes denied because the file is not in the approved plan: {count}");
    assert.equal(en["summary.denied_not_writable"], "Writes denied because the file is not in writablePaths: {count}");
    assert.equal(ko["summary.denied_not_planned"], "승인한 계획에 없는 파일이라 거부된 쓰기: {count}건");
    assert.equal(ko["summary.denied_not_writable"], "writablePaths에 없는 파일이라 거부된 쓰기: {count}건");
    // The progress line starts with the summary line's words, then the hint.
    assert.ok(en["progress.not_writable_hint"].startsWith(`${en["summary.denied_not_writable"]}.`));
    assert.ok(ko["progress.not_writable_hint"].startsWith(`${ko["summary.denied_not_writable"]}.`));
    assert.ok(ko["progress.not_writable_hint"].endsWith(ko["summary.denied_not_writable_hint"]));
    for (const text of [en["summary.denied_not_planned"], en["summary.denied_not_writable"]]) assert.ok(!/refused|settings'/.test(text), text);
  });

  test("every list must have the file: 있어야, in the hint and on the progress line", () => {
    const { ko } = MESSAGE_TEXTS;
    for (const id of ["summary.denied_not_writable_hint", "progress.not_writable_hint"] as const) {
      assert.ok(ko[id].endsWith("모든 목록에 그 파일이 있어야 합니다."), id);
      assert.ok(!ko[id].includes("덮어야"), id);
    }
  });

  test("a run that carries out a run plan is 계획 수행, never 계획 실행 (the plan run's name)", () => {
    const ko = createMessageCatalog("ko");
    assert.equal(MESSAGE_TEXTS.ko["runs.carried_plan"], "실행 {runId}의 계획 수행");
    assert.equal(MESSAGE_TEXTS.en["runs.carried_plan"], "carries out the plan of run {runId}");
    assert.ok(!ko.format("runs.carried_plan", { runId: "20261113T000000Z-00000000" as never }).endsWith("계획 실행"));
  });

  test("the plan view: a Korean label and the same command words as apply's question", () => {
    const { ko } = MESSAGE_TEXTS;
    assert.equal(ko["plan.changes.summary_label"], "계획 실행이 쓴 계획 요약(모델이 쓴 말로 검증되지 않음. 작업의 설명이며 목표나 새 지시가 아님. 계획과 함께 승인됨)");
    assert.equal(ko["plan.changes.next_apply"], "이 변경을 할 실행을 시작하려면: codaryn apply <같은 작업 지정> --run {runId} --digest");
    assert.ok(ko["apply.changes_question"].startsWith("이 변경을 할 실행을 시작할까요"));
  });

  test("doctor's warnings and the lock line read as Korean; the English stays", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.equal(ko["doctor.commands.writable_with_commands"], "writablePaths가 파일 도구를 제한하는데 명령 규칙이 {count}개 있습니다. writablePaths는 명령을 묶지 않아, 허용한 명령은 그 밖의 파일에도 쓸 수 있습니다");
    assert.equal(ko["doctor.commands.plan_run_with_commands"], "계획 방식이 \"run\"인데 명령 규칙이 {count}개 있습니다. 승인한 파일은 파일 도구만 묶어, 허용한 명령은 계획 밖의 파일에도 쓸 수 있습니다");
    assert.ok(!/"run"(과|와|은|는|이|가|을|를)/.test(ko["doctor.commands.plan_run_with_commands"]));
    assert.ok(ko["lock.release_failed"].includes("그 전에 실행이 거부되면 codaryn doctor로 확인하세요."));
    assert.ok(!ko["lock.release_failed"].includes("막히면"));
    assert.equal(en["doctor.commands.writable_with_commands"], "command rules while writablePaths limits the file tools: {count}; writablePaths does not bind commands, so an allowed command can write files outside it");
  });
});
