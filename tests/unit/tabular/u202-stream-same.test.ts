/**
 * U-202 (bundle A, A-2): the table read in pieces gives what the whole-text parser gave before
 * (the frozen copy in ./reference/table-v1.ts), for every format, whatever the pieces: the same
 * columns and rows, or the same problem with the same data row and line. Fixed edge cases first,
 * then seeded random tables (plain, with quoting, CR, LF, TAB, byte order marks, surrogate pairs,
 * broken on purpose), each read as one text, in random text pieces and in random byte chunks that
 * split UTF-8 sequences and CRLF pairs.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { TableFormat } from "../../../src/contracts/index.js";
import { TableScanner, parseTable, scanTable } from "../../../src/tabular/index.js";
import type { TableScanOutcome, TableTextOutcome } from "../../../src/tabular/index.js";
import { parseTable as parseTableV1 } from "./reference/table-v1.js";
import type { ParseTableOutcome } from "./reference/table-v1.js";

const FORMATS: readonly TableFormat[] = ["csv", "tsv", "jsonl"];

/** mulberry32: a small seeded generator, so a failure can be run again. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
const int = (rng: Rng, max: number): number => Math.floor(rng() * (max + 1));

/** What the reading of a text gives, rows padded as the whole-text parser pads them. */
interface Read {
  readonly outcome: TableTextOutcome;
  readonly rows: (readonly string[])[];
}

function padded(rows: readonly (readonly string[])[], width: number): string[][] {
  return rows.map((row) => [...row, ...new Array<string>(Math.max(0, width - row.length)).fill("")]);
}

/** The reference's answer in the shape the scanner gives. */
function expected(outcome: ParseTableOutcome): { outcome: TableTextOutcome; rows: string[][] } {
  if (!outcome.ok) return { outcome: { ok: false, problem: outcome.problem }, rows: [] };
  return {
    outcome: { ok: true, columns: outcome.table.columns, rows: outcome.table.rows.length },
    rows: outcome.table.rows.map((row) => [...row]),
  };
}

function readPieces(pieces: readonly string[], format: TableFormat): Read {
  const rows: (readonly string[])[] = [];
  let columns: readonly string[] = [];
  const scanner = new TableScanner(format, {
    columns: (list) => {
      assert.ok(list.length >= columns.length, "the columns only grow");
      columns = list;
    },
    row: (cells) => rows.push(cells),
  });
  for (const piece of pieces) scanner.write(piece);
  return { outcome: scanner.end(), rows };
}

function sameAsReference(text: string, format: TableFormat, read: Read, how: string): void {
  const want = expected(parseTableV1(text, format));
  const label = `${format} ${how}: ${JSON.stringify(text).slice(0, 300)}`;
  assert.deepEqual(read.outcome, want.outcome, label);
  if (read.outcome.ok) assert.deepEqual(padded(read.rows, read.outcome.columns.length), want.rows, label);
}

/** Splits a string at random code unit offsets (a surrogate pair may be split: the scanner gets UTF-16 pieces). */
function textPieces(rng: Rng, text: string): string[] {
  const pieces: string[] = [];
  let at = 0;
  while (at < text.length) {
    const size = 1 + int(rng, Math.min(9, text.length - at - 1));
    pieces.push(text.slice(at, at + size));
    at += size;
  }
  return pieces;
}

function bytePieces(rng: Rng, bytes: Uint8Array): Uint8Array[] {
  const pieces: Uint8Array[] = [];
  let at = 0;
  while (at < bytes.length) {
    const size = 1 + int(rng, Math.min(6, bytes.length - at - 1));
    pieces.push(bytes.subarray(at, at + size));
    at += size;
  }
  return pieces;
}

/** What scanTable must give for these bytes: decode as data_checks did, then the reference. */
function expectedScan(bytes: Uint8Array, format: TableFormat): { outcome: TableScanOutcome; rows: string[][] } {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { outcome: { ok: false, reason: "not_text" }, rows: [] };
  }
  const want = expected(parseTableV1(text, format));
  if (!want.outcome.ok) return { outcome: { ok: false, reason: "not_table", problem: want.outcome.problem }, rows: [] };
  return { outcome: want.outcome, rows: want.rows };
}

async function checkBytes(bytes: Uint8Array, format: TableFormat, chunks: readonly Uint8Array[], label: string): Promise<void> {
  const rows: (readonly string[])[] = [];
  const outcome = await scanTable(chunks, format, { row: (cells) => rows.push(cells) });
  const want = expectedScan(bytes, format);
  assert.deepEqual(outcome, want.outcome, label);
  if (outcome.ok) assert.deepEqual(padded(rows, outcome.columns.length), want.rows, label);
}

