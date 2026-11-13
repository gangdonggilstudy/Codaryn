/**
 * U-74 (DR-3, DR-10): the in-run permission question. The question tells that only the command's
 * executable and the number of its arguments are shown (ConfirmRequest has no argument text) and
 * that no answer means no (the default is deny). The renderer puts the masked executable after it
 * and then prompt.yes_no_default_no. One progress line follows: allowed for this call once, or
 * denied by whom (CONFIRMATION_BY). denial.confirmation_required names the code's refusal.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CONFIRMATION_BY } from "../../../src/contracts/index.js";
import { createMessageCatalog, MESSAGE_TEXTS, PLACEHOLDER } from "../../../src/i18n/index.js";

const LANGUAGES = ["en", "ko"] as const;
const placeholders = (text: string): string[] => [...text.matchAll(PLACEHOLDER)].map((match) => match[1] as string);

describe("U-74: the permission question and what follows it", () => {
  test("the question shows only the executable and the argument count, and says no answer means no", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.match(en["confirm.question.command"], /Only its executable and its number of arguments \(\{count\}\) are shown, not the arguments themselves\./);
    assert.match(ko["confirm.question.command"], /보이는 것은 실행 파일 이름과 인자 개수\(\{count\}개\)뿐이며, 인자 자체는 보이지 않습니다\./);
    assert.match(en["confirm.question.command"], /With no answer it is denied\./);
    assert.match(ko["confirm.question.command"], /답하지 않으면 거부합니다\./);
    for (const language of LANGUAGES) {
      const text = MESSAGE_TEXTS[language]["confirm.question.command"];
      assert.deepEqual(placeholders(text), ["count"], language);
      assert.ok(text.includes("?"), `${language}: it asks`);
      // It ends with the label the renderer puts the executable after; the [y/N] is the prompt's.
      assert.ok(text.endsWith(language === "en" ? " Executable" : " 실행 파일"), language);
      assert.ok(!/\[y\/N\]|[:\s]$/.test(text), language);
    }
  });

  test("as a person reads it: the question, the executable, then the prompt that says the default", () => {
    const ko = createMessageCatalog("ko");
    const line = `${ko.format("confirm.question.command", { count: 2 })}: npm ${ko.format("prompt.yes_no_default_no")}`;
    assert.ok(line.endsWith("인자 자체는 보이지 않습니다. 실행 파일: npm [y/N] (y·예·네: 예, Enter: 아니오)"), line);
  });

  test("one progress line after it: allowed for this call once, or denied by whom", () => {
    for (const language of LANGUAGES) {
      const t = MESSAGE_TEXTS[language];
      const lead = language === "en" ? "permission question — " : "권한 확인 — ";
      const ids = ["progress.confirmation_allowed", ...CONFIRMATION_BY.map((by) => `progress.confirmation_denied.${by}` as const)] as const;
      for (const id of ids) {
        assert.ok(t[id].startsWith(lead), `${language} ${id}`);
        assert.deepEqual(placeholders(t[id]), [], `${language} ${id}`);
      }
      // There is no "always": the answer is for this one call.
      assert.match(t["progress.confirmation_allowed"], language === "en" ? /for this call only$/ : /이번 호출에만 허용함$/);
      assert.match(t["progress.confirmation_denied.user"], language === "en" ? /denied by the person$/ : /사람이 거부함$/);
      assert.match(t["progress.confirmation_denied.default"], language === "en" ? /denied by default/ : /기본값으로 거부함/);
      assert.match(t["progress.confirmation_denied.cancelled"], language === "en" ? /cancelled/ : /취소/);
    }
  });

  test("the refusal word is a short phrase like the other denial words", () => {
    for (const language of LANGUAGES) {
      const text = MESSAGE_TEXTS[language]["denial.confirmation_required"];
      assert.deepEqual(placeholders(text), [], language);
      assert.ok(!text.endsWith(".") && text.length < 60, `${language}: ${text}`);
    }
    assert.equal(MESSAGE_TEXTS.en["denial.confirmation_required"], "not allowed by the person during the run");
    assert.equal(MESSAGE_TEXTS.ko["denial.confirmation_required"], "실행 중 사람이 허용하지 않음");
  });
});
