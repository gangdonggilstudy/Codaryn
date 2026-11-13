/**
 * U-210 (P1 bundle A, A-6; proposal 3.1 "how the guarantee is tested", DR-70): an analyze-private run
 * on the real CLI over ne-verify's canary workspace (U-232: tests/fixtures/private-tables.ts, every
 * cell of three tables (CSV, TSV, JSON Lines) a marker of its row, group keys markers too, a notes
 * file with a marker on every line, a file and a folder whose names are markers) and found with its
 * harness (tests/support/private-canary.ts) in what went to the model, every record and the human
 * output.
 * The run reads each table and the notes (refused), searches the workspace by text and by name (the
 * private lines and names left out) and from inside the private folder (refused), and asks each table
 * for its shape and for groups by region, by team and by both, then an operation an unreadable table
 * does not allow, and writes a report outside the folder.
 * - Nothing of a row, no name under the folder and no key of a group of fewer than k rows (k 5) is
 *   anywhere: leaksOf(findCanary(...)) is empty, with the scripted model (the journals' model_request
 *   records) and with a fake Anthropic API on 127.0.0.1 (each request's body, the model's own turns
 *   left out).
 * - The positive control: every key of a group of at least k rows grouped by one column reached the
 *   model, so the harness looked where the values would be.
 * - The human output tells the refusals and the results that left groups out.
 * Fake values only; no network but the fake server's loopback address.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { JournalRecord, JsonObject } from "../../../src/contracts/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { replyText, replyTools, runGuarded, startFakeAnthropic, toolUse } from "../../support/fake-anthropic.js";
import type { FakeBlock } from "../../support/fake-anthropic.js";
import { canarySources, describeFindings, findCanary, foundIn, leaksOf } from "../../support/private-canary.js";
import { ANTHROPIC_LIMITS, FAKE_MODEL_TASK, fakeApiConfig, writeAnthropicTask, writeConfigFile } from "../../fixtures/anthropic.js";
import { createSandbox } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { ZERO_USAGE, createFileArgs, textStep, writeGeneralTask } from "../../fixtures/general-tasks.js";
import { writePrivateWorkspace } from "../../fixtures/private-tables.js";
import type { PrivateCanary } from "../../fixtures/private-tables.js";
import { FAKE_API_KEY } from "../../fixtures/secrets.js";

const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
const LIMITS = { maxModelTurns: 12, maxToolCalls: 40, maxDurationMs: 120_000 };
const REPORT = "# Report\n\nTotals by group only.\n";

interface Call {
  readonly name: string;
  readonly args: JsonObject;
}

/** The run's turns: each a list of tool calls (no marker in any argument, so the model's own turns hold none). */
function turnsFor(canary: PrivateCanary): Call[][] {
  const tables = canary.tables.map((file) => file.path);
  const perTable = (table: string): Call[] => [
    { name: "read_file", args: { path: table } },
    { name: "query_table", args: { path: table, describe: true } },
    { name: "query_table", args: { path: table, groupBy: ["region"], operations: [{ op: "count", column: "amount" }, { op: "sum", column: "amount" }, { op: "mean", column: "age" }] } },
    { name: "query_table", args: { path: table, groupBy: ["team"], operations: [{ op: "count", column: "amount" }] } },
    { name: "query_table", args: { path: table, groupBy: ["region", "team"], operations: [{ op: "sum", column: "age" }] } },
  ];
  return [
    [
      { name: "read_file", args: { path: `${canary.dir}/notes.txt` } },
      { name: "search_files", args: { path: ".", text: "note" } },
      { name: "search_files", args: { path: ".", nameContains: "." } },
      { name: "search_files", args: { path: canary.dir } },
    ],
    ...tables.map(perTable),
    [{ name: "query_table", args: { path: tables[0] ?? "", operations: [{ op: "min", column: "amount" }] } }],
    [{ name: "write_file", args: createFileArgs("public/report.md", REPORT) }],
  ];
}

const json = (run: CliRun): Record<string, unknown> => JSON.parse(run.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;

function journalOf(sb: Sandbox, runId: string): JournalRecord[] {
  const text = readFileSync(path.join(sb.workspace, ".codaryn", "runs", runId, "journal.jsonl"), "utf8");
  return text.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as JournalRecord);
}

