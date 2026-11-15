/**
 * U-202 (bundle A, A-2): the table reading query_table (A-5) will run, in its contract's shapes
 * (src/contracts/query.ts): groups in code unit order of their keys, values per operation (null
 * where there is none), the rows left out for an empty key, the problems and which one wins, the
 * group cap, a table's shape for `describe`. Then seeded random tables against the whole-table
 * parser and aggregate of before (./reference): the same groups and the same numbers.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { AggregateOp, QueryOperation, TableFormat } from "../../../src/contracts/index.js";
import { queryTable, tableShape } from "../../../src/tabular/index.js";
import type { TableQuery, TableQueryOutcome } from "../../../src/tabular/index.js";
import { aggregate as aggregateV1 } from "./reference/aggregate-v1.js";
import { findColumn as findColumnV1, parseTable as parseTableV1 } from "./reference/table-v1.js";

const bytes = (text: string): Uint8Array[] => [new TextEncoder().encode(text)];
const query = (text: string, q: TableQuery, format: TableFormat = "csv"): Promise<TableQueryOutcome> => queryTable(bytes(text), format, q);
const op = (name: AggregateOp, column: string): QueryOperation => ({ op: name, column });

const SALES = ["region,city,amount,note", "north,a,10,x", "south,b,4,y", "north,a,2.5,z", ",c,100,w", "east,b,,v", "east,b,1,u"].join("\n");

test("U-202 query: groups by one column in code unit order, a value per operation, rows without a key left out", async () => {
  const outcome = await query(SALES, {
    groupBy: ["region"],
    operations: [op("sum", "amount"), op("count", "amount"), op("mean", "amount"), op("min", "amount"), op("max", "amount"), op("count", "note")],
  });
  assert.deepEqual(outcome, {
    ok: true,
    rows: 6,
    withoutKey: 1,
    groups: [
      { keys: ["east"], rows: 2, values: [1, 1, 1, 1, 1, 2] },
      { keys: ["north"], rows: 2, values: [12.5, 2, 6.25, 2.5, 10, 2] },
      { keys: ["south"], rows: 1, values: [4, 1, 4, 4, 4, 1] },
    ],
  });
});

test("U-202 query: two groupBy columns; no groupBy is one group without keys, even with no data row", async () => {
  assert.deepEqual(await query(SALES, { groupBy: ["city", "region"], operations: [op("sum", "amount")] }), {
    ok: true,
    rows: 6,
    withoutKey: 1,
    groups: [
      { keys: ["a", "north"], rows: 2, values: [12.5] },
      { keys: ["b", "east"], rows: 2, values: [1] },
      { keys: ["b", "south"], rows: 1, values: [4] },
    ],
  });
  assert.deepEqual(await query(SALES, { groupBy: [], operations: [op("sum", "amount"), op("count", "region")] }), {
    ok: true,
    rows: 6,
    withoutKey: 0,
    groups: [{ keys: [], rows: 6, values: [117.5, 5] }],
  });
  assert.deepEqual(await query("a,b\n", { groupBy: [], operations: [op("count", "a"), op("sum", "b")] }), {
    ok: true,
    rows: 0,
    withoutKey: 0,
    groups: [{ keys: [], rows: 0, values: [0, null] }],
  });
});

test("U-202 query: no value is null (no number in the group, a sum beyond a double); count is always a number", async () => {
  const outcome = await query("k,v,w\na,,1e308\na,,1e308\nb,3,1\n", { groupBy: ["k"], operations: [op("mean", "v"), op("count", "v"), op("sum", "w"), op("max", "w")] });
  assert.deepEqual(outcome, {
    ok: true,
    rows: 3,
    withoutKey: 0,
    groups: [
      { keys: ["a"], rows: 2, values: [null, 0, null, 1e308] },
      { keys: ["b"], rows: 1, values: [3, 1, 1, 1] },
    ],
  });
});

test("U-202 query: keys sort by UTF-16 code units, key by key; keys that join alike stay apart", async () => {
  const text = ["k,j", "a,1", "B,1", "é,1", "😀,1", "Z,1", "ab,1", "a,b1", "a,b", "1:a,1", "c,"].join("\n");
  const one = await query(text, { groupBy: ["k"], operations: [op("count", "j")] });
  assert.ok(one.ok);
  assert.deepEqual(
    one.groups.map((group) => group.keys[0]),
    ["1:a", "B", "Z", "a", "ab", "c", "é", "😀"],
  );
  const two = await query(text, { groupBy: ["k", "j"], operations: [op("count", "j")] });
  assert.ok(two.ok);
  // "a"+"b1" and "ab"+"1" are the same text joined; they stay two groups.
  assert.deepEqual(
    two.groups.map((group) => group.keys),
    [["1:a", "1"], ["B", "1"], ["Z", "1"], ["a", "1"], ["a", "b"], ["a", "b1"], ["ab", "1"], ["é", "1"], ["😀", "1"]],
  );
  assert.equal(two.withoutKey, 1);
});

test("U-202 query: a column the header lacks or holds twice names the argument, never echoes it", async () => {
  assert.deepEqual(await query(SALES, { groupBy: ["region", "nope"], operations: [op("sum", "amount")] }), {
    ok: false,
    problem: "unknown_column",
    field: "groupBy",
    index: 1,
  });
  assert.deepEqual(await query(SALES, { groupBy: ["region"], operations: [op("sum", "amount"), op("sum", "nope")] }), {
    ok: false,
    problem: "unknown_column",
    field: "operations",
    index: 1,
  });
  assert.deepEqual(await query("a,a,b\n1,2,3\n", { groupBy: ["b"], operations: [op("sum", "a")] }), {
    ok: false,
    problem: "duplicate_column",
    field: "operations",
    index: 0,
  });
  // Not named by the query: a doubled header name does not matter.
  assert.equal((await query("a,a,b\n1,2,3\n", { groupBy: ["b"], operations: [op("count", "b")] })).ok, true);
});

test("U-202 query: the first data row that is not a number wins, the lower operation on a tie; text is never echoed", async () => {
  const text = ["k,v,w", "a,1,1", "a,x1,1", "b,2,y2", "b,z3,1"].join("\n");
  assert.deepEqual(await query(text, { groupBy: ["k"], operations: [op("sum", "w"), op("sum", "v")] }), {
    ok: false,
    problem: "not_number",
    dataRow: 2,
    operation: 1,
  });
  const tie = ["k,v,w", "a,1,1", "b,x,y"].join("\n");
  assert.deepEqual(await query(tie, { groupBy: ["k"], operations: [op("max", "w"), op("min", "v")] }), {
    ok: false,
    problem: "not_number",
    dataRow: 2,
    operation: 0,
  });
  // count needs no number; a row left out for an empty key is not checked.
  assert.equal((await query(["k,v", "a,1", ",x"].join("\n"), { groupBy: ["k"], operations: [op("sum", "v"), op("count", "v")] })).ok, true);
});

test("U-202 query: more groups than the cap is too_many_groups; a row of a group not kept is still checked for numbers", async () => {
  const text = ["k,v", "a,1", "b,1", "c,1", "a,2"].join("\n");
  assert.deepEqual(await query(text, { groupBy: ["k"], operations: [op("sum", "v")], maxGroups: 2 }), { ok: false, problem: "too_many_groups" });
  assert.equal((await query(text, { groupBy: ["k"], operations: [op("sum", "v")], maxGroups: 3 })).ok, true);
  const bad = ["k,v", "a,1", "b,1", "c,x", "a,2"].join("\n");
  assert.deepEqual(await query(bad, { groupBy: ["k"], operations: [op("sum", "v")], maxGroups: 2 }), {
    ok: false,
    problem: "not_number",
    dataRow: 3,
    operation: 0,
  });
});

test("U-202 query: a table that is not UTF-8 or does not parse names a code and a place only", async () => {
  assert.deepEqual(await queryTable([Uint8Array.from([0x6b, 0x0a, 0xff])], "csv", { groupBy: [], operations: [op("count", "k")] }), { ok: false, problem: "not_text" });
  assert.deepEqual(await query('k,v\na,"1\n', { groupBy: [], operations: [op("count", "k")] }), {
    ok: false,
    problem: "not_table",
    table: { code: "unterminated_quote", dataRow: 1, line: 2 },
  });
  // A parser's own message holds the line's text; it never comes out.
  const outcome = await query('{"k":"a"}\n{"k": SECRETCELL}\n', { groupBy: [], operations: [op("count", "k")] }, "jsonl");
  assert.deepEqual(outcome, { ok: false, problem: "not_table", table: { code: "not_json", dataRow: 2, line: 2 } });
  assert.equal(JSON.stringify(outcome).includes("SECRETCELL"), false);
});

test("U-202 query: jsonl columns first seen in a later row are empty cells of the rows before", async () => {
  const text = ['{"v":1}', '{"k":"a","v":2}', '{"k":"a","v":3,"w":4}', '{"k":"b"}'].join("\n");
  assert.deepEqual(await query(text, { groupBy: ["k"], operations: [op("sum", "v"), op("count", "w")] }, "jsonl"), {
    ok: true,
    rows: 4,
    withoutKey: 1,
    groups: [
      { keys: ["a"], rows: 2, values: [5, 1] },
      { keys: ["b"], rows: 1, values: [null, 0] },
    ],
  });
  assert.deepEqual(await query(text, { groupBy: ["nope"], operations: [op("count", "v")] }, "jsonl"), {
    ok: false,
    problem: "unknown_column",
    field: "groupBy",
    index: 0,
  });
});

test("U-202 describe: columns in header order with their non-empty and number cells, before k hides anything", async () => {
  assert.deepEqual(await tableShape(bytes(SALES), "csv"), {
    ok: true,
    rows: 6,
    columns: [
      { name: "region", nonEmpty: 5, numeric: 0 },
      { name: "city", nonEmpty: 6, numeric: 0 },
      { name: "amount", nonEmpty: 5, numeric: 5 },
      { name: "note", nonEmpty: 6, numeric: 0 },
    ],
  });
  assert.deepEqual(await tableShape(bytes('{"a":1}\n{"b":"x","a":"2"}\n{"a":null}'), "jsonl"), {
    ok: true,
    rows: 3,
    columns: [
      { name: "a", nonEmpty: 2, numeric: 2 },
      { name: "b", nonEmpty: 1, numeric: 0 },
    ],
  });
  assert.deepEqual(await tableShape(bytes("a\tb\n1\n"), "tsv"), { ok: false, problem: "not_table", table: { code: "field_count", dataRow: 1, line: 2 } });
});

/** mulberry32. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same query over the whole table with the reference parser and aggregate (only well-formed, all-number cases). */
function referenceGroups(text: string, format: TableFormat, groupBy: readonly string[], operations: readonly QueryOperation[]) {
  const parsed = parseTableV1(text, format);
  assert.ok(parsed.ok);
  const keyAt = groupBy.map((name) => {
    const found = findColumnV1(parsed.table, name);
    assert.ok(found.ok);
    return found.index;
  });
  const opAt = operations.map((operation) => {
    const found = findColumnV1(parsed.table, operation.column);
    assert.ok(found.ok);
    return found.index;
  });
  const groups = new Map<string, { keys: string[]; rows: { cells: readonly string[]; dataRow: number }[] }>();
  let withoutKey = 0;
  parsed.table.rows.forEach((cells, index) => {
    const keys = keyAt.map((at) => cells[at] ?? "");
    if (keys.some((key) => key.length === 0)) {
      withoutKey += 1;
      return;
    }
    const id = JSON.stringify(keys);
    const group = groups.get(id) ?? { keys, rows: [] };
    group.rows.push({ cells, dataRow: index + 1 });
    groups.set(id, group);
  });
  if (groupBy.length === 0 && groups.size === 0) groups.set("[]", { keys: [], rows: [] });
  const out = [...groups.values()].map((group) => ({
    keys: group.keys,
    rows: group.rows.length,
    values: operations.map((operation, index) => {
      const result = aggregateV1(group.rows.map((row) => ({ cell: row.cells[opAt[index] as number] ?? "", dataRow: row.dataRow })), operation.op);
      return result.ok ? result.value : null;
    }),
  }));
  out.sort((a, b) => {
    for (let index = 0; index < a.keys.length; index += 1) {
      if ((a.keys[index] as string) < (b.keys[index] as string)) return -1;
      if ((a.keys[index] as string) > (b.keys[index] as string)) return 1;
    }
    return 0;
  });
  return { ok: true, rows: parsed.table.rows.length, withoutKey, groups: out };
}

