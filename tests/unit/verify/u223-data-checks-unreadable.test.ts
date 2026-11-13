/**
 * U-223 (bundle A, A-7, proposal R-6): a data_checks source under the run's unreadable paths gives
 * no number read from it in the evidence (not the recomputed value, nor its cell, row or left-out
 * counts); the evidence names the target row and column and says why, and the verdict is the same.
 * Without unreadable paths, with an empty list, or with a list that does not cover the source, the
 * result is the one of before, letter for letter (the frozen copy of U-202). The paths are judged as
 * the policy gate judges them: through a link into them too, and a value that is not a usable list
 * covers everything.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import type { DataChecksVerifierConfig, DataRule, RawVerifierResult, TableRef, Workspace } from "../../../src/contracts/index.js";
import { UNREADABLE_SOURCE_NOTE, UNREADABLE_TARGET_NOTE, runDataChecksVerifier } from "../../../src/verify/data-checks.js";
import type { DataChecksOptions } from "../../../src/verify/data-checks.js";
import { createVerifierRunner } from "../../../src/verify/index.js";
import type { CommandRunner } from "../../../src/verify/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { runDataChecksVerifier as runDataChecksVerifierV1 } from "./reference/data-checks-v1.js";

let root = "";
let workspace: Workspace;

// Amounts whose sums, means and counts are unlike any row number or other text of the evidence.
const SALES = ["region,amount", "north,1234.5678", "south,4321.8765", "north,1111.1111", ",999.0909", "east,777.7777", "east,", "west,0.0123"].join("\n");

before(async () => {
  root = await mkdtemp(join(tmpdir(), "codaryn-u223-"));
  for (const dir of ["data", "other", "out", "secret-out"]) await mkdir(join(root, dir));
  const files: Record<string, string> = {
    "data/sales.csv": `${SALES}\n`,
    "other/sales.csv": `${SALES}\n`,
    "out/total-wrong.csv": "total\n1\n",
    // The amounts' sum: 1234.5678 + 4321.8765 + 1111.1111 + 999.0909 + 777.7777 + 0.0123.
    "out/total-right.csv": "total\n8444.4363\n",
    "out/by-region-wrong.csv": "region,sum\nnorth,1\nsouth,4321.8765\neast,2\nwest,0.0123\n",
    "out/by-region-missing.csv": "region,sum\nnorth,2345.6789\nsouth,4321.8765\n",
    "out/rows-six.csv": "k\n1\n2\n3\n4\n5\n6\n",
    "out/rows-seven.csv": "k\n1\n2\n3\n4\n5\n6\n7\n",
    // Targets under unreadable paths (U-223, PM): their cells and counts must not reach the evidence.
    "secret-out/total-wrong.csv": "total\n9876.5432\n",
    "secret-out/total-right.csv": "total\n8444.4363\n",
    "secret-out/total-two.csv": "total\n8444.4363\n5555.5555\n",
    "secret-out/by-region-wrong.csv": "region,sum\nnorth,3333.3333\nsouth,4321.8765\neast,6666.6666\nwest,0.0123\n",
    "secret-out/by-region-right.csv": "region,sum\nnorth,2345.6789\nsouth,4321.8765\neast,777.7777\nwest,0.0123\n",
    "secret-out/rows-six.csv": "k\n1\n2\n3\n4\n5\n6\n",
    "secret-out/rows-seven.csv": "k\n1\n2\n3\n4\n5\n6\n7\n",
  };
  for (const [name, text] of Object.entries(files)) await writeFile(join(root, name), text, "utf8");
  // A link into the unreadable folder (a junction on Windows: no rights needed).
  await symlink(join(root, "data"), join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  workspace = await createWorkspace({ root });
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

const csv = (path: string): TableRef => ({ path, format: "csv" });
const config = (rules: readonly DataRule[]): DataChecksVerifierConfig => ({ id: "data", kind: "data_checks", rules: [...rules] });
const run = (rules: readonly DataRule[], options: DataChecksOptions = {}): Promise<RawVerifierResult> =>
  runDataChecksVerifier(config(rules), workspace, new AbortController().signal, options);

function rulesOn(source: string): DataRule[] {
  const total = (op: "sum" | "count" | "mean" | "min" | "max", target: string): DataRule => ({
    type: "aggregate_match",
    source: csv(source),
    column: "amount",
    op,
    target: csv(target),
    targetColumn: "total",
  });
  const byRegion = (target: string, op: "sum" | "mean" = "sum"): DataRule => ({
    type: "aggregate_match",
    source: csv(source),
    column: "amount",
    op,
    groupBy: "region",
    target: csv(target),
    targetColumn: "sum",
    targetKeyColumn: "region",
  });
  return [
    total("sum", "out/total-wrong.csv"),
    total("count", "out/total-wrong.csv"),
    total("mean", "out/total-wrong.csv"),
    total("max", "out/total-wrong.csv"),
    byRegion("out/by-region-wrong.csv"),
    byRegion("out/by-region-missing.csv"),
    byRegion("out/by-region-wrong.csv", "mean"),
    { type: "table_shape", table: csv("out/rows-six.csv"), rows: { sameAs: csv(source) } },
    { type: "table_shape", table: csv("out/rows-seven.csv"), rows: { sameAs: csv(source) } },
    total("sum", "out/total-right.csv"),
  ];
}

/** The verdict words of each evidence line ("held", "not held", "undecided"). */
const verdicts = (result: RawVerifierResult): string[] => result.evidence.split("\n").map((line) => line.slice(0, line.indexOf(":")));

