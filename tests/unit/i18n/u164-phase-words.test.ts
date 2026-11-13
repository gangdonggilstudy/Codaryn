/**
 * U-164 (U-159 row 13): the protected material check's phase words in Korean say "실행을 시작할 때"
 * and "검증 뒤", as the GUI does and as the catalog says "뒤" elsewhere (실행 뒤에, 미리보기 뒤에).
 * No renderer shows these words yet (the progress line shows the phase code), so no output changes.
 * The English (at start, before checks, after checks) stays as it is.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMessageCatalog, MESSAGE_TEXTS } from "../../../src/i18n/index.js";

describe("U-164: the phase words", () => {
  test("Korean: 실행을 시작할 때, 검증 전, 검증 뒤", () => {
    const { ko } = MESSAGE_TEXTS;
    assert.equal(ko["phase.run_start"], "실행을 시작할 때");
    assert.equal(ko["phase.before_verify"], "검증 전");
    assert.equal(ko["phase.after_verify"], "검증 뒤");
    assert.ok(!Object.values(ko).some((text) => text.includes("검증 후")), "no 검증 후 left in the catalog");
  });

  test("the English stays", () => {
    const { en } = MESSAGE_TEXTS;
    assert.deepEqual([en["phase.run_start"], en["phase.before_verify"], en["phase.after_verify"]], ["at start", "before checks", "after checks"]);
  });

  test("the progress line still shows the phase as its code: no output changes", () => {
    // The phase.* words are the codes' words for a renderer that wants them (contracts/human.ts);
    // the progress line's {phase} shows the code, so no CLI output changes with this unit.
    const ko = createMessageCatalog("ko");
    assert.equal(ko.format("progress.integrity_unchanged", { phase: "after_verify" }), "보호 대상 확인 — 바뀌지 않음 (after_verify)");
  });
});

describe("U-164 (PM, second part): path tokens and the task form in Korean, as the GUI says them", () => {
  test("restoring path tokens is 경로의 가린 값 되살리기, on the start line and in doctor", () => {
    const { ko, en } = MESSAGE_TEXTS;
    assert.equal(ko["progress.workflow_policy.restore_path_tokens_off"], "작업 종류 자체 규칙 때문에, 설정한 정책이 허용한 경로의 가린 값 되살리기를 끕니다");
    assert.equal(ko["doctor.workflow_policy.restore_path_tokens_off"], "이 작업 종류로 실행하면, 설정한 정책이 허용해도 경로의 가린 값을 되살리지 않습니다");
    assert.ok(!Object.values(ko).some((text) => /경로 토큰/.test(text)), "no 경로 토큰 left");
    // The English keeps "path tokens" (docs/usage.md and the progress tests quote it).
    assert.ok(en["progress.workflow_policy.restore_path_tokens_off"].includes("restoring path tokens"));
  });

  test("the task form is 작업 지정: the command to apply a plan names <같은 작업 지정>", () => {
    const { ko, en } = MESSAGE_TEXTS;
    assert.equal(ko["plan.next_apply"], "적용하려면: codaryn apply <같은 작업 지정> --run {runId} --digest");
    assert.ok(ko["error.plan_secrets_differ.fix"].includes("같은 작업 지정 방식"));
    assert.ok(!Object.values(ko).some((text) => /task 형식/.test(text)), "no task 형식 left");
    assert.equal(en["plan.next_apply"], "To apply it: codaryn apply <the same task form> --run {runId} --digest");
  });
});
