/**
 * U-208 (Codex V-19, high; DR-70): on a table under the unreadable paths a value is given only when at
 * least k cells went into it, not only k rows into its group. Codex's six cases (CSV, TSV and JSON
 * Lines, k 5 and 10): a group of k rows whose column holds one number and k - 1 empty cells gave that
 * number as its sum and mean; now the sum, the mean and the count of 1 are null with their indexes in
 * fewCells, and the number is nowhere in the result. Also: exactly k cells show, k - 1 do not; the
 * whole table without groupBy; describe's counts below k; a table outside the unreadable paths as
 * before (k 1, count 0 stays 0).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import type { QueryGroup, QueryTablePayload, RawWorkflowToolOutcome, Workspace } from "../../../src/contracts/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { createFakePrivacy } from "./doubles.js";

const never = new AbortController().signal;
const LONE = "887766.125";
let base: string;
let workspace: Workspace;

/** One group A of `rows` rows: `numbers` of them hold a number in v, the others leave v empty. */
function sparse(format: "csv" | "tsv" | "jsonl", rows: number, numbers: readonly string[]): string {
  const cells = Array.from({ length: rows }, (_, index) => ({ g: "A", id: `synthetic${index + 1}`, v: numbers[index] ?? "" }));
  if (format === "jsonl") return cells.map((row) => JSON.stringify(row.v === "" ? { g: row.g, id: row.id } : { ...row, v: Number(row.v) })).join("\n") + "\n";
  const separator = format === "csv" ? "," : "\t";
  return [["g", "id", "v"].join(separator), ...cells.map((row) => [row.g, row.id, row.v].join(separator))].join("\n") + "\n";
}

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-v19-"));
  const root = path.join(base, "root");
  fs.mkdirSync(path.join(root, "private"), { recursive: true });
  fs.mkdirSync(path.join(root, "data"));
  for (const format of ["csv", "tsv", "jsonl"] as const) {
    for (const k of [5, 10]) fs.writeFileSync(path.join(root, "private", `sparse${k}.${format}`), sparse(format, k, [LONE]));
  }
  fs.writeFileSync(path.join(root, "private", "five.csv"), sparse("csv", 6, ["1.5", "2.5", "3.5", "4.5", "5.5"]));
  fs.writeFileSync(path.join(root, "private", "four.csv"), sparse("csv", 6, ["1.5", "2.5", "3.5", "4.5"]));
  fs.writeFileSync(path.join(root, "data", "sparse.csv"), sparse("csv", 5, [LONE]));
  workspace = await createWorkspace({ root });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

async function query(args: Record<string, unknown>, unreadablePaths: readonly string[] | undefined, minGroupSize = 5): Promise<RawWorkflowToolOutcome> {
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy(), minGroupSize, ...(unreadablePaths === undefined ? {} : { unreadablePaths }) });
  assert.ok(tools.executeWorkflowTool !== undefined);
  return tools.executeWorkflowTool({ id: "c1", name: "query_table", args } as never, never);
}
function payloadOf(outcome: RawWorkflowToolOutcome): QueryTablePayload {
  assert.ok(outcome.ok, JSON.stringify(outcome));
  return (outcome as { payload: QueryTablePayload }).payload;
}
const groupsOf = (outcome: RawWorkflowToolOutcome): readonly QueryGroup[] => {
  const payload = payloadOf(outcome);
  assert.equal(payload.kind, "groups");
  return payload.kind === "groups" ? payload.groups : [];
};

const OPS = [
  { op: "count", column: "v" },
  { op: "sum", column: "v" },
  { op: "mean", column: "v" },
];

describe("U-208 (V-19): a value of fewer than k cells is not given", () => {
  for (const format of ["csv", "tsv", "jsonl"] as const) {
    for (const k of [5, 10]) {
      test(`Codex's case: ${format}, k ${k}, one number among ${k} rows`, async () => {
        const outcome = await query({ path: `private/sparse${k}.${format}`, groupBy: ["g"], operations: OPS }, ["private"], k);
        assert.deepEqual(groupsOf(outcome), [{ keys: ["A"], rows: k, values: [null, null, null], fewCells: [0, 1, 2] }]);
        assert.equal(JSON.stringify(outcome).includes(LONE), false);
      });
    }
  }

  test("exactly k cells give their values; k - 1 do not, in a group of more than k rows", async () => {
    assert.deepEqual(groupsOf(await query({ path: "private/five.csv", groupBy: ["g"], operations: OPS }, ["private"])), [{ keys: ["A"], rows: 6, values: [5, 17.5, 3.5] }]);
    assert.deepEqual(groupsOf(await query({ path: "private/four.csv", groupBy: ["g"], operations: OPS }, ["private"])), [
      { keys: ["A"], rows: 6, values: [null, null, null], fewCells: [0, 1, 2] },
    ]);
  });

  test("the whole table without groupBy, and a count of another column beside", async () => {
    const outcome = await query({ path: "private/four.csv", operations: [{ op: "count", column: "id" }, { op: "sum", column: "v" }] }, ["private"]);
    assert.deepEqual(groupsOf(outcome), [{ keys: [], rows: 6, values: [6, null], fewCells: [1] }]);
  });

  test("describe hides each count below k", async () => {
    const payload = payloadOf(await query({ path: "private/sparse5.csv", describe: true }, ["private"]));
    assert.deepEqual(payload, {
      kind: "describe",
      columns: [
        { name: "g", nonEmpty: 5, numeric: null },
        { name: "id", nonEmpty: 5, numeric: null },
        { name: "v", nonEmpty: null, numeric: null },
      ],
      rows: 5,
      minGroupSize: 5,
    });
  });

  test("a table outside the unreadable paths is as before: k 1, every value", async () => {
    const outcome = await query({ path: "data/sparse.csv", groupBy: ["g"], operations: OPS }, ["private"]);
    assert.deepEqual(groupsOf(outcome), [{ keys: ["A"], rows: 5, values: [1, Number(LONE), Number(LONE)] }]);
    const shape = payloadOf(await query({ path: "data/sparse.csv", describe: true }, ["private"]));
    assert.deepEqual(shape.kind === "describe" ? shape.columns[0] : null, { name: "g", nonEmpty: 5, numeric: 0 });
  });
});
