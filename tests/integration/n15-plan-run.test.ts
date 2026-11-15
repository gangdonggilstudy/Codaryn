/**
 * U-217 (DR-69, DR-74; bundle B-4: U-187, U-191, U-195, U-198; Codex V-11, V-14,
 * docs/reviews/2026-11-13-v14-codex-verify-bundle-b4.md): a plan of kind "changes" (a task type with
 * plan "run") carried out by the real CLI, where the unit tests (tests/unit/cli/g-u195-apply-run-plan,
 * tests/unit/engine/u187-approved-plan-run and the others) do not reach. Scripted model, no key,
 * every command behind the network guard. Each case keeps the user's files (all but `.codaryn`) by
 * SHA-256 and the model requests of every run, so "nothing was written" and "no model request"
 * are read from the workspace, not from the result alone.
 * - end to end: run → plan (JSON and text) → apply with the digest's first 12 characters → result,
 *   runs, both reports, changes, a second apply refused, revert back to the bytes before; the
 *   carrying run is given the plan run's goal even after the task's goal was changed;
 * - nothing is written without an approval: writes the plan run tries, an apply without a digest
 *   and with a wrong one, a run id the workspace has no records of, a workspace without records;
 * - writes outside the approved files: refused, counted in the end summary with its own line and
 *   the advice to make a new plan, not the writablePaths advice;
 * - the approved files changed after approval (modified, a create path taken, a folder on the way
 *   turned into a link): failed/plan_stale before any model request, the plan not claimed;
 * - the plan run's goal cannot be read (journal gone, its first model request gone): refused;
 * - writablePaths and the plan's files as two lists: a list narrowed after approval stops the run
 *   before the model; a file the list allows but the plan does not name is refused.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { JournalRecord, JsonObject, ScriptStep } from "../../src/contracts/index.js";
import { createMessageCatalog } from "../../src/i18n/index.js";
import { writeConfigFile } from "../fixtures/anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { createFileArgs, sha256Of, textStep, toolStep, UNREQUESTED_STEP, writeGeneralTask } from "../fixtures/general-tasks.js";
import { cliEnv } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { runGuarded } from "../support/fake-anthropic.js";

const OLD_GUIDE = "old guide\n";
const NEW_GUIDE = "new guide\n";
const NEW_PAGE = "new page\n";
const GOAL = "U-217 original goal: explain installation for first-time users";
const SUMMARY = "U-217 plan summary: rewrite the guide and add a checklist page";
const PLANNED = [
  { path: "docs/guide.md", change: "modify" },
  { path: "docs/new.md", change: "create" },
] as const;
const LIMITS = { maxModelTurns: 8, maxToolCalls: 24, maxTotalTokens: 1000, maxDurationMs: 60_000 };
const CATALOG = createMessageCatalog("en");
const format = (id: string, params: object = {}): string => (CATALOG.format as (id: string, params: object) => string)(id, params);

type Json = Record<string, unknown>;

interface Case {
  readonly sb: Sandbox;
  /** `--task <task> --config <config>`. */
  readonly form: readonly string[];
  /** Rewrites the task file with these policy fields (and the goal), as a person editing it would. */
  task(policy?: JsonObject, goal?: string): void;
  /** Rewrites the config file with these top-level policy fields. */
  config(policy?: JsonObject): void;
}

/**
 * A workspace with `docs/guide.md` (OLD_GUIDE) and `keep.txt`, a config whose task type "rewrite"
 * has the file tools, propose_changes and plan "run", and a task file that picks it. The task's
 * verifier passes once the guide is rewritten and the new page exists.
 */
function setup(t: TestContext, taskPolicy: JsonObject = {}, configPolicy: JsonObject = {}): Case {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "docs/guide.md", OLD_GUIDE);
  writeWorkspaceFile(sb, "keep.txt", "untouched\n");
  let configPath = "";
  const config = (policy: JsonObject = {}): void => {
    configPath = writeConfigFile(sb, {
      schemaVersion: 1,
      language: "en",
      limits: { ...LIMITS, maxTotalTokens: 200_000 },
      ...(Object.keys(policy).length === 0 ? {} : { policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, ...policy } }),
      workflows: { rewrite: { tools: ["read_file", "search_files", "write_file", "propose_changes"], plan: "run" } },
    });
  };
  const task = (policy: JsonObject = {}, goal = GOAL): void => {
    writeGeneralTask(sb, {
      id: "u217-plan-run",
      goal,
      fields: { workflowRef: "rewrite" },
      policy,
      verifiers: [
        {
          id: "guide",
          kind: "file_rules",
          rules: [
            { type: "contains", path: "docs/guide.md", text: "new guide" },
            { type: "exists", path: "docs/new.md" },
          ],
        },
      ],
    });
  };
  config(configPolicy);
  task(taskPolicy);
  return { sb, form: ["--task", sb.taskPath, "--config", configPath], task, config };
}

