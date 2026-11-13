/**
 * U-245 (bundle A on the real CLI, U-210; n17 carried over; review R-108 H-1): private data runs
 * through `node dist/src/cli/main.js` over the canary harness (tests/fixtures/private-tables.ts,
 * tests/support/private-canary.ts), where U-210's own tests (tests/unit/cli/g-u210-*) do not go: the
 * places that give unreadable paths mixed in one run, and every path from end to end.
 * - Each place alone: the config file (scripted model, a task file), a profile (fake Anthropic on
 *   127.0.0.1, the quick form), a task type definition in the config (scripted model; analyze-private
 *   itself has no policy, so a definition like it) and the task file (fake OpenAI on 127.0.0.1).
 *   query_table by region, by team and by both over two tables (count, sum and mean, the sparse bonus
 *   column too), and every general read tool on the folder and around it.
 * - The four places at once in one run, each with its own folder, with k left to its default and with
 *   k raised to 6 by a profile and to 7 by the definition (the largest holds).
 * - Then: no marker from a row and no key of a group of fewer than k rows in what went to the model,
 *   in any record, in stdout, stderr, `report` or `report --json`; no number in a tool result that is
 *   a row's own or an aggregate of fewer than k cells; no name of the folders or under them from a
 *   general read tool or anywhere sent to the model; what DR-70 allows arrives exactly as the oracle
 *   has it (the positive control); the end summary counts the refusals and the results that hid.
 * - Refused before the run, nothing recorded: unreadable paths from any place beside a command rule
 *   or a command verifier from any place (both task forms), and k below 5 in any place (also beside
 *   a larger k elsewhere).
 * - A plan run and the run that carries it out (plan "run") under a profile's and a definition's
 *   folders: the carried-out run's gate has the run's list (R-108 H-1), its reads are refused and its
 *   query_table hides small groups; and a planned file that an unreadable entry covers after the
 *   approval stops the carrying run before any model request (plan_stale).
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { CODARYN_OPENAI_API_BASE_URL_ENV } from "../../src/contracts/index.js";
import type { JournalRecord, JsonObject, ScriptStep } from "../../src/contracts/index.js";
import { createMessageCatalog } from "../../src/i18n/index.js";
import { ANTHROPIC_LIMITS, FAKE_MODEL_CONFIG, fakeApiConfig, writeConfigFile } from "../fixtures/anthropic.js";
import { createSandbox, nodeCommand } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { ZERO_USAGE, createFileArgs, replaceTextArgs, textStep, writeGeneralTask } from "../fixtures/general-tasks.js";
import { FAKE_OPENAI_MODEL_TASK, OPENAI_LIMITS } from "../fixtures/openai.js";
import { expectedGroupsOf, numberFactsOf, writePrivateWorkspace } from "../fixtures/private-tables.js";
import type { GroupColumn, OracleOperation, PrivateCanary, PrivateTableFile } from "../fixtures/private-tables.js";
import { FAKE_API_KEY, FAKE_OPENAI_KEY } from "../fixtures/secrets.js";
import { cliEnv } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { MOCK_LABEL, replyText, replyTools, runGuarded, startFakeAnthropic, toolUse } from "../support/fake-anthropic.js";
import type { FakeAnthropic } from "../support/fake-anthropic.js";
import { fnCall, replyCalls, replyFinal, startFakeOpenAI } from "../support/fake-openai.js";
import type { FakeOpenAI } from "../support/fake-openai.js";
import { canarySources, describeFindings, factsAmong, findCanary, foundIn, leaksOf, numbersIn, recordedToolResults } from "../support/private-canary.js";

const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
const LIMITS = { maxModelTurns: 12, maxToolCalls: 40, maxDurationMs: 120_000 };
const PRIVATE = "analyze-private";
/** A definition like analyze-private (its tools, a person's review, no command) that can hold a policy. */
const privateLike = (policy: JsonObject): JsonObject => ({
  tools: ["read_file", "search_files", "query_table", "write_file"],
  instructions: "The input tables are not readable. Use query_table for every number.",
  completion: "human_review",
  humanReview: { checklist: ["No value identifies a person."] },
  allowCommands: false,
  policy: { ...POLICY, ...policy },
});
const OPERATIONS: readonly OracleOperation[] = [
  { op: "count", column: "person" },
  { op: "sum", column: "amount" },
  { op: "mean", column: "amount" },
  { op: "sum", column: "bonus" },
  { op: "mean", column: "bonus" },
  { op: "count", column: "bonus" },
];
const QUERIES: readonly (readonly GroupColumn[])[] = [["region"], ["team"], ["region", "team"]];
const REPORT = "# Report\n\nTotals by group only.\n";

