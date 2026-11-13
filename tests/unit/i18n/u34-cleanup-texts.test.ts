/**
 * U-34 (UXM-7, AXM-22; the U-19 survey, section 3 A): cleanup's lines that were fixed English in
 * src/cli/cleanup.ts are in the catalog. The English is the CLI's, to the letter, so the English
 * output stays; the Korean uses DR-50's words (폐기 보관함).
 *
 * U-86 retired the preview's next-step lines (cleanup.next.*): the grouped preview and its two
 * commands took their place (u86-cleanup-preview-texts.test.ts). What stays of U-34 is checked here.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMessageCatalog, MESSAGE_TEXTS } from "../../../src/i18n/index.js";

const HANGUL = /[가-힣]/u;

describe("U-34: cleanup's size, nothing-removed line and the kinds of item", () => {
  test("the English is the CLI's lines before U-34, to the letter", () => {
    const { en } = MESSAGE_TEXTS;
    assert.equal(createMessageCatalog("en").format("cleanup.size", { files: 4, bytes: 15392 }), "4 file(s), 15392 bytes");
    assert.equal(en["cleanup.nothing_removed"], "Nothing was removed.");
    // The kinds of item, as the item lines named them (`- run <id>: ...`).
    assert.deepEqual([en["cleanup.target.run"], en["cleanup.target.discarded"], en["cleanup.target.leftover"]], ["run", "discarded", "leftover"]);
  });

  test("the Korean names the kinds of item and the size in Korean", () => {
    const { ko } = MESSAGE_TEXTS;
    assert.deepEqual([ko["cleanup.target.run"], ko["cleanup.target.discarded"], ko["cleanup.target.leftover"]], ["실행 기록", "폐기 보관함", "남은 폴더"]);
    assert.equal(createMessageCatalog("ko").format("cleanup.size", { files: 4, bytes: 15392 }), "파일 4개, 15392바이트");
    assert.equal(ko["cleanup.nothing_removed"], "아무것도 지우지 않았습니다.");
  });

  test("the Korean has no English word, and DR-50's 폐기 보관함 for the discarded files", () => {
    const { ko } = MESSAGE_TEXTS;
    for (const id of ["cleanup.size", "cleanup.nothing_removed", "cleanup.target.run", "cleanup.target.discarded", "cleanup.target.leftover"] as const) {
      const t = ko[id].replace(/\{[a-zA-Z]+\}/g, "");
      assert.ok(HANGUL.test(t) && !/[A-Za-z]/.test(t), `ko ${id}`);
    }
    assert.ok(ko["cleanup.target.discarded"].includes("폐기 보관함"));
  });
});
