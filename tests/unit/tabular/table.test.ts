import assert from "node:assert/strict";
import { test } from "node:test";

import { findColumn, parseTable } from "../../../src/tabular/index.js";
import type { ParseTableOutcome, Table } from "../../../src/tabular/index.js";

function table(outcome: ParseTableOutcome): Table {
  assert.equal(outcome.ok, true, outcome.ok ? "" : JSON.stringify(outcome.problem));
  return (outcome as { table: Table }).table;
}

function problem(outcome: ParseTableOutcome): { code: string; dataRow: number | null; line: number | null } {
  assert.equal(outcome.ok, false);
  return (outcome as { problem: { code: string; dataRow: number | null; line: number | null } }).problem;
}

test("csv: header, rows, LF and CRLF, a byte order mark and final line breaks", () => {
  for (const text of ["a,b\n1,2\n3,4\n", "a,b\r\n1,2\r\n3,4\r\n", "﻿a,b\n1,2\n3,4", "a,b\n1,2\n3,4\n\n\r\n"]) {
    assert.deepEqual(table(parseTable(text, "csv")), { columns: ["a", "b"], rows: [["1", "2"], ["3", "4"]] });
  }
});

test("csv: quoted fields hold separators, line breaks and doubled quotes", () => {
  const parsed = table(parseTable('name,note\n"Kim, J","line 1\nline 2"\n"say ""hi""",""\nplain,"a\r\nb"\n', "csv"));
  assert.deepEqual(parsed.rows, [
    ["Kim, J", "line 1\nline 2"],
    ['say "hi"', ""],
    ["plain", "a\r\nb"],
  ]);
});

test("csv: empty fields, a separator at the end and a header without rows", () => {
  assert.deepEqual(table(parseTable("a,b,c\n,,\n1,,3\n4,5,\n", "csv")).rows, [["", "", ""], ["1", "", "3"], ["4", "5", ""]]);
  assert.deepEqual(table(parseTable("a,b\n", "csv")), { columns: ["a", "b"], rows: [] });
  // One column: an empty line in the middle is an empty cell.
  assert.deepEqual(table(parseTable("a\n1\n\n3\n", "csv")).rows, [["1"], [""], ["3"]]);
});

test("csv: RFC 4180 violations are problems with their place", () => {
  assert.deepEqual(problem(parseTable("", "csv")), { code: "empty", dataRow: null, line: null });
  assert.deepEqual(problem(parseTable("﻿\r\n\n", "csv")), { code: "empty", dataRow: null, line: null });
  assert.deepEqual(problem(parseTable('a,b\n1,"open\n2,3\n', "csv")), { code: "unterminated_quote", dataRow: 1, line: 2 });
  assert.deepEqual(problem(parseTable('a,b\n1,2\n3,x"y\n', "csv")), { code: "quote_in_unquoted_field", dataRow: 2, line: 3 });
  assert.deepEqual(problem(parseTable('a,b\n"1"x,2\n', "csv")), { code: "text_after_quote", dataRow: 1, line: 2 });
  assert.deepEqual(problem(parseTable("a,b\n1\r2,3\n", "csv")), { code: "bare_cr", dataRow: 1, line: 2 });
  assert.deepEqual(problem(parseTable("a,b\n1,2\n3\n4,5\n", "csv")), { code: "field_count", dataRow: 2, line: 3 });
  assert.deepEqual(problem(parseTable('a,b\n"x\ny",2\n1,2,3\n', "csv")), { code: "field_count", dataRow: 2, line: 4 });
});

test("csv: a problem never carries the table's text", () => {
  const secret = "CELL-TEXT-r2d2";
  for (const text of [`a,b\n${secret},"x`, `a,b\n${secret}"q,1`, `a,b\n"${secret}"z,1`, `a,b\n${secret}`]) {
    const outcome = parseTable(text, "csv");
    assert.equal(outcome.ok, false);
    assert.equal(JSON.stringify(outcome).includes(secret), false);
  }
});

