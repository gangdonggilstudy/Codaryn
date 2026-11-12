/**
 * N-25(b): the lock records the holder's process start time, so a dead lock whose pid the system
 * gave to another process (Z-2) is told apart and reclaimed. A lock in the old format (no start
 * time) is judged by its pid alone, as before.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import type { Clock } from "../../../src/contracts/index.js";
import { PROCESS_START_TOLERANCE_MS, acquireLock, processStartTime, releaseLock } from "../../../src/store/index.js";
import { ACQUIRE_BUDGET_MS, START_QUERY_BUDGET_MS } from "./lock-budget.js";

const clock: Clock = { now: () => Date.UTC(2026, 0, 2, 3, 4, 5) };
const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codaryn-lock-start-"));
  roots.push(root);
  await mkdir(join(root, ".codaryn"));
  return root;
}

/** A pid the tests treat as alive, held by some process unrelated to the lock. */
const REUSED_PID = 424242;
const HOLDER_START = Date.UTC(2026, 0, 2, 3, 0, 0);

async function writeLock(root: string, lock: Record<string, unknown>, name = "lock.json"): Promise<void> {
  await writeFile(join(root, ".codaryn", name), `${JSON.stringify(lock)}\n`, "utf8");
}

describe("lock process start time (N-25 b)", () => {
  test("a new lock records this process's start time", async () => {
    const root = await workspace();
    const outcome = await acquireLock({ workspaceRoot: root, runId: "run-a", clock });
    assert.equal(outcome.ok, true);
    const written = JSON.parse(await readFile(join(root, ".codaryn", "lock.json"), "utf8")) as Record<string, unknown>;
    assert.equal(typeof written["processStartedAt"], "string");
    assert.ok(Math.abs(Date.parse(written["processStartedAt"] as string) - performance.timeOrigin) < 1, "performance.timeOrigin");
    assert.equal(await releaseLock({ workspaceRoot: root, runId: "run-a" }), true);
  });

  test("Z-2: a live pid whose process started at another time does not hold the lock; the lock is reclaimed", async () => {
    const root = await workspace();
    await writeLock(root, { pid: REUSED_PID, runId: "dead-run", startedAt: "2026-01-02T03:00:01.000Z", processStartedAt: new Date(HOLDER_START).toISOString() });
    let asked = 0;
    const outcome = await acquireLock({
      workspaceRoot: root,
      runId: "run-b",
      clock,
      retryForMs: ACQUIRE_BUDGET_MS,
      isProcessAlive: (pid) => pid === REUSED_PID,
      processStartTime: async (pid) => {
        asked += 1;
        return pid === REUSED_PID ? HOLDER_START + 60_000 : null;
      },
    });
    assert.equal(outcome.ok, true, "the dead lock is reclaimed");
    assert.ok(asked >= 1);
  });

  test("a live pid whose process started at the recorded time (within the tolerance) still holds the lock", async () => {
    const root = await workspace();
    await writeLock(root, { pid: REUSED_PID, runId: "live-run", startedAt: "2026-01-02T03:00:01.000Z", processStartedAt: new Date(HOLDER_START).toISOString() });
    const outcome = await acquireLock({
      workspaceRoot: root,
      runId: "run-c",
      clock,
      isProcessAlive: (pid) => pid === REUSED_PID,
      processStartTime: async () => HOLDER_START + PROCESS_START_TOLERANCE_MS - 1,
    });
    assert.deepEqual(outcome.ok ? null : outcome.holder?.runId, "live-run");
  });

  test("an unknown start time keeps the lock held, as the pid alone says", async () => {
    const root = await workspace();
    await writeLock(root, { pid: REUSED_PID, runId: "live-run", startedAt: "2026-01-02T03:00:01.000Z", processStartedAt: new Date(HOLDER_START).toISOString() });
    const outcome = await acquireLock({ workspaceRoot: root, runId: "run-d", clock, isProcessAlive: () => true, processStartTime: async () => null });
    assert.equal(outcome.ok, false);
  });

  test("a lock in the old format is judged by its pid only, and no start time is asked for", async () => {
    const root = await workspace();
    await writeLock(root, { pid: REUSED_PID, runId: "old-run", startedAt: "2026-01-02T03:00:01.000Z" });
    let asked = 0;
    const held = await acquireLock({
      workspaceRoot: root,
      runId: "run-e",
      clock,
      isProcessAlive: () => true,
      processStartTime: async () => {
        asked += 1;
        return HOLDER_START + 60_000;
      },
    });
    assert.equal(held.ok, false, "a live pid holds an old-format lock");
    assert.equal(asked, 0);
    const dead = await acquireLock({ workspaceRoot: root, runId: "run-f", clock, retryForMs: ACQUIRE_BUDGET_MS, isProcessAlive: () => false, processStartTime: async () => null });
    assert.equal(dead.ok, true, "a dead pid's old-format lock is reclaimed as before");
  });

  test("a start time that is not a real timestamp makes the lock not understood: never reclaimed", async () => {
    const root = await workspace();
    await writeLock(root, { pid: REUSED_PID, runId: "odd-run", startedAt: "2026-01-02T03:00:01.000Z", processStartedAt: "2026-02-30T00:00:00Z" });
    const outcome = await acquireLock({ workspaceRoot: root, runId: "run-g", clock, isProcessAlive: () => false, processStartTime: async () => null });
    assert.deepEqual(outcome, { ok: false, code: "workspace_locked", holder: null });
  });

  test("a reclaim file left by a dead reclaimer whose pid was reused does not block the reclaim", async () => {
    const root = await workspace();
    const DEAD_HOLDER = 515151;
    await writeLock(root, { pid: DEAD_HOLDER, runId: "dead-run", startedAt: "2026-01-02T03:00:01.000Z", processStartedAt: new Date(HOLDER_START).toISOString() });
    await writeLock(
      root,
      { pid: REUSED_PID, runId: "dead-reclaimer", startedAt: "2026-01-02T03:00:02.000Z", processStartedAt: new Date(HOLDER_START).toISOString(), reclaim: "x" },
      "lock.json.reclaim",
    );
    const outcome = await acquireLock({
      workspaceRoot: root,
      runId: "run-h",
      clock,
      retryForMs: ACQUIRE_BUDGET_MS,
      isProcessAlive: (pid) => pid === REUSED_PID,
      processStartTime: async (pid) => (pid === REUSED_PID ? HOLDER_START + 60_000 : null),
    });
    assert.equal(outcome.ok, true);
  });
});

