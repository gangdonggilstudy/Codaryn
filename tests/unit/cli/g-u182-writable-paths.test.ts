/**
 * U-182 (DR-69 B-4, the part that waits for no engine work): policy `writablePaths` could not be
 * used. The contract (U-170) and the gate (U-175) had it, but every parser refused the field
 * (`unknown_field`) and nothing built ResolvedTaskSpec.writablePathSets or gave it to the gate.
 * Now the task file, the config file, a profile and a task type definition take it (the format of
 * protectedPaths, its field named in the diagnostic); each source that states one is its own list
 * and a file tool's write must be covered by every list (the config's and the profile's apply under
 * a task file too); the run's and the apply's gates get the lists; a write outside them is denied as
 * path/path_not_writable and the run's end tells the person how to allow a file; doctor warns when
 * writable lists and command rules come together (B-8: commands are not bound by the lists).
 * Scripted model, temporary folders; no network.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { JournalRecord, JsonObject, MessageCatalog } from "../../../src/contracts/index.js";
import { parseConfig } from "../../../src/cli/config.js";
import { parseTask } from "../../../src/cli/task.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { runGuarded } from "../../support/fake-anthropic.js";
import { createSandbox, nodeCommand } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { writeConfigFile } from "../../fixtures/anthropic.js";
import { createFileArgs, organizeScript, textStep, toolStep, writeGeneralTask, writeOrganizeTask, writeOrganizeWorkspace } from "../../fixtures/general-tasks.js";

const TASK = {
  schemaVersion: 1,
  id: "u182",
  goal: "g",
  workflow: "code",
  workspaceRoot: "./ws",
  model: { provider: "scripted", scriptPath: "./script.json" },
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
  privacy: { secretEnv: [] },
  limits: { maxModelTurns: 8, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
  verifiers: [],
};
const POLICY = TASK.policy;
const LIMITS = { maxModelTurns: 8, maxToolCalls: 24, maxTotalTokens: 1000, maxDurationMs: 60_000 };
/** U-182's hint line (loosely typed, so this file builds before the id exists). */
const hintLine = (catalog: MessageCatalog, count: number): string =>
  (catalog.format as (id: string, params: object) => string)("progress.not_writable_hint", { count });

/** Writes each path in turn (a new file each), then ends. */
function writes(...paths: readonly string[]): ReturnType<typeof toolStep>[] {
  return [...paths.map((file) => toolStep("write_file", createFileArgs(file, "x\n"))), textStep("done")];
}

interface Ran {
  readonly run: CliRun;
  /** path -> "allowed" or the denial code, from the journal's tool decisions in order. */
  readonly decisions: readonly string[];
}

async function run(sb: Sandbox, args: readonly string[], lang = "en"): Promise<Ran> {
  const ran = await runGuarded(sb, args, cliEnv({ extra: { CODARYN_LANG: lang } }));
  const last = ran.stdout.trim().split("\n").pop() ?? "";
  const output = JSON.parse(last) as { kind: string; runId?: string; code?: string; message?: string };
  assert.equal(output.kind, "run", `${output.code ?? ""} ${output.message ?? ""}\n${ran.stderr}`);
  const records = readFileSync(path.join(sb.workspace, ".codaryn", "runs", output.runId ?? "", "journal.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JournalRecord);
  const decisions = records.flatMap((record) => (record.type === "tool_decision" ? [record.allowed ? "allowed" : `${record.permission}/${record.code}`] : []));
  return { run: ran, decisions };
}

describe("U-182: the four places take writablePaths, in protectedPaths' format", () => {
  test("a task file: kept as given, an empty list too", () => {
    for (const entries of [["out", "notes/a.md"], []]) {
      const outcome = parseTask({ ...TASK, policy: { ...POLICY, writablePaths: entries } }, process.cwd());
      assert.ok(outcome.ok, outcome.ok ? "" : outcome.message);
      if (outcome.ok) assert.deepEqual(outcome.task.policy.writablePaths, entries);
    }
  });

  test("a bad entry: invalid_task naming policy.writablePaths[i], as protectedPaths does", () => {
    const outcome = parseTask({ ...TASK, policy: { ...POLICY, writablePaths: ["out", "../x"] } }, process.cwd());
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, "invalid_task");
    assert.match(outcome.message, /^policy\.writablePaths\[1\] /);
    assert.deepEqual(outcome.position, { code: "invalid_value", field: "policy.writablePaths[1]" });
    const notList = parseTask({ ...TASK, policy: { ...POLICY, writablePaths: "out" } }, process.cwd());
    assert.ok(!notList.ok && notList.message.startsWith("policy.writablePaths"), notList.ok ? "" : notList.message);
  });

  test("the config file's policy, a profile's policy and a definition's policy", () => {
    const policy = { ...POLICY, writablePaths: ["out"] };
    const outcome = parseConfig({ schemaVersion: 1, policy, profiles: { p: { policy } }, workflows: { d: { tools: ["read_file", "write_file"], policy } } });
    assert.ok(outcome.ok, outcome.ok ? "" : outcome.message);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.config.policy?.writablePaths, ["out"]);
    assert.deepEqual(outcome.config.profiles?.["p"]?.policy?.writablePaths, ["out"]);
    assert.deepEqual(outcome.config.workflows?.["d"]?.policy?.writablePaths, ["out"]);
  });
});

