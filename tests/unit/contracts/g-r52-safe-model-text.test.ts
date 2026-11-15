/**
 * R-52 (U-21, R52-M1, R52-M2): safeModelText, the one order for model text shown to people:
 * control and invisible characters out first, then masked by the run's gateway, then key shapes
 * hidden also across LF and TAB. Masking that fails shows nothing.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { HIDDEN_KEY_MARKER, safeModelText } from "../../../src/contracts/index.js";
import type { MaskedText, MaskOutcome } from "../../../src/contracts/index.js";

const TOKEN = "[[CODARYN_SECRET:00000000000000aa]]";
/** Masks one short value exactly, as the gateway does for a value under 16 code points. */
const exact =
  (value: string) =>
  (text: string): MaskOutcome => ({ ok: true, text: text.split(value).join(TOKEN) as MaskedText });
const KEY = ["sk", "ant", "api03", "Xy7".repeat(14)].join("-");
const ZWSP = String.fromCodePoint(0x200b);

describe("R-52: safeModelText", () => {
  test("R52-M1: an invisible character is left out before masking, so the value it split is masked", () => {
    assert.equal(safeModelText(`is R52${ZWSP}pass.`, exact("R52pass")), `is ${TOKEN}.`);
  });

  test("R52-M2: a key split by LF or TAB is hidden whole; line breaks elsewhere stay", () => {
    assert.equal(safeModelText(`a\n${KEY.slice(0, 12)}\n${KEY.slice(12)} b`, exact("unused")), `a\n${HIDDEN_KEY_MARKER} b`);
    assert.equal(safeModelText(`${KEY.slice(0, 12)}\r\n${KEY.slice(12)}`, exact("unused")), HIDDEN_KEY_MARKER);
  });

  test("a word right after a key across LF or TAB is hidden with it: it cannot be told from the key's rest", () => {
    assert.equal(safeModelText(`${KEY}\tb`, exact("unused")), HIDDEN_KEY_MARKER);
  });

  test("a word after a key stays: visible white space is not skipped", () => {
    assert.equal(safeModelText(`key ${KEY} and it works`, exact("unused")), `key ${HIDDEN_KEY_MARKER} and it works`);
  });

  test("masking that fails shows nothing (fail closed)", () => {
    assert.equal(safeModelText("anything", () => ({ ok: false, code: "masking_failed" })), null);
  });
});
