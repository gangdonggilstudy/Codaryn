/**
 * Shape validation of tool arguments. It checks structure only.
 * Whether a call is permitted is decided by the policy gate.
 * U-15 (AXM-5): the first problem is named as the schema field and a fixed rule, so the model knows
 * what to fix. A field is a schema name (dotted, `[i]` for a list item); a value the model gave,
 * an unknown key among them, is never put in the text.
 */

import {
  AGGREGATE_OPS,
  CONTENT_HASH_PATTERN_SOURCE,
  MAX_COMMAND_TIMEOUT_MS,
  MAX_PLAN_ACTIONS,
  MAX_PLAN_SUMMARY_CHARS,
  MAX_PLANNED_FILES,
  MAX_QUERY_GROUP_COLUMNS,
  MAX_QUERY_OPERATIONS,
  TABLE_FORMATS,
} from "../contracts/index.js";
import type {
  JsonObject,
  JsonValue,
  ToolArgsByName,
  ToolName,
  WorkflowToolArgsByName,
  WorkflowToolName,
} from "../contracts/index.js";

const HASH_PATTERN = new RegExp(CONTENT_HASH_PATTERN_SOURCE);

/** The first problem of a call's arguments. `field` is "" for the arguments as a whole. */
export interface ArgsProblem {
  readonly field: string;
  readonly rule: string;
}

/** Fixed rule texts (model-bound, FIXED_MODEL_TEXTS). */
export const ARGS_RULES = {
  unknownField: "unknown field; allowed: ",
  nonEmpty: "required: a non-empty string",
  optionalString: "must be a string",
  optionalNonEmpty: "must be a non-empty string",
  hash: "required: 64 lowercase hex characters, or null for a new file",
  change: 'required: an object with kind "replace_all" or "replace_text"',
  changeKind: 'must be "replace_all" or "replace_text"',
  text: "required: a string",
  stringList: "required: a list of strings",
  timeout: `must be a whole number of milliseconds from 1 to ${MAX_COMMAND_TIMEOUT_MS}`,
  boolean: "must be true or false",
  summary: `required: a non-empty string of at most ${MAX_PLAN_SUMMARY_CHARS} characters`,
  actions: `required: a list of 1 to ${MAX_PLAN_ACTIONS} actions`,
  action: 'required: an object with kind "move" or "discard"',
  actionKind: 'must be "move" or "discard"',
  // U-180 (DR-69 B-1): propose_changes.
  files: `required: a list of 1 to ${MAX_PLANNED_FILES} files`,
  file: 'required: an object with a path and change "create" or "modify"',
  fileChange: 'must be "create" or "modify"',
  // U-208 (bundle A, A-5): query_table.
  tableFormat: 'must be "csv", "tsv" or "jsonl"',
  describeOnly: "with describe true, give no groupBy, operations or after",
  groupBy: `must be a list of at most ${MAX_QUERY_GROUP_COLUMNS} column names`,
  operations: `required: a list of 1 to ${MAX_QUERY_OPERATIONS} operations, or describe true`,
  operation: 'required: an object with op ("sum", "count", "min", "max" or "mean") and column',
  op: 'must be "sum", "count", "min", "max" or "mean"',
} as const;

/** The lead of the message an argument problem gives the model. */
export const INVALID_ARGS_LEAD = "invalid arguments: ";

