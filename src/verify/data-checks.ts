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
import { aggregate, columnCells, findColumn, groupCells, parseNumber, parseTable, withinTolerance } from "../tabular/index.js";
import type { AggregateOutcome, Table, TableProblem, Tolerance } from "../tabular/index.js";
import { createRawVerifierResult } from "./result.js";

/** Most problems listed per rule; the rest are counted. */
export const MAX_LISTED_PROBLEMS = 20;
/** Longest column name shown in evidence, in characters. */
const MAX_SHOWN_NAME = 80;

export const DATA_CHECKS_LIMITS: readonly string[] = [
  "only the listed table shapes and aggregates are checked; the method, the interpretation and any number written in prose are not",
  "tables are read as CSV (an RFC 4180 subset), TSV or JSON Lines of at most 16 MiB; numbers are plain decimals (-?digits[.digits][e±digits]) computed as doubles",
  "group values are compared as exact text, and rows whose group cell is empty are left out of the groups",
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

type Loaded =
  | { readonly ok: true; readonly table: Table }
  | { readonly ok: false; readonly fixable: boolean; readonly note: string };

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
 * Reads and parses one table. `fixable` marks problems the model could fix in a file it wrote
 * (missing, too large, not UTF-8, does not parse); the role decides what that means.
 */
async function loadTable(ref: TableRef, workspace: Workspace, maxBytes: number): Promise<Loaded> {
  const resolved = await workspace.resolve(ref.path, "read");
  if (!resolved.ok) return { ok: false, fixable: false, note: `path rejected (${resolved.code})` };
  let bytes: Buffer;
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(resolved.path.absolute, "r");
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return { ok: false, fixable: true, note: "file not found" };
    return { ok: false, fixable: false, note: `file could not be opened (${code ?? "unknown error"})` };
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return { ok: false, fixable: true, note: "not a regular file" };
    if (info.size > maxBytes) return { ok: false, fixable: true, note: `larger than ${maxBytes} bytes` };
    // One byte more than allowed tells a file that grew after stat.
    const buffer = Buffer.alloc(Math.min(info.size, maxBytes) + 1);
    let filled = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
      if (filled === buffer.length) break;
    }
    if (filled > maxBytes) return { ok: false, fixable: true, note: `larger than ${maxBytes} bytes` };
    bytes = buffer.subarray(0, filled);
  } catch (error) {
    return { ok: false, fixable: false, note: `file could not be read (${errorCode(error) ?? "unknown error"})` };
  } finally {
    await handle.close().catch(() => undefined);
  }
  let text: string;
  try {
    // The default decoder drops a leading byte order mark.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, fixable: true, note: "not UTF-8 text" };
  }
  const parsed = parseTable(text, ref.format);
  if (!parsed.ok) return { ok: false, fixable: true, note: `does not parse as ${ref.format}: ${describeProblem(parsed.problem)}` };
  return { ok: true, table: parsed.table };
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
  maxBytes: number,
): Promise<Verdict> {
  if (!isTableRef(rule.table)) return undecided("the rule is not valid: table needs a path and a format (csv, tsv or jsonl)");
  if (rule.columns !== undefined && !(Array.isArray(rule.columns) && rule.columns.every((name) => typeof name === "string"))) {
    return undecided("the rule is not valid: columns must be a list of names");
  }
  const match = rule.columnsMatch ?? "exact";
  if (match !== "exact" && match !== "includes") return undecided('the rule is not valid: columnsMatch must be "exact" or "includes"');

  const loaded = await loadTable(rule.table, workspace, maxBytes);
  if (!loaded.ok) return loadVerdict("target", rule.table, loaded);
  const table = loaded.table;
  const problems = new Problems();
  const notes: string[] = [];

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
    const count = table.rows.length;
    if (rows.equals !== undefined) {
      if (!isCount(rows.equals)) return undecided("the rule is not valid: rows.equals must be a whole number");
      if (count === rows.equals) notes.push(`${count} data rows`);
      else problems.add(`${count} data rows, expected ${rows.equals}`);
    } else if (rows.sameAs !== undefined) {
      if (!isTableRef(rows.sameAs)) return undecided("the rule is not valid: rows.sameAs needs a path and a format");
      const other = await loadTable(rows.sameAs, workspace, maxBytes);
      if (!other.ok) return loadVerdict("source", rows.sameAs, other);
      const expected = other.table.rows.length;
      if (count === expected) notes.push(`${count} data rows, as ${describeTable(rows.sameAs)}`);
      else problems.add(`${count} data rows, expected ${expected} as ${describeTable(rows.sameAs)}`);
    } else {
      if ((rows.min !== undefined && !isCount(rows.min)) || (rows.max !== undefined && !isCount(rows.max))) {
        return undecided("the rule is not valid: rows.min and rows.max must be whole numbers");
      }
      const min = rows.min as number | undefined;
      const max = rows.max as number | undefined;
      if ((min === undefined || count >= min) && (max === undefined || count <= max)) notes.push(`${count} data rows`);
      else problems.add(`${count} data rows, expected ${describeRows({ ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) })}`);
    }
  }

  if (problems.size > 0) return notHeld(problems.text());
  return held(notes.length > 0 ? notes.join("; ") : "the table parses");
}

/** What an aggregate problem in the source means: the model cannot fix the input. */
function sourceProblem(outcome: Extract<AggregateOutcome, { ok: false }>, column: string, scope: string): Verdict {
  return outcome.problem === "not_a_number"
    ? undecided(`source data row ${outcome.dataRow} of column ${shownName(column)} is not a number${scope}`)
    : undecided(`source column ${shownName(column)} has no number to compute${scope}`);
}

