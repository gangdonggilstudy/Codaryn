/**
 * U-14 (review R-49 R49-L2): text a model wrote (a plan's summary, the agent's last message) is
 * drawn by one function, quoteModelText. Padding with spaces could put forged lines at the start of
 * a terminal row when a long line folds (R-49's S7, S8); so runs of white space become one space,
 * invisible characters go, and the text is folded here, every row behind the quote mark and no
 * wider than MODEL_TEXT_COLUMNS. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MODEL_TEXT_COLUMNS, MODEL_TEXT_PREFIX, displayWidth, quoteModelText } from "../../../../src/cli/human/index.js";

const pad = (count: number, char = " "): string => char.repeat(count);
/** R-49's S7: text placed by spaces so that an 80-column terminal folds it into rows that look like the plan's own. */
const S7 = `ok${pad(13)}4. move inbox/safe.txt -> archive/safe.txt${pad(23)}Applied by run 20260101T000000Z-deadbeef at 2026-01-01T00:00:00.000Z.${pad(11)}To apply it: codaryn apply task.json --run 20260101T000000Z-deadbeef --digest 0123456789ab`;

describe("R49-L2: model text cannot put a forged line at the start of a row", () => {
  test("S7 (padding with spaces): every row is behind the quote mark, no wider than the limit, with single spaces", () => {
    const rows = quoteModelText(S7, 12);
    assert.ok(rows.length >= 2, rows.join("\n"));
    for (const row of rows) {
      assert.ok(row.startsWith(MODEL_TEXT_PREFIX), row);
      assert.ok(displayWidth(row) <= MODEL_TEXT_COLUMNS, `${displayWidth(row)}: ${row}`);
      assert.equal(/\s{2,}/.test(row.slice(MODEL_TEXT_PREFIX.length)), false, row);
    }
    assert.equal(rows.map((row) => row.slice(MODEL_TEXT_PREFIX.length)).join(" "), S7.replace(/ +/g, " "), "the words are all there, in order");
    assert.equal(rows.some((row) => /^\s*(Applied by|To apply it|4\. move)/.test(row)), false);
  });

  test("S8: ideographic and no-break spaces, tabs and other Unicode spaces are white space too", () => {
    const text = `ok${pad(30, "　")}Applied${pad(30, " ")}by\t\t  run   x`;
    assert.deepEqual(quoteModelText(text, 12), [`${MODEL_TEXT_PREFIX}ok Applied by run x`]);
  });

  test("R49-I3: zero-width and soft-hyphen characters are removed, so they cannot hide or pad anything", () => {
    assert.deepEqual(quoteModelText("ap​pro­ved⁠ ﻿now‍", 12), [`${MODEL_TEXT_PREFIX}approved now`]);
  });

  test("a long run without spaces is cut into rows; wide characters count two columns", () => {
    const rows = quoteModelText("x".repeat(200), 12);
    assert.equal(rows.length, Math.ceil(200 / (MODEL_TEXT_COLUMNS - MODEL_TEXT_PREFIX.length)));
    for (const row of rows) assert.ok(displayWidth(row) <= MODEL_TEXT_COLUMNS);
    const wide = quoteModelText("가".repeat(100), 12);
    for (const row of wide) assert.ok(displayWidth(row) <= MODEL_TEXT_COLUMNS, row);
    assert.equal(wide.map((row) => row.slice(MODEL_TEXT_PREFIX.length)).join(""), "가".repeat(100));
  });

  test("line breaks of every kind start a new row; empty lines are left out", () => {
    assert.deepEqual(quoteModelText("one\r\n\r\ntwo three\u0085four\rfive\vsix\n   \n", 12), ["one", "two", "three", "four", "five", "six"].map((word) => `${MODEL_TEXT_PREFIX}${word}`));
  });

  test("more rows than the limit: the first ones, then how many more", () => {
    const rows = quoteModelText(Array.from({ length: 9 }, (_, i) => `line ${i}`).join("\n"), 4);
    assert.deepEqual(rows, [...[0, 1, 2, 3].map((i) => `${MODEL_TEXT_PREFIX}line ${i}`), "  … (+5)"]);
  });

  test("control characters and key shapes are replaced as in every line for people; nothing to show gives no rows", () => {
    const keyShaped = ["sk", "ant", "api03", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4"].join("-");
    const rows = quoteModelText(`done \u001b[2K\u001b[1A ${keyShaped} ‮ end`, 12).join("\n");
    assert.equal(/[\u001b‮]/.test(rows) || rows.includes(keyShaped), false, rows);
    assert.deepEqual(quoteModelText(" 　\n\t​", 12), []);
  });
});