/**
 * The numbers the evidence of before took from the source: recomputed values with a decimal point
 * (whole ones such as a count can equal a row number; the word "recomputed" is checked apart), and
 * the cell, left-out and expected row counts with their words.
 */
function sourceNumbers(result: RawVerifierResult): string[] {
  const found = [
    ...[...result.evidence.matchAll(/recomputed (-?[0-9]+\.[0-9]+(?:e[+-]?[0-9]+)?)/g)].map((m) => m[1] as string),
    ...[...result.evidence.matchAll(/from ([0-9]+) cells/g)].map((m) => `from ${m[1] as string} cells`),
    ...[...result.evidence.matchAll(/([0-9]+) source rows without a group value/g)].map((m) => `${m[1] as string} source rows`),
    ...[...result.evidence.matchAll(/expected ([0-9]+) as/g)].map((m) => `expected ${m[1] as string} as`),
  ];
  return [...new Set(found)];
}

test("U-223: without unreadable paths, with an empty list or one that does not cover the source, the result is the one of before", async () => {
  const signal = new AbortController().signal;
  for (const source of ["data/sales.csv", "linked/sales.csv"]) {
    const rules = rulesOn(source);
    const before = await runDataChecksVerifierV1(config(rules), workspace, signal);
    // ("out" would cover the targets: since U-223's PM decision their numbers are hidden too.)
    for (const options of [{}, { unreadablePaths: [] }, { unreadablePaths: ["other"] }, { unreadablePaths: ["secret-out"] }] as DataChecksOptions[]) {
      assert.deepEqual(await run(rules, options), before, `${source} ${JSON.stringify(options)}`);
    }
  }
});

test("U-223: a source under unreadable paths keeps every verdict and gives no number read from it", async () => {
  for (const [source, unreadablePaths] of [
    ["data/sales.csv", ["data"]],
    ["data/sales.csv", ["data/sales.csv"]],
    ["data/sales.csv", ["."]],
    // A link whose real path is under the list: judged on the real path, as the gate does.
    ["linked/sales.csv", ["data"]],
    // An entry that is a link covers its real path too (coversEffective), as at the gate.
    ["data/sales.csv", ["linked"]],
  ] as const) {
    const rules = rulesOn(source);
    const plain = await run(rules);
    const hidden = await run(rules, { unreadablePaths });
    const label = `${source} under ${JSON.stringify(unreadablePaths)}`;
    assert.deepEqual(verdicts(hidden), verdicts(plain), label);
    assert.equal(hidden.outcome, plain.outcome, label);
    assert.deepEqual(hidden.checked, plain.checked, label);
    assert.deepEqual(hidden.limits, plain.limits, label);
    const numbers = sourceNumbers(plain);
    assert.ok(numbers.length >= 6, `${label}: the plain evidence shows the source's numbers (${numbers.join(", ")})`);
    for (const number of numbers) assert.equal(hidden.evidence.includes(number), false, `${label}: ${number} is in ${hidden.evidence}`);
    assert.equal(/recomputed|found -?[0-9]/.test(hidden.evidence), false, label);
    // With "." the targets are under the list too: their note follows the source's.
    const end = unreadablePaths[0] === "." ? `${UNREADABLE_SOURCE_NOTE}; ${UNREADABLE_TARGET_NOTE})` : `${UNREADABLE_SOURCE_NOTE})`;
    for (const line of hidden.evidence.split("\n")) assert.ok(line.endsWith(end), `${label}: ${line}`);
  }
});