interface Call {
  readonly id: string;
  readonly name: string;
  readonly args: JsonObject;
}
type Turn = readonly Call[];

/** query_table by each of QUERIES over the given tables, one turn per table. */
function queryTurns(tag: string, files: readonly PrivateTableFile[]): Turn[] {
  return files.map((file, t) =>
    QUERIES.map((groupBy, q) => ({ id: `${tag}q${t}${q}`, name: "query_table", args: { path: file.path, groupBy: [...groupBy], operations: OPERATIONS.map((operation) => ({ ...operation })) } })),
  );
}

/** Every general read tool on the folder (refused) and around it. */
function readTurn(tag: string, canary: PrivateCanary): Turn {
  const table = (canary.tables[0] as PrivateTableFile).path;
  return [
    { id: `${tag}r1`, name: "read_file", args: { path: table } },
    { id: `${tag}r2`, name: "search_files", args: { path: canary.dir } },
    { id: `${tag}s1`, name: "search_files", args: { path: ".", text: "10" } },
    { id: `${tag}s2`, name: "search_files", args: { path: ".", nameContains: "people" } },
    { id: `${tag}s3`, name: "search_files", args: { path: "data" } },
  ];
}

const writeTurn: Turn = [{ id: "w1", name: "write_file", args: createFileArgs("out/report.md", REPORT) }];

const scripted = (turns: readonly Turn[]): ScriptStep[] => [...turns.map((turn) => ({ toolCalls: turn.map((call) => ({ ...call })), usage: ZERO_USAGE })), textStep("done")];
const anthropicReplies = (turns: readonly Turn[]) => [...turns.map((turn) => replyTools(turn.map((call) => toolUse(`toolu_${call.id}`, call.name, call.args)))), replyText("done")];
const openAIReplies = (turns: readonly Turn[]) => [...turns.map((turn) => replyCalls(turn.map((call) => fnCall(`call_${call.id}`, call.name, call.args)))), replyFinal("done")];

interface Output {
  readonly kind: string;
  readonly runId?: string;
  readonly status?: string;
  readonly reason?: string;
  readonly code?: string;
  readonly message?: string;
  readonly plan?: { readonly digest: string };
  readonly notices?: readonly string[];
  readonly usage?: { readonly modelTurns: number };
}
const outputOf = (run: CliRun): Output => JSON.parse(run.stdout.trim().split("\n").pop() ?? "{}") as Output;

