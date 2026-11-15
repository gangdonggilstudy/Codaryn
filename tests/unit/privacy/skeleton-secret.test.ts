/**
 * DR-42 (a) in the run's masking (R-28 I-3): a key-like registered value is also found in the
 * text's letters and digits alone, so a split by a character that is not a key separator (a
 * variation selector, the combining grapheme joiner, a Hangul filler, a braille blank, a lone
 * surrogate, visible punctuation) is masked too, the characters between included and restored to
 * the exact bytes. A value made of words (R-28 I-1) is not key-like, so ordinary text is masked no
 * more than before. Fake values only, built at run time; none is a credential.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { keyLettersAndDigits, keyLikeSkeleton } from "../../../src/contracts/keys.js";
import type { PrivacyGateway } from "../../../src/contracts/privacy.js";
import { asRawText, PRIVACY_TOKEN_PATTERN_SOURCE } from "../../../src/contracts/text.js";
import { createPrivacyGateway, skeletonView } from "../../../src/privacy/index.js";

const p = (...parts: string[]) => parts.join("");
/** 106 characters in a real key's format, as in tests/unit/privacy/split-secret.test.ts. */
const KEY = p("sk", "-ant-", "api03-", "Ab3dE_f9-hIjK1".repeat(10).slice(0, 91), "AA");
const cp = (code: number): string => String.fromCodePoint(code);
const TOKEN = new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g");

/** R-25b L-1 and R-28 I-3: characters that are not key separators but that a person does not see as a break. */
const NOT_SEPARATORS: Record<string, string> = {
  "variation selector 16": cp(0xfe0f),
  "combining grapheme joiner": cp(0x034f),
  "Hangul filler": cp(0x3164),
  "braille blank": cp(0x2800),
  "lone surrogate": String.fromCharCode(0xd800),
  "combining acute accent": cp(0x0301),
};

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

const tokens = (text: string): string[] => text.match(TOKEN) ?? [];
const splitAt = (value: string, at: number, mark: string): string => value.slice(0, at) + mark + value.slice(at);

function restoresExactly(gateway: PrivacyGateway, original: string): void {
  const masked = maskOk(gateway, original);
  const outcome = gateway.resolveToolArgs({ args: { content: masked }, restoreFields: ["content"], documentFields: [] });
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const restored = (outcome.args as { content: string }).content;
  assert.equal(Buffer.compare(Buffer.from(restored, "utf8"), Buffer.from(original, "utf8")), 0);
}

describe("DR-42 (a): a key split by a character that is not a separator is masked", () => {
  for (const [name, mark] of Object.entries(NOT_SEPARATORS)) {
    test(`split by a ${name}: no key character left, one token, restored and rebuilt to the exact bytes`, () => {
      const gateway = gatewayFor();
      const original = `key: ${splitAt(splitAt(KEY, 70, mark), 25, mark)} end`;
      const masked = maskOk(gateway, original);
      assert.equal(leaked(masked), 0, JSON.stringify(masked));
      assert.equal(tokens(masked).length, 1);
      assert.ok(masked.startsWith("key: ") && masked.endsWith(" end"), masked);
      restoresExactly(gatewayFor(), original);
      const doc = `first\n${original}\nlast\n`;
      const maskedDoc = maskOk(gateway, doc);
      const rebuilt = gateway.rebuildDocument({ original: asRawText(doc), maskedNext: maskedDoc.replace("first", "FIRST") });
      assert.ok(rebuilt.ok, JSON.stringify(rebuilt));
      assert.equal(rebuilt.text, doc.replace("first", "FIRST"));
    });
  }

  test("a key split by visible punctuation, as in source code concatenation, is one token with what is between", () => {
    const gateway = gatewayFor();
    const original = `const key = '${KEY.slice(0, 40)}' + '${KEY.slice(40)}';`;
    const masked = maskOk(gateway, original);
    assert.equal(leaked(masked), 0);
    assert.equal(tokens(masked).length, 1);
    assert.ok(masked.startsWith("const key = '") && masked.endsWith("';"), masked);
    restoresExactly(gatewayFor(), original);
  });

  test("a match overlapping a separator match merges into one token, and masking again is stable", () => {
    const gateway = gatewayFor();
    const original = `a ${splitAt(splitAt(KEY, 60, cp(0xfe0f)), 20, "​")} b ${splitAt(KEY, 50, cp(0x3164))} c`;
    const first = maskOk(gateway, original);
    assert.equal(tokens(first).length, 2);
    assert.equal(leaked(first), 0);
    assert.equal(maskOk(gateway, first), first);
    assert.equal(maskOk(gateway, original), first);
  });
});

