/**
 * U-163 (the U-159 survey, DR-50): where the window and the CLI say the same thing, they use the
 * same words. The person's review is 검토 with the verdicts 받아들임 / 거절함 (승인 stays the
 * plan's approval; 확인 stays 권한 확인 and the status 확인 필요); a check that did not pass is
 * 미통과 (실패 is the run's status); the records-changed mark is changed by something other than
 * the run; the permission dialog allows 이번 호출에만. The CLI's catalog is the root build's.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DIALOG_TEXTS } from "../../src/main/dialog-texts.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";

// This file runs as gui/build/tests/unit/u163-cli-words.test.js.
const I18N = path.join(fileURLToPath(new URL("../../../", import.meta.url)), "..", "dist", "src", "i18n");

const cli = async (): Promise<{ en: Record<string, string>; ko: Record<string, string> }> => {
  const en = (await import(pathToFileURL(path.join(I18N, "en.js")).href)) as { EN_MESSAGES: Record<string, string> };
  const ko = (await import(pathToFileURL(path.join(I18N, "ko.js")).href)) as { KO_MESSAGES: Record<string, string> };
  return { en: en.EN_MESSAGES, ko: ko.KO_MESSAGES };
};

test("U-163 (1, 2): the review is 검토 and its verdicts 받아들임 / 거절함, the CLI's words", async () => {
  const { ko } = await cli();
  assert.ok(ko["runs.review"]?.startsWith("검토"), "the CLI says 검토");
  assert.equal(KO["report.tab.review"], "검토");
  assert.equal(KO["runs.review"], "검토");
  assert.equal(KO["review.title"], "사람의 검토");
  assert.match(KO["error.run_not_awaiting_review"], /사람의 검토를 기다리고/);
  const accepted = ko["review.verdict.accepted"] ?? "";
  const rejected = ko["review.verdict.rejected"] ?? "";
  assert.equal(accepted, "받아들임");
  assert.equal(rejected, "거절함");
  assert.ok(KO["review.accepted"].endsWith(`사람이 ${accepted}`));
  assert.ok(KO["review.rejected"].endsWith(`사람이 ${rejected}`));
  assert.ok(KO["review.confirmAccept"].startsWith(accepted));
  assert.ok(KO["review.confirmReject"].startsWith(rejected));
  assert.equal(KO["review.accept"], "받아들이기");
  assert.equal(KO["review.reject"], "거절하기");
  // 승인 is the plan's approval only; 사람 확인 and 반려 are not the window's words any more.
  for (const [id, text] of Object.entries(KO)) {
    assert.doesNotMatch(text, /사람 확인|반려/, `ko ${id}`);
    if (id.startsWith("review.") || id.endsWith(".review")) assert.doesNotMatch(text, /승인/, `ko ${id}: 승인 is the plan's`);
  }
  // The checklist heading is the CLI's summary words (확인할 항목).
  assert.ok((ko["summary.review_checklist"] ?? "").startsWith(KO["run.review"]));
});

test("U-163 (3): a check that did not pass is 미통과, as the CLI says; 실패 stays the run's status", async () => {
  const { ko } = await cli();
  assert.equal(KO["outcome.fail"], ko["outcome.fail"]);
  assert.equal(KO["outcome.fail"], "미통과");
  assert.equal(KO["runstatus.failed"], "실패");
  assert.notEqual(KO["outcome.fail"], KO["runstatus.failed"]);
});

test("U-163 (4): the records-changed mark is changed by something other than the run, in both languages", async () => {
  const { ko } = await cli();
  for (const id of ["cleanup.entry.recordsChanged", "cleanup.warning.records_changed"] as const) {
    assert.equal(KO[id], "기록 변경됨(실행이 아닌 것이 바꿈)", id);
    assert.equal(EN[id], "records changed (not by the run)", id);
    assert.doesNotMatch(`${KO[id]} ${EN[id]}`, /실행 중|during the run/, id);
  }
  assert.equal(KO["runs.recordsChanged"], ko["runs.records_changed"]);
  // The other screens name the mark as the CLI does (기록 변경 표시), the same text where the meaning is the same.
  assert.equal(KO["plan.recordsChanged"], ko["plan.records_changed"]);
  assert.equal(KO["changes.recordsChanged"], ko["changes.records_changed"]);
  assert.equal(KO["runs.revertRecordsChanged"], ko["revert.records_changed"]);
  for (const id of ["report.recordsChanged", "changes.unverifiedMarked", "error.plan_records_changed"] as const) assert.match(KO[id], /기록 변경 표시/, id);
  for (const [id, text] of Object.entries(KO)) assert.doesNotMatch(text, /실행 밖|실행 중 기록이 바뀜/, `ko ${id}`);
});

test("U-163 (5, 7-14): 가릴 값, 작업 지정 방식, 한도, 확인, 앞선 정리, 일반 폴더, 돌려놓지 못한, 실행을 시작할 때, 손상", async () => {
  const { ko } = await cli();
  assert.match(KO["home.notice"], /등록한 가릴 값뿐/);
  assert.match(KO["settings.providerNotice"], /\(가릴 값은 가린 채\)/);
  for (const id of ["error.form_unknown", "report.reviewCli", "plan.formUnknown"] as const) {
    assert.match(KO[id], /작업 지정 방식/, id);
    assert.doesNotMatch(KO[id], /작업 형태|작업 지정(?! 방식)/, id);
  }
  assert.equal(KO["settings.noLimit"], "한도 없음");
  assert.match(KO["cleanup.kept.not_confirmed"], /확인하지 않아/);
  assert.doesNotMatch(KO["cleanup.kept.not_confirmed"], /동의/, "동의 is DR-25's consent");
  assert.match(EN["cleanup.kept.not_confirmed"], /was not confirmed$/);
  for (const id of ["cleanup.summary.leftovers", "cleanup.plan.leftovers", "cleanup.warning.leftover"] as const) assert.match(KO[id], /^앞선 정리/, id);
  assert.match(ko["cleanup.warning.leftover"] ?? "", /^앞선 정리/);
  assert.match(KO["cleanup.kept.not_plain_directory"], /일반 폴더/);
  for (const id of ["cleanup.summary.parked", "cleanup.plan.parked"] as const) assert.match(KO[id], /제자리에 돌려놓지 못한/, id);
  assert.equal(KO["phase.run_start"], "실행을 시작할 때");
  assert.equal(KO["phase.after_verify"], "검증 뒤");
  assert.ok(KO["runs.damaged"].startsWith("손상"));
  assert.equal(KO["runs.damaged"], ko["runs.damaged"]);
  for (const [id, text] of Object.entries(KO)) assert.doesNotMatch(text, /지난 정리|보통 폴더|제한 없음|가린 값 제외/, `ko ${id}`);
});

test("U-163 (U-124): the permission dialog uses the CLI's 권한 확인 and 이번 호출에만 허용", async () => {
  const { ko } = await cli();
  const allowed = ko["progress.confirmation_allowed"] ?? "";
  assert.equal(DIALOG_TEXTS.ko["permission.title"], "권한 확인");
  assert.ok(allowed.startsWith(DIALOG_TEXTS.ko["permission.title"]));
  assert.equal(DIALOG_TEXTS.ko["permission.allowOnce"], "이번 호출에만 허용");
  assert.ok(allowed.includes(DIALOG_TEXTS.ko["permission.allowOnce"]), "the CLI's progress line says the same");
  assert.ok((ko["confirm.question.command"] ?? "").includes("이번 호출에만 허용"));
  assert.ok((ko["confirm.question.command"] ?? "").startsWith(DIALOG_TEXTS.ko["permission.message"].split("?")[0] ?? "-"));
});