/** The refusals the run must have made: each private read and the search from inside the folder. */
function assertRefusals(records: readonly JournalRecord[], canary: PrivateCanary): void {
  const denied = records.flatMap((record) => (record.type === "tool_decision" && !record.allowed ? [`${record.tool}:${record.code}`] : []));
  assert.deepEqual(denied, ["read_file:unreadable_path", "search_files:unreadable_path", ...canary.tables.map(() => "read_file:unreadable_path")]);
  const searches = records.flatMap((record) =>
    record.type === "tool_result" && record.result.tool === "search_files" && record.result.ok ? [JSON.parse(String(record.result.content)) as { entries: { path: string }[]; withheld?: boolean }] : [],
  );
  assert.equal(searches.length, 2);
  for (const found of searches) {
    assert.equal(found.withheld, true, "the private lines or names were left out");
    assert.ok(found.entries.every((entry) => !entry.path.startsWith(`${canary.dir}/`)), JSON.stringify(found.entries));
  }
}

/** No leak anywhere, and every key a single-column query shows reached the model (the positive control). */
function assertNoLeak(sources: Parameters<typeof findCanary>[0], canary: PrivateCanary): void {
  const findings = findCanary(sources, canary);
  const leaks = leaksOf(findings);
  assert.deepEqual(leaks, [], describeFindings(leaks));
  assert.deepEqual(foundIn(findings, "model", canary.largeKeys), [...canary.largeKeys], "every key of a group of at least k rows went to the model");
}

describe("U-210 canary: an analyze-private run keeps every row, name and small group's key from the model", () => {
  test("scripted model: nothing of a row, a name or a small group's key in a model request, a record, a result or the output", { timeout: 120_000 }, async (t) => {
    const sb = createSandbox(t);
    const canary = writePrivateWorkspace(sb);
    const steps = [...turnsFor(canary).map((calls) => ({ toolCalls: calls.map((call) => ({ name: call.name, args: call.args })), usage: ZERO_USAGE })), textStep("done")];
    const task = writeGeneralTask(sb, { id: "u210-canary", goal: "report totals by group", fields: { workflowRef: "analyze-private" }, policy: { unreadablePaths: [canary.dir] }, limits: LIMITS }, steps);
    const ran = await runGuarded(sb, ["run", "--task", task], cliEnv(), 120_000);
    const output = json(ran);
    assert.deepEqual([output["status"], output["reason"]], ["needs-input", "awaiting_review"], ran.stdout);
    assertRefusals(journalOf(sb, String(output["runId"])), canary);
    assertNoLeak(canarySources({ workspace: sb.workspace, runs: { run: ran }, scripted: true }), canary);
    assert.equal(readFileSync(path.join(sb.workspace, "public", "report.md"), "utf8"), REPORT);
    const en = createMessageCatalog("en");
    assert.ok(ran.stderr.includes(en.format("summary.denied_unreadable", { count: 2 + canary.tables.length })), ran.stderr);
    // Each table's three group queries leave groups of fewer than 5 rows out.
    assert.ok(ran.stderr.includes(en.format("summary.groups_hidden", { results: 3 * canary.tables.length, k: 5 })), ran.stderr);
  });

  test("fake Anthropic API on 127.0.0.1: nothing of a row, a name or a small group's key in what was sent", { timeout: 120_000 }, async (t) => {
    const sb = createSandbox(t);
    const canary = writePrivateWorkspace(sb);
    let id = 0;
    const replies = [
      ...turnsFor(canary).map((calls) => replyTools(calls.map((call): FakeBlock => toolUse(`t${(id += 1)}`, call.name, call.args)))),
      replyText("done"),
    ];
    const api = await startFakeAnthropic(t, replies);
    const limits = { ...ANTHROPIC_LIMITS, ...LIMITS };
    const config = writeConfigFile(sb, fakeApiConfig(api.url, { limits } as object), "c.json");
    const task = writeAnthropicTask(sb, {
      id: "u210-canary-api",
      goal: "report totals by group",
      model: FAKE_MODEL_TASK,
      limits,
      extraTop: { workflowRef: "analyze-private", policy: { ...POLICY, unreadablePaths: [canary.dir] } },
    });
    const ran = await runGuarded(sb, ["run", "--task", task, "--config", config], cliEnv({ fakeApiKey: FAKE_API_KEY }), 120_000);
    const output = json(ran);
    assert.deepEqual([output["status"], output["reason"]], ["needs-input", "awaiting_review"], ran.stdout);
    assert.equal(api.requests.length, replies.length);
    assertRefusals(journalOf(sb, String(output["runId"])), canary);
    assertNoLeak(canarySources({ workspace: sb.workspace, runs: { run: ran }, anthropic: api }), canary);
  });
});
