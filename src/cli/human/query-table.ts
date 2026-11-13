/**
 * U-207 (P1 bundle A, DR-70; contract U-197): what a person may be told of a `query_table` result, read
 * from its `tool_result` record: what was asked (the operation kinds, how many columns it grouped by,
 * or that the table's shape was asked) and three counts (how many groups were left out for fewer than k
 * rows, how many shown groups had a value left out for fewer than k cells (Codex V-19, fewCells; U-210,
 * R-108 L-2), and k). Nothing else of the payload is read or returned: no path, no column name, no
 * group key, no row count of a group and no aggregate, so neither a progress line nor the end summary
 * can carry a value of the table. The CLI's run (na-core) reads the same facts for
 * RunSummaryContext.hiddenGroups.
 */

import { MAX_QUERY_GROUP_COLUMNS, QUERY_TABLE_OPS, QUERY_TABLE_TOOL_NAME } from "../../contracts/index.js";
import type { AggregateOp } from "../../contracts/index.js";

/** What a query_table result that succeeded says, for people. */
export type QueryTableFacts =
  | { readonly kind: "describe" }
  | {
      readonly kind: "groups";
      /** The operation kinds, each once, in the query's order (QUERY_TABLE_OPS codes). */
      readonly operations: readonly AggregateOp[];
      /** How many columns the query grouped by (0 to MAX_QUERY_GROUP_COLUMNS). */
      readonly groupColumns: number;
      /** Groups left out for fewer than `minGroupSize` rows (over the whole query, on every page). */
      readonly suppressedGroups: number;
      /**
       * U-210 (R-108 L-2): shown groups of this page with a value left out for fewer than k cells
       * (fewCells). Absent when there is none, so the facts of a result without any are as before.
       */
      readonly hiddenValues?: number;
      readonly minGroupSize: number;
    };

const isWhole = (value: unknown, min: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min;

/**
 * The facts of a `tool_result` record's result (ToolResult) when it is a query_table result that
 * succeeded and its payload has the contract's form (QueryTablePayload); null for anything else, so a
 * result that cannot be read gives no line rather than a wrong one.
 */
export function queryTableFacts(result: unknown): QueryTableFacts | null {
  if (typeof result !== "object" || result === null) return null;
  const { tool, ok, content } = result as { readonly tool?: unknown; readonly ok?: unknown; readonly content?: unknown };
  if (tool !== QUERY_TABLE_TOOL_NAME || ok !== true || typeof content !== "string") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const { kind, groupBy, operations, groups, suppressedGroups, minGroupSize } = payload as {
    readonly kind?: unknown;
    readonly groupBy?: unknown;
    readonly operations?: unknown;
    readonly groups?: unknown;
    readonly suppressedGroups?: unknown;
    readonly minGroupSize?: unknown;
  };
  if (kind === "describe") return { kind: "describe" };
  if (kind !== "groups" || !Array.isArray(groupBy) || groupBy.length > MAX_QUERY_GROUP_COLUMNS || !Array.isArray(operations) || operations.length === 0) return null;
  if (!isWhole(suppressedGroups, 0) || !isWhole(minGroupSize, 1)) return null;
  const kinds: AggregateOp[] = [];
  for (const operation of operations) {
    const op: unknown = typeof operation === "object" && operation !== null ? (operation as { readonly op?: unknown }).op : undefined;
    if (!(QUERY_TABLE_OPS as readonly unknown[]).includes(op)) return null;
    if (!kinds.includes(op as AggregateOp)) kinds.push(op as AggregateOp);
  }
  // U-210 (R-108 L-2): only whether each shown group lists a value left out, never the group itself.
  const hiddenValues = Array.isArray(groups)
    ? groups.filter((group: unknown) => {
        const few: unknown = typeof group === "object" && group !== null ? (group as { readonly fewCells?: unknown }).fewCells : undefined;
        return Array.isArray(few) && few.length > 0;
      }).length
    : 0;
  return { kind: "groups", operations: kinds, groupColumns: groupBy.length, suppressedGroups, ...(hiddenValues > 0 ? { hiddenValues } : {}), minGroupSize };
}
