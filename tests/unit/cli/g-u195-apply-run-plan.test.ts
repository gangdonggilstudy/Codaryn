/**
 * U-195 (DR-69 B-3, B-4; PM decisions 1 and 2): codaryn plan and apply choose by the plan's kind.
 * - plan: a run plan (kind "changes") is shown as ChangesPlanOutput (U-191's view), JSON and text.
 * - apply of a run plan: the approval of a plan of mode apply, then a model run that carries it out
 *   (runPrepared with the approved plan; the engine's runApprovedPlan): EngineResult with planRunId
 *   and planDigest, the planned files written, the plan claimed once (applied.json). The run is
 *   given the plan run's own goal from its records, never the model's summary; a goal that cannot be
 *   read starts nothing. The refusals come before anything is asked, sent or written.
 * - one assembly (createAssemble): a host's hooks reach it, also for such a run.
 * - a task resolved to plan "apply" refuses a run plan, and the other way round.
 * U-177 still has the parsers refuse plan "run" (until U-187's fix), so no task resolves to it from
 * the command line yet: the plan run is made in-process with the real assembly and engine, and the
 * apply path is called through its exported function (applyChangesPlan) with a task resolved to
 * plan "run". New exports are reached loosely, so this file builds before they exist.
 * Scripted model, temporary folders; no network.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { PLAN_APPLIED_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { CliErrorOutput, EngineResult, ResolvedTaskSpec } from "../../../src/contracts/index.js";
import type { RunArgs } from "../../../src/cli/args.js";
import * as assembleModule from "../../../src/cli/assemble.js";
import type { Assemble } from "../../../src/cli/assemble.js";
import * as planCommands from "../../../src/cli/plan-commands.js";
import type { ApplyCommandEnvironment, PlanCommandEnvironment } from "../../../src/cli/plan-commands.js";
import { prepareTask } from "../../../src/cli/run.js";
import type { PreparedTask, RunNotes } from "../../../src/cli/run.js";
import { createRunId } from "../../../src/cli/run-id.js";
import { runTask } from "../../../src/engine/index.js";
import { createScriptedProvider, parseScript } from "../../../src/model/index.js";
import { cliIo, setupRun } from "./k-support.js";

const GOAL = "rewrite the guide for new users";
const SUMMARY = "rewrite docs/guide.md and add docs/new.md";
const OLD_GUIDE = "old guide\n";
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const notes = (): RunNotes => ({ configLanguage: null, configDefault: null, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0 });

type Outcome = { readonly output: unknown; readonly exitCode: number } | { readonly text: string; readonly exitCode: number };
interface PreparedPlan {
  readonly runId: string;
  readonly workspaceRoot: string;
  readonly notes: RunNotes;
  readonly prepared: PreparedTask;
}
type ApplyChangesPlan = (io: ApplyCommandEnvironment, args: object, value: PreparedPlan) => Promise<Outcome>;
const applyChangesPlan = (planCommands as unknown as { applyChangesPlan?: ApplyChangesPlan }).applyChangesPlan;
const createAssemble = (assembleModule as unknown as { createAssemble?: (hooks: object) => Assemble }).createAssemble;

interface Made {
  readonly base: string;
  readonly taskPath: string;
  readonly planRunId: string;
  readonly digest: string;
  readonly value: PreparedPlan;
}

/** A run plan made in-process: a task resolved to plan "run" (the parsers still refuse it), the real assembly and engine. */
async function makeRunPlan(): Promise<Made> {
  const base = await setupRun({ "README.md": "# Title\n", "docs/guide.md": OLD_GUIDE }, { goal: GOAL }, [{ text: "unused" }]);
  const taskPath = path.join(base, "task.json");
  const io = cliIo(base);
  const args: RunArgs = { command: "run", input: { kind: "task", taskPath }, configPath: null, varsFile: null, cancelFile: null, quiet: true, profile: null, workflow: null };
  const runNotes = notes();
  const ready = await prepareTask(io, args, runNotes);
  assert.ok("prepared" in ready, JSON.stringify(ready));
  const task = { ...ready.prepared.task, plan: "run", tools: ["read_file", "search_files", "write_file", "propose_changes"] } as ResolvedTaskSpec;
  const script = parseScript({
    schemaVersion: 1,
    steps: [
      { toolCalls: [{ name: "read_file", args: { path: "docs/guide.md" } }] },
      { toolCalls: [{ name: "propose_changes", args: { summary: SUMMARY, files: [{ path: "docs/guide.md", change: "modify" }, { path: "docs/new.md", change: "create" }] } }] },
      { text: "not requested" },
    ],
  });
  assert.ok(script.ok);
  const planRunId = createRunId(new Date(), (size) => randomBytes(size));
  const assembled = await assembleModule.assembleRun({
    task,
    runId: planRunId,
    model: createScriptedProvider(script.script),
    secrets: [...ready.prepared.secrets],
    clock: io.clock,
    signal: new AbortController().signal,
  });
  assert.ok(assembled.ok);
  let result: EngineResult | null = null;
  try {
    result = await runTask(assembled.deps);
  } finally {
    await assembled.finish(result);
  }
  assert.equal(result?.reason, "plan_pending", JSON.stringify(result));
  assert.equal(result?.plan?.kind, "changes");
  const workspaceRoot = await realpath(path.join(base, "work"));
  return { base, taskPath, planRunId, digest: result?.plan?.digest ?? "", value: { prepared: { ...ready.prepared, task }, workspaceRoot, runId: planRunId, notes: runNotes } };
}

