/**
 * U-210 second part (P1 bundle A, A-6; P-1, P-2, P-3, R-5, Q-4, DR-70): a table kept from the agent
 * reaches the person's analysis through query_table only, on the real CLI from end to end. Before:
 * `analyze-private` was no built-in task type, `analyze` did not offer query_table, the run's k never
 * reached the tool runner (ResolvedTaskSpec.minGroupSize was set but not given), and a task type for
 * personal data resolved with no unreadable path at all.
 * Now:
 * - `analyze-private` is built in: read_file, search_files, query_table and write_file, no command,
 *   a person's review whose checklist is analyze's two items and PRIVATE_REVIEW_ITEM (P-1, P-3);
 * - it is refused at resolution when the run has no unreadable path (unreadable_paths_required, a
 *   WORKFLOW_PROBLEMS entry now, as is unreadable_with_commands), naming policy.unreadablePaths, with
 *   nothing recorded; doctor fails the task file's check, or the config file's for a profile, where a
 *   run would refuse;
 * - `analyze` offers query_table too, with k only for unreadable tables (P-2);
 * - parser to effective k to gate and tool to human output: with the scripted model and with a fake
 *   Anthropic API on 127.0.0.1, every cell of the table holds its own marker, and no marker of a row,
 *   nor the key of a group of fewer than k rows (k 5 by default, 6 from the config file), is in a tool
 *   result, a record, a model request or the human output; the keys of the groups of at least k rows,
 *   the column names and the counts do reach the model.
 * Temporary folders, fake values; the only address is the fake server's on 127.0.0.1.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { BUILTIN_WORKFLOW_IDS, PRIVATE_DATA_WORKFLOW_PROBLEMS, PRIVATE_REVIEW_ITEM, WORKFLOW_PROBLEMS } from "../../../src/contracts/index.js";
import type { JournalRecord, JsonObject, ResolveWorkflowInput, WorkflowDefinition } from "../../../src/contracts/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { BUILTIN_WORKFLOWS, resolveWorkflow, workflowDefinitions } from "../../../src/workflows/index.js";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { bodyOf, bodySources, cliOutputSources, replyText, replyTools, requestAt, runGuarded, startFakeAnthropic, toolResultText, toolUse } from "../../support/fake-anthropic.js";
import { findLeaks } from "../../support/leak.js";
import { createSandbox, writeWorkspaceFile } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { ANTHROPIC_LIMITS, FAKE_MODEL_TASK, fakeApiConfig, writeConfigFile } from "../../fixtures/anthropic.js";
import { FAKE_API_KEY } from "../../fixtures/secrets.js";
import { createFileArgs, textStep, toolStep, writeGeneralTask } from "../../fixtures/general-tasks.js";

const PRIVATE_ID = "analyze-private";
const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
const LIMITS = { maxModelTurns: 8, maxToolCalls: 24, maxTotalTokens: 1000, maxDurationMs: 60_000 };
const TABLE = "private/people.csv";

/** Made at run time, letters and digits only: no file but the table holds a marker built on it. */
const TAG = randomBytes(5).toString("hex");
const DEPARTMENTS = [
  { key: `dbig${TAG}a`, rows: 6 },
  { key: `dbig${TAG}b`, rows: 5 },
  { key: `dsml${TAG}c`, rows: 4 },
  { key: `dsml${TAG}d`, rows: 2 },
  { key: `dsml${TAG}e`, rows: 1 },
];
const ROWS = DEPARTMENTS.flatMap((department) => Array.from({ length: department.rows }, () => department.key)).map((key, index) => ({
  id: `pid${TAG}${String(index).padStart(3, "0")}`,
  name: `pnm${TAG}${String(index).padStart(3, "0")}`,
  dept: key,
  amount: index * 10 + 7,
}));
const TABLE_TEXT = ["id,name,dept,amount", ...ROWS.map((row) => `${row.id},${row.name},${row.dept},${row.amount}`), ""].join("\n");
/** Every cell's own marker: no row may be given (the amounts are numbers, not markers). */
const ROW_MARKERS = ROWS.flatMap((row) => [row.id, row.name]);
const keysUnder = (k: number): string[] => DEPARTMENTS.filter((department) => department.rows < k).map((department) => department.key);
const keysFrom = (k: number): string[] => DEPARTMENTS.filter((department) => department.rows >= k).map((department) => department.key);