function journalOf(sb: Sandbox, runId: string): JournalRecord[] {
  return readFileSync(path.join(sb.workspace, ".codaryn", "runs", runId, "journal.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JournalRecord);
}

/** "<callId>:<code>" of every refused call of the run. */
const refusedOf = (sb: Sandbox, runId: string): string[] =>
  journalOf(sb, runId).flatMap((record) => (record.type === "tool_decision" && !record.allowed ? [`${record.callId}:${record.code ?? "?"}`] : [])).sort();

interface Checked {
  readonly sb: Sandbox;
  readonly canaries: readonly PrivateCanary[];
  /** The tables queried with QUERIES, by their call tags' order (each table once). */
  readonly queried: readonly { readonly tag: string; readonly files: readonly PrivateTableFile[] }[];
  readonly k: number;
  readonly runs: Readonly<Record<string, CliRun>>;
  readonly anthropic?: FakeAnthropic;
  readonly openai?: FakeOpenAI;
  readonly scripted?: boolean;
}

/**
 * The checks every private run here passes (see the module's note): leaks, names, numbers, the
 * oracle, and the positive control. Adds `report` and `report --json` of each run id given.
 */
async function checkPrivate(c: Checked, runIds: readonly string[]): Promise<void> {
  const env = cliEnv();
  const runs: Record<string, CliRun> = { ...c.runs };
  for (const runId of runIds) {
    const report = await runGuarded(c.sb, ["report", "--workspace", c.sb.workspace, "--run", runId], env);
    assert.equal(report.exitCode, 0, report.stderr);
    runs[`report ${runId}`] = report;
    runs[`report --json ${runId}`] = await runGuarded(c.sb, ["report", "--workspace", c.sb.workspace, "--run", runId, "--json"], env);
  }
  const sources = canarySources({ workspace: c.sb.workspace, runs, ...(c.anthropic === undefined ? {} : { anthropic: c.anthropic }), ...(c.openai === undefined ? {} : { openai: c.openai }), scripted: c.scripted === true });
  // 1. No row, no small key, anywhere: what was sent, the records, every output.
  const rows = c.canaries.flatMap((canary) => canary.rowMarkers);
  const smallKeys = c.canaries.flatMap((canary) => canary.smallKeys);
  const leaks = leaksOf(findCanary(sources, { row: rows, small_key: smallKeys }, { fragments: 8 }));
  assert.deepEqual(leaks, [], describeFindings(leaks));
  // 2. No name of the folders or under them in what was sent, nor from a general read tool.
  const names = c.canaries.flatMap((canary) => canary.nameMarkers);
  const model = sources.filter((source) => source.channel === "model");
  const named = findCanary(model, { name: names });
  assert.deepEqual(named, [], describeFindings(named));
  const results = recordedToolResults(c.sb.workspace);
  for (const one of results.filter((result) => result.tool !== "query_table")) {
    for (const name of [...names, "people."]) assert.ok(!one.content.includes(name), `${one.callId} (${one.tool}) gives ${name}`);
  }
  // 3. No row's number and no aggregate of fewer than k cells; every allowed one given.
  const numbers = results.flatMap((result) => numbersIn(result.payload));
  for (const { files } of c.queried) {
    for (const file of files) {
      const facts = numberFactsOf(file.table, QUERIES, c.k);
      assert.deepEqual(factsAmong(facts.allowed.map((fact) => fact.value), facts.forbidden), [], "no allowed value equals a forbidden one");
      const forbidden = factsAmong(numbers, facts.forbidden);
      assert.deepEqual(forbidden, [], `${file.path}: ${forbidden.map((fact) => fact.label).join("; ")}`);
      assert.deepEqual(factsAmong(numbers, facts.allowed).map((fact) => fact.label), facts.allowed.map((fact) => fact.label), `${file.path}: every allowed value`);
    }
  }
  // 4. The oracle: every query's groups exactly.
  const byCall = new Map(results.map((result) => [result.callId.replace(/^(toolu_|call_)/, ""), result]));
  for (const { tag, files } of c.queried) {
    for (const [t, file] of files.entries()) {
      for (const [q, groupBy] of QUERIES.entries()) {
        const result = byCall.get(`${tag}q${t}${q}`);
        assert.ok(result !== undefined && result.ok, `${tag}q${t}${q}: ${result?.content.slice(0, 200)}`);
        const payload = result.payload as { minGroupSize: number; suppressedGroups: number; groups: { keys: string[]; rows: number; values: (number | null)[]; fewCells?: number[] }[] };
        const expected = expectedGroupsOf(file.table, groupBy, OPERATIONS, c.k);
        const label = `${file.path} by [${groupBy.join(", ")}], k ${c.k}`;
        assert.deepEqual([payload.minGroupSize, payload.suppressedGroups], [c.k, expected.suppressedGroups], label);
        assert.deepEqual(payload.groups.map((group) => [group.keys, group.rows, group.fewCells ?? []]), expected.groups.map((group) => [group.keys, group.rows, group.fewCells]), label);
        payload.groups.forEach((group, g) => {
          const want = expected.groups[g]?.values ?? [];
          assert.ok(group.values.every((value, v) => (value === null || want[v] === null ? value === want[v] : Math.abs(value - (want[v] as number)) <= 1e-9 * Math.max(1, Math.abs(value)))), `${label} group ${g}: ${JSON.stringify(group.values)} against ${JSON.stringify(want)}`);
        });
      }
    }
  }
  // 5. The positive control: the keys of groups of at least k rows of the queried tables reached the model.
  const shownKeys = c.queried.flatMap(({ files }) => files.flatMap((file) => (["region", "team"] as const).flatMap((column) => expectedGroupsOf(file.table, [column], OPERATIONS, c.k).groups.flatMap((group) => group.keys))));
  assert.ok(shownKeys.length > 0);
  assert.deepEqual(foundIn(findCanary(model, { large_key: shownKeys }), "model", shownKeys), shownKeys);
}

/** The end summary's two counts for bundle A, in English. */
function assertSummary(run: CliRun, refused: number, hiding: number, k: number): void {
  const catalog = createMessageCatalog("en");
  assert.ok(run.stderr.includes(catalog.format("summary.denied_unreadable", { count: refused })), `refused ${refused}:\n${run.stderr}`);
  assert.ok(run.stderr.includes(catalog.format("summary.groups_hidden", { results: hiding, k })), `hiding ${hiding}, k ${k}:\n${run.stderr}`);
}

const expectAwaitingReview = (run: CliRun): string => {
  const output = outputOf(run);
  assert.deepEqual([output.kind, output.status, output.reason, run.exitCode], ["run", "needs-input", "awaiting_review", 3], `${run.stdout}\n${run.stderr}`);
  return output.runId as string;
};

/** One table of each run is queried in full; the run's three refusals are the read, the folder's listing and none else. */
async function onePlace(t: TestContext, place: "config" | "profile" | "definition" | "task"): Promise<void> {
  const sb = createSandbox(t);
  const canary = writePrivateWorkspace(sb, { markedDirUnder: "data" });
  const files = [canary.tables[0], canary.tables[2]] as PrivateTableFile[];
  const turns: Turn[] = [...queryTurns("a", files), readTurn("a", canary), writeTurn];
  const entry = { unreadablePaths: [canary.dir] };
  let run: CliRun;
  let anthropic: FakeAnthropic | undefined;
  let openai: FakeOpenAI | undefined;
  if (place === "config") {
    const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, policy: { ...POLICY, ...entry } });
    const task = writeGeneralTask(sb, { id: "u245-config", fields: { workflowRef: PRIVATE }, limits: LIMITS }, scripted(turns));
    run = await runGuarded(sb, ["run", "--task", task, "--config", config], cliEnv());
  } else if (place === "profile") {
    anthropic = await startFakeAnthropic(t, anthropicReplies(turns));
    const config = writeConfigFile(sb, fakeApiConfig(anthropic.url, { model: FAKE_MODEL_CONFIG, limits: ANTHROPIC_LIMITS, profiles: { p: { workflowRef: PRIVATE, policy: { ...POLICY, ...entry } } } } as object));
    run = await runGuarded(sb, ["run", "--config", config, "--profile", "p", "--workspace", sb.workspace, "--goal", "Report the totals of the people tables by region and by team."], cliEnv({ fakeApiKey: FAKE_API_KEY }));
  } else if (place === "definition") {
    const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, workflows: { "private-like": privateLike(entry) } });
    const task = writeGeneralTask(sb, { id: "u245-definition", fields: { workflowRef: "private-like" }, limits: LIMITS }, scripted(turns));
    run = await runGuarded(sb, ["run", "--task", task, "--config", config], cliEnv());
  } else {
    openai = await startFakeOpenAI(t, openAIReplies(turns));
    const task = path.join(sb.base, "task.json");
    writeFileSync(
      task,
      JSON.stringify({
        schemaVersion: 1,
        id: "u245-task",
        goal: "Report the totals of the people tables by region and by team.",
        workflow: "analysis",
        workflowRef: PRIVATE,
        workspaceRoot: "./ws",
        model: { provider: "openai", model: FAKE_OPENAI_MODEL_TASK, maxOutputTokens: 512 },
        policy: { ...POLICY, ...entry },
        privacy: { secretEnv: [] },
        limits: OPENAI_LIMITS,
        verifiers: [],
      }),
    );
    run = await runGuarded(sb, ["run", "--task", task], cliEnv({ fakeOpenAiKey: FAKE_OPENAI_KEY, extra: { [CODARYN_OPENAI_API_BASE_URL_ENV]: openai.baseUrl } }));
  }
  const runId = expectAwaitingReview(run);
  const prefix = place === "profile" ? "toolu_" : place === "task" ? "call_" : "";
  assert.deepEqual(refusedOf(sb, runId), [`${prefix}ar1:unreadable_path`, `${prefix}ar2:unreadable_path`].sort());
  assert.equal(readFileSync(path.join(sb.workspace, "out", "report.md"), "utf8"), REPORT, "the report outside the folder is written");
  // Each table's three queries hid a group or a value: 6 results; two refusals.
  assertSummary(run, 2, 6, canary.k);
  await checkPrivate(
    { sb, canaries: [canary], queried: [{ tag: "a", files }], k: canary.k, runs: { run }, ...(anthropic === undefined ? {} : { anthropic }), ...(openai === undefined ? {} : { openai }), scripted: place === "config" || place === "definition" },
    [runId],
  );
}

