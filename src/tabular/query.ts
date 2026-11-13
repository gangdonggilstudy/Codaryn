/**
 * U-202 (P1 bundle A, unit A-2): the table reading `query_table` runs (A-5 adds the tool), in the
 * shapes of its contract (src/contracts/query.ts): a query's groups (`QueryGroup`) and a table's
 * shape (`QueryColumnShape`), computed while the table is read in pieces (stream.ts), so memory
 * holds the groups, never the rows. The same reading and the same aggregates as data_checks
 * (RunningAggregate), as general-tasks 5.2 asks.
 *
 * What is left to the tool: the arguments (path, format, describe, each groupBy name once, 1 to
 * MAX_QUERY_OPERATIONS operations, `after`), the size limit and the file, which operations a table
 * under unreadablePaths allows (`op_not_allowed`), the k that hides small groups (`shownGroups`,
 * `shownShape`), pages of MAX_QUERY_RESULT_GROUPS and `after_not_found`, and masking.
 *
 * Rules here, open to the tool's contract (U-197) where it says nothing yet:
 * - A row whose cell in any groupBy column is empty is left out of the groups and counted in
 *   `withoutKey`, as data_checks leaves such rows out. Only rows in a group are aggregated, so a
 *   cell of a left-out row is never checked as a number.
 * - An operation with no value (sum, min, max or mean over no number, or a sum or mean beyond a
 *   double's range) gives null. count is always a number.
 * - Without groupBy the whole table is one group with no keys, even with no data row.
 * - Which problem wins: the table (not UTF-8, does not parse), then the columns (groupBy in order,
 *   then the operations' in order; a name the header holds twice is duplicate_column), then the
 *   first data row whose cell is not a number for a numeric operation (lowest operation on a tie),
 *   then too many groups. Groups beyond `maxGroups` are not kept; their rows are still checked for
 *   numbers. U-277: with `nonNumbers: "skip"` (a table under unreadablePaths) there is no not_number:
 *   such a cell is left out as an empty one is (TableQuery.nonNumbers).
 * - Groups come in code unit order of their keys (the payload's order), compared key by key.
 */

import { MAX_QUERY_COUNTED_GROUPS } from "../contracts/index.js";
import type { QueryColumnShape, QueryGroup, QueryOperation, TableFormat } from "../contracts/index.js";
import { RunningAggregate, parseNumber } from "./aggregate.js";
import { scanTable } from "./stream.js";
import type { TableScanOutcome, TableSink } from "./stream.js";
import { findColumn } from "./table.js";
import type { TableProblem } from "./table.js";

export interface TableQuery {
  /** 0 to MAX_QUERY_GROUP_COLUMNS column names (the tool checks the count and that each is named once). */
  readonly groupBy: readonly string[];
  readonly operations: readonly QueryOperation[];
  /** Most groups kept; one more makes the query `too_many_groups`. Default MAX_QUERY_COUNTED_GROUPS. */
  readonly maxGroups?: number;
  /**
   * U-277 (Codex V-28 M1, V-28b): "refuse" (the default): a numeric operation's cell that is not a
   * number is `not_number` at the first such data row, as below. "skip", for a table under
   * unreadablePaths: no such cell is a problem; each is left out as an empty cell is, so no refusal
   * turns on whether a cell is a number (the other problems keep their rules: query.ts in the
   * contracts, U-283), and the outcome's `tallies` give, per group and operation, the cells that
   * went into the value (V-19's fewCells).
   */
  readonly nonNumbers?: "refuse" | "skip";
}

/** U-277: one group's cells per operation (`nonNumbers: "skip"`) that went into its value: a count's non-empty cells, a sum's or mean's numbers. */
export interface QueryTally {
  readonly cells: readonly number[];
}

/** Why a table cannot be read at all: the problem names a code and where, never a cell's text. */
export type TableReadFailure =
  | { readonly ok: false; readonly problem: "not_text" }
  | { readonly ok: false; readonly problem: "not_table"; readonly table: TableProblem };

