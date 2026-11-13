/**
 * Unit U-211 (after U-176 and U-193; ne-verify: a lock left blocks the workspace until the app
 * closes): the app tries a release that failed once more a few seconds later, so a file held for a
 * moment (a scanner, an indexer) no longer blocks the workspace for the app's whole life.
 * - Only the lock of that run, check or save: the store's releaseLock removes the lock only while
 *   this process and that id hold it, so a later try never takes another run's lock. An answer of
 *   false (the lock is not this id's any more, or gone) ends the tries at once; only a release that
 *   threw is tried again.
 * - Few, short waits (LOCK_RELEASE_RETRY_DELAYS_MS), on timers that do not keep the process alive.
 * - The run's outcome still says lockLeft: true (what was true at its end); nothing else changes.
 * The handle case needs Windows (another process opens the lock file sharing reading only, as in
 * U-176's and U-193's tests). Reproduced first (todo until the app tries again). Temporary folders,
 * scripted model, fake values only.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import * as appModule from "../../../src/app/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, AppHooks, CodarynApp, PlanCheck, RunOutcome, WriteWorkspaceTextRequest } from "../../../src/app/index.js";
import { runTask as engineRunTask } from "../../../src/engine/index.js";
import { acquireLock, inspectLock, releaseLock } from "../../../src/store/index.js";
import { WRITE_NOTES, appEnvironment, exists, plannedRun, setupRun, taskForm, taskRequest } from "./support.js";

const TODO = { todo: "U-211: the app does not try a failed lock release again yet" };
const windowsOnly = process.platform === "win32" ? false : "a handle that does not share deletion is made with PowerShell on Windows";

type Lock = { readonly workspaceRoot: string; readonly runId: string };
type End = "released" | "not_held" | "left";
type RetryOptions = { readonly delaysMs?: readonly number[]; readonly release?: (lock: Lock) => Promise<boolean>; readonly onEnd?: (end: End, lock: Lock) => void };
const exported = appModule as unknown as Record<string, unknown>;
const retryLockRelease = (lock: Lock, options: RetryOptions): Promise<End> => {
  const retry = exported["retryLockRelease"] as ((lock: Lock, options: RetryOptions) => Promise<End>) | undefined;
  assert.equal(typeof retry, "function", "the app layer gives retryLockRelease");
  return retry!(lock, options);
};
const hooksWith = (hooks: Record<string, unknown>): AppHooks => hooks as unknown as AppHooks;

const lockFile = (work: string): string => path.join(work, ".codaryn", "lock.json");
const heldBy = async (work: string): Promise<string | null> => ((await exists(lockFile(work))) ? (JSON.parse(await readFile(lockFile(work), "utf8")) as { runId: string }).runId : null);
function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}
/** The end of the app's later tries, told through the hook; null when none was told within `ms`. */
function endTold(ms: number): { readonly onEnd: (end: End, lock: Lock) => void; readonly ended: Promise<{ end: End; lock: Lock } | null>; readonly count: () => number } {
  let count = 0;
  let tell: (value: { end: End; lock: Lock }) => void = () => undefined;
  const told = new Promise<{ end: End; lock: Lock }>((resolve) => {
    tell = resolve;
  });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));
  return {
    onEnd: (end, lock) => {
      count += 1;
      tell({ end, lock });
    },
    ended: Promise.race([told, timeout]),
    count: () => count,
  };
}

/** Another process opens `file` for `ms` milliseconds sharing reading only (no deletion); resolves once it holds it. */
async function holdOpen(file: string, ms: number): Promise<{ readonly closed: Promise<void> }> {
  const script = `$h = [System.IO.File]::Open($env:U211_FILE, "Open", "Read", "Read"); [Console]::Out.WriteLine("held"); Start-Sleep -Milliseconds ${ms}; $h.Close()`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, U211_FILE: file }, stdio: ["ignore", "pipe", "ignore"] });
  const closed = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  await new Promise<void>((resolve, reject) => {
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("held")) resolve();
    });
    child.once("exit", () => reject(new Error("the holder ended before it held the file")));
  });
  return { closed };
}

