/**
 * U-258 (PM decision after the bundle A docs run: F-1 and F-2, DR-70): a grouped aggregate_match whose
 * source is under the run's unreadable paths compares only the source's groups of at least k rows
 * (the run's k, never below 5), as query_table shows only those to the model.
 * - A target that has exactly those groups, right, holds; the groups of fewer than k rows are not
 *   asked for, and the evidence says they are not compared (no count of them, no key).
 * - A target row whose key is not one of those groups fails. The text gives how many such rows, and
 *   reads the same whether the key belongs to a hidden group or to no source row at all, so a repair
 *   cannot learn that a guessed key exists.
 * - A missing group of at least k rows fails with a count only.
 * - No source data row number is written anywhere (F-2: "the group first seen at source data row N"
 *   gave a hidden group's place in the table to the model in a repair), nor a hidden key, value or
 *   row count; a cell that is not a number in the source is named without its row, and one in a
 *   hidden group does not decide the rule.
 * - Without unreadable paths the evidence is as before (the frozen copy's tests stay).
 * Temporary folder, synthetic values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import type { DataChecksVerifierConfig, DataRule, RawVerifierResult, TableRef, Workspace } from "../../../src/contracts/index.js";
import { UNREADABLE_SOURCE_NOTE, runDataChecksVerifier } from "../../../src/verify/data-checks.js";
import type { DataChecksOptions } from "../../../src/verify/data-checks.js";
import { createVerifierRunner } from "../../../src/verify/index.js";
import type { CommandRunner } from "../../../src/verify/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

let root = "";
let workspace: Workspace;

// Groups of 6 (harbor), 5 (meadow), 4 (summit) and 1 (valley) rows, interleaved, with amounts
// unlike any row number. summit and valley are under k = 5.
const ROWS: readonly (readonly [string, string])[] = [
  ["harbor", "101.25"],
  ["meadow", "202.5"],
  ["summit", "303.75"],
  ["harbor", "111.5"],
  ["valley", "999.125"],
  ["meadow", "212.25"],
  ["harbor", "121.75"],
  ["summit", "313.5"],
  ["meadow", "222.75"],
  ["harbor", "131.25"],
  ["summit", "323.25"],
  ["meadow", "232.5"],
  ["harbor", "141.5"],
  ["summit", "333.75"],
  ["meadow", "242.25"],
  ["harbor", "151.875"],
];
const table = (rows: readonly (readonly [string, string])[]): string => `region,amount\n${rows.map((row) => row.join(",")).join("\n")}\n`;
const sumOf = (key: string): number => ROWS.filter(([region]) => region === key).reduce((sum, [, amount]) => sum + Number(amount), 0);
const HIDDEN_KEYS = ["summit", "valley"];
// What must never be written for a hidden source: the hidden groups' sums and cells, every group's row count.
const HIDDEN_VALUES = [String(sumOf("summit")), "999.125", ...ROWS.filter(([region]) => HIDDEN_KEYS.includes(region)).map(([, amount]) => amount)];

before(async () => {
  root = await mkdtemp(join(tmpdir(), "codaryn-u258-"));
  for (const dir of ["data", "out"]) await mkdir(join(root, dir));
  const harbor = sumOf("harbor");
  const meadow = sumOf("meadow");
  const files: Record<string, string> = {
    "data/people.csv": table(ROWS),
    // A cell that is not a number in a group of at least k rows (harbor) and in a hidden one (summit).
    "data/bad-shown.csv": table(ROWS.map(([region, amount], index) => [region, index === 3 ? "n/a" : amount] as const)),
    "data/bad-hidden.csv": table(ROWS.map(([region, amount], index) => [region, index === 7 ? "n/a" : amount] as const)),
    "out/shown-right.csv": `region,sum\nharbor,${harbor}\nmeadow,${meadow}\n`,
    "out/shown-missing.csv": `region,sum\nharbor,${harbor}\n`,
    "out/shown-wrong.csv": `region,sum\nharbor,1.5\nmeadow,${meadow}\n`,
    "out/shown-twice.csv": `region,sum\nharbor,${harbor}\nharbor,${harbor}\nmeadow,${meadow}\n`,
    "out/with-hidden.csv": `region,sum\nharbor,${harbor}\nmeadow,${meadow}\nsummit,${sumOf("summit")}\n`,
    "out/with-unknown.csv": `region,sum\nharbor,${harbor}\nmeadow,${meadow}\nnowhere,${sumOf("summit")}\n`,
    "out/with-two-hidden.csv": `region,sum\nharbor,${harbor}\nmeadow,${meadow}\nsummit,1\nvalley,2\n`,
    "out/total.csv": "total\n1\n",
  };
  for (const [name, text] of Object.entries(files)) await writeFile(join(root, name), text, "utf8");
  workspace = await createWorkspace({ root });
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

const csv = (path: string): TableRef => ({ path, format: "csv" });
const byRegion = (target: string, source = "data/people.csv"): DataRule => ({
  type: "aggregate_match",
  source: csv(source),
  column: "amount",
  op: "sum",
  groupBy: "region",
  target: csv(target),
  targetColumn: "sum",
  targetKeyColumn: "region",
});
const config = (rules: readonly DataRule[]): DataChecksVerifierConfig => ({ id: "data", kind: "data_checks", rules: [...rules] });
const HIDDEN: DataChecksOptions = { unreadablePaths: ["data"] };
const run = (rules: readonly DataRule[], options: DataChecksOptions = HIDDEN): Promise<RawVerifierResult> =>
  runDataChecksVerifier(config(rules), workspace, new AbortController().signal, options);
/** The note of the one rule's line: what is in the parentheses after the label. */
async function noteOf(rule: DataRule, options: DataChecksOptions = HIDDEN): Promise<{ state: string; note: string }> {
  const line = (await run([rule], options)).evidence;
  const state = line.slice(0, line.indexOf(":"));
  const open = line.indexOf(" (", line.indexOf(" within "));
  return { state, note: line.slice(open + 2, -1) };
}

