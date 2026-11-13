/**
 * P1 bundle A (DR-69, DR-70; proposal docs/reviews/2026-11-13-p1-bundle-proposal.md 3.1 to 3.3,
 * Q-1 to Q-9, R-1 to R-8, P-1 to P-4): the contract of `query_table`, of the group size k and of the
 * private data task type, before anything carries them out (U-197, unit A-1).
 *
 * `query_table` is a read-only task type tool: Codaryn reads a workspace table (CSV, TSV, JSON
 * Lines) locally, aggregates it and gives the model the aggregates only. DR-70 (the user's
 * decision): from a table under unreadablePaths (PolicyConfig, task.ts) the model may get nothing
 * but the column names, the key values of groups that at least k rows share, those groups' row
 * counts and their aggregates. No row is sent. Groups of fewer than k rows are merged into one count
 * of such groups (`suppressedGroups`): their keys, row counts and aggregates are not given, and
 * neither is how many rows they hold (it would follow from the totals).
 *
 * What this protects and what not (Q-8): the guarantee is that no row is sent. k lowers the chance
 * that a small group shows by mistake; it does not stop someone who subtracts one answer from
 * another (that needs added noise, outside P1).
 *
 * Not carried out yet: no tool runs `query_table` (A-5 adds it to WORKFLOW_TOOL_NAMES with the
 * runner), the gate does not judge unreadable paths (A-3), the parsers refuse `unreadablePaths` and
 * `minGroupSize` (A-6), and `analyze-private` is not a built-in definition (A-6).
 */

import { AGGREGATE_OPS } from "./verify.js";
import type { AggregateOp, TableFormat, VerifierConfig } from "./verify.js";
import type { PolicyConfig } from "./task.js";
import type { ToolDefinition, ToolDescriptor } from "./tool.js";

/** Q-4: the group size k when the user's settings set none. */
export const DEFAULT_MIN_GROUP_SIZE = 5;
/**
 * Q-4: the values `PolicyConfig.minGroupSize` may take, in any source. The config file's value (or
 * the default) is the base; a profile, a task type definition and a task file can only raise it
 * (effectiveMinGroupSize).
 */
export const MIN_GROUP_SIZE_LIMITS = { min: 2, max: 1000 } as const;

/**
 * Q-4: the run's k: the config file's `minGroupSize` (DEFAULT_MIN_GROUP_SIZE when it sets none),
 * raised by every other source that states a larger one (profile, definition, task file), never
 * lowered. Values are assumed checked against MIN_GROUP_SIZE_LIMITS. Pure.
 */
export function effectiveMinGroupSize(configured: number | undefined, raises: readonly (number | undefined)[]): number {
  return Math.max(configured ?? DEFAULT_MIN_GROUP_SIZE, ...raises.filter((value): value is number => value !== undefined));
}

/** Q-4: a table outside unreadablePaths has no hidden groups (k is 1); one under them has the run's k. */
export function minGroupSizeFor(unreadable: boolean, runMinGroupSize: number): number {
  return unreadable ? runMinGroupSize : 1;
}

/** Q-2: the operations on a table outside unreadablePaths: all of data_checks' (AGGREGATE_OPS). */
export const QUERY_TABLE_OPS = AGGREGATE_OPS;
/**
 * Q-2: the operations on a table under unreadablePaths: no min or max, which are always one
 * person's own value however large the group is.
 */
export const UNREADABLE_TABLE_OPS = ["count", "sum", "mean"] as const satisfies readonly AggregateOp[];

/** Q-3: most columns one query groups by (0 to 2); no filter in P1 (it is the easiest way to single someone out). */
export const MAX_QUERY_GROUP_COLUMNS = 2;
/** Q-5: most operations in one query. */
export const MAX_QUERY_OPERATIONS = 8;
/** Q-5: most groups one call returns; more continue with `after`. */
export const MAX_QUERY_RESULT_GROUPS = 200;
/** Q-5: most groups one query may count; more is `too_many_groups` (a near-unique column groups so). */
export const MAX_QUERY_COUNTED_GROUPS = 10_000;
/** Q-5: largest table `query_table` reads (64 MiB, read in pieces). More is `too_large`. */
export const MAX_QUERY_TABLE_BYTES = 64 * 1024 * 1024;

/**
 * One aggregate: data_checks' operations (src/tabular), empty cells skipped. `count` counts the
 * column's non-empty cells and needs no number; the others need every non-empty cell of the column to
 * be a number (else `invalid_table`, `not_number`).
 */
export interface QueryOperation {
  readonly op: AggregateOp;
  readonly column: string;
}

/**
 * Arguments of `query_table`. Either `describe: true` (the table's shape, Q-6) or 1 to
 * MAX_QUERY_OPERATIONS operations over the groups of 0 to MAX_QUERY_GROUP_COLUMNS columns.
 */
