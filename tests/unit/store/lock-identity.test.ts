/**
 * N-27 (d): on Linux the lock also records the holder's start in clock ticks since boot
 * (/proc/<pid>/stat field 22) and the boot id. They do not move with the wall clock, so a clock
 * step cannot make a live holder look dead. The /proc reads are injected: this suite runs on any
 * platform. Fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import type { Clock } from "../../../src/contracts/index.js";
import { PROCESS_START_TOLERANCE_MS, acquireLock, linuxProcessIdentity, parseProcStartTicks } from "../../../src/store/index.js";
import { ACQUIRE_BUDGET_MS } from "./lock-budget.js";

const clock: Clock = { now: () => Date.UTC(2026, 0, 2, 3, 4, 5) };
const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codaryn-lock-identity-"));
  roots.push(root);
  await mkdir(join(root, ".codaryn"));
  return root;
}

const HOLDER = 434343;
const BOOT = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const HOLDER_START = Date.UTC(2026, 0, 2, 3, 0, 0);

async function holderLock(root: string, extra: Record<string, unknown> = {}): Promise<void> {
  const lock = { pid: HOLDER, runId: "live-run", startedAt: "2026-01-02T03:00:01.000Z", processStartedAt: new Date(HOLDER_START).toISOString(), processStartTicks: "123456", bootId: BOOT, ...extra };
  await writeFile(join(root, ".codaryn", "lock.json"), `${JSON.stringify(lock)}\n`, "utf8");
}

describe("lock holder identity on Linux (N-27 d)", () => {
  test("parses field 22 of /proc/<pid>/stat, also when the command name holds spaces and parentheses", () => {
    const fields = Array.from({ length: 50 }, (_, index) => String(index + 3));
    fields[19] = "987654";
    assert.equal(parseProcStartTicks(`4242 (node (my) worker) ${fields.join(" ")}\n`), "987654");
    assert.equal(parseProcStartTicks("4242 (node) S 1"), null, "too few fields");
    assert.equal(parseProcStartTicks("garbage"), null);
  });

  test("reads the identity from /proc on Linux only", async () => {
    const files: Record<string, string> = {
      "/proc/4242/stat": `4242 (node) ${Array.from({ length: 50 }, (_, index) => (index === 19 ? "555" : "1")).join(" ")}\n`,
      "/proc/sys/kernel/random/boot_id": `${BOOT}\n`,
    };
    const read = async (file: string): Promise<string> => {
      const text = files[file];
      if (text === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return text;
    };
    assert.deepEqual(await linuxProcessIdentity(4242, { platform: "linux", read }), { startTicks: "555", bootId: BOOT });
    assert.equal(await linuxProcessIdentity(4242, { platform: "win32", read }), null);
    assert.equal(await linuxProcessIdentity(1, { platform: "linux", read }), null, "no such process");
  });

  test("a wall clock step does not make a live holder look dead: the same ticks and boot keep the lock held", async () => {
    const root = await workspace();
    await holderLock(root);
    const outcome = await acquireLock({
      workspaceRoot: root,
      runId: "run-a",
      clock,
      isProcessAlive: (pid) => pid === HOLDER,
      // The clock moved: the start computed from the wall clock is far from the recorded one.
      processStartTime: async () => HOLDER_START + 10 * PROCESS_START_TOLERANCE_MS,
      processIdentity: async (pid) => (pid === HOLDER ? { startTicks: "123456", bootId: BOOT } : null),
    });
    assert.equal(outcome.ok, false, "still held by the live holder");
  });

  test("other ticks or another boot mean the pid was given to another process: the lock is reclaimed", async () => {
    for (const identity of [{ startTicks: "999999", bootId: BOOT }, { startTicks: "123456", bootId: "00000000-0000-0000-0000-000000000000" }]) {
      const root = await workspace();
      await holderLock(root);
      const outcome = await acquireLock({
        workspaceRoot: root,
        runId: "run-b",
        clock,
        retryForMs: ACQUIRE_BUDGET_MS,
        isProcessAlive: (pid) => pid === HOLDER,
        processStartTime: async () => HOLDER_START,
        processIdentity: async () => identity,
      });
      assert.equal(outcome.ok, true, JSON.stringify(identity));
    }
  });

  test("a new lock records the identity when there is one; a lock without it is judged as before", async () => {
    const root = await workspace();
    const outcome = await acquireLock({ workspaceRoot: root, runId: "run-c", clock, processIdentity: async (pid) => (pid === process.pid ? { startTicks: "777", bootId: BOOT } : null) });
    assert.equal(outcome.ok, true);
    const written = JSON.parse(await readFile(join(root, ".codaryn", "lock.json"), "utf8")) as Record<string, unknown>;
    assert.equal(written["processStartTicks"], "777");
    assert.equal(written["bootId"], BOOT);

    const old = await workspace();
    await holderLock(old, { processStartTicks: undefined, bootId: undefined });
    const held = await acquireLock({ workspaceRoot: old, runId: "run-d", clock, isProcessAlive: () => true, processStartTime: async () => HOLDER_START, processIdentity: async () => null });
    assert.equal(held.ok, false, "within the tolerance of the recorded start time");
  });

  test("an identity of the wrong shape makes the lock not understood: never reclaimed", async () => {
    const root = await workspace();
    await holderLock(root, { processStartTicks: "12a", bootId: "x" });
    const outcome = await acquireLock({ workspaceRoot: root, runId: "run-e", clock, isProcessAlive: () => false, processIdentity: async () => null });
    assert.deepEqual(outcome, { ok: false, code: "workspace_locked", holder: null });
  });
});