for (const [place, how] of [
  ["config", "the config file under a task file, scripted model"],
  ["profile", `a profile in the quick form, ${MOCK_LABEL} fake Anthropic`],
  ["definition", "a task type definition in the config, scripted model"],
  ["task", `the task file, ${MOCK_LABEL} fake OpenAI`],
] as const) {
  test(`U-245: unreadable paths in ${how} - no row, no small key, no value of fewer than k cells, no name; what DR-70 allows arrives exactly`, { timeout: 120_000 }, async (t) => {
    await onePlace(t, place);
  });
}

for (const [label, profileK, definitionK, k] of [
  ["k left to its default", undefined, undefined, 5],
  ["k 6 from a profile and 7 from the definition: the largest holds", 6, 7, 7],
] as const) {
  test(`U-245: the four places at once, each its own folder, ${label}`, { timeout: 120_000 }, async (t) => {
    const sb = createSandbox(t);
    const places = ["config", "profile", "definition", "task"] as const;
    const canaries = places.map((place) => writePrivateWorkspace(sb, { markedDirUnder: `data/${place}`, k }));
    const [fromConfig, fromProfile, fromDefinition, fromTask] = canaries as [PrivateCanary, PrivateCanary, PrivateCanary, PrivateCanary];
    const k6: JsonObject = profileK === undefined ? {} : { minGroupSize: profileK };
    const k7: JsonObject = definitionK === undefined ? {} : { minGroupSize: definitionK };
    const config = writeConfigFile(sb, {
      schemaVersion: 1,
      limits: LIMITS,
      policy: { ...POLICY, unreadablePaths: [fromConfig.dir] },
      profiles: { p: { policy: { ...POLICY, unreadablePaths: [fromProfile.dir], ...k6 } } },
      workflows: { "private-like": privateLike({ unreadablePaths: [fromDefinition.dir], ...k7 }) },
    });
    const tables = canaries.map((canary) => canary.tables[0] as PrivateTableFile);
    const turns: Turn[] = [
      ...tables.map((file, i) => queryTurns(`m${i}`, [file])[0] as Turn),
      canaries.map((canary, i) => ({ id: `m${i}read`, name: "read_file", args: { path: (canary.tables[1] as PrivateTableFile).path } })),
      [
        { id: "ms1", name: "search_files", args: { path: ".", text: "10" } },
        { id: "ms2", name: "search_files", args: { path: "data" } },
      ],
      writeTurn,
    ];
    const task = writeGeneralTask(sb, { id: "u245-four", fields: { workflowRef: "private-like" }, limits: LIMITS, policy: { unreadablePaths: [fromTask.dir] } }, scripted(turns));
    const run = await runGuarded(sb, ["run", "--task", task, "--config", config, "--profile", "p"], cliEnv());
    const runId = expectAwaitingReview(run);
    assert.deepEqual(refusedOf(sb, runId), [0, 1, 2, 3].map((i) => `m${i}read:unreadable_path`).sort(), "a read in each place's folder is refused");
    const search = recordedToolResults(sb.workspace).find((result) => result.callId === "ms2");
    assert.deepEqual((search?.payload as { entries: unknown[]; withheld?: boolean }).withheld, true);
    assertSummary(run, 4, 12, k);
    await checkPrivate({ sb, canaries, queried: tables.map((file, i) => ({ tag: `m${i}`, files: [file] })), k, runs: { run }, scripted: true }, [runId]);
  });
}