/** Nothing of the hidden groups, and no source data row, in an evidence of a hidden source. */
function assertNothingHidden(evidence: string): void {
  assert.equal(/source data row/.test(evidence), false, evidence);
  for (const key of HIDDEN_KEYS) assert.equal(evidence.includes(key), false, `${key}: ${evidence}`);
  for (const value of HIDDEN_VALUES) assert.equal(evidence.includes(value), false, `${value}: ${evidence}`);
  assert.equal(/\b[0-9]+ (rows|data rows) of the source|first seen/.test(evidence), false, evidence);
}

const NOT_COMPARED = "the source's groups of fewer than 5 rows are not compared";

test("U-258: a target with exactly the source's groups of at least k rows holds; the smaller ones are not asked for", async () => {
  const { state, note } = await noteOf(byRegion("out/shown-right.csv"));
  assert.equal(state, "held");
  assert.equal(note, `2 groups agree; ${NOT_COMPARED}; ${UNREADABLE_SOURCE_NOTE}`);
});

test("U-258 (F-2): a missing group of at least k rows fails with a count, not with the source's row", async () => {
  const { state, note } = await noteOf(byRegion("out/shown-missing.csv"));
  assert.equal(state, "not held");
  assert.equal(note, `no target row for 1 of the source's groups of at least 5 rows; ${NOT_COMPARED}; ${UNREADABLE_SOURCE_NOTE}`);
  assertNothingHidden(note);
});

test("U-258 (F-1): a target row for a hidden group fails, in the words of a key no source row has", async () => {
  const hidden = await noteOf(byRegion("out/with-hidden.csv"));
  const unknown = await noteOf(byRegion("out/with-unknown.csv"));
  assert.equal(hidden.state, "not held");
  assert.equal(hidden.note, `1 target data row has a key that is not one of the source's groups of at least 5 rows; ${NOT_COMPARED}; ${UNREADABLE_SOURCE_NOTE}`);
  // The same words: a repair cannot tell that the guessed key exists in the source.
  assert.deepEqual(unknown, hidden);
  const two = await noteOf(byRegion("out/with-two-hidden.csv"));
  assert.equal(two.note, `2 target data rows have a key that is not one of the source's groups of at least 5 rows; ${NOT_COMPARED}; ${UNREADABLE_SOURCE_NOTE}`);
  for (const result of [hidden, unknown, two]) assertNothingHidden(result.note);
});

