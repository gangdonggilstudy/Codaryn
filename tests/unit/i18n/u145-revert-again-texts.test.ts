/**
 * U-145 (PM, UXM-21 second point): a second revert of a run says that files already back are
 * skipped, and ends with the earlier revert, so the renderer's " (complete, <time>)" belongs to it.
 * Since N-22 a file already as it was before the run is skipped as already_reverted: the old second
 * sentence ("its files may show as changed since the run") no longer held. Also the counter 개 in
 * the runs table's apply cells, as plan says "동작 3개".
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMessageCatalog, MESSAGE_TEXTS, PLACEHOLDER } from "../../../src/i18n/index.js";

const placeholders = (text: string): string[] => [...text.matchAll(PLACEHOLDER)].map((match) => match[1] as string);

describe("U-145: a second revert, and the apply cells' counter", () => {
  test("the earlier revert comes last, right before the renderer's bracket; no value of its own", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.equal(en["revert.reverted_before"], "Files already as before the run are skipped; it was reverted before");
    assert.equal(ko["revert.reverted_before"], "이미 실행 전 상태인 파일은 건너뜁니다. 이 실행은 전에 되돌렸습니다");
    for (const text of [en["revert.reverted_before"], ko["revert.reverted_before"]]) {
      assert.deepEqual(placeholders(text), [], text);
      // The renderer adds " (complete, <time>)": no full stop of its own before it.
      assert.ok(!/[.。]$/.test(text), text);
      assert.ok(!/changed since|바뀐 것으로 보일/.test(text), text);
    }
  });

  test("it says the same as the skip reason already_reverted, in each language", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.equal(ko["revert.skip.already_reverted"], "이미 실행 전 상태임");
    assert.ok(ko["revert.reverted_before"].startsWith("이미 실행 전 상태인 파일은"));
    assert.ok(en["revert.reverted_before"].startsWith("Files already as before the run"));
  });

  test("with the renderer's bracket and a local time the line fits 100 columns", () => {
    const wide = (code: number): boolean => code >= 0xac00 && code <= 0xd7a3;
    const columns = (line: string): number => [...line].reduce((sum, char) => sum + (wide(char.codePointAt(0) ?? 0) ? 2 : 1), 0);
    for (const language of ["en", "ko"] as const) {
      const line = `${MESSAGE_TEXTS[language]["revert.reverted_before"]} (complete, 2026-11-13 11:15:13)`;
      assert.ok(columns(line) <= 100, `${language}: ${columns(line)}: ${line}`);
    }
  });

  test("the runs table's apply cells count with 개 in Korean", () => {
    const ko = createMessageCatalog("ko");
    assert.equal(ko.format("runs.apply_actions", { count: 7 }), "동작 7개");
    assert.equal(ko.format("runs.apply_action_one"), "동작 1개");
    assert.equal(createMessageCatalog("en").format("runs.apply_actions", { count: 7 }), "7 actions");
  });
});
