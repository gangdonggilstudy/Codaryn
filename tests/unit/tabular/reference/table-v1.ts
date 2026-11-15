/**
 * Table parsing for data checks (VF-04, G-D): CSV, TSV and JSON Lines as `DataChecksVerifierConfig`
 * describes them (src/contracts/verify.ts). Pure: reads no file, holds no state.
 *
 * - csv: a subset of RFC 4180. Fields are separated by `,` and records by CRLF or LF. A field that
 *   starts with `"` is quoted: it ends at the next `"` not doubled, may hold `,`, CR and LF, and
 *   `""` stands for one `"`. After the closing quote only a separator, a line break or the end may
 *   follow. An unquoted field may not hold `"` or a lone CR. The first record is the header.
 * - tsv: fields separated by TAB, records by CRLF or LF, no quoting (a `"` is an ordinary character).
 * - jsonl: one JSON object per line. The columns are the keys in order of first appearance; a key
 *   a row lacks is an empty cell. Strings are taken as they are, numbers as JavaScript prints them,
 *   null as an empty cell, true and false as words, objects and arrays as JSON text.
 * Every format: a leading byte order mark is ignored, and line breaks at the very end are ignored
 * (so in a one-column table a trailing empty cell cannot be told from a final line break). Every
 * data row of csv and tsv must have as many fields as the header.
 *
 * A problem names its code and where it is (data row, line), never the text of the table.
 */

// U-202: a frozen copy of src/tabular/table.ts as it was before table streaming (f9298ae), only
// this import changed. The streaming reader is compared with it (u202-stream-same.test.ts); do not
// change it to make a comparison pass.
import type { TableFormat } from "../../../../src/contracts/index.js";

/** A parsed table. Every row has exactly `columns.length` cells. */
export interface Table {
  readonly columns: readonly string[];
  /** Data rows in order; the header is not one of them. Data row N is `rows[N - 1]`. */
  readonly rows: readonly (readonly string[])[];
}

export const TABLE_PROBLEM_CODES = [
  "empty",
  "unterminated_quote",
  "quote_in_unquoted_field",
  "text_after_quote",
  "bare_cr",
  "field_count",
  "blank_line",
  "not_json",
  "not_object",
] as const;
export type TableProblemCode = (typeof TABLE_PROBLEM_CODES)[number];

export interface TableProblem {
  readonly code: TableProblemCode;
  /** 1-based data row (the header not counted), or null for the header or the whole table. */
  readonly dataRow: number | null;
  /** 1-based physical line where the problem was found, or null. */
  readonly line: number | null;
}

export type ParseTableOutcome = { readonly ok: true; readonly table: Table } | { readonly ok: false; readonly problem: TableProblem };

const BOM = "﻿";

function withoutBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

/** The text without the line breaks (CR and LF) at its very end. */
function withoutTrailingBreaks(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === "\n" || text[end - 1] === "\r")) end -= 1;
  return text.slice(0, end);
}

function fail(code: TableProblemCode, dataRow: number | null, line: number | null): ParseTableOutcome {
  return { ok: false, problem: { code, dataRow, line } };
}

/** A data row number for a record index (record 0 is the header). */
function dataRowOf(record: number): number | null {
  return record === 0 ? null : record;
}

function tableFrom(records: readonly (readonly string[])[], lines: readonly number[]): ParseTableOutcome {
  const header = records[0];
  if (header === undefined) return fail("empty", null, null);
  for (let index = 1; index < records.length; index += 1) {
    if ((records[index] as readonly string[]).length !== header.length) {
      return fail("field_count", index, lines[index] ?? null);
    }
  }
  return { ok: true, table: { columns: header, rows: records.slice(1) } };
}

