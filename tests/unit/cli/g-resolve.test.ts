/**
 * G-F: workflow fields through the CLI (GT-U01, GT-U02, GT-U14): config `workflows`, profile
 * `workflowRef`, task fields, `--workflow`, `policy.planActions` and `data_checks`.
 * Fake values only; the run is assembled by a stub and nothing is sent.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import type { EngineResult, ResolvedTaskSpec } from "../../../src/contracts/index.js";
import { parseArgs } from "../../../src/cli/args.js";
import type { Assemble } from "../../../src/cli/assemble.js";
import { parseConfig } from "../../../src/cli/config.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment, CliRunOutcome } from "../../../src/cli/run.js";
import { parseTask } from "../../../src/cli/task.js";
import { lexicalLocate } from "./locate.js";

const BASE = path.resolve("/tmp/codaryn-g-resolve");
const CONFIG = path.resolve("/tmp/codaryn-g-resolve-config/c.json");
const LIMITS = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 100, maxDurationMs: 1000 };
const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
const SYNTHETIC = "SYNTHETIC_PRIVATE_VALUE";
/** Not a real key format. */
const FAKE_KEY = "fake-api-key-not-real-0099";

function scriptedTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "g-task",
    goal: "g",
    workflow: "label",
    workspaceRoot: "./work",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: POLICY,
    privacy: { secretEnv: [] },
    limits: LIMITS,
    verifiers: [],
    ...overrides,
  };
}

/** Runs the CLI against files in memory and returns the outcome and the task given to the engine. */
async function run(argv: readonly string[], files: Record<string, unknown>): Promise<{ outcome: CliRunOutcome; task: ResolvedTaskSpec | null }> {
  let task: ResolvedTaskSpec | null = null;
  const assemble: Assemble = async (input) => {
    task = input.task;
    return { ok: false, code: "internal_error", message: "stub: not run in unit tests" };
  };
  const io: CliEnvironment = {
    argv,
    env: { ANTHROPIC_API_KEY: FAKE_KEY },
    cwd: BASE,
    readFile: async (file) => {
      const key = path.resolve(file);
      if (!(key in files)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      const value = files[key];
      return typeof value === "string" ? value : JSON.stringify(value);
    },
    isDirectory: async () => true,
    loadEnvFile: () => {},
    locateInWorkspace: lexicalLocate,
    clock: { now: () => 0 },
    randomBytes: (size) => new Uint8Array(size),
    assemble,
    runTask: async () => ({}) as EngineResult,
    createAnthropicProvider: () => ({ name: "anthropic", complete: async () => ({ ok: false, kind: "api_error", message: "stub" }) }),
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    defaultConfig: null,
  };
  const outcome = await runCli(io);
  return { outcome, task };
}

const SCRIPT = { [path.join(BASE, "script.json")]: { schemaVersion: 1, steps: [{ text: "done" }] } };
const errorOf = (outcome: CliRunOutcome): { code: string; message: string; field: string | null } | null =>
  outcome.output.kind === "error"
    ? { code: outcome.output.code, message: outcome.output.message, field: outcome.output.diagnostic?.field ?? null }
    : null;

describe("config workflows (GT-U01)", () => {
  test("a definition is parsed with its ceilings and defaults", () => {
    const outcome = parseConfig({
      schemaVersion: 1,
      workflows: {
        memo: { label: "Memo", tools: ["read_file", "write_file"], instructions: "Write a memo.", verifiers: [{ id: "v", kind: "file_rules", rules: [{ type: "exists", path: "m.md" }] }] },
      },
      profiles: { notes: { workflowRef: "memo" } },
    });
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.config.workflows?.["memo"]?.tools, ["read_file", "write_file"]);
    assert.equal(outcome.config.profiles?.["notes"]?.workflowRef, "memo");
  });

  test("unknown fields, built-in ids, bad tools and mismatched review are refused by position, never by id", () => {
    const cases: [unknown, string][] = [
      [{ [SYNTHETIC]: { tools: ["read_file"], extra: 1 } }, "workflows[0] has an unknown field"],
      [{ organize: { tools: ["read_file"] } }, "workflows[0] uses the id of a built-in workflow"],
      [{ "bad id": { tools: ["read_file"] } }, "workflows[0] has an id that is not a valid workflow id"],
      [{ memo: { tools: ["delete_file"] } }, "workflows[0].tools[0] must be one of"],
      [{ memo: { tools: ["read_file"], completion: "human_review" } }, "workflows[0].humanReview is required"],
      [{ memo: { tools: ["read_file"], allowCommands: false, policy: { ...POLICY, commands: [{ executable: "node", argsPrefix: [], allowExtraArgs: false }] } } }, "workflows[0].policy.commands must be empty"],
    ];
    for (const [workflows, start] of cases) {
      const outcome = parseConfig({ schemaVersion: 1, workflows });
      assert.ok(!outcome.ok && outcome.message.startsWith(start), `${JSON.stringify(workflows)} -> ${outcome.ok ? "ok" : outcome.message}`);
      assert.equal(outcome.ok ? "" : outcome.message.includes(SYNTHETIC), false);
    }
  });
});

