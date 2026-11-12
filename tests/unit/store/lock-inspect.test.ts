/**
 * PM: doctor judges the workspace lock with the store's own rules (inspectLock, lockHolderAlive),
 * so on Linux it also decides by ticks since boot and the boot id (N-27 d), as a run does. Each
 * state is checked against what acquireLock then actually does. inspectLock changes nothing.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { acquireLock, inspectLock, lockHolderAlive } from "../../../src/store/index.js";
import type { LockInfo, LockLivenessOptions } from "../../../src/store/index.js";
import { ACQUIRE_BUDGET_MS } from "./lock-budget.js";

const clock = { now: () => Date.UTC(2026, 10, 12, 6, 0, 0) };
const LIVE_PID = 4_000_002;
const DEAD_PID = 4_000_001;
const STARTED = "2026-11-12T05:00:00.000Z";
const BOOT = "0f0e0d0c-0b0a-4908-8706-050403020100";

/** Liveness as the system would answer: only LIVE_PID runs, it started at STARTED (wall clock) with ticks 1000. */
const system = (overrides: Partial<LockLivenessOptions> = {}): LockLivenessOptions => ({
  isProcessAlive: (pid) => pid === LIVE_PID,
  processStartTime: async () => Date.parse(STARTED),
  processIdentity: async () => ({ startTicks: "1000", bootId: BOOT }),
  ...overrides,
});

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "codaryn-lock-inspect-"));
  try {
    await mkdir(join(root, ".codaryn"), { recursive: true });
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const lockText = (lock: Record<string, unknown>): string => `${JSON.stringify(lock)}\n`;
const holder = (pid: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ pid, runId: "held-run", startedAt: STARTED, ...extra });

async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of await readdir(join(root, ".codaryn"))) out[name] = await readFile(join(root, ".codaryn", name), "utf8");
  return out;
}

/** What inspectLock says, that it changed nothing, and what acquireLock then does with the same liveness answers. */
/**
 * `retryForMs`: a case that should acquire gets ACQUIRE_BUDGET_MS (Z-1; it returns as soon as it
 * acquires); a case that should be refused needs none.
 */
async function judged(root: string, liveness: LockLivenessOptions, retryForMs: number): Promise<{ state: string; acquired: boolean }> {
  const before = await snapshot(root);
  const inspection = await inspectLock(root, liveness);
  assert.deepEqual(await snapshot(root), before, "inspectLock changes nothing");
  const outcome = await acquireLock({ workspaceRoot: root, runId: "next-run", clock, retryForMs, ...liveness });
  return { state: inspection.state, acquired: outcome.ok };
}

describe("inspectLock judges as acquireLock does", () => {
  const cases: [string, Record<string, string>, LockLivenessOptions, string, boolean][] = [
    ["no lock", {}, system(), "none", true],
    ["a live holder", { "lock.json": lockText(holder(LIVE_PID, { processStartedAt: STARTED })) }, system(), "held", false],
    ["a dead pid", { "lock.json": lockText(holder(DEAD_PID)) }, system(), "stale", true],
    ["a live pid that started at another time (Z-2)", { "lock.json": lockText(holder(LIVE_PID, { processStartedAt: "2026-11-12T01:00:00.000Z" })) }, system({ processIdentity: async () => null }), "stale", true],
    [
      "N-27 d: the same ticks and boot keep it held although the wall clock moved",
      { "lock.json": lockText(holder(LIVE_PID, { processStartedAt: "2026-11-12T01:00:00.000Z", processStartTicks: "1000", bootId: BOOT })) },
      system(),
      "held",
      false,
    ],
    [
      "N-27 d: other ticks mean the pid went to another process, whatever the wall clock says",
      { "lock.json": lockText(holder(LIVE_PID, { processStartedAt: STARTED, processStartTicks: "999", bootId: BOOT })) },
      system(),
      "stale",
      true,
    ],
    ["a lock not understood", { "lock.json": "not json\n" }, system(), "unreadable", false],
    ["a lock with a start time that is not a timestamp", { "lock.json": lockText(holder(DEAD_PID, { processStartedAt: "yesterday" })) }, system(), "unreadable", false],
    ["a lock still being written", { "lock.json": '{"pid":4000001,"runId":"he' }, system(), "unreadable", false],
    ["a whole lock without the final newline", { "lock.json": JSON.stringify(holder(DEAD_PID)) }, system(), "stale", true],
    [
      "a reclaim file still being written blocks reclaiming",
      { "lock.json": lockText(holder(DEAD_PID)), "lock.json.reclaim": "" },
      system(),
      "reclaim_left",
      false,
    ],
    [
      "a reclaim file of a live reclaimer blocks reclaiming",
      { "lock.json": lockText(holder(DEAD_PID)), "lock.json.reclaim": lockText({ ...holder(LIVE_PID), reclaim: "x" }) },
      system({ processIdentity: async () => null }),
      "reclaim_left",
      false,
    ],
    [
      "a reclaim file of an ended reclaimer is cleared by the next run: the lock decides",
      { "lock.json": lockText(holder(DEAD_PID)), "lock.json.reclaim": lockText({ ...holder(DEAD_PID), reclaim: "x" }) },
      system(),
      "stale",
      true,
    ],
    [
      "a whole reclaim file not understood is cleared by the next run too: the lock decides",
      { "lock.json": lockText(holder(DEAD_PID)), "lock.json.reclaim": "not json\n" },
      system(),
      "stale",
      true,
    ],
  ];
  for (const [name, files, liveness, state, acquired] of cases) {
    test(name, async () => {
      await withRoot(async (root) => {
        for (const [file, text] of Object.entries(files)) await writeFile(join(root, ".codaryn", file), text);
        assert.deepEqual(await judged(root, liveness, acquired ? ACQUIRE_BUDGET_MS : 100), { state, acquired });
      });
    });
  }

  test("held and stale name the holder; the other states do not", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, ".codaryn", "lock.json"), lockText(holder(DEAD_PID)));
      const inspection = await inspectLock(root, system());
      assert.deepEqual(inspection, { state: "stale", holder: { pid: DEAD_PID, runId: "held-run", startedAt: STARTED } });
    });
  });
});

describe("lockHolderAlive", () => {
  test("is the liveness rule acquireLock uses: identity first, then the start time, then the pid", async () => {
    const lock = (extra: Partial<LockInfo>): LockInfo => ({ pid: LIVE_PID, runId: "r", startedAt: STARTED, ...extra });
    assert.equal(await lockHolderAlive(lock({}), system()), true, "old format: the pid alone");
    assert.equal(await lockHolderAlive(lock({ pid: DEAD_PID }), system()), false);
    assert.equal(await lockHolderAlive(lock({ processStartedAt: "2026-11-12T01:00:00.000Z" }), system({ processIdentity: async () => null })), false);
    assert.equal(await lockHolderAlive(lock({ processStartedAt: "2026-11-12T01:00:00.000Z", processStartTicks: "1000", bootId: BOOT }), system()), true);
    assert.equal(await lockHolderAlive(lock({ processStartedAt: STARTED, processStartTicks: "1000", bootId: "ffffffff-0b0a-4908-8706-050403020100" }), system()), false);
    assert.equal(await lockHolderAlive(lock({ processStartedAt: STARTED }), system({ processIdentity: async () => null, processStartTime: async () => null })), true, "unknown start: held");
  });
});
