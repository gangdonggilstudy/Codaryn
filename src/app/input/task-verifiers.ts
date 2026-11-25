/**
 * A task file's verifiers (IR-26 step 3 T2): each verifier kind's fields, the rule sets of
 * file_rules and data_checks, and unique ids. task.ts passes its public name on; of the parser's
 * modules this one imports only task-core.ts.
 */

import { AGGREGATE_OPS, CONFIGURABLE_VERIFIER_KINDS, MARKDOWN_RULE_TYPES, MAX_MARKDOWN_HEADING_CHARS, MAX_MARKDOWN_RULE_HEADINGS, TABLE_FORMATS } from "../../contracts/index.js";
import type { AggregateOp, DataRule, FileRule, MarkdownFileRule, MarkdownHeading, MarkdownRuleType, RowCountRule, TableFormat, TableRef, VerifierConfig } from "../../contracts/index.js";
import { fail, localPathText, record, strings, text, timerMs } from "./task-core.js";
import type { Rec } from "./task-core.js";

/** Parses a verifier list and checks that ids are unique. */
export function parseVerifiers(value: unknown): VerifierConfig[] {
  if (!Array.isArray(value)) fail("verifiers must be an array");
  const verifiers = (value as unknown[]).map(parseVerifier);
  const ids = verifiers.map((verifier) => verifier.id);
  if (new Set(ids).size !== ids.length) fail("verifier ids must be unique");
  return verifiers;
}

const RULE_TYPES = ["exists", "absent", "contains", "not_contains", ...MARKDOWN_RULE_TYPES];

function parseRule(value: unknown, field: string): FileRule {
  // U-116: a Markdown rule has fields of its own, so it is told apart before the fields are checked.
  const given = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec)["type"] : undefined;
  if (given === "markdown_headings" || given === "markdown_links") return parseMarkdownRule(value, field, given);
  const rec = record(value, field, ["type", "path", "text"]);
  const type = rec["type"];
  const rulePath = text(rec["path"], `${field}.path`);
  if (type === "exists" || type === "absent") {
    if (rec["text"] !== undefined) fail(`${field}.text is not used by this rule type`);
    return { type, path: rulePath };
  }
  if (type === "contains" || type === "not_contains") {
    return { type, path: rulePath, text: text(rec["text"], `${field}.text`) };
  }
  return fail(`${field}.type must be one of ${RULE_TYPES.join(", ")}`);
}

/**
 * U-116 (P1 bundle C): a Markdown rule of file_rules in the contract's shape and limits
 * (MarkdownFileRule). A heading's text is kept trimmed, as M-2 compares it; its limit counts code
 * points after trimming. The verifier reads the file; the parser only checks the shape. The
 * diagnostic names the rule: `headings`, `level` and `order` are not among the contract's
 * SCHEMA_FIELD_NAMES yet; the message names the place.
 */
function parseMarkdownRule(value: unknown, field: string, type: MarkdownRuleType): MarkdownFileRule {
  if (type === "markdown_links") {
    const rec = record(value, field, ["type", "path"]);
    return { type, path: text(rec["path"], `${field}.path`) };
  }
  const rec = record(value, field, ["type", "path", "headings", "order"]);
  const rulePath = text(rec["path"], `${field}.path`);
  const list = rec["headings"];
  const atRule = (code: "invalid_value" | "missing_field" = "invalid_value") => ({ code, field });
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_MARKDOWN_RULE_HEADINGS) {
    fail(`${field}.headings must be an array of 1 to ${MAX_MARKDOWN_RULE_HEADINGS} headings`, undefined, atRule(list === undefined ? "missing_field" : "invalid_value"));
  }
  const headings = (list as unknown[]).map((item, index): MarkdownHeading => {
    const at = `${field}.headings[${index}]`;
    const heading = record(item, at, ["text", "level"]);
    const written = heading["text"];
    const trimmed = typeof written === "string" ? written.trim() : "";
    const points = Array.from(trimmed).length;
    if (typeof written !== "string" || points === 0 || points > MAX_MARKDOWN_HEADING_CHARS) {
      fail(`${at}.text must be a string of 1 to ${MAX_MARKDOWN_HEADING_CHARS} characters after trimming`, undefined, atRule());
    }
    const level = heading["level"];
    if (level !== undefined && !(typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= 6)) fail(`${at}.level must be an integer from 1 to 6`, undefined, atRule());
    return { text: trimmed, ...(level === undefined ? {} : { level: level as number }) };
  });
  const order = rec["order"];
  if (order !== undefined && order !== "any" && order !== "in_order") fail(`${field}.order must be "any" or "in_order"`, undefined, atRule());
  return { type, path: rulePath, headings, ...(order === undefined ? {} : { order: order as "any" | "in_order" }) };
}

function parseTableRef(value: unknown, field: string): TableRef {
  const rec = record(value, field, ["path", "format"]);
  const format = rec["format"];
  if (!(TABLE_FORMATS as readonly unknown[]).includes(format)) fail(`${field}.format must be one of ${TABLE_FORMATS.join(", ")}`);
  return { path: text(rec["path"], `${field}.path`), format: format as TableFormat };
}

function count(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(`${field} must be an integer of 0 or more`);
  return value;
}

function parseRowCount(value: unknown, field: string): RowCountRule {
  const rec = record(value, field, ["equals", "min", "max", "sameAs"]);
  const given = ["equals", "min", "max", "sameAs"].filter((key) => rec[key] !== undefined);
  if (rec["equals"] !== undefined) {
    if (given.length !== 1) fail(`${field} takes equals alone`);
    return { equals: count(rec["equals"], `${field}.equals`) };
  }
  if (rec["sameAs"] !== undefined) {
    if (given.length !== 1) fail(`${field} takes sameAs alone`);
    return { sameAs: parseTableRef(rec["sameAs"], `${field}.sameAs`) };
  }
  if (given.length === 0) fail(`${field} needs equals, min, max or sameAs`);
  const min = rec["min"] === undefined ? undefined : count(rec["min"], `${field}.min`);
  const max = rec["max"] === undefined ? undefined : count(rec["max"], `${field}.max`);
  if (min !== undefined && max !== undefined && min > max) fail(`${field}.min must not exceed ${field}.max`);
  return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
}