const COMMAND_RULE = nodeCommand("check.mjs") as unknown as JsonObject;
const COMMAND_VERIFIER = { id: "cmd", kind: "command", executable: process.execPath, args: ["--version"] };

test("U-245: unreadable paths from any place beside a command rule or a command verifier from any place are refused before the run (task file)", { timeout: 240_000 }, async (t) => {
  const entry = { unreadablePaths: ["data/private"] };
  for (const unreadable of ["config", "profile", "definition", "task"] as const) {
    for (const command of ["task rule", "task verifier", "definition rule", "definition verifier"] as const) {
      const sb = createSandbox(t);
      const config = writeConfigFile(sb, {
        schemaVersion: 1,
        limits: LIMITS,
        policy: { ...POLICY, ...(unreadable === "config" ? entry : {}) },
        profiles: { p: { policy: { ...POLICY, ...(unreadable === "profile" ? entry : {}) } } },
        workflows: {
          d: {
            tools: ["read_file", "search_files", "query_table", "write_file", "run_command"],
            policy: { ...POLICY, commands: command === "definition rule" ? [COMMAND_RULE] : [], ...(unreadable === "definition" ? entry : {}) },
            ...(command === "definition verifier" ? { verifiers: [COMMAND_VERIFIER] } : {}),
          },
        },
      });
      const task = writeGeneralTask(
        sb,
        { id: "u245-commands", fields: { workflowRef: "d" }, limits: LIMITS, policy: { commands: command === "task rule" ? [COMMAND_RULE] : [], ...(unreadable === "task" ? entry : {}) }, verifiers: command === "task verifier" ? [COMMAND_VERIFIER] : [] },
        [textStep("never asked")],
      );
      const run = await runGuarded(sb, ["run", "--task", task, "--config", config, "--profile", "p"], cliEnv());
      const output = outputOf(run);
      const label = `unreadable in ${unreadable}, ${command}`;
      assert.deepEqual([output.kind, output.code, run.exitCode], ["error", command.startsWith("definition") ? "invalid_config" : "invalid_task", 2], `${label}: ${run.stdout}`);
      assert.match(output.message ?? "", command.endsWith("rule") ? /must be empty while unreadablePaths is set/ : /cannot be a command verifier while unreadablePaths is set/, label);
      assert.equal(existsSync(path.join(sb.workspace, ".codaryn")), false, `${label}: nothing recorded`);
    }
  }
});