export interface QueryTableArgs {
  /** A table file relative to the workspace root. */
  readonly path: string;
  /** Absent: from the extension (`.csv`, `.tsv`, `.jsonl`); another extension needs it. */
  readonly format?: TableFormat;
  /** Q-6: the table's shape instead of a query; then no other field but `path` and `format`. */
  readonly describe?: true;
  /** Column names to group by; absent or empty: the whole table as one group. Each name once. */
  readonly groupBy?: readonly string[];
  readonly operations?: readonly QueryOperation[];
  /** The `next` of the previous call of the same query: the groups after it. */
  readonly after?: string;
}

/**
 * Q-6: one column as `describe` gives it: its name, its non-empty cells and those read as numbers.
 * The counts are null when the table's rows are hidden (a table under unreadablePaths with fewer
 * than k data rows).
 */
export interface QueryColumnShape {
  readonly name: string;
  readonly nonEmpty: number | null;
  readonly numeric: number | null;
}

/** A group in the result: its key values (one per groupBy column), its rows and one value per operation. */
export interface QueryGroup {
  readonly keys: readonly string[];
  readonly rows: number;
  /** In the order of `operations`; null where the operation has no value (a mean of no number). Not rounded (Q-9). */
  readonly values: readonly (number | null)[];
}

/**
 * What `query_table` returns, raw local text like every tool payload: the engine masks it before it
 * is recorded or sent, so column names and keys holding a registered value reach the model masked.
 * The only free text in it is column names and the keys of the groups shown (contract test).
 * - describe: the columns (header order), the data rows (null when hidden, as the counts are) and
 *   the k that applied.
 * - groups: the query as asked, the groups of at least `minGroupSize` rows (code unit order of their
 *   keys, at most MAX_QUERY_RESULT_GROUPS), how many groups were merged away for fewer rows (over
 *   the whole query, on every page), `next` to continue (null at the end), and the k that applied.
 */
export type QueryTablePayload =
  | {
      readonly kind: "describe";
      readonly columns: readonly QueryColumnShape[];
      readonly rows: number | null;
      readonly minGroupSize: number;
    }
  | {
      readonly kind: "groups";
      readonly groupBy: readonly string[];
      readonly operations: readonly QueryOperation[];
      readonly groups: readonly QueryGroup[];
      readonly suppressedGroups: number;
      readonly next: string | null;
      readonly minGroupSize: number;
    };

/**
 * Why `query_table` refuses a table (tool error `invalid_table`; the message names the code and a
 * row or line number, never a cell's text and never a parser's own message, which can hold one):
 * - not_table: the file does not parse as its format (quotes, field counts, a JSON line)
 * - unknown_column: a groupBy or operation column the header does not have
 * - duplicate_column: the header names a column twice, or groupBy names one twice
 * - not_number: a numeric operation met a non-empty cell that is not a number
 * - op_not_allowed: min or max on a table under unreadablePaths (UNREADABLE_TABLE_OPS)
 * - after_not_found: `after` is not a `next` of this query
 */
export const QUERY_TABLE_PROBLEMS = ["not_table", "unknown_column", "duplicate_column", "not_number", "op_not_allowed", "after_not_found"] as const;
export type QueryTableProblem = (typeof QUERY_TABLE_PROBLEMS)[number];

/**
 * DR-70, Q-4: the one rule for what of the computed groups may be given: the groups of at least
 * `minGroupSize` rows, in their order; the others merged into their number only. Pure.
 */
export function shownGroups(groups: readonly QueryGroup[], minGroupSize: number): { readonly groups: readonly QueryGroup[]; readonly suppressedGroups: number } {
  const shown = groups.filter((group) => group.rows >= minGroupSize);
  return { groups: shown, suppressedGroups: groups.length - shown.length };
}

/** Q-6: a table's shape as `describe` may give it: rows and counts hidden when fewer than `minGroupSize` rows. Pure. */
export function shownShape(
  columns: readonly QueryColumnShape[],
  rows: number,
  minGroupSize: number,
): { readonly columns: readonly QueryColumnShape[]; readonly rows: number | null } {
  if (rows >= minGroupSize) return { columns, rows };
  return { columns: columns.map((column) => ({ name: column.name, nonEmpty: null, numeric: null })), rows: null };
}

/**
 * R-3: the tool's descriptor. Its path is read with the access `aggregate`, which only this tool
 * uses: the gate allows it under unreadablePaths where it refuses `read` (A-3), by the access and
 * never by the tool's name. Not a task type tool yet (A-5 adds it to WORKFLOW_TOOL_NAMES).
 */
export const QUERY_TABLE_TOOL_NAME = "query_table";
export const QUERY_TABLE_DESCRIPTOR: ToolDescriptor & { readonly name: typeof QUERY_TABLE_TOOL_NAME } = {
  name: QUERY_TABLE_TOOL_NAME,
  displayClass: "read",
  requires: {
    paths: [{ field: "path", access: "aggregate" }],
    command: false,
    network: false,
    destructive: false,
  },
  restoreFields: ["path"],
  documentFields: [],
};

