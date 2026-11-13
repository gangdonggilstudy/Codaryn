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
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { runsScreen } from "../../src/renderer/runs/runs-screen.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

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
  const { en, ko } = await cli();
  assert.equal(KO["outcome.fail"], ko["outcome.fail"]);
  // R-98 M-1: in English too, "not passed" apart from the run's "failed".
  assert.equal(EN["outcome.fail"], en["outcome.fail"]);
  assert.equal(EN["outcome.fail"], "not passed");
  assert.notEqual(EN["outcome.fail"], EN["runstatus.failed"]);
  assert.equal(KO["outcome.fail"], "미통과");
  assert.equal(KO["runstatus.failed"], "실패");
  assert.notEqual(KO["outcome.fail"], KO["runstatus.failed"]);
});

test("U-163 (4): the records-changed mark is changed by something other than the run, in both languages", async () => {
  const { en, ko } = await cli();
  for (const id of ["cleanup.entry.recordsChanged", "cleanup.warning.records_changed"] as const) {
    assert.equal(KO[id], "기록 변경됨(실행이 아닌 것이 바꿈)", id);
    assert.equal(EN[id], "records changed (not by the run)", id);
    assert.doesNotMatch(`${KO[id]} ${EN[id]}`, /실행 중|during the run/, id);
  }
  // U-157: the run list's row has the CLI's short mark, and its explanation is the CLI's line under the table.
  assert.equal(KO["runs.recordsChanged"], ko["runs.records_changed"]);
  assert.equal(EN["runs.recordsChanged"], en["runs.records_changed"]);
  assert.equal(KO["runs.recordsChangedNote"], ko["runs.records_changed_note"]);
  assert.equal(EN["runs.recordsChangedNote"], en["runs.records_changed_note"]);
  // The other screens name the mark as the CLI does (기록 변경 표시), the same text where the meaning is the same.
  assert.equal(KO["plan.recordsChanged"], ko["plan.records_changed"]);
  assert.equal(KO["changes.recordsChanged"], ko["changes.records_changed"]);
  assert.equal(KO["runs.revertRecordsChanged"], ko["revert.records_changed"]);
  for (const id of ["report.recordsChanged", "changes.unverifiedMarked", "error.plan_records_changed"] as const) assert.match(KO[id], /기록 변경 표시/, id);
  for (const [id, text] of Object.entries(KO)) assert.doesNotMatch(text, /실행 밖|실행 중 기록이 바뀜/, `ko ${id}`);
});

test("U-163 (5, 7-14): 가릴 값, 작업 지정 방식, 한도, 확인, 앞선 정리, 일반 폴더, 돌려놓지 못한, 실행을 시작할 때, 손상", async () => {
  const { en, ko } = await cli();
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
  // R-98 L-1: the discarded files' deletion is confirmed in every cleanup line, never agreed to (동의 is DR-25's).
  for (const id of ["cleanup.kept.not_confirmed", "cleanup.kept.discarded_left"] as const) {
    assert.doesNotMatch(KO[id], /동의/, `ko ${id}`);
    assert.doesNotMatch(EN[id], /agree/, `en ${id}`);
  }
  assert.match(KO["cleanup.kept.discarded_left"], /지우기를 확인하세요/);
  // R-98 L-2: the main process's cleanup dialog says 돌려놓지 못한, as the screen does.
  assert.match(DIALOG_TEXTS.ko["cleanup.detail"], /제자리에 돌려놓지 못한/);
  assert.doesNotMatch(DIALOG_TEXTS.ko["cleanup.detail"], /두지 못한/);
  // R-98 L-3: the CLI's English for a damaged run, the phases and the task form.
  assert.equal(EN["runs.damaged"], en["runs.damaged"]);
  for (const id of ["phase.run_start", "phase.before_verify", "phase.after_verify"] as const) {
    assert.equal(EN[id], en[id], `en ${id}`);
    assert.equal(KO[id], ko[id], `ko ${id}`);
  }
  for (const [id, text] of Object.entries(EN)) assert.doesNotMatch(text, /task part/, `en ${id}: the task form, as the CLI says`);
  assert.match(EN["report.reviewCli"], /task form/);
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

test("U-163 (4, U-157): a marked row has the short mark, and the list has its explanation once, under it", async () => {
  const restore = installFakeDom();
  try {
    const row = (runId: string, recordsChanged: boolean) => ({ state: "checked", runId, kind: "run", startedAt: null, taskId: "quick", status: "complete", reason: "done", changes: 0, reverted: null, revertRecordDamaged: false, recordsChanged, form: null });
    const shown = async (rows: readonly unknown[], language: "ko" | "en"): Promise<FakeElement> => {
      const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "listRuns" ? { ok: true, runs: rows, omitted: 0 } : null) });
      const screen = runsScreen({ texts: textsFor(language), api, current: () => ({ handle: "1".repeat(32), name: "ws" }), open: () => undefined, announce: () => undefined, openPlan: () => undefined, openChanges: () => undefined, openReport: () => undefined });
      const root = new FakeElement("main");
      screen.show(root as unknown as HTMLElement);
      await settle();
      return root;
    };
    for (const language of ["ko", "en"] as const) {
      const texts = language === "ko" ? KO : EN;
      const root = await shown([row("20261113T010203Z-0000abcd", true), row("20261113T010204Z-0000abce", false), row("20261113T010205Z-0000abcf", true)], language);
      const marks = root.findAll((e) => e.getAttribute("data-records-changed") === "true");
      assert.deepEqual(marks.map((e) => e.textContent), [texts["runs.recordsChanged"], texts["runs.recordsChanged"]], language);
      const notes = root.findAll((e) => e.getAttribute("id") === "runs-records-changed-note");
      assert.deepEqual(notes.map((e) => e.textContent), [texts["runs.recordsChangedNote"]], `${language}: once, for the whole list`);
      assert.equal(notes[0]?.getAttribute("data-records-changed"), null, "the rows' marks stay the only data-records-changed");
      const plain = await shown([row("20261113T010204Z-0000abce", false)], language);
      assert.equal(plain.findAll((e) => e.getAttribute("id") === "runs-records-changed-note").length, 0, `${language}: no line without a mark`);
    }
  } finally {
    restore();
  }
});
