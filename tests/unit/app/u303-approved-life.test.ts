/**
 * Unit U-303 (the CLI migration's C-6b; docs/reviews/2026-11-13-cli-migration-plan.md C-6b, 6.1, 6.4;
 * ne-verify R-115 I-1): the app layer's run life (runLife, src/app/run-life.ts) carries out an approved
 * run plan as the CLI's runPrepared does with one, so that the three things a carrying run must do once
 * and the same are the life's own, never a wrapper's: the plan's claim (the engine's, through the
 * assembly's parts), the records-changed mark looked at again under the workspace lock (U-1, U-195),
 * and the writes refused outside the plan counted as such (deniedNotPlanned). Until the CLI's apply is
 * turned to it (na-core), the CLI's runPrepared keeps its own branch, so both run here on the same
 * approved plan, each in a folder of its own made the same way, and must give the same: the result and
 * the carrying run's records, the plan's claim (applied.json), the counts, a refusal under the lock
 * and an assembly that cannot claim the plan, and a second carrying run of a plan already claimed.
 * Reproduced first (9a62465, todo until runLife took an approved plan). Temporary folders, scripted
 * models, fake values only.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { runLife } from "../../../src/app/run-life.js";
import type { RunLifeEnd } from "../../../src/app/run-life.js";
import { tallyOf } from "../../../src/app/tally.js";
import { assembleRun } from "../../../src/app/assembly.js";
import type { Assemble } from "../../../src/app/assembly.js";
import { createRunId } from "../../../src/app/input/run-id.js";
import { PLAN_APPLIED_FILE_NAME, PRIVACY_TOKEN_PATTERN_SOURCE, RECORDS_CHANGED_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { EngineResult, JournalRecord, ResolvedTaskSpec, StoredChangesPlan } from "../../../src/contracts/index.js";
import type { RunArgs } from "../../../src/cli/args.js";
import { prepareTask, runPrepared } from "../../../src/cli/run.js";
import type { ApprovedRunPlan, CliEnvironment, PreparedTask, RunNotes } from "../../../src/cli/run.js";
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

const runDirOf = (made: Made, runId: string): string => path.join(made.base, "work", STATE_DIR_NAME, RUNS_DIR_NAME, runId);
const exists = async (file: string): Promise<boolean> => (await stat(file).catch(() => null)) !== null;
async function journalOf(made: Made, runId: string): Promise<JournalRecord[]> {
  const text = await readFile(path.join(runDirOf(made, runId), "journal.jsonl"), "utf8");
  return text.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as JournalRecord);
}

const TOKEN = new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g");
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const RUN_ID = /\d{8}T\d{6}Z-[0-9a-f]{8}/g;
/** What differs between any two runs, named by role or first appearance (as c01 does); nothing else. */
function normalized(value: unknown, made: Made): unknown {
  let text = JSON.stringify(value);
  text = text.split(made.approved.planRunId).join("<PLAN_RUN>").split(made.approved.digest).join("<DIGEST>");
  for (const form of [made.base, made.base.split("\\").join("/"), made.workspaceRoot, made.workspaceRoot.split("\\").join("/")]) text = text.split(JSON.stringify(form).slice(1, -1)).join("<BASE>");
  const named = (pattern: RegExp, label: string) => {
    const seen = new Map<string, string>();
    text = text.replace(pattern, (found) => seen.get(found) ?? (seen.set(found, `<${label}${seen.size + 1}>`), seen.get(found)!));
  };
  named(RUN_ID, "RUN");
  named(TOKEN, "TOKEN");
  text = text.replace(ISO_TIME, "<TIME>").replace(/"durationMs":\d+/g, '"durationMs":"<MS>"');
  return JSON.parse(text) as unknown;
}

/** The counts as RunNotes holds them, for the CLI's end summary. */
const countsOf = (from: RunNotes): Record<string, unknown> => JSON.parse(JSON.stringify(tallyOf(from))) as Record<string, unknown>;

/** The two lives on two folders made the same way: the CLI's runPrepared with the plan, and runLife with it. */
async function bothLives(prepare: (made: Made) => Promise<void> = async () => {}, ioFor: (made: Made) => CliEnvironment = (made) => cliIo(made.base)) {
  const old = await madeRunPlan();
  const now = await madeRunPlan();
  for (const made of [old, now]) {
    await carryingScript(made.base);
    await prepare(made);
  }
  const oldNotes = notes();
  const newNotes = notes();
  const cli = await runPrepared(ioFor(old), old.args, oldNotes, old.prepared, old.approved);
  const life = await runLife(ioFor(now), now.args, newNotes, now.prepared, now.approved);
  return { old, now, cli, life, oldNotes, newNotes };
}

