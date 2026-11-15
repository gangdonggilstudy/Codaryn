/**
 * R-28b L-1: a token's span has a bound. Where two neighbouring characters of a matched value are
 * more than MAX_MATCH_GAP UTF-16 units apart, the span is cut there and each piece is masked on its
 * own: every character of the value is still in a token, and the text between the pieces stays
 * visible to the model (5,000 Hangul characters between two halves of a key were all hidden). Fake
 * values only, built at run time; none is a credential.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { keyLettersAndDigits } from "../../../src/contracts/keys.js";
import type { PrivacyGateway } from "../../../src/contracts/privacy.js";
import { asRawText, PRIVACY_TOKEN_PATTERN_SOURCE } from "../../../src/contracts/text.js";
import { createPrivacyGateway, MAX_MATCH_GAP } from "../../../src/privacy/index.js";

const p = (...parts: string[]) => parts.join("");
const KEY = p("sk", "-ant-", "api03-", "Ab3dE_f9-hIjK1".repeat(10).slice(0, 91), "AA");
const cp = (code: number): string => String.fromCodePoint(code);
const TOKEN = new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g");
const HANGUL = "가";
const EMOJI = cp(0x1f600);

function counterRandom(): (size: number) => Uint8Array {
  let n = 0;
  return (size) => {
    const bytes = new Uint8Array(size);
    n += 1;
    bytes[size - 1] = n & 0xff;
    bytes[size - 2] = (n >> 8) & 0xff;
    return bytes;
  };
}

const gatewayFor = (secrets: readonly string[] = [KEY]): PrivacyGateway => createPrivacyGateway({ secrets, randomBytes: counterRandom() });

function maskOk(gateway: PrivacyGateway, text: string): string {
  const outcome = gateway.mask(text);
  assert.ok(outcome.ok, "masking succeeds");
  return outcome.text;
}

/** The key's letters and digits found in `text` in runs of 6 or more consecutive ones. */
function leaked(text: string, key = KEY): number {
  const have = keyLettersAndDigits(text);
  const skeleton = keyLettersAndDigits(key);
  const covered = new Uint8Array(skeleton.length);
  for (let start = 0; start + 6 <= skeleton.length; start += 1) {
    if (have.includes(skeleton.slice(start, start + 6))) covered.fill(1, start, start + 6);
  }
  return covered.reduce((sum, bit) => sum + bit, 0);
}

/** Every key character's position in the masked text is inside a token: none is left as text. */
function noKeyCharacterOutsideTokens(masked: string, key = KEY): void {
  const outside = masked.replace(TOKEN, "\u0000");
  assert.equal(leaked(outside, key), 0);
}

const tokens = (text: string): string[] => text.match(TOKEN) ?? [];
const withGap = (gap: string, at = 40, value = KEY): string => value.slice(0, at) + gap + value.slice(at);

function exactBack(gateway: PrivacyGateway, original: string): void {
  const masked = maskOk(gateway, original);
  const restored = gateway.resolveToolArgs({ args: { content: masked }, restoreFields: ["content"], documentFields: [] });
  assert.ok(restored.ok, JSON.stringify(restored));
  assert.equal(Buffer.compare(Buffer.from((restored.args as { content: string }).content, "utf8"), Buffer.from(original, "utf8")), 0);
  const doc = `first\n${original}\nlast\n`;
  const rebuilt = gateway.rebuildDocument({ original: asRawText(doc), maskedNext: maskOk(gateway, doc).replace("first", "FIRST") });
  assert.ok(rebuilt.ok, JSON.stringify(rebuilt));
  assert.equal(Buffer.compare(Buffer.from(rebuilt.text, "utf8"), Buffer.from(doc.replace("first", "FIRST"), "utf8")), 0);
}