function script(sb: Sandbox, steps: readonly ScriptStep[]): void {
  writeFileSync(sb.scriptPath, JSON.stringify({ schemaVersion: 1, steps }, null, 2));
}

/** `write_file` replacing the whole of a file whose bytes are `current`. */
const replaceAll = (file: string, current: string, content: string): ScriptStep =>
  toolStep("write_file", { path: file, expectedHash: sha256Of(current), change: { kind: "replace_all", content } });

/** What the carrying run's model does: `before`, the two approved writes, then its answer. */
function carryScript(sb: Sandbox, before: readonly ScriptStep[] = []): void {
  script(sb, [...before, replaceAll("docs/guide.md", OLD_GUIDE, NEW_GUIDE), toolStep("write_file", createFileArgs("docs/new.md", NEW_PAGE)), textStep("complete")]);
}

const env = (): NodeJS.ProcessEnv => cliEnv({ extra: { CODARYN_LANG: "en" } });

async function cli(sb: Sandbox, args: readonly string[]): Promise<{ run: CliRun; json: Json }> {
  const run = await runGuarded(sb, args, env());
  const last = run.stdout.trim().split("\n").pop() ?? "";
  assert.notEqual(last, "", `no output for ${args[0]}; stderr: ${run.stderr}`);
  return { run, json: JSON.parse(last) as Json };
}

interface Plan {
  readonly id: string;
  readonly digest: string;
}

/** The plan run: reads the guide, proposes PLANNED; anything after the proposal must not be asked. */
async function makePlan(c: Case, before: readonly ScriptStep[] = []): Promise<Plan> {
  script(c.sb, [...before, toolStep("read_file", { path: "docs/guide.md" }), toolStep("propose_changes", { summary: SUMMARY, files: PLANNED.map((file) => ({ ...file })) }), UNREQUESTED_STEP]);
  const { run, json } = await cli(c.sb, ["run", ...c.form]);
  assert.equal(json.kind, "run", run.stderr);
  assert.equal(json.reason, "plan_pending", `${JSON.stringify(json)}\n${run.stderr}`);
  const plan = json.plan as Json;
  return { id: json.runId as string, digest: plan.digest as string };
}

function apply(c: Case, plan: Plan, digest: string | null = plan.digest.slice(0, 12)): Promise<{ run: CliRun; json: Json }> {
  return cli(c.sb, ["apply", ...c.form, "--run", plan.id, ...(digest === null ? [] : ["--digest", digest])]);
}

/** The user's files (everything but `.codaryn`), path → SHA-256 ("link" for a link). */
function userFiles(sb: Sandbox): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (prefix === "" && entry.name === ".codaryn") continue;
      const full = path.join(dir, entry.name);
      // A link is kept as a link, never followed (the stale case turns a folder into one).
      if (entry.isSymbolicLink()) out.set(`${prefix}${entry.name}`, "link");
      else if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
      else out.set(`${prefix}${entry.name}`, sha256Of(readFileSync(full)));
    }
  };
  walk(sb.workspace, "");
  return out;
}