describe("U-182 on the real CLI: a write must be covered by every list", () => {
  test("a task file's list: inside written, outside denied as path_not_writable; the end says how to allow a file", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    const task = writeGeneralTask(sb, { id: "u182-task", policy: { writablePaths: ["out"] } }, writes("out/a.txt", "b.txt"));
    const { run: ran, decisions } = await run(sb, ["run", "--task", task]);
    assert.deepEqual(decisions, ["allowed", "path/path_not_writable"]);
    assert.ok(existsSync(path.join(sb.workspace, "out", "a.txt")));
    assert.equal(existsSync(path.join(sb.workspace, "b.txt")), false);
    assert.ok(ran.stderr.includes(hintLine(createMessageCatalog("en"), 1)), ran.stderr);
    const ko = await run(sb, ["run", "--task", task], "ko");
    assert.ok(ko.run.stderr.includes(hintLine(createMessageCatalog("ko"), 1)), ko.run.stderr);
  });

  test("the config file's list holds under a task file too, and two lists intersect", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, policy: { ...POLICY, writablePaths: ["out"] } }, "c.json");
    const plain = writeGeneralTask(sb, { id: "u182-config" }, writes("out/a.txt", "b.txt"));
    assert.deepEqual((await run(sb, ["run", "--task", plain, "--config", config])).decisions, ["allowed", "path/path_not_writable"]);
    const both = writeGeneralTask(sb, { id: "u182-both", policy: { writablePaths: ["out/c.txt", "d.txt"] } }, writes("out/c.txt", "d.txt", "out/e.txt"));
    // out/c.txt: both lists; d.txt: not the config's; out/e.txt: not the task's.
    assert.deepEqual((await run(sb, ["run", "--task", both, "--config", config])).decisions, ["allowed", "path/path_not_writable", "path/path_not_writable"]);
  });

  test("a profile's list and a task type definition's list", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    const profiled = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, profiles: { p: { policy: { ...POLICY, writablePaths: ["out"] } } } }, "p.json");
    const plain = writeGeneralTask(sb, { id: "u182-profile" }, writes("out/a.txt", "b.txt"));
    assert.deepEqual((await run(sb, ["run", "--task", plain, "--config", profiled, "--profile", "p"])).decisions, ["allowed", "path/path_not_writable"]);
    const defined = writeConfigFile(
      sb,
      { schemaVersion: 1, limits: LIMITS, workflows: { d: { tools: ["read_file", "search_files", "write_file"], policy: { ...POLICY, writablePaths: ["out"] } } } },
      "d.json",
    );
    const typed = writeGeneralTask(sb, { id: "u182-definition", fields: { workflowRef: "d" } }, writes("out/f.txt", "g.txt"));
    assert.deepEqual((await run(sb, ["run", "--task", typed, "--config", defined])).decisions, ["allowed", "path/path_not_writable"]);
  });

  test("an empty list: no file may be written; a protected path inside a list stays protected", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    const none = writeGeneralTask(sb, { id: "u182-empty", policy: { writablePaths: [] } }, writes("a.txt"));
    assert.deepEqual((await run(sb, ["run", "--task", none])).decisions, ["path/path_not_writable"]);
    const guarded = writeGeneralTask(sb, { id: "u182-protected", policy: { writablePaths: ["out"], protectedPaths: ["out/secret.txt"] } }, writes("out/secret.txt"));
    assert.deepEqual((await run(sb, ["run", "--task", guarded])).decisions, ["path/protected_path"]);
  });

  test("a plan run's plan actions and an apply are judged by the lists too", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    writeOrganizeWorkspace(sb);
    // The plan moves into docs/, data/ and images/; a list without data/ refuses the plan.
    const narrow = writeOrganizeTask(sb, "u182-organize", organizeScript(), { writablePaths: ["inbox", "docs", "images"] });
    const refused = await runGuarded(sb, ["run", "--task", narrow], cliEnv());
    const result = JSON.parse(refused.stdout.trim()) as { kind: string; runId: string; reason: string };
    assert.equal(result.kind, "run", refused.stdout);
    assert.notEqual(result.reason, "plan_pending", refused.stderr);
    const journal = (runId: string): string => readFileSync(path.join(sb.workspace, ".codaryn", "runs", runId, "journal.jsonl"), "utf8");
    assert.ok(journal(result.runId).includes("path_not_writable"), "the plan's action was denied as not writable");
    // A plan made without lists, applied with a task whose list leaves out data/: nothing reaches data/.
    const open = writeOrganizeTask(sb, "u182-organize", organizeScript());
    const made = JSON.parse((await runGuarded(sb, ["run", "--task", open], cliEnv())).stdout.trim()) as { runId: string; reason: string; plan: { digest: string } };
    assert.equal(made.reason, "plan_pending");
    writeOrganizeTask(sb, "u182-organize", organizeScript(), { writablePaths: ["inbox", "docs", "images"] });
    const applied = await runGuarded(sb, ["apply", "--task", open, "--run", made.runId, "--digest", made.plan.digest.slice(0, 12)], cliEnv());
    const outcome = JSON.parse(applied.stdout.trim()) as { kind: string; runId: string; status: string; reason: string };
    assert.equal(outcome.kind, "apply", applied.stdout);
    assert.equal(`${outcome.status}/${outcome.reason}`, "failed/plan_stale", applied.stdout);
    // The preflight refuses action #2 (inbox/budget.csv -> data/budget.csv) under the apply's lists.
    const checked = journal(outcome.runId).split("\n").find((line) => line.includes('"type":"plan_checked"')) ?? "";
    assert.deepEqual((JSON.parse(checked) as { problems: unknown }).problems, [{ index: 1, problem: "denied" }]);
    assert.equal(existsSync(path.join(sb.workspace, "data", "budget.csv")), false, "nothing moved into data/");
    assert.ok(existsSync(path.join(sb.workspace, "inbox", "budget.csv")), "the source stays");
  });
});