describe("U-211: retryLockRelease", () => {
  const lock: Lock = { workspaceRoot: "/fake/work", runId: "20261113T120000Z-0a1b2c3d" };

  test("a release that throws is tried again; one that removes the lock ends the tries; every try asks for the same lock", TODO, async () => {
    const asked: Lock[] = [];
    let calls = 0;
    const end = await retryLockRelease(lock, {
      delaysMs: [1, 1, 1],
      release: async (given) => {
        asked.push({ ...given });
        calls += 1;
        if (calls === 1) throw new Error("held by the test");
        return true;
      },
    });
    assert.equal(end, "released");
    assert.deepEqual(asked, [lock, lock]);
  });

  test("an answer of false (the lock is not this id's any more) ends the tries at once", TODO, async () => {
    let calls = 0;
    const end = await retryLockRelease(lock, { delaysMs: [1, 1, 1], release: async () => ((calls += 1), false) });
    assert.deepEqual([end, calls], ["not_held", 1]);
  });

  test("every try throws: left after the last wait, no more", TODO, async () => {
    let calls = 0;
    const told: End[] = [];
    const end = await retryLockRelease(lock, {
      delaysMs: [1, 1],
      release: async () => {
        calls += 1;
        throw new Error("held by the test");
      },
      onEnd: (value) => told.push(value),
    });
    assert.deepEqual([end, calls, told], ["left", 2, ["left"]]);
  });

  test("the default waits are few and short", TODO, () => {
    const delays = exported["LOCK_RELEASE_RETRY_DELAYS_MS"] as readonly number[] | undefined;
    assert.ok(Array.isArray(delays), "the app layer gives LOCK_RELEASE_RETRY_DELAYS_MS");
    assert.ok(delays.length >= 1 && delays.length <= 3, `${delays.length} tries`);
    assert.ok(delays.every((ms) => ms >= 1000 && ms <= 10_000), delays.join(", "));
    assert.ok(delays.reduce((sum, ms) => sum + ms, 0) <= 15_000, "in all at most 15 s");
  });

  test("the waits do not keep the process alive", TODO, async () => {
    const module = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "app", "lock-retry.js")).href;
    const script = `const { retryLockRelease } = await import(${JSON.stringify(module)}); void retryLockRelease({ workspaceRoot: "/fake/work", runId: "r-1" }, { delaysMs: [60000], release: async () => { throw new Error("held"); } });`;
    const started = Date.now();
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "ignore" });
      child.once("exit", (exitCode) => resolve(exitCode));
    });
    assert.equal(code, 0);
    assert.ok(Date.now() - started < 20_000, "it ended without waiting for the 60 s timer");
  });

  test("with the store: another run's lock is never taken; this run's is", TODO, async () => {
    const base = await setupRun({}, {}, []);
    const work = path.join(base, "work");
    const mine = "20261113T120000Z-11111111";
    const other = "20261113T120000Z-22222222";
    const held = await acquireLock({ workspaceRoot: work, runId: other, clock: { now: () => Date.now() } });
    assert.ok(held.ok);
    try {
      assert.equal(await retryLockRelease({ workspaceRoot: work, runId: mine }, { delaysMs: [1] }), "not_held");
      assert.equal(await heldBy(work), other, "the other run's lock stays");
      assert.equal(await retryLockRelease({ workspaceRoot: work, runId: other }, { delaysMs: [1] }), "released");
      assert.equal(await exists(lockFile(work)), false);
    } finally {
      if (await exists(lockFile(work))) await releaseLock({ workspaceRoot: work, runId: other });
    }
  });
});

