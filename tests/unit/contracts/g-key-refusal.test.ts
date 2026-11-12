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
  createKeyRefusalCheck,
  holdsRefusedKeyShape,
} from "../../../src/contracts/index.js";

const p = (...parts: string[]) => parts.join("");
const PREFIX = p("sk", "-ant-");
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
