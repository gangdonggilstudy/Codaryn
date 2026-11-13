/**
 * U-208 (P1 bundle A, A-5; DR-69, DR-70; proposal 3.1, Q-2 to Q-9): the `query_table` tool. It reads
 * a workspace table in pieces (src/tabular, U-202: queryTable, tableShape) and gives the model only
 * what DR-70 allows from a table under the run's unreadable paths: column names, the keys of groups
 * of at least k rows, their row counts and their aggregates (query.ts: shownGroups, shownShape).
 *
 * - The table's path is read with the access `aggregate`: the gate allows it under unreadable paths,
 *   and the real path it judged must be the one read (U-189's T-1). The bytes come in chunks from a
 *   file handle whose identity is the path's, while the folders on the way stay the ones checked
 *   (guard.ts); a change seen is tried again, still seen it is `io_error`.
 * - A table under unreadable paths: count, sum and mean only (`op_not_allowed`) and the run's k; any
 *   other table: all five operations and k 1 (nothing hidden).
 * - Groups come MAX_QUERY_RESULT_GROUPS at a time; `next` is a cursor of the shown groups' ordinals
 *   (QUERY_CURSOR_PATTERN_SOURCE), never a key.
 * - A failure's message names a code and a row, line or argument index, never a cell's text, a path
 *   or a column name. Numbers are given as computed, not rounded (Q-9).
 * - Raw local text like every tool payload: the engine masks it before it is recorded or sent.
 */

import { constants } from "node:fs";
import fs from "node:fs/promises";

import {
  MAX_QUERY_COUNTED_GROUPS,
  MAX_QUERY_RESULT_GROUPS,
  MAX_QUERY_TABLE_BYTES,
  UNREADABLE_TABLE_OPS,
  asRawText,
  minGroupSizeFor,
  queryCursorIndex,
  queryCursorOf,
  shownGroups,
  shownShape,
} from "../contracts/index.js";
import type { QueryTableArgs, QueryTableProblem, RawWorkflowToolOutcome, TableFormat, ToolErrorCode, Workspace } from "../contracts/index.js";
import type { PathSet } from "../policy/path-set.js";
import { queryTable, tableShape } from "../tabular/index.js";
import type { TableQueryOutcome, TableReadFailure, TableShapeOutcome } from "../tabular/index.js";
import { nodeFileLayer } from "../workspace/file-layer.js";
import { retried, sameChain, sameId, walkChain } from "../workspace/guard.js";
import { takeJudged } from "../workspace/judged.js";

type Failure = Extract<RawWorkflowToolOutcome, { ok: false }>;

/** Bytes read at a time. */
const CHUNK_BYTES = 64 * 1024;
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

export interface QueryTableDeps {
  readonly workspace: Workspace;
  /** The run's unreadable paths (ToolRunnerOptions.unreadablePaths); absent: none. */
  readonly unreadable?: PathSet;
  /** The run's k (ResolvedTaskSpec.minGroupSize, at least 5). */
  readonly minGroupSize: number;
  /** For tests: a smaller size limit than MAX_QUERY_TABLE_BYTES, and smaller chunks. */
  readonly maxTableBytes?: number;
  readonly chunkBytes?: number;
}

function fail(code: ToolErrorCode, message: string): Failure {
  return { ok: false, code, message: asRawText(message) };
}

/** `invalid_table`: the problem and where (a row, a line or an argument), never a cell or a name. */
function rejected(problem: QueryTableProblem, where?: string): Failure {
  return fail("invalid_table", where === undefined ? `table rejected: ${problem}` : `table rejected: ${problem} at ${where}`);
}

const FORMATS_BY_EXTENSION: { readonly [extension: string]: TableFormat } = { ".csv": "csv", ".tsv": "tsv", ".jsonl": "jsonl" };

function formatOf(args: QueryTableArgs): TableFormat | null {
  if (args.format !== undefined) return args.format;
  const dot = args.path.lastIndexOf(".");
  return dot === -1 ? null : (FORMATS_BY_EXTENSION[args.path.slice(dot).toLowerCase()] ?? null);
}