const EDGE_TEXTS = [
  "",
  "\uFEFF",
  "\uFEFF\uFEFF",
  "\uFEFF\uFEFFa,b\n1,2",
  "\n",
  "\r\n\r\n",
  "\r",
  "a",
  "a\n",
  "a\r",
  "a\r\n",
  "a,b\n1,2\n3,4\n",
  "a,b\r\n1,2\r\n3,4\r\n\r\n\n",
  "a,b\n1,2\n\n3,4",
  "a,b\n1\n",
  "a,b\n1,2,3\n\"x",
  "a,b\n1,2,3\nx\ry",
  "a,b\n\"1\n2\",3\n",
  "a,b\n\"1\r\n2\",\"\"\"\"\n",
  '"a""',
  '"a',
  '"a\n\n',
  'h\n"a\r',
  '"a"x',
  '"a"\rx',
  '"a"\r\nb',
  '"a" ,b',
  'a"b',
  "a\rb",
  "a,\n1,",
  ",\n,",
  "a,b,\n1,2,",
  "\uFEFFa\n1",
  "a\n\uFEFF",
  "a\tb\n1\t2\n",
  "a\tb\n1\t2\t3\n4\r5",
  "a\tb\r\n1\t2\r\n",
  "a\tb\n1\r\t2",
  '{"a":1}\n{"b":2}\n',
  '{"a":1}\r\n{"a":"x","c":null}\r\n',
  '{"a":1}\n\n{"a":2}',
  '{"a":1}\n  \n',
  '{"a":1}\n[1]',
  '{"a":1}\nnot json',
  '{"a":1,"a":2}\n{"__proto__":3,"b":true,"c":[1,{"d":2}]}',
  '{"2":1,"1":2,"x":3}',
  '{"a":"line\\nbreak"}\n{"a":"\\r"}',
  '{"a":1}\r\r\n{"a":2}',
  "😀,b\n\uD83D,\uDE00",
];

test("U-202: fixed edge cases read the same as one text, in pieces of every size, and as bytes", async () => {
  for (const format of FORMATS) {
    for (const text of EDGE_TEXTS) {
      sameAsReference(text, format, readPieces([text], format), "one piece");
      // parseTable is the scanner over one piece; it must keep the reference's table too.
      const whole = parseTable(text, format);
      assert.deepEqual(whole, parseTableV1(text, format), `${format} parseTable: ${JSON.stringify(text)}`);
      for (let size = 1; size <= 4; size += 1) {
        const pieces: string[] = [];
        for (let at = 0; at < text.length; at += size) pieces.push(text.slice(at, at + size));
        sameAsReference(text, format, readPieces(pieces, format), `pieces of ${size}`);
      }
      const bytes = new TextEncoder().encode(text);
      for (let size = 1; size <= 3; size += 1) {
        const chunks: Uint8Array[] = [];
        for (let at = 0; at < bytes.length; at += size) chunks.push(bytes.subarray(at, at + size));
        await checkBytes(bytes, format, chunks, `${format} bytes of ${size}: ${JSON.stringify(text)}`);
      }
    }
  }
});

const CELL_PARTS = ["a", "b", "1", "2.5", "-3", "1e3", "", " ", ",", '"', '""', "\n", "\r", "\r\n", "\t", "한", "😀", "\uFEFF", "x y", "null"];

function cell(rng: Rng): string {
  let text = "";
  const parts = int(rng, 3);
  for (let index = 0; index < parts; index += 1) text += pick(rng, CELL_PARTS);
  return text;
}