export type TableQueryOutcome =
  | {
      readonly ok: true;
      /** Data rows of the table. */
      readonly rows: number;
      /** Data rows left out for an empty groupBy cell. */
      readonly withoutKey: number;
      /** Every group counted, before any is hidden for k, in code unit order of their keys. */
      readonly groups: readonly QueryGroup[];
      /** U-277: with `nonNumbers: "skip"` only, each group's tally, in the order of `groups`. */
      readonly tallies?: readonly QueryTally[];
    }
  | TableReadFailure
  /** A column the query names: which argument (`groupBy[index]` or `operations[index].column`). */
  | { readonly ok: false; readonly problem: "unknown_column" | "duplicate_column"; readonly field: "groupBy" | "operations"; readonly index: number }
  /** The first data row whose cell is not a number for a numeric operation, and that operation's index. */
  | { readonly ok: false; readonly problem: "not_number"; readonly dataRow: number; readonly operation: number }
  | { readonly ok: false; readonly problem: "too_many_groups" };

export type TableShapeOutcome =
  | {
      readonly ok: true;
      /** Data rows. */
      readonly rows: number;
      /** Every column in header order (jsonl: order of first appearance) with its counts, before k. */
      readonly columns: readonly QueryColumnShape[];
    }
  | TableReadFailure;

function readFailure(outcome: Extract<TableScanOutcome, { ok: false }>): TableReadFailure {
  return outcome.reason === "not_text" ? { ok: false, problem: "not_text" } : { ok: false, problem: "not_table", table: outcome.problem };
}

/** Finds a column as `findColumn` would on the whole table, while the columns arrive. */
class ColumnAt {
  index: number | null = null;

  constructor(readonly name: string) {}

  see(columns: readonly string[]): void {
    if (this.index !== null) return;
    const found = findColumn({ columns }, this.name);
    if (found.ok) this.index = found.index;
  }

  cell(cells: readonly string[]): string {
    return this.index === null ? "" : (cells[this.index] ?? "");
  }
}

function compareKeys(a: readonly string[], b: readonly string[]): number {
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] as string;
    const y = b[index] as string;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** One map key for a group's keys: each key's length, then the key, so no two lists meet. */
function groupId(keys: readonly string[]): string {
  return keys.length === 1 ? (keys[0] as string) : keys.map((key) => `${key.length}:${key}`).join("");
}

interface GroupTally {
  readonly keys: readonly string[];
  rows: number;
  readonly aggregates: RunningAggregate[];
}

/** A query's tally as the table is read: give it to `scanTable`, then `finish` with the scan's outcome. */
export class TableQuerySink implements TableSink {
  private readonly keyColumns: ColumnAt[];
  private readonly opColumns: ColumnAt[];
  private readonly maxGroups: number;
  private readonly groups = new Map<string, GroupTally>();
  private withoutKey = 0;
  private tooMany = false;
  /** Per operation: the first data row of a group not kept whose cell is not a number. */
  private readonly notKeptNotNumber: (number | null)[];
  /** U-277: cells that are not numbers are left out as empty ones, not a problem (TableQuery.nonNumbers). */
  private readonly skip: boolean;

  constructor(private readonly query: TableQuery) {
    this.skip = query.nonNumbers === "skip";
    this.keyColumns = query.groupBy.map((name) => new ColumnAt(name));
    this.opColumns = query.operations.map((operation) => new ColumnAt(operation.column));
    this.maxGroups = query.maxGroups ?? MAX_QUERY_COUNTED_GROUPS;
    this.notKeptNotNumber = query.operations.map(() => null);
    if (query.groupBy.length === 0) this.groups.set("", this.newGroup([]));
  }

  private newGroup(keys: readonly string[]): GroupTally {
    return { keys, rows: 0, aggregates: this.query.operations.map((operation) => new RunningAggregate(operation.op, this.skip ? "skip" : "refuse")) };
  }

  columns(columns: readonly string[]): void {
    for (const column of this.keyColumns) column.see(columns);
    for (const column of this.opColumns) column.see(columns);
  }

  row(cells: readonly string[], dataRow: number): void {
    const keys = this.keyColumns.map((column) => column.cell(cells));
    if (keys.some((key) => key.length === 0)) {
      this.withoutKey += 1;
      return;
    }
    const id = groupId(keys);
    let group = this.groups.get(id);
    if (group === undefined) {
      if (this.groups.size >= this.maxGroups) {
        this.tooMany = true;
        if (!this.skip) this.checkNumbers(cells, dataRow);
        return;
      }
      group = this.newGroup(keys);
      this.groups.set(id, group);
    }
    group.rows += 1;
    for (const [index, column] of this.opColumns.entries()) (group.aggregates[index] as RunningAggregate).add(column.cell(cells), dataRow);
  }

