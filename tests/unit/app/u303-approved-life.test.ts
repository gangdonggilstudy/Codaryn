/**
 * Unit U-303 (the CLI migration's C-6b; docs/reviews/2026-11-13-cli-migration-plan.md C-6b, 6.1, 6.4;
 * ne-verify R-115 I-1): the app layer's run life (runLife, src/app/run-life.ts) carries out an approved
 * run plan, and the three things a carrying run must do once and the same are the life's own, never a
 * wrapper's: the plan's claim (the engine's, through the assembly's parts), the records-changed mark
 * looked at again under the workspace lock (U-1, U-195), and the writes refused outside the plan
 * counted as such (deniedNotPlanned).
 * U-307 (ne-verify R-116 I-1): until U-300 the CLI's runPrepared kept its own branch, and these cases
 * set it against runLife on the same plan (9a62465 reproduced them as todo, 88eb3b4 made them pass).
 * Since U-300 the CLI's apply (and the app's applyPlan, through it) go through runLife, so a comparison
 * of the two would compare the code with itself; each case now runs the plan through runLife and holds
 * what it must give. Temporary folders, scripted models, fake values only.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { runLife } from "../../../src/app/run-life.js";
import type { ApprovedRunPlan, RunLifeEnd } from "../../../src/app/run-life.js";
import { tallyOf } from "../../../src/app/tally.js";
import { assembleRun } from "../../../src/app/assembly.js";
import type { Assemble } from "../../../src/app/assembly.js";
import { createRunId } from "../../../src/app/input/run-id.js";
import { CLI_ERROR_EXIT_CODES, PLAN_APPLIED_FILE_NAME, RECORDS_CHANGED_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { CliErrorOutput, EngineResult, JournalRecord, ResolvedTaskSpec, StoredChangesPlan } from "../../../src/contracts/index.js";
import type { RunArgs } from "../../../src/cli/args.js";
import { prepareTask } from "../../../src/cli/run.js";
import type { CliEnvironment, PreparedTask, RunNotes } from "../../../src/cli/run.js";
import { runTask } from "../../../src/engine/index.js";
import { createScriptedProvider, parseScript } from "../../../src/model/index.js";
import { loadAnyPlan } from "../../../src/store/index.js";
import { cliIo, setupRun } from "../cli/k-support.js";

const GOAL = "rewrite the guide for new users";
const OLD_GUIDE = "old guide\n";
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const notes = (): RunNotes => ({ configLanguage: null, configDefault: null, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0 });

interface Made {
  readonly base: string;
  readonly args: RunArgs;
  readonly prepared: PreparedTask;
  readonly workspaceRoot: string;
  readonly approved: ApprovedRunPlan;
}

/** A run plan made in-process (as g-u195 makes one), the plan run's records and plan.json, and the plan approved by --digest. */
async function madeRunPlan(): Promise<Made> {
  const base = await setupRun({ "README.md": "# Title\n", "docs/guide.md": OLD_GUIDE }, { goal: GOAL }, [{ text: "unused" }]);
  const taskPath = path.join(base, "task.json");
  const io = cliIo(base);
  const args: RunArgs = { command: "run", input: { kind: "task", taskPath }, configPath: null, varsFile: null, cancelFile: null, quiet: true, profile: null, workflow: null };
  const ready = await prepareTask(io, args, notes());
  assert.ok("prepared" in ready, JSON.stringify(ready));
  const task = { ...ready.prepared.task, plan: "run", tools: ["read_file", "search_files", "write_file", "propose_changes"] } as ResolvedTaskSpec;
  const script = parseScript({
    schemaVersion: 1,
    steps: [{ toolCalls: [{ name: "propose_changes", args: { summary: "rewrite the guide and add a page", files: [{ path: "docs/guide.md", change: "modify" }, { path: "docs/new.md", change: "create" }] } }] }, { text: "not requested" }],
  });
  assert.ok(script.ok);
  const planRunId = createRunId(new Date(), (size) => randomBytes(size));
  const assembled = await assembleRun({ task, runId: planRunId, model: createScriptedProvider(script.script), secrets: [...ready.prepared.secrets], clock: io.clock, signal: new AbortController().signal });
  assert.ok(assembled.ok);
  let result: EngineResult | null = null;
  try {
    result = await runTask(assembled.deps);
  } finally {
    await assembled.finish(result);
  }
  assert.equal(result?.reason, "plan_pending", JSON.stringify(result));
  const workspaceRoot = await realpath(path.join(base, "work"));
  const loaded = await loadAnyPlan({ workspaceRoot, runId: planRunId });
  assert.ok(loaded.ok, JSON.stringify(loaded));
  const approved: ApprovedRunPlan = { planRunId, digest: loaded.digest, approval: "cli-flag", plan: loaded.plan as StoredChangesPlan };
  return { base, args, prepared: { ...ready.prepared, task }, workspaceRoot, approved };
}

