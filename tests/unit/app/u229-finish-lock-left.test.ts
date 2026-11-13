/**
 * Unit U-229 (after nc-human's U-220): the app's assembly keeps the CLI's finish contract.
 * U-220 changed AssemblyOutcome.finish: a release that throws after its retries, or answers false,
 * leaves the lock, and finish then resolves with `{ lockLeft: true }` instead of throwing; a finish
 * that resolves with nothing released the lock. The CLI's runPrepared reads that marker for its end
 * summary (lock.release_failed). The app's own assembly (createAppAssemble) told a lock left only to
 * its `onLockLeft` (U-193) and resolved with nothing, so to the CLI it said "released" either way.
 * Here the app's assembly is called as the CLI calls it; the release fails in the two ways U-220
 * names: the lock is no longer this run's (release answers false), and the removal of lock.json fails
 * with EBUSY past the store's retries (injected only there, as U-220's tests do), after which U-211's
 * later try releases it. Reproduced first (4200131, todo until the app's finish gave the marker).
 * Temporary folders, the real store, fake values only.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { createAppAssemble } from "../../../src/app/assemble.js";
import { parseTask } from "../../../src/cli/task.js";
import type { EngineResult, ModelProvider } from "../../../src/contracts/index.js";
import { releaseLock } from "../../../src/store/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 600_000;
const clock = { now: () => (now += 1000) };

const TASK = {
  schemaVersion: 1,
  id: "u229",
  goal: "g",
  workflow: "label",
  workspaceRoot: "./ws",
  model: { provider: "scripted", scriptPath: "./script.json" },
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] },
  privacy: { secretEnv: [] },
  limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
  verifiers: [],
  workflowRef: "organize",
};

const require = createRequire(import.meta.url);
const promises: { rm: typeof import("node:fs/promises").rm } = require("node:fs/promises");

/** Runs `run` while removing `lockFile` fails with EBUSY; every other removal is real (as U-220's tests). */
async function whileLockStays<T>(lockFile: string, run: () => Promise<T>): Promise<T> {
  const lock = path.resolve(lockFile).toLowerCase();
  const original = promises.rm;
  promises.rm = async (target, options) => {
    if (path.resolve(String(target)).toLowerCase() === lock) throw Object.assign(new Error("U-229 injected EBUSY"), { code: "EBUSY" });
    return original(target, options);
  };
  syncBuiltinESMExports();
  try {
    return await run();
  } finally {
    promises.rm = original;
    syncBuiltinESMExports();
  }
}

interface Assembled {
  readonly work: string;
  readonly lockFile: string;
  readonly runId: string;
  readonly finish: (result: EngineResult | null) => Promise<unknown>;
  readonly lockLeftTold: () => number;
}

/** The app's assembly of a run, as the CLI calls it; the lock is held once it returns. */
async function assembled(runId: string, lockRetry: Parameters<typeof createAppAssemble>[4] = {}): Promise<Assembled> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-u229-"));
  temporaryDirs.push(base);
  const work = path.join(base, "ws");
  await mkdir(work);
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [] }), "utf8");
  const parsed = parseTask(TASK, base);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  let told = 0;
  const assemble = createAppAssemble(
    {},
    process.platform,
    () => undefined,
    () => {
      told += 1;
    },
    lockRetry,
  );
  const outcome = await assemble({
    task: parsed.task,
    runId,
    model: {} as ModelProvider,
    secrets: [],
    clock,
    signal: new AbortController().signal,
  });
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const lockFile = path.join(work, ".codaryn", "lock.json");
  assert.ok(existsSync(lockFile), "the run holds the lock");
  return { work, lockFile, runId, finish: (result) => outcome.finish(result), lockLeftTold: () => told };
}

const lockRunId = (lockFile: string): string => (JSON.parse(readFileSync(lockFile, "utf8")) as { runId: string }).runId;

describe("U-229: the app's finish says whether it released the lock (U-220's contract)", () => {
  test("a lock released: finish resolves with nothing and onLockLeft is not called", async () => {
    const run = await assembled("u229-released");
    assert.equal(await run.finish(null), undefined);
    assert.equal(run.lockLeftTold(), 0);
    assert.equal(existsSync(run.lockFile), false);
  });

  test("a release that answers false (the lock is no longer this run's): { lockLeft: true }, told once", async () => {
    const run = await assembled("u229-not-held");
    // Another run of this process took the lock over; the release of this run's id answers false.
    const held = JSON.parse(readFileSync(run.lockFile, "utf8")) as Record<string, unknown>;
    await writeFile(run.lockFile, JSON.stringify({ ...held, runId: "u229-other" }), "utf8");
    try {
      assert.deepEqual(await run.finish(null), { lockLeft: true });
      assert.equal(run.lockLeftTold(), 1);
      assert.equal(lockRunId(run.lockFile), "u229-other", "the other run's lock stays");
    } finally {
      await releaseLock({ workspaceRoot: run.work, runId: "u229-other" });
    }
  });

  test("a release that throws past the store's retries: { lockLeft: true }, the result stored, a later try releases it", async () => {
    let ended: string | null = null;
    const run = await assembled("u229-busy", { delaysMs: [300], onEnd: (end) => (ended = end) });
    const result = { kind: "run", runId: run.runId } as unknown as EngineResult;
    const finished = await whileLockStays(run.lockFile, () => run.finish(result));
    try {
      assert.deepEqual(finished, { lockLeft: true });
      assert.equal(run.lockLeftTold(), 1);
      const stored = path.join(run.work, ".codaryn", "runs", run.runId, "result.json");
      assert.deepEqual(JSON.parse(readFileSync(stored, "utf8")), result, "the result is written before the release");
      for (let waited = 0; ended === null && waited < 10_000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(ended, "released", "U-211's later try");
      assert.equal(existsSync(run.lockFile), false);
    } finally {
      if (existsSync(run.lockFile)) await releaseLock({ workspaceRoot: run.work, runId: run.runId });
    }
  });
});
