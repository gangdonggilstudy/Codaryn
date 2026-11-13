/**
 * The `data_checks` verifier (VF-04, G-D). See DataChecksVerifierConfig in src/contracts/verify.ts.
 *
 * Roles decide what a problem means. A source (an aggregate's `source`, a `rows.sameAs` table) is
 * input the model cannot fix: any problem with it makes the rule undecided (`inconclusive`). A
 * target (an aggregate's `target`, a `table_shape` table) is what the model wrote: a missing file,
 * a file that is too large or not UTF-8, a table that does not parse, a missing column or row, or a
 * value that disagrees makes the rule not hold (`fail`). A path the workspace rejects, a read error
 * and an invalid rule are undecided in both roles.
 *
 * Evidence names columns, data rows (1-based, the header not counted) and the two numbers compared.
 * It holds no other cell value: group keys and bad cells are named by their data row.
 *
 * Tables are read with `node:fs` from the path `Workspace.resolve` proved to be inside the root
 * (links resolved, the state directory refused), because `Workspace.readText` stops at
 * MAX_READ_BYTES and a data table may be larger (up to MAX_DATA_TABLE_BYTES).
 *
 * U-202 (bundle A, A-2, Q-7): a table is read in chunks (src/tabular/stream.ts) and each rule keeps
 * only what it needs while the rows go by: a shape keeps the columns and the row count, an aggregate
 * keeps a running value per group (RunningAggregate) and the target's keys and compared cells. The
 * outcome and the evidence are the ones of the whole-table reading before, letter for letter (the
 * frozen copy in tests/unit/verify/reference is compared with this one). The limit stays 16 MiB until
 * the PM sets it from the timings.
 *
 * U-223 (bundle A, A-7, proposal R-6): a source under the run's unreadable paths (an aggregate's
 * `source`, a `rows.sameAs` table) gives no number read from it in the evidence: not the recomputed
 * value, not how many cells or rows it has, not how many rows had no group value. The evidence says
 * which target row and column did not match, and that the source is under unreadable paths. The
 * verdict is the same. Otherwise a repair could learn a hidden group's value from the evidence (the
 * model writes a group of fewer than k rows; the verifier would compute its true value and hand it
 * back), which is the way around k. The paths are judged as the policy gate judges them: the same
 * matcher (compilePathSet, prefix, an unusable list covers everything), on the real path. Without
 * unreadable paths the evidence is as before, letter for letter.
 */

import fs from "node:fs/promises";

import { AGGREGATE_OPS, DEFAULT_DATA_TOLERANCE, MAX_DATA_TABLE_BYTES, TABLE_FORMATS } from "../contracts/index.js";
import type {
  AggregateOp,
  DataChecksVerifierConfig,
  DataRule,
  RawVerifierResult,
  RowCountRule,
  TableRef,
  Workspace,
} from "../contracts/index.js";
import { compilePathSet } from "../policy/path-set.js";
import type { PathSet } from "../policy/path-set.js";
import { RunningAggregate, findColumn, parseNumber, scanTable, withinTolerance } from "../tabular/index.js";
import type { AggregateOutcome, TableProblem, TableScanOutcome, TableSink, Tolerance } from "../tabular/index.js";
import { createRawVerifierResult } from "./result.js";

/** Most problems listed per rule; the rest are counted. */
export const MAX_LISTED_PROBLEMS = 20;
/** U-202: bytes read at a time. */
export const DATA_TABLE_CHUNK_BYTES = 64 * 1024;
/** Longest column name shown in evidence, in characters. */
const MAX_SHOWN_NAME = 80;

export const DATA_CHECKS_LIMITS: readonly string[] = [
  "only the listed table shapes and aggregates are checked; the method, the interpretation and any number written in prose are not",
  "tables are read as CSV (an RFC 4180 subset), TSV or JSON Lines of at most 16 MiB; numbers are plain decimals (-?digits[.digits][e±digits]) computed as doubles",
  "group values are compared as exact text, and rows whose group cell is empty are left out of the groups",
  "sum, min, max and mean cannot be checked (inconclusive) when the column, or any one group of a grouped rule, has only empty cells; sum and mean cannot be checked when a running sum goes beyond a double's range, which depends on the row order (the same values in another order may be checked)",
];