describe("DR-42 (a): ordinary text is masked no more than before (R-28 I-1)", () => {
  // R-28 I-1's table: a value made of words, in text where its words are separated by spaces or
  // line breaks only. These were masked before this change (the separator pass) and still are.
  const I1: [string, string][] = [
    ["summer2026winter", "the summer 2026 winter schedule"],
    ["releasenotes2026", "see the release\nnotes 2026 draft"],
    ["My Awesome Application", "My  Awesome\nApplication is the title"],
    ["notapassword1234", "this is not a password 1234 times"],
    ["1234 5678 9012 3456", "1234\n5678\n9012\n3456"],
  ];
  // The same values in text where their words are joined only by visible punctuation, a hyphen or
  // another script: the separator pass left these alone, and so must the letters-and-digits pass.
  const JOINED: [string, string][] = [
    ["summer2026winter", "the summer, 2026 - winter schedule"],
    ["summer2026winter", "summer-2026-winter"],
    ["summer2026winter", "summer 캠프 2026 winter"],
    ["releasenotes2026", "release_notes (2026)"],
    ["My Awesome Application", "My, Awesome: Application"],
    ["notapassword1234", "not-a-password #1234"],
    ["1234 5678 9012 3456", "1234-5678-9012-3456"],
  ];

  test("the values of R-28 I-1 are not key-like", () => {
    for (const [value] of [...I1, ...JOINED]) assert.equal(keyLikeSkeleton(keyLettersAndDigits(value)), false, value);
  });

  test("text joined by spaces or line breaks only is masked as before (one token)", () => {
    for (const [value, text] of I1) assert.equal(tokens(maskOk(gatewayFor([value]), text)).length, 1, `${value} | ${text}`);
  });

  test("text joined by punctuation, a hyphen or another script is left as it is, as before", () => {
    for (const [value, text] of JOINED) assert.equal(maskOk(gatewayFor([value]), text), text, `${value} | ${text}`);
  });

  test("known and accepted: a word-like value that mixes cases with digits counts as key-like", () => {
    // `Summer2026Winter` has a digit and both cases, so it is looked for in letters and digits too
    // and joined across punctuation; random keys and passwords are the aim, and this value is
    // masked only where its letters and digits appear in this order.
    assert.equal(keyLikeSkeleton("Summer2026Winter"), true);
    assert.equal(tokens(maskOk(gatewayFor(["Summer2026Winter"]), "Summer, 2026 - Winter")).length, 1);
  });
});

describe("DR-42 (a): which values are looked for, and the view", () => {
  test("key-like: 16 letters and digits with a digit and both cases, or 32 with a digit and a letter", () => {
    assert.equal(keyLikeSkeleton("Q7q".repeat(5)), false, "15");
    assert.equal(keyLikeSkeleton(`${"Q7q".repeat(5)}Z`), true, "16");
    assert.equal(keyLikeSkeleton("ab12".repeat(8)), true, "32 single-case hex-like");
    assert.equal(keyLikeSkeleton(`${"ab12".repeat(7)}abc`), false, "31 single-case");
    assert.equal(keyLikeSkeleton("ABCDEFGHabcdefghij"), false, "no digit");
    const zw = cp(0xfe0f);
    const short = "Q7q".repeat(5);
    assert.equal(maskOk(gatewayFor([short]), `x ${splitAt(short, 7, zw)} y`), `x ${splitAt(short, 7, zw)} y`);
    assert.equal(tokens(maskOk(gatewayFor([`${short}Z`]), `x ${splitAt(`${short}Z`, 7, zw)} y`)).length, 1);
  });

  test("the view is keyLettersAndDigits and maps each letter or digit back to the text", () => {
    for (const text of ["", KEY, splitAt(KEY, 30, cp(0xfe0f)), `é${cp(0x1f511)}a-b_cㅤd${String.fromCharCode(0xd800)}9`]) {
      const view = skeletonView(text, 0, text.length);
      assert.equal(view.skeleton, keyLettersAndDigits(text), JSON.stringify(text));
      view.at.forEach((index, unit) => assert.equal(text[index], view.skeleton[unit]));
    }
  });
});

