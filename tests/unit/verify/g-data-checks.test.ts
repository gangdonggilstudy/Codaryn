/**
 * GT-U10: the `data_checks` verifier (VF-04) on real files in a temporary workspace.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import type { DataChecksVerifierConfig, DataRule, RawVerifierResult, Workspace } from "../../../src/contracts/index.js";
import { createVerifierRunner } from "../../../src/verify/index.js";
import type { CommandRunner } from "../../../src/verify/index.js";
import { DATA_CHECKS_LIMITS, runDataChecksVerifier } from "../../../src/verify/data-checks.js";
import { createWorkspace } from "../../../src/workspace/index.js";

let root = "";
let workspace: Workspace;

/** Cell text that must never reach evidence: only column names, row numbers and compared numbers may. */
const MARK = "CELLMARK";

const SALES = [
  "region,amount,note",
  `north,10.5,${MARK}-a`,
  `south,4,${MARK}-b`,
  `north,2.25,${MARK}-c`,
  `,100,${MARK}-d`,
  `east,,${MARK}-e`,
  `east,1,${MARK}-f`,
].join("\n");

before(async () => {
  root = await mkdtemp(join(tmpdir(), "codaryn-gd-data-"));
  await mkdir(join(root, "data"));
  await mkdir(join(root, "out"));
  await mkdir(join(root, ".codaryn"));
  const files: Record<string, string> = {
    "data/sales.csv": `${SALES}\n`,
    "data/sales.tsv": `${SALES.replace(/,/g, "\t")}\n`,
    "data/sales.jsonl":
      [
        { region: "north", amount: 10.5 },
        { region: "south", amount: 4 },
        { region: "north", amount: 2.25 },
        { amount: 100 },
        { region: "east", amount: null },
        { region: "east", amount: 1 },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
    "data/bad-number.csv": `region,amount\nnorth,1\nsouth,${MARK}-seven\n`,
    "data/broken.csv": `region,amount\nnorth,"1\n`,
    "out/total.csv": "total\n117.75\n",
    "out/total-wrong.csv": "total\n117.7\n",
    "out/total-two-rows.csv": "total\n117.75\n1\n",
    "out/total-text.csv": `total\n${MARK}-total\n`,
    "out/by-region.csv": `region,sum,comment\nnorth,12.75,${MARK}-x\nsouth,4,${MARK}-y\neast,1,${MARK}-z\n`,
    "out/by-region-wrong.csv": `region,sum\nnorth,12.75\nsouth,5\neast,1\n`,
    "out/by-region-missing.csv": "region,sum\nnorth,12.75\neast,1\n",
    "out/by-region-duplicate.csv": "region,sum\nnorth,12.75\nsouth,4\nsouth,4\neast,1\n",
    "out/by-region-extra.csv": `region,sum\nnorth,12.75\nsouth,4\neast,1\n${MARK}-west,9\n`,
    "out/by-region-empty-key.csv": "region,sum\nnorth,12.75\nsouth,4\neast,1\n,0\n",
    "out/broken.csv": 'total\n"117.75\n',
    "out/latin1.csv": "",
    ".codaryn/hidden.csv": "total\n1\n",
  };
  for (const [name, text] of Object.entries(files)) await writeFile(join(root, name), text, "utf8");
  await writeFile(join(root, "out/latin1.csv"), Buffer.from([0x74, 0x0a, 0xe9, 0x0a]));
  workspace = await createWorkspace({ root });
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

const csv = (path: string) => ({ path, format: "csv" as const });

function config(...rules: DataRule[]): DataChecksVerifierConfig {
  return { id: "data", kind: "data_checks", rules };
}

async function run(rules: DataRule[], maxTableBytes?: number): Promise<RawVerifierResult> {
  return runDataChecksVerifier(config(...rules), workspace, new AbortController().signal, maxTableBytes === undefined ? {} : { maxTableBytes });
}

function noCellText(result: RawVerifierResult): void {
  assert.equal(result.evidence.includes(MARK), false, `evidence leaks a cell: ${result.evidence}`);
}

const total = (target: string, extra: Partial<Extract<DataRule, { type: "aggregate_match" }>> = {}): DataRule => ({
  type: "aggregate_match",
  source: csv("data/sales.csv"),
  column: "amount",
  op: "sum",
  target: csv(target),
  targetColumn: "total",
  ...extra,
});

const byRegion = (target: string, extra: Partial<Extract<DataRule, { type: "aggregate_match" }>> = {}): DataRule => ({
  type: "aggregate_match",
  source: csv("data/sales.csv"),
  column: "amount",
  op: "sum",
  groupBy: "region",
  target: csv(target),
  targetColumn: "sum",
  targetKeyColumn: "region",
  ...extra,
});

test("table_shape: columns (exact, includes) and data rows (equals, range, sameAs)", async () => {
  const pass = await run([
    { type: "table_shape", table: csv("out/by-region.csv"), columns: ["region", "sum", "comment"], rows: { equals: 3 } },
    { type: "table_shape", table: csv("out/by-region.csv"), columns: ["sum"], columnsMatch: "includes", rows: { min: 1, max: 3 } },
    { type: "table_shape", table: { path: "data/sales.tsv", format: "tsv" }, rows: { sameAs: { path: "data/sales.jsonl", format: "jsonl" } } },
  ]);
  assert.equal(pass.outcome, "pass", pass.evidence);
  assert.equal(pass.kind, "data_checks");
  assert.equal(pass.checked.length, 3);
  assert.deepEqual(pass.limits, DATA_CHECKS_LIMITS);

  const failing = await run([
    { type: "table_shape", table: csv("out/by-region.csv"), columns: ["region", "sum"] },
    { type: "table_shape", table: csv("out/by-region.csv"), columns: ["total"], columnsMatch: "includes" },
    { type: "table_shape", table: csv("out/by-region.csv"), rows: { equals: 4 } },
    { type: "table_shape", table: csv("out/by-region.csv"), rows: { min: 4 } },
    { type: "table_shape", table: csv("out/total.csv"), rows: { sameAs: csv("data/sales.csv") } },
  ]);
  assert.equal(failing.outcome, "fail");
  const lines = failing.evidence.split("\n");
  assert.equal(lines.length, 5);
  assert.ok(lines.every((line) => line.startsWith("not held:")), failing.evidence);
  assert.match(lines[0] as string, /expected exactly \["region", "sum"\]/);
  assert.match(lines[1] as string, /missing columns \["total"\]/);
  assert.match(lines[2] as string, /3 data rows, expected 4/);
  assert.match(lines[4] as string, /1 data rows, expected 6/);
  noCellText(failing);
});

test("aggregate_match without groups: agreement, disagreement, tolerance, one target row", async () => {
  const pass = await run([total("out/total.csv")]);
  assert.equal(pass.outcome, "pass", pass.evidence);
  assert.match(pass.evidence, /recomputed 117\.75 from 5 cells/);

  const wrong = await run([total("out/total-wrong.csv")]);
  assert.equal(wrong.outcome, "fail");
  assert.match(wrong.evidence, /target data row 1: recomputed 117\.75, found 117\.7/);

  assert.equal((await run([total("out/total-wrong.csv", { tolerance: { absolute: 0.05 } })])).outcome, "pass");
  assert.equal((await run([total("out/total-wrong.csv", { tolerance: { absolute: 0, relative: 1e-3 } })])).outcome, "pass");
  assert.equal((await run([total("out/total-wrong.csv", { tolerance: { absolute: 0.01, relative: 0 } })])).outcome, "fail");

  const twoRows = await run([total("out/total-two-rows.csv")]);
  assert.equal(twoRows.outcome, "fail");
  assert.match(twoRows.evidence, /target has 2 data rows; expected exactly 1/);

  const text = await run([total("out/total-text.csv")]);
  assert.equal(text.outcome, "fail");
  assert.match(text.evidence, /target data row 1 of column "total" is not a number/);
  noCellText(text);

  for (const [op, value] of [["count", "5"], ["min", "1"], ["max", "100"], ["mean", "23.55"]] as const) {
    await writeFile(join(root, "out/op.csv"), `total\n${value}\n`, "utf8");
    const result = await run([total("out/op.csv", { op })]);
    assert.equal(result.outcome, "pass", `${op}: ${result.evidence}`);
  }
});

test("aggregate_match by group: one target row per group and no other row", async () => {
  const pass = await run([byRegion("out/by-region.csv")]);
  assert.equal(pass.outcome, "pass", pass.evidence);
  assert.match(pass.evidence, /3 groups agree; 1 source rows without a group value left out/);
  noCellText(pass);

  const cases: [string, RegExp][] = [
    ["out/by-region-wrong.csv", /target data row 2 \(group first seen at source data row 2\): recomputed 4, found 5/],
    ["out/by-region-missing.csv", /no target row for the group first seen at source data row 2/],
    ["out/by-region-duplicate.csv", /target data rows 2, 3 have the same key/],
    ["out/by-region-extra.csv", /target data row 4 has a key that no source row has/],
    ["out/by-region-empty-key.csv", /target data row 4 has an empty key/],
  ];
  for (const [target, pattern] of cases) {
    const result = await run([byRegion(target)]);
    assert.equal(result.outcome, "fail", target);
    assert.match(result.evidence, pattern, target);
    noCellText(result);
  }
});

test("the same checks read TSV and JSON Lines sources", async () => {
  const tsv = await run([byRegion("out/by-region.csv", { source: { path: "data/sales.tsv", format: "tsv" } })]);
  assert.equal(tsv.outcome, "pass", tsv.evidence);
  const jsonl = await run([total("out/total.csv", { source: { path: "data/sales.jsonl", format: "jsonl" } })]);
  assert.equal(jsonl.outcome, "pass", jsonl.evidence);
});

test("a source the model cannot fix is inconclusive; a target it wrote is fail", async () => {
  const sourceCases: [Partial<Extract<DataRule, { type: "aggregate_match" }>>, RegExp][] = [
    [{ source: csv("data/missing.csv") }, /source "data\/missing\.csv" \(csv\): file not found/],
    [{ source: csv("data/broken.csv") }, /source "data\/broken\.csv" \(csv\): does not parse as csv: unterminated quote at data row 1/],
    [{ source: csv("data/bad-number.csv") }, /source data row 2 of column "amount" is not a number/],
    [{ column: "price" }, /source column "price" is missing/],
  ];
  for (const [extra, pattern] of sourceCases) {
    const result = await run([total("out/total.csv", extra)]);
    assert.equal(result.outcome, "inconclusive", JSON.stringify(extra));
    assert.match(result.evidence, pattern);
    noCellText(result);
  }

  const targetCases: [string, RegExp][] = [
    ["out/none.csv", /target "out\/none\.csv" \(csv\): file not found/],
    ["out/broken.csv", /does not parse as csv: unterminated quote at data row 1/],
    ["out/latin1.csv", /not UTF-8 text/],
  ];
  for (const [target, pattern] of targetCases) {
    const result = await run([total(target)]);
    assert.equal(result.outcome, "fail", target);
    assert.match(result.evidence, pattern);
  }
  const noColumn = await run([total("out/total.csv", { targetColumn: "sum" })]);
  assert.equal(noColumn.outcome, "fail");
  assert.match(noColumn.evidence, /target column "sum" is missing/);
});

test("the size limit: a larger source is inconclusive, a larger target fail", async () => {
  const small = 60;
  const source = await run([total("out/total.csv")], small);
  assert.equal(source.outcome, "inconclusive");
  assert.match(source.evidence, /source "data\/sales\.csv" \(csv\): larger than 60 bytes/);
  const target = await run([{ type: "table_shape", table: csv("data/sales.csv") }], small);
  assert.equal(target.outcome, "fail");
  assert.match(target.evidence, /larger than 60 bytes/);
});

test("paths the workspace refuses, invalid rules and a cancel are undecided", async () => {
  const outside = await run([{ type: "table_shape", table: csv("../outside.csv") }]);
  assert.equal(outside.outcome, "inconclusive");
  assert.match(outside.evidence, /path rejected \(outside_root\)/);
  const state = await run([{ type: "table_shape", table: csv(".codaryn/hidden.csv") }]);
  assert.equal(state.outcome, "inconclusive");
  assert.match(state.evidence, /path rejected \(state_dir\)/);

  const invalid: DataRule[] = [
    { type: "aggregate_match", source: csv("data/sales.csv"), column: "amount", op: "sum", groupBy: "region", target: csv("out/total.csv"), targetColumn: "total" },
    total("out/total.csv", { tolerance: { absolute: -1 } }),
    total("out/total.csv", { op: "median" as never }),
    { type: "table_shape", table: { path: "data/sales.csv", format: "xlsx" as never } },
    { type: "table_shape", table: csv("data/sales.csv"), rows: { equals: 1, min: 0 } as never },
  ];
  for (const rule of invalid) {
    const result = await run([rule]);
    assert.equal(result.outcome, "inconclusive", JSON.stringify(rule));
    assert.match(result.evidence, /the rule is not valid/);
  }

  const controller = new AbortController();
  controller.abort();
  const cancelled = await runDataChecksVerifier(config(total("out/total.csv")), workspace, controller.signal);
  assert.equal(cancelled.outcome, "inconclusive");
  assert.match(cancelled.evidence, /cancelled before this rule was checked/);
  assert.equal((await runDataChecksVerifier(config(), workspace, new AbortController().signal)).outcome, "inconclusive");
});

test("fail outweighs undecided across rules, as file_rules does", async () => {
  const result = await run([total("out/total-wrong.csv"), total("out/total.csv", { source: csv("data/missing.csv") }), total("out/total.csv")]);
  assert.equal(result.outcome, "fail");
  assert.deepEqual(
    result.evidence.split("\n").map((line) => line.split(":")[0]),
    ["not held", "undecided", "held"],
  );
});

test("the verifier runner dispatches data_checks; the other kinds keep their runner", async () => {
  const commandRunner: CommandRunner = {
    async run() {
      throw new Error("no command is run by a data check");
    },
  };
  const runner = createVerifierRunner({ workspace, commandRunner });
  const result = await runner.run(config(total("out/total.csv")), new AbortController().signal);
  assert.equal(result.kind, "data_checks");
  assert.equal(result.outcome, "pass", result.evidence);
  const rules = await runner.run({ id: "f", kind: "file_rules", rules: [{ type: "exists", path: "out/total.csv" }] }, new AbortController().signal);
  assert.equal(rules.kind, "file_rules");
  assert.equal(rules.outcome, "pass");
});
