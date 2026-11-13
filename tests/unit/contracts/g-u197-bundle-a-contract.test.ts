/**
 * U-197 (P1 bundle A, unit A-1; DR-69, DR-70; proposal Q-2 to Q-9, R-1 to R-8, P-1): the contract
 * of query_table, the group size k, unreadable paths and the private data task type, before
 * anything carries them out.
 * - DR-70: from a table under unreadablePaths only column names, the keys of groups of at least k
 *   rows, their row counts and aggregates; smaller groups merged into their number only.
 * - k: 5 by default, 2 to 1000; the config file's value is the base and other sources only raise it.
 * - Not carried out yet: query_table is not a task type tool, analyze-private not a built-in id, and
 *   the two problems not among WORKFLOW_PROBLEMS (A-5, A-6 add them with their parts).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AGGREGATE_OPS,
  ALL_TOOL_NAMES,
  ANALYZE_PRIVATE_WORKFLOW_ID,
  BUILTIN_WORKFLOW_IDS,
  DEFAULT_MIN_GROUP_SIZE,
  MAX_QUERY_COUNTED_GROUPS,
  MAX_QUERY_GROUP_COLUMNS,
  MAX_QUERY_OPERATIONS,
  MAX_QUERY_RESULT_GROUPS,
  MAX_QUERY_TABLE_BYTES,
  MIN_GROUP_SIZE_LIMITS,
  POLICY_DENIAL_CODES,
  PRIVATE_DATA_WORKFLOW_PROBLEMS,
  QUERY_TABLE_DEFINITION,
  QUERY_TABLE_DESCRIPTOR,
  QUERY_TABLE_OPS,
  QUERY_TABLE_PROBLEMS,
  QUERY_TABLE_TOOL_NAME,
  REFUSAL_HINTS,
  TOOL_ERROR_CODES,
  TOOL_FAILURE_HINTS,
  TOOL_NAME_PATTERN_SOURCE,
  UNREADABLE_TABLE_OPS,
  WORKFLOW_PROBLEMS,
  effectiveMinGroupSize,
  mergeWorkflowPolicy,
  minGroupSizeFor,
  shownGroups,
  shownShape,
} from "../../../src/contracts/index.js";
import type { PathAccess, PolicyConfig, QueryGroup, QueryTableArgs, QueryTablePayload } from "../../../src/contracts/index.js";

describe("U-197: the values (Q-2 to Q-5)", () => {
  test("k: 5 by default, 2 to 1000", () => {
    assert.equal(DEFAULT_MIN_GROUP_SIZE, 5);
    assert.deepEqual(MIN_GROUP_SIZE_LIMITS, { min: 2, max: 1000 });
  });

  test("operations: all five on a general table, no min or max under unreadable paths", () => {
    assert.deepEqual([...QUERY_TABLE_OPS], [...AGGREGATE_OPS]);
    assert.deepEqual([...UNREADABLE_TABLE_OPS], ["count", "sum", "mean"]);
  });

  test("limits: 2 group columns, 8 operations, 200 groups a call, 10,000 counted, 64 MiB", () => {
    assert.deepEqual(
      [MAX_QUERY_GROUP_COLUMNS, MAX_QUERY_OPERATIONS, MAX_QUERY_RESULT_GROUPS, MAX_QUERY_COUNTED_GROUPS, MAX_QUERY_TABLE_BYTES],
      [2, 8, 200, 10_000, 64 * 1024 * 1024],
    );
  });
});

describe("U-197: the run's k only rises (Q-4)", () => {
  test("the config file's value or 5 is the base; profile, definition and task raise it, never lower it", () => {
    assert.equal(effectiveMinGroupSize(undefined, []), 5);
    assert.equal(effectiveMinGroupSize(2, []), 2, "the user's settings may lower it to 2");
    assert.equal(effectiveMinGroupSize(2, [3, undefined]), 3);
    assert.equal(effectiveMinGroupSize(10, [3, 7]), 10, "no other source lowers it");
    assert.equal(effectiveMinGroupSize(undefined, [undefined, 20]), 20);
  });

  test("a table outside unreadable paths hides nothing (k is 1)", () => {
    assert.deepEqual([minGroupSizeFor(false, 5), minGroupSizeFor(true, 5), minGroupSizeFor(true, 12)], [1, 5, 12]);
  });
});

describe("U-197 DR-70: what of the groups may be given", () => {
  const group = (key: string, rows: number): QueryGroup => ({ keys: [key], rows, values: [rows * 10] });

  test("groups of at least k rows in their order; the others merged into their number only", () => {
    const groups = [group("A", 6), group("B", 5), group("C", 4), group("D", 1)];
    assert.deepEqual(shownGroups(groups, 5), { groups: [group("A", 6), group("B", 5)], suppressedGroups: 2 });
    assert.deepEqual(shownGroups(groups, 1), { groups, suppressedGroups: 0 }, "a general table");
    assert.deepEqual(shownGroups([group("all", 3)], 5), { groups: [], suppressedGroups: 1 }, "the whole table as one small group");
  });

  test("describe hides the rows and the counts of a table with fewer than k rows", () => {
    const columns = [{ name: "region", nonEmpty: 4, numeric: 0 }];
    assert.deepEqual(shownShape(columns, 4, 5), { columns: [{ name: "region", nonEmpty: null, numeric: null }], rows: null });
    assert.deepEqual(shownShape(columns, 5, 5), { columns, rows: 5 });
  });

  test("the only free text of a result is column names and the keys of the groups shown", () => {
    const payload: QueryTablePayload = {
      kind: "groups",
      groupBy: ["region"],
      operations: [{ op: "sum", column: "amount" }],
      groups: [{ keys: ["North"], rows: 6, values: [60] }],
      suppressedGroups: 1,
      next: null,
      minGroupSize: 5,
    };
    const fixed = new Set<string>(["groups", "describe", ...AGGREGATE_OPS]);
    const free = new Set<string>(["region", "amount", "North"]);
    const strings: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === "object" && value !== null) Object.values(value).forEach(walk);
    };
    walk(payload);
    for (const text of strings) assert.ok(fixed.has(text) || free.has(text), text);
  });
});

describe("U-197: query_table's descriptor and definition (not a task type tool yet)", () => {
  test("a read with the access aggregate, which the gate allows under unreadable paths (A-3)", () => {
    const tool = QUERY_TABLE_DESCRIPTOR;
    assert.equal(tool.name, QUERY_TABLE_TOOL_NAME);
    assert.match(tool.name, new RegExp(TOOL_NAME_PATTERN_SOURCE));
    assert.equal(tool.displayClass, "read");
    assert.deepEqual(tool.requires.paths, [{ field: "path", access: "aggregate" }]);
    assert.equal(tool.requires.command || tool.requires.network || tool.requires.destructive, false);
    assert.equal(tool.endsRun, undefined);
    const access: PathAccess = "aggregate";
    assert.ok(access);
  });

  test("its schema: describe or 1 to 8 operations over up to 2 groupBy columns", () => {
    const schema = QUERY_TABLE_DEFINITION.inputSchema as { properties: Record<string, Record<string, unknown>>; required: string[] };
    assert.deepEqual(schema.required, ["path"]);
    assert.deepEqual([schema.properties["groupBy"]?.["maxItems"], schema.properties["operations"]?.["minItems"], schema.properties["operations"]?.["maxItems"]], [2, 1, 8]);
    const args: QueryTableArgs = { path: "data/people.csv", groupBy: ["region"], operations: [{ op: "count", column: "id" }] };
    assert.equal(args.operations?.length, 1);
  });

  test("A-5 makes it a task type tool; A-6 adds analyze-private and the two problems", () => {
    assert.equal((ALL_TOOL_NAMES as readonly string[]).includes(QUERY_TABLE_TOOL_NAME), false);
    assert.equal((BUILTIN_WORKFLOW_IDS as readonly string[]).includes(ANALYZE_PRIVATE_WORKFLOW_ID), false);
    for (const problem of PRIVATE_DATA_WORKFLOW_PROBLEMS) assert.equal((WORKFLOW_PROBLEMS as readonly string[]).includes(problem), false, problem);
    assert.equal(new Set(QUERY_TABLE_PROBLEMS).size, QUERY_TABLE_PROBLEMS.length);
  });
});

describe("U-197: the codes", () => {
  test("unreadable_path is a denial code, added last, with its hint", () => {
    assert.equal(POLICY_DENIAL_CODES.at(-1), "unreadable_path");
    assert.equal(POLICY_DENIAL_CODES.indexOf("path_not_writable"), POLICY_DENIAL_CODES.length - 2, "the codes before it keep their places");
    assert.match(REFUSAL_HINTS.unreadable_path, /query_table/);
  });

  test("too_many_groups and invalid_table are tool error codes, added last", () => {
    assert.deepEqual(TOOL_ERROR_CODES.slice(-3), ["invalid_plan", "too_many_groups", "invalid_table"]);
    assert.equal(typeof TOOL_FAILURE_HINTS.too_many_groups, "string");
  });
});

describe("U-197: the policy fields and their merge (R-2, Q-4)", () => {
  const base: PolicyConfig = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };

  test("unreadable paths add up and k rises in mergeWorkflowPolicy; without them it is as before", () => {
    const merged = mergeWorkflowPolicy({ ...base, unreadablePaths: ["data"], minGroupSize: 10 }, { ...base, unreadablePaths: ["data", "people"], minGroupSize: 3 });
    assert.deepEqual([merged?.unreadablePaths, merged?.minGroupSize], [["data", "people"], 10]);
    const plain = mergeWorkflowPolicy(base, base);
    assert.deepEqual(plain, base, "no key appears when neither states them");
    assert.equal(Object.hasOwn(plain ?? {}, "unreadablePaths") || Object.hasOwn(plain ?? {}, "minGroupSize"), false);
  });
});
