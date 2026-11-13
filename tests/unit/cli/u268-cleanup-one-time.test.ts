/**
 * Unit U-268 (nc-human's migration preparation, C-9b (a); PM's exception for src/cli/cleanup.ts):
 * a confirmed `codaryn cleanup` judges its selection at one time.
 * The CLI made its plan with one reading of the clock and handed the store's applyCleanup a second
 * one. The store makes the plan again under the workspace lock with the time it is given and removes
 * nothing unless the digest is the same. So a run that crossed an `--older-than` boundary between the
 * two readings (not older than N days at the first, older at the second) made the store's plan another
 * than the CLI's, and the command ended as cleanup_plan_changed though nothing in the state had
 * changed. The app's cleanup hands the store the preview's time already. Now the CLI reads the clock
 * once and gives that time to both.
 * The time the request carries feeds only the selection by age: the cleanup record's time is the
 * store's own (new Date()), and no output carries it, so nothing a person or a program reads changes
 * except in that case. Real store and runs made through the CLI at fixed past times (scripted model,
 * nothing sent); and the store's functions spied on. Reproduced first (todo until the CLI read the
 * clock once).
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { CleanupOutcome, CleanupPlan } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runCleanup } from "../../../src/cli/cleanup.js";
import type { CleanupOutput } from "../../../src/cli/cleanup.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const TODO = { todo: "U-268: the CLI's confirmed cleanup reads the clock once" };
const DAY_MS = 24 * 60 * 60 * 1000;

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
const exists = async (file: string): Promise<boolean> => (await stat(file).catch(() => null)) !== null;

/** A workspace with one finished run (scripted, no change) per start time, made at that time. */
async function workspaceWithRunsAt(starts: readonly number[]): Promise<{ base: string; work: string; runIds: string[] }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-u268-"));
  temporaryDirs.push(base);
  const work = path.join(base, "work");
  await mkdir(work);
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] }), "utf8");
  await writeFile(
    path.join(base, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "u268",
      goal: "g",
      workflow: "test",
      workspaceRoot: "./work",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
      privacy: { secretEnv: [] },
      limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [],
    }),
    "utf8",
  );
  const runIds: string[] = [];
  for (const start of starts) {
    const before = new Set(await readdir(path.join(work, STATE_DIR_NAME, RUNS_DIR_NAME)).catch(() => [] as string[]));
    const outcome = await runCli({
      argv: ["run", "--task", path.join(base, "task.json"), "--quiet"],
      env: {},
      cwd: base,
      readFile: (file) => readFile(file, "utf8"),
      isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
      loadEnvFile: () => {},
      locateInWorkspace: (file, root) => locateInWorkspace(file, root),
      clock: { now: () => start },
      randomBytes: (size) => randomBytes(size),
      assemble: assembleRun,
      cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    });
    assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
    const made = (await readdir(path.join(work, STATE_DIR_NAME, RUNS_DIR_NAME))).filter((name) => !before.has(name));
    assert.equal(made.length, 1);
    runIds.push(made[0]!);
  }
  return { base, work, runIds };
}

/** `codaryn cleanup ... --json` with a clock that gives `readings` in turn (the last one after). */
async function cleanupAt(base: string, args: readonly string[], readings: readonly number[]) {
  let next = 0;
  const clock = { now: () => readings[Math.min(next++, readings.length - 1)]! };
  const outcome = await runCleanup({ argv: ["cleanup", "--workspace", "work", ...args, "--json"], cwd: base, env: {}, clock, messages: createMessageCatalog("en") });
  return "output" in outcome ? { error: outcome.output as { code?: string }, output: null } : { error: null, output: JSON.parse(outcome.text) as CleanupOutput };
}

describe("U-268: a confirmed cleanup judges its selection at one time", () => {
  test("a run that becomes older than --older-than between the clock's readings: the run selected at the preview's time goes, not cleanup_plan_changed", TODO, async () => {
    // Whole seconds (a run id names its start to the second), two days and nine days ago.
    const today = Math.floor(Date.now() / 1000) * 1000;
    const atBoundary = today - 2 * DAY_MS;
    const { base, work, runIds } = await workspaceWithRunsAt([today - 9 * DAY_MS, atBoundary]);
    const [old, boundary] = runIds as [string, string];
    // Exactly one day after the second run's start, it is not older than one day; a second later it is.
    const first = atBoundary + DAY_MS;
    const preview = await cleanupAt(base, ["--older-than", "1"], [first]);
    assert.ok(preview.output !== null && "plan" in preview.output, JSON.stringify(preview));
    const plan = (preview.output as { plan: CleanupPlan }).plan;
    assert.deepEqual(plan.items.map((item) => (item.target === "run" ? item.runId : item.target)), [old], "only the older run at the preview's time");

    const confirmed = await cleanupAt(base, ["--older-than", "1", "--confirm", plan.digest.slice(0, 12), "--include-not-reverted"], [first, first + 1000]);
    assert.equal(confirmed.error, null, JSON.stringify(confirmed.error));
    assert.equal(confirmed.output?.status, "removed", JSON.stringify(confirmed.output));
    assert.equal(await exists(path.join(work, STATE_DIR_NAME, RUNS_DIR_NAME, old)), false, "the older run is removed");
    assert.equal(await exists(path.join(work, STATE_DIR_NAME, RUNS_DIR_NAME, boundary)), true, "the run at the boundary stays: it was not in the plan confirmed");
  });

  test("the store's plan and its apply are given the same time", TODO, async () => {
    const { base } = await workspaceWithRunsAt([Math.floor(Date.now() / 1000) * 1000 - 3 * DAY_MS]);
    const times: { plan: string[]; apply: string[] } = { plan: [], apply: [] };
    const plan: CleanupPlan = { items: [], blocked: [], totals: { runs: { count: 0, notReverted: 0, files: 0, bytes: 0 }, discarded: { count: 0, files: 0, bytes: 0 }, leftovers: { count: 0, files: 0, bytes: 0 } }, parked: { files: 0, bytes: 0 }, digest: "a".repeat(64) } as unknown as CleanupPlan;
    const outcome: CleanupOutcome = { ok: true, removed: [], kept: [], totals: plan.totals } as unknown as CleanupOutcome;
    let next = 0;
    const readings = [1_700_000_000_000, 1_700_000_005_000];
    const result = await runCleanup({
      argv: ["cleanup", "--workspace", "work", "--older-than", "1", "--confirm", "a".repeat(12), "--json"],
      cwd: base,
      env: {},
      clock: { now: () => readings[Math.min(next++, readings.length - 1)]! },
      planCleanup: async (request) => (times.plan.push(request.now), plan),
      applyCleanup: async (request) => (times.apply.push(request.now), outcome),
    });
    assert.ok(!("output" in result), JSON.stringify(result));
    assert.equal(times.plan.length, 1);
    assert.deepEqual(times.apply, times.plan, "the apply is given the plan's time");
    assert.equal(times.plan[0], new Date(readings[0]!).toISOString());
  });
});