describe("U-303: the app's run life carries out an approved run plan as the CLI's does", () => {
  test("the carrying run: the same result and records, the plan claimed once, the write outside the plan counted as such", async () => {
    const { old, now, cli, life, oldNotes, newNotes } = await bothLives();
    assert.equal(life.kind, "ended", JSON.stringify(life));
    const oldResult = cli.output as EngineResult;
    const newResult = (life as { result: EngineResult }).result;
    assert.equal(newResult.planRunId, now.approved.planRunId, "the life carried out the plan");
    assert.deepEqual(normalized(newResult, now), normalized(oldResult, old), "the same EngineResult");
    assert.deepEqual(normalized(await journalOf(now, newResult.runId), now), normalized(await journalOf(old, oldResult.runId), old), "the same records");
    const claim = async (made: Made) => normalized(JSON.parse(await readFile(path.join(runDirOf(made, made.approved.planRunId), PLAN_APPLIED_FILE_NAME), "utf8")), made);
    assert.deepEqual(await claim(now), await claim(old), "the plan's claim (applied.json)");
    assert.deepEqual(countsOf(newNotes), countsOf(oldNotes), "the same counts");
    assert.deepEqual([newNotes.deniedNotPlanned, newNotes.deniedNotWritable], [1, undefined], "a write outside the plan is outside the plan, not outside writablePaths");
  });

  test("a records-changed mark found under the lock: the same refusal, the carrying run's nothing written, the lock released", async () => {
    const mark = async (made: Made) => writeFile(path.join(runDirOf(made, made.approved.planRunId), RECORDS_CHANGED_FILE_NAME), "{}\n", "utf8");
    const { old, now, cli, life } = await bothLives(mark);
    assert.equal(cli.output.kind, "error", JSON.stringify(cli.output));
    assert.equal(life.kind, "refused", JSON.stringify(life));
    assert.equal(JSON.stringify((life as { output: unknown }).output), JSON.stringify(cli.output), "the same JSON line");
    assert.equal((cli.output as { code: string }).code, "plan_records_changed");
    for (const made of [old, now]) {
      assert.equal(await exists(path.join(made.base, "work", STATE_DIR_NAME, "lock.json")), false, "the lock released");
      assert.equal(await exists(path.join(runDirOf(made, made.approved.planRunId), PLAN_APPLIED_FILE_NAME)), false, "the plan not claimed");
      assert.equal(await readFile(path.join(made.base, "work", "docs", "guide.md"), "utf8"), OLD_GUIDE, "nothing written");
    }
  });

  test("an assembly that cannot claim a plan: the same internal error, the lock released", async () => {
    const noParts = (made: Made): CliEnvironment => {
      const assemble: Assemble = async (input) => {
        const assembled = await assembleRun(input);
        if (!assembled.ok) return assembled;
        const { approvedPlan: _parts, ...rest } = assembled;
        return rest;
      };
      return { ...cliIo(made.base), assemble };
    };
    const { old, now, cli, life } = await bothLives(async () => {}, noParts);
    assert.equal(life.kind, "refused", JSON.stringify(life));
    assert.equal(JSON.stringify((life as { output: unknown }).output), JSON.stringify(cli.output));
    assert.equal((cli.output as { code: string }).code, "internal_error");
    for (const made of [old, now]) assert.equal(await exists(path.join(made.base, "work", STATE_DIR_NAME, "lock.json")), false);
  });

  test("a plan already claimed: a second carrying run ends the same way in both lives", async () => {
    const { old, now } = await bothLives();
    await carryingScript(old.base);
    await carryingScript(now.base);
    const again = await runPrepared(cliIo(old.base), old.args, notes(), old.prepared, old.approved);
    const lifeAgain = await runLife(cliIo(now.base), now.args, notes(), now.prepared, now.approved);
    const shown = (end: RunLifeEnd) => (end.kind === "ended" ? end.result : end.output);
    assert.deepEqual(normalized(shown(lifeAgain), now), normalized(again.output, old));
  });
});