const applyArgs = (made: Made, overrides: object = {}): object => ({
  command: "apply",
  form: { input: { kind: "task", taskPath: made.taskPath }, configPath: null, varsFile: null, profile: null, workflow: null },
  runId: made.planRunId,
  digest: made.digest.slice(0, 12),
  allowUnsafeMove: false,
  cancelFile: null,
  quiet: true,
  ...overrides,
});

/** The apply run's script: write both planned files, then finish. */
async function writeApplyScript(base: string): Promise<void> {
  const steps = [
    { toolCalls: [{ name: "write_file", args: { path: "docs/guide.md", expectedHash: sha256(OLD_GUIDE), change: { kind: "replace_all", content: "new guide\n" } } }] },
    { toolCalls: [{ name: "write_file", args: { path: "docs/new.md", expectedHash: null, change: { kind: "replace_all", content: "new page\n" } } }] },
    { text: "done" },
  ];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
}

function applyIo(made: Made, extra: Partial<ApplyCommandEnvironment> = {}): ApplyCommandEnvironment {
  return { ...cliIo(made.base), argv: [], run: cliIo(made.base), ...extra } as unknown as ApplyCommandEnvironment;
}

const errorOf = (outcome: Outcome): CliErrorOutput => {
  assert.ok("output" in outcome, JSON.stringify(outcome));
  const output = outcome.output as CliErrorOutput;
  assert.equal(output.kind, "error", JSON.stringify(output));
  return output;
};

const runDir = (made: Made, runId: string): string => path.join(made.base, "work", STATE_DIR_NAME, RUNS_DIR_NAME, runId);
async function firstUserMessage(made: Made, runId: string): Promise<{ system: string; user: string }> {
  const lines = (await readFile(path.join(runDir(made, runId), "journal.jsonl"), "utf8")).split("\n").filter((line) => line.length > 0);
  const request = lines.map((line) => JSON.parse(line) as { type: string; system?: string; newMessages?: { content?: string }[] }).find((record) => record.type === "model_request");
  return { system: request?.system ?? "", user: request?.newMessages?.[0]?.content ?? "" };
}

describe("U-195: codaryn plan shows a run plan", () => {
  test("--json: ChangesPlanOutput with the files and the summary; text: U-191's view", { timeout: 60_000 }, async () => {
    const made = await makeRunPlan();
    const io = (argv: readonly string[]): PlanCommandEnvironment => ({ ...cliIo(made.base), argv }) as PlanCommandEnvironment;
    const json = (await planCommands.runPlan(io(["plan", "--task", made.taskPath, "--run", made.planRunId, "--json"]))) as Outcome;
    assert.ok("output" in json, JSON.stringify(json));
    const output = json.output as { kind: string; planKind?: string; status: string; digest: string; files: { path: string; change: string }[]; summary: string };
    assert.equal(output.planKind, "changes", JSON.stringify(output));
    assert.equal(output.status, "pending");
    assert.equal(output.digest, made.digest);
    assert.deepEqual(output.files.map((file) => `${file.change} ${file.path}`), ["modify docs/guide.md", "create docs/new.md"]);
    assert.ok(output.summary.includes(SUMMARY), output.summary);
    const text = (await planCommands.runPlan(io(["plan", "--task", made.taskPath, "--run", made.planRunId]))) as Outcome;
    assert.ok("text" in text, JSON.stringify(text));
    assert.ok(text.text.includes("docs/guide.md") && text.text.includes("docs/new.md"), text.text);
  });
});

