/**
 * U-208 (P1 bundle A, A-5; DR-70): the canary. A run with the real policy gate, privacy gateway and
 * tool runner over a table under the run's unreadable paths, every cell holding its own marker made
 * at run time. The model calls query_table (describe, a grouped query, a query whose every group is
 * smaller than k, a refused min, a not_number), read_file and a text search on the table. Then no
 * request to the model, no journal event and nothing in the result holds a marker from a row (names,
 * notes, single amounts, the row without a key) or a key of a group of fewer than k rows; what DR-70
 * allows does reach the model: the column names, the keys of the groups of at least k rows, their row
 * counts and their aggregates. The checks also name the denials and failures, so a run that read
 * nothing cannot pass. Only the model and the journal are scripted; no real API.
 *
 * The second part: the engine's argument check for query_table.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import type { EngineDeps, JsonObject, PolicyConfig, ToolCall, ToolResult, Workspace } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { argsProblemText, workflowToolArgsProblem } from "../../../src/engine/validate-args.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { FakeClock, FakeJournal, FakeModel, FakeVerifiers, finalAnswer, makeTask, response } from "./fakes.js";

const C = `cnry${randomBytes(6).toString("hex")}`;
const KEY = { big: `${C}kBIG`, mid: `${C}kMID`, small: `${C}kSMALL`, tiny: `${C}kTINY` } as const;
/** Amounts chosen so that no sum or mean shown equals one of them. */
const AMOUNTS = {
  big: ["11.1371", "12.2953", "13.4179", "14.5813", "15.6197", "16.7351"],
  mid: ["21.3917", "22.4339", "23.5711", "24.6173", "25.7393"],
  small: ["31.9137", "32.1759", "33.2971"],
  tiny: ["41.5179"],
  none: ["51.6317"],
} as const;

interface Row {
  readonly name: string;
  readonly city: string;
  readonly amount: string;
  readonly note: string;
}
const ROWS: Row[] = [];
for (const group of ["big", "mid", "small", "tiny", "none"] as const) {
  for (const amount of AMOUNTS[group]) {
    const index = ROWS.length;
    ROWS.push({ name: `${C}n${index}x`, city: group === "none" ? "" : KEY[group], amount, note: `${C}o${index}x` });
  }
}

let base: string;
let workspace: Workspace;

before(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-u208c-")));
  await fs.mkdir(path.join(base, "private"));
  const lines = ["name,city,amount,note", ...ROWS.map((row) => `${row.name},${row.city},${row.amount},${row.note}`)];
  await fs.writeFile(path.join(base, "private", "people.csv"), `${lines.join("\n")}\n`, "utf8");
  await fs.writeFile(path.join(base, "a.txt"), "the verifier's file\n", "utf8");
  workspace = await createWorkspace({ root: base });
});

