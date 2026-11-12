/**
 * Table reading and arithmetic shared by data checks (VF-04) and, later, the read-only aggregate
 * tool (P1 `query_table`, docs/design/general-tasks.md 5.2). Pure: no file access, no state.
 */

export { TABLE_PROBLEM_CODES, findColumn, parseTable } from "./table.js";
export type { ColumnLookup, ParseTableOutcome, Table, TableProblem, TableProblemCode } from "./table.js";
export { aggregate, columnCells, groupCells, parseNumber, withinTolerance } from "./aggregate.js";
export type { AggregateOutcome, CellAt, Group, Grouping, Tolerance } from "./aggregate.js";