function journal(sb: Sandbox, runId: string): JournalRecord[] {
  const file = path.join(sb.workspace, ".codaryn", "runs", runId, "journal.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JournalRecord);
}

/** Model requests recorded by every run of the workspace. */
function modelRequests(sb: Sandbox): number {
  const runs = path.join(sb.workspace, ".codaryn", "runs");
  if (!existsSync(runs)) return 0;
  return readdirSync(runs).reduce((sum, id) => sum + journal(sb, id).filter((record) => record.type === "model_request").length, 0);
}

/** The run's tool decisions in order: "allowed", or "<permission>/<code>". */
function decisions(sb: Sandbox, runId: string): string[] {
  return journal(sb, runId).flatMap((record) => (record.type === "tool_decision" ? [record.allowed ? "allowed" : `${record.permission ?? "?"}/${record.code ?? "?"}`] : []));
}

const read = (sb: Sandbox, file: string): string => readFileSync(path.join(sb.workspace, ...file.split("/")), "utf8");
const exists = (sb: Sandbox, file: string): boolean => existsSync(path.join(sb.workspace, ...file.split("/")));

async function planView(c: Case, plan: Plan): Promise<Json> {
  const { json } = await cli(c.sb, ["plan", ...c.form, "--run", plan.id, "--json"]);
  assert.equal(json.kind, "plan", JSON.stringify(json));
  return json;
}

/** A refusal before anything is asked: exit 2, the code, no model request, the user's files as they were. */
async function expectRefused(c: Case, plan: Plan, code: string, digest?: string | null): Promise<Json> {
  const before = userFiles(c.sb);
  const requests = modelRequests(c.sb);
  const { run, json } = await apply(c, plan, digest);
  assert.equal(json.kind, "error", `${code}: ${JSON.stringify(json)}`);
  assert.equal(json.code, code, `${JSON.stringify(json)}\n${run.stderr}`);
  assert.equal(run.exitCode, 2, code);
  assert.deepEqual(userFiles(c.sb), before, `${code}: the user's files`);
  assert.equal(modelRequests(c.sb), requests, `${code}: no model request`);
  return json;
}

/** failed/plan_stale before the model: exit 1, no turn, no tool call, nothing written, the plan not claimed. */
async function expectStale(c: Case, plan: Plan, notice: string): Promise<void> {
  const before = userFiles(c.sb);
  const requests = modelRequests(c.sb);
  const { run, json } = await apply(c, plan);
  assert.equal(json.kind, "run", `${JSON.stringify(json)}\n${run.stderr}`);
  assert.deepEqual([json.status, json.reason, run.exitCode], ["failed", "plan_stale", 1], `${JSON.stringify(json)}\n${run.stderr}`);
  const usage = json.usage as Json;
  assert.deepEqual([usage.modelTurns, usage.toolCalls], [0, 0]);
  assert.deepEqual(json.changes, []);
  assert.ok((json.notices as string[]).some((line) => line.includes(notice)), `notice ${JSON.stringify(notice)} in ${JSON.stringify(json.notices)}`);
  assert.equal(modelRequests(c.sb), requests, "no model request");
  assert.equal(journal(c.sb, json.runId as string).filter((record) => record.type === "model_request").length, 0);
  assert.deepEqual(userFiles(c.sb), before, "the user's files");
  assert.equal((await planView(c, plan)).status, "pending", "the plan is not claimed");
}

test("U-217: end to end - run, plan, apply with the digest, result, runs, reports, changes, a second apply refused, revert", { timeout: 180_000 }, async (t) => {
  const c = setup(t);
  const start = userFiles(c.sb);
  const plan = await makePlan(c);
  assert.deepEqual(userFiles(c.sb), start, "the plan run writes nothing");

  const view = await planView(c, plan);
  assert.deepEqual([view.planKind, view.status, view.digest, view.appliedBy], ["changes", "pending", plan.digest, null]);
  assert.deepEqual((view.files as Json[]).map((file) => ({ path: file.path, change: file.change })), PLANNED.map((file) => ({ ...file })));
  assert.equal(view.summary, SUMMARY);
  const text = await runGuarded(c.sb, ["plan", ...c.form, "--run", plan.id], env());
  for (const part of ["docs/guide.md", "docs/new.md", SUMMARY, plan.digest]) assert.ok(text.stdout.includes(part), `plan text holds ${part}:\n${text.stdout}`);

  // B-7: the carrying run is given the plan run's goal, not the task's goal now.
  c.task({}, "U-217 a changed goal that must not replace the plan run's");
  carryScript(c.sb);
  const { run, json } = await apply(c, plan);
  assert.deepEqual([json.kind, json.status, json.reason, run.exitCode], ["run", "done", "verified", 0], `${JSON.stringify(json)}\n${run.stderr}`);
  assert.deepEqual([json.planRunId, json.planDigest], [plan.id, plan.digest]);
  const applyId = json.runId as string;
  assert.notEqual(applyId, plan.id);
  assert.deepEqual([read(c.sb, "docs/guide.md"), read(c.sb, "docs/new.md"), read(c.sb, "keep.txt")], [NEW_GUIDE, NEW_PAGE, "untouched\n"]);
  const firstRequest = (runId: string): Extract<JournalRecord, { type: "model_request" }> => {
    const found = journal(c.sb, runId).find((record) => record.type === "model_request");
    assert.ok(found !== undefined && found.type === "model_request", `a model request in ${runId}`);
    return found;
  };
  const carried = firstRequest(applyId);
  assert.equal((carried.newMessages[0] as Json).content, GOAL);
  assert.equal((carried.newMessages[0] as Json).content, (firstRequest(plan.id).newMessages[0] as Json).content);
  assert.ok((carried.system ?? "").includes(SUMMARY), "the approved summary is in the system text");
  assert.ok(!(carried.system ?? "").includes("changed goal"));
  const started = journal(c.sb, applyId).find((record) => record.type === "run_started") as Json | undefined;
  assert.deepEqual([started?.planRunId, started?.planDigest, started?.approval], [plan.id, plan.digest, "cli-flag"]);

  const applied = await planView(c, plan);
  assert.equal(applied.status, "applied");
  assert.equal((applied.appliedBy as Json).runId, applyId);
  const runs = (await cli(c.sb, ["runs", "--workspace", c.sb.workspace, "--json"])).json.runs as Json[];
  assert.equal(runs.find((entry) => entry.runId === applyId)?.planRunId, plan.id);
  const report = (await cli(c.sb, ["report", "--workspace", c.sb.workspace, "--run", applyId, "--json"])).json;
  assert.deepEqual([(report.result as Json).planRunId, (report.result as Json).planDigest], [plan.id, plan.digest]);
  const reportText = await runGuarded(c.sb, ["report", "--workspace", c.sb.workspace, "--run", applyId], env());
  assert.ok(reportText.stdout.includes(plan.id) && reportText.stdout.includes(plan.digest), reportText.stdout);
  const planReport = await runGuarded(c.sb, ["report", "--workspace", c.sb.workspace, "--run", plan.id], env());
  assert.ok(planReport.stdout.includes(applyId), `the plan run's report names the run that carried it out:\n${planReport.stdout}`);
  const changes = await cli(c.sb, ["changes", ...c.form, "--run", applyId, "--json"]);
  assert.equal(changes.run.exitCode, 0, changes.run.stderr);
  for (const file of ["docs/guide.md", "docs/new.md"]) assert.ok(changes.run.stdout.includes(file), changes.run.stdout);
  const changesText = await runGuarded(c.sb, ["changes", ...c.form, "--run", applyId], env());
  for (const part of ["old guide", "new guide", "new page"]) assert.ok(changesText.stdout.includes(part), changesText.stdout);

  // Once only: the plan cannot be carried out again.
  const done = userFiles(c.sb);
  carryScript(c.sb);
  await expectRefused(c, plan, "plan_already_applied");
  assert.deepEqual(userFiles(c.sb), done);

  const reverted = await cli(c.sb, ["revert", "--workspace", c.sb.workspace, "--run", applyId]);
  assert.equal(reverted.json.status, "complete", JSON.stringify(reverted.json));
  assert.deepEqual(userFiles(c.sb), start, "revert brings back every byte and removes the created file");
});

test("U-217: nothing is written without an approval - the plan run's writes, no digest, a wrong digest, an unknown run, a workspace without records", { timeout: 180_000 }, async (t) => {
  // The plan run's model tries to write before proposing: refused, and the plan is still made.
  const c = setup(t);
  const start = userFiles(c.sb);
  const plan = await makePlan(c, [replaceAll("docs/guide.md", OLD_GUIDE, "UNAPPROVED\n"), toolStep("write_file", createFileArgs("outside.txt", "UNAPPROVED\n"))]);
  assert.deepEqual(userFiles(c.sb), start, "the plan run's writes changed nothing");
  const planDecisions = decisions(c.sb, plan.id);
  assert.equal(planDecisions.length, 4, planDecisions.join(", "));
  assert.ok(planDecisions.slice(0, 2).every((decision) => decision !== "allowed"), `the writes are refused: ${planDecisions.join(", ")}`);
  assert.equal(journal(c.sb, plan.id).filter((record) => record.type === "model_request").length, 4);

  carryScript(c.sb);
  // Not a terminal: no question can be asked, so an apply needs --digest.
  await expectRefused(c, plan, "plan_not_approved", null);
  await expectRefused(c, plan, "plan_not_approved", "0".repeat(12));
  await expectRefused(c, plan, "plan_not_approved", plan.digest.slice(0, 11) + (plan.digest[11] === "0" ? "1" : "0"));
  // A run id of the right form the workspace has no records of.
  await expectRefused(c, { id: "20261113T000000Z-00000000", digest: plan.digest }, "run_not_found");
  assert.equal((await planView(c, plan)).status, "pending");

  // Another workspace without records, given the plan's run id and digest.
  const other = setup(t);
  carryScript(other.sb);
  await expectRefused(other, plan, "run_not_found");
  assert.equal(existsSync(path.join(other.sb.workspace, ".codaryn", "runs", plan.id)), false);

  // The same plan, approved, still runs: none of the refusals claimed it.
  const { json } = await apply(c, plan);
  assert.deepEqual([json.status, json.reason], ["done", "verified"], JSON.stringify(json));
});

test("U-217: writes outside the approved files are refused and the end summary counts them with the new-plan advice", { timeout: 120_000 }, async (t) => {
  const c = setup(t);
  const plan = await makePlan(c);
  // A tool the task type does not offer (run_command), a file outside the plan and one whose name
  // starts like a planned one.
  carryScript(c.sb, [
    toolStep("run_command", { executable: "forbidden", args: [] }),
    toolStep("write_file", createFileArgs("not-approved.txt", "BAD\n")),
    toolStep("write_file", createFileArgs("docs/guide.md.extra", "BAD\n")),
  ]);
  const { run, json } = await apply(c, plan);
  assert.deepEqual([json.status, json.reason, run.exitCode], ["done", "verified", 0], `${JSON.stringify(json)}\n${run.stderr}`);
  const made = decisions(c.sb, json.runId as string);
  assert.ok(made[0]?.endsWith("/unknown_tool"), made.join(", "));
  assert.deepEqual(made.slice(1), ["path/path_not_writable", "path/path_not_writable", "allowed", "allowed"]);
  assert.deepEqual([exists(c.sb, "not-approved.txt"), exists(c.sb, "docs/guide.md.extra")], [false, false]);
  assert.deepEqual([read(c.sb, "docs/guide.md"), read(c.sb, "docs/new.md")], [NEW_GUIDE, NEW_PAGE]);
  // U-198, Codex V-14 L-1: the general count, the plan's own line and its advice; not the writablePaths advice.
  assert.ok(run.stderr.includes(format("summary.denied", { count: 3 })), run.stderr);
  assert.ok(run.stderr.includes(format("summary.denied_not_planned", { count: 2 })), run.stderr);
  assert.ok(run.stderr.includes(format("summary.denied_not_planned_hint")), run.stderr);
  assert.ok(!run.stderr.includes("writablePaths"), `no writablePaths advice for a plan's list:\n${run.stderr}`);
});

test("U-217: approved files changed after approval end the run as plan_stale before any model request", { timeout: 180_000 }, async (t) => {
  // The file to modify changed; then put back, the same plan still runs (it was not claimed).
  const modified = setup(t);
  const plan = await makePlan(modified);
  carryScript(modified.sb);
  writeWorkspaceFile(modified.sb, "docs/guide.md", "edited by someone else\n");
  await expectStale(modified, plan, "the approved plan no longer fits the workspace: file 0 ");
  writeWorkspaceFile(modified.sb, "docs/guide.md", OLD_GUIDE);
  const again = await apply(modified, plan);
  assert.deepEqual([again.json.status, again.json.reason], ["done", "verified"], JSON.stringify(again.json));

  // The file to modify removed, and the path to create taken.
  const removed = setup(t);
  const removedPlan = await makePlan(removed);
  carryScript(removed.sb);
  rmSync(path.join(removed.sb.workspace, "docs", "guide.md"));
  await expectStale(removed, removedPlan, "file 0 ");
  const taken = setup(t);
  const takenPlan = await makePlan(taken);
  carryScript(taken.sb);
  writeWorkspaceFile(taken.sb, "docs/new.md", "made by someone else\n");
  await expectStale(taken, takenPlan, "the approved plan no longer fits the workspace: file 1 ");

  // Codex V-11: the approved files' folder turned into a link (a junction to a copy with the same bytes).
  const linked = setup(t);
  const linkedPlan = await makePlan(linked);
  carryScript(linked.sb);
  renameSync(path.join(linked.sb.workspace, "docs"), path.join(linked.sb.workspace, "docs-real"));
  try {
    symlinkSync(path.join(linked.sb.workspace, "docs-real"), path.join(linked.sb.workspace, "docs"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.diagnostic(`a link could not be made, the link case is left out: ${String(error)}`);
    return;
  }
  assert.equal(read(linked.sb, "docs/guide.md"), OLD_GUIDE, "the same bytes through the link");
  await expectStale(linked, linkedPlan, "the approved plan no longer fits the workspace: file 0 ");
  assert.equal(read(linked.sb, "docs-real/guide.md"), OLD_GUIDE);
  assert.equal(exists(linked.sb, "docs-real/new.md"), false);
});

test("U-217: a plan whose run's goal cannot be read is refused before anything is asked", { timeout: 120_000 }, async (t) => {
  // The plan run's journal gone.
  const gone = setup(t);
  const gonePlan = await makePlan(gone);
  carryScript(gone.sb);
  rmSync(path.join(gone.sb.workspace, ".codaryn", "runs", gonePlan.id, "journal.jsonl"));
  await expectRefused(gone, gonePlan, "invalid_run_record");

  // Only its first model request (the one holding the goal) gone.
  const first = setup(t);
  const firstPlan = await makePlan(first);
  carryScript(first.sb);
  const file = path.join(first.sb.workspace, ".codaryn", "runs", firstPlan.id, "journal.jsonl");
  const kept = journal(first.sb, firstPlan.id).filter((record) => !(record.type === "model_request" && record.turn === 1));
  writeFileSync(file, kept.map((record) => `${JSON.stringify(record)}\n`).join(""));
  const refused = await expectRefused(first, firstPlan, "invalid_run_record");
  assert.ok(String(refused.message).includes("do not hold the goal"), String(refused.message));
});

test("U-217: writablePaths and the plan's files are two lists - narrowed after approval it stops the run; allowed but not planned is refused", { timeout: 180_000 }, async (t) => {
  // Narrowed in the task file, then in the config file: the run stops before the model, the plan not
  // claimed; widened again, the same plan runs.
  for (const place of ["task", "config"] as const) {
    const c = place === "task" ? setup(t, { writablePaths: ["docs"] }) : setup(t, {}, { writablePaths: ["docs"] });
    const plan = await makePlan(c);
    carryScript(c.sb);
    if (place === "task") c.task({ writablePaths: ["docs/guide.md"] });
    else c.config({ writablePaths: ["docs/guide.md"] });
    await expectStale(c, plan, "the approved plan is not allowed by the policy now: file 1: path/path_not_writable");
    if (place === "task") c.task({ writablePaths: ["docs"] });
    else c.config({ writablePaths: ["docs"] });
    const { json } = await apply(c, plan);
    assert.deepEqual([json.status, json.reason], ["done", "verified"], `${place}: ${JSON.stringify(json)}`);
  }

  // A file writablePaths allows but the plan does not name, and one neither allows: both refused,
  // counted as outside the plan (no writablePaths entry would let them through).
  const c = setup(t, { writablePaths: ["docs"] });
  const plan = await makePlan(c);
  carryScript(c.sb, [toolStep("write_file", createFileArgs("docs/other.md", "BAD\n")), replaceAll("keep.txt", "untouched\n", "BAD\n")]);
  const { run, json } = await apply(c, plan);
  assert.deepEqual([json.status, json.reason], ["done", "verified"], `${JSON.stringify(json)}\n${run.stderr}`);
  assert.deepEqual(decisions(c.sb, json.runId as string), ["path/path_not_writable", "path/path_not_writable", "allowed", "allowed"]);
  assert.deepEqual([exists(c.sb, "docs/other.md"), read(c.sb, "keep.txt")], [false, "untouched\n"]);
  assert.ok(run.stderr.includes(format("summary.denied_not_planned", { count: 2 })), run.stderr);
  assert.ok(!run.stderr.includes(format("progress.not_writable_hint", { count: 2 })), run.stderr);
});