const json = (run: CliRun): Record<string, unknown> => JSON.parse(run.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;

function journalOf(sb: Sandbox, runId: string): JournalRecord[] {
  const text = readFileSync(path.join(sb.workspace, ".codaryn", "runs", runId, "journal.jsonl"), "utf8");
  return text.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as JournalRecord);
}

function runDirs(sb: Sandbox): string[] {
  const dir = path.join(sb.workspace, ".codaryn", "runs");
  return existsSync(dir) ? readdirSync(dir) : [];
}

/** The workspace: the table under `private`, a public note that a search finds, nothing else. */
function workspace(sb: Sandbox): void {
  writeWorkspaceFile(sb, TABLE, TABLE_TEXT);
  writeWorkspaceFile(sb, "notes/about.md", `about ${TAG} public\n`);
}

const byDepartment = { path: TABLE, groupBy: ["dept"], operations: [{ op: "count", column: "amount" }, { op: "sum", column: "amount" }] };
const byName = { path: TABLE, groupBy: ["name"], operations: [{ op: "count", column: "amount" }] };

/** query_table's results in the run's records, parsed, in order. */
function queryResults(records: readonly JournalRecord[]): { ok: boolean; payload: Record<string, unknown> | null; message: string | null }[] {
  return records.flatMap((record) => {
    if (record.type !== "tool_result" || record.result.tool !== "query_table") return [];
    const result = record.result;
    const content = typeof result.content === "string" ? result.content : null;
    // A failed result carries its message as the content (ToolResult).
    return [{ ok: result.ok, payload: result.ok && content !== null ? (JSON.parse(content) as Record<string, unknown>) : null, message: result.ok ? null : content }];
  });
}

const groupKeys = (payload: Record<string, unknown> | null): string[][] => ((payload?.["groups"] as { keys: string[] }[] | undefined) ?? []).map((group) => group.keys);

describe("U-210: analyze-private is built in, and analyze offers query_table (P-1, P-2, P-3)", () => {
  const definitions = BUILTIN_WORKFLOWS as unknown as { readonly [id: string]: WorkflowDefinition | undefined };

  test("analyze-private: four tools, no command, a person's review with analyze's items and the private one", () => {
    assert.equal((BUILTIN_WORKFLOW_IDS as readonly string[]).includes(PRIVATE_ID), true);
    const definition = definitions[PRIVATE_ID];
    assert.ok(definition !== undefined, "a built-in definition");
    assert.deepEqual(definition.tools, ["read_file", "search_files", "query_table", "write_file"]);
    assert.equal(definition.allowCommands, false);
    assert.equal(definition.completion, "human_review");
    assert.deepEqual(definition.humanReview?.checklist, [...(definitions["analyze"]?.humanReview?.checklist ?? []), PRIVATE_REVIEW_ITEM]);
    assert.equal(
      definition.instructions,
      "The input tables are not readable. Use query_table for every number. Write only the result table and the report the goal names. Do not write values that identify a person.",
    );
  });

  test("analyze: query_table joins its tools; its instructions and checklist are as before", () => {
    const analyze = definitions["analyze"];
    assert.deepEqual(analyze?.tools, ["read_file", "search_files", "query_table", "write_file"]);
    assert.equal(
      analyze?.instructions,
      "Read the input tables and write the result table and the report the goal names. Compute every number from the input tables. Keep the input files unchanged.",
    );
    assert.deepEqual(analyze?.humanReview?.checklist, ["The report's interpretation matches the result table.", "No input data the goal names is missing from the analysis."]);
  });

  test("the two private data problems are workflow problems; analyze-private resolves only with an unreadable path", () => {
    for (const problem of PRIVATE_DATA_WORKFLOW_PROBLEMS) assert.equal((WORKFLOW_PROBLEMS as readonly string[]).includes(problem), true, problem);
    const input = (unreadablePaths: readonly string[] | undefined): ResolveWorkflowInput =>
      ({ definitions: workflowDefinitions(undefined), task: { workflowRef: PRIVATE_ID }, profileWorkflowRef: null, commandRules: 0, ...(unreadablePaths === undefined ? {} : { unreadablePaths }) }) as ResolveWorkflowInput;
    assert.deepEqual(resolveWorkflow(input(undefined)), { ok: false, problem: "unreadable_paths_required", field: "policy.unreadablePaths" });
    assert.deepEqual(resolveWorkflow(input([])), { ok: false, problem: "unreadable_paths_required", field: "policy.unreadablePaths" });
    const resolved = resolveWorkflow(input(["private"]));
    assert.equal(resolved.ok, true, JSON.stringify(resolved));
    if (resolved.ok) assert.deepEqual(resolved.settings.tools, ["read_file", "search_files", "query_table", "write_file"]);
    // Other task types resolve with or without unreadable paths, as before.
    const analyze = resolveWorkflow({ ...input(undefined), task: { workflowRef: "analyze" } });
    assert.equal(analyze.ok, true);
  });
});