test(`${MOCK_LABEL} U-245: the same in the quick form: the config's or the profile's command rule beside unreadable paths from the config, the profile or the definition`, { timeout: 120_000 }, async (t) => {
  const entry = { unreadablePaths: ["data/private"] };
  for (const [unreadable, command] of [
    ["config", "config rule"],
    ["definition", "config rule"],
    ["config", "profile rule"],
    ["profile", "profile rule"],
    ["definition", "profile rule"],
  ] as const) {
    const sb = createSandbox(t);
    // A closed loopback port: nothing must be asked of it anyway.
    const config = writeConfigFile(
      sb,
      fakeApiConfig("http://127.0.0.1:9", {
        model: FAKE_MODEL_CONFIG,
        limits: ANTHROPIC_LIMITS,
        policy: { ...POLICY, commands: command === "config rule" ? [COMMAND_RULE] : [], ...(unreadable === "config" ? entry : {}) },
        profiles: { p: { workflowRef: "d", policy: { ...POLICY, commands: command === "profile rule" ? [COMMAND_RULE] : [], ...(unreadable === "profile" ? entry : {}) } } },
        workflows: { d: { tools: ["read_file", "search_files", "query_table", "write_file", "run_command"], policy: { ...POLICY, ...(unreadable === "definition" ? entry : {}) } } },
      } as object),
    );
    const form = command === "profile rule" ? ["--profile", "p"] : ["--workflow", "d"];
    const run = await runGuarded(sb, ["run", "--config", config, ...form, "--workspace", sb.workspace, "--goal", "Count the people."], cliEnv({ fakeApiKey: FAKE_API_KEY }));
    const output = outputOf(run);
    const label = `unreadable in ${unreadable}, ${command}`;
    assert.deepEqual([output.kind, output.code, run.exitCode], ["error", "invalid_config", 2], `${label}: ${run.stdout}`);
    assert.match(output.message ?? "", /must be empty while unreadablePaths is set/, label);
    assert.equal(existsSync(path.join(sb.workspace, ".codaryn")), false, `${label}: nothing recorded`);
  }
});