function compareValue(
  recomputed: number,
  cell: string,
  targetRow: number,
  targetColumn: string,
  tolerance: Tolerance,
  problems: Problems,
  label: string,
): boolean {
  const found = cell.length === 0 ? null : parseNumber(cell);
  if (found === null) {
    problems.add(`target data row ${targetRow} of column ${shownName(targetColumn)} is ${cell.length === 0 ? "empty" : "not a number"}${label}`);
    return false;
  }
  if (withinTolerance(recomputed, found, tolerance)) return true;
  problems.add(`target data row ${targetRow}${label}: recomputed ${recomputed}, found ${found}`);
  return false;
}

async function checkAggregate(
  rule: Extract<DataRule, { type: "aggregate_match" }>,
  workspace: Workspace,
  maxBytes: number,
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

  const source = await loadTable(rule.source, workspace, maxBytes);
  if (!source.ok) return loadVerdict("source", rule.source, source);
  const target = await loadTable(rule.target, workspace, maxBytes);
  if (!target.ok) return loadVerdict("target", rule.target, target);

  const sourceColumn = findColumn(source.table, rule.column);
  if (!sourceColumn.ok) return undecided(`source column ${shownName(rule.column)} is ${sourceColumn.problem}`);
  const targetColumn = findColumn(target.table, rule.targetColumn);
  if (!targetColumn.ok) return notHeld(`target column ${shownName(rule.targetColumn)} is ${targetColumn.problem}`);
  const problems = new Problems();

  if (!grouped) {
    const outcome = aggregate(columnCells(source.table, sourceColumn.index), op);
    if (!outcome.ok) return sourceProblem(outcome, rule.column, "");
    if (target.table.rows.length !== 1) return notHeld(`target has ${target.table.rows.length} data rows; expected exactly 1`);
    const cell = target.table.rows[0]?.[targetColumn.index] ?? "";
    if (compareValue(outcome.value, cell, 1, rule.targetColumn, tolerance, problems, "")) {
      return held(`recomputed ${outcome.value} from ${outcome.values} cells; target data row 1 agrees`);
    }
    return notHeld(problems.text());
  }

  const groupBy = rule.groupBy as string;
  const keyName = rule.targetKeyColumn as string;
  const keyColumn = findColumn(source.table, groupBy);
  if (!keyColumn.ok) return undecided(`source column ${shownName(groupBy)} is ${keyColumn.problem}`);
  const targetKey = findColumn(target.table, keyName);
  if (!targetKey.ok) return notHeld(`target column ${shownName(keyName)} is ${targetKey.problem}`);

  const grouping = groupCells(source.table, sourceColumn.index, keyColumn.index);
  const computed = new Map<string, { value: number; firstDataRow: number }>();
  for (const group of grouping.groups) {
    const outcome = aggregate(group.cells, op);
    if (!outcome.ok) return sourceProblem(outcome, rule.column, ` (group first seen at source data row ${group.firstDataRow})`);
    computed.set(group.key, { value: outcome.value, firstDataRow: group.firstDataRow });
  }

  const targetRows = new Map<string, number[]>();
  target.table.rows.forEach((row, index) => {
    const key = row[targetKey.index] ?? "";
    const dataRow = index + 1;
    if (key.length === 0) {
      problems.add(`target data row ${dataRow} has an empty key`);
      return;
    }
    const rows = targetRows.get(key) ?? [];
    rows.push(dataRow);
    targetRows.set(key, rows);
  });
  let agreed = 0;
  for (const [key, { value, firstDataRow }] of computed) {
    const rows = targetRows.get(key);
    const label = ` (group first seen at source data row ${firstDataRow})`;
    if (rows === undefined) {
      problems.add(`no target row for the group first seen at source data row ${firstDataRow}`);
      continue;
    }
    if (rows.length > 1) {
      problems.add(`target data rows ${rows.join(", ")} have the same key${label}`);
      continue;
    }
    const targetRow = rows[0] as number;
    const cell = target.table.rows[targetRow - 1]?.[targetColumn.index] ?? "";
    if (compareValue(value, cell, targetRow, rule.targetColumn, tolerance, problems, label)) agreed += 1;
  }
  for (const [key, rows] of targetRows) {
    if (!computed.has(key)) problems.add(`target data row ${rows[0]} has a key that no source row has`);
  }
  const skipped = grouping.withoutKey > 0 ? `; ${grouping.withoutKey} source rows without a group value left out` : "";
  if (problems.size > 0) return notHeld(`${problems.text()}${skipped}`);
  return held(`${agreed} groups agree${skipped}`);
}

async function checkRule(rule: DataRule, workspace: Workspace, maxBytes: number): Promise<Verdict> {
  if (typeof rule !== "object" || rule === null) return undecided("the rule is not valid");
  if (rule.type === "table_shape") return checkShape(rule, workspace, maxBytes);
  if (rule.type === "aggregate_match") return checkAggregate(rule, workspace, maxBytes);
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
}

export async function runDataChecksVerifier(
  config: DataChecksVerifierConfig,
  workspace: Workspace,
  signal: AbortSignal,
  options: DataChecksOptions = {},
): Promise<RawVerifierResult> {
  const maxBytes = options.maxTableBytes ?? MAX_DATA_TABLE_BYTES;
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
        verdict = await checkRule(rule, workspace, maxBytes);
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