describe("U-210: analyze-private without an unreadable path is refused before the run", () => {
  test("a task file: invalid_task naming policy.unreadablePaths, nothing recorded; the config's list lets it run", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    workspace(sb);
    const task = writeGeneralTask(sb, { id: "u210-required", fields: { workflowRef: PRIVATE_ID } }, [textStep("not requested")]);
    const bare = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, policy: POLICY }, "bare.json");
    const refused = json(await runGuarded(sb, ["run", "--task", task, "--config", bare], cliEnv()));
    assert.equal(refused["code"], "invalid_task", JSON.stringify(refused));
    assert.match(String(refused["message"]), /^policy\.unreadablePaths must not be empty under the analyze-private task type/);
    assert.deepEqual(refused["diagnostic"], { file: "task", code: "invalid_value", field: "policy.unreadablePaths" });
    assert.deepEqual(runDirs(sb), [], "no run was recorded");
    const listed = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, policy: { ...POLICY, unreadablePaths: ["private"] } }, "listed.json");
    const ran = json(await runGuarded(sb, ["run", "--task", task, "--config", listed], cliEnv()));
    assert.equal(ran["kind"], "run", JSON.stringify(ran));
  });

  test("the quick form with --workflow analyze-private: invalid_config, nothing sent or recorded", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    workspace(sb);
    const config = writeConfigFile(sb, { schemaVersion: 1, model: "fake-model-id", maxOutputTokens: 1000, limits: LIMITS, policy: POLICY }, "q.json");
    const refused = json(await runGuarded(sb, ["run", "--workspace", sb.workspace, "--goal", "g", "--workflow", PRIVATE_ID, "--config", config], cliEnv({ fakeApiKey: FAKE_API_KEY })));
    assert.equal(refused["code"], "invalid_config", JSON.stringify(refused));
    assert.match(String(refused["message"]), /^policy\.unreadablePaths must not be empty under the analyze-private task type/);
    assert.deepEqual(runDirs(sb), [], "no run was recorded");
  });

  test("doctor: the task file's check fails where a run would refuse; with the config's list it is valid", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    workspace(sb);
    const task = writeGeneralTask(sb, { id: "u210-doctor", fields: { workflowRef: PRIVATE_ID } }, [textStep("not requested")]);
    const checkOf = async (config: string): Promise<{ status: string; message: string; text?: { id: string; params?: Record<string, unknown> } }> => {
      const ran = await runGuarded(sb, ["doctor", "--task", task, "--config", config, "--json"], cliEnv());
      const checks = (JSON.parse(ran.stdout) as { checks: { id: string; status: string; message: string; text?: { id: string } }[] }).checks;
      const found = checks.find((check) => check.id === "task_file");
      assert.ok(found !== undefined, ran.stdout);
      return found;
    };
    const bare = await checkOf(writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, policy: POLICY }, "bare.json"));
    assert.equal(bare.status, "fail", JSON.stringify(bare));
    assert.match(bare.message, /^policy\.unreadablePaths must not be empty under the analyze-private task type/);
    assert.deepEqual(bare.text, { id: "doctor.task_file.invalid", params: { field: "policy.unreadablePaths" } });
    const listed = await checkOf(writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, policy: { ...POLICY, unreadablePaths: ["private"] } }, "listed.json"));
    assert.equal(listed.status, "ok", JSON.stringify(listed));
  });

  test("doctor: a profile naming analyze-private fails the config file's check without a list; with the profile's it is valid", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    workspace(sb);
    const configCheck = async (profile: JsonObject): Promise<{ status: string; message: string; text?: { id: string; params?: Record<string, unknown> } }> => {
      const config = writeConfigFile(sb, { schemaVersion: 1, model: "fake-model-id", maxOutputTokens: 1000, limits: LIMITS, policy: POLICY, profiles: { private: profile } }, "p.json");
      const ran = await runGuarded(sb, ["doctor", "--workspace", sb.workspace, "--profile", "private", "--config", config, "--json"], cliEnv({ fakeApiKey: FAKE_API_KEY }));
      const checks = (JSON.parse(ran.stdout) as { checks: { id: string; status: string; message: string; text?: { id: string } }[] }).checks;
      const found = checks.find((check) => check.id === "config_file");
      assert.ok(found !== undefined, ran.stdout);
      return found;
    };
    const bare = await configCheck({ workflowRef: PRIVATE_ID });
    assert.equal(bare.status, "fail", JSON.stringify(bare));
    assert.match(bare.message, /^policy.unreadablePaths must not be empty under the analyze-private task type/);
    assert.deepEqual([bare.text?.id, bare.text?.params?.["field"]], ["doctor.config_file.invalid", "policy.unreadablePaths"]);
    const listed = await configCheck({ workflowRef: PRIVATE_ID, policy: { ...POLICY, unreadablePaths: ["private"] } });
    assert.equal(listed.status, "ok", JSON.stringify(listed));
  });
});

