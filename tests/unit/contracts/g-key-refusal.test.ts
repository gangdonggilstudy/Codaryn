/**
 * DR-40 (R-25): the S-6 and S-8 key check of the contract (keys.ts). Every input is built at run
 * time; none is a credential. The reviewer's reproduction inputs are kept as regression cases.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ANTHROPIC_KEY_FORMAT_PATTERN_SOURCE,
  ANTHROPIC_KEY_REFUSAL_PATTERN_SOURCE,
  API_KEY_PATTERN_SOURCES,
  anthropicRefusalShapeIn,
  compactKeyText,
  createKeyRefusalCheck,
  createKeyValueCheck,
  holdsRefusedKeyShape,
  keyLettersAndDigits,
  keyLikeSkeleton,
} from "../../../src/contracts/index.js";

const p = (...parts: string[]) => parts.join("");
const PREFIX = p("sk", "-ant-");
const LF = String.fromCharCode(10);
/** Real length: a type and version, then a 93-character body ending in AA (106 characters in all). */
const body = (seed: string) => seed.repeat(10).slice(0, 91) + "AA";
const KEY = p(PREFIX, "api03-", body("Ab3dE_f9-hIjK1"));
const OTHER = p(PREFIX, "api03-", body("Zy8xW-v7_uTs6R"));

/** R-20 F, as in g-provider-table: refused by no shape. */
const R20_ORDINARY: readonly string[] = [
  p("sk", "-learn-pipeline-for-customer-churn-model-v2"),
  p("sk", "-feature-branch-add-payment-gateway-integration"),
  p("sk", "-0f8fad5b-d9cb-469f-a165-70867728950e"),
  p("release/", "sk", "-dashboard-components-and-layout-helpers-v3"),
  p("my-task-", "sk", "-", "abcdefghijklmnopq".repeat(2)),
  p("sk", "-cube-grid-animation-container-wrapper-large"),
  p("docs/", "sk", "-telecom-network-migration-runbook-final"),
  p("sk", "-ant-", "design-system"),
  p("sk", "-learn"),
  "risk-assessment-for-the-quarter-and-the-next-one",
  p("sk", "_live_", "a".repeat(40)),
  p("SK", "-HYNIX-memory-division-quarterly-report-2026"),
  p("sk", "-ant-", "design-system-components-and-layout-helpers"),
  p("ri", "sk", "-ant-", "colony-simulation-model-2024-final-version"),
];

const timed = (run: () => boolean) => {
  const started = performance.now();
  const result = run();
  return { result, ms: performance.now() - started };
};

describe("DR-40 (c), R-25 L-2: the narrowed Anthropic shape in linear time, same answers", () => {
  test("the same answer as the regular expression on random text over the characters that matter", () => {
    const shape = new RegExp(ANTHROPIC_KEY_REFUSAL_PATTERN_SOURCE);
    const alphabet = ["s", "k", "-", "a", "n", "t", "1", "x", "_", " ", "\n", "r", "i", PREFIX, PREFIX, "9"];
    let seed = 12345;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let refused = 0;
    for (let n = 0; n < 100_000; n += 1) {
      let text = "";
      const length = 1 + Math.floor(random() * 30);
      for (let i = 0; i < length; i += 1) text += alphabet[Math.floor(random() * alphabet.length)];
      if (random() < 0.5) text += "x".repeat(Math.floor(random() * 40));
      const expected = shape.test(text);
      if (expected) refused += 1;
      assert.equal(anthropicRefusalShapeIn(text), expected, JSON.stringify(text));
    }
    assert.ok(refused > 1000, "the sample holds refused texts too");
  });

  test("256 KiB of repeated prefixes and of other key-like runs: linear (the regular expression took seconds)", () => {
    const size = 256 * 1024;
    const attacks = [PREFIX, p("sk", "-proj-"), p("sk", "-"), p(PREFIX, "api03-"), "sk-A"].map((piece) => piece.repeat(Math.ceil(size / piece.length)));
    for (const attack of attacks) {
      const { ms } = timed(() => holdsRefusedKeyShape(attack));
      assert.ok(ms < 500, `${attack.slice(0, 12)}...: ${ms.toFixed(0)} ms`);
    }
  });

  test("real-length keys are refused; R-20's ordinary names are not", () => {
    assert.equal(KEY.length, 106);
    assert.ok(holdsRefusedKeyShape(KEY));
    assert.ok(holdsRefusedKeyShape(`key: ${KEY}\n`));
    for (const name of R20_ORDINARY) assert.equal(holdsRefusedKeyShape(name), false, name);
  });

  test("the check: a registered value anywhere, or a refusal shape", () => {
    assert.ok(createKeyRefusalCheck([OTHER])(`x${OTHER}`), "a registered value glued to a letter");
    assert.ok(createKeyRefusalCheck([])(KEY));
    assert.equal(createKeyRefusalCheck(["", OTHER])("plain text"), false, "an empty value is ignored");
  });
});

