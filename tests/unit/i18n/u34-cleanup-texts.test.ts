/**
 * U-34 (UXM-7, AXM-22; the U-19 survey, section 3 A): cleanup's lines that were fixed English in
 * src/cli/cleanup.ts are in the catalog. The English is the CLI's, to the letter, so the English
 * output stays; the Korean uses DR-50's words (폐기 보관함).
 *
 * G-A: no text takes the digest. The renderer puts the options after a confirm line, one space
 * apart (the full stop the CLI put after the digest is the renderer's to keep or not).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMessageCatalog, MESSAGE_TEXTS } from "../../../src/i18n/index.js";

const HANGUL = /[가-힣]/u;
const CONFIRMS = ["cleanup.next.confirm_runs", "cleanup.next.confirm_discarded", "cleanup.next.confirm_leftovers"] as const;

describe("U-34: cleanup's size, nothing-removed and next-step lines and the kinds of item", () => {
  test("the English is the CLI's lines before U-34, to the letter", () => {
    const { en } = MESSAGE_TEXTS;
    const english = createMessageCatalog("en");
    const digest = "0123456789ab";
    assert.equal(english.format("cleanup.size", { files: 4, bytes: 15392 }), "4 file(s), 15392 bytes");
    assert.equal(en["cleanup.nothing_removed"], "Nothing was removed.");
    assert.equal(`${en["cleanup.next.confirm_runs"]} --confirm ${digest}`, `Nothing was removed. To remove the run records, run the same command with --confirm ${digest}`);
    assert.equal(
      `${en["cleanup.next.confirm_discarded"]} --confirm ${digest} --delete-discarded`,
      `Nothing was removed. To delete the discarded files, run the same command with --confirm ${digest} --delete-discarded`,
    );
    assert.equal(`${en["cleanup.next.confirm_leftovers"]} --confirm ${digest}`, `Nothing was removed. To remove what earlier cleanups left, run the same command with --confirm ${digest}`);
    assert.equal(
      english.format("cleanup.next.not_reverted", { count: 1 }),
      "The records of 1 run(s) not reverted, only partly reverted, or whose records cannot be checked are kept unless you add --include-not-reverted yourself; once they are removed, those runs can no longer be reverted.",
    );
    assert.equal(en["cleanup.next.discarded"], "People's discarded files are deleted only with --delete-discarded besides.");
    assert.equal(
      english.format("cleanup.next.discarded_left", { count: 1 }),
      "The records of 1 apply run(s) whose discarded files are still kept stay unless those files are deleted in the same cleanup (--delete-discarded, with their folders selected) or the apply is reverted first; only the records say what the files were.",
    );
    // The kinds of item, as the item lines named them (`- run <id>: ...`).
    assert.deepEqual([en["cleanup.target.run"], en["cleanup.target.discarded"], en["cleanup.target.leftover"]], ["run", "discarded", "leftover"]);
  });

  test("the Korean names the kinds of item and the size in Korean", () => {
    const { ko } = MESSAGE_TEXTS;
    assert.deepEqual([ko["cleanup.target.run"], ko["cleanup.target.discarded"], ko["cleanup.target.leftover"]], ["실행 기록", "폐기 보관함", "남은 폴더"]);
    assert.equal(createMessageCatalog("ko").format("cleanup.size", { files: 4, bytes: 15392 }), "파일 4개, 15392바이트");
    assert.equal(ko["cleanup.nothing_removed"], "아무것도 지우지 않았습니다.");
  });

  test("in both languages the confirm lines say nothing was removed first, end leading into the options and name none", () => {
    for (const [language, t] of [["en", MESSAGE_TEXTS.en], ["ko", MESSAGE_TEXTS.ko]] as const) {
      for (const id of CONFIRMS) {
        assert.ok(t[id].startsWith(`${t["cleanup.nothing_removed"]} `), `${language} ${id}`);
        assert.ok(language === "en" ? t[id].endsWith(" run the same command with") : t[id].endsWith(" 다음을 붙여 다시 실행하세요:"), `${language} ${id}`);
        assert.ok(!/--|\{/.test(t[id]), `${language} ${id}`);
      }
      // The confirmations a person adds are fixed text; once removed, those runs cannot be reverted.
      assert.ok(t["cleanup.next.not_reverted"].includes("--include-not-reverted"), language);
      assert.ok(!t["cleanup.next.not_reverted"].includes("--confirm"), language);
      assert.match(t["cleanup.next.not_reverted"], language === "en" ? /can no longer be reverted\.$/ : /더는 되돌릴 수 없습니다\.$/);
      for (const id of ["cleanup.next.discarded", "cleanup.next.discarded_left"] as const) assert.ok(t[id].includes("--delete-discarded"), `${language} ${id}`);
    }
  });

  test("the Korean has no English word but the option names, and DR-50's 폐기 보관함 for the discarded files", () => {
    const { ko } = MESSAGE_TEXTS;
    const ids = [
      "cleanup.size",
      "cleanup.nothing_removed",
      ...CONFIRMS,
      "cleanup.next.not_reverted",
      "cleanup.next.discarded",
      "cleanup.next.discarded_left",
      "cleanup.target.run",
      "cleanup.target.discarded",
      "cleanup.target.leftover",
    ] as const;
    for (const id of ids) {
      const t = ko[id].replace(/--[a-z-]+/g, "").replace(/\{[a-zA-Z]+\}/g, "");
      assert.ok(HANGUL.test(t) && !/[A-Za-z]/.test(t), `ko ${id}`);
    }
    for (const id of ["cleanup.next.confirm_discarded", "cleanup.next.discarded", "cleanup.next.discarded_left", "cleanup.target.discarded"] as const) {
      assert.ok(ko[id].includes("폐기 보관함"), id);
    }
  });
});
