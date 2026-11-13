/**
 * U-236 (bundle A; U-208 query_table, U-203 unreadable paths, U-232 the canary harness; DR-70): a
 * private data run assembled as the CLI assembles one (src/cli/assemble.ts: the workspace, its lock,
 * the run's recorders writing the journal and result.json on disk, the privacy gateway, the policy
 * gate, the tool and verifier runners, the scripted provider), with the run's unreadable paths and k
 * given to the gate and the tool runner, which the CLI's parsers do not do yet (A-6, U-210). When
 * U-210 comes, the same script runs through the real CLI.
 *
 * The workspace is the harness's (tests/fixtures/private-tables.ts): three tables (CSV, TSV, JSON
 * Lines) and other files under `data/<a marker>`, the unreadable folder, whose own name is a marker
 * too. The scripted model asks query_table of each table (describe, the whole table, by region, by
 * team, by both; count, sum and mean, also over the sparse bonus column), a refused min and a text
 * column summed, and every general read tool on the folder and around it (read_file, search_files
 * by name, by text and from the parent, inspect_files, write_file). Then:
 * - nothing that went to the model and nothing recorded holds a marker from a row or a key of a
 *   group of fewer than k rows, and no tool result holds a row's amount or bonus or an aggregate into
 *   which fewer than k cells went;
 * - the general read tools give out neither the folder's name nor a name under it (the tables', the
 *   marked file's and folder's);
 * - what DR-70 allows does reach the model (the positive control): every shown group, its count, sum
 *   and mean exactly as the fixture's oracle computes them, values of fewer than k cells null and
 *   their indexes in `fewCells`, the keys of groups of at least k rows and the column names;
 * - the people who read the run (`report`, `report --json`, `runs` of the real CLI) see no row and no
 *   small key either.
 * The same for k = 5 (the default) and k = 6 (a run that raised it: the 5-row groups hide too).
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { createRunId } from "../../src/cli/run-id.js";
import { DEFAULT_MAX_REPAIR_ATTEMPTS, DEFAULT_MAX_SAME_FAILURES } from "../../src/contracts/index.js";
import type { EngineDeps, EngineResult, JournalRecord, JsonObject, QueryOperation, ResolvedTaskSpec, ScriptStep } from "../../src/contracts/index.js";
import { runTask } from "../../src/engine/index.js";
import { createScriptedProvider } from "../../src/model/index.js";
import { createPolicyGate } from "../../src/policy/index.js";
import { createPrivacyGateway } from "../../src/privacy/index.js";
import { acquireLock, createRunRecorders, releaseLock, writeResult } from "../../src/store/index.js";
import { createCommandRunner, createToolRunner } from "../../src/tools/index.js";
import { createVerifierRunner } from "../../src/verify/index.js";
import { createWorkspace } from "../../src/workspace/index.js";
import { createSandbox, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { sha256Of, textStep, toolStep } from "../fixtures/general-tasks.js";
import { GROUP_COLUMNS, PRIVATE_COLUMNS, groupsOf, numberFactsOf, writePrivateWorkspace } from "../fixtures/private-tables.js";
import type { GroupColumn, PrivateCanary, PrivateTableFile } from "../fixtures/private-tables.js";
import { cliEnv } from "../support/cli.js";
import { runGuarded } from "../support/fake-anthropic.js";
import { canarySources, describeFindings, factsAmong, findCanary, foundIn, leaksOf, numbersIn, recordedToolResults } from "../support/private-canary.js";

const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false } as const;
/** Count, sum and mean of amount and of the sparse bonus, and a count of a text column. */
const OPERATIONS: readonly QueryOperation[] = [
  { op: "count", column: "person" },
  { op: "sum", column: "amount" },
  { op: "mean", column: "amount" },
  { op: "sum", column: "bonus" },
  { op: "mean", column: "bonus" },
  { op: "count", column: "bonus" },
];
const QUERIES: readonly (readonly GroupColumn[])[] = [[], ["region"], ["team"], ["region", "team"]];
const QUERY_IDS = ["all", "region", "team", "both"] as const;

interface Plan {
  readonly steps: ScriptStep[];
  /** Call id → what it is. */
  readonly calls: Map<string, string>;
  readonly csvBytes: string;
}