describe("DR-40 (b), R-25 L-1: a real-format key glued to what comes before it is refused", () => {
  const ADMIN = p(PREFIX, "admin01-", body("Qq1-wW2_eE3rR4"));
  const OAT = p(PREFIX, "oat01-", body("Ww2_eE3-rR4tT5"));

  test("A4, A6: glued to a letter or to MY_, another key registered", () => {
    const check = createKeyRefusalCheck([OTHER]);
    assert.ok(check(`x${KEY}`), "A4");
    assert.ok(check(`MY_${KEY}`), "A6");
  });

  test("A9, A11: none registered, glued to a letter or after a literal backslash-n", () => {
    const check = createKeyRefusalCheck([]);
    assert.ok(check(`x${ADMIN}`), "A9");
    assert.ok(check(p("line", String.fromCharCode(92), "n", KEY)), "A11: a backslash and n as two characters");
    assert.ok(check(`id9${OAT}`), "after a digit, another type");
  });

  test("the format branch alone: the prefix, 2 to 8 lower-case letters, 2 digits, a hyphen, 32 or more", () => {
    const format = new RegExp(ANTHROPIC_KEY_FORMAT_PATTERN_SOURCE);
    assert.ok(format.test(`x${KEY}`));
    assert.ok(format.test(p(PREFIX, "ab12-", "a".repeat(32))), "32 after the version");
    assert.equal(format.test(p(PREFIX, "ab12-", "a".repeat(31))), false, "31");
    assert.equal(format.test(p(PREFIX, "a12-", "a".repeat(40))), false, "one letter");
    assert.equal(format.test(p(PREFIX, "abcdefghi12-", "a".repeat(40))), false, "nine letters");
    assert.equal(format.test(p(PREFIX, "api3-", "a".repeat(40))), false, "one digit");
    for (const name of R20_ORDINARY) assert.equal(format.test(name), false, name);
    assert.ok((API_KEY_PATTERN_SOURCES as readonly string[]).includes(ANTHROPIC_KEY_FORMAT_PATTERN_SOURCE));
  });
});