type Role = "source" | "target";
type State = "held" | "not_held" | "undecided";

interface Verdict {
  readonly state: State;
  readonly note: string;
}

const held = (note: string): Verdict => ({ state: "held", note });
const notHeld = (note: string): Verdict => ({ state: "not_held", note });
const undecided = (note: string): Verdict => ({ state: "undecided", note });

function shownName(name: string): string {
  const literal = JSON.stringify(name);
  return literal.length <= MAX_SHOWN_NAME ? literal : `${literal.slice(0, MAX_SHOWN_NAME - 4)}..."`;
}

function shownNames(names: readonly string[]): string {
  const listed = names.slice(0, MAX_LISTED_PROBLEMS).map(shownName).join(", ");
  return names.length > MAX_LISTED_PROBLEMS ? `[${listed}, … ${names.length - MAX_LISTED_PROBLEMS} more]` : `[${listed}]`;
}

function describeTable(ref: TableRef): string {
  return `"${String(ref.path)}" (${String(ref.format)})`;
}

function describeProblem(problem: TableProblem): string {
  const where = [
    problem.dataRow === null ? null : `data row ${problem.dataRow}`,
    problem.line === null ? null : `line ${problem.line}`,
  ].filter((item) => item !== null);
  return `${problem.code.replace(/_/g, " ")}${where.length > 0 ? ` at ${where.join(", ")}` : ""}`;
}

/** U-202: what a rule's tables are read with. */
interface Reading {
  readonly maxBytes: number;
  readonly chunkBytes: number;
  /** U-223 (R-6): the run's unreadable paths as the gate matches them; null when there are none. */
  readonly unreadable: PathSet | null;
}

/** U-223 (R-6): what the evidence says, once per rule, in place of the numbers read from such a source. */
export const UNREADABLE_SOURCE_NOTE = "the source is under unreadable paths, so no number read from it is written";
/**
 * U-223 (PM, after R-6): the same for a target under unreadable paths (an aggregate's `target`, a
 * `table_shape` table): no cell value read from it (the found number, nor a recomputed number that
 * agreed with it) and no row or group count of it. Row numbers are still named.
 */
export const UNREADABLE_TARGET_NOTE = "the target is under unreadable paths, so no cell value or row count read from it is written";

/** U-223: which tables of a rule are under unreadable paths. */
interface Hidden {
  readonly source: boolean;
  readonly target: boolean;
}

/**
 * U-223 (R-6): the matcher of the run's unreadable paths, as the policy gate builds it: prefix
 * matching, and a value that is not a list (or an entry the format refuses) covers everything.
 * Absent or empty: null, and nothing changes.
 */
function unreadableSet(value: unknown): PathSet | null {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return null;
  return compilePathSet(Array.isArray(value) ? value : "not a list", { match: "prefix", onUnusable: "covers" });
}

/**
 * A table read through: its columns and data rows, and (U-223) its real path relative to the root
 * as `Workspace.resolve` gave it; what else a rule needs its sink kept.
 */
type Loaded =
  | { readonly ok: true; readonly columns: readonly string[]; readonly rows: number; readonly relative: string }
  | { readonly ok: false; readonly fixable: boolean; readonly note: string };

/** U-223 (R-6): whether a table read through is under the run's unreadable paths (links resolved). */
async function isUnreadable(loaded: Extract<Loaded, { ok: true }>, workspace: Workspace, reading: Reading): Promise<boolean> {
  return reading.unreadable !== null && (await reading.unreadable.coversEffective(loaded.relative, workspace));
}

/** U-223: a verdict whose source or target is under unreadable paths says so once each, after its own note. */
function withUnreadableNotes(verdict: Verdict, hidden: Hidden): Verdict {
  const notes = [hidden.source ? UNREADABLE_SOURCE_NOTE : null, hidden.target ? UNREADABLE_TARGET_NOTE : null].filter((note): note is string => note !== null);
  return notes.length === 0 ? verdict : { state: verdict.state, note: [verdict.note, ...notes].join("; ") };
}

