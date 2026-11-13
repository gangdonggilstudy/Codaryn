/**
 * U-277 (Codex V-28 M1, V-28b): on a table under unreadablePaths a cell that is not a number must
 * say nothing of a single row. Before, the not_number error named the operation of the earliest such
 * row (so two tables that differ only in their rows' order answered differently), any one such cell
 * made the error (so a single cell's type showed below k), and a cell in a group about to be hidden
 * made it too. A first fix refused only at k such cells in the groups shown; V-28b showed that this
 * threshold, beside describe's counts of the whole table, told whether the one hidden row's cell was
 * a number (threshold-oracle a and b). Now, on such a table:
 *
 * - no query is refused with not_number, whatever the table holds;
 * - a cell that is not a number is always left out of a sum and a mean as an empty cell is (describe's
 *   `numeric` leaves it out too); a count still counts it, as it counts any non-empty cell (describe's
 *   `nonEmpty`) on every table;
 * - a sum or mean of fewer than k numbers is null with its index in `fewCells`, as before (V-19): a
 *   column of text summed gives null as an empty column does.
 *
 * A table outside the unreadable paths is as before: not_number at the first data row's operation.
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
  // k (5) and k - 1 cells of v not numbers in the shown group, against the same cells empty.
  "shown-five-bad": [...repeat("A,bad,1", 5), ...repeat("A,2,1", 5)],
  "shown-five-empty": [...repeat("A,,1", 5), ...repeat("A,2,1", 5)],
  "shown-four-bad": [...repeat("A,bad,1", 4), ...repeat("A,2,1", 6)],
  "shown-four-empty": [...repeat("A,,1", 4), ...repeat("A,2,1", 6)],
  // A column of text and an empty column, in a shown group.
  "all-text": repeat("A,bad,1", 6),
  "all-empty": repeat("A,,1", 6),
  // Both columns with k cells not numbers; w's come first in the rows.
  "both-w-first": [...repeat("A,1,bad", 5), ...repeat("A,bad,1", 5)],
  "both-v-first": [...repeat("A,bad,1", 5), ...repeat("A,1,bad", 5)],
  // Groups of fewer than k rows full of such cells (12 in all), beside a clean shown group.
  "hidden-groups-bad": [...repeat("B,bad,bad", 4), ...repeat("C,bad,bad", 4), ...repeat("D,bad,bad", 4), ...repeat("A,2,1", 5)],
  "hidden-groups-none": [...repeat("A,2,1", 5)],
  // Codex V-28b's threshold-oracle a and b: A 4/1 or 3/2 numbers / not, B 2/3, the hidden C one row
  // whose cell is not a number (a) or is one (b); 11 rows, 6 numbers and 5 others in both.
  "oracle-a": [...repeat("A,10,1", 4), "A,bad,1", ...repeat("B,10,1", 2), ...repeat("B,bad,1", 3), "C,bad,1"],
  "oracle-b": [...repeat("A,10,1", 3), ...repeat("A,bad,1", 2), ...repeat("B,10,1", 2), ...repeat("B,bad,1", 3), "C,10,1"],
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
const text = (outcome: RawWorkflowToolOutcome): string => JSON.stringify(outcome);
interface Shown {
  readonly groups: readonly { readonly values: readonly (number | null)[]; readonly fewCells?: readonly number[] }[];
  readonly suppressedGroups: number;
}
const payloadOf = (outcome: RawWorkflowToolOutcome): Shown => {
  assert.ok(outcome.ok, text(outcome));
  return (outcome as unknown as { payload: Shown }).payload;
};

describe("U-277 (V-28 M1, V-28b): a cell that is not a number on an unreadable table", () => {
  test("Codex's error-order cases: two rows' order gives the same answer (a group of fewer than k rows: no error, nothing shown)", async () => {
    const one = await query("private/order-one.csv", SUMS);
    assert.equal(text(one), text(await query("private/order-two.csv", SUMS)));
    assert.deepEqual(payloadOf(one).groups, []);
  });

  test("Codex's one-cell-type cases: a number or not in a group of fewer than k rows gives the same answer", async () => {
    assert.equal(text(await query("private/type-number.csv", SUMS)), text(await query("private/type-text.csv", SUMS)));
  });

  test("Codex V-28b's threshold-oracle a and b: describe, the grouped count and the grouped sum and mean are the same, character for character", async () => {
    const calls = [{ describe: true }, { groupBy: ["g"], operations: [{ op: "count", column: "v" }] }, { groupBy: ["g"], operations: [{ op: "sum", column: "v" }, { op: "mean", column: "v" }] }];
    for (const call of calls) assert.equal(text(await query("private/oracle-a.csv", call)), text(await query("private/oracle-b.csv", call)), JSON.stringify(call));
    // A and B each hold fewer than k numbers: their sum and mean are null, as V-19 has it.
    const summed = payloadOf(await query("private/oracle-a.csv", calls[2] as Record<string, unknown>));
    assert.deepEqual(
      summed.groups.map((group) => [group.values, group.fewCells]),
      [
        [[null, null], [0, 1]],
        [[null, null], [0, 1]],
      ],
    );
    assert.equal(summed.suppressedGroups, 1);
  });

  test("fewer than k such cells in a shown group: each counts as an empty cell in a sum or mean, wherever it lies", async () => {
    const empty = text(await query("private/shown-one-empty.csv", SUMMED));
    assert.equal(text(await query("private/shown-one-bad.csv", SUMMED)), empty);
    assert.equal(text(await query("private/shown-four-bad.csv", SUMMED)), text(await query("private/shown-four-empty.csv", SUMMED)));
    // Wherever it lies, with a count too.
    assert.equal(text(await query("private/shown-one-bad-last.csv", GROUPED)), text(await query("private/shown-one-bad.csv", GROUPED)));
    // A count counts it as the non-empty cell it is; the sum and mean leave it out.
    assert.deepEqual(payloadOf(await query("private/shown-one-bad.csv", GROUPED)).groups.map((group) => group.values), [[6, 10, 2, 6]]);
    assert.deepEqual(payloadOf(await query("private/shown-one-empty.csv", GROUPED)).groups.map((group) => group.values), [[5, 10, 2, 6]]);
  });

  test("k or more such cells: no error either, each left out as an empty cell", async () => {
    assert.equal(text(await query("private/shown-five-bad.csv", SUMMED)), text(await query("private/shown-five-empty.csv", SUMMED)));
    assert.deepEqual(payloadOf(await query("private/shown-five-bad.csv", SUMMED)).groups.map((group) => group.values), [[10, 2, 10]]);
  });

  test("a column of text summed gives null in fewCells, as an empty column does", async () => {
    const textColumn = await query("private/all-text.csv", SUMMED);
    assert.equal(text(textColumn), text(await query("private/all-empty.csv", SUMMED)));
    assert.deepEqual(
      payloadOf(textColumn).groups.map((group) => [group.values, group.fewCells]),
      [[[null, null, 6], [0, 1]]],
    );
  });

  test("the rows' order decides nothing: two columns with k such cells each answer the same in either order", async () => {
    const wFirst = await query("private/both-w-first.csv", SUMS);
    assert.equal(text(wFirst), text(await query("private/both-v-first.csv", SUMS)));
    assert.deepEqual(payloadOf(wFirst).groups.map((group) => group.values), [[5, 5]]);
  });

  test("such cells in groups of fewer than k rows change nothing shown", async () => {
    const shownBad = payloadOf(await query("private/hidden-groups-bad.csv", GROUPED));
    assert.deepEqual(shownBad.groups, payloadOf(await query("private/hidden-groups-none.csv", GROUPED)).groups);
    assert.equal(shownBad.suppressedGroups, 3);
  });

  test("no query of any of these tables is refused under unreadablePaths", async () => {
    for (const name of Object.keys(TABLES)) {
      for (const args of [SUMS, GROUPED, SUMMED]) {
        const outcome = await query(`private/${name}.csv`, args);
        assert.ok(outcome.ok, `${name} ${JSON.stringify(args)}: ${text(outcome)}`);
      }
    }
  });

  test("a table outside the unreadable paths is as before: the first data row's operation, by its row", async () => {
    const outcome = await query("data/both-w-first.csv", SUMS);
    assert.equal((outcome as { message: string }).message, `table rejected: not_number at data row 1, operations[1]. ${QUERY_TABLE_PROBLEM_HINTS.not_number}`);
    const one = await query("data/order-one.csv", SUMS);
    assert.equal((one as { message: string }).message, `table rejected: not_number at data row 1, operations[0]. ${QUERY_TABLE_PROBLEM_HINTS.not_number}`);
    const oracle = await query("data/oracle-b.csv", SUMMED);
    assert.equal((oracle as { message: string }).message, `table rejected: not_number at data row 4, operations[0]. ${QUERY_TABLE_PROBLEM_HINTS.not_number}`);
  });
});
