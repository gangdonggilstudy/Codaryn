/**
 * Unit U-229, nc-human's R-106 on U-218 (after main's U-220):
 * - L-1 (the revert's part): U-220 made the CLI's revert keep its outcome when the workspace lock
 *   cannot be released, with `lockLeft` on RevertCliOutcome (before, the app saw a throw and said
 *   internal_error). The app's revert returned the output and dropped `lockLeft`, so a lock left
 *   by a revert was told to nobody. Now the app's revert outcome carries `lockLeft: true` beside the
 *   output, as a run's does (RunOutcome). The apply of a plan of moves cannot follow yet: the CLI's
 *   runApply tells it only in its end summary (contract 5.1).
 * - I-5: when the app's assembly fails after it took the lock, a release that throws replaced the
 *   assembly's own error and started no later try. Now the assembly's error is the one thrown, as in
 *   the CLI's assembly since U-220, and the release is tried again later (U-211), through the lock's
 *   queue (V-17 H-1).
 * The removal of lock.json fails with EBUSY past the store's retries (injected only there, as U-220's
 * tests do). Reproduced first (0d5181d, todo until the app passed them on). Temporary folders, scripted
 * model, fake values only.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { describe, test } from "node:test";

import { createAppAssemble } from "../../../src/app/assemble.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { RunHandle } from "../../../src/app/index.js";
import { parseTask } from "../../../src/cli/task.js";
import type { ModelProvider } from "../../../src/contracts/index.js";
import { releaseLock } from "../../../src/store/index.js";
import { WRITE_NOTES, appEnvironment, setupRun, taskRequest } from "./support.js";

const require = createRequire(import.meta.url);
const promises: { rm: typeof import("node:fs/promises").rm } = require("node:fs/promises");

/** Runs `run` while removing `lockFile` fails with EBUSY; every other removal is real. */
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

/** The lock left behind, released by its own id (this process holds it). */
async function takeBack(lockFile: string, workspaceRoot: string): Promise<void> {
  if (!existsSync(lockFile)) return;
  const runId = (JSON.parse(readFileSync(lockFile, "utf8")) as { runId: string }).runId;
  await releaseLock({ workspaceRoot, runId });
}

describe("U-229, R-106 L-1: a revert whose lock cannot be released", () => {
  test("the revert's output as always, and lockLeft: true beside it", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const work = path.join(base, "work");
    const lockFile = path.join(work, ".codaryn", "lock.json");
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.ok(started.ok, JSON.stringify(started));
    const handle = (started as { handle: RunHandle }).handle;
    assert.ok((await handle.done).ok);
    try {
      const reverted = await whileLockStays(lockFile, () => app.revert({ workspace: work, runId: handle.runId }));
      assert.ok(reverted.ok, JSON.stringify(reverted));
      const outcome = reverted as unknown as { output: { kind: string; status: string; reverted: unknown }; lockLeft?: true };
      assert.deepEqual([outcome.output.kind, outcome.output.status, outcome.output.reverted], ["revert", "complete", [{ path: "NOTES.md", action: "deleted" }]]);
      assert.equal(outcome.lockLeft, true);
      assert.equal(existsSync(lockFile), true, "the lock is left (U-176)");
    } finally {
      await takeBack(lockFile, work);
    }
  });

  test("a revert whose lock is released: no lockLeft", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const work = path.join(base, "work");
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.ok(started.ok, JSON.stringify(started));
    const handle = (started as { handle: RunHandle }).handle;
    assert.ok((await handle.done).ok);
    const reverted = await app.revert({ workspace: work, runId: handle.runId });
    assert.ok(reverted.ok, JSON.stringify(reverted));
    assert.equal("lockLeft" in reverted, false);
  });
});

describe("U-229, R-106 I-5: the app's assembly fails after it took the lock, and the release throws", () => {
  test("the assembly's own error is thrown, and a later try releases the lock", async () => {
    const base = await setupRun({}, {}, []);
    const work = path.join(base, "work");
    const lockFile = path.join(work, ".codaryn", "lock.json");
    const parsed = parseTask(JSON.parse(readFileSync(path.join(base, "task.json"), "utf8")), base);
    assert.ok(parsed.ok, JSON.stringify(parsed));
    let ended: string | null = null;
    const assemble = createAppAssemble(
      {},
      process.platform,
      () => {
        throw new Error("U-229: the assembly fails after the lock");
      },
      () => undefined,
      { delaysMs: [300], onEnd: (end) => (ended = end) },
    );
    const input = { task: parsed.task, runId: "u229-i5-run", model: {} as ModelProvider, secrets: [], clock: { now: () => Date.now() }, signal: new AbortController().signal };
    try {
      await whileLockStays(lockFile, () => assert.rejects(assemble(input), /the assembly fails after the lock/));
      for (let waited = 0; ended === null && waited < 10_000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(ended, "released", "U-211's later try");
      assert.equal(existsSync(lockFile), false);
    } finally {
      await takeBack(lockFile, work);
    }
  });
});