describe("U-195: codaryn apply of a run plan", () => {
  test("refused before anything is asked, sent or written", { timeout: 60_000 }, async () => {
    assert.equal(typeof applyChangesPlan, "function", "plan-commands exports applyChangesPlan");
    const apply = applyChangesPlan as ApplyChangesPlan;
    const made = await makeRunPlan();
    assert.equal(errorOf(await apply(applyIo(made), applyArgs(made, { digest: "000000000000" }), made.value)).code, "plan_not_approved");
    assert.equal(errorOf(await apply(applyIo(made), applyArgs(made, { digest: null }), made.value)).code, "plan_not_approved");
    assert.equal(errorOf(await apply(applyIo(made), applyArgs(made, { allowUnsafeMove: true }), made.value)).code, "invalid_arguments");
    assert.equal(errorOf(await apply(applyIo(made, { readJournal: async () => "" }), applyArgs(made), made.value)).code, "invalid_run_record", "no goal: nothing starts");
    const withoutRun = { ...cliIo(made.base), argv: [] } as unknown as ApplyCommandEnvironment;
    assert.equal(errorOf(await apply(withoutRun, applyArgs(made), made.value)).code, "internal_error");
    assert.equal(await readFile(path.join(made.base, "work", "docs", "guide.md"), "utf8"), OLD_GUIDE, "nothing written");
    await assert.rejects(readFile(path.join(runDir(made, made.planRunId), PLAN_APPLIED_FILE_NAME), "utf8"), "the plan is not claimed");
  });

  test("carried out once by a model run given the plan run's goal; the result names the plan run; the host's hook is told", { timeout: 60_000 }, async () => {
    assert.equal(typeof applyChangesPlan, "function");
    assert.equal(typeof createAssemble, "function", "assemble exports createAssemble");
    const apply = applyChangesPlan as ApplyChangesPlan;
    const made = await makeRunPlan();
    await writeApplyScript(made.base);
    const told: string[] = [];
    const assemble = (createAssemble as (hooks: object) => Assemble)({ onAssembled: (assembled: { workspaceRoot: string }) => told.push(assembled.workspaceRoot) });
    const outcome = await apply(applyIo(made, { run: cliIo(made.base, { assemble }) } as Partial<ApplyCommandEnvironment>), applyArgs(made), made.value);
    assert.ok("output" in outcome, JSON.stringify(outcome));
    const result = outcome.output as EngineResult;
    assert.equal(result.kind, "run", JSON.stringify(result));
    assert.equal(result.planRunId, made.planRunId);
    assert.equal(result.planDigest, made.digest);
    assert.equal(result.status, "done", JSON.stringify(result));
    assert.equal(await readFile(path.join(made.base, "work", "docs", "guide.md"), "utf8"), "new guide\n");
    assert.equal(await readFile(path.join(made.base, "work", "docs", "new.md"), "utf8"), "new page\n");
    const applied = JSON.parse(await readFile(path.join(runDir(made, made.planRunId), PLAN_APPLIED_FILE_NAME), "utf8")) as { applyRunId: string };
    assert.equal(applied.applyRunId, result.runId, "the plan is claimed by this run");
    const planRun = await firstUserMessage(made, made.planRunId);
    const carried = await firstUserMessage(made, result.runId);
    assert.equal(carried.user, planRun.user, "the run is given the plan run's goal");
    assert.ok(carried.user.includes(GOAL), carried.user);
    assert.ok(carried.system.includes(SUMMARY), "the summary is told as the approved plan, in the system text");
    assert.deepEqual(told, [made.value.workspaceRoot], "the host's hook is told once");
    assert.equal(errorOf(await apply(applyIo(made), applyArgs(made), made.value)).code, "plan_already_applied", "a plan is carried out once");
  });

  test("a task resolved to plan apply refuses a run plan (run_not_plan)", { timeout: 60_000 }, async () => {
    const made = await makeRunPlan();
    const organize = path.join(made.base, "organize.json");
    const task = JSON.parse(await readFile(made.taskPath, "utf8")) as Record<string, unknown>;
    await writeFile(organize, JSON.stringify({ ...task, workflowRef: "organize", policy: { ...(task["policy"] as object), planActions: ["move", "discard"] } }), "utf8");
    const outcome = (await planCommands.runApply({
      ...cliIo(made.base),
      argv: ["apply", "--task", organize, "--run", made.planRunId, "--digest", made.digest.slice(0, 12)],
    } as ApplyCommandEnvironment)) as Outcome;
    const output = errorOf(outcome);
    assert.equal(output.code, "run_not_plan");
    assert.match(output.message, /plan "run"/);
  });
});
