/**
 * U-86 (UXM-10, the rest of UXM-1; PM: nc-human's plan B): the cleanup preview is grouped by what a
 * person must give for an item to go, with one command for --confirm alone and one with every flag
 * some item needs; with nothing selected it says so and shows two examples. The groups replace
 * cleanup.confirm.* and cleanup.next.* (U-34) and keep their warnings, not one word weaker (PM).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMessageCatalog, MESSAGE_TEXTS } from "../../../src/i18n/index.js";

/** The warning sentences of the retired texts (main 819d839), each of which a group keeps as it was. */
const KEPT_WARNINGS = {
  en: {
    "cleanup.group.include_not_reverted": [
      // cleanup.confirm.not_reverted
      "runs not reverted, only partly reverted, or whose records cannot be checked",
      "Their records go only with a confirmation of their own; without them those runs can no longer be reverted or put back by hand.",
    ],
    // cleanup.confirm.discarded
    "cleanup.group.delete_discarded": ["They are people's own files and cannot be put back."],
    // cleanup.next.discarded_left
    "cleanup.group.kept": ["deleted in the same cleanup", "or the apply is reverted first; only the records say what the files were."],
  },
  ko: {
    "cleanup.group.include_not_reverted": [
      "되돌리지 않았거나, 일부만 되돌렸거나, 기록을 확인할 수 없는 실행",
      "이 기록은 따로 확인해야 지우며, 지우면 그 실행을 더는 되돌릴 수 없고 손으로 되살릴 수도 없습니다.",
    ],
    "cleanup.group.delete_discarded": ["사람의 파일이며 되살릴 수 없습니다."],
    "cleanup.group.kept": ["같은 정리에서", "그 적용을 먼저 되돌리면", "그 파일이 무엇이었는지는 이 기록에만 있습니다."],
  },
} as const;

const LANGUAGES = ["en", "ko"] as const;
const GROUPS = ["cleanup.group.confirm", "cleanup.group.include_not_reverted", "cleanup.group.delete_discarded", "cleanup.group.kept"] as const;
const COMMANDS = ["cleanup.command.confirm", "cleanup.command.all"] as const;

describe("U-86: the cleanup preview grouped by what must be given", () => {
  test("the groups keep the warnings of the texts they replace, word for word", () => {
    for (const language of LANGUAGES) {
      for (const [id, sentences] of Object.entries(KEPT_WARNINGS[language])) {
        const text = MESSAGE_TEXTS[language][id as (typeof GROUPS)[number]];
        for (const sentence of sentences) assert.ok(text.includes(sentence), `${language} ${id}: ${sentence}`);
      }
    }
  });

  test("each group names what must be given, and none asks", () => {
    for (const language of LANGUAGES) {
      const t = MESSAGE_TEXTS[language];
      assert.ok(t["cleanup.group.confirm"].includes("--confirm"), language);
      assert.ok(t["cleanup.group.include_not_reverted"].includes("--include-not-reverted"), language);
      assert.ok(t["cleanup.group.delete_discarded"].includes("--delete-discarded"), language);
      // The kept group: no confirmation removes them in this selection.
      assert.match(t["cleanup.group.kept"], language === "en" ? /^Kept in this selection, whatever is confirmed: \{count\}\./ : /^이 선택에서는 무엇을 확인해도 남는 것: \{count\}개\./);
      for (const id of GROUPS) assert.ok(!/\?|까요|습니까/.test(t[id]), `${language} ${id}`);
    }
    const en = createMessageCatalog("en");
    assert.equal(en.format("cleanup.group.confirm", { count: 3, bytes: 4096 }), "Removed with --confirm alone: 3 (4096 bytes)");
    assert.ok(en.format("cleanup.group.delete_discarded", { count: 1, files: 2, bytes: 30 }).startsWith("Deleted only with --delete-discarded besides: 1 discarded-files folder(s), 2 file(s) (30 bytes)."));
  });

  test("the two commands say nothing was removed and lead into the options, which the renderer adds", () => {
    for (const language of LANGUAGES) {
      const t = MESSAGE_TEXTS[language];
      for (const id of COMMANDS) {
        assert.ok(t[id].startsWith(`${t["cleanup.nothing_removed"]} `), `${language} ${id}`);
        assert.ok(language === "en" ? t[id].endsWith(" run the same command with") : t[id].endsWith(" 다음을 붙여 다시 실행하세요:"), `${language} ${id}`);
        assert.ok(!/--|\{/.test(t[id]), `${language} ${id}: no option and no value in the text`);
      }
      assert.notEqual(t["cleanup.command.confirm"], t["cleanup.command.all"], language);
    }
  });

  test("with nothing selected: it says so, and the two examples end with a command to copy", () => {
    for (const language of LANGUAGES) {
      const t = MESSAGE_TEXTS[language];
      assert.match(t["cleanup.no_selection"], language === "en" ? /nothing is selected/ : /아무것도 고르지 않았습니다/);
    }
    for (const [id, option] of [["cleanup.example.older_than", "--older-than 30"], ["cleanup.example.reverted", "--reverted"]] as const) {
      const commands = LANGUAGES.map((language) => MESSAGE_TEXTS[language][id].split(": ").at(-1));
      // The same command in both languages, after the description.
      assert.deepEqual(commands, [`codaryn cleanup --workspace <workspace> ${option}`, `codaryn cleanup --workspace <workspace> ${option}`], id);
    }
  });

  test("the summary counts the discarded-files folders whose run has no records left, and says no revert can put them back", () => {
    assert.match(MESSAGE_TEXTS.en["cleanup.summary.discarded_without_records"], /: \{count\} \(\{bytes\} bytes\)\. No revert can put those files back\.$/);
    assert.match(MESSAGE_TEXTS.ko["cleanup.summary.discarded_without_records"], /: \{count\}개\(\{bytes\}바이트\)\. 어떤 되돌리기로도 그 파일을 제자리에 돌려놓을 수 없습니다\.$/);
  });
});