test("csv: any table written with RFC 4180 quoting reads back the same (generated cases)", () => {
  let seed = 7;
  const next = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const alphabet = ["a", "Z", "9", " ", ",", '"', "\n", "\r\n", "가", "-", ".", "\t"];
  const cell = (): string => Array.from({ length: next(6) }, () => alphabet[next(alphabet.length)]).join("");
  const quote = (value: string): string =>
    /[",\r\n]/.test(value) || value.startsWith(" ") || next(4) === 0 ? `"${value.replace(/"/g, '""')}"` : value;
  for (let round = 0; round < 500; round += 1) {
    const width = 1 + next(4);
    const columns = Array.from({ length: width }, (_v, index) => `c${index}`);
    const rows = Array.from({ length: next(6) }, () => Array.from({ length: width }, cell));
    // A one-column row whose only cell is empty cannot be told from a final line break.
    if (width === 1 && rows.length > 0 && rows[rows.length - 1]?.[0] === "") rows[rows.length - 1] = ["x"];
    const breakText = next(2) === 0 ? "\n" : "\r\n";
    const text = [columns, ...rows].map((row) => row.map(quote).join(",")).join(breakText) + (next(2) === 0 ? breakText : "");
    assert.deepEqual(table(parseTable(text, "csv")), { columns, rows }, `round ${round}`);
  }
});

test("tsv: tabs separate, quotes are ordinary, field counts must match", () => {
  assert.deepEqual(table(parseTable('a\tb\r\n"1"\tx,y\n\t\n', "tsv")), { columns: ["a", "b"], rows: [['"1"', "x,y"], ["", ""]] });
  assert.deepEqual(problem(parseTable("a\tb\n1\n", "tsv")), { code: "field_count", dataRow: 1, line: 2 });
  assert.deepEqual(problem(parseTable("a\tb\n1\r2\t3\n", "tsv")), { code: "bare_cr", dataRow: 1, line: 2 });
});

test("jsonl: keys become columns in order of first appearance; values become cells", () => {
  const text = '{"region":"north","amount":12.5,"ok":true}\r\n{"amount":-3,"region":null,"extra":{"a":1}}\n{"region":"south"}\n\n';
  assert.deepEqual(table(parseTable(text, "jsonl")), {
    columns: ["region", "amount", "ok", "extra"],
    rows: [
      ["north", "12.5", "true", ""],
      ["", "-3", "", '{"a":1}'],
      ["south", "", "", ""],
    ],
  });
});

test("jsonl: a blank line, invalid JSON or a non-object line is a problem", () => {
  assert.deepEqual(problem(parseTable('{"a":1}\n\n{"a":2}\n', "jsonl")), { code: "blank_line", dataRow: 2, line: 2 });
  assert.deepEqual(problem(parseTable('{"a":1}\n{"a":\n', "jsonl")), { code: "not_json", dataRow: 2, line: 2 });
  assert.deepEqual(problem(parseTable('{"a":1}\n[1,2]\n', "jsonl")), { code: "not_object", dataRow: 2, line: 2 });
  assert.deepEqual(problem(parseTable("null\n", "jsonl")), { code: "not_object", dataRow: 1, line: 1 });
  assert.deepEqual(problem(parseTable("\n", "jsonl")), { code: "empty", dataRow: null, line: null });
});

test("findColumn: exact names; a repeated name is ambiguous", () => {
  const parsed = table(parseTable("a,b,a,B\n1,2,3,4\n", "csv"));
  assert.deepEqual(findColumn(parsed, "b"), { ok: true, index: 1 });
  assert.deepEqual(findColumn(parsed, "a"), { ok: false, problem: "ambiguous" });
  assert.deepEqual(findColumn(parsed, "c"), { ok: false, problem: "missing" });
  assert.deepEqual(findColumn(parsed, "A"), { ok: false, problem: "missing" });
});