/** The scripted model's calls (see the module's note), one per turn, then its answer. */
function planOf(sb: Sandbox, canary: PrivateCanary): Plan {
  const steps: ScriptStep[] = [];
  const calls = new Map<string, string>();
  const add = (id: string, name: string, args: JsonObject, what: string): void => {
    steps.push(toolStep(name, args, id));
    calls.set(id, what);
  };
  for (const [index, file] of canary.tables.entries()) {
    add(`d${index}`, "query_table", { path: file.path, describe: true }, `${file.format} describe`);
    for (const [q, groupBy] of QUERIES.entries()) {
      add(`${QUERY_IDS[q]}${index}`, "query_table", { path: file.path, groupBy: [...groupBy], operations: OPERATIONS.map((operation) => ({ ...operation })) }, `${file.format} by [${groupBy.join(", ")}]`);
    }
  }
  const csv = canary.tables[0] as PrivateTableFile;
  add("min", "query_table", { path: csv.path, groupBy: ["region"], operations: [{ op: "min", column: "amount" }] }, "min refused");
  add("textsum", "query_table", { path: csv.path, operations: [{ op: "sum", column: "person" }] }, "a text column summed");
  const [dirName, fileName] = canary.nameMarkers as [string, string];
  add("read-table", "read_file", { path: csv.path }, "read_file of a table");
  add("read-named", "read_file", { path: `${canary.dir}/${fileName}.txt` }, "read_file of the marked file");
  add("read-public", "read_file", { path: "public/guide.md" }, "read_file outside");
  add("list-root", "search_files", { path: "." }, "search_files from the root");
  add("list-name", "search_files", { path: ".", nameContains: "people" }, "search_files by a table's name");
  add("list-text", "search_files", { path: ".", text: "10" }, "search_files for digits in every row");
  add("list-parent", "search_files", { path: "data" }, "search_files from the parent");
  add("list-dir", "search_files", { path: canary.dir }, "search_files in the folder");
  add("inspect-root", "inspect_files", { path: "." }, "inspect_files from the root");
  add("inspect-parent", "inspect_files", { path: "data" }, "inspect_files from the parent");
  add("inspect-dir", "inspect_files", { path: canary.dir }, "inspect_files in the folder");
  const csvBytes = readFileSync(path.join(sb.workspace, ...csv.path.split("/")), "utf8");
  add("write-table", "write_file", { path: csv.path, expectedHash: sha256Of(csvBytes), change: { kind: "replace_all", content: "person\n" } }, "write_file over a table");
  assert.ok(dirName.length > 0);
  steps.push(textStep("done"));
  return { steps, calls, csvBytes };
}

/** One run assembled as assembleRun does, with the unreadable paths and k given to the gate and the tools. */
async function assembledRun(sb: Sandbox, steps: readonly ScriptStep[], unreadablePaths: readonly string[], minGroupSize: number): Promise<EngineResult> {
  const workspace = await createWorkspace({ root: sb.workspace });
  const workspaceRoot = workspace.root;
  const clock = { now: (): number => Date.now() };
  const runId = createRunId(new Date(), randomBytes);
  const lock = await acquireLock({ workspaceRoot, runId, clock });
  assert.ok(lock.ok, "the workspace lock");
  const task: ResolvedTaskSpec = {
    schemaVersion: 1,
    id: "u236-private-query",
    goal: "Report the totals of the people tables by region and by team.",
    workflow: "analyze",
    workspaceRoot,
    model: { provider: "scripted", scriptPath: sb.scriptPath },
    policy: POLICY,
    privacy: { secretEnv: [] },
    verifiers: [{ id: "guide", kind: "file_rules", rules: [{ type: "exists", path: "public/guide.md" }] }],
    limits: { maxModelTurns: 40, maxToolCalls: 40, maxTotalTokens: null, maxDurationMs: 120_000, maxRepairAttempts: DEFAULT_MAX_REPAIR_ATTEMPTS, maxSameFailures: DEFAULT_MAX_SAME_FAILURES },
    tools: ["read_file", "search_files", "inspect_files", "query_table", "write_file"],
    plan: "none",
    completion: "verifiers",
    unreadablePaths,
    minGroupSize,
  };
  let result: EngineResult | null = null;
  try {
    const privacy = createPrivacyGateway({ secrets: [] });
    const commandRunner = createCommandRunner({ workspaceRoot });
    const recorders = createRunRecorders({ workspaceRoot, runId, clock });
    const deps: EngineDeps = {
      task,
      runId,
      model: createScriptedProvider({ schemaVersion: 1, steps }),
      privacy,
      policy: createPolicyGate({ config: task.policy, workspace, unreadablePaths }),
      tools: createToolRunner({ workspace, privacy, commandRunner, changeRecorder: recorders.changeRecorder, planRecorder: recorders.planRecorder, unreadablePaths, minGroupSize }),
      verifiers: createVerifierRunner({ workspace, commandRunner }),
      journal: recorders.journal,
      clock,
      signal: new AbortController().signal,
      stateGuard: recorders.stateGuard,
    };
    result = await runTask(deps);
    return result;
  } finally {
    if (result !== null) await writeResult(workspaceRoot, result);
    await releaseLock({ workspaceRoot, runId });
  }
}