test("U-258 (F-2): the other problems of a group name the target's rows only", async () => {
  const wrong = await noteOf(byRegion("out/shown-wrong.csv"));
  assert.equal(wrong.note, `target data row 1 of column "sum" does not match; ${NOT_COMPARED}; ${UNREADABLE_SOURCE_NOTE}`);
  const twice = await noteOf(byRegion("out/shown-twice.csv"));
  assert.equal(twice.note, `target data rows 1, 2 have the same key; ${NOT_COMPARED}; ${UNREADABLE_SOURCE_NOTE}`);
  for (const result of [wrong, twice]) assertNothingHidden(result.note);
});

test("U-258: a source cell that is not a number is named without its row; in a hidden group it decides nothing", async () => {
  const shown = await noteOf(byRegion("out/shown-right.csv", "data/bad-shown.csv"));
  assert.deepEqual(shown, { state: "undecided", note: `a source cell of column "amount" is not a number; ${UNREADABLE_SOURCE_NOTE}` });
  const hiddenGroup = await noteOf(byRegion("out/shown-right.csv", "data/bad-hidden.csv"));
  assert.deepEqual(hiddenGroup, { state: "held", note: `2 groups agree; ${NOT_COMPARED}; ${UNREADABLE_SOURCE_NOTE}` });
  const total: DataRule = { type: "aggregate_match", source: csv("data/bad-shown.csv"), column: "amount", op: "sum", target: csv("out/total.csv"), targetColumn: "total" };
  assert.deepEqual(await noteOf(total), { state: "undecided", note: `a source cell of column "amount" is not a number; ${UNREADABLE_SOURCE_NOTE}` });
  for (const result of [shown, hiddenGroup]) assertNothingHidden(result.note);
});

test("U-258: k is the run's, never below 5", async () => {
  // k 6 hides meadow (5 rows) too: its row is now a key that is not one of the groups shown.
  const six = await noteOf(byRegion("out/shown-right.csv"), { ...HIDDEN, minGroupSize: 6 });
  assert.equal(six.note, `1 target data row has a key that is not one of the source's groups of at least 6 rows; the source's groups of fewer than 6 rows are not compared; ${UNREADABLE_SOURCE_NOTE}`);
  // A k below 5 is 5.
  assert.deepEqual(await noteOf(byRegion("out/shown-right.csv"), { ...HIDDEN, minGroupSize: 3 }), await noteOf(byRegion("out/shown-right.csv")));
  // The verifier runner passes the run's k on.
  const commandRunner: CommandRunner = {
    run: async () => {
      throw new Error("no command here");
    },
  };
  const runner = createVerifierRunner({ workspace, commandRunner, unreadablePaths: ["data"], minGroupSize: 6 });
  const result = await runner.run(config([byRegion("out/shown-right.csv")]), new AbortController().signal);
  assert.ok(result.evidence.includes("at least 6 rows"), result.evidence);
});

test("U-258: without unreadable paths every group is compared and named as before", async () => {
  const plain = await noteOf(byRegion("out/shown-right.csv"), {});
  assert.equal(plain.state, "not held");
  assert.ok(plain.note.includes("no target row for the group first seen at source data row 3"), plain.note);
  assert.equal(plain.note.includes(UNREADABLE_SOURCE_NOTE), false);
  const hiddenCell = await noteOf(byRegion("out/shown-right.csv", "data/bad-hidden.csv"), {});
  assert.equal(hiddenCell.state, "undecided");
  assert.ok(hiddenCell.note.includes("source data row 8"), hiddenCell.note);
});