/** The carrying run's script: a planned modify, a write outside the plan, a planned create, the end. */
async function carryingScript(base: string): Promise<void> {
  const steps = [
    { toolCalls: [{ name: "write_file", args: { path: "docs/guide.md", expectedHash: sha256(OLD_GUIDE), change: { kind: "replace_all", content: "new guide\n" } } }] },
    { toolCalls: [{ name: "write_file", args: { path: "other.md", expectedHash: null, change: { kind: "replace_all", content: "not in the plan\n" } } }] },
    { toolCalls: [{ name: "write_file", args: { path: "docs/new.md", expectedHash: null, change: { kind: "replace_all", content: "new page\n" } } }] },
    { text: "done" },
  ];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
}

const work = (made: Made, ...parts: string[]): string => path.join(made.base, "work", ...parts);
const planRunDir = (made: Made): string => work(made, STATE_DIR_NAME, RUNS_DIR_NAME, made.approved.planRunId);
const exists = async (file: string): Promise<boolean> => (await stat(file).catch(() => null)) !== null;
async function journalOf(made: Made, runId: string): Promise<JournalRecord[]> {
  const text = await readFile(work(made, STATE_DIR_NAME, RUNS_DIR_NAME, runId, "journal.jsonl"), "utf8");
  return text.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as JournalRecord);
}

/** The plan carried out by runLife, once the carrying script is written. */
async function carried(made: Made, io: CliEnvironment = cliIo(made.base)): Promise<{ readonly end: RunLifeEnd; readonly runNotes: RunNotes }> {
  await carryingScript(made.base);
  const runNotes = notes();
  return { end: await runLife(io, made.args, runNotes, made.prepared, made.approved), runNotes };
}

const resultOf = (end: RunLifeEnd): EngineResult => {
  assert.equal(end.kind, "ended", JSON.stringify(end));
  return (end as { result: EngineResult }).result;
};
const refusalOf = (end: RunLifeEnd): CliErrorOutput => {
  assert.equal(end.kind, "refused", JSON.stringify(end));
  return (end as { output: CliErrorOutput }).output;
};

/** Nothing of the carrying run reached the workspace or the plan: the files as the plan saw them, no claim, no lock. */
async function untouched(made: Made): Promise<void> {
  assert.equal(await readFile(work(made, "docs", "guide.md"), "utf8"), OLD_GUIDE, "nothing written");
  assert.equal(await exists(work(made, "docs", "new.md")), false);
  assert.equal(await exists(work(made, "other.md")), false);
  assert.equal(await exists(path.join(planRunDir(made), PLAN_APPLIED_FILE_NAME)), false, "the plan not claimed");
  assert.equal(await exists(work(made, STATE_DIR_NAME, "lock.json")), false, "the lock released");
}

