import assert from "node:assert/strict";
import { test } from "node:test";

import { aggregate, columnCells, groupCells, parseNumber, parseTable, withinTolerance } from "../../../src/tabular/index.js";
import type { CellAt, Table } from "../../../src/tabular/index.js";

const cells = (...values: string[]): CellAt[] => values.map((cell, index) => ({ cell, dataRow: index + 1 }));

test("parseNumber accepts only -?digits[.digits][e±digits] that is finite", () => {
  for (const [text, value] of [
    ["0", 0],
    ["-0", -0],
    ["12", 12],
    ["-1.5", -1.5],
    ["007", 7],
    ["1e3", 1000],
    ["1E-3", 0.001],
    ["2.5e+2", 250],
  ] as const) {
    assert.equal(parseNumber(text), value, text);
  }
  for (const text of ["", " 1", "1 ", "+1", ".5", "5.", "1,000", "1,5", "1e", "e3", "0x10", "Infinity", "NaN", "1e999", "-", "1.2.3", "١٢"]) {
    assert.equal(parseNumber(text), null, JSON.stringify(text));
  }
});

test("count counts non-empty cells, numbers or not; the other ops skip empty cells", () => {
  const values = cells("3", "", "x", "4");
  assert.deepEqual(aggregate(values, "count"), { ok: true, value: 3, values: 3 });
  assert.deepEqual(aggregate(cells("3", "", "4"), "sum"), { ok: true, value: 7, values: 2 });
  assert.deepEqual(aggregate(cells("3", "", "4"), "mean"), { ok: true, value: 3.5, values: 2 });
  assert.deepEqual(aggregate(cells("3", "-8", "4"), "min"), { ok: true, value: -8, values: 3 });
  assert.deepEqual(aggregate(cells("3", "-8", "4"), "max"), { ok: true, value: 4, values: 3 });
  assert.deepEqual(aggregate(cells("", ""), "count"), { ok: true, value: 0, values: 0 });
});

test("a non-number names its first data row; no number at all is no_values", () => {
  assert.deepEqual(aggregate(cells("1", "", "n/a", "x"), "sum"), { ok: false, problem: "not_a_number", dataRow: 3 });
  for (const op of ["sum", "mean", "min", "max"] as const) {
    assert.deepEqual(aggregate(cells("", ""), op), { ok: false, problem: "no_values" }, op);
  }
});

test("sums are compensated: decimals and cancelling magnitudes keep their value", () => {
  const tenths = cells(...Array.from({ length: 10 }, () => "0.1"));
  const sum = aggregate(tenths, "sum");
  assert.equal(sum.ok && sum.value, 1);
  assert.equal(
    [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1].reduce((a, b) => a + b),
    0.9999999999999999,
    "the naive sum this guards against",
  );
  const cancelling = aggregate(cells("1e16", "1", "-1e16"), "sum");
  assert.equal(cancelling.ok && cancelling.value, 1);
  const mean = aggregate(cells("0.1", "0.2", "0.3"), "mean");
  assert.equal(mean.ok, true);
  assert.ok(mean.ok && Math.abs(mean.value - 0.2) < 1e-15);
});

test("groupCells keeps first appearance order and leaves out rows without a group value", () => {
  const parsed = (parseTable("region,amount\nnorth,1\nsouth,2\n,5\nnorth,3\n", "csv") as { table: Table }).table;
  const grouping = groupCells(parsed, 1, 0);
  assert.deepEqual(grouping.withoutKey, 1);
  assert.deepEqual(
    grouping.groups.map((group) => [group.key, group.firstDataRow, group.cells.map((item) => [item.cell, item.dataRow])]),
    [
      ["north", 1, [["1", 1], ["3", 4]]],
      ["south", 2, [["2", 2]]],
    ],
  );
  assert.deepEqual(columnCells(parsed, 1).map((item) => item.dataRow), [1, 2, 3, 4]);
});

test("withinTolerance: |a - b| <= max(absolute, relative * max(|a|, |b|))", () => {
  assert.equal(withinTolerance(100, 100.5, { absolute: 0.5, relative: 0 }), true);
  assert.equal(withinTolerance(100, 100.51, { absolute: 0.5, relative: 0 }), false);
  assert.equal(withinTolerance(1000, 1010, { absolute: 0, relative: 0.01 }), true);
  assert.equal(withinTolerance(1000, 1011, { absolute: 0, relative: 0.01 }), false);
  assert.equal(withinTolerance(0.1 + 0.2, 0.3, { absolute: 1e-9, relative: 1e-9 }), true);
  assert.equal(withinTolerance(-5, 5, { absolute: 9, relative: 0 }), false);
  assert.equal(withinTolerance(0, 0, { absolute: 0, relative: 0 }), true);
});
