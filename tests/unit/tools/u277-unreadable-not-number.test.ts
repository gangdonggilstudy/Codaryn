/**
 * U-277 (Codex V-28 M1): on a table under unreadablePaths a cell that is not a number must say
 * nothing of a single row. Before, the not_number error named the operation of the earliest such
 * row (so two tables that differ only in their rows' order answered differently), any one such cell
 * made the error (so a single cell's type showed below k), and a cell in a group about to be hidden
 * made it too. Now, on such a table:
 *
 * - (b) a column's cells that are not numbers count as empty (left out of its sum and mean, as
 *   describe's `numeric` leaves them out) unless the groups shown hold at least k of them; then the
 *   query is refused with not_number. A count still counts them, as it counts any non-empty cell
 *   (describe's `nonEmpty`) on every table;
 * - (a) the operation it names is the lowest one so refused, never chosen by the rows' order;
 * - (c) only the groups shown count: a cell of a group of fewer than k rows never makes an error.
 *
 * A table outside the unreadable paths is as before: the first data row's operation, by its row.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { QUERY_TABLE_PROBLEM_HINTS } from "../../../src/contracts/index.js";
import type { RawWorkflowToolOutcome, Workspace } from "../../../src/contracts/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { createFakePrivacy } from "./doubles.js";

const never = new AbortController().signal;
let base: string;
let workspace: Workspace;

const csv = (rows: readonly string[]): string => `${["g,v,w", ...rows].join("\n")}\n`;
const repeat = (row: string, times: number): string[] => Array.from({ length: times }, () => row);

const TABLES: { readonly [name: string]: readonly string[] } = {
  // Codex's error-order-one and -two: the same two rows, their order swapped.
  "order-one": ["HIDDEN,bad,1", "HIDDEN,1,bad"],
  "order-two": ["HIDDEN,1,bad", "HIDDEN,bad,1"],
  // Codex's one-cell-type: one cell a number or not, in a group of fewer than k rows.
  "type-number": ["HIDDEN,73,1"],
  "type-text": ["HIDDEN,bad,1"],
  // A shown group (6 rows): one cell of v not a number, against the same cell empty.
  "shown-one-bad": ["A,bad,1", ...repeat("A,2,1", 5)],
  "shown-one-empty": ["A,,1", ...repeat("A,2,1", 5)],
  "shown-one-bad-last": [...repeat("A,2,1", 5), "A,bad,1"],
  // k (5) cells of v not numbers in the shown group: refused; k - 1: counted as empty.
  "shown-five-bad": [...repeat("A,bad,1", 5), ...repeat("A,2,1", 5)],
  "shown-four-bad": [...repeat("A,bad,1", 4), ...repeat("A,2,1", 6)],
  "shown-four-empty": [...repeat("A,,1", 4), ...repeat("A,2,1", 6)],
  // Both columns with k cells not numbers; w's come first in the rows.
  "both-w-first": [...repeat("A,1,bad", 5), ...repeat("A,bad,1", 5)],
  "both-v-first": [...repeat("A,bad,1", 5), ...repeat("A,1,bad", 5)],
  // Groups of fewer than k rows full of such cells (12 in all), beside a clean shown group.
  "hidden-groups-bad": [...repeat("B,bad,bad", 4), ...repeat("C,bad,bad", 4), ...repeat("D,bad,bad", 4), ...repeat("A,2,1", 5)],
  "hidden-groups-none": [...repeat("A,2,1", 5)],
};

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u277-"));
  const root = path.join(base, "root");
  for (const dir of ["private", "data"]) fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const [name, rows] of Object.entries(TABLES)) {
    fs.writeFileSync(path.join(root, "private", `${name}.csv`), csv(rows));
    fs.writeFileSync(path.join(root, "data", `${name}.csv`), csv(rows));
  }
  workspace = await createWorkspace({ root });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

async function query(table: string, args: Record<string, unknown>): Promise<RawWorkflowToolOutcome> {
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy(), unreadablePaths: ["private"] });
  assert.ok(tools.executeWorkflowTool !== undefined);
  return tools.executeWorkflowTool({ id: "c1", name: "query_table", args: { path: table, ...args } } as never, never);
}
const SUMS = { operations: [{ op: "sum", column: "v" }, { op: "sum", column: "w" }] };
const GROUPED = { groupBy: ["g"], operations: [{ op: "count", column: "v" }, { op: "sum", column: "v" }, { op: "mean", column: "v" }, { op: "sum", column: "w" }] };
const SUMMED = { groupBy: ["g"], operations: [{ op: "sum", column: "v" }, { op: "mean", column: "v" }, { op: "sum", column: "w" }] };
const valuesOf = (outcome: RawWorkflowToolOutcome): unknown =>
  (outcome as unknown as { payload: { groups: { values: unknown }[] } }).payload.groups.map((group) => group.values);
const text = (outcome: RawWorkflowToolOutcome): string => JSON.stringify(outcome);
const refused = (operation: number, column: string): string =>
  `table rejected: not_number at operations[${operation}] (column "${column}" holds cells that are not numbers). ${QUERY_TABLE_PROBLEM_HINTS.not_number}`;

describe("U-277 (V-28 M1): a cell that is not a number on an unreadable table", () => {
  test("Codex's error-order cases: two rows' order gives the same answer (a group of fewer than k rows: no error, nothing shown)", async () => {
    const one = await query("private/order-one.csv", SUMS);
    assert.equal(text(one), text(await query("private/order-two.csv", SUMS)));
    assert.ok(one.ok, text(one));
    assert.deepEqual((one as unknown as { payload: { groups: unknown[]; suppressedGroups: number } }).payload.groups, []);
  });

  test("Codex's one-cell-type cases: a number or not in a group of fewer than k rows gives the same answer", async () => {
    assert.equal(text(await query("private/type-number.csv", SUMS)), text(await query("private/type-text.csv", SUMS)));
  });

  test("(b) fewer than k such cells in the shown groups: each counts as an empty cell in a sum or mean, wherever it lies", async () => {
    const empty = text(await query("private/shown-one-empty.csv", SUMMED));
    assert.equal(text(await query("private/shown-one-bad.csv", SUMMED)), empty);
    assert.equal(text(await query("private/shown-four-bad.csv", SUMMED)), text(await query("private/shown-four-empty.csv", SUMMED)));
    // Wherever it lies, with a count too.
    assert.equal(text(await query("private/shown-one-bad-last.csv", GROUPED)), text(await query("private/shown-one-bad.csv", GROUPED)));
    // A count counts it as the non-empty cell it is; the sum and mean leave it out.
    assert.deepEqual(valuesOf(await query("private/shown-one-bad.csv", GROUPED)), [[6, 10, 2, 6]]);
    assert.deepEqual(valuesOf(await query("private/shown-one-empty.csv", GROUPED)), [[5, 10, 2, 6]]);
  });

  test("(b) k such cells in the shown groups: refused, naming the operation and its column only", async () => {
    const outcome = await query("private/shown-five-bad.csv", GROUPED);
    assert.equal(outcome.ok, false);
    assert.equal((outcome as { message: string }).message, refused(1, "v"));
  });

  test("(a) the lowest refused operation is named, whatever the rows' order", async () => {
    const wFirst = await query("private/both-w-first.csv", SUMS);
    assert.equal(text(wFirst), text(await query("private/both-v-first.csv", SUMS)));
    assert.equal((wFirst as { message: string }).message, refused(0, "v"));
  });

  test("(c) such cells in groups of fewer than k rows make no error and change nothing shown", async () => {
    const bad = await query("private/hidden-groups-bad.csv", GROUPED);
    assert.ok(bad.ok, text(bad));
    const shownBad = (bad as unknown as { payload: { groups: unknown[]; suppressedGroups: number } }).payload;
    const none = (await query("private/hidden-groups-none.csv", GROUPED)) as unknown as { payload: { groups: unknown[] } };
    assert.deepEqual(shownBad.groups, none.payload.groups);
    assert.equal(shownBad.suppressedGroups, 3);
  });

  test("a table outside the unreadable paths is as before: the first data row's operation, by its row", async () => {
    const outcome = await query("data/both-w-first.csv", SUMS);
    assert.equal((outcome as { message: string }).message, `table rejected: not_number at data row 1, operations[1]. ${QUERY_TABLE_PROBLEM_HINTS.not_number}`);
    const one = await query("data/order-one.csv", SUMS);
    assert.equal((one as { message: string }).message, `table rejected: not_number at data row 1, operations[0]. ${QUERY_TABLE_PROBLEM_HINTS.not_number}`);
  });
});