function journalOf(sb: Sandbox, runId: string): JournalRecord[] {
  return readFileSync(path.join(sb.workspace, ".codaryn", "runs", runId, "journal.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JournalRecord);
}

interface ShownGroup {
  readonly keys: readonly string[];
  readonly rows: number;
  readonly values: readonly (number | null)[];
  readonly fewCells?: readonly number[];
}

/** The groups a query of OPERATIONS by `groupBy` must give with k: the oracle's, values of fewer than k cells null. */
function expectedGroups(file: PrivateTableFile, groupBy: readonly GroupColumn[], k: number): { groups: ShownGroup[]; suppressedGroups: number } {
  const all = groupsOf(file.table, groupBy);
  const shown = all.filter((group) => group.rows >= k);
  return {
    suppressedGroups: all.length - shown.length,
    groups: shown.map((group) => {
      // count person: every row has one; the others are over amount or bonus.
      const cells = [group.rows, group.cells.amount, group.cells.amount, group.cells.bonus, group.cells.bonus, group.cells.bonus];
      const raw = [group.rows, group.sum.amount, group.sum.amount / group.cells.amount, group.sum.bonus, group.cells.bonus === 0 ? null : group.sum.bonus / group.cells.bonus, group.cells.bonus];
      const few = cells.flatMap((count, index) => (count < k ? [index] : []));
      return { keys: group.keys, rows: group.rows, values: raw.map((value, index) => (few.includes(index) ? null : value)), fewCells: few };
    }),
  };
}

const near = (a: number | null, b: number | null): boolean => (a === null || b === null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)));