describe("U-210 from end to end: a table kept from the agent, analysed through query_table only", () => {
  /** read, search, describe, by department, by name, an operation not allowed, the report, the end. */
  const steps = [
    toolStep("read_file", { path: TABLE }),
    toolStep("search_files", { path: ".", text: TAG }),
    toolStep("query_table", { path: TABLE, describe: true }),
    toolStep("query_table", byDepartment),
    toolStep("query_table", byName),
    toolStep("query_table", { path: TABLE, operations: [{ op: "min", column: "amount" }] }),
    toolStep("write_file", createFileArgs("out/report.md", "# Report\n\nThe large departments only.\n")),
    textStep("done"),
  ];

  for (const [label, k, configPolicy] of [
    ["k 5 by default", 5, POLICY],
    ["k 6 from the config file under a task file", 6, { ...POLICY, minGroupSize: 6 }],
  ] as const) {
    test(`scripted model, ${label}: no row and no small group's key in a result, a record or the output`, { timeout: 90_000 }, async (t) => {
      const sb = createSandbox(t);
      workspace(sb);
      const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, policy: configPolicy }, "c.json");
      const task = writeGeneralTask(sb, { id: "u210-private", fields: { workflowRef: PRIVATE_ID }, policy: { unreadablePaths: ["private"] } }, steps);
      for (const lang of ["en", "ko"] as const) {
        const ran = await runGuarded(sb, ["run", "--task", task, "--config", config], cliEnv({ extra: { CODARYN_LANG: lang } }));
        const output = json(ran);
        assert.equal(output["kind"], "run", ran.stdout);
        assert.deepEqual([output["status"], output["reason"]], ["needs-input", "awaiting_review"], ran.stdout);
        const records = journalOf(sb, output["runId"] as string);
        const decisions = records.flatMap((record) => (record.type === "tool_decision" ? [`${record.tool}:${record.allowed ? "allowed" : record.code}`] : []));
        assert.deepEqual(decisions, [
          "read_file:unreadable_path",
          "search_files:allowed",
          "query_table:allowed",
          "query_table:allowed",
          "query_table:allowed",
          "query_table:allowed",
          "write_file:allowed",
        ]);
        const search = records.find((record) => record.type === "tool_result" && record.result.tool === "search_files");
        assert.ok(search !== undefined && search.type === "tool_result" && typeof search.result.content === "string");
        const found = JSON.parse(search.result.content as string) as { entries: { path: string }[]; withheld?: boolean };
        assert.deepEqual([found.entries.map((entry) => entry.path), found.withheld], [["notes/about.md"], true]);

        const [described, departments, names, notAllowed] = queryResults(records);
        assert.deepEqual(
          ((described?.payload?.["columns"] as { name: string }[] | undefined) ?? []).map((column) => column.name),
          ["id", "name", "dept", "amount"],
        );
        assert.equal(described?.payload?.["rows"], ROWS.length);
        assert.deepEqual(groupKeys(departments?.payload ?? null), keysFrom(k).map((key) => [key]), "the groups of at least k rows, with their keys");
        assert.deepEqual([departments?.payload?.["suppressedGroups"], departments?.payload?.["minGroupSize"]], [keysUnder(k).length, k]);
        assert.deepEqual([groupKeys(names?.payload ?? null), names?.payload?.["suppressedGroups"]], [[], ROWS.length], "one row each: every group hidden");
        assert.equal(notAllowed?.ok, false);
        assert.match(String(notAllowed?.message), /op_not_allowed/);

        const leaks = findLeaks(cliOutputSources(sb.workspace, ran), [...ROW_MARKERS, ...keysUnder(k)]);
        assert.deepEqual(leaks, [], "no row and no key of a group of fewer than k rows in the output or a record");
        assert.equal(readFileSync(path.join(sb.workspace, TABLE), "utf8"), TABLE_TEXT, "the table is as it was");

        const catalog = createMessageCatalog(lang);
        assert.ok(ran.stderr.includes(catalog.format("summary.denied_unreadable", { count: 1 })), ran.stderr);
        assert.ok(ran.stderr.includes(catalog.format("summary.groups_hidden", { results: 2, k })), ran.stderr);
        assert.ok(ran.stderr.includes(`${catalog.format("progress.query_table", { groupColumns: 1 })} (count, sum)`), ran.stderr);
        assert.ok(ran.stderr.includes(catalog.format("progress.query_table_describe")), ran.stderr);
      }
    });
  }

  test("fake Anthropic API on 127.0.0.1: the requests offer query_table and hold no row and no small group's key", { timeout: 90_000 }, async (t) => {
    const sb = createSandbox(t);
    workspace(sb);
    const api = await startFakeAnthropic(t, [
      replyTools([toolUse("t1", "read_file", { path: TABLE })]),
      replyTools([toolUse("t2", "search_files", { path: ".", text: TAG })]),
      replyTools([toolUse("t3", "query_table", byDepartment)]),
      replyTools([toolUse("t4", "query_table", byName)]),
      replyText("done"),
    ]);
    const config = writeConfigFile(sb, fakeApiConfig(api.url, { limits: ANTHROPIC_LIMITS } as object), "c.json");
    const task: JsonObject = {
      schemaVersion: 1,
      id: "u210-private-api",
      goal: "summarise the departments",
      workflow: "analysis",
      workspaceRoot: "./ws",
      workflowRef: PRIVATE_ID,
      model: { provider: "anthropic", model: FAKE_MODEL_TASK },
      policy: { ...POLICY, unreadablePaths: ["private"] },
      privacy: { secretEnv: [] },
      limits: ANTHROPIC_LIMITS as unknown as JsonObject,
      verifiers: [],
    };
    const taskPath = path.join(sb.base, "task.json");
    writeFileSync(taskPath, JSON.stringify(task));
    const ran = await runGuarded(sb, ["run", "--task", taskPath, "--config", config], cliEnv({ fakeApiKey: FAKE_API_KEY }));
    const output = json(ran);
    assert.deepEqual([output["status"], output["reason"]], ["needs-input", "awaiting_review"], ran.stdout);
    assert.equal(api.requests.length, 5);
    const offered = (bodyOf(requestAt(api, 0))["tools"] as { name: string }[]).map((tool) => tool.name);
    assert.deepEqual([...offered].sort(), ["query_table", "read_file", "search_files", "write_file"]);
    const departments = toolResultText(requestAt(api, 3), "t3");
    for (const key of keysFrom(5)) assert.ok(departments.includes(key), "a group of at least k rows reaches the model with its key");
    const leaks = findLeaks([...bodySources(api), ...cliOutputSources(sb.workspace, ran)], [...ROW_MARKERS, ...keysUnder(5)]);
    assert.deepEqual(leaks, [], "no row and no key of a group of fewer than k rows in a request, a record or the output");
  });
});

describe("U-210: analyze's query_table gives every operation and every group of a public table (P-2)", () => {
  test("a table outside the unreadable paths: min allowed, groups of one row shown, k 1", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "data/sales.csv", "region,amount\neast,1\nwest,2\nwest,3\n");
    const task = writeGeneralTask(sb, { id: "u210-analyze", fields: { workflowRef: "analyze" } }, [
      toolStep("query_table", { path: "data/sales.csv", groupBy: ["region"], operations: [{ op: "min", column: "amount" }] }),
      textStep("done"),
    ]);
    const ran = await runGuarded(sb, ["run", "--task", task], cliEnv());
    const output = json(ran);
    assert.equal(output["kind"], "run", ran.stdout);
    const [result] = queryResults(journalOf(sb, output["runId"] as string));
    assert.equal(result?.ok, true, JSON.stringify(result));
    assert.deepEqual([groupKeys(result?.payload ?? null), result?.payload?.["suppressedGroups"], result?.payload?.["minGroupSize"]], [[["east"], ["west"]], 0, 1]);
  });
});