function isTableRef(value: unknown): value is TableRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as { path?: unknown; format?: unknown };
  return typeof ref.path === "string" && ref.path.length > 0 && (TABLE_FORMATS as readonly unknown[]).includes(ref.format);
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Reads one table through, in chunks, into `sink`. `fixable` marks problems the model could fix in
 * a file it wrote (missing, too large, not UTF-8, does not parse); the role decides what that means.
 * The problems rank as the whole-table reading ranked them: a read error, then the size, then UTF-8,
 * then parsing (scanTable reads to the end after a problem for that). A sink's error is not a read
 * error: it passes through to the verifier's "check failed".
 */
async function loadTable(ref: TableRef, workspace: Workspace, reading: Reading, sink: TableSink = {}): Promise<Loaded> {
  const { maxBytes } = reading;
  const resolved = await workspace.resolve(ref.path, "read");
  if (!resolved.ok) return { ok: false, fixable: false, note: `path rejected (${resolved.code})` };
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(resolved.path.absolute, "r");
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return { ok: false, fixable: true, note: "file not found" };
    return { ok: false, fixable: false, note: `file could not be opened (${code ?? "unknown error"})` };
  }
  const read = { bytes: 0, failed: false, error: undefined as unknown };
  let scanned: TableScanOutcome;
  try {
    let info: Awaited<ReturnType<fs.FileHandle["stat"]>>;
    try {
      info = await handle.stat();
    } catch (error) {
      return { ok: false, fixable: false, note: `file could not be read (${errorCode(error) ?? "unknown error"})` };
    }
    if (!info.isFile()) return { ok: false, fixable: true, note: "not a regular file" };
    if (info.size > maxBytes) return { ok: false, fixable: true, note: `larger than ${maxBytes} bytes` };
    // One byte more than allowed tells a file that grew after stat.
    const limit = Math.min(info.size, maxBytes) + 1;
    const buffer = Buffer.alloc(Math.max(1, Math.min(reading.chunkBytes, limit)));
    const file = handle;
    const chunks = async function* (): AsyncGenerator<Uint8Array> {
      while (read.bytes < limit) {
        let bytesRead: number;
        try {
          ({ bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, limit - read.bytes), read.bytes));
        } catch (error) {
          read.failed = true;
          read.error = error;
          return;
        }
        if (bytesRead === 0) return;
        read.bytes += bytesRead;
        // The decoder takes the chunk before the next read reuses the buffer.
        yield buffer.subarray(0, bytesRead);
      }
    };
    scanned = await scanTable(chunks(), ref.format, sink);
  } finally {
    await handle.close().catch(() => undefined);
  }
  if (read.failed) return { ok: false, fixable: false, note: `file could not be read (${errorCode(read.error) ?? "unknown error"})` };
  if (read.bytes > maxBytes) return { ok: false, fixable: true, note: `larger than ${maxBytes} bytes` };
  if (!scanned.ok) {
    // The default decoder drops a leading byte order mark (scanTable decodes as before).
    if (scanned.reason === "not_text") return { ok: false, fixable: true, note: "not UTF-8 text" };
    return { ok: false, fixable: true, note: `does not parse as ${ref.format}: ${describeProblem(scanned.problem)}` };
  }
  return { ok: true, columns: scanned.columns, rows: scanned.rows, relative: resolved.path.relative };
}

/** U-202: finds a column as `findColumn` does on the whole table, while the columns arrive (stream.ts). */
class ColumnAt {
  private index: number | null = null;

  constructor(private readonly name: string) {}

  see(columns: readonly string[]): void {
    if (this.index !== null) return;
    const found = findColumn({ columns }, this.name);
    if (found.ok) this.index = found.index;
  }

  /** The row's cell; empty while the column is not known (a jsonl row without the key, or a column the verdict refuses). */
  cell(cells: readonly string[]): string {
    return this.index === null ? "" : (cells[this.index] ?? "");
  }
}

/**
 * U-202: an aggregate's source as it is read: the running value of the column (without groupBy), or
 * per group in order of first appearance with its first data row, and the rows without a group
 * value, as `columnCells` and `groupCells` gave them over the whole table.
 */
class SourceTally implements TableSink {
  readonly total: RunningAggregate;
  readonly groups = new Map<string, { readonly firstDataRow: number; readonly aggregate: RunningAggregate }>();
  withoutKey = 0;
  private readonly column: ColumnAt;
  private readonly key: ColumnAt | null;

