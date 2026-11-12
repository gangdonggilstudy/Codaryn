/** N-4 parameter rendering: numbers, durations, field positions, ids and recorded paths. */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { HIDDEN_KEY, MAX_SHOWN_PATH, REPLACEMENT } from "../../../src/i18n/index.js";
import { cleanLine, formatCount, formatDuration, formatField, formatId, shownPath } from "../../../src/i18n/params.js";
import { KEY_SHAPED } from "./support.js";

describe("i18n params: counts and durations", () => {
  test("counts are non-negative safe integers, anything else is the replacement mark", () => {
    assert.equal(formatCount(0), "0");
    assert.equal(formatCount(150000), "150000");
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "3", null, undefined, {}]) {
      assert.equal(formatCount(value), REPLACEMENT, String(value));
    }
  });

  test("durations carry units in each language", () => {
    const cases: [number, string, string][] = [
      [0, "0 ms", "0 ms"],
      [78, "78 ms", "78 ms"],
      [999, "999 ms", "999 ms"],
      [1000, "1.0 s", "1.0초"],
      [4250, "4.2 s", "4.2초"],
      [59_999, "59.9 s", "59.9초"],
      [60_000, "1 min 0 s", "1분 0초"],
      [185_000, "3 min 5 s", "3분 5초"],
      [7_260_000, "2 h 1 min", "2시간 1분"],
    ];
    for (const [ms, en, ko] of cases) {
      assert.equal(formatDuration(ms, "en"), en);
      assert.equal(formatDuration(ms, "ko"), ko);
    }
    assert.equal(formatDuration(-5, "ko"), REPLACEMENT);
    assert.equal(formatDuration("78", "en"), REPLACEMENT);
  });
});

describe("i18n params: field positions", () => {
  test("known names and indexes pass, unknown names become ?", () => {
    assert.equal(formatField("policy.commands[2].argsPrefix", "en"), "policy.commands[2].argsPrefix");
    assert.equal(formatField("limits.maxTotalTokens", "ko"), "limits.maxTotalTokens");
    assert.equal(formatField("verifiers[0].rules[3].path", "en"), "verifiers[0].rules[3].path");
    assert.equal(formatField("steps[4].toolCalls[0].name", "en"), "steps[4].toolCalls[0].name");
    assert.equal(formatField("policy.commands[007]", "en"), "policy.commands[7]");
    assert.equal(formatField("policy.probeName", "en"), "policy.?");
    assert.equal(formatField("__proto__.constructor", "en"), "?.?");
  });

  test("the top level has a word in each language", () => {
    assert.equal(formatField("", "ko"), "최상위");
    assert.equal(formatField("", "en"), "the top level");
  });

  test("anything that is not a position is the replacement mark as a whole", () => {
    for (const value of [
      "[0]",
      "policy..commands",
      "policy.",
      ".policy",
      "policy.commands[]",
      "policy.commands[1234567]",
      "policy commands",
      "policy/commands",
      "policy.commands[2]x",
      "1policy",
      `policy.${"a".repeat(300)}`,
      null,
      7,
      ["policy"],
    ]) {
      assert.equal(formatField(value, "en"), REPLACEMENT, String(value));
    }
  });
});

describe("i18n params: recorded text", () => {
  test("ids keep the recorded identifier shape only", () => {
    assert.equal(formatId("20261111T233839Z-d9c21658"), "20261111T233839Z-d9c21658");
    assert.equal(formatId("unit:tests/a.b"), "unit:tests/a.b");
    for (const value of ["", "a b", "a\nb", "x".repeat(129), "가", 3, null]) assert.equal(formatId(value), REPLACEMENT, String(value));
  });

  test("paths are cleaned of controls, hide key-shaped text and are cut", () => {
    assert.equal(shownPath("docs/INSTALL.md"), "docs/INSTALL.md");
    assert.equal(shownPath("a\u001b[2Jb\nc‮d"), "a?[2Jb?c?d");
    assert.equal(shownPath(`notes/${KEY_SHAPED}.txt`), `notes/${HIDDEN_KEY}.txt`);
    assert.equal(shownPath("[[CODARYN_SECRET:0123456789abcdef]]/a.md"), "[[CODARYN_SECRET:0123456789abcdef]]/a.md");
    const long = shownPath("가".repeat(MAX_SHOWN_PATH + 50));
    assert.equal(long, `${"가".repeat(MAX_SHOWN_PATH)}...`);
    assert.equal(shownPath(""), REPLACEMENT);
    assert.equal(shownPath(42), REPLACEMENT);
  });

  test("cleanLine replaces line breaks too, so a message stays one line", () => {
    assert.equal(cleanLine("a\r\nb\tc d\u0085e"), "a??b?c?d?e");
  });
});
