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
 * - PM, after the scan of the repair messages: a rule over a value query_table does not give the model
 *   (min or max, a value of fewer than k cells and that group's count, the whole of a table under k
 *   rows, the row count of such a table, a group whose cells are all empty) is not compared: no verdict
 *   for or against goes to the model. Such a rule is undecided and says why; within a grouped rule
 *   such groups are left out like the hidden ones. The verifier's limits count the rules not compared,
 *   so a check of such rules only does not read as passed.
 * - PM, after that: a rule whose checked table (an aggregate's target, a table_shape table) is under
 *   unreadable paths is not compared either, whatever it checks and whether the file is there: the
 *   model cannot write such a table, and a verdict would tell it about the table.
 * - Without unreadable paths the evidence is as before (the frozen copy's tests stay).
 * Temporary folder, synthetic values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import type { DataChecksVerifierConfig, DataRule, RawVerifierResult, TableRef, Workspace } from "../../../src/contracts/index.js";
import { UNREADABLE_SOURCE_NOTE, UNREADABLE_TARGET_NOTE, runDataChecksVerifier } from "../../../src/verify/data-checks.js";
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
  for (const dir of ["data", "out", "open", "secret"]) await mkdir(join(root, dir));
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
    // A quote inside an unquoted field on data row 4 (line 5): the source does not parse.
    "data/broken.csv": "region,amount\nharbor,1.5\nmeadow,2.5\nsummit,3.5\nval\"ley,4.5\n",
    // bonus: harbor (6 rows) has 3 cells, meadow (5 rows) all 5, summit (4 rows) 2; one with harbor's all empty.
    "data/bonus.csv": "region,bonus\nharbor,1.5\nharbor,\nharbor,2.5\nharbor,\nharbor,3.5\nharbor,\nmeadow,4.25\nmeadow,5.25\nmeadow,6.25\nmeadow,7.25\nmeadow,8.25\nsummit,9.5\nsummit,\nsummit,10.5\nsummit,\n",
    "data/bonus-empty.csv": "region,bonus\nharbor,\nharbor,\nharbor,\nharbor,\nharbor,\nharbor,\nmeadow,4.25\nmeadow,5.25\nmeadow,6.25\nmeadow,7.25\nmeadow,8.25\n",
    "data/bonus-few.csv": "region,bonus\nharbor,1.5\nharbor,\nharbor,\nharbor,\nharbor,\nharbor,\nmeadow,4.25\nmeadow,\nmeadow,\nmeadow,\nmeadow,\n",
    "data/small.csv": "region,amount\nharbor,1.25\nmeadow,2.25\nsummit,3.25\n",
    "data/small-bad.csv": "region,amount\nharbor,1.25\nmeadow,n/a\nsummit,3.25\n",
    "out/bonus.csv": "region,sum\nharbor,999\nmeadow,31.25\n",
    "out/bonus-count.csv": "region,sum\nharbor,3\nmeadow,5\n",
    "out/three.csv": "k\n1\n2\n3\n",
    // A readable copy of the source, and tables under a folder only the targets are in.
    "open/people.csv": table(ROWS),
    "secret/total.csv": "total\n1\n",
    "secret/by-region.csv": `region,sum\nharbor,${harbor}\nmeadow,${meadow}\n`,
    "secret/rows.csv": "k\n1\n2\n3\n",
    // A target under the unreadable folder too: no count of its rows is written (U-223, PM).
    "data/target-with-hidden.csv": `region,sum\nharbor,${harbor}\nmeadow,${meadow}\nsummit,1\nvalley,2\n`,
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
const NOT_JUDGED = "not compared: a verdict on a table under unreadable paths would tell the model about it";

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

test("U-258: a target under unreadable paths too is not compared", async () => {
  const { state, note } = await noteOf(byRegion("data/target-with-hidden.csv"));
  assert.deepEqual({ state, note }, { state: "undecided", note: `${NOT_JUDGED}; ${UNREADABLE_SOURCE_NOTE}; ${UNREADABLE_TARGET_NOTE}` });
  assertNothingHidden(note);
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

test("U-258: a source that does not parse is named without its data row or line", async () => {
  const hidden = await noteOf(byRegion("out/shown-right.csv", "data/broken.csv"));
  assert.deepEqual(hidden, { state: "undecided", note: `source "data/broken.csv" (csv): does not parse as csv: quote in unquoted field; ${UNREADABLE_SOURCE_NOTE}` });
  const plain = await noteOf(byRegion("out/shown-right.csv", "data/broken.csv"), {});
  assert.deepEqual(plain, { state: "undecided", note: 'source "data/broken.csv" (csv): does not parse as csv: quote in unquoted field at data row 4, line 5' });
  // The same for the table a row count is compared with (rows.sameAs).
  const shape: DataRule = { type: "table_shape", table: csv("out/total.csv"), rows: { sameAs: csv("data/broken.csv") } };
  const line = (await run([shape])).evidence;
  assert.equal(/data row|line [0-9]/.test(line.slice(line.indexOf("(csv) ("))), false, line);
  assert.ok(line.endsWith(`; ${UNREADABLE_SOURCE_NOTE})`), line);
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

const NOT_GIVEN = "not compared: query_table does not give this value to the model";
const FEW_CELLS = "the source's groups whose value comes from fewer than 5 cells are not compared";
const rule = (op: "sum" | "count" | "mean" | "min" | "max", source: string, target: string, column = "amount", grouped = true): DataRule => ({
  type: "aggregate_match",
  source: csv(source),
  column,
  op,
  target: csv(target),
  targetColumn: grouped ? "sum" : "total",
  ...(grouped ? { groupBy: "region", targetKeyColumn: "region" } : {}),
});

test("U-258 (PM): min and max of an unreadable source are not compared, grouped or not", async () => {
  for (const op of ["min", "max"] as const) {
    for (const grouped of [true, false]) {
      const hidden = await noteOf(rule(op, "data/people.csv", grouped ? "out/shown-right.csv" : "out/total.csv", "amount", grouped));
      assert.deepEqual(hidden, { state: "undecided", note: `${NOT_GIVEN}; ${UNREADABLE_SOURCE_NOTE}` }, `${op} ${grouped}`);
      // Without the list they are compared as before.
      assert.equal((await noteOf(rule(op, "data/people.csv", grouped ? "out/shown-right.csv" : "out/total.csv", "amount", grouped), {})).state, "not held");
    }
  }
});

test("U-258 (PM): a group whose value comes from fewer than k cells is left out, its count too, and so is one with only empty cells", async () => {
  // harbor's 3 bonus cells: its sum (999, wrong) is not compared; meadow's 5 are.
  const sum = await noteOf(rule("sum", "data/bonus.csv", "out/bonus.csv", "bonus"));
  assert.deepEqual(sum, { state: "held", note: `1 groups agree; ${NOT_COMPARED}; ${FEW_CELLS}; ${UNREADABLE_SOURCE_NOTE}` });
  const count = await noteOf(rule("count", "data/bonus.csv", "out/bonus-count.csv", "bonus"));
  assert.deepEqual(count, { state: "held", note: `1 groups agree; ${NOT_COMPARED}; ${FEW_CELLS}; ${UNREADABLE_SOURCE_NOTE}` });
  // A group of only empty cells no longer makes the whole rule undecided (that told it exists).
  const empty = await noteOf(rule("sum", "data/bonus-empty.csv", "out/bonus.csv", "bonus"));
  assert.deepEqual(empty, { state: "held", note: `1 groups agree; ${FEW_CELLS}; ${UNREADABLE_SOURCE_NOTE}` });
  // Nothing left to compare: undecided, not held and not failed.
  const none = await noteOf(rule("sum", "data/bonus-few.csv", "out/bonus.csv", "bonus"));
  assert.deepEqual(none, { state: "undecided", note: `${NOT_GIVEN}; ${FEW_CELLS}; ${UNREADABLE_SOURCE_NOTE}` });
  for (const result of [sum, count, empty, none]) assertNothingHidden(result.note);
  // Without the list harbor's wrong sum fails and the empty group leaves the rule undecided, as before.
  assert.equal((await noteOf(rule("sum", "data/bonus.csv", "out/bonus.csv", "bonus"), {})).state, "not held");
  assert.equal((await noteOf(rule("sum", "data/bonus-empty.csv", "out/bonus.csv", "bonus"), {})).state, "undecided");
});

test("U-258 (PM): the whole of a table under k rows or of fewer than k cells is not compared", async () => {
  const small = await noteOf(rule("sum", "data/small.csv", "out/total.csv", "amount", false));
  assert.deepEqual(small, { state: "undecided", note: `${NOT_GIVEN}; ${UNREADABLE_SOURCE_NOTE}` });
  // Under k rows, a cell that is not a number is not told either.
  assert.deepEqual(await noteOf(rule("sum", "data/small-bad.csv", "out/total.csv", "amount", false)), { state: "undecided", note: `${NOT_GIVEN}; ${UNREADABLE_SOURCE_NOTE}` });
  const few = await noteOf(rule("sum", "data/bonus-few.csv", "out/total.csv", "bonus", false));
  assert.deepEqual(few, { state: "undecided", note: `${NOT_GIVEN}; ${UNREADABLE_SOURCE_NOTE}` });
  const empty = await noteOf(rule("count", "data/bonus-empty.csv", "out/total.csv", "bonus", false));
  // 11 rows and 5 cells (meadow's): compared, and the total of 1 fails.
  assert.equal(empty.state, "not held", empty.note);
  // A table of at least k rows and cells is compared as before (the wrong total fails).
  assert.equal((await noteOf(rule("sum", "data/people.csv", "out/total.csv", "amount", false))).state, "not held");
  assert.equal((await noteOf(rule("sum", "data/small.csv", "out/total.csv", "amount", false), {})).state, "not held");
});

test("U-258 (PM): the row count of a table under k rows is not compared (rows.sameAs)", async () => {
  const shape = (source: string): DataRule => ({ type: "table_shape", table: csv("out/three.csv"), rows: { sameAs: csv(source) } });
  const small = (await run([shape("data/small.csv")])).evidence;
  assert.equal(small, `undecided: table "out/three.csv" (csv) has as many data rows as "data/small.csv" (csv) (${NOT_GIVEN}; ${UNREADABLE_SOURCE_NOTE})`);
  // 16 rows: compared, the target's own count written as before.
  const people = (await run([shape("data/people.csv")])).evidence;
  assert.ok(people.startsWith("not held: ") && people.includes("3 data rows, not as many as"), people);
  // Without the list the small table is compared (it has 3 rows like the target).
  assert.ok((await run([shape("data/small.csv")], {})).evidence.startsWith("held: "));
});

test("U-258 (PM): the limits count the rules not compared, so such a check never reads as passed", async () => {
  const mixed = await run([byRegion("out/shown-right.csv"), rule("max", "data/people.csv", "out/shown-right.csv"), rule("sum", "data/small.csv", "out/total.csv", "amount", false)]);
  assert.equal(mixed.outcome, "inconclusive");
  assert.ok(mixed.limits.includes("2 of 3 rules were not compared: a table they check is under unreadable paths, and a verdict would tell the model what query_table does not give it"), JSON.stringify(mixed.limits));
  const only = await run([rule("min", "data/people.csv", "out/shown-right.csv")]);
  assert.equal(only.outcome, "inconclusive");
  assert.ok(only.limits.includes("1 of 1 rules were not compared: a table they check is under unreadable paths, and a verdict would tell the model what query_table does not give it"), JSON.stringify(only.limits));
  // A check whose rules are all compared has the limits of before.
  const compared = await run([byRegion("out/shown-right.csv")]);
  assert.equal(compared.limits.some((line) => line.includes("not compared")), false, JSON.stringify(compared.limits));
});

test("U-258 (PM): a rule whose checked table is under unreadable paths is not compared, whatever it checks", async () => {
  const SECRET: DataChecksOptions = { unreadablePaths: ["secret"] };
  const end = `${NOT_JUDGED}; ${UNREADABLE_TARGET_NOTE}`;
  const rules: DataRule[] = [
    rule("sum", "open/people.csv", "secret/total.csv", "amount", false),
    byRegion("secret/by-region.csv", "open/people.csv"),
    rule("sum", "open/people.csv", "secret/missing.csv", "amount", false),
    { type: "table_shape", table: csv("secret/rows.csv"), rows: { equals: 3 } },
    { type: "table_shape", table: csv("secret/rows.csv"), columns: ["k"] },
    { type: "table_shape", table: csv("secret/missing.csv"), rows: { min: 1 } },
  ];
  const hidden = await run(rules, SECRET);
  for (const line of hidden.evidence.split("\n")) {
    assert.ok(line.startsWith("undecided: ") && line.endsWith(`(${end})`), line);
  }
  // Not even whether the file is there.
  assert.equal(hidden.evidence.includes("not found"), false, hidden.evidence);
  assert.equal(hidden.outcome, "inconclusive");
  assert.ok(hidden.limits.includes("6 of 6 rules were not compared: a table they check is under unreadable paths, and a verdict would tell the model what query_table does not give it"), JSON.stringify(hidden.limits));
  // With the source hidden too, both notes follow.
  const both = await noteOf(rule("sum", "data/people.csv", "secret/total.csv", "amount", false), { unreadablePaths: ["data", "secret"] });
  assert.deepEqual(both, { state: "undecided", note: `${NOT_JUDGED}; ${UNREADABLE_SOURCE_NOTE}; ${UNREADABLE_TARGET_NOTE}` });
  // Without the list every rule is compared as before: the table of 3 rows holds, the missing file fails, and
  // the grouped target lacks the small groups, which are compared then.
  const plain = (await run(rules, {})).evidence.split("\n");
  assert.deepEqual(plain.map((line) => line.slice(0, line.indexOf(":"))), ["not held", "not held", "not held", "held", "held", "not held"]);
  assert.ok(plain[2]?.includes("file not found"), plain.join("\n"));
});
