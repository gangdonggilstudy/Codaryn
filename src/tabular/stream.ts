/**
 * U-202 (P1 bundle A, unit A-2; proposal docs/reviews/2026-11-13-p1-bundle-proposal.md 3.1, Q-5,
 * Q-7): a table read in pieces. The bytes come in chunks, are decoded as UTF-8 as they come, and
 * each record goes to a sink as soon as it is complete, so neither the table's text nor its rows are
 * held: what stays in memory is the record being read and whatever the sink keeps (data_checks'
 * groups, query_table's groups). Pure: reads no file; the caller hands the chunks.
 *
 * The result is the one `parseTable` gives for the whole text (table.ts states the formats), the
 * same rows, the same problem with the same data row and line, whatever the chunks are:
 * - one leading byte order mark is ignored (and the UTF-8 decoder drops one before it, as the
 *   whole-text reading of data_checks did);
 * - line breaks at the very end are ignored: a run of CR and LF at the end of a chunk is held back
 *   until text other than a line break follows, and dropped at the end;
 * - csv and tsv: a quoting or CR problem anywhere outranks a field count problem anywhere, because
 *   the whole text parsed before field counts were compared; so the first field count problem is
 *   kept while the rest is still read for such problems, and no row goes to the sink after it;
 * - jsonl: the columns are the keys in order of first appearance, known in full only at the end. A
 *   row comes with the cells of the columns known by then; a column first seen in a later row is an
 *   empty cell of this one (that row has no such key), as the whole-text reading filled it.
 * - a text that is not UTF-8 is `not_text` even when a parse problem came first, and the chunks are
 *   still read to their end, because the whole-text reading decoded everything before parsing (a
 *   caller that limits the size or meets a read error tells that first).
 */

import type { TableFormat } from "../contracts/index.js";
import type { TableProblem, TableProblemCode } from "./table.js";

/** Where a scan sends what it reads. Both are optional: a scan without a sink only checks the table. */
export interface TableSink {
  /**
   * The columns known so far. csv and tsv give the header once, before any row. jsonl gives the list
   * again, longer, each time a row brings a key not seen before, just before that row.
   */
  columns?(columns: readonly string[]): void;
  /**
   * One data row (1-based, the header not counted). Its cells line up with the columns known when
   * it comes; a jsonl row may be shorter than the final list (a missing cell is empty). No row comes
   * after a problem is found, but rows before it did: a sink's tally counts only when the scan's
   * outcome is ok.
   */
  row?(cells: readonly string[], dataRow: number): void;
}

/** The outcome of reading a table's text. */
export type TableTextOutcome =
  | { readonly ok: true; readonly columns: readonly string[]; readonly rows: number }
  | { readonly ok: false; readonly problem: TableProblem };

/** The outcome of reading a table's bytes. */
export type TableScanOutcome =
  | { readonly ok: true; readonly columns: readonly string[]; readonly rows: number }
  /** The bytes are not UTF-8. */
  | { readonly ok: false; readonly reason: "not_text" }
  /** The text does not parse as its format. */
  | { readonly ok: false; readonly reason: "not_table"; readonly problem: TableProblem };

interface FormatParser {
  /** A problem was found: nothing more needs to be read. */
  readonly stopped: boolean;
  /** Text that is not empty and does not end with a line break. */
  feed(text: string): void;
  finish(): TableTextOutcome;
}

const LF = 10;
const CR = 13;
const QUOTE = 34;
const COMMA = 44;
const BOM = 0xfeff;

const EMPTY: TableTextOutcome = { ok: false, problem: { code: "empty", dataRow: null, line: null } };

function problemAt(code: TableProblemCode, record: number, line: number): TableProblem {
  // Record 0 is the header: no data row.
  return { code, dataRow: record === 0 ? null : record, line };
}

/** csv and tsv records: the first is the header; the first data row of another width is kept. */
class Records {
  private header: string[] | null = null;
  /** Records completed, the header included. */
  count = 0;
  private fieldCount: TableProblem | null = null;

  constructor(private readonly sink: TableSink) {}

  add(record: string[], line: number): void {
    const index = this.count;
    this.count += 1;
    if (this.header === null) {
      this.header = record;
      this.sink.columns?.(record);
      return;
    }
    if (this.fieldCount !== null) return;
    if (record.length !== this.header.length) {
      this.fieldCount = problemAt("field_count", index, line);
      return;
    }
    this.sink.row?.(record, index);
  }

  outcome(): TableTextOutcome {
    if (this.header === null) return EMPTY;
    if (this.fieldCount !== null) return { ok: false, problem: this.fieldCount };
    return { ok: true, columns: this.header, rows: this.count - 1 };
  }
}

const FIELD_START = 0;
const UNQUOTED = 1;
const UNQUOTED_CR = 2;
const QUOTED = 3;
const QUOTED_QUOTE = 4;
const AFTER_QUOTE = 5;
const AFTER_QUOTE_CR = 6;

