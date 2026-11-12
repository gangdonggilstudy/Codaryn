/**
 * Numbers and aggregates for data checks (VF-04, G-D). Pure.
 *
 * - A number is `-?digits[.digits][e|E[+|-]digits]` and finite as a double. Anything else, a sign
 *   `+`, spaces, thousands separators or a decimal comma included, is not a number.
 * - Empty cells are skipped by every op. `count` counts the non-empty cells and needs no number.
 *   `sum`, `min`, `max` and `mean` need every non-empty cell to be a number, and at least one.
 * - Sums use compensated (Neumaier) summation, so long columns of decimals keep their precision.
 * - A sum or mean whose computation leaves a double's range (a partial sum overflows) has no value
 *   to compare: `out_of_range` (review R-13 L-1), never NaN or Infinity.
 */

import type { AggregateOp } from "../contracts/index.js";
import type { Table } from "./table.js";

const NUMBER = /^-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

/** The cell's number, or null when it is not a number in the contract's form. */
export function parseNumber(cell: string): number | null {
  if (!NUMBER.test(cell)) return null;
  const value = Number(cell);
  return Number.isFinite(value) ? value : null;
}

/** A cell with its 1-based data row, as an aggregate takes it. */
export interface CellAt {
  readonly cell: string;
  readonly dataRow: number;
}

export type AggregateOutcome =
  | {
      readonly ok: true;
      readonly value: number;
      /** Non-empty cells the value is made of. */
      readonly values: number;
    }
  /** A non-empty cell is not a number: the first such data row. */
  | { readonly ok: false; readonly problem: "not_a_number"; readonly dataRow: number }
  /** `sum`, `min`, `max`, `mean` over no non-empty cell: there is no value to compare. */
  | { readonly ok: false; readonly problem: "no_values" }
  /** `sum` or `mean` whose computation left a double's range: there is no value to compare. */
  | { readonly ok: false; readonly problem: "out_of_range" };

/** Neumaier's compensated sum. */
function compensatedSum(values: readonly number[]): number {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const total = sum + value;
    compensation += Math.abs(sum) >= Math.abs(value) ? sum - total + value : value - total + sum;
    sum = total;
  }
  return sum + compensation;
}

export function aggregate(cells: readonly CellAt[], op: AggregateOp): AggregateOutcome {
  const present = cells.filter((item) => item.cell.length > 0);
  if (op === "count") return { ok: true, value: present.length, values: present.length };
  const numbers: number[] = [];
  for (const item of present) {
    const value = parseNumber(item.cell);
    if (value === null) return { ok: false, problem: "not_a_number", dataRow: item.dataRow };
    numbers.push(value);
  }
  if (numbers.length === 0) return { ok: false, problem: "no_values" };
  switch (op) {
    case "sum":
    case "mean": {
      const sum = compensatedSum(numbers);
      const value = op === "sum" ? sum : sum / numbers.length;
      return Number.isFinite(value) ? { ok: true, value, values: numbers.length } : { ok: false, problem: "out_of_range" };
    }
    case "min":
      return { ok: true, value: numbers.reduce((a, b) => Math.min(a, b)), values: numbers.length };
    case "max":
      return { ok: true, value: numbers.reduce((a, b) => Math.max(a, b)), values: numbers.length };
  }
}

/** One column's cells with their data rows. */
export function columnCells(table: Table, column: number): CellAt[] {
  return table.rows.map((row, index) => ({ cell: row[column] ?? "", dataRow: index + 1 }));
}

export interface Group {
  /** The group value, exactly as the cells hold it. */
  readonly key: string;
  /** Data row where the group first appears. */
  readonly firstDataRow: number;
  readonly cells: readonly CellAt[];
}

export interface Grouping {
  /** Groups in order of first appearance. */
  readonly groups: readonly Group[];
  /** Data rows left out because their group cell is empty. */
  readonly withoutKey: number;
}

/** Splits a column's cells by the exact text of another column. Rows with an empty group cell are left out. */
export function groupCells(table: Table, column: number, keyColumn: number): Grouping {
  const groups = new Map<string, { key: string; firstDataRow: number; cells: CellAt[] }>();
  let withoutKey = 0;
  table.rows.forEach((row, index) => {
    const key = row[keyColumn] ?? "";
    const dataRow = index + 1;
    if (key.length === 0) {
      withoutKey += 1;
      return;
    }
    let group = groups.get(key);
    if (group === undefined) {
      group = { key, firstDataRow: dataRow, cells: [] };
      groups.set(key, group);
    }
    group.cells.push({ cell: row[column] ?? "", dataRow });
  });
  return { groups: [...groups.values()], withoutKey };
}

export interface Tolerance {
  readonly absolute: number;
  readonly relative: number;
}

/** |a - b| <= max(absolute, relative * max(|a|, |b|)), as the contract states. */
export function withinTolerance(a: number, b: number, tolerance: Tolerance): boolean {
  const allowed = Math.max(tolerance.absolute, tolerance.relative * Math.max(Math.abs(a), Math.abs(b)));
  return Math.abs(a - b) <= allowed;
}