describe("U-211: a run through the app whose lock release fails", () => {
  test("the app tries again a few seconds later and the lock is gone without the app closing; lockLeft still told", { ...TODO, skip: windowsOnly }, async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const work = path.join(base, "work");
    const told = endTold(15_000);
    let holder: { readonly closed: Promise<void> } | null = null;
    // After the engine's run, before the finish releases the lock: hold the lock file past the store's own retries (775 ms).
    const app = createCodarynApp(await appEnvironment(base), {
      ...hooksWith({ lockRetry: { delaysMs: [1500, 3000], onEnd: told.onEnd } }),
      runTask: async (deps) => {
        const ended = await engineRunTask(deps);
        holder = await holdOpen(lockFile(work), 1500);
        return ended;
      },
    });
    const started = await app.startRun(taskRequest(base));
    assert.ok(started.ok, JSON.stringify(started));
    const done: RunOutcome = await started.handle.done;
    try {
      assert.ok(done.ok, JSON.stringify(done));
      assert.equal((done as { lockLeft?: boolean }).lockLeft, true, "what was true at the run's end");
      const ended = await told.ended;
      assert.deepEqual(ended, { end: "released", lock: { workspaceRoot: work, runId: started.handle.runId } });
      assert.equal(await exists(lockFile(work)), false, "no one else released it");
    } finally {
      await (holder as { closed: Promise<void> } | null)?.closed;
      if (await exists(lockFile(work))) await releaseLock({ workspaceRoot: work, runId: started.handle.runId });
    }
  });

  test("a lock released as always: no later try", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const told = endTold(300);
    const app = createCodarynApp(await appEnvironment(base), hooksWith({ lockRetry: { delaysMs: [1], onEnd: told.onEnd } }));
    const started = await app.startRun(taskRequest(base));
    assert.ok(started.ok, JSON.stringify(started));
    const done = await started.handle.done;
    assert.ok(done.ok, JSON.stringify(done));
    assert.equal(await told.ended, null);
    assert.equal(told.count(), 0);
  });
});

describe("U-211: checkApply's and writeWorkspaceText's release", () => {
  /** A release that throws `failures` times, then is the store's. */
  const failingFirst = (failures: number) => {
    let calls = 0;
    return async (lock: Lock): Promise<boolean> => {
      calls += 1;
      if (calls <= failures) throw new Error("held by the test");
      return releaseLock(lock);
    };
  };

  test("checkApply: a release that threw is tried again later, with the check's own lock id", TODO, async () => {
    const planned = await plannedRun();
    const work = path.join(planned.base, "work");
    const told = endTold(5_000);
    const app = createCodarynApp(await appEnvironment(planned.base), hooksWith({ applyCheck: { releaseLock: failingFirst(2), lockRetry: { delaysMs: [50], onEnd: told.onEnd } } }));
    const check: PlanCheck = ok(await app.checkApply({ settings: taskForm(planned.base), planRunId: planned.plan.runId, digest: planned.digest }));
    assert.equal(check.lockLeft, true);
    const ended = await told.ended;
    assert.equal(ended?.end, "released");
    assert.equal(ended?.lock.workspaceRoot, work);
    assert.equal(await exists(lockFile(work)), false);
  });

  test("checkApply: a release that answers false is not tried again", async () => {
    const planned = await plannedRun();
    const work = path.join(planned.base, "work");
    const told = endTold(300);
    const app = createCodarynApp(await appEnvironment(planned.base), hooksWith({ applyCheck: { releaseLock: async () => false, lockRetry: { delaysMs: [1], onEnd: told.onEnd } } }));
    const check = ok(await app.checkApply({ settings: taskForm(planned.base), planRunId: planned.plan.runId, digest: planned.digest }));
    try {
      assert.equal(check.lockLeft, true);
      assert.equal(await told.ended, null);
      assert.equal((await inspectLock(work)).state, "held", "left as told");
    } finally {
      const runId = await heldBy(work);
      if (runId !== null) await releaseLock({ workspaceRoot: work, runId });
    }
  });

  test("writeWorkspaceText: a release that threw is tried again later; the edit is written", TODO, async () => {
    const base = await setupRun({ "a.txt": "a\n" }, {}, []);
    const work = path.join(base, "work");
    const told = endTold(5_000);
    const app: CodarynApp = createCodarynApp(await appEnvironment(base), hooksWith({ workspaceText: { releaseLock: failingFirst(2), lockRetry: { delaysMs: [50], onEnd: told.onEnd } } }));
    const opened = ok(await app.readWorkspaceText({ settings: taskForm(base), path: "a.txt" })) as unknown as { digest: string };
    const written = ok(await app.writeWorkspaceText({ settings: taskForm(base), path: "a.txt", text: "b\n", baseDigest: opened.digest } as WriteWorkspaceTextRequest)) as unknown as { status: string; lockLeft: boolean };
    assert.deepEqual([written.status, written.lockLeft], ["written", true]);
    assert.equal((await told.ended)?.end, "released");
    assert.equal(await exists(lockFile(work)), false);
    assert.equal(await readFile(path.join(work, "a.txt"), "utf8"), "b\n");
  });
});