/** table.ts's csv, one character state at a time, so a record may span chunks. */
class CsvParser implements FormatParser {
  private readonly records: Records;
  private record: string[] = [];
  private field = "";
  private state = FIELD_START;
  /** The physical line being read, and the one where the current record started. */
  private line = 1;
  private recordLine = 1;
  private fed = false;
  private problem: TableProblem | null = null;

  constructor(sink: TableSink) {
    this.records = new Records(sink);
  }

  get stopped(): boolean {
    return this.problem !== null;
  }

  private fail(code: TableProblemCode, line: number): void {
    this.problem = problemAt(code, this.records.count, line);
  }

  private endField(): void {
    this.record.push(this.field);
    this.field = "";
  }

  private endRecord(): void {
    this.records.add(this.record, this.recordLine);
    this.record = [];
    this.line += 1;
    this.recordLine = this.line;
  }

  feed(text: string): void {
    this.fed = true;
    const n = text.length;
    let i = 0;
    while (i < n) {
      switch (this.state) {
        case FIELD_START:
          if (text.charCodeAt(i) === QUOTE) {
            this.state = QUOTED;
            i += 1;
          } else {
            this.state = UNQUOTED;
          }
          break;
        case UNQUOTED: {
          let j = i;
          let c = 0;
          while (j < n) {
            c = text.charCodeAt(j);
            if (c === COMMA || c === LF || c === CR || c === QUOTE) break;
            j += 1;
          }
          if (j > i) this.field += text.slice(i, j);
          if (j === n) return;
          if (c === QUOTE) return this.fail("quote_in_unquoted_field", this.line);
          i = j + 1;
          if (c === COMMA) {
            this.endField();
            this.state = FIELD_START;
          } else if (c === LF) {
            this.endField();
            this.endRecord();
            this.state = FIELD_START;
          } else {
            // A CR: only CRLF ends a record; the next character decides.
            this.state = UNQUOTED_CR;
          }
          break;
        }
        case UNQUOTED_CR:
          if (text.charCodeAt(i) !== LF) return this.fail("bare_cr", this.line);
          i += 1;
          this.endField();
          this.endRecord();
          this.state = FIELD_START;
          break;
        case QUOTED: {
          let j = i;
          while (j < n) {
            const c = text.charCodeAt(j);
            if (c === QUOTE) break;
            if (c === LF) this.line += 1;
            j += 1;
          }
          if (j > i) this.field += text.slice(i, j);
          if (j === n) return;
          i = j + 1;
          // A doubled quote is one quote; anything else after it closes the field.
          this.state = QUOTED_QUOTE;
          break;
        }
        case QUOTED_QUOTE:
          if (text.charCodeAt(i) === QUOTE) {
            this.field += '"';
            i += 1;
            this.state = QUOTED;
          } else {
            this.state = AFTER_QUOTE;
          }
          break;
        case AFTER_QUOTE: {
          const c = text.charCodeAt(i);
          if (c === COMMA) {
            i += 1;
            this.endField();
            this.state = FIELD_START;
          } else if (c === LF) {
            i += 1;
            this.endField();
            this.endRecord();
            this.state = FIELD_START;
          } else if (c === CR) {
            i += 1;
            this.state = AFTER_QUOTE_CR;
          } else {
            return this.fail("text_after_quote", this.line);
          }
          break;
        }
        case AFTER_QUOTE_CR:
          if (text.charCodeAt(i) !== LF) return this.fail("text_after_quote", this.line);
          i += 1;
          this.endField();
          this.endRecord();
          this.state = FIELD_START;
          break;
      }
    }
  }

  finish(): TableTextOutcome {
    if (this.problem !== null) return { ok: false, problem: this.problem };
    if (!this.fed) return EMPTY;
    if (this.state === QUOTED) return { ok: false, problem: problemAt("unterminated_quote", this.records.count, this.recordLine) };
    // The text never ends with a line break (TableScanner holds those back), so a field start at the
    // end follows a separator: one more, empty, field.
    if (this.state !== FIELD_START || this.record.length > 0) {
      this.endField();
      this.endRecord();
    }
    return this.records.outcome();
  }
}

/** Splits fed text into physical lines (LF), one trailing CR taken off each, as table.ts's splitLines. */
abstract class LineParser implements FormatParser {
  private current = "";
  private fed = false;
  /** Physical lines completed. */
  protected index = 0;
  protected problem: TableProblem | null = null;

  get stopped(): boolean {
    return this.problem !== null;
  }

  feed(text: string): void {
    this.fed = true;
    let start = 0;
    for (;;) {
      const lf = text.indexOf("\n", start);
      if (lf < 0) {
        this.current += text.slice(start);
        return;
      }
      const raw = this.current + text.slice(start, lf);
      this.current = "";
      this.endLine(raw);
      if (this.problem !== null) return;
      start = lf + 1;
    }
  }

  private endLine(raw: string): void {
    const item = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const index = this.index;
    this.index += 1;
    this.take(item, index);
  }

  /** One physical line without its line break; `index` is 0-based. */
  protected abstract take(item: string, index: number): void;
  protected abstract complete(): TableTextOutcome;

