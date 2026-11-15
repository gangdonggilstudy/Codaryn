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
 *
 * U-202 (bundle A, A-2): the parsing itself is in stream.ts, which reads a table in pieces; this
 * module keeps the types, the whole-text `parseTable` built on it, and `findColumn`.
 */

import type { TableFormat } from "../contracts/index.js";
import { TableScanner } from "./stream.js";

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

/**
 * Parses a whole table text. Never throws for malformed input. U-202: the text goes through the
 * piecewise reader (stream.ts) as one piece, so a whole text and a table read in chunks give the
 * same rows and the same problem; this only gathers the rows.
 */
export function parseTable(text: string, format: TableFormat): ParseTableOutcome {
  const rows: (readonly string[])[] = [];
  const scanner = new TableScanner(format, { row: (cells) => rows.push(cells) });
  scanner.write(text);
  const outcome = scanner.end();
  if (!outcome.ok) return outcome;
  // A jsonl row holds the columns known when it came; a column first seen later is empty in it.
  const width = outcome.columns.length;
  const full = rows.map((cells) => (cells.length === width ? cells : [...cells, ...new Array<string>(width - cells.length).fill("")]));
  return { ok: true, table: { columns: outcome.columns, rows: full } };
}

export type ColumnLookup =
  | { readonly ok: true; readonly index: number }
  | { readonly ok: false; readonly problem: "missing" | "ambiguous" };

/**
 * The column with exactly this name. A name that appears more than once in the header is ambiguous.
 * U-202: it needs the columns only (a table read in pieces has no rows to give).
 */
export function findColumn(table: { readonly columns: readonly string[] }, name: string): ColumnLookup {
  let found = -1;
  for (const [index, column] of table.columns.entries()) {
    if (column !== name) continue;
    if (found >= 0) return { ok: false, problem: "ambiguous" };
    found = index;
  }
  return found < 0 ? { ok: false, problem: "missing" } : { ok: true, index: found };
}