describe("DR-42 (a): masking time stays linear", () => {
  /** Ordinary text with punctuation, other scripts and odd characters, about `bytes` long, with split keys in it. */
  function corpus(bytes: number): string {
    const words = ["alpha,", "beta.", "gamma;", "델타", "epsilon-", "zeta_", `eta${cp(0xfe0f)}`, "theta​", "iota (2026)", "kappa\n"];
    const parts: string[] = [];
    let size = 0;
    for (let i = 0; size < bytes; i += 1) {
      const piece = i % 97 === 0 ? ` ${splitAt(KEY, 25 + (i % 50), cp(0x3164))} ` : `${words[i % words.length] as string} `;
      parts.push(piece);
      size += piece.length;
    }
    return parts.join("");
  }

  /** The same amount of text masked in pieces and at once; see assertLinear. */
  const PIECES = 64;
  /** The middle of 1 (linear) and PIECES (square) on a log scale. */
  const LINEAR_BOUND = 8;
  const ROUNDS = 5;

  /**
   * Linear time: masking a text once against masking a sixty-fourth of it sixty-four times, the same
   * amount of text, each with a new gateway. Linear work takes about as long either way (1.0 to 2.6
   * times measured for 1 MiB, the larger text's memory); square work takes sixty-four times as long
   * at once. So the bound sits at the middle on a log scale, eight, and the whole stays under 3 s.
   *
   * Load from other processes (R-34 bundle: 13.3 ms for 256 KiB against 138.9 ms for 1 MiB while
   * other workers' tests ran) only slows a measurement. Both sides take about as long and are timed
   * in turn ROUNDS times, so load reaches both alike, and the fastest of each is compared.
   *
   * 64 KiB is checked before 1 MiB, so a steep square fails in seconds instead of running for minutes.
   */
  function assertLinear(secrets: readonly string[], text: (bytes: number) => string): void {
    for (const whole of [64 * 1024, 1024 * 1024]) {
      const piece = text(whole / PIECES);
      const all = text(whole);
      let pieces = Number.POSITIVE_INFINITY;
      let once = Number.POSITIVE_INFINITY;
      for (let round = 0; round < ROUNDS; round += 1) {
        const gateways = Array.from({ length: PIECES }, () => gatewayFor(secrets));
        let started = performance.now();
        for (const gateway of gateways) maskOk(gateway, piece);
        pieces = Math.min(pieces, performance.now() - started);
        const gateway = gatewayFor(secrets);
        started = performance.now();
        maskOk(gateway, all);
        once = Math.min(once, performance.now() - started);
      }
      const kib = whole / 1024;
      const measured = `${kib} KiB at once ${once.toFixed(1)} ms, ${PIECES} x ${kib / PIECES} KiB ${pieces.toFixed(1)} ms`;
      assert.ok(once < LINEAR_BOUND * pieces && once < 3000, measured);
    }
  }

  test("1 MiB at once takes about as long as in 64 pieces, not 64 times as long, with key-like and word-like values registered", () => {
    const secrets = [KEY, `${"Q7q".repeat(10)}Z`, "ab12".repeat(10), "summer2026winter", "My Awesome Application"];
    assertLinear(secrets, corpus);
    // After the time check, so a square fails at 64 KiB before 1 MiB is masked here.
    const masked = maskOk(gatewayFor(secrets), corpus(1024 * 1024));
    assert.equal(leaked(masked), 0, "every split key in the corpus is masked");
  });

  test("a near-miss repeated through 1 MiB stays linear", () => {
    const value = `${"Q7q".repeat(10)}Z`;
    assertLinear([value], (bytes) => `${"Q7q-".repeat(Math.ceil(bytes / 4))}`.slice(0, bytes));
  });
});
