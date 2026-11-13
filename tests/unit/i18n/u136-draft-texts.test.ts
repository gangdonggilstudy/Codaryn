/**
 * U-136 (PM): the drafts other owners wrote into the catalog, made final. A changed line fits 100
 * columns as shown (ux-design 8: about 100; a Korean letter takes two columns), with its prefix and
 * long sample values; both languages say the same; no Korean particle that changes with the last
 * sound comes right after an option name. Texts pinned by other owners' tests or by docs/usage.md
 * were left as they are (the unit's report lists them).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { API_KEY_ENVS, messageParams } from "../../../src/contracts/index.js";
import type { MessageId } from "../../../src/contracts/index.js";
import { createMessageCatalog, MESSAGE_TEXTS, PLACEHOLDER } from "../../../src/i18n/index.js";

const LANGUAGES = ["en", "ko"] as const;
const placeholders = (text: string): string[] => [...text.matchAll(PLACEHOLDER)].map((match) => match[1] as string).sort();
const wide = (code: number): boolean =>
  (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xff60);
const columns = (line: string): number => [...line].reduce((sum, char) => sum + (wide(char.codePointAt(0) ?? 0) ? 2 : 1), 0);

/** Each changed text, with the prefix the CLI puts before it (output.ts, doctor.ts, cleanup.ts, help.ts). */
const SHOWN: ReadonlyArray<readonly [MessageId, { readonly en: string; readonly ko: string }]> = [
  ["summary.confirm_denied.user", { en: "", ko: "" }],
  ["summary.confirm_denied.unasked", { en: "", ko: "" }],
  ["summary.confirm_denied.unanswered", { en: "", ko: "" }],
  ["summary.confirm_denied.cancelled", { en: "", ko: "" }],
  ["progress.confirmation_denied.default", { en: "codaryn: ", ko: "codaryn: " }],
  ["doctor.next.key", { en: "  1. ", ko: "  1. " }],
  ["doctor.next.other", { en: "  1. ", ko: "  1. " }],
  ["error.hint.config_missing", { en: "  To fix: ", ko: "  고치는 법: " }],
  ["help.summary.doctor", { en: "  doctor   ", ko: "  doctor   " }],
  ["cleanup.summary.discarded_without_records", { en: "", ko: "" }],
  ["cleanup.no_selection", { en: "", ko: "" }],
];
const KO_ONLY: readonly MessageId[] = ["help.more"];