  private checkNumbers(cells: readonly string[], dataRow: number): void {
    for (const [index, operation] of this.query.operations.entries()) {
      if (operation.op === "count" || this.notKeptNotNumber[index] !== null) continue;
      const cell = (this.opColumns[index] as ColumnAt).cell(cells);
      if (cell.length > 0 && parseNumber(cell) === null) this.notKeptNotNumber[index] = dataRow;
    }
  }

  finish(outcome: TableScanOutcome): TableQueryOutcome {
    if (!outcome.ok) return readFailure(outcome);
    const named: [ColumnAt[], "groupBy" | "operations"][] = [
      [this.keyColumns, "groupBy"],
      [this.opColumns, "operations"],
    ];
    for (const [columns, field] of named) {
      for (const [index, column] of columns.entries()) {
        const found = findColumn(outcome, column.name);
        if (!found.ok) return { ok: false, problem: found.problem === "missing" ? "unknown_column" : "duplicate_column", field, index };
      }
    }
    let first: { dataRow: number; operation: number } | null = null;
    for (const operation of this.query.operations.keys()) {
      const rows = [this.notKeptNotNumber[operation] ?? null];
      for (const group of this.groups.values()) {
        const result = (group.aggregates[operation] as RunningAggregate).result();
        if (!result.ok && result.problem === "not_a_number") rows.push(result.dataRow);
      }
      for (const dataRow of rows) {
        if (dataRow !== null && (first === null || dataRow < first.dataRow)) first = { dataRow, operation };
      }
    }
    if (first !== null) return { ok: false, problem: "not_number", ...first };
    if (this.tooMany) return { ok: false, problem: "too_many_groups" };
    const sorted = [...this.groups.values()].sort((a, b) => compareKeys(a.keys, b.keys));
    const groups: QueryGroup[] = sorted.map((group) => ({
      keys: group.keys,
      rows: group.rows,
      values: group.aggregates.map((aggregate) => {
        const result = aggregate.result();
        return result.ok ? result.value : null;
      }),
    }));
    if (!this.skip) return { ok: true, rows: outcome.rows, withoutKey: this.withoutKey, groups };
    const tallies: QueryTally[] = sorted.map((group) => ({ cells: group.aggregates.map((aggregate) => aggregate.taken()) }));
    return { ok: true, rows: outcome.rows, withoutKey: this.withoutKey, groups, tallies };
  }
}

/** A table's shape as the table is read: give it to `scanTable`, then `finish` with the scan's outcome. */
export class TableShapeSink implements TableSink {
  private names: readonly string[] = [];
  private readonly nonEmpty: number[] = [];
  private readonly numeric: number[] = [];

  columns(columns: readonly string[]): void {
    this.names = columns;
    while (this.nonEmpty.length < columns.length) {
      this.nonEmpty.push(0);
      this.numeric.push(0);
    }
  }

  row(cells: readonly string[]): void {
    for (const [index, cell] of cells.entries()) {
      if (cell.length === 0) continue;
      this.nonEmpty[index] = (this.nonEmpty[index] ?? 0) + 1;
      if (parseNumber(cell) !== null) this.numeric[index] = (this.numeric[index] ?? 0) + 1;
    }
  }

  finish(outcome: TableScanOutcome): TableShapeOutcome {
    if (!outcome.ok) return readFailure(outcome);
    const columns = outcome.columns.map((name, index) => ({ name, nonEmpty: this.nonEmpty[index] ?? 0, numeric: this.numeric[index] ?? 0 }));
    return { ok: true, rows: outcome.rows, columns };
  }
}

/** Reads a table from its bytes and answers a query (see the module's note). */
export async function queryTable(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  format: TableFormat,
  query: TableQuery,
): Promise<TableQueryOutcome> {
  const sink = new TableQuerySink(query);
  return sink.finish(await scanTable(chunks, format, sink));
}

/** Reads a table from its bytes and gives its shape (`describe`, Q-6) before k hides anything. */
export async function tableShape(chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, format: TableFormat): Promise<TableShapeOutcome> {
  const sink = new TableShapeSink();
  return sink.finish(await scanTable(chunks, format, sink));
}