function csvField(rng: Rng, value: string): string {
  const needs = /[",\r\n]/.test(value) || rng() < 0.15;
  return needs ? `"${value.replace(/"/g, '""')}"` : value;
}

function randomTable(rng: Rng, format: TableFormat): string {
  const width = 1 + int(rng, 3);
  const height = int(rng, 6);
  const lineBreak = (): string => (rng() < 0.3 ? "\r\n" : "\n");
  let text = rng() < 0.15 ? "\uFEFF" : "";
  if (format === "jsonl") {
    const keys = ["a", "b", "c", "a b", "1", "😀"];
    const lines: string[] = [];
    for (let row = 0; row < Math.max(1, height); row += 1) {
      const object: Record<string, unknown> = {};
      for (let index = 0; index < 1 + int(rng, 3); index += 1) {
        object[pick(rng, keys)] = pick(rng, [cell(rng), int(rng, 100), rng() * 10 - 5, null, true, false, [1, "x"], { y: 1 }]);
      }
      lines.push(JSON.stringify(object));
    }
    text += lines.join("\n").replace(/\n/g, () => lineBreak());
  } else {
    const rows: string[] = [];
    for (let row = 0; row <= height; row += 1) {
      const cells: string[] = [];
      for (let index = 0; index < width; index += 1) {
        const value = cell(rng);
        cells.push(format === "csv" ? csvField(rng, value) : value.replace(/[\t\r\n]/g, ""));
      }
      rows.push(cells.join(format === "csv" ? "," : "\t"));
    }
    text += rows.join("\n").replace(/\n/g, () => lineBreak());
  }
  if (rng() < 0.4) text += pick(rng, ["\n", "\r\n", "\n\n", "\r\n\r\n", "\r", "\n\r\n"]);
  return text;
}

/** Breaks a table on purpose now and then: a character put in, taken out or changed. */
function corrupt(rng: Rng, text: string): string {
  let out = text;
  const edits = rng() < 0.5 ? 0 : 1 + int(rng, 2);
  for (let index = 0; index < edits; index += 1) {
    const at = int(rng, out.length);
    const kind = int(rng, 2);
    const piece = pick(rng, ['"', ",", "\r", "\n", "\t", "{", "}", " ", "a", ""]);
    if (kind === 0) out = out.slice(0, at) + piece + out.slice(at);
    else if (kind === 1) out = out.slice(0, at) + out.slice(at + 1);
    else out = out.slice(0, at) + piece + out.slice(at + 1);
  }
  return out;
}

test("U-202: seeded random tables read the same in text pieces as the whole-text parser read them", () => {
  const rng = random(202);
  let problems = 0;
  for (let round = 0; round < 1500; round += 1) {
    for (const format of FORMATS) {
      const text = corrupt(rng, randomTable(rng, format));
      const read = readPieces(textPieces(rng, text), format);
      if (!read.outcome.ok) problems += 1;
      sameAsReference(text, format, read, `round ${round}`);
    }
  }
  // The cases are not all well formed nor all broken (both paths are compared).
  assert.ok(problems > 500 && problems < 4000, `problems: ${problems}`);
});

test("U-202: seeded random tables read the same from byte chunks, broken UTF-8 included", async () => {
  const rng = random(2020);
  let notText = 0;
  for (let round = 0; round < 800; round += 1) {
    for (const format of FORMATS) {
      let bytes = new TextEncoder().encode(corrupt(rng, randomTable(rng, format)));
      if (rng() < 0.2) {
        // A byte that cannot start or continue UTF-8 here, or a sequence cut short.
        const at = int(rng, bytes.length);
        const bad = pick(rng, [[0xff], [0xc3], [0xe2, 0x82], [0x80], [0xed, 0xa0, 0x80]]);
        bytes = Uint8Array.from([...bytes.subarray(0, at), ...bad, ...bytes.subarray(at)]);
      }
      if (rng() < 0.1) bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes]);
      const want = expectedScan(bytes, format);
      if (!want.outcome.ok && want.outcome.reason === "not_text") notText += 1;
      await checkBytes(bytes, format, bytePieces(rng, bytes), `${format} round ${round}`);
    }
  }
  assert.ok(notText > 100, `not UTF-8 cases: ${notText}`);
});

test("U-202: a sink's error passes through scanTable; it is not read as a table or text problem", async () => {
  const chunks = [new TextEncoder().encode("a\n1\n2\n")];
  await assert.rejects(
    scanTable(chunks, "csv", {
      row: () => {
        throw new Error("sink broke");
      },
    }),
    /sink broke/,
  );
});

test("U-202: chunks are read to their end after a parse problem and after bytes that are not UTF-8", async () => {
  for (const [text, bad] of [
    ['a\n"b', false],
    ["a\n1", true],
  ] as const) {
    let pulled = 0;
    const all = [new TextEncoder().encode(text), ...(bad ? [Uint8Array.from([0xff])] : []), new TextEncoder().encode("\nmore"), new TextEncoder().encode("\nrest")];
    const chunks = (function* () {
      for (const chunk of all) {
        pulled += 1;
        yield chunk;
      }
    })();
    const outcome = await scanTable(chunks, "csv");
    assert.equal(pulled, all.length, JSON.stringify(text));
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.reason, bad ? "not_text" : "not_table");
  }
});