test("U-223: the hidden evidence names the target row and column that did not match", async () => {
  const result = await run(rulesOn("data/sales.csv"), { unreadablePaths: ["data"] });
  const lines = result.evidence.split("\n");
  assert.equal(
    lines[0],
    `not held: sum of "amount" in "data/sales.csv" (csv) matches "total" in "out/total-wrong.csv" (csv) within absolute 1e-9, relative 1e-9 (target data row 1 of column "total" does not match; ${UNREADABLE_SOURCE_NOTE})`,
  );
  assert.equal(
    lines[4],
    `not held: sum of "amount" in "data/sales.csv" (csv) grouped by "region" matches "sum" in "out/by-region-wrong.csv" (csv) (key column "region") within absolute 1e-9, relative 1e-9 (target data row 1 of column "sum" does not match (group first seen at source data row 1); target data row 3 of column "sum" does not match (group first seen at source data row 5); source rows without a group value left out; ${UNREADABLE_SOURCE_NOTE})`,
  );
  // The source has 7 data rows; that number is not written when the target has another count.
  assert.equal(
    lines[7],
    `not held: table "out/rows-six.csv" (csv) has as many data rows as "data/sales.csv" (csv) (6 data rows, not as many as "data/sales.csv" (csv); ${UNREADABLE_SOURCE_NOTE})`,
  );
  // A count the target itself has is the model's own: "7 data rows, as …" stays.
  assert.equal(lines[8], `held: table "out/rows-seven.csv" (csv) has as many data rows as "data/sales.csv" (csv) (7 data rows, as "data/sales.csv" (csv); ${UNREADABLE_SOURCE_NOTE})`);
  // Held without the recomputed value or the cell count.
  assert.equal(
    lines[9],
    `held: sum of "amount" in "data/sales.csv" (csv) matches "total" in "out/total-right.csv" (csv) within absolute 1e-9, relative 1e-9 (target data row 1 agrees; ${UNREADABLE_SOURCE_NOTE})`,
  );
});

test("U-223: a value that is not a usable list covers everything, as at the gate", async () => {
  const rules = rulesOn("other/sales.csv");
  const plain = await run(rules);
  for (const value of ["data", [""], ["../outside"], [5]] as unknown[]) {
    const hidden = await run(rules, { unreadablePaths: value as readonly string[] });
    assert.deepEqual(verdicts(hidden), verdicts(plain), JSON.stringify(value));
    assert.equal(hidden.evidence.includes("recomputed"), false, JSON.stringify(value));
    assert.ok(hidden.evidence.includes(UNREADABLE_SOURCE_NOTE), JSON.stringify(value));
  }
});

test("U-223: the verifier runner passes the run's unreadable paths to data_checks", async () => {
  const commandRunner: CommandRunner = {
    run: async () => {
      throw new Error("no command here");
    },
  };
  const rules = rulesOn("data/sales.csv");
  const signal = new AbortController().signal;
  const withList = await createVerifierRunner({ workspace, commandRunner, unreadablePaths: ["data"] }).run(config(rules), signal);
  assert.deepEqual(withList, await run(rules, { unreadablePaths: ["data"] }));
  const without = await createVerifierRunner({ workspace, commandRunner }).run(config(rules), signal);
  assert.deepEqual(without, await run(rules));
});

/** U-223 (PM): rules whose target, or whose table_shape table, is under secret-out. */
function targetRules(source: string): DataRule[] {
  const total = (target: string): DataRule => ({ type: "aggregate_match", source: csv(source), column: "amount", op: "sum", target: csv(target), targetColumn: "total" });
  const byRegion = (target: string): DataRule => ({
    type: "aggregate_match",
    source: csv(source),
    column: "amount",
    op: "sum",
    groupBy: "region",
    target: csv(target),
    targetColumn: "sum",
    targetKeyColumn: "region",
  });
  const shape = (table: string, rows: Extract<DataRule, { type: "table_shape" }>["rows"]): DataRule => ({ type: "table_shape", table: csv(table), rows });
  return [
    total("secret-out/total-wrong.csv"),
    total("secret-out/total-right.csv"),
    total("secret-out/total-two.csv"),
    byRegion("secret-out/by-region-wrong.csv"),
    byRegion("secret-out/by-region-right.csv"),
    shape("secret-out/rows-six.csv", { equals: 7 }),
    shape("secret-out/rows-seven.csv", { min: 1, max: 9 }),
    shape("secret-out/rows-six.csv", { sameAs: csv(source) }),
    shape("secret-out/rows-seven.csv", { sameAs: csv(source) }),
    shape("secret-out/rows-six.csv", { min: 7 }),
  ];
}

test("U-223 (PM): targets under no unreadable path read as before, letter for letter", async () => {
  const rules = targetRules("data/sales.csv");
  const before = await runDataChecksVerifierV1(config(rules), workspace, new AbortController().signal);
  assert.deepEqual(await run(rules), before);
  assert.deepEqual(await run(rules, { unreadablePaths: ["other"] }), before);
});