function parseCsv(source: string): ParseTableOutcome {
  const text = withoutTrailingBreaks(withoutBom(source));
  if (text.length === 0) return fail("empty", null, null);

  const records: string[][] = [];
  const lines: number[] = [];
  let record: string[] = [];
  let line = 1;
  let recordLine = 1;
  let i = 0;
  const endRecord = (): void => {
    records.push(record);
    lines.push(recordLine);
    record = [];
  };

  for (;;) {
    // One field starts at i.
    if (text[i] === '"') {
      let value = "";
      let j = i + 1;
      for (;;) {
        if (j >= text.length) return fail("unterminated_quote", dataRowOf(records.length), recordLine);
        const c = text[j] as string;
        if (c === '"') {
          if (text[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        if (c === "\n") line += 1;
        value += c;
        j += 1;
      }
      record.push(value);
      i = j;
      const next = text[i];
      if (next === undefined) {
        endRecord();
        break;
      }
      if (next === ",") {
        i += 1;
        continue;
      }
      if (next === "\n" || (next === "\r" && text[i + 1] === "\n")) {
        i += next === "\r" ? 2 : 1;
        endRecord();
        line += 1;
        recordLine = line;
        continue;
      }
      return fail("text_after_quote", dataRowOf(records.length), line);
    }

    let j = i;
    while (j < text.length) {
      const c = text[j] as string;
      if (c === "," || c === "\n") break;
      if (c === "\r") {
        if (text[j + 1] === "\n") break;
        return fail("bare_cr", dataRowOf(records.length), line);
      }
      if (c === '"') return fail("quote_in_unquoted_field", dataRowOf(records.length), line);
      j += 1;
    }
    record.push(text.slice(i, j));
    i = j;
    const next = text[i];
    if (next === undefined) {
      endRecord();
      break;
    }
    if (next === ",") {
      // A separator at the very end leaves one more, empty, field: the next pass reads it.
      i += 1;
      continue;
    }
    i += next === "\r" ? 2 : 1;
    endRecord();
    line += 1;
    recordLine = line;
  }
  return tableFrom(records, lines);
}

function splitLines(text: string): string[] {
  return text.split("\n").map((item) => (item.endsWith("\r") ? item.slice(0, -1) : item));
}

function parseTsv(source: string): ParseTableOutcome {
  const text = withoutTrailingBreaks(withoutBom(source));
  if (text.length === 0) return fail("empty", null, null);
  const physical = splitLines(text);
  for (const [index, item] of physical.entries()) {
    if (item.includes("\r")) return fail("bare_cr", dataRowOf(index), index + 1);
  }
  return tableFrom(
    physical.map((item) => item.split("\t")),
    physical.map((_item, index) => index + 1),
  );
}

function cellOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function parseJsonLines(source: string): ParseTableOutcome {
  const text = withoutTrailingBreaks(withoutBom(source));
  if (text.length === 0) return fail("empty", null, null);
  const objects: Record<string, unknown>[] = [];
  const columns: string[] = [];
  const known = new Set<string>();
  for (const [index, item] of splitLines(text).entries()) {
    const dataRow = index + 1;
    if (item.trim().length === 0) return fail("blank_line", dataRow, index + 1);
    let value: unknown;
    try {
      value = JSON.parse(item);
    } catch {
      return fail("not_json", dataRow, index + 1);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return fail("not_object", dataRow, index + 1);
    const object = value as Record<string, unknown>;
    for (const key of Object.keys(object)) {
      if (!known.has(key)) {
        known.add(key);
        columns.push(key);
      }
    }
    objects.push(object);
  }
  const rows = objects.map((object) => columns.map((column) => (Object.hasOwn(object, column) ? cellOf(object[column]) : "")));
  return { ok: true, table: { columns, rows } };
}

/** Parses a whole table text. Never throws for malformed input. */
export function parseTable(text: string, format: TableFormat): ParseTableOutcome {
  switch (format) {
    case "csv":
      return parseCsv(text);
    case "tsv":
      return parseTsv(text);
    case "jsonl":
      return parseJsonLines(text);
  }
}

export type ColumnLookup =
  | { readonly ok: true; readonly index: number }
  | { readonly ok: false; readonly problem: "missing" | "ambiguous" };

/** The column with exactly this name. A name that appears more than once in the header is ambiguous. */
export function findColumn(table: Table, name: string): ColumnLookup {
  let found = -1;
  for (const [index, column] of table.columns.entries()) {
    if (column !== name) continue;
    if (found >= 0) return { ok: false, problem: "ambiguous" };
    found = index;
  }
  return found < 0 ? { ok: false, problem: "missing" } : { ok: true, index: found };
}