describe("U-303: the app's run life carries out an approved run plan", () => {
  test("the carrying run: the plan's run and digest in the result, the planned files written, the plan claimed by this run, the write outside the plan counted as outside it", async () => {
    const made = await madeRunPlan();
    const { end, runNotes } = await carried(made);
    const result = resultOf(end);
    assert.deepEqual([result.planRunId, result.planDigest, result.status, result.reason], [made.approved.planRunId, made.approved.digest, "done", "verified"]);
    assert.deepEqual(result.changes.map((change) => change.path).sort(), ["docs/guide.md", "docs/new.md"]);
    assert.deepEqual([await readFile(work(made, "docs", "guide.md"), "utf8"), await readFile(work(made, "docs", "new.md"), "utf8")], ["new guide\n", "new page\n"]);
    assert.equal(await exists(work(made, "other.md")), false, "the write outside the plan was refused");
    const claim = JSON.parse(await readFile(path.join(planRunDir(made), PLAN_APPLIED_FILE_NAME), "utf8")) as { applyRunId?: string };
    assert.equal(claim.applyRunId, result.runId, "the plan claimed by this run (applied.json)");
    const denied = (await journalOf(made, result.runId)).filter((record) => record.type === "tool_decision" && !record.allowed);
    assert.deepEqual(denied.map((record) => (record as { code?: string }).code), ["path_not_writable"]);
    assert.deepEqual(tallyOf(runNotes), { deniedToolCalls: 1, deniedCommandCalls: 0, failedToolCalls: 0, deniedNotPlanned: 1 }, "outside the plan, not outside writablePaths");
    assert.equal(await exists(work(made, STATE_DIR_NAME, "lock.json")), false, "the lock released");
  });

  test("a records-changed mark found under the lock: plan_records_changed before anything is recorded, sent or written", async () => {
    const made = await madeRunPlan();
    await writeFile(path.join(planRunDir(made), RECORDS_CHANGED_FILE_NAME), "{}\n", "utf8");
    const { end, runNotes } = await carried(made);
    const output = refusalOf(end);
    assert.deepEqual([output.code, output.exitCode], ["plan_records_changed", CLI_ERROR_EXIT_CODES.plan_records_changed]);
    assert.equal(
      output.message,
      "the plan run's records were changed by something other than the run (a records-changed mark), found under the workspace lock; its plan may not be the one approved, so nothing was recorded, sent or written. Make the plan again with a new codaryn run",
    );
    await untouched(made);
    assert.deepEqual(tallyOf(runNotes), { deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0 }, "nothing recorded to count");
  });

  test("an assembly that cannot give the plan's parts: internal_error, nothing written, the lock released", async () => {
    const made = await madeRunPlan();
    const assemble: Assemble = async (input) => {
      const assembled = await assembleRun(input);
      if (!assembled.ok) return assembled;
      const { approvedPlan: _parts, ...rest } = assembled;
      return rest;
    };
    const { end } = await carried(made, { ...cliIo(made.base), assemble });
    const output = refusalOf(end);
    assert.deepEqual([output.code, output.message], ["internal_error", "this build cannot carry out a run plan; nothing was sent or written"]);
    await untouched(made);
  });

  test("a plan already claimed: a second carrying run, the planned files as the plan saw them again, ends plan_stale without writing", async () => {
    const made = await madeRunPlan();
    const first = resultOf((await carried(made)).end);
    const claim = await readFile(path.join(planRunDir(made), PLAN_APPLIED_FILE_NAME), "utf8");
    // The files back as the plan saw them, so the run gets past the plan's file checks to its claim.
    await writeFile(work(made, "docs", "guide.md"), OLD_GUIDE, "utf8");
    await rm(work(made, "docs", "new.md"));
    const again = resultOf((await carried(made)).end);
    assert.deepEqual([again.status, again.reason], ["failed", "plan_stale"]);
    assert.ok((again.notices as readonly string[]).includes("the approved plan was already carried out by another run; nothing was written"), JSON.stringify(again.notices));
    assert.notEqual(again.runId, first.runId);
    assert.equal(await readFile(path.join(planRunDir(made), PLAN_APPLIED_FILE_NAME), "utf8"), claim, "the first run's claim stays");
    assert.equal(await readFile(work(made, "docs", "guide.md"), "utf8"), OLD_GUIDE, "nothing written");
    assert.equal(await exists(work(made, "docs", "new.md")), false);
  });
});