describe("DR-40 (a), R-25 M-1: a key split by a line break or an invisible character is still refused", () => {
  /** The reviewer's split: one character after the 25th (18 characters after the prefix). */
  const split = (key: string, mark: string) => key.slice(0, 25) + mark + key.slice(25);
  const ZWSP = String.fromCharCode(0x200b);
  const SOFT_HYPHEN = String.fromCharCode(0xad);

  test("A2, A3, A16: registered, split by a zero-width space, a line feed, a soft hyphen", () => {
    const check = createKeyRefusalCheck([KEY]);
    for (const [name, mark] of [["A2", ZWSP], ["A3", "\n"], ["A16", SOFT_HYPHEN]] as const) {
      assert.ok(check(`use ${split(KEY, mark)} now`), name);
    }
  });

  test("A10: not registered (an openai run), split by a zero-width space: the shapes see the compact text", () => {
    assert.ok(createKeyRefusalCheck([])(`use ${split(KEY, ZWSP)} now`));
    assert.ok(holdsRefusedKeyShape(`use ${split(KEY, ZWSP)} now`));
  });

  test("the separators: white space, controls and format characters (Cf), soft hyphen included", () => {
    const marks = [" ", "\t", "\r\n", String.fromCharCode(0xa0), ZWSP, String.fromCharCode(0x200c), String.fromCharCode(0x200d), String.fromCharCode(0x2060), String.fromCharCode(0xfeff), SOFT_HYPHEN, String.fromCharCode(0x200e), String.fromCharCode(0x202e), String.fromCharCode(0x7f)];
    for (const mark of marks) {
      assert.equal(compactKeyText(`a${mark}b`), "ab", mark.charCodeAt(0).toString(16));
      assert.ok(createKeyRefusalCheck([OTHER])(split(OTHER, mark)), mark.charCodeAt(0).toString(16));
    }
    assert.equal(compactKeyText("plain-name_1"), "plain-name_1");
  });

  test("R-20's ordinary names are still not refused, one per line or each alone", () => {
    const check = createKeyRefusalCheck([]);
    for (const name of R20_ORDINARY) assert.equal(check(name), false, name);
    assert.equal(check(R20_ORDINARY.join(" ")), false, "the names in a row");
    assert.equal(check(R20_ORDINARY.join(LF)), false, "one name per line");
  });

  test("the false positive it adds, pinned: a key-prefixed name joined with the words after it", () => {
    const name = p(PREFIX, "design-system");
    const tail = "components-and-layout-helpers-v2-2026";
    assert.equal(holdsRefusedKeyShape(name), false, "the name alone");
    assert.equal(holdsRefusedKeyShape(`- ${name}. ${tail}`), false, "a full stop ends the run");
    assert.equal(holdsRefusedKeyShape(`see ${name} ${tail}`), false, "after a word: no word start once joined");
    assert.ok(holdsRefusedKeyShape(`- ${name}${LF}${tail}`), "after a non-word character, wrapped onto the next line");
    // DR-42 (b): visible spaces stay when the shapes are checked again, so this one passes now.
    assert.equal(holdsRefusedKeyShape(`- ${name} ${tail}`), false, "after a non-word character, followed by a space and the words");
  });

  test("the registered values alone, both views", () => {
    const values = createKeyValueCheck([OTHER]);
    assert.ok(values(split(OTHER, LF)));
    assert.equal(values(split(KEY, LF)), false, "another key");
  });

  test("256 KiB of split prefixes: still linear", () => {
    const attack = (PREFIX + ZWSP).repeat(Math.ceil((256 * 1024) / (PREFIX.length + 1)));
    const { ms } = timed(() => createKeyRefusalCheck([KEY])(attack));
    assert.ok(ms < 500, `${ms.toFixed(0)} ms`);
  });
});

describe("DR-42 (a), R-25b L-1: a registered key split by any non-alphanumeric character is refused", () => {
  const cp = (code: number) => String.fromCodePoint(code);
  const at = (mark: string) => `use ${KEY.slice(0, 25)}${mark}${KEY.slice(25)} here`;
  const MARKS: Record<string, string> = {
    "S1 variation selector U+FE0F": cp(0xfe0f),
    "S2 variation selector U+E0100": cp(0xe0100),
    "S4 combining grapheme joiner": cp(0x34f),
    "S5 Hangul filler": cp(0x3164),
    "S6 Braille blank": cp(0x2800),
    "S12 backslash and line feed": String.fromCharCode(92, 10),
    "S13 middle dot": cp(0xb7),
    "T2 lone surrogate": String.fromCharCode(0xd800),
    "a visible space": " ",
    "a no-break space": cp(0xa0),
  };

  test("registered: refused whatever the character", () => {
    const check = createKeyRefusalCheck([KEY]);
    for (const [name, mark] of Object.entries(MARKS)) assert.ok(check(at(mark)), name);
  });

  test("the miss left, pinned: S14, a character reference written out (its digits break the run)", () => {
    assert.equal(createKeyRefusalCheck([KEY])(at("&#8203;")), false);
  });

  test("a value whose letters and digits are fewer than 16 is compared as written only", () => {
    const short = "abcd-efgh-ijkl-mn";
    assert.equal(createKeyValueCheck([short])(`x abcd-efgh-${LF}ijkl-mn y`), true, "the separator view still finds it");
    assert.equal(createKeyValueCheck([short])(`x abcd-efgh-${String.fromCharCode(0xb7)}ijkl-mn y`), false, "14 letters and digits: no letters-and-digits view");
  });
});