/** `invalid arguments: <field>: <rule>`, or without the field for the arguments as a whole. */
export function argsProblemText(problem: ArgsProblem): string {
  return `${INVALID_ARGS_LEAD}${problem.field === "" ? "" : `${problem.field}: `}${problem.rule}`;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An unknown key, named by the keys that are allowed (never by the key given). */
function unknownKeys(value: JsonObject, allowed: readonly string[], field: string): ArgsProblem | null {
  return Object.keys(value).every((key) => allowed.includes(key)) ? null : { field, rule: `${ARGS_RULES.unknownField}${allowed.join(", ")}` };
}

function isNonEmptyString(value: JsonValue | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

const at = (parent: string, name: string): string => (parent === "" ? name : `${parent}.${name}`);

function nonEmpty(args: JsonObject, name: string, parent = ""): ArgsProblem | null {
  return isNonEmptyString(args[name]) ? null : { field: at(parent, name), rule: ARGS_RULES.nonEmpty };
}

function optionalString(args: JsonObject, name: string): ArgsProblem | null {
  const value = args[name];
  return value === undefined || typeof value === "string" ? null : { field: name, rule: ARGS_RULES.optionalString };
}

function changeProblem(change: JsonValue | undefined): ArgsProblem | null {
  if (!isObject(change)) return { field: "change", rule: ARGS_RULES.change };
  if (change["kind"] === "replace_all") {
    return unknownKeys(change, ["kind", "content"], "change") ?? (typeof change["content"] === "string" ? null : { field: "change.content", rule: ARGS_RULES.text });
  }
  if (change["kind"] === "replace_text") {
    return (
      unknownKeys(change, ["kind", "oldText", "newText"], "change") ??
      nonEmpty(change, "oldText", "change") ??
      (typeof change["newText"] === "string" ? null : { field: "change.newText", rule: ARGS_RULES.text })
    );
  }
  return { field: "change.kind", rule: ARGS_RULES.changeKind };
}

/** U-15 (AXM-5): the first problem of a built-in tool's arguments, or null when they fit. */
export function toolArgsProblem(name: ToolName, args: JsonObject): ArgsProblem | null {
  switch (name) {
    case "read_file":
      return unknownKeys(args, ["path"], "") ?? nonEmpty(args, "path");
    case "search_files":
      return unknownKeys(args, ["path", "nameContains", "text"], "") ?? nonEmpty(args, "path") ?? optionalString(args, "nameContains") ?? optionalString(args, "text");
    case "write_file": {
      const problem = unknownKeys(args, ["path", "expectedHash", "change"], "") ?? nonEmpty(args, "path");
      if (problem !== null) return problem;
      // expectedHash is required: a hash, or an explicit null for a file that must not exist.
      const expected = args["expectedHash"];
      if (!Object.hasOwn(args, "expectedHash") || (expected !== null && !(typeof expected === "string" && HASH_PATTERN.test(expected)))) {
        return { field: "expectedHash", rule: ARGS_RULES.hash };
      }
      return changeProblem(args["change"]);
    }
    case "run_command": {
      const problem = unknownKeys(args, ["executable", "args", "cwd", "timeoutMs"], "") ?? nonEmpty(args, "executable");
      if (problem !== null) return problem;
      const list = args["args"];
      if (!Array.isArray(list) || !list.every((item) => typeof item === "string")) return { field: "args", rule: ARGS_RULES.stringList };
      const cwd = optionalString(args, "cwd");
      if (cwd !== null) return cwd;
      const timeout = args["timeoutMs"];
      // T-3: a model may not ask for a longer command time limit than MAX_COMMAND_TIMEOUT_MS.
      const fits = timeout === undefined || (typeof timeout === "number" && Number.isInteger(timeout) && timeout > 0 && timeout <= MAX_COMMAND_TIMEOUT_MS);
      return fits ? null : { field: "timeoutMs", rule: ARGS_RULES.timeout };
    }
  }
}

/** Returns the arguments typed for the tool, or `null` when the shape is invalid. */
export function validateToolArgs<N extends ToolName>(
  name: N,
  args: JsonObject,
): ToolArgsByName[N] | null {
  return toolArgsProblem(name, args) === null ? (args as unknown as ToolArgsByName[N]) : null;
}

function planActionProblem(action: JsonValue | undefined, field: string): ArgsProblem | null {
  if (!isObject(action)) return { field, rule: ARGS_RULES.action };
  if (action["kind"] === "move") {
    return unknownKeys(action, ["kind", "from", "to"], field) ?? nonEmpty(action, "from", field) ?? nonEmpty(action, "to", field);
  }
  if (action["kind"] === "discard") {
    return unknownKeys(action, ["kind", "path"], field) ?? nonEmpty(action, "path", field);
  }
  return { field: `${field}.kind`, rule: ARGS_RULES.actionKind };
}

/** U-180: one planned file of propose_changes: a path and create or modify, nothing else. */
function plannedFileProblem(file: JsonValue | undefined, field: string): ArgsProblem | null {
  if (!isObject(file)) return { field, rule: ARGS_RULES.file };
  const problem = unknownKeys(file, ["path", "change"], field) ?? nonEmpty(file, "path", field);
  if (problem !== null) return problem;
  return file["change"] === "create" || file["change"] === "modify" ? null : { field: `${field}.change`, rule: ARGS_RULES.fileChange };
}

/** U-208: one query_table operation: an op and a column, nothing else. */
function queryOperationProblem(operation: JsonValue | undefined, field: string): ArgsProblem | null {
  if (!isObject(operation)) return { field, rule: ARGS_RULES.operation };
  const problem = unknownKeys(operation, ["op", "column"], field) ?? nonEmpty(operation, "column", field);
  if (problem !== null) return problem;
  return (AGGREGATE_OPS as readonly unknown[]).includes(operation["op"]) ? null : { field: `${field}.op`, rule: ARGS_RULES.op };
}

/** U-208: query_table's arguments: describe alone, or 1 to 8 operations over up to 2 group columns. */
function queryTableProblem(args: JsonObject): ArgsProblem | null {
  const problem = unknownKeys(args, ["path", "format", "describe", "groupBy", "operations", "after"], "") ?? nonEmpty(args, "path");
  if (problem !== null) return problem;
  if (args["format"] !== undefined && !(TABLE_FORMATS as readonly unknown[]).includes(args["format"])) return { field: "format", rule: ARGS_RULES.tableFormat };
  if (args["describe"] !== undefined && typeof args["describe"] !== "boolean") return { field: "describe", rule: ARGS_RULES.boolean };
  if (args["describe"] === true) {
    return args["groupBy"] === undefined && args["operations"] === undefined && args["after"] === undefined ? null : { field: "describe", rule: ARGS_RULES.describeOnly };
  }
  const groupBy = args["groupBy"];
  if (groupBy !== undefined) {
    // A name given twice is the table's problem (`duplicate_column`, query.ts), told after reading it.
    if (!Array.isArray(groupBy) || groupBy.length > MAX_QUERY_GROUP_COLUMNS || !groupBy.every(isNonEmptyString)) {
      return { field: "groupBy", rule: ARGS_RULES.groupBy };
    }
  }
  const operations = args["operations"];
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > MAX_QUERY_OPERATIONS) return { field: "operations", rule: ARGS_RULES.operations };
  for (const [index, operation] of operations.entries()) {
    const found = queryOperationProblem(operation, `operations[${index}]`);
    if (found !== null) return found;
  }
  return args["after"] === undefined || isNonEmptyString(args["after"]) ? null : { field: "after", rule: ARGS_RULES.optionalNonEmpty };
}

/**
 * G-B: the shapes WORKFLOW_TOOL_DEFINITIONS describe. Structure only, as for the built-in tools.
 * U-15 (AXM-5): the first problem, or null when they fit.
 */
export function workflowToolArgsProblem(name: WorkflowToolName, args: JsonObject): ArgsProblem | null {
  switch (name) {
    case "inspect_files": {
      const problem = unknownKeys(args, ["path", "after", "hash"], "") ?? nonEmpty(args, "path");
      if (problem !== null) return problem;
      if (args["after"] !== undefined && !isNonEmptyString(args["after"])) return { field: "after", rule: ARGS_RULES.optionalNonEmpty };
      return args["hash"] === undefined || typeof args["hash"] === "boolean" ? null : { field: "hash", rule: ARGS_RULES.boolean };
    }
    case "propose_plan": {
      const problem = unknownKeys(args, ["summary", "actions"], "");
      if (problem !== null) return problem;
      const summary = args["summary"];
      if (!isNonEmptyString(summary) || summary.length > MAX_PLAN_SUMMARY_CHARS) return { field: "summary", rule: ARGS_RULES.summary };
      const actions = args["actions"];
      if (!Array.isArray(actions) || actions.length < 1 || actions.length > MAX_PLAN_ACTIONS) return { field: "actions", rule: ARGS_RULES.actions };
      for (const [index, action] of actions.entries()) {
        const found = planActionProblem(action, `actions[${index}]`);
        if (found !== null) return found;
      }
      return null;
    }
    case "propose_changes": {
      const problem = unknownKeys(args, ["summary", "files"], "");
      if (problem !== null) return problem;
      const summary = args["summary"];
      if (!isNonEmptyString(summary) || summary.length > MAX_PLAN_SUMMARY_CHARS) return { field: "summary", rule: ARGS_RULES.summary };
      const files = args["files"];
      if (!Array.isArray(files) || files.length < 1 || files.length > MAX_PLANNED_FILES) return { field: "files", rule: ARGS_RULES.files };
      for (const [index, file] of files.entries()) {
        const found = plannedFileProblem(file, `files[${index}]`);
        if (found !== null) return found;
      }
      return null;
    }
    case "query_table":
      return queryTableProblem(args);
  }
}

/** Returns the arguments typed for the task type tool, or `null` when the shape is invalid. */
export function validateWorkflowToolArgs<N extends WorkflowToolName>(
  name: N,
  args: JsonObject,
): WorkflowToolArgsByName[N] | null {
  return workflowToolArgsProblem(name, args) === null ? (args as unknown as WorkflowToolArgsByName[N]) : null;
}
