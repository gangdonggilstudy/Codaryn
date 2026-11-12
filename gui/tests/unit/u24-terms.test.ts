/**
 * U-24 (DR-50, UXM-16): one word for one thing in what people read in the window and in the main
 * process's dialogs, the same words as the shared catalog. Korean: 동작, 폐기 보관함, 작업 종류,
 * 다이제스트, 가릴 값, 보호 경로 (the check afterwards: 보호 대상 확인, its paths 보호 대상 경로);
 * English: task type, discarded files. Option names (--workflow, --digest), field names and
 * placeholders stay as they are.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { DIALOG_TEXTS, WIDENING_KINDS, widenText } from "../../src/main/dialog-texts.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";

const withoutNames = (text: string): string =>
  text
    .replace(/--[a-z-]+/g, "")
    .replace(/\{[A-Za-z]+\}/g, "")
    .replace(/\b(secretEnv|policy\.planActions|protectedPaths)\b/g, "");

const catalogs = (language: "ko" | "en"): [string, string][] => [
  ...Object.entries(language === "ko" ? KO : EN).map(([id, text]): [string, string] => [`window ${id}`, text]),
  ...Object.entries(DIALOG_TEXTS[language]).map(([id, text]): [string, string] => [`dialog ${id}`, text]),
  ...WIDENING_KINDS.map((kind): [string, string] => [`widening ${kind}`, widenText(language, kind, "f")]),
];

test("U-24 (DR-50): the Korean texts use 동작, 폐기 보관함, 작업 종류, 다이제스트 and 가릴 값", () => {
  for (const [id, text] of catalogs("ko")) {
    const t = withoutNames(text);
    assert.doesNotMatch(t, /행동|워크플로|workflow|digest|비밀|무결성/, `ko ${id}`);
    assert.equal((t.match(/보관함/g) ?? []).length, (t.match(/폐기 보관함/g) ?? []).length, `ko ${id}: 폐기 보관함, never 보관함 alone`);
  }
});

test("U-24 (DR-50): the English texts use task type and discarded files", () => {
  for (const [id, text] of catalogs("en")) {
    assert.doesNotMatch(withoutNames(text), /workflow|task kind|discard box|run archive/i, `en ${id}`);
  }
});