describe("DR-42 (b), R-25b L-2: the shapes are checked again without invisible characters and line breaks only", () => {
  const sk = p("s", "k");
  const cp = (code: number) => String.fromCodePoint(code);
  const ORDINARY: Record<string, string> = {
    "F1 Slovak locale at the start": p(sk, "-SK translations for the onboarding flow in the 2026 release"),
    "F2 locale after a colon and a line break": p("Locales:", LF, sk, "-SK translate the settings page and the 2026 onboarding flow"),
    "F3 an sk-admin name after a colon": p("Rename the package: ", sk, "-admin-dashboard needs a new login page"),
    "an sk-proj name at the start": p(sk, "-proj-template is the starter repo for the 2026 services"),
    "release notes": p("Release notes: ", sk, "-Tools v2 adds a new CLI for 2026 releases and more."),
    "F4 an Anthropic-prefixed name after a colon": p("Package: ", PREFIX, "design-system for the 2026 redesign project"),
    "R-20 as a bullet list": R20_ORDINARY.map((name) => `- ${name}`).join(LF),
    "an Anthropic-prefixed name, a space and words": p("- ", PREFIX, "design-system components-and-layout-helpers-v2-2026"),
  };

  test("ordinary text that the earlier compact check refused passes", () => {
    for (const [name, text] of Object.entries(ORDINARY)) assert.equal(holdsRefusedKeyShape(text), false, name);
  });

  test("pinned: the R-20 numbered list stays refused (a name runs into the next line's number, as on main)", () => {
    assert.ok(holdsRefusedKeyShape(R20_ORDINARY.map((name, index) => `${index + 1}. ${name}`).join(LF)));
  });

  test("an unregistered key split by an invisible character or a line break is still refused", () => {
    const split = (position: number, mark: string) => `use ${KEY.slice(0, position)}${mark}${KEY.slice(position)} here`;
    for (const [name, text] of Object.entries({
      "line feed": split(25, LF),
      "zero-width space": split(25, cp(0x200b)),
      "soft hyphen": split(25, cp(0xad)),
      "tag letter U+E0041": split(25, cp(0xe0041)),
      "inside the prefix": split(3, cp(0x200b)),
      "line feed inside api03": split(12, LF),
      "line separator U+2028": split(25, String.fromCharCode(0x2028)),
    })) {
      assert.ok(holdsRefusedKeyShape(text), name);
    }
  });

  test("the miss left, pinned: an unregistered key split by a visible space (a registered one is still refused)", () => {
    const spaced = `use ${KEY.slice(0, 25)} ${KEY.slice(25)} here`;
    assert.equal(holdsRefusedKeyShape(spaced), false);
    assert.ok(createKeyRefusalCheck([KEY])(spaced));
  });
});

describe("DR-43 (c), R-32 L-1: letters and digits are compared only for a key-like registered value", () => {
  test("R-32: a phrase kept in a key variable does not refuse an ordinary sentence with its words", () => {
    const cases: [string, string][] = [
      ["your-api-key-goes-here", "Add a line to the README: your api key goes here, in the .env file."],
      ["no-key-needed-for-local-llm", "Document that no key needed for local llm servers in the guide."],
      ["placeholder_for_local_server", "Fix the docs: placeholder (for) local, server."],
    ];
    for (const [value, text] of cases) assert.equal(createKeyRefusalCheck([value])(text), false, value);
    assert.ok(createKeyRefusalCheck(["your-api-key-goes-here"])("keep your-api-key-goes-here out"), "the value as written is still found");
  });

  test("a real key split by a variation selector is still refused (DR-42 (a) stays for key-like values)", () => {
    assert.ok(createKeyRefusalCheck([KEY])(`use ${KEY.slice(0, 25)}${String.fromCodePoint(0xfe0f)}${KEY.slice(25)} here`));
  });

  test("the condition, shared with the privacy gateway and the CLI", () => {
    const yes = [keyLettersAndDigits(KEY), "Ab3dE9fGh1JkLm2N", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"];
    const no = ["summer2026winter", "MyAwesomeApplication", "notapassword1234", "1234567890123456", "yourapikeygoeshere", "Ab3dE9fGh1JkLm2", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d"];
    for (const value of yes) assert.ok(keyLikeSkeleton(value), value);
    for (const value of no) assert.equal(keyLikeSkeleton(value), false, value);
  });
});