  finish(): TableTextOutcome {
    if (this.problem !== null) return { ok: false, problem: this.problem };
    if (!this.fed) return EMPTY;
    // The text never ends with a line break, so what is left is the last line.
    this.endLine(this.current);
    this.current = "";
    if (this.problem !== null) return { ok: false, problem: this.problem };
    return this.complete();
  }
}

/** table.ts's tsv: TAB separated, no quoting; a CR inside a line is `bare_cr`. */
class TsvParser extends LineParser {
  private readonly records: Records;

  constructor(sink: TableSink) {
    super();
    this.records = new Records(sink);
  }

  protected take(item: string, index: number): void {
    if (item.includes("\r")) {
      this.problem = problemAt("bare_cr", index, index + 1);
      return;
    }
    this.records.add(item.split("\t"), index + 1);
  }

  protected complete(): TableTextOutcome {
    return this.records.outcome();
  }
}

/** table.ts's cell of a JSON value. */
function cellOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** table.ts's jsonl: one object per line; a parser's own message never leaves this function. */
class JsonLinesParser extends LineParser {
  private readonly columns: string[] = [];
  private readonly known = new Set<string>();

  constructor(private readonly sink: TableSink) {
    super();
  }

  protected take(item: string, index: number): void {
    const dataRow = index + 1;
    if (item.trim().length === 0) {
      this.problem = { code: "blank_line", dataRow, line: dataRow };
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(item);
    } catch {
      this.problem = { code: "not_json", dataRow, line: dataRow };
      return;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      this.problem = { code: "not_object", dataRow, line: dataRow };
      return;
    }
    const object = value as Record<string, unknown>;
    let grew = false;
    for (const key of Object.keys(object)) {
      if (this.known.has(key)) continue;
      this.known.add(key);
      this.columns.push(key);
      grew = true;
    }
    if (grew) this.sink.columns?.(this.columns.slice());
    if (this.sink.row !== undefined) {
      this.sink.row(
        this.columns.map((column) => (Object.hasOwn(object, column) ? cellOf(object[column]) : "")),
        dataRow,
      );
    }
  }

  protected complete(): TableTextOutcome {
    return { ok: true, columns: this.columns, rows: this.index };
  }
}

function parserFor(format: TableFormat, sink: TableSink): FormatParser {
  switch (format) {
    case "csv":
      return new CsvParser(sink);
    case "tsv":
      return new TsvParser(sink);
    case "jsonl":
      return new JsonLinesParser(sink);
  }
}

const isBreak = (code: number): boolean => code === LF || code === CR;

/**
 * A table's text in pieces: `write` each piece in order, then `end` once. One leading byte order
 * mark is dropped and the line breaks at the very end are ignored, as `parseTable` does for the whole
 * text. Never throws for malformed input (a sink may).
 */
export class TableScanner {
  private readonly parser: FormatParser;
  private started = false;
  /** Line breaks at the end of the text so far: dropped if nothing else follows. */
  private held = "";
  private ended = false;

  constructor(format: TableFormat, sink: TableSink = {}) {
    this.parser = parserFor(format, sink);
  }

  write(piece: string): void {
    if (this.ended) throw new Error("TableScanner.write after end");
    if (this.parser.stopped || piece.length === 0) return;
    let text = piece;
    if (!this.started) {
      this.started = true;
      if (text.charCodeAt(0) === BOM) text = text.slice(1);
    }
    let end = text.length;
    while (end > 0 && isBreak(text.charCodeAt(end - 1))) end -= 1;
    if (end === 0) {
      this.held += text;
      return;
    }
    const body = text.slice(0, end);
    this.parser.feed(this.held.length > 0 ? this.held + body : body);
    this.held = text.slice(end);
  }

  end(): TableTextOutcome {
    if (this.ended) throw new Error("TableScanner.end twice");
    this.ended = true;
    this.held = "";
    return this.parser.finish();
  }
}

/**
 * Reads a table from its bytes, chunk by chunk, into `sink`. Chunks may split anything, a UTF-8
 * sequence or a CRLF included; a chunk may be reused by its producer once the next is asked for.
 * The chunks are read to their end even after a problem (see the module's note). An error the
 * chunks throw (a read error) passes through.
 */
export async function scanTable(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  format: TableFormat,
  sink: TableSink = {},
): Promise<TableScanOutcome> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const scanner = new TableScanner(format, sink);
  let notText = false;
  for await (const chunk of chunks) {
    if (notText) continue;
    let text: string;
    try {
      text = decoder.decode(chunk, { stream: true });
    } catch {
      notText = true;
      continue;
    }
    scanner.write(text);
  }
  if (!notText) {
    // Only the decoder's end is guarded: a sink's error must pass through, not read as "not UTF-8".
    let rest = "";
    try {
      rest = decoder.decode();
    } catch {
      notText = true;
    }
    if (!notText) scanner.write(rest);
  }
  if (notText) return { ok: false, reason: "not_text" };
  const outcome = scanner.end();
  return outcome.ok ? outcome : { ok: false, reason: "not_table", problem: outcome.problem };
}
