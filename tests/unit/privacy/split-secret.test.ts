/**
 * DR-40 (a), R-25 M-1, the run's second defence: the gateway also masks a registered value split by
 * key separator characters (line breaks, white space, control and format characters, those outside
 * the Basic Multilingual Plane taken as whole code points). The masked span is the original one, so
 * restoring and rebuilding give back the exact bytes. Fake values only, built at run time; none is a
 * credential.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compactKeyText } from "../../../src/contracts/keys.js";
import type { PrivacyGateway } from "../../../src/contracts/privacy.js";
import { asRawText, PRIVACY_TOKEN_PATTERN_SOURCE } from "../../../src/contracts/text.js";
import { compactView, createPrivacyGateway, MIN_SPLIT_MATCH_LENGTH } from "../../../src/privacy/index.js";

const p = (...parts: string[]) => parts.join("");
/** 106 characters in a real key's format, as in the engine reproduction (tests/unit/engine/dr40-split-secret.test.ts). */
const KEY = p("sk", "-ant-", "api03-", "Ab3dE_f9-hIjK1".repeat(10).slice(0, 91), "AA");
const cp = (code: number): string => String.fromCodePoint(code);

/** Separators a person does not see, or sees only as a line break or a space. */
const MARKS: Record<string, string> = {
  "zero-width space": cp(0x200b),
  "line feed": "\n",
  "CR LF": "\r\n",
  "soft hyphen": cp(0xad),
  "no-break space": cp(0xa0),
  "word joiner": cp(0x2060),
  "byte order mark": cp(0xfeff),
  tab: "\t",
  "right-to-left mark": cp(0x200f),
  "language tag (outside the BMP)": cp(0xe0001),
  "musical begin beam (outside the BMP)": cp(0x1d173),
};

const TOKEN = new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g");

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

function gatewayFor(secrets: readonly string[] = [KEY]): PrivacyGateway {
  return createPrivacyGateway({ secrets, randomBytes: counterRandom() });
}

function maskOk(gateway: PrivacyGateway, text: string): string {
  const outcome = gateway.mask(text);
  assert.ok(outcome.ok, "masking succeeds");
  return outcome.text;
}

/** The key's characters found in `text` in runs of 6 or more consecutive ones, separators left out. */
function leaked(text: string, key = KEY): number {
  const compact = compactKeyText(text);
  const covered = new Uint8Array(key.length);
  for (let start = 0; start + 6 <= key.length; start += 1) {
    if (compact.includes(key.slice(start, start + 6))) covered.fill(1, start, start + 6);
  }
  return covered.reduce((sum, bit) => sum + bit, 0);
}

const tokens = (text: string): string[] => text.match(TOKEN) ?? [];
const splitAt = (value: string, at: number, mark: string): string => value.slice(0, at) + mark + value.slice(at);

describe("DR-40 (a): a split registered value is masked", () => {
  test("the measure counts a whole key, and the key as written is masked (control)", () => {
    assert.equal(KEY.length, 106);
    assert.equal(leaked(`a ${KEY} b`), 106);
    const masked = maskOk(gatewayFor(), `a ${KEY} b`);
    assert.equal(leaked(masked), 0);
    assert.equal(tokens(masked).length, 1);
  });

  for (const [name, mark] of Object.entries(MARKS)) {
    test(`split by a ${name}: no key character is left, one token, the text around kept`, () => {
      const gateway = gatewayFor();
      for (const text of [splitAt(KEY, 25, mark), splitAt(splitAt(KEY, 80, mark), 7, mark + mark)]) {
        const masked = maskOk(gateway, `before ${text} after`);
        assert.equal(leaked(masked), 0, JSON.stringify(masked));
        assert.equal(tokens(masked).length, 1);
        assert.ok(masked.startsWith("before ") && masked.endsWith(" after"), masked);
      }
    });
  }

  test("separators before and after the value stay outside its token", () => {
    const zw = MARKS["zero-width space"] as string;
    const masked = maskOk(gatewayFor(), `[${zw}\n${splitAt(KEY, 25, zw)}\n${zw}]`);
    assert.match(masked, new RegExp(`^\\[${zw}\\n${PRIVACY_TOKEN_PATTERN_SOURCE}\\n${zw}\\]$`, "u"));
  });

  test("a value split in many places at once is still one token", () => {
    const spaced = [...KEY].join(" ");
    const masked = maskOk(gatewayFor(), `x ${spaced} y`);
    assert.equal(leaked(masked), 0);
    assert.equal(tokens(masked).length, 1);
  });
});

