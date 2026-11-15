/**
 * Table reading and arithmetic shared by data checks (VF-04) and the read-only aggregate tool (P1
 * `query_table`, docs/design/general-tasks.md 5.2). Pure: no file access. U-202 (bundle A, A-2): a
 * table is read in pieces (stream.ts) and aggregated as it is read (RunningAggregate, query.ts).
 */

export { TABLE_PROBLEM_CODES, findColumn, parseTable } from "./table.js";
export type { ColumnLookup, ParseTableOutcome, Table, TableProblem, TableProblemCode } from "./table.js";
export { TableScanner, scanTable } from "./stream.js";
export type { TableScanOutcome, TableSink, TableTextOutcome } from "./stream.js";
export { RunningAggregate, aggregate, columnCells, groupCells, parseNumber, withinTolerance } from "./aggregate.js";
export type { AggregateOutcome, CellAt, Group, Grouping, Tolerance } from "./aggregate.js";
export { TableQuerySink, TableShapeSink, queryTable, tableShape } from "./query.js";
export type { QueryTally, TableQuery, TableQueryOutcome, TableReadFailure, TableShapeOutcome } from "./query.js";
