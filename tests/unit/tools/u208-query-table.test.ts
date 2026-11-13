/**
 * U-208 (P1 bundle A, A-5; DR-70; Q-2 to Q-9): the query_table tool on real files.
 *
 * - Any table: the five operations, 0 to 2 group columns, k 1 (nothing hidden), numbers not rounded.
 * - A table under the run's unreadable paths (also reached through a link): count, sum and mean only
 *   (`op_not_allowed`), groups of fewer than k rows hidden and merged into their number, k never
 *   below 5, `describe` hiding the counts of a table of fewer than k rows.
 * - Pages of MAX_QUERY_RESULT_GROUPS with a cursor that names an ordinal only; more than
 *   MAX_QUERY_COUNTED_GROUPS groups is `too_many_groups`.
 * - A failure names a code and a row, line or argument index, never a cell, a path or a column name.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { MAX_QUERY_COUNTED_GROUPS, MAX_QUERY_RESULT_GROUPS, QUERY_CURSOR_PATTERN_SOURCE } from "../../../src/contracts/index.js";
import type { QueryTablePayload, RawWorkflowToolOutcome, Workspace } from "../../../src/contracts/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { queryTableTool } from "../../../src/tools/query-table.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { createFakePrivacy } from "./doubles.js";

const never = new AbortController().signal;
const CANARY = `cnry${randomBytes(6).toString("hex")}`;
let base: string;
let workspace: Workspace;
let linked = false;

const rows = (header: string, lines: readonly string[]): string => `${[header, ...lines].join("\n")}\n`;

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u208-"));
  const root = path.join(base, "root");
  fs.mkdirSync(path.join(root, "private"), { recursive: true });
  fs.mkdirSync(path.join(root, "data"));
  const files: Record<string, string | Buffer> = {
    "data/sales.csv": rows("region,product,amount,qty", ["east,a,10,1", "east,b,20,2", "west,a,5,3", "west,a,7.5,", "north,b,1,1", ",a,100,1"]),
    "data/thirds.csv": rows("g,v", ["x,1", "x,1", "x,2"]),
    "data/sales.tsv": "region\tamount\neast\t2\neast\t3\n",
    "data/sales.jsonl": '{"region":"east","amount":2}\n{"region":"east","amount":4}\n',
    "data/sales.txt": rows("region,amount", ["east,1"]),
    "data/many.csv": rows("k,v", Array.from({ length: 450 }, (_, index) => `k${String(index).padStart(4, "0")},1`)),
    "data/too-many.csv": rows("k,v", Array.from({ length: MAX_QUERY_COUNTED_GROUPS + 1 }, (_, index) => `k${index},1`)),
    "data/bad-number.csv": rows("g,v", ["x,1", `x,${CANARY}`]),
    "data/bad-quote.csv": rows("g,v", ["x,1", `x,"${CANARY}`]),
    "data/doubled.csv": rows("g,v,v", ["x,1,2"]),
    "data/not-text.csv": Buffer.from([0x67, 0x2c, 0x76, 0x0a, 0xff, 0xfe, 0x2c, 0x31, 0x0a]),
    // 15 data rows: big 6, mid 5, small 2, tiny 1, and one without a city.
    "private/people.csv": rows("name,city,amount", [
      ...Array.from({ length: 6 }, (_, index) => `${CANARY}b${index},big,${index + 1}`),
      ...Array.from({ length: 5 }, (_, index) => `${CANARY}m${index},mid,${10 * (index + 1)}`),
      `${CANARY}s0,small,100`,
      `${CANARY}s1,small,200`,
      `${CANARY}t0,tiny,1000`,
      `${CANARY}e0,,5000`,
    ]),
    "private/few.csv": rows("name,amount", ["a,1", "b,2", "c,3"]),
  };
  for (const [relative, content] of Object.entries(files)) fs.writeFileSync(path.join(root, relative), content);
  try {
    fs.symlinkSync(path.join(root, "private"), path.join(root, "alias"), "junction");
    linked = true;
  } catch {
    linked = false;
  }
  workspace = await createWorkspace({ root });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

interface Options {
  readonly unreadablePaths?: readonly string[];
  readonly minGroupSize?: number;
  readonly maxTableBytes?: number;
}

async function query(args: Record<string, unknown>, options: Options = {}, signal = never): Promise<RawWorkflowToolOutcome> {
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy(), ...options });
  assert.ok(tools.executeWorkflowTool !== undefined);
  return tools.executeWorkflowTool({ id: "c1", name: "query_table", args } as never, signal);
}

type Groups = Extract<QueryTablePayload, { kind: "groups" }>;
type Shape = Extract<QueryTablePayload, { kind: "describe" }>;

function groupsOf(outcome: RawWorkflowToolOutcome): Groups {
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const payload = (outcome as { payload: QueryTablePayload }).payload;
  assert.equal(payload.kind, "groups");
  return payload as Groups;
}
function shapeOf(outcome: RawWorkflowToolOutcome): Shape {
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const payload = (outcome as { payload: QueryTablePayload }).payload;
  assert.equal(payload.kind, "describe");
  return payload as Shape;
}
function failureOf(outcome: RawWorkflowToolOutcome): { code: string; message: string } {
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  const failed = outcome as { code: string; message: string };
  return { code: failed.code, message: String(failed.message) };
}

const PRIVATE = { unreadablePaths: ["private"] } as const;
const PEOPLE_QUERY = {
  path: "private/people.csv",
  groupBy: ["city"],
  operations: [
    { op: "count", column: "name" },
    { op: "sum", column: "amount" },
    { op: "mean", column: "amount" },
  ],
};

describe("U-208: query_table on any table", () => {
  test("the five operations by one column: every group shown (k 1), a row without a key left out, numbers as computed", async () => {
    const operations = ["sum", "count", "min", "max", "mean"].map((op) => ({ op, column: op === "count" ? "qty" : "amount" }));
    const payload = groupsOf(await query({ path: "data/sales.csv", groupBy: ["region"], operations }));
    assert.deepEqual(payload.groups, [
      { keys: ["east"], rows: 2, values: [30, 2, 10, 20, 15] },
      { keys: ["north"], rows: 1, values: [1, 1, 1, 1, 1] },
      { keys: ["west"], rows: 2, values: [12.5, 1, 5, 7.5, 6.25] },
    ]);
    assert.deepEqual(payload.groupBy, ["region"]);
    assert.deepEqual(payload.operations, operations);
    assert.equal(payload.suppressedGroups, 0);
    assert.equal(payload.next, null);
    assert.equal(payload.minGroupSize, 1);
  });

  test("without groupBy: one group with no keys over every row; a mean not rounded", async () => {
    const all = groupsOf(await query({ path: "data/sales.csv", operations: [{ op: "count", column: "region" }] }));
    assert.deepEqual(all.groups, [{ keys: [], rows: 6, values: [5] }]);
    const thirds = groupsOf(await query({ path: "data/thirds.csv", operations: [{ op: "mean", column: "v" }] }));
    assert.equal(thirds.groups[0]?.values[0], 4 / 3);
  });

  test("two group columns", async () => {
    const payload = groupsOf(await query({ path: "data/sales.csv", groupBy: ["region", "product"], operations: [{ op: "sum", column: "amount" }] }));
    assert.deepEqual(
      payload.groups.map((group) => [...group.keys, group.rows, group.values[0]]),
      [
        ["east", "a", 1, 10],
        ["east", "b", 1, 20],
        ["north", "b", 1, 1],
        ["west", "a", 2, 12.5],
      ],
    );
  });

  test("the format from the extension (.tsv, .jsonl), or given for another extension; none for .txt is invalid_args", async () => {
    const sum = [{ op: "sum", column: "amount" }];
    assert.equal(groupsOf(await query({ path: "data/sales.tsv", operations: sum })).groups[0]?.values[0], 5);
    assert.equal(groupsOf(await query({ path: "data/sales.jsonl", operations: sum })).groups[0]?.values[0], 6);
    assert.equal(groupsOf(await query({ path: "data/sales.txt", format: "csv", operations: sum })).groups[0]?.values[0], 1);
    assert.equal(failureOf(await query({ path: "data/sales.txt", operations: sum })).code, "invalid_args");
  });

  test("describe: the columns in header order with their counts", async () => {
    const shape = shapeOf(await query({ path: "data/sales.csv", describe: true }));
    assert.equal(shape.rows, 6);
    assert.equal(shape.minGroupSize, 1);
    assert.deepEqual(shape.columns.map((column) => column.name), ["region", "product", "amount", "qty"]);
    assert.deepEqual(shape.columns[3], { name: "qty", nonEmpty: 5, numeric: 5 });
  });

  test("pages of MAX_QUERY_RESULT_GROUPS: next is a cursor of the ordinal; one at or past the end is after_not_found", async () => {
    const ask = (after?: string) => query({ path: "data/many.csv", groupBy: ["k"], operations: [{ op: "sum", column: "v" }], ...(after === undefined ? {} : { after }) });
    const first = groupsOf(await ask());
    assert.equal(first.groups.length, MAX_QUERY_RESULT_GROUPS);
    assert.equal(first.next, `g${MAX_QUERY_RESULT_GROUPS}`);
    assert.match(first.next ?? "", new RegExp(QUERY_CURSOR_PATTERN_SOURCE));
    const second = groupsOf(await ask(first.next ?? undefined));
    assert.equal(second.groups[0]?.keys[0], "k0200");
    const last = groupsOf(await ask(second.next ?? undefined));
    assert.equal(last.groups.length, 450 - 2 * MAX_QUERY_RESULT_GROUPS);
    assert.equal(last.next, null);
    for (const cursor of ["g450", "g9999", "k0200", "g01"]) {
      assert.deepEqual(failureOf(await ask(cursor)), { code: "invalid_table", message: "table rejected: after_not_found" }, cursor);
    }
  });

  test(`more than ${MAX_QUERY_COUNTED_GROUPS} groups is too_many_groups`, async () => {
    const failure = failureOf(await query({ path: "data/too-many.csv", groupBy: ["k"], operations: [{ op: "count", column: "v" }] }));
    assert.deepEqual(failure, { code: "too_many_groups", message: `the query counts more than ${MAX_QUERY_COUNTED_GROUPS} groups` });
  });
});

describe("U-208: query_table on a table under the unreadable paths", () => {
  test("count, sum and mean; groups of fewer than k (5) rows hidden and merged into their number", async () => {
    const payload = groupsOf(await query(PEOPLE_QUERY, PRIVATE));
    assert.deepEqual(payload.groups, [
      { keys: ["big"], rows: 6, values: [6, 21, 3.5] },
      { keys: ["mid"], rows: 5, values: [5, 150, 30] },
    ]);
    assert.equal(payload.suppressedGroups, 2);
    assert.equal(payload.minGroupSize, 5);
    const text = JSON.stringify(payload);
    assert.equal(text.includes("small") || text.includes("tiny") || text.includes(CANARY), false, text);
  });

  test("the run's k applies (7 hides mid too); a k below 5 is raised to 5", async () => {
    const seven = groupsOf(await query(PEOPLE_QUERY, { ...PRIVATE, minGroupSize: 7 }));
    assert.deepEqual(seven.groups, []);
    assert.equal(seven.suppressedGroups, 4);
    assert.equal(seven.minGroupSize, 7);
    const six = groupsOf(await query(PEOPLE_QUERY, { ...PRIVATE, minGroupSize: 6 }));
    assert.deepEqual(six.groups.map((group) => group.keys[0]), ["big"]);
    const two = groupsOf(await query(PEOPLE_QUERY, { ...PRIVATE, minGroupSize: 2 }));
    assert.equal(two.minGroupSize, 5);
    assert.deepEqual(two.groups.map((group) => group.keys[0]), ["big", "mid"]);
  });

  test("min and max are op_not_allowed, by their index", async () => {
    for (const op of ["min", "max"]) {
      const failure = failureOf(await query({ ...PEOPLE_QUERY, operations: [{ op: "count", column: "name" }, { op, column: "amount" }] }, PRIVATE));
      assert.deepEqual(failure, { code: "invalid_table", message: "table rejected: op_not_allowed at operations[1].op" });
    }
  });

  test("a table outside the unreadable paths keeps every operation and k 1 in the same run", async () => {
    const payload = groupsOf(await query({ path: "data/sales.csv", groupBy: ["region"], operations: [{ op: "min", column: "amount" }] }, PRIVATE));
    assert.equal(payload.minGroupSize, 1);
    assert.equal(payload.groups.length, 3);
  });

  test("describe: counts of a table of at least k rows; of fewer, the column names only", async () => {
    const people = shapeOf(await query({ path: "private/people.csv", describe: true }, PRIVATE));
    assert.equal(people.rows, 15);
    // V-19: a count below k is hidden (no cell of city is a number).
    assert.deepEqual(people.columns[1], { name: "city", nonEmpty: 14, numeric: null });
    const few = shapeOf(await query({ path: "private/few.csv", describe: true }, PRIVATE));
    assert.deepEqual(few, {
      kind: "describe",
      columns: [
        { name: "name", nonEmpty: null, numeric: null },
        { name: "amount", nonEmpty: null, numeric: null },
      ],
      rows: null,
      minGroupSize: 5,
    });
  });

  test("through a link to the unreadable folder the table is still under them (its real path)", async (t) => {
    if (!linked) return t.skip("junctions cannot be made here");
    const payload = groupsOf(await query({ ...PEOPLE_QUERY, path: "alias/people.csv" }, PRIVATE));
    assert.equal(payload.minGroupSize, 5);
    assert.equal(payload.suppressedGroups, 2);
    const failure = failureOf(await query({ ...PEOPLE_QUERY, path: "alias/people.csv", operations: [{ op: "max", column: "amount" }] }, PRIVATE));
    assert.equal(failure.message, "table rejected: op_not_allowed at operations[0].op");
  });
});

describe("U-208: a failure names a code and a place, never a cell, a path or a column name", () => {
  const cases: readonly [string, Record<string, unknown>, { code: string; message: string }][] = [
    ["not_number", { path: "data/bad-number.csv", operations: [{ op: "sum", column: "v" }] }, { code: "invalid_table", message: "table rejected: not_number at data row 2, operations[0]" }],
    ["not_table", { path: "data/bad-quote.csv", operations: [{ op: "count", column: "v" }] }, { code: "invalid_table", message: "table rejected: not_table at line 3 (unterminated_quote)" }],
    ["not_text", { path: "data/not-text.csv", operations: [{ op: "count", column: "v" }] }, { code: "invalid_table", message: "table rejected: not_text" }],
    ["unknown_column", { path: "data/sales.csv", groupBy: [CANARY], operations: [{ op: "count", column: "qty" }] }, { code: "invalid_table", message: "table rejected: unknown_column at groupBy[0]" }],
    ["unknown_column (operation)", { path: "data/sales.csv", operations: [{ op: "count", column: CANARY }] }, { code: "invalid_table", message: "table rejected: unknown_column at operations[0].column" }],
    ["duplicate_column (header)", { path: "data/doubled.csv", operations: [{ op: "sum", column: "v" }] }, { code: "invalid_table", message: "table rejected: duplicate_column at operations[0].column" }],
    ["duplicate_column (groupBy twice)", { path: "data/sales.csv", groupBy: ["region", "region"], operations: [{ op: "count", column: "qty" }] }, { code: "invalid_table", message: "table rejected: duplicate_column at groupBy[1]" }],
    ["groupBy twice, unknown: the first place wins", { path: "data/sales.csv", groupBy: [CANARY, CANARY], operations: [{ op: "count", column: "qty" }] }, { code: "invalid_table", message: "table rejected: unknown_column at groupBy[0]" }],
    ["groupBy twice on a broken table: the table wins", { path: "data/bad-quote.csv", groupBy: ["g", "g"], operations: [{ op: "count", column: "v" }] }, { code: "invalid_table", message: "table rejected: not_table at line 3 (unterminated_quote)" }],
    ["not found", { path: "data/missing.csv", operations: [{ op: "count", column: "v" }] }, { code: "not_found", message: "no table file at this path" }],
    ["a folder", { path: "data", format: "csv", operations: [{ op: "count", column: "v" }] }, { code: "not_found", message: "no table file at this path" }],
  ];
  for (const [name, args, expected] of cases) {
    test(name, async () => {
      const failure = failureOf(await query(args));
      assert.deepEqual(failure, expected);
      assert.equal(failure.message.includes(CANARY), false);
    });
  }

  test("too_large: a table above the size limit is not read", async () => {
    const failure = failureOf(await query({ path: "data/sales.csv", operations: [{ op: "count", column: "qty" }] }, { maxTableBytes: 10 }));
    assert.deepEqual(failure, { code: "too_large", message: "the table is larger than 10 bytes" });
  });

  test("cancelled: an aborted run reads nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const failure = failureOf(await query({ path: "data/sales.csv", operations: [{ op: "count", column: "qty" }] }, {}, controller.signal));
    assert.equal(failure.code, "cancelled");
  });
});

describe("U-208: the table is read in pieces", () => {
  test("three-byte chunks give the same groups as one piece, also across a Korean key", async () => {
    fs.writeFileSync(path.join(workspace.root, "data", "ko.csv"), rows("지역,금액", ["서울,1", "서울,2", "부산,4"]));
    const args = { path: "data/ko.csv", groupBy: ["지역"], operations: [{ op: "sum" as const, column: "금액" }] };
    const whole = await queryTableTool({ workspace, minGroupSize: 5 }, args, never);
    const pieces = await queryTableTool({ workspace, minGroupSize: 5, chunkBytes: 3 }, args, never);
    assert.deepEqual(pieces, whole);
    assert.deepEqual(groupsOf(pieces).groups, [
      { keys: ["부산"], rows: 1, values: [4] },
      { keys: ["서울"], rows: 2, values: [3] },
    ]);
  });
});