describe("processStartTime on this system (N-25 b)", () => {
  test("knows this process and a child process, and says null for a pid no process has", async () => {
    assert.equal(await processStartTime(process.pid), performance.timeOrigin);

    const before = Date.now();
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "ignore", windowsHide: true });
    try {
      assert.ok(child.pid !== undefined);
      // Z-1: the real query, given the time a loaded machine needs (the default 5 s answers null then).
      const started = await processStartTime(child.pid, { timeoutMs: START_QUERY_BUDGET_MS });
      const afterSpawn = Date.now();
      assert.ok(started !== null, "the start time of a running child is known");
      assert.ok(started >= before - PROCESS_START_TOLERANCE_MS && started <= afterSpawn + PROCESS_START_TOLERANCE_MS, `${started} in [${before}, ${afterSpawn}]`);
    } finally {
      child.kill();
    }
    // Windows pids are multiples of 4 and far below this; POSIX pid_max is at most 2^22.
    assert.equal(await processStartTime(2147483644, { timeoutMs: START_QUERY_BUDGET_MS }), null);
  });

  test("Z-1: a query that takes longer than its timeout answers null (unknown), which keeps a lock held", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "ignore", windowsHide: true });
    try {
      assert.ok(child.pid !== undefined);
      // No system tool starts within 1 ms.
      assert.equal(await processStartTime(child.pid, { timeoutMs: 1 }), null);
    } finally {
      child.kill();
    }
  });

  test("Z-2 end to end: a lock naming a live unrelated process that started later is reclaimed with the real checks", async () => {
    const root = await workspace();
    const unrelated = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "ignore", windowsHide: true });
    try {
      assert.ok(unrelated.pid !== undefined);
      await writeLock(root, { pid: unrelated.pid, runId: "crashed-run", startedAt: "2000-01-01T00:00:00.000Z", processStartedAt: "2000-01-01T00:00:00.000Z" });
      // The real liveness and start-time checks; Z-1: the start-time query gets the time a loaded
      // machine needs, since a null answer (timeout) rightly keeps the lock held.
      const outcome = await acquireLock({
        workspaceRoot: root,
        runId: "run-i",
        clock,
        retryForMs: ACQUIRE_BUDGET_MS,
        processStartTime: (pid) => processStartTime(pid, { timeoutMs: START_QUERY_BUDGET_MS }),
      });
      assert.equal(outcome.ok, true, "the crashed run's lock is reclaimed although its pid is alive");
      await releaseLock({ workspaceRoot: root, runId: "run-i" });

      await writeLock(root, { pid: unrelated.pid, runId: "crashed-old", startedAt: "2000-01-01T00:00:00.000Z" });
      const old = await acquireLock({ workspaceRoot: root, runId: "run-j", clock });
      assert.equal(old.ok, false, "an old-format lock is still judged by the pid alone");
    } finally {
      unrelated.kill();
    }
  });
});
