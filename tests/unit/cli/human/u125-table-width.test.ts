/**
 * U-125 (PM): the terminal width of text is one shared function of the human output,
 * src/cli/human/format.ts `displayWidth` (exported from src/cli/human/index.ts with `padEnd` and
 * `padStart`). East Asian wide and fullwidth characters take two columns, combining marks and other
 * zero-width characters none, from Unicode range tables (no dependency). The Korean doctor table was
 * padded by UTF-16 length ("[정상]      Node.js 버전"); its code is na-core's (src/cli/doctor.ts, U-127),
 * which takes these functions. The renderer's own table (runs) pads with them, in both languages.
 * Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { RunId, RunsOutput } from "../../../../src/contracts/index.js";
import { createHumanOutput, displayWidth, padEnd, padStart } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

describe("U-125: displayWidth, the one terminal width", () => {
  test("ASCII and other narrow text: one column a character (the length)", () => {
    for (const text of ["", "Node.js", "run id", "é", "Ω", "—", "[skipped]"]) assert.equal(displayWidth(text), text.length, text);
  });

  test("East Asian wide and fullwidth characters: two columns", () => {
    const wide: [string, number][] = [
      ["정상", 4], // Hangul syllables
      ["[건너뜀]", 8],
      ["ᄀ", 2], // Hangul Jamo initial
      ["ꥠ", 2], // Hangul Jamo Extended-A initial
      ["ㄱ", 2], // Hangul compatibility Jamo
      ["確認", 4], // CJK ideographs
      ["かな", 4], // Hiragana
      ["カナ", 4], // Katakana
      ["、。", 4], // CJK symbols and punctuation
      ["Ａ１", 4], // fullwidth forms
      ["︐", 2], // vertical forms
      ["﹐", 2], // small form variants
      ["\u{20000}", 2], // CJK extension B
    ];
    for (const [text, width] of wide) assert.equal(displayWidth(text), width, `U+${text.codePointAt(0)?.toString(16)}`);
  });

  test("combining marks and other zero-width characters: no column, also inside a wide block", () => {
    const zero: [string, number][] = [
      ["é", 1], // combining acute accent
      ["a᪰", 1], // combining diacritical marks extended
      ["a᷀", 1], // supplement
      ["a⃗", 1], // for symbols
      ["a︠", 1], // half marks
      ["각", 2], // a syllable from conjoining Jamo: initial (2), vowel and final (0)
      ["ᄀힰ", 2], // Hangul Jamo Extended-B vowel
      ["が", 2], // combining kana voiced sound mark (inside the wide kana block)
      ["a​b‌c‍d", 4], // zero width space, non-joiner, joiner
      ["a⁠b﻿c", 3], // word joiner, zero width no-break space
      ["確️", 2], // variation selector
      ["確\u{e0100}", 2], // variation selector supplement
    ];
    for (const [text, width] of zero) assert.equal(displayWidth(text), width, JSON.stringify(text));
  });

  test("padEnd and padStart fill to columns and never cut", () => {
    assert.equal(padEnd("[정상]", 10), "[정상]    ");
    assert.equal(padEnd("[건너뜀]", 10), "[건너뜀]  ");
    assert.equal(padStart("한글", 6), "  한글");
    assert.equal(padStart("64000", 8), "   64000");
    assert.equal(padEnd("é", 3), "é  ");
    assert.equal(padEnd("longer than", 3), "longer than");
    assert.equal(padStart("longer than", 3), "longer than");
    for (const text of ["ascii", "run id", "x"]) {
      assert.equal(padEnd(text, 8), text.padEnd(8), "ASCII as String.padEnd");
      assert.equal(padStart(text, 8), text.padStart(8), "ASCII as String.padStart");
    }
  });
});

const STARTED = "2026-11-12T03:04:05.000Z";
const RUNS = {
  schemaVersion: 1, kind: "runs", status: "listed", exitCode: 0, omitted: 0,
  runs: [
    { state: "checked", runId: toRunId("20261112T030405Z-0a1b2c3d") as RunId, startedAt: STARTED, taskId: "t", status: "done", reason: "verified", changes: 12, reverted: null, revertRecordDamaged: false },
    { state: "checked", runId: toRunId("20261112T030400Z-00000000") as RunId, startedAt: STARTED, taskId: "t", status: null, reason: null, changes: null, reverted: null, revertRecordDamaged: false },
    { state: "damaged", runId: toRunId("20261112T030300Z-ffffffff") as RunId },
  ],
} as unknown as RunsOutput;

for (const language of MESSAGE_LANGUAGES) {
  describe(`U-125 (${language}): the runs table pads with displayWidth`, () => {
    test("each column starts at the same terminal column on every row, the header's included", () => {
      const catalog = createMessageCatalog(language);
      const rows = createHumanOutput(catalog).runsText(RUNS).trimEnd().split("\n");
      assert.equal(rows.length, 4, rows.join("\n"));
      const header = rows[0] as string;
      // The header's cells, found in order: their starting columns.
      const cells = ["runs.column.run_id", "runs.column.started", "runs.column.changes", "runs.column.status"].map((id) => catalog.format(id as "runs.column.run_id"));
      const starts: number[] = [];
      let from = 0;
      for (const cell of cells) {
        const at = header.indexOf(cell, from);
        assert.ok(at >= 0, header);
        starts.push(displayWidth(header.slice(0, at)));
        from = at + cell.length;
      }
      // On each data row, a cell starts after two spaces, at the header's column.
      for (const row of rows.slice(1)) {
        for (const start of starts.slice(1)) {
          let column = 0;
          let index = 0;
          for (const char of row) {
            if (column >= start) break;
            column += displayWidth(char);
            index += char.length;
          }
          assert.equal(column, start, `${row}\n(column ${start})`);
          assert.equal(row.slice(index - 2, index), "  ", `${row}\n(two spaces before column ${start})`);
          assert.notEqual(row[index], " ", `${row}\n(a cell starts at column ${start})`);
        }
      }
    });
  });
}