  constructor(column: string, groupBy: string | null, private readonly op: AggregateOp) {
    this.total = new RunningAggregate(op);
    this.column = new ColumnAt(column);
    this.key = groupBy === null ? null : new ColumnAt(groupBy);
  }

  columns(columns: readonly string[]): void {
    this.column.see(columns);
    this.key?.see(columns);
  }

  row(cells: readonly string[], dataRow: number): void {
    const cell = this.column.cell(cells);
    if (this.key === null) {
      this.total.add(cell, dataRow);
      return;
    }
    const key = this.key.cell(cells);
    if (key.length === 0) {
      this.withoutKey += 1;
      return;
    }
    let group = this.groups.get(key);
    if (group === undefined) {
      group = { firstDataRow: dataRow, aggregate: new RunningAggregate(this.op) };
      this.groups.set(key, group);
    }
    group.aggregate.add(cell, dataRow);
  }
}

/**
 * U-202: an aggregate's target as it is read: without groupBy, the compared cell of data row 1; with
 * it, the data rows whose key is empty (in order), and per key in order of first appearance its data
 * rows and the compared cell of the first of them (the only one compared).
 */
class TargetTally implements TableSink {
  firstCell = "";
  readonly emptyKeyRows: number[] = [];
  readonly byKey = new Map<string, { readonly rows: number[]; readonly cell: string }>();
  private readonly column: ColumnAt;
  private readonly key: ColumnAt | null;

  constructor(column: string, keyColumn: string | null) {
    this.column = new ColumnAt(column);
    this.key = keyColumn === null ? null : new ColumnAt(keyColumn);
  }

  columns(columns: readonly string[]): void {
    this.column.see(columns);
    this.key?.see(columns);
  }

  row(cells: readonly string[], dataRow: number): void {
    if (this.key === null) {
      if (dataRow === 1) this.firstCell = this.column.cell(cells);
      return;
    }
    const key = this.key.cell(cells);
    if (key.length === 0) {
      this.emptyKeyRows.push(dataRow);
      return;
    }
    const entry = this.byKey.get(key);
    if (entry === undefined) this.byKey.set(key, { rows: [dataRow], cell: this.column.cell(cells) });
    else entry.rows.push(dataRow);
  }
}

