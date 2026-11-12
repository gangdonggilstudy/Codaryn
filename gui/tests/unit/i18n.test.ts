/** GU-2: the GUI's two-language text frame (src/renderer/i18n), without a DOM. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { REPLACEMENT, cleanValue, errorText, placeholders, textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import type { TextId } from "../../src/renderer/i18n/ko.js";

const HANGUL = /[가-힣]/;

test("i18n: both languages have the same ids and the same placeholders in each text", () => {
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(KO).sort());
  for (const id of Object.keys(KO) as TextId[]) {
    assert.deepEqual(placeholders(EN[id]).sort(), placeholders(KO[id]).sort(), id);
  }
});

test("i18n: texts are one clean line without markup; Korean texts are Korean and English ones have no Hangul", () => {
  const latinOnly = new Set<TextId>(["app.title", "home.openShortcut", "error.code"]);
  for (const id of Object.keys(KO) as TextId[]) {
    for (const [language, text] of [["ko", KO[id]], ["en", EN[id]]] as const) {
      assert.equal(cleanValue(text), text, `${language} ${id} has no control characters`);
      assert.doesNotMatch(text, /[<>]|&[a-z]+;/, `${language} ${id} has no markup`);
      assert.ok(text.trim().length > 0, `${language} ${id} is not empty`);
    }
    assert.doesNotMatch(EN[id], HANGUL, `en ${id}`);
    if (!latinOnly.has(id)) assert.match(KO[id], HANGUL, `ko ${id}`);
  }
});

test("i18n: no text claims protection Codaryn does not give (M-8)", () => {
  for (const text of [...Object.values(KO), ...Object.values(EN)]) {
    assert.doesNotMatch(text, /안전합니다|차단합니다|샌드박스|\bsafe\b|\bsecure\b|\bsandbox/i, text);
  }
});

test("i18n: values are cleaned and cannot add a line or turn the text around", () => {
  const ko = textsFor("ko");
  assert.equal(ko.format("status.workspace", { name: "notes" }), "작업 공간: notes");
  assert.equal(ko.format("tree.more", { count: 12 }), "12개 더 보기");
  const evil = `a\nb\r c‮d\u0007e`;
  const shown = ko.format("status.workspace", { name: evil });
  assert.equal(shown, `작업 공간: a${REPLACEMENT}b${REPLACEMENT}${REPLACEMENT}c${REPLACEMENT}d${REPLACEMENT}e`);
  assert.equal(ko.format("status.workspace"), `작업 공간: ${REPLACEMENT}`, "a missing value shows as ?");
  assert.equal(ko.format("status.workspace", { name: "{code}" }), "작업 공간: {code}", "a value is not formatted again");
});

test("i18n: error texts by code, with a default for unknown codes", () => {
  const en = textsFor("en");
  assert.match(errorText(en, "node_too_old"), /Node 26/);
  assert.equal(errorText(en, "no_such_code"), en.format("error.default"));
  assert.equal(errorText(en, "__proto__"), en.format("error.default"));
  assert.equal(en.has("error.node_not_found"), true);
  assert.equal(en.has("toString"), false);
});