test("U-245: k below 5 in any place is refused before the run, also beside a larger k elsewhere", { timeout: 120_000 }, async (t) => {
  for (const [label, where, code] of [
    ["the task file", { task: 4 }, "invalid_task"],
    ["the config file", { config: 4 }, "invalid_config"],
    ["a profile", { profile: 4 }, "invalid_config"],
    ["a definition", { definition: 4 }, "invalid_config"],
    ["the task file beside 6 and 7 elsewhere", { config: 6, profile: 7, task: 4 }, "invalid_task"],
  ] as const) {
    const sb = createSandbox(t);
    const k = (place: "config" | "profile" | "definition" | "task"): JsonObject => {
      const value = (where as Partial<Record<string, number>>)[place];
      return value === undefined ? {} : { minGroupSize: value };
    };
    const config = writeConfigFile(sb, {
      schemaVersion: 1,
      limits: LIMITS,
      policy: { ...POLICY, ...k("config") },
      profiles: { p: { policy: { ...POLICY, ...k("profile") } } },
      workflows: { d: privateLike({ unreadablePaths: ["data/private"], ...k("definition") }) },
    });
    const task = writeGeneralTask(sb, { id: "u245-k", fields: { workflowRef: "d" }, limits: LIMITS, policy: k("task") }, [textStep("never asked")]);
    const run = await runGuarded(sb, ["run", "--task", task, "--config", config, "--profile", "p"], cliEnv());
    const output = outputOf(run);
    assert.deepEqual([output.kind, output.code, run.exitCode], ["error", code, 2], `${label}: ${run.stdout}`);
    assert.match(output.message ?? "", /policy\.minGroupSize must be a whole number from 5 to 1000/, label);
    assert.equal(existsSync(path.join(sb.workspace, ".codaryn")), false, `${label}: nothing recorded`);
  }
});