/** What a load problem means for a table in this role. */
function loadVerdict(role: Role, ref: TableRef, loaded: Extract<Loaded, { ok: false }>): Verdict {
  const note = `${role} ${describeTable(ref)}: ${loaded.note}`;
  return role === "target" && loaded.fixable ? notHeld(note) : undecided(note);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function describeRows(rows: RowCountRule): string {
  if ("equals" in rows) return `exactly ${rows.equals} data rows`;
  if ("sameAs" in rows) return `as many data rows as ${isTableRef(rows.sameAs) ? describeTable(rows.sameAs) : "another table"}`;
  const parts = [rows.min === undefined ? null : `at least ${rows.min}`, rows.max === undefined ? null : `at most ${rows.max}`];
  return `${parts.filter((item) => item !== null).join(" and ")} data rows`;
}

/** A label for `checked`, built from the rule (configuration text, not table content). */
export function describeDataRule(rule: DataRule): string {
  if (rule.type === "table_shape") {
    const parts: string[] = [];
    if (rule.columns !== undefined) {
      parts.push(`${rule.columnsMatch === "includes" ? "includes the columns" : "has exactly the columns"} ${shownNames(rule.columns)}`);
    }
    if (rule.rows !== undefined) parts.push(`has ${describeRows(rule.rows)}`);
    return `table ${describeTable(rule.table)} ${parts.length > 0 ? parts.join(" and ") : "parses"}`;
  }
  const grouped = rule.groupBy === undefined ? "" : ` grouped by ${shownName(rule.groupBy)}`;
  const key = rule.targetKeyColumn === undefined ? "" : ` (key column ${shownName(rule.targetKeyColumn)})`;
  const tolerance = toleranceOf(rule.tolerance);
  return (
    `${rule.op} of ${shownName(rule.column)} in ${describeTable(rule.source)}${grouped} matches ` +
    `${shownName(rule.targetColumn)} in ${describeTable(rule.target)}${key} within ` +
    `absolute ${tolerance?.absolute ?? "?"}, relative ${tolerance?.relative ?? "?"}`
  );
}

function toleranceOf(given: unknown): Tolerance | null {
  if (given === undefined) return DEFAULT_DATA_TOLERANCE;
  if (typeof given !== "object" || given === null) return null;
  const { absolute, relative } = given as { absolute?: unknown; relative?: unknown };
  const valid = (value: unknown): boolean => value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (!valid(absolute) || !valid(relative)) return null;
  return {
    absolute: (absolute as number | undefined) ?? DEFAULT_DATA_TOLERANCE.absolute,
    relative: (relative as number | undefined) ?? DEFAULT_DATA_TOLERANCE.relative,
  };
}

/** Collects problems and reports the first MAX_LISTED_PROBLEMS of them. */
class Problems {
  private readonly listed: string[] = [];
  private count = 0;
  add(note: string): void {
    this.count += 1;
    if (this.listed.length < MAX_LISTED_PROBLEMS) this.listed.push(note);
  }
  get size(): number {
    return this.count;
  }
  text(): string {
    const more = this.count - this.listed.length;
    return `${this.listed.join("; ")}${more > 0 ? `; … ${more} more` : ""}`;
  }
}

async function checkShape(
  rule: Extract<DataRule, { type: "table_shape" }>,
  workspace: Workspace,
  reading: Reading,
): Promise<Verdict> {
  if (!isTableRef(rule.table)) return undecided("the rule is not valid: table needs a path and a format (csv, tsv or jsonl)");
  if (rule.columns !== undefined && !(Array.isArray(rule.columns) && rule.columns.every((name) => typeof name === "string"))) {
    return undecided("the rule is not valid: columns must be a list of names");
  }
  const match = rule.columnsMatch ?? "exact";
  if (match !== "exact" && match !== "includes") return undecided('the rule is not valid: columnsMatch must be "exact" or "includes"');

  const loaded = await loadTable(rule.table, workspace, reading);
  if (!loaded.ok) return loadVerdict("target", rule.table, loaded);
  const table = loaded;
  const problems = new Problems();
  const notes: string[] = [];
  /** U-223 (R-6): the `rows.sameAs` table is under unreadable paths: its row count is not written. */
  let hiddenSource = false;
  /** U-223 (PM): the checked table is under unreadable paths: its row count is not written. */
  const hiddenTable = await isUnreadable(table, workspace, reading);
  const shownRange = (rule: RowCountRule): string => `the data rows do not fit: expected ${describeRows(rule)}`;

  if (rule.columns !== undefined) {
    const expected = rule.columns;
    const ok =
      match === "exact"
        ? expected.length === table.columns.length && expected.every((name, index) => table.columns[index] === name)
        : expected.every((name) => table.columns.includes(name));
    if (ok) notes.push(`columns as required`);
    else if (match === "exact") problems.add(`columns ${shownNames(table.columns)}, expected exactly ${shownNames(expected)}`);
    else problems.add(`missing columns ${shownNames(expected.filter((name) => !table.columns.includes(name)))}`);
  }

  if (rule.rows !== undefined) {
    const rows = rule.rows as Partial<{ equals: unknown; min: unknown; max: unknown; sameAs: unknown }>;
    const forms = ["equals", "sameAs"].filter((name) => (rows as Record<string, unknown>)[name] !== undefined).length;
    const ranged = rows.min !== undefined || rows.max !== undefined;
    if (forms + (ranged ? 1 : 0) !== 1) return undecided("the rule is not valid: rows needs exactly one of equals, min/max or sameAs");
    const count = table.rows;
    if (rows.equals !== undefined) {
      if (!isCount(rows.equals)) return undecided("the rule is not valid: rows.equals must be a whole number");
      if (count === rows.equals) notes.push(hiddenTable ? "data rows as required" : `${count} data rows`);
      else if (hiddenTable) problems.add(shownRange({ equals: rows.equals }));
      else problems.add(`${count} data rows, expected ${rows.equals}`);
    } else if (rows.sameAs !== undefined) {
      if (!isTableRef(rows.sameAs)) return undecided("the rule is not valid: rows.sameAs needs a path and a format");
      const other = await loadTable(rows.sameAs, workspace, reading);
      if (!other.ok) return loadVerdict("source", rows.sameAs, other);
      const expected = other.rows;
      hiddenSource = await isUnreadable(other, workspace, reading);
      const as = describeTable(rows.sameAs);
      if (count === expected) notes.push(hiddenTable ? `as many data rows as ${as}` : `${count} data rows, as ${as}`);
      else if (hiddenTable && hiddenSource) problems.add(`not as many data rows as ${as}`);
      else if (hiddenTable) problems.add(`the data rows do not fit: expected ${expected} as ${as}`);
      else if (hiddenSource) problems.add(`${count} data rows, not as many as ${as}`);
      else problems.add(`${count} data rows, expected ${expected} as ${as}`);
    } else {
      if ((rows.min !== undefined && !isCount(rows.min)) || (rows.max !== undefined && !isCount(rows.max))) {
        return undecided("the rule is not valid: rows.min and rows.max must be whole numbers");
      }
      const min = rows.min as number | undefined;
      const max = rows.max as number | undefined;
      const range = { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
      if ((min === undefined || count >= min) && (max === undefined || count <= max)) notes.push(hiddenTable ? "data rows as required" : `${count} data rows`);
      else if (hiddenTable) problems.add(shownRange(range));
      else problems.add(`${count} data rows, expected ${describeRows(range)}`);
    }
  }

  const verdict = problems.size > 0 ? notHeld(problems.text()) : held(notes.length > 0 ? notes.join("; ") : "the table parses");
  return withUnreadableNotes(verdict, { source: hiddenSource, target: hiddenTable });
}

/** What an aggregate problem in the source means: the model cannot fix the input. */
function sourceProblem(outcome: Extract<AggregateOutcome, { ok: false }>, column: string, scope: string): Verdict {
  switch (outcome.problem) {
    case "not_a_number":
      return undecided(`source data row ${outcome.dataRow} of column ${shownName(column)} is not a number${scope}`);
    case "no_values":
      return undecided(`source column ${shownName(column)} has no number to compute${scope}`);
    case "out_of_range":
      // R-13 L-1: the source's numbers overflow a double while being added; the target cannot fix that.
      return undecided(`the computation over source column ${shownName(column)} is out of range of a double${scope}`);
  }
}

function compareValue(
  recomputed: number,
  cell: string,
  targetRow: number,
  targetColumn: string,
  tolerance: Tolerance,
  problems: Problems,
  label: string,
  hidden: Hidden,
): boolean {
  const found = cell.length === 0 ? null : parseNumber(cell);
  if (found === null) {
    problems.add(`target data row ${targetRow} of column ${shownName(targetColumn)} is ${cell.length === 0 ? "empty" : "not a number"}${label}`);
    return false;
  }
  if (withinTolerance(recomputed, found, tolerance)) return true;
  // U-223 (R-6): neither number for a source under unreadable paths, only where it did not match;
  // for a target under them (PM) not its own number: the recomputed one comes from a readable source.
  const where = `target data row ${targetRow} of column ${shownName(targetColumn)} does not match${label}`;
  if (hidden.source) problems.add(where);
  else if (hidden.target) problems.add(`${where}: recomputed ${recomputed}`);
  else problems.add(`target data row ${targetRow}${label}: recomputed ${recomputed}, found ${found}`);
  return false;
}

async function checkAggregate(
  rule: Extract<DataRule, { type: "aggregate_match" }>,
  workspace: Workspace,
  reading: Reading,
): Promise<Verdict> {
  if (!isTableRef(rule.source) || !isTableRef(rule.target)) return undecided("the rule is not valid: source and target need a path and a format");
  if (typeof rule.column !== "string" || typeof rule.targetColumn !== "string") return undecided("the rule is not valid: column and targetColumn are required");
  if (!(AGGREGATE_OPS as readonly unknown[]).includes(rule.op)) return undecided("the rule is not valid: op must be sum, count, min, max or mean");
  const grouped = rule.groupBy !== undefined;
  if (grouped !== (rule.targetKeyColumn !== undefined)) return undecided("the rule is not valid: groupBy and targetKeyColumn go together");
  if (grouped && (typeof rule.groupBy !== "string" || typeof rule.targetKeyColumn !== "string")) {
    return undecided("the rule is not valid: groupBy and targetKeyColumn must be column names");
  }
  const tolerance = toleranceOf(rule.tolerance);
  if (tolerance === null) return undecided("the rule is not valid: tolerance values must be finite non-negative numbers");
  const op: AggregateOp = rule.op;

  // U-202: each table is read once, its tally kept by the rule's columns; the verdict below asks in
  // the order the whole-table reading asked (columns first, then the computed values).
  const sourceTally = new SourceTally(rule.column, grouped ? (rule.groupBy as string) : null, op);
  const source = await loadTable(rule.source, workspace, reading, sourceTally);
  if (!source.ok) return loadVerdict("source", rule.source, source);
  // U-223 (R-6): every verdict from here on says once that the source is under unreadable paths,
  // and none of them writes a number read from it; the same for the target (PM), once it is read.
  const hidden: { source: boolean; target: boolean } = { source: await isUnreadable(source, workspace, reading), target: false };
  const finish = (verdict: Verdict): Verdict => withUnreadableNotes(verdict, hidden);
  const targetTally = new TargetTally(rule.targetColumn, grouped ? (rule.targetKeyColumn as string) : null);
  const target = await loadTable(rule.target, workspace, reading, targetTally);
  if (!target.ok) return finish(loadVerdict("target", rule.target, target));
  hidden.target = await isUnreadable(target, workspace, reading);

  const sourceColumn = findColumn(source, rule.column);
  if (!sourceColumn.ok) return finish(undecided(`source column ${shownName(rule.column)} is ${sourceColumn.problem}`));
  const targetColumn = findColumn(target, rule.targetColumn);
  if (!targetColumn.ok) return finish(notHeld(`target column ${shownName(rule.targetColumn)} is ${targetColumn.problem}`));
  const problems = new Problems();

  if (!grouped) {
    const outcome = sourceTally.total.result();
    if (!outcome.ok) return finish(sourceProblem(outcome, rule.column, ""));
    if (target.rows !== 1) return finish(notHeld(hidden.target ? "target does not have exactly 1 data row" : `target has ${target.rows} data rows; expected exactly 1`));
    const cell = targetTally.firstCell;
    if (compareValue(outcome.value, cell, 1, rule.targetColumn, tolerance, problems, "", hidden)) {
      // The recomputed number agrees with the target's own: written for neither hidden table.
      return finish(held(hidden.source || hidden.target ? "target data row 1 agrees" : `recomputed ${outcome.value} from ${outcome.values} cells; target data row 1 agrees`));
    }
    return finish(notHeld(problems.text()));
  }

  const groupBy = rule.groupBy as string;
  const keyName = rule.targetKeyColumn as string;
  const keyColumn = findColumn(source, groupBy);
  if (!keyColumn.ok) return finish(undecided(`source column ${shownName(groupBy)} is ${keyColumn.problem}`));
  const targetKey = findColumn(target, keyName);
  if (!targetKey.ok) return finish(notHeld(`target column ${shownName(keyName)} is ${targetKey.problem}`));

  // R-13 L-2 (PM decision: kept, and named in DATA_CHECKS_LIMITS): a group without any number in the
  // column leaves the whole rule undecided, like every other source problem.
  const computed = new Map<string, { value: number; firstDataRow: number }>();
  for (const [key, group] of sourceTally.groups) {
    const outcome = group.aggregate.result();
    if (!outcome.ok) return finish(sourceProblem(outcome, rule.column, ` (group first seen at source data row ${group.firstDataRow})`));
    computed.set(key, { value: outcome.value, firstDataRow: group.firstDataRow });
  }

  for (const dataRow of targetTally.emptyKeyRows) problems.add(`target data row ${dataRow} has an empty key`);
  const targetRows = targetTally.byKey;
  let agreed = 0;
  for (const [key, { value, firstDataRow }] of computed) {
    const entry = targetRows.get(key);
    const label = ` (group first seen at source data row ${firstDataRow})`;
    if (entry === undefined) {
      problems.add(`no target row for the group first seen at source data row ${firstDataRow}`);
      continue;
    }
    const rows = entry.rows;
    if (rows.length > 1) {
      problems.add(`target data rows ${rows.join(", ")} have the same key${label}`);
      continue;
    }
    const targetRow = rows[0] as number;
    if (compareValue(value, entry.cell, targetRow, rule.targetColumn, tolerance, problems, label, hidden)) agreed += 1;
  }
  for (const [key, { rows }] of targetRows) {
    if (!computed.has(key)) problems.add(`target data row ${rows[0]} has a key that no source row has`);
  }
  // U-223 (R-6): how many source rows had no group value is a number read from the source.
  const skipped =
    sourceTally.withoutKey === 0 ? "" : hidden.source ? "; source rows without a group value left out" : `; ${sourceTally.withoutKey} source rows without a group value left out`;
  if (problems.size > 0) return finish(notHeld(`${problems.text()}${skipped}`));
  // How many groups agreed is how many rows the target has.
  return finish(held(hidden.target ? `the groups agree${skipped}` : `${agreed} groups agree${skipped}`));
}

async function checkRule(rule: DataRule, workspace: Workspace, reading: Reading): Promise<Verdict> {
  if (typeof rule !== "object" || rule === null) return undecided("the rule is not valid");
  if (rule.type === "table_shape") return checkShape(rule, workspace, reading);
  if (rule.type === "aggregate_match") return checkAggregate(rule, workspace, reading);
  return undecided("the rule is not valid: unknown type");
}

function safeLabel(rule: DataRule): string {
  try {
    return describeDataRule(rule);
  } catch {
    return "a data rule that is not valid";
  }
}

export interface DataChecksOptions {
  /** Largest table read, in bytes. Defaults to MAX_DATA_TABLE_BYTES; tests lower it. */
  readonly maxTableBytes?: number;
  /** U-202: bytes read at a time. Defaults to DATA_TABLE_CHUNK_BYTES; tests make it small to split everything. */
  readonly chunkBytes?: number;
  /**
   * U-223 (R-6): the run's unreadable paths, every source united (ResolvedTaskSpec.unreadablePaths).
   * A source under them gives no number read from it in the evidence; the verdict is the same.
   * Absent or empty: none, and the result is as before. A value that is not a list covers everything.
   */
  readonly unreadablePaths?: readonly string[];
}

export async function runDataChecksVerifier(
  config: DataChecksVerifierConfig,
  workspace: Workspace,
  signal: AbortSignal,
  options: DataChecksOptions = {},
): Promise<RawVerifierResult> {
  const reading: Reading = {
    maxBytes: options.maxTableBytes ?? MAX_DATA_TABLE_BYTES,
    chunkBytes: Math.max(1, Math.floor(options.chunkBytes ?? DATA_TABLE_CHUNK_BYTES)),
    unreadable: unreadableSet(options.unreadablePaths),
  };
  const rules = Array.isArray(config.rules) ? config.rules : [];
  if (rules.length === 0) {
    return createRawVerifierResult({
      id: config.id,
      kind: "data_checks",
      outcome: "inconclusive",
      evidence: "the verifier has no rules, so nothing was checked",
      checked: ["that the verifier has at least one rule"],
      limits: [],
    });
  }
  const checked: string[] = [];
  const lines: string[] = [];
  let failed = false;
  let open = false;
  for (const rule of rules) {
    const label = safeLabel(rule);
    checked.push(label);
    let verdict: Verdict;
    if (signal.aborted) {
      verdict = undecided("cancelled before this rule was checked");
    } else {
      try {
        verdict = await checkRule(rule, workspace, reading);
      } catch (error) {
        verdict = undecided(`check failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (verdict.state === "not_held") failed = true;
    if (verdict.state === "undecided") open = true;
    lines.push(`${verdict.state.replace("_", " ")}: ${label} (${verdict.note})`);
  }
  return createRawVerifierResult({
    id: config.id,
    kind: "data_checks",
    outcome: failed ? "fail" : open ? "inconclusive" : "pass",
    evidence: lines.join("\n"),
    checked,
    limits: DATA_CHECKS_LIMITS,
  });
}