test("U-202 query: seeded random tables give the groups and numbers the whole-table reading computes", async () => {
  const rng = random(7202);
  const ops: AggregateOp[] = ["sum", "count", "min", "max", "mean"];
  for (let round = 0; round < 400; round += 1) {
    const format: TableFormat = (["csv", "tsv", "jsonl"] as const)[round % 3] as TableFormat;
    const keys = ["n", "s", "é", "", "x y"];
    const rows: { k: string; j: string; v: string; w: string }[] = [];
    for (let row = 0; row < Math.floor(rng() * 40); row += 1) {
      const number = (): string => (rng() < 0.2 ? "" : String(Math.round((rng() * 2000 - 1000) * 1000) / 1000));
      rows.push({ k: keys[Math.floor(rng() * keys.length)] as string, j: keys[Math.floor(rng() * 3)] as string, v: number(), w: number() });
    }
    let text: string;
    if (format === "jsonl") {
      text = rows.length === 0 ? '{"k":"n","j":"n","v":"","w":""}' : rows.map((row) => JSON.stringify(row)).join("\n");
    } else {
      const sep = format === "csv" ? "," : "\t";
      text = ["k", "j", "v", "w"].join(sep) + "\n" + rows.map((row) => [row.k, row.j, row.v, row.w].join(sep)).join("\n");
    }
    const groupBy = [[], ["k"], ["k", "j"], ["j"]][round % 4] as string[];
    const operations = [op(ops[Math.floor(rng() * 5)] as AggregateOp, "v"), op(ops[Math.floor(rng() * 5)] as AggregateOp, "w"), op("count", "k")];
    const outcome = await queryTable(bytes(text), format, { groupBy, operations });
    assert.deepEqual(outcome, referenceGroups(text, format, groupBy, operations), `${format} round ${round}`);
  }
});