function tolerance(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${field} must be a number of 0 or more`);
  return value;
}

/** G-A (VF-04): one data rule. Values are checked for shape only; the verifier reads the tables. */
function parseDataRule(value: unknown, field: string): DataRule {
  const type = (value as Rec | null)?.["type"];
  if (type === "table_shape") {
    const rec = record(value, field, ["type", "table", "columns", "columnsMatch", "rows"]);
    const match = rec["columnsMatch"];
    if (match !== undefined && match !== "exact" && match !== "includes") fail(`${field}.columnsMatch must be "exact" or "includes"`);
    if (rec["columns"] === undefined && rec["rows"] === undefined) fail(`${field} needs columns or rows`);
    return {
      type,
      table: parseTableRef(rec["table"], `${field}.table`),
      ...(rec["columns"] === undefined ? {} : { columns: strings(rec["columns"], `${field}.columns`) }),
      ...(match === undefined ? {} : { columnsMatch: match as "exact" | "includes" }),
      ...(rec["rows"] === undefined ? {} : { rows: parseRowCount(rec["rows"], `${field}.rows`) }),
    };
  }
  if (type === "aggregate_match") {
    const rec = record(value, field, ["type", "source", "column", "op", "groupBy", "target", "targetColumn", "targetKeyColumn", "tolerance"]);
    const op = rec["op"];
    if (!(AGGREGATE_OPS as readonly unknown[]).includes(op)) fail(`${field}.op must be one of ${AGGREGATE_OPS.join(", ")}`);
    const groupBy = rec["groupBy"] === undefined ? undefined : text(rec["groupBy"], `${field}.groupBy`);
    const keyColumn = rec["targetKeyColumn"] === undefined ? undefined : text(rec["targetKeyColumn"], `${field}.targetKeyColumn`);
    if ((groupBy === undefined) !== (keyColumn === undefined)) fail(`${field}.targetKeyColumn goes with groupBy, and only with it`);
    let limits: { absolute?: number; relative?: number } | undefined;
    if (rec["tolerance"] !== undefined) {
      const tol = record(rec["tolerance"], `${field}.tolerance`, ["absolute", "relative"]);
      limits = {
        ...(tol["absolute"] === undefined ? {} : { absolute: tolerance(tol["absolute"], `${field}.tolerance.absolute`) }),
        ...(tol["relative"] === undefined ? {} : { relative: tolerance(tol["relative"], `${field}.tolerance.relative`) }),
      };
    }
    return {
      type,
      source: parseTableRef(rec["source"], `${field}.source`),
      column: text(rec["column"], `${field}.column`),
      op: op as AggregateOp,
      ...(groupBy === undefined ? {} : { groupBy }),
      target: parseTableRef(rec["target"], `${field}.target`),
      targetColumn: text(rec["targetColumn"], `${field}.targetColumn`),
      ...(keyColumn === undefined ? {} : { targetKeyColumn: keyColumn }),
      ...(limits === undefined ? {} : { tolerance: limits }),
    };
  }
  return fail(`${field}.type must be "table_shape" or "aggregate_match"`);
}

function parseVerifier(value: unknown, index: number): VerifierConfig {
  const field = `verifiers[${index}]`;
  const kind = (value as Rec | null)?.["kind"];
  if (kind === "command") {
    const rec = record(value, field, ["id", "kind", "executable", "args", "cwd", "timeoutMs", "expectExitCode"]);
    const expect = rec["expectExitCode"];
    if (expect !== undefined && (typeof expect !== "number" || !Number.isInteger(expect))) {
      fail(`${field}.expectExitCode must be an integer`);
    }
    const cwd = rec["cwd"] === undefined ? undefined : localPathText(rec["cwd"], `${field}.cwd`);
    const timeoutMs = timerMs(rec["timeoutMs"], `${field}.timeoutMs`);
    return {
      id: text(rec["id"], `${field}.id`),
      kind: "command",
      executable: localPathText(rec["executable"], `${field}.executable`),
      args: strings(rec["args"], `${field}.args`),
      ...(cwd === undefined ? {} : { cwd }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(expect === undefined ? {} : { expectExitCode: expect as number }),
    };
  }
  if (kind === "file_rules") {
    const rec = record(value, field, ["id", "kind", "rules"]);
    const rules = rec["rules"];
    if (!Array.isArray(rules) || rules.length === 0) fail(`${field}.rules must be a non-empty array`);
    return {
      id: text(rec["id"], `${field}.id`),
      kind: "file_rules",
      rules: rules.map((rule, ruleIndex) => parseRule(rule, `${field}.rules[${ruleIndex}]`)),
    };
  }
  if (kind === "data_checks") {
    // G-A (VF-04): literal table checks for data analysis.
    const rec = record(value, field, ["id", "kind", "rules"]);
    const rules = rec["rules"];
    if (!Array.isArray(rules) || rules.length === 0) fail(`${field}.rules must be a non-empty array`);
    return {
      id: text(rec["id"], `${field}.id`),
      kind: "data_checks",
      rules: (rules as unknown[]).map((rule, ruleIndex) => parseDataRule(rule, `${field}.rules[${ruleIndex}]`)),
    };
  }
  return fail(`${field}.kind must be one of ${CONFIGURABLE_VERIFIER_KINDS.join(", ")}`);
}