test("U-223 (PM): a target or a table_shape table under unreadable paths keeps every verdict and gives none of its cells or counts", async () => {
  const rules = targetRules("data/sales.csv");
  const plain = await run(rules);
  const hidden = await run(rules, { unreadablePaths: ["secret-out"] });
  assert.deepEqual(verdicts(hidden), verdicts(plain));
  assert.equal(hidden.outcome, plain.outcome);
  assert.deepEqual(hidden.checked, plain.checked);
  assert.deepEqual(hidden.limits, plain.limits);
  // The plain evidence names the targets' own numbers; the hidden one does not.
  for (const cell of ["9876.5432", "3333.3333", "6666.6666"]) assert.ok(plain.evidence.includes(cell), cell);
  for (const cell of ["9876.5432", "3333.3333", "6666.6666", "5555.5555"]) assert.equal(hidden.evidence.includes(cell), false, cell);
  assert.equal(/found|target has [0-9]+ data rows|[0-9]+ groups agree|\b6 data rows/.test(hidden.evidence), false, hidden.evidence);
  for (const line of hidden.evidence.split("\n")) assert.ok(line.endsWith(`${UNREADABLE_TARGET_NOTE})`), line);
  const lines = hidden.evidence.split("\n");
  const sales = '"data/sales.csv" (csv)';
  const tolerance = "within absolute 1e-9, relative 1e-9";
  assert.ok((lines[0] as string).endsWith(`; ${UNREADABLE_TARGET_NOTE})`), lines[0] as string);
  assert.match(lines[0] as string, /\(target data row 1 of column "total" does not match: recomputed [0-9.]+; the target is under/);
  assert.equal(lines[1], `held: sum of "amount" in ${sales} matches "total" in "secret-out/total-right.csv" (csv) ${tolerance} (target data row 1 agrees; ${UNREADABLE_TARGET_NOTE})`);
  assert.equal(lines[2], `not held: sum of "amount" in ${sales} matches "total" in "secret-out/total-two.csv" (csv) ${tolerance} (target does not have exactly 1 data row; ${UNREADABLE_TARGET_NOTE})`);
  assert.match(lines[3] as string, /\(target data row 1 of column "sum" does not match \(group first seen at source data row 1\): recomputed [0-9.]+; target data row 3 of column "sum" does not match \(group first seen at source data row 5\): recomputed [0-9.]+; 1 source rows without a group value left out; /);
  assert.equal(
    lines[4],
    `held: sum of "amount" in ${sales} grouped by "region" matches "sum" in "secret-out/by-region-right.csv" (csv) (key column "region") ${tolerance} (the groups agree; 1 source rows without a group value left out; ${UNREADABLE_TARGET_NOTE})`,
  );
  assert.equal(lines[5], `not held: table "secret-out/rows-six.csv" (csv) has exactly 7 data rows (the data rows do not fit: expected exactly 7 data rows; ${UNREADABLE_TARGET_NOTE})`);
  assert.equal(lines[6], `held: table "secret-out/rows-seven.csv" (csv) has at least 1 and at most 9 data rows (data rows as required; ${UNREADABLE_TARGET_NOTE})`);
  assert.equal(lines[7], `not held: table "secret-out/rows-six.csv" (csv) has as many data rows as ${sales} (the data rows do not fit: expected 7 as ${sales}; ${UNREADABLE_TARGET_NOTE})`);
  assert.equal(lines[8], `held: table "secret-out/rows-seven.csv" (csv) has as many data rows as ${sales} (as many data rows as ${sales}; ${UNREADABLE_TARGET_NOTE})`);
  assert.equal(lines[9], `not held: table "secret-out/rows-six.csv" (csv) has at least 7 data rows (the data rows do not fit: expected at least 7 data rows; ${UNREADABLE_TARGET_NOTE})`);
});

test("U-223 (PM): a source and a target both under unreadable paths give neither's numbers and both notes", async () => {
  const rules = targetRules("data/sales.csv");
  const plain = await run(rules);
  const hidden = await run(rules, { unreadablePaths: ["data", "secret-out"] });
  assert.deepEqual(verdicts(hidden), verdicts(plain));
  assert.equal(/recomputed|found|[0-9]+ source rows|expected 7 as/.test(hidden.evidence), false, hidden.evidence);
  // Rules 5, 6 and 9 count rows against the rule's own numbers: no source, so the target's note only.
  for (const [index, line] of hidden.evidence.split("\n").entries()) {
    const end = [5, 6, 9].includes(index) ? `; ${UNREADABLE_TARGET_NOTE})` : `; ${UNREADABLE_SOURCE_NOTE}; ${UNREADABLE_TARGET_NOTE})`;
    assert.ok(line.endsWith(end), line);
  }
  assert.ok(hidden.evidence.includes(`(not as many data rows as "data/sales.csv" (csv); ${UNREADABLE_SOURCE_NOTE}; ${UNREADABLE_TARGET_NOTE})`));
});