describe("task workflow fields and data_checks (GT-U01)", () => {
  test("a task file holds workflowRef, tools, plan, completion, humanReview and planActions, never workflows", () => {
    const parsed = parseTask(
      scriptedTask({
        workflowRef: "analyze",
        tools: ["read_file", "write_file"],
        completion: "human_review",
        humanReview: { checklist: ["Is it right?"] },
        policy: { ...POLICY, planActions: ["move"] },
      }),
      BASE,
    );
    assert.ok(parsed.ok);
    assert.equal(parsed.task.workflowRef, "analyze");
    assert.deepEqual(parsed.task.policy.planActions, ["move"]);
    const withDefinitions = parseTask(scriptedTask({ workflows: {} }), BASE);
    assert.ok(!withDefinitions.ok && withDefinitions.message.startsWith("task has an unknown field"));
    for (const [field, value] of [["plan", "later"], ["completion", "maybe"], ["tools", []], ["policy", { ...POLICY, planActions: ["move", "move"] }]] as const) {
      assert.equal(parseTask(scriptedTask({ [field]: value }), BASE).ok, false, field);
    }
  });

  test("data_checks rules are accepted; malformed rules and the inventory kind are refused by position", () => {
    const table = { path: "in.csv", format: "csv" };
    const good = parseTask(
      scriptedTask({
        verifiers: [
          {
            id: "data",
            kind: "data_checks",
            rules: [
              { type: "table_shape", table, columns: ["a", "b"], rows: { min: 1 } },
              { type: "aggregate_match", source: table, column: "b", op: "sum", groupBy: "a", target: { path: "out.csv", format: "csv" }, targetColumn: "total", targetKeyColumn: "a", tolerance: { absolute: 0.01 } },
            ],
          },
        ],
      }),
      BASE,
    );
    assert.ok(good.ok);
    const bad: [unknown, string][] = [
      [{ id: "d", kind: "data_checks", rules: [] }, "verifiers[0].rules must be a non-empty array"],
      [{ id: "d", kind: "data_checks", rules: [{ type: "table_shape", table: { path: "x", format: "xlsx" }, rows: { equals: 1 } }] }, "verifiers[0].rules[0].table.format"],
      [{ id: "d", kind: "data_checks", rules: [{ type: "aggregate_match", source: table, column: "b", op: "sum", groupBy: "a", target: table, targetColumn: "t" }] }, "verifiers[0].rules[0].targetKeyColumn"],
      [{ id: "d", kind: "data_checks", rules: [{ type: "table_shape", table, rows: { min: 3, max: 1 } }] }, "verifiers[0].rules[0].rows.min"],
      [{ id: "d", kind: "inventory" }, "verifiers[0].kind must be one of command, file_rules, data_checks"],
    ];
    for (const [verifier, start] of bad) {
      const outcome = parseTask(scriptedTask({ verifiers: [verifier] }), BASE);
      assert.ok(!outcome.ok && outcome.message.startsWith(start), `${JSON.stringify(verifier)} -> ${outcome.ok ? "ok" : outcome.message}`);
    }
  });
});

