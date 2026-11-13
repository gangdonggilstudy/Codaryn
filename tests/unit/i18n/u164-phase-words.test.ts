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