/** What a provider tells the model about `query_table`. Fixed text. */
export const QUERY_TABLE_DEFINITION: ToolDefinition = {
  description:
    "Aggregate a table file (CSV, TSV or JSON Lines) in the workspace without reading its rows. " +
    "Set describe to true to get its column names and counts. Otherwise give operations (sum, count, " +
    "min, max or mean of a column) and up to two groupBy columns. Groups with too few rows are not " +
    "shown; only their number is given. Tables you may not read allow count, sum and mean only. " +
    "When next is not null, call again with after set to it to continue.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1, description: "Table file relative to the workspace root." },
      format: { type: "string", enum: ["csv", "tsv", "jsonl"] },
      describe: { type: "boolean" },
      groupBy: { type: "array", maxItems: MAX_QUERY_GROUP_COLUMNS, items: { type: "string", minLength: 1 } },
      operations: {
        type: "array",
        minItems: 1,
        maxItems: MAX_QUERY_OPERATIONS,
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: [...AGGREGATE_OPS] },
            column: { type: "string", minLength: 1 },
          },
          required: ["op", "column"],
          additionalProperties: false,
        },
      },
      after: { type: "string", minLength: 1 },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

/**
 * P-1: the built-in task type for tables with personal data (`analyze-private`): read_file,
 * search_files, query_table and write_file, no command (allowCommands false), `human_review`, and
 * resolved only when the effective policy's unreadablePaths is not empty. Not a built-in id yet (A-6
 * adds it to BUILTIN_WORKFLOW_IDS with its definition and texts).
 */
export const ANALYZE_PRIVATE_WORKFLOW_ID = "analyze-private";

/**
 * R-5, P-1: why a task type cannot be resolved with unreadable paths, beside WORKFLOW_PROBLEMS
 * (A-6 joins them, with the CLI's texts):
 * - unreadable_with_commands: unreadablePaths with any command rule or `command` verifier (a command
 *   can read anything; its output and a command verifier's go to the model)
 * - unreadable_paths_required: `analyze-private` with an empty effective unreadablePaths
 */
export const PRIVATE_DATA_WORKFLOW_PROBLEMS = ["unreadable_with_commands", "unreadable_paths_required"] as const;
export type PrivateDataWorkflowProblem = (typeof PRIVATE_DATA_WORKFLOW_PROBLEMS)[number];

/**
 * U-203 (A-3, R-2): the union of the sources' unreadable paths (config file, profile, definition,
 * task file), in that order, each entry once. Pure.
 */
export function unreadablePathsOf(sources: readonly (readonly string[] | undefined)[]): readonly string[] {
  return [...new Set(sources.flatMap((source) => source ?? []))];
}

/**
 * U-203 (A-3, R-2): `policy` with the user's settings' unreadable paths added, also when `policy` is
 * a task file's own (whose policy otherwise replaces the config's): no source takes one away. The
 * policy as it was when nothing is added. Pure; the CLI and the app call it (A-6).
 */
export function withUnreadablePaths<P extends PolicyConfig>(policy: P, added: readonly (readonly string[] | undefined)[]): P {
  const all = unreadablePathsOf([policy.unreadablePaths, ...added]);
  return all.length === 0 ? policy : { ...policy, unreadablePaths: all };
}

/**
 * U-203 (A-3, R-3): what the integrity checks watch: the protected paths and the unreadable paths,
 * each once (IntegrityCheckerOptions.protectedPaths). Pure; the CLI and the app call it (A-6).
 */
export function integrityPathsOf(policy: PolicyConfig): readonly string[] {
  return unreadablePathsOf([policy.protectedPaths, policy.unreadablePaths]);
}

/**
 * U-203 (A-3, R-5): the resolution's refusal of unreadable paths beside commands: a command rule
 * (field `policy.commands`) or a `command` verifier (field `verifiers[i]`, the first) while the
 * effective policy has any unreadable path. Null otherwise. Pure; the CLI resolves with it once the
 * problem joins WORKFLOW_PROBLEMS (A-6). The gate also denies every command meanwhile.
 */
export function privateDataProblem(
  policy: PolicyConfig,
  verifiers: readonly VerifierConfig[],
): { readonly problem: PrivateDataWorkflowProblem; readonly field: string } | null {
  if ((policy.unreadablePaths ?? []).length === 0) return null;
  if (policy.commands.length > 0) return { problem: "unreadable_with_commands", field: "policy.commands" };
  const index = verifiers.findIndex((verifier) => verifier.kind === "command");
  return index === -1 ? null : { problem: "unreadable_with_commands", field: `verifiers[${index}]` };
}