describe("resolution in run (GT-U02, GT-U14)", () => {
  test("a legacy task reaches the engine with no workflow field at all", async () => {
    const { task } = await run(["run", "--task", "task.json"], { ...SCRIPT, [path.join(BASE, "task.json")]: scriptedTask() });
    assert.ok(task !== null);
    for (const field of ["workflowRef", "tools", "instructions", "plan", "completion", "humanReview"]) {
      assert.equal(Object.hasOwn(task as object, field), false, field);
    }
  });

  test("a task's workflowRef expands into explicit fields; its tools only narrow", async () => {
    const files = { ...SCRIPT, [path.join(BASE, "task.json")]: scriptedTask({ workflowRef: "organize", policy: { ...POLICY, planActions: ["move", "discard"] } }) };
    const { task } = await run(["run", "--task", "task.json"], files);
    assert.ok(task !== null);
    const resolved = task as ResolvedTaskSpec;
    assert.equal(resolved.workflowRef, "organize");
    assert.equal(resolved.plan, "apply");
    assert.deepEqual([...(resolved.tools ?? [])].sort(), ["inspect_files", "propose_plan", "read_file", "search_files"]);
    assert.ok((resolved.instructions ?? "").length > 0);
    const widened = await run(["run", "--task", "task.json"], { ...SCRIPT, [path.join(BASE, "task.json")]: scriptedTask({ workflowRef: "organize", tools: ["write_file"] }) });
    assert.deepEqual(errorOf(widened.outcome)?.code, "invalid_task");
    // The message names the position; the structured field waits for SCHEMA_FIELD_NAMES to list `tools` (G-A request).
    assert.ok(errorOf(widened.outcome)?.message.startsWith("tools[0] "));
    const weakened = await run(["run", "--task", "task.json"], { ...SCRIPT, [path.join(BASE, "task.json")]: scriptedTask({ workflowRef: "organize", plan: "none" }) });
    assert.equal(errorOf(weakened.outcome)?.code, "invalid_task");
    assert.equal(widened.task, null);
  });

  test("organize under a task with command rules is refused (GT-D10)", async () => {
    const rules = { ...POLICY, commands: [{ executable: "node", argsPrefix: [], allowExtraArgs: false }] };
    const { outcome, task } = await run(["run", "--task", "task.json"], { ...SCRIPT, [path.join(BASE, "task.json")]: scriptedTask({ workflowRef: "organize", policy: rules }) });
    assert.equal(errorOf(outcome)?.code, "invalid_task");
    assert.equal(errorOf(outcome)?.field, "policy.commands");
    assert.ok(errorOf(outcome)?.message.startsWith("policy.commands "));
    assert.equal(task, null);
  });

  test("--workflow in the quick form: the label, the definition's policy and limits under the config's", async () => {
    const config = { schemaVersion: 1, model: "m", maxOutputTokens: 10, limits: { maxTotalTokens: 100, maxDurationMs: 1000, maxModelTurns: 6 } };
    const { task } = await run(["run", "tidy up", "--config", CONFIG, "--workflow", "organize"], { [CONFIG]: config });
    assert.ok(task !== null);
    const resolved = task as ResolvedTaskSpec;
    assert.equal(resolved.workflow, "organize");
    assert.equal(resolved.workflowRef, "organize");
    assert.deepEqual(resolved.policy.planActions, ["move", "discard"]);
    // The config's turn limit is over the definition's; the definition's tool call limit fills the gap.
    assert.equal(resolved.limits.maxModelTurns, 6);
    assert.equal(resolved.limits.maxToolCalls, 40);
    assert.equal(parseArgs(["run", "--task", "t.json", "--workflow", "organize"]).ok, false);
    assert.equal(parseArgs(["run", "x", "--workflow", "bad id"]).ok, false);
  });

  test("a profile's workflowRef applies when the task names none; an unknown one is invalid_config", async () => {
    const config = {
      schemaVersion: 1,
      model: "m",
      maxOutputTokens: 10,
      limits: LIMITS,
      profiles: { tidy: { workflowRef: "organize" }, broken: { workflowRef: "nope" } },
    };
    const tidy = await run(["run", "tidy up", "--config", CONFIG, "--profile", "tidy"], { [CONFIG]: config });
    assert.equal((tidy.task as ResolvedTaskSpec | null)?.plan, "apply");
    const broken = await run(["run", "tidy up", "--config", CONFIG, "--profile", "broken"], { [CONFIG]: config });
    assert.equal(errorOf(broken.outcome)?.code, "invalid_config");
    assert.ok(errorOf(broken.outcome)?.message.startsWith("profiles.workflowRef"));
  });
});