async function privateRun(t: TestContext, k: number): Promise<void> {
  const sb = createSandbox(t);
  const canary = writePrivateWorkspace(sb, { markedDirUnder: "data", k });
  writeWorkspaceFile(sb, "data/readme.md", "# data\n\nThe people tables are in the folder next to this file.\n");
  const plan = planOf(sb, canary);
  const result = await assembledRun(sb, plan.steps, [canary.dir], k);
  // Every call was made, one per turn; the five refused (below) are not counted as tool calls.
  assert.deepEqual([result.status, result.reason, result.usage.modelTurns, result.usage.toolCalls], ["done", "verified", plan.calls.size + 1, plan.calls.size - 5], JSON.stringify(result.notices));
  const records = journalOf(sb, result.runId);
  const results = recordedToolResults(sb.workspace);
  const resultOf = (id: string) => {
    const found = results.find((one) => one.callId === id);
    assert.ok(found !== undefined, `a result for ${id} (${plan.calls.get(id)})`);
    return found;
  };

  // The refusals: every general read tool on the folder, and the write.
  const denied = records.flatMap((record) => (record.type === "tool_decision" && !record.allowed ? [`${record.callId}:${record.code ?? "?"}`] : []));
  assert.deepEqual(denied.sort(), ["inspect-dir:unreadable_path", "list-dir:unreadable_path", "read-named:unreadable_path", "read-table:unreadable_path", "write-table:unreadable_path"].sort());
  assert.equal(readFileSync(path.join(sb.workspace, ...(canary.tables[0] as PrivateTableFile).path.split("/")), "utf8"), plan.csvBytes, "the table is as it was");
  assert.equal(resultOf("min").errorCode, "invalid_table");
  assert.match(resultOf("min").content, /op_not_allowed/);
  // U-277 (Codex V-28b): a table under unreadable paths has no not_number; a column of text summed
  // is null in fewCells, as an empty column is.
  assert.equal(resultOf("textsum").ok, true, resultOf("textsum").content);
  assert.deepEqual((resultOf("textsum").payload as { groups: { values: unknown[]; fewCells?: number[] }[] }).groups.map((group) => [group.values, group.fewCells]), [[[null], [0]]]);

  // 1. No row and no small key in what went to the model, nor in the records.
  const sources = canarySources({ workspace: sb.workspace, scripted: true });
  const leaks = leaksOf(findCanary(sources, { row: canary.rowMarkers, small_key: canary.smallKeys }, { fragments: 8 }));
  assert.deepEqual(leaks, [], describeFindings(leaks));

  // 2. The general read tools give out no name: the folder's, the tables', the marked file's and folder's.
  const listings = results.filter((one) => one.tool !== "query_table");
  assert.equal(listings.length, 12);
  for (const one of listings) {
    for (const name of [...canary.nameMarkers, "people."]) assert.ok(!one.content.includes(name), `${one.callId} (${plan.calls.get(one.callId)}) gives ${name}: ${one.content.slice(0, 300)}`);
  }
  const named = findCanary(sources.filter((source) => source.channel === "model"), { name: canary.nameMarkers });
  assert.deepEqual(named, [], describeFindings(named));
  for (const id of ["list-root", "list-parent"]) {
    const payload = resultOf(id).payload as { entries: { path: string }[]; withheld?: boolean };
    assert.equal(payload.withheld, true, `${id} says something was left out`);
    assert.ok(payload.entries.some((entry) => entry.path === "data/readme.md"), `${id} lists the folder's neighbour`);
  }
  assert.deepEqual((resultOf("list-name").payload as { entries: unknown[] }).entries, []);
  assert.ok(!(resultOf("list-text").payload as { entries: { path: string }[] }).entries.some((entry) => entry.path.startsWith("data/")), "no line of a table is found by text");

  // 3. No row's amount or bonus and no aggregate of fewer than k cells in any tool result.
  const numbers = results.flatMap((one) => numbersIn(one.payload));
  for (const file of canary.tables) {
    const facts = numberFactsOf(file.table, QUERIES, k);
    const clash = factsAmong(facts.allowed.map((fact) => fact.value), facts.forbidden);
    assert.deepEqual(clash, [], "no allowed value equals a forbidden one (else the check below means nothing)");
    const forbidden = factsAmong(numbers, facts.forbidden);
    assert.deepEqual(forbidden, [], `${file.format}: ${forbidden.map((fact) => fact.label).join("; ")}`);
    const allowedSeen = factsAmong(numbers, facts.allowed);
    assert.deepEqual(allowedSeen.map((fact) => fact.label), facts.allowed.map((fact) => fact.label), `${file.format}: every allowed value is given`);
  }

  // 4. The positive control in full: every query's groups as the oracle has them.
  for (const [index, file] of canary.tables.entries()) {
    for (const [q, groupBy] of QUERIES.entries()) {
      const id = `${QUERY_IDS[q]}${index}`;
      const payload = resultOf(id).payload as { kind: string; groups: ShownGroup[]; suppressedGroups: number; minGroupSize: number };
      const expected = expectedGroups(file, groupBy, k);
      const label = `${file.format} by [${groupBy.join(", ")}], k ${k}`;
      assert.deepEqual([payload.kind, payload.minGroupSize, payload.suppressedGroups], ["groups", k, expected.suppressedGroups], label);
      assert.deepEqual(payload.groups.map((group) => [group.keys, group.rows, [...(group.fewCells ?? [])]]), expected.groups.map((group) => [group.keys, group.rows, group.fewCells]), label);
      for (const [g, group] of payload.groups.entries()) {
        const want = expected.groups[g] as ShownGroup;
        assert.ok(group.values.every((value, v) => near(value, want.values[v] ?? null)), `${label} group ${g}: ${JSON.stringify(group.values)} against ${JSON.stringify(want.values)}`);
      }
    }
    const shape = resultOf(`d${index}`).payload as { kind: string; rows: number | null; columns: { name: string }[] };
    assert.deepEqual([shape.kind, shape.rows, shape.columns.map((column) => column.name)], ["describe", 16, [...PRIVATE_COLUMNS]]);
  }
  const model = sources.filter((source) => source.channel === "model");
  assert.deepEqual(foundIn(findCanary(model, { large_key: canary.largeKeys }), "model", canary.largeKeys), canary.largeKeys, "the keys of groups of at least k rows reach the model");
  for (const column of PRIVATE_COLUMNS) assert.ok(model.some((source) => source.text.includes(column)), column);
  assert.ok(GROUP_COLUMNS.length === 2);

  // 5. What a person reads of the run holds no row and no small key either.
  const env = cliEnv();
  const runs = {
    report: await runGuarded(sb, ["report", "--workspace", sb.workspace, "--run", result.runId], env),
    reportJson: await runGuarded(sb, ["report", "--workspace", sb.workspace, "--run", result.runId, "--json"], env),
    runs: await runGuarded(sb, ["runs", "--workspace", sb.workspace], env),
  };
  for (const [name, run] of Object.entries(runs)) assert.equal(run.exitCode, 0, `${name}: ${run.stderr}`);
  assert.ok(runs.report.stdout.includes(result.runId), "the report is the run's");
  const shown = leaksOf(findCanary(canarySources({ workspace: sb.workspace, runs }).filter((source) => source.channel === "output"), { row: canary.rowMarkers, small_key: canary.smallKeys }));
  assert.deepEqual(shown, [], describeFindings(shown));
}

test("U-236: a private data run with query_table, assembled as the CLI does (k 5) - no row, no small key, no value of fewer than k cells, no name; what DR-70 allows arrives exactly", { timeout: 120_000 }, async (t) => {
  await privateRun(t, 5);
});

test("U-236: the same with k 6 raised by the run - the 5-row groups and values of 5 cells hide too", { timeout: 120_000 }, async (t) => {
  await privateRun(t, 6);
});