after(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

const POLICY: PolicyConfig = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
const TABLE = "private/people.csv";

const call = (id: string, name: string, args: JsonObject): ToolCall => ({ id, name, args });
const CALLS: readonly ToolCall[] = [
  call("q1", "query_table", { path: TABLE, describe: true }),
  call("q2", "query_table", {
    path: TABLE,
    groupBy: ["city"],
    operations: [
      { op: "count", column: "name" },
      { op: "sum", column: "amount" },
      { op: "mean", column: "amount" },
      { op: "count", column: "note" },
    ],
  }),
  call("q3", "query_table", { path: TABLE, groupBy: ["city", "name"], operations: [{ op: "sum", column: "amount" }] }),
  call("q4", "query_table", { path: TABLE, groupBy: ["city"], operations: [{ op: "min", column: "amount" }] }),
  call("q5", "query_table", { path: TABLE, operations: [{ op: "sum", column: "name" }] }),
  call("r1", "read_file", { path: TABLE }),
  call("s1", "search_files", { path: ".", text: C }),
];

async function run() {
  const privacy = createPrivacyGateway({ secrets: [] });
  const unreadablePaths = ["private"];
  const model = new FakeModel([...CALLS.map((one) => () => response([one])), () => finalAnswer("done")]);
  const journal = new FakeJournal();
  const deps: EngineDeps = {
    task: makeTask({
      workspaceRoot: workspace.root,
      workflow: "analyze",
      tools: ["read_file", "search_files", "query_table"],
      plan: "none",
      completion: "verifiers",
      policy: POLICY,
      unreadablePaths,
      minGroupSize: 5,
    }),
    runId: "20261113T120000Z-0000c208",
    model,
    privacy,
    policy: createPolicyGate({ config: POLICY, workspace, unreadablePaths }),
    tools: createToolRunner({ workspace, privacy, unreadablePaths, minGroupSize: 5 }),
    verifiers: new FakeVerifiers(),
    journal,
    clock: new FakeClock(),
    signal: new AbortController().signal,
  };
  const result = await runTask(deps);
  return { result, model, journal };
}

/** True when `amount` stands in `text` as a whole number (not a part of a longer one). */
function holdsNumber(text: string, amount: string): boolean {
  return new RegExp(`(?<![0-9.])${amount.replace(".", "\\.")}(?![0-9])`).test(text);
}

describe("U-208: the canary - only DR-70's four reach the model, the journal and the result", () => {
  let outcome: Awaited<ReturnType<typeof run>>;
  let everything: string;
  const resultOf = (id: string): ToolResult => {
    const found = outcome.journal.ofType("tool_result").find((event) => event.result.callId === id);
    assert.ok(found !== undefined, `no result for ${id}`);
    return found.result;
  };

  before(async () => {
    outcome = await run();
    everything = JSON.stringify({ requests: outcome.model.requests, events: outcome.journal.events, result: outcome.result });
  });

  test("the run went through every call and ended as the script did", () => {
    assert.equal(outcome.model.requests.length, CALLS.length + 1);
    assert.equal(outcome.result.status, "done", JSON.stringify(outcome.result));
  });

  test("no marker from a row: names, notes, single amounts, the row without a key", () => {
    for (const row of ROWS) {
      assert.equal(everything.includes(row.name), false, `name of row ${ROWS.indexOf(row)}`);
      assert.equal(everything.includes(row.note), false, `note of row ${ROWS.indexOf(row)}`);
      assert.equal(holdsNumber(everything, row.amount), false, `amount ${row.amount}`);
    }
  });

  test("no key of a group of fewer than k rows", () => {
    assert.equal(everything.includes(KEY.small), false);
    assert.equal(everything.includes(KEY.tiny), false);
  });

  test("what DR-70 allows did reach the model: column names, the keys of groups of at least k rows, their counts and aggregates", () => {
    const seen = JSON.stringify(outcome.model.requests);
    for (const allowed of [KEY.big, KEY.mid, "name", "city", "amount", "note"]) assert.ok(seen.includes(allowed), allowed);
    const grouped = JSON.parse(String(resultOf("q2").content)) as { groups: { keys: string[]; rows: number; values: number[] }[]; suppressedGroups: number; minGroupSize: number };
    assert.deepEqual(
      grouped.groups.map((group) => [group.keys[0], group.rows, group.values[0], group.values[3]]),
      [
        [KEY.big, 6, 6, 6],
        [KEY.mid, 5, 5, 5],
      ],
    );
    assert.equal(grouped.suppressedGroups, 2);
    assert.equal(grouped.minGroupSize, 5);
    const big = AMOUNTS.big.map(Number).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs((grouped.groups[0]?.values[1] ?? 0) - big) < 1e-9);
    const shape = JSON.parse(String(resultOf("q1").content)) as { rows: number | null };
    assert.equal(shape.rows, ROWS.length);
  });

  test("a query whose every group is smaller than k gives no group, only their number", () => {
    const fine = JSON.parse(String(resultOf("q3").content)) as { groups: unknown[]; suppressedGroups: number };
    assert.deepEqual(fine.groups, []);
    assert.equal(fine.suppressedGroups, ROWS.length - AMOUNTS.none.length);
  });

  test("min is refused, a text column summed fails by its row, read_file is denied and the search finds nothing", () => {
    assert.equal(resultOf("q4").errorCode, "invalid_table");
    assert.match(String(resultOf("q4").content), /op_not_allowed at operations\[0\]\.op/);
    assert.equal(resultOf("q5").errorCode, "invalid_table");
    assert.match(String(resultOf("q5").content), /not_number at data row 1, operations\[0\]/);
    const denial = outcome.journal.ofType("tool_decision").find((event) => event.callId === "r1" && !event.allowed);
    assert.equal(denial?.code, "unreadable_path");
    const search = JSON.parse(String(resultOf("s1").content)) as { entries: unknown[]; withheld?: true };
    assert.deepEqual(search.entries, []);
    assert.equal(search.withheld, true);
  });
});

describe("U-208: the engine's argument check for query_table", () => {
  const problem = (args: JsonObject): string | null => {
    const found = workflowToolArgsProblem("query_table", args);
    return found === null ? null : argsProblemText(found);
  };
  const operation = { op: "count", column: "a" };

  test("describe alone, or 1 to 8 operations over up to 2 group columns", () => {
    assert.equal(problem({ path: "t.csv", describe: true }), null);
    assert.equal(problem({ path: "t.csv", format: "tsv", groupBy: ["a", "b"], operations: Array.from({ length: 8 }, () => operation), after: "g200" }), null);
    // A name given twice is told by the table's reading (duplicate_column), not here.
    assert.equal(problem({ path: "t.csv", groupBy: ["a", "a"], operations: [operation] }), null);
  });

  test("each wrong shape names its field", () => {
    const cases: readonly [JsonObject, string][] = [
      [{ path: "t.csv" }, "operations"],
      [{ path: "t.csv", operations: [] }, "operations"],
      [{ path: "t.csv", operations: Array.from({ length: 9 }, () => operation) }, "operations"],
      [{ path: "t.csv", groupBy: ["a", "b", "c"], operations: [operation] }, "groupBy"],
      [{ path: "t.csv", groupBy: [""], operations: [operation] }, "groupBy"],
      [{ path: "t.csv", describe: true, operations: [operation] }, "describe"],
      [{ path: "t.csv", describe: "yes" }, "describe"],
      [{ path: "t.csv", format: "xlsx", operations: [operation] }, "format"],
      [{ path: "t.csv", operations: [{ op: "median", column: "a" }] }, "operations[0].op"],
      [{ path: "t.csv", operations: [{ op: "sum", column: "a", where: "x" }] }, "operations[0]"],
      [{ path: "t.csv", operations: [operation], after: "" }, "after"],
      [{ path: "t.csv", operations: [operation], limit: 3 }, "unknown field"],
      [{ operations: [operation] }, "path"],
    ];
    for (const [args, field] of cases) {
      const text = problem(args);
      assert.ok(text !== null && text.startsWith(`invalid arguments: ${field}`), `${JSON.stringify(args)}: ${text}`);
    }
  });
});