describe("U-182: doctor warns when writable lists and command rules come together (B-8)", () => {
  async function commandsCheck(sb: Sandbox, policy: JsonObject): Promise<{ status: string; text?: { id: string }; notes?: { id: string }[] }> {
    const task = writeGeneralTask(sb, { id: "u182-doctor", policy }, writes("a.txt"));
    const ran = await runGuarded(sb, ["doctor", "--task", task, "--json"], cliEnv());
    const output = JSON.parse(ran.stdout.trim()) as { checks: { id: string; status: string; text?: { id: string }; notes?: { id: string }[] }[] };
    const check = output.checks.find((entry) => entry.id === "commands");
    assert.ok(check !== undefined, ran.stdout);
    return check;
  }

  test("a list with a command rule: warn; either alone: as before", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    const script = path.join(sb.base, "tool.js");
    writeFileSync(script, "process.exit(0)\n");
    const rule = { ...nodeCommand(script), argsPrefix: [script] } as unknown as JsonObject;
    const together = await commandsCheck(sb, { commands: [rule], writablePaths: ["out"] });
    assert.equal(together.status, "warn");
    assert.equal(together.text?.id, "doctor.commands.writable_with_commands");
    const commandOnly = await commandsCheck(sb, { commands: [rule] });
    assert.equal(commandOnly.status, "ok");
    const listOnly = await commandsCheck(sb, { writablePaths: ["out"] });
    assert.equal(listOnly.status, "skipped");
  });
});