class TooLarge extends Error {}
class Cancelled extends Error {}

/**
 * The table's bytes in chunks, from a handle whose identity is the path's, for `consume`; then the
 * folders on the way must still be the ones checked. "changed" when they are not, or when the file
 * opened is not the one the path named.
 */
async function readChunks<T>(
  workspace: Workspace,
  relative: string,
  absolute: string,
  limits: { readonly maxBytes: number; readonly chunkBytes: number },
  signal: AbortSignal,
  consume: (chunks: AsyncIterable<Uint8Array>) => Promise<T>,
): Promise<T | "changed" | "not_found" | "not_file" | "too_large" | "io_error"> {
  const before = await walkChain(nodeFileLayer.lstatId, workspace.root, relative);
  if (!before.ok) return before.code;
  const named = before.last;
  if (named.isSymbolicLink() || !named.isFile()) return "not_file";
  if (named.size > BigInt(limits.maxBytes)) return "too_large";
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(absolute, READ_FLAGS);
  } catch {
    return "changed";
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameId({ dev: opened.dev, ino: opened.ino }, named.id)) return "changed";
    async function* chunks(): AsyncGenerator<Uint8Array> {
      let total = 0;
      for (;;) {
        if (signal.aborted) throw new Cancelled();
        const buffer = new Uint8Array(limits.chunkBytes);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) return;
        total += bytesRead;
        // A file that grew after it was checked.
        if (total > limits.maxBytes) throw new TooLarge();
        yield buffer.subarray(0, bytesRead);
      }
    }
    const result = await consume(chunks());
    const after = await walkChain(nodeFileLayer.lstatId, workspace.root, relative);
    if (!after.ok || !sameChain(before.seen, after.seen)) return "changed";
    return result;
  } catch (error) {
    if (error instanceof TooLarge) return "too_large";
    if (error instanceof Cancelled) throw error;
    return "io_error";
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** The failure of a table that cannot be read at all: its code and the line, never its text. */
function readFailure(failure: TableReadFailure): Failure {
  if (failure.problem === "not_text") return rejected("not_text");
  const { code, line } = failure.table;
  return rejected("not_table", line === null ? `(${code})` : `line ${line} (${code})`);
}

function queryFailure(outcome: Exclude<TableQueryOutcome, { ok: true }>): Failure {
  switch (outcome.problem) {
    case "not_text":
    case "not_table":
      return readFailure(outcome);
    case "unknown_column":
    case "duplicate_column":
      return rejected(outcome.problem, outcome.field === "groupBy" ? `groupBy[${outcome.index}]` : `operations[${outcome.index}].column`);
    case "not_number":
      return rejected("not_number", `data row ${outcome.dataRow}, operations[${outcome.operation}]`);
    case "too_many_groups":
      return fail("too_many_groups", `the query counts more than ${MAX_QUERY_COUNTED_GROUPS} groups`);
  }
}

/** True when groupBy names one column twice (it holds at most MAX_QUERY_GROUP_COLUMNS, 2). */
function duplicateGroupBy(groupBy: readonly string[]): boolean {
  return groupBy.length === 2 && groupBy[0] === groupBy[1];
}

/** True when the reading found a problem that wins over one at `groupBy[index]`: the table's, or an earlier groupBy column's. */
function problemBefore(outcome: TableQueryOutcome, index: number): boolean {
  if (outcome.ok) return false;
  if (outcome.problem === "not_text" || outcome.problem === "not_table") return true;
  return (outcome.problem === "unknown_column" || outcome.problem === "duplicate_column") && outcome.field === "groupBy" && outcome.index < index;
}

/** U-208: `query_table` (see the module's note). */
export async function queryTableTool(deps: QueryTableDeps, args: QueryTableArgs, signal: AbortSignal): Promise<RawWorkflowToolOutcome> {
  const { workspace } = deps;
  if (typeof args.path !== "string") return fail("invalid_args", "path must be a string");
  const format = formatOf(args);
  if (format === null) return fail("invalid_args", "format is needed: the file name does not end with .csv, .tsv or .jsonl");

  // U-189 (T-1): the real path the gate judged for this argument must be the one read.
  const judged = takeJudged(workspace, args.path, "aggregate");
  const resolved = await workspace.resolve(args.path, "aggregate");
  if (!resolved.ok) return fail("policy_denied", `path rejected by workspace: ${resolved.code}`);
  if (judged !== undefined && judged !== resolved.path.absolute) {
    return fail("policy_denied", "the path leads elsewhere than when the policy judged it; nothing was done");
  }

  const unreadable = deps.unreadable !== undefined && (await deps.unreadable.coversEffective(resolved.path.relative, workspace));
  const k = minGroupSizeFor(unreadable, deps.minGroupSize);
  const operations = args.operations ?? [];
  if (unreadable && args.describe !== true) {
    const index = operations.findIndex((operation) => !(UNREADABLE_TABLE_OPS as readonly string[]).includes(operation.op));
    if (index !== -1) return rejected("op_not_allowed", `operations[${index}].op`);
  }
  let start = 0;
  if (args.describe !== true && args.after !== undefined) {
    const index = queryCursorIndex(args.after);
    if (index === null) return rejected("after_not_found");
    start = index;
  }

  const limits = { maxBytes: deps.maxTableBytes ?? MAX_QUERY_TABLE_BYTES, chunkBytes: deps.chunkBytes ?? CHUNK_BYTES };
  let outcome: TableQueryOutcome | TableShapeOutcome | "changed" | "not_found" | "not_file" | "too_large" | "io_error";
  try {
    outcome = await retried(() =>
      readChunks<TableQueryOutcome | TableShapeOutcome>(workspace, resolved.path.relative, resolved.path.absolute, limits, signal, (chunks) =>
        args.describe === true ? tableShape(chunks, format) : queryTable(chunks, format, { groupBy: args.groupBy ?? [], operations, maxGroups: MAX_QUERY_COUNTED_GROUPS }),
      ),
    );
  } catch (error) {
    if (error instanceof Cancelled) return fail("cancelled", "query_table cancelled");
    return fail("io_error", "cannot read the table");
  }
  if (outcome === "changed") return fail("io_error", "the folders changed while the table was read; nothing was given");
  if (outcome === "not_found" || outcome === "not_file") return fail("not_found", "no table file at this path");
  if (outcome === "too_large") return fail("too_large", `the table is larger than ${limits.maxBytes} bytes`);
  if (outcome === "io_error") return fail("io_error", "cannot read the table");

  if (args.describe === true) {
    const shape = outcome as TableShapeOutcome;
    if (!shape.ok) return readFailure(shape);
    const shown = shownShape(shape.columns, shape.rows, k);
    return { ok: true, payload: { kind: "describe", columns: shown.columns, rows: shown.rows, minGroupSize: k } };
  }
  const result = outcome as TableQueryOutcome;
  // query.ts: a groupBy name given twice is `duplicate_column` at its second place, after the table's
  // problems and the first place's own (src/tabular leaves this to the tool).
  if (duplicateGroupBy(args.groupBy ?? []) && !problemBefore(result, 1)) return rejected("duplicate_column", "groupBy[1]");
  if (!result.ok) return queryFailure(result);
  // DR-70: only the groups of at least k rows; the others merged into their number.
  const shown = shownGroups(result.groups, k);
  // A cursor names a shown group; one at or past the end names none (`next` is null there).
  if (args.after !== undefined && start >= shown.groups.length) return rejected("after_not_found");
  const end = start + MAX_QUERY_RESULT_GROUPS;
  return {
    ok: true,
    payload: {
      kind: "groups",
      groupBy: [...(args.groupBy ?? [])],
      operations: operations.map((operation) => ({ op: operation.op, column: operation.column })),
      groups: shown.groups.slice(start, end),
      suppressedGroups: shown.suppressedGroups,
      next: end < shown.groups.length ? queryCursorOf(end) : null,
      minGroupSize: k,
    },
  };
}