describe("U-136: the drafted texts, final", () => {
  test("each changed line fits 100 columns with its prefix and long values, for every key variable", () => {
    for (const language of LANGUAGES) {
      const catalog = createMessageCatalog(language);
      for (const [id, prefix] of SHOWN) {
        for (const keyEnv of API_KEY_ENVS) {
          const values: Record<string, unknown> = { count: 12, bytes: 1234567, files: 34, keyEnv };
          const params = Object.fromEntries(Object.keys(messageParams(id)).map((name) => [name, values[name]]));
          const line = `${prefix[language]}${(catalog.format as unknown as (id: MessageId, params: Record<string, unknown>) => string)(id, params)}`;
          assert.ok(columns(line) <= 100, `${language} ${id}: ${columns(line)} columns: ${line}`);
        }
      }
    }
    for (const id of KO_ONLY) assert.ok(columns(MESSAGE_TEXTS.ko[id]) <= 100, id);
  });

  test("both languages take the same values", () => {
    for (const [id] of SHOWN) assert.deepEqual(placeholders(MESSAGE_TEXTS.ko[id]), placeholders(MESSAGE_TEXTS.en[id]), id);
  });

  test("the four end-summary lines after a permission question say who decided, in both languages", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.match(en["summary.confirm_denied.user"], /^Denied by the person: \{count\} call\(s\) whose rule asks first\.$/);
    assert.match(ko["summary.confirm_denied.user"], /사람이 거부했습니다\.$/);
    // Not asked: not at a terminal, or --quiet (docs/cli-contract.md 18.17).
    assert.match(en["summary.confirm_denied.unasked"], /^Denied without asking: .*\(not at a terminal, or --quiet\)\.$/);
    assert.match(ko["summary.confirm_denied.unasked"], /묻지 않고 거부했습니다\(터미널이 아니거나 --quiet 옵션을 줌\)\.$/);
    // No answer: the input ended or the time limit came (Ctrl+C cancels the run instead).
    assert.match(en["summary.confirm_denied.unanswered"], /^Denied with no answer: .*\(the input ended or time ran out\)\.$/);
    assert.match(ko["summary.confirm_denied.unanswered"], /답이 없어 거부했습니다\(입력이 끝났거나 시간 한도에 닿음\)\.$/);
    assert.match(en["summary.confirm_denied.cancelled"], /^Denied because the run was cancelled while it waited: /);
    // R-88 T3: the calls are the subject, so the verb is passive.
    assert.match(ko["summary.confirm_denied.cancelled"], /실행이 취소되어 거부되었습니다\.$/);
    for (const language of LANGUAGES) {
      const lines = (["user", "unasked", "unanswered", "cancelled"] as const).map((by) => MESSAGE_TEXTS[language][`summary.confirm_denied.${by}`]);
      if (language === "ko") for (const line of lines) assert.ok(line.startsWith("확인을 받게 된 명령의 호출 {count}건"), line);
      else for (const line of lines) assert.ok(line.includes("{count} call(s) whose rule asks first"), line);
    }
  });

  test("the default denial's progress line names its three causes", () => {
    assert.equal(MESSAGE_TEXTS.en["progress.confirmation_denied.default"], "permission question — denied by default (no answer, could not ask, or time ran out)");
    assert.equal(MESSAGE_TEXTS.ko["progress.confirmation_denied.default"], "권한 확인 — 기본값으로 거부함(답이 없었거나, 물을 수 없었거나, 시간 한도에 닿음)");
  });

  test("R-88 T1: no particle that changes with the last sound right after an option name", () => {
    for (const text of Object.values(MESSAGE_TEXTS.ko)) {
      for (const option of ["--quiet"]) assert.ok(!new RegExp(`${option}(이|가|을|를|은|는|으로)(?![a-z-])`).test(text), text);
    }
  });

  test("doctor's next steps: the key line asks for a new terminal; Korean steps ask, as the English do", () => {
    // U-132 (main) chose "the line above" in English; the Korean says the same.
    assert.match(MESSAGE_TEXTS.en["doctor.next.key"], /^Register the key: set \{keyEnv\} as the line above says, then open a new terminal$/);
    // The variable's name is followed by a word, not by a particle chosen for its last sound.
    assert.equal(MESSAGE_TEXTS.ko["doctor.next.key"], "키 등록: 위 줄의 안내대로 {keyEnv} 환경 변수를 등록하고 새 터미널을 여세요");
    assert.equal(MESSAGE_TEXTS.ko["doctor.next.other"], "그 밖의 실패한 점검 {count}개: 각 줄의 안내대로 고치세요");
  });

  test("Korean wording: no repeated clause, each command's help, network access", () => {
    assert.equal(MESSAGE_TEXTS.ko["error.hint.config_missing"], "설정 파일이 아직 없습니다(기본 위치에 없음). codaryn init으로 만드세요.");
    assert.ok(MESSAGE_TEXTS.ko["help.more"].startsWith("각 명령의 옵션과 사용법: "));
    assert.equal(MESSAGE_TEXTS.ko["help.summary.doctor"], "실행에 필요한 것을 점검합니다(네트워크 접속 없음)");
  });

  test("cleanup: the folders without run records, and the empty selection, said shorter", () => {
    assert.equal(MESSAGE_TEXTS.en["cleanup.summary.discarded_without_records"], "Discarded-files folders with no run records: {count} ({bytes} bytes). No revert can put those files back.");
    assert.equal(MESSAGE_TEXTS.ko["cleanup.summary.discarded_without_records"], "실행 기록이 없는 폐기 보관함 폴더: {count}개({bytes}바이트). 어떤 되돌리기로도 되살릴 수 없습니다.");
    assert.equal(MESSAGE_TEXTS.en["cleanup.no_selection"], "No selection option was given, so nothing is selected. Preview with a selection, for example:");
    assert.equal(MESSAGE_TEXTS.ko["cleanup.no_selection"], "고르는 옵션을 주지 않아 아무것도 고르지 않았습니다. 고르는 옵션을 주어 미리 보세요. 예:");
  });
});