describe(`R-28b L-1: a gap of more than ${MAX_MATCH_GAP} units cuts the span`, () => {
  test("the bound is 8 UTF-16 units", () => {
    assert.equal(MAX_MATCH_GAP, 8);
  });

  test("letters-and-digits pass: 8 Hangul between the pieces is one token, 9 is two, the 9 stay visible", () => {
    const eight = maskOk(gatewayFor(), `x ${withGap(HANGUL.repeat(8))} y`);
    assert.equal(tokens(eight).length, 1);
    assert.equal(eight.includes(HANGUL), false);
    const nine = maskOk(gatewayFor(), `x ${withGap(HANGUL.repeat(9))} y`);
    assert.equal(tokens(nine).length, 2);
    assert.ok(nine.includes(HANGUL.repeat(9)), nine);
    noKeyCharacterOutsideTokens(eight);
    noKeyCharacterOutsideTokens(nine);
    exactBack(gatewayFor(), `x ${withGap(HANGUL.repeat(8))} y`);
    exactBack(gatewayFor(), `x ${withGap(HANGUL.repeat(9))} y`);
  });

  test("counted in UTF-16 units: 4 emoji (8 units) are one token, 5 emoji (10 units) are two, no pair is cut", () => {
    const four = maskOk(gatewayFor(), withGap(EMOJI.repeat(4)));
    const five = maskOk(gatewayFor(), withGap(EMOJI.repeat(5)));
    assert.equal(tokens(four).length, 1);
    assert.equal(tokens(five).length, 2);
    assert.ok(five.includes(EMOJI.repeat(5)));
    for (const masked of [four, five]) assert.equal(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(masked), false);
    exactBack(gatewayFor(), withGap(EMOJI.repeat(5)));
  });

  test("separator pass: 8 line breaks between the pieces is one token, 9 keeps every line", () => {
    const original9 = `a\n${withGap("\n".repeat(9))}\nb`;
    const eight = maskOk(gatewayFor(), `a\n${withGap("\n".repeat(8))}\nb`);
    const nine = maskOk(gatewayFor(), original9);
    assert.equal(tokens(eight).length, 1);
    assert.equal(tokens(nine).length, 2);
    assert.equal(nine.split("\n").length, original9.split("\n").length, "the line structure stays");
    noKeyCharacterOutsideTokens(nine);
    exactBack(gatewayFor(), original9);
  });

  test("R-28b's case: 5,000 Hangul between two halves of a key leaves every Hangul character visible and no key character", () => {
    const original = `${KEY.slice(0, 40)}\n${HANGUL.repeat(5000)}\n${KEY.slice(40)}`;
    const masked = maskOk(gatewayFor(), original);
    assert.equal(tokens(masked).length, 2);
    assert.ok(masked.includes(HANGUL.repeat(5000)));
    assert.equal(masked.split("\n").length, 3);
    noKeyCharacterOutsideTokens(masked);
    exactBack(gatewayFor(), original);
  });

  test("a word-like key-like value in a Korean document shows the document between its pieces", () => {
    const original = `Summer ${HANGUL.repeat(300)} 2026Winter`;
    const masked = maskOk(gatewayFor(["Summer2026Winter"]), original);
    assert.equal(tokens(masked).length, 2);
    assert.ok(masked.includes(HANGUL.repeat(300)));
  });

  test("a key cut into many pieces: every character is still in a token, and the bytes come back", () => {
    let original = "";
    for (let at = 0; at < KEY.length; at += 10) original += KEY.slice(at, at + 10) + (at + 10 < KEY.length ? HANGUL.repeat(9) : "");
    const masked = maskOk(gatewayFor(), original);
    assert.equal(tokens(masked).length, Math.ceil(KEY.length / 10));
    noKeyCharacterOutsideTokens(masked);
    exactBack(gatewayFor(), original);
  });

  test("masking again is stable with cut spans", () => {
    const gateway = gatewayFor();
    const original = `a ${withGap(HANGUL.repeat(20))} b ${withGap("\n".repeat(12), 70)} c`;
    const first = maskOk(gateway, original);
    assert.equal(maskOk(gateway, first), first);
    assert.equal(maskOk(gateway, original), first);
  });
});