test("U-245 (R-108 H-1): a plan run and the run that carries it out under a profile's and a definition's folders - reads refused, small groups hidden, nothing leaks; an entry added after the approval stops the carrying run before the model", { timeout: 180_000 }, async (t) => {
  const sb = createSandbox(t);
  const fromProfile = writePrivateWorkspace(sb, { markedDirUnder: "data/profile" });
  const fromDefinition = writePrivateWorkspace(sb, { markedDirUnder: "data/definition" });
  const definition = {
    tools: ["read_file", "search_files", "query_table", "write_file", "propose_changes"],
    plan: "run",
    policy: { ...POLICY, unreadablePaths: [fromDefinition.dir] },
  };
  const writeConfig = (top: JsonObject): string =>
    writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, policy: { ...POLICY, ...top }, profiles: { p: { policy: { ...POLICY, unreadablePaths: [fromProfile.dir] } } }, workflows: { "private-plan": definition } });
  let config = writeConfig({});
  const profileTable = fromProfile.tables[0] as PrivateTableFile;
  const definitionTable = fromDefinition.tables[0] as PrivateTableFile;
  const planTurns: Turn[] = [
    [...(queryTurns("p", [profileTable])[0] as Turn), { id: "pr1", name: "read_file", args: { path: profileTable.path } }, { id: "pr2", name: "read_file", args: { path: definitionTable.path } }],
    [{ id: "pp", name: "propose_changes", args: { summary: "Write the report of the totals by group.", files: [{ path: "out/report.md", change: "create" }] } }],
  ];
  const task = writeGeneralTask(sb, { id: "u245-plan", fields: { workflowRef: "private-plan" }, limits: LIMITS, verifiers: [{ id: "report", kind: "file_rules", rules: [{ type: "exists", path: "out/report.md" }] }] }, [...scripted(planTurns).slice(0, -1), textStep("not asked")]);
  const form = ["--task", task, "--config", config, "--profile", "p"];
  const planned = await runGuarded(sb, ["run", ...form], cliEnv());
  const plan = outputOf(planned);
  assert.deepEqual([plan.kind, plan.reason], ["run", "plan_pending"], planned.stdout);
  assert.deepEqual(refusedOf(sb, plan.runId as string), ["pr1:unreadable_path", "pr2:unreadable_path"]);

  // The carrying run: its own reads in both folders refused (R-108 H-1), a query hides, the report written.
  const carryTurns: Turn[] = [
    [{ id: "cr1", name: "read_file", args: { path: definitionTable.path } }, { id: "cr2", name: "read_file", args: { path: profileTable.path } }, { id: "cs1", name: "search_files", args: { path: ".", text: "10" } }],
    queryTurns("c", [definitionTable])[0] as Turn,
    writeTurn,
  ];
  writeFileSync(sb.scriptPath, JSON.stringify({ schemaVersion: 1, steps: scripted(carryTurns) }));
  const carried = await runGuarded(sb, ["apply", ...form, "--run", plan.runId as string, "--digest", (plan.plan?.digest ?? "").slice(0, 12)], cliEnv());
  const carry = outputOf(carried);
  assert.deepEqual([carry.kind, carry.status, carry.reason], ["run", "done", "verified"], `${carried.stdout}\n${carried.stderr}`);
  assert.deepEqual(refusedOf(sb, carry.runId as string), ["cr1:unreadable_path", "cr2:unreadable_path"]);
  assertSummary(carried, 2, 3, 5);
  await checkPrivate(
    { sb, canaries: [fromProfile, fromDefinition], queried: [{ tag: "p", files: [profileTable] }, { tag: "c", files: [definitionTable] }], k: 5, runs: { planned, carried }, scripted: true },
    [plan.runId as string, carry.runId as string],
  );

  // A second plan changes the public guide; then the config makes the folder unreadable: the carrying
  // run's planned-file check at its gate (R-108 H-1) stops it before any model request.
  const guide = readFileSync(path.join(sb.workspace, "public", "guide.md"), "utf8");
  const editTurns: Turn[] = [[{ id: "ep", name: "propose_changes", args: { summary: "Add a line to the guide.", files: [{ path: "public/guide.md", change: "modify" }] } }]];
  writeFileSync(sb.scriptPath, JSON.stringify({ schemaVersion: 1, steps: [...scripted(editTurns).slice(0, -1), textStep("not asked")] }));
  const second = outputOf(await runGuarded(sb, ["run", ...form], cliEnv()));
  assert.equal(second.reason, "plan_pending");
  config = writeConfig({ unreadablePaths: ["public"] });
  writeFileSync(sb.scriptPath, JSON.stringify({ schemaVersion: 1, steps: [{ toolCalls: [{ id: "e1", name: "write_file", args: replaceTextArgs("public/guide.md", guide, "Guide", "Guide (edited)") }], usage: ZERO_USAGE }, textStep("done")] }));
  const stale = await runGuarded(sb, ["apply", "--task", task, "--config", config, "--profile", "p", "--run", second.runId as string, "--digest", (second.plan?.digest ?? "").slice(0, 12)], cliEnv());
  const stopped = outputOf(stale);
  assert.deepEqual([stopped.status, stopped.reason, stale.exitCode, stopped.usage?.modelTurns], ["failed", "plan_stale", 1, 0], `${stale.stdout}\n${stale.stderr}`);
  assert.ok((stopped.notices ?? []).some((notice) => notice.includes("not allowed by the policy now: file 0: path/unreadable_path")), JSON.stringify(stopped.notices));
  assert.equal(journalOf(sb, stopped.runId as string).filter((record) => record.type === "model_request").length, 0);
  assert.equal(readFileSync(path.join(sb.workspace, "public", "guide.md"), "utf8"), guide, "the guide is as it was");
});