describe("DR-40 (a): restoring and rebuilding give the exact bytes back", () => {
  test("resolveToolArgs restores a token over a split value to the original bytes, separators included", () => {
    for (const mark of Object.values(MARKS)) {
      const gateway = gatewayFor();
      const original = `key = ${splitAt(KEY, 25, mark)};`;
      const masked = maskOk(gateway, original);
      const outcome = gateway.resolveToolArgs({ args: { content: masked }, restoreFields: ["content"], documentFields: [] });
      assert.ok(outcome.ok, JSON.stringify(outcome));
      const restored = (outcome.args as { content: string }).content;
      assert.equal(Buffer.compare(Buffer.from(restored, "utf8"), Buffer.from(original, "utf8")), 0, JSON.stringify(mark));
    }
  });

  test("a value split by a line break is one protected line; edits elsewhere rebuild the exact bytes", () => {
    const gateway = gatewayFor();
    const original = `first\napi_key = ${KEY.slice(0, 40)}\n${KEY.slice(40, 70)}\r\n${KEY.slice(70)}\nlast\n`;
    const masked = maskOk(gateway, original);
    assert.equal(leaked(masked), 0);
    assert.equal(masked.split("\n").length, 4, "the line breaks inside the value are inside the token");
    const rebuilt = gateway.rebuildDocument({ original: asRawText(original), maskedNext: masked.replace("first", "FIRST").replace("last", "LAST") });
    assert.ok(rebuilt.ok, JSON.stringify(rebuilt));
    assert.equal(rebuilt.text, original.replace("first", "FIRST").replace("last", "LAST"));
  });

  test("changing the protected line, or splitting it, is refused", () => {
    const gateway = gatewayFor();
    const original = `first\napi_key = ${KEY.slice(0, 40)}\n${KEY.slice(40)}\nlast\n`;
    const masked = maskOk(gateway, original);
    for (const next of [masked.replace("api_key =", "key ="), masked.replace(TOKEN, (token) => `\n${token}`)]) {
      assert.deepEqual(gateway.rebuildDocument({ original: asRawText(original), maskedNext: next }), { ok: false, code: "protected_span_violation" });
    }
  });
});

describe("DR-40 (a): merging, stability and the length floor", () => {
  test("a split match that touches or overlaps another match becomes one token with it", () => {
    const zw = MARKS["zero-width space"] as string;
    // Touching: the key as written, then a split copy right after it.
    const touching = maskOk(gatewayFor(), `${KEY}${splitAt(KEY, 25, zw)}`);
    assert.equal(tokens(touching).length, 1);
    assert.equal(leaked(touching), 0);
    // Overlapping: a second secret that starts inside the split key's tail.
    const other = KEY.slice(60) + "ZqZqZqZqZqZqZqZq";
    const overlapping = maskOk(gatewayFor([KEY, other]), `a ${splitAt(KEY, 25, zw)}ZqZqZqZqZqZqZqZq b`);
    assert.equal(tokens(overlapping).length, 1);
    assert.equal(leaked(overlapping), 0);
    assert.equal(leaked(overlapping, other), 0);
  });

  test("masking again is stable: masked text stays as it is, and the same original gives the same token", () => {
    const gateway = gatewayFor();
    const original = `a ${splitAt(KEY, 25, "\n")} b ${splitAt(KEY, 60, MARKS["soft hyphen"] as string)} c`;
    const first = maskOk(gateway, original);
    assert.equal(tokens(first).length, 2, "two different splits are two tokens");
    assert.equal(maskOk(gateway, first), first);
    assert.equal(maskOk(gateway, original), first);
  });

  test(`the floor is ${MIN_SPLIT_MATCH_LENGTH} code points: a shorter value is matched only as written`, () => {
    const zw = MARKS["zero-width space"] as string;
    const short = "Q7q".repeat(5); // 15
    const long = `${short}Z`; // 16
    assert.equal(maskOk(gatewayFor([short]), `x ${splitAt(short, 7, zw)} y`), `x ${splitAt(short, 7, zw)} y`);
    assert.equal(tokens(maskOk(gatewayFor([short]), `x ${short} y`)).length, 1, "as written it is masked");
    assert.equal(leaked(maskOk(gatewayFor([long]), `x ${splitAt(long, 7, zw)} y`), long), 0);
    // Counted in code points: 15 plus one outside the BMP is 16 code points (17 UTF-16 units).
    const astral = `${short}${cp(0x1f511)}`;
    const shortAstral = `${short.slice(0, 14)}${cp(0x1f511)}`;
    assert.equal(tokens(maskOk(gatewayFor([astral]), `x ${splitAt(astral, 7, zw)} y`)).length, 1);
    assert.equal(tokens(maskOk(gatewayFor([shortAstral]), `x ${splitAt(shortAstral, 7, zw)} y`)).length, 0);
  });

  test("text without a registered value is left as it is, separators and all", () => {
    const text = `alpha​beta\ngamma­ delta ${cp(0xe0001)} sk-ant-design-system\ncomponents`;
    assert.equal(maskOk(gatewayFor(), text), text);
  });
});

describe("DR-40 (a): the compact view", () => {
  test("is compactKeyText, code point by code point, and maps each unit back to the text", () => {
    const samples = [
      "",
      KEY,
      splitAt(KEY, 25, "\r\n"),
      `a${cp(0xe0001)}b${cp(0x1f511)}c​d`,
      `lone ${String.fromCharCode(0xd83d)} surrogate­ end`,
      "\t \n  \u0085",
    ];
    for (const text of samples) {
      const view = compactView(text, 0, text.length);
      assert.equal(view.compact, compactKeyText(text), JSON.stringify(text));
      assert.equal(view.at.length, view.compact.length);
      view.at.forEach((index, unit) => assert.equal(text[index], view.compact[unit]));
    }
  });
});
