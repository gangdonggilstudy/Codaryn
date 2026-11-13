/**
 * U-176 (ne-verify's smoke flake; design in the unit's report): a lock that could not be released
 * stayed with this process's live pid, so every later start in this process was workspace_locked.
 * - (1) releaseLock tries again, briefly, when removing the lock fails with EBUSY or EPERM (a handle
 *   that does not share deletion, as some scanners open files); in the end it still throws.
 * - (3) acquireLock (and inspectLock, which judges as it does) takes back a lock of this very process
 *   that no attempt here holds any more: its pid is this process's, its recorded start is this
 *   process's to the letter, and it is not in this process's list of held locks. Nothing else
 *   changes: a live lock of another process, a lock this process holds now, and a lock of this pid
 *   without a recorded start are never taken back.
 * The handle cases need Windows: another process (PowerShell) opens the lock file sharing reading only,
 * as the smoke flake's holder did, so removing or moving it fails (EPERM) until it closes. Fake run ids only.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { acquireLock, inspectLock, processStartTime, releaseLock } from "../../../src/store/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codaryn-u176-"));
  roots.push(root);
  return root;
}
const clock = { now: () => Date.now() };
const lockFile = (root: string): string => join(root, ".codaryn", "lock.json");
const OWN_START = new Date(performance.timeOrigin).toISOString();
const windowsOnly = process.platform === "win32" ? false : "a handle that does not share deletion is made with PowerShell on Windows";
/**
 * Another process opens `file` sharing reading only (no deletion) for `ms` milliseconds. Resolves once it
 * holds the file; `closed` resolves when it has let go.
 */
async function holdOpen(file: string, ms: number): Promise<{ readonly closed: Promise<void> }> {
  const script = `$h = [System.IO.File]::Open($env:U176_FILE, "Open", "Read", "Read"); [Console]::Out.WriteLine("held"); Start-Sleep -Milliseconds ${ms}; $h.Close()`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, U176_FILE: file }, stdio: ["ignore", "pipe", "ignore"] });
  const closed = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  await new Promise<void>((resolve, reject) => {
    child.stdout?.on("data", (chunk: Buffer) => { if (chunk.toString().includes("held")) resolve(); });
    child.once("exit", () => reject(new Error("the holder ended before it held the file")));
  });
  return { closed };
}
const transient = (error: unknown): boolean => ["EBUSY", "EPERM"].includes(String((error as { code?: unknown }).code));

describe("U-176 (1): releaseLock tries again when the lock file is held open", () => {
  test("a handle closed after a short while: the release succeeds and the lock is gone", { skip: windowsOnly }, async () => {
    const root = await workspace();
    assert.ok((await acquireLock({ workspaceRoot: root, runId: "run-a", clock })).ok);
    const holder = await holdOpen(lockFile(root), 300);
    assert.equal(await releaseLock({ workspaceRoot: root, runId: "run-a" }), true);
    await holder.closed;
    assert.equal(existsSync(lockFile(root)), false);
  });

  test("a handle held past the retries: the release throws, the lock stays", { skip: windowsOnly }, async () => {
    const root = await workspace();
    assert.ok((await acquireLock({ workspaceRoot: root, runId: "run-a", clock })).ok);
    const holder = await holdOpen(lockFile(root), 3000);
    try {
      await assert.rejects(releaseLock({ workspaceRoot: root, runId: "run-a" }), transient);
      assert.equal(existsSync(lockFile(root)), true);
    } finally {
      await holder.closed;
    }
  });
});

describe("U-176 (3): a lock of this process that nothing here holds any more is taken back", () => {
  test("after a release that failed: inspectLock says stale, and the next acquire in this process takes it", { skip: windowsOnly }, async () => {
    const root = await workspace();
    assert.ok((await acquireLock({ workspaceRoot: root, runId: "run-a", clock })).ok);
    const holder = await holdOpen(lockFile(root), 3000);
    await assert.rejects(releaseLock({ workspaceRoot: root, runId: "run-a" }), transient);
    await holder.closed;
    assert.equal((await inspectLock(root)).state, "stale");
    const next = await acquireLock({ workspaceRoot: root, runId: "run-b", clock });
    assert.ok(next.ok, JSON.stringify(next));
    assert.equal(JSON.parse(readFileSync(lockFile(root), "utf8")).runId, "run-b");
    assert.equal(await releaseLock({ workspaceRoot: root, runId: "run-b" }), true);
  });

  test("a lock written with this process's pid and start but held by nothing here: taken back (any platform)", async () => {
    const root = await workspace();
    await mkdir(join(root, ".codaryn"), { recursive: true });
    writeFileSync(lockFile(root), `${JSON.stringify({ pid: process.pid, runId: "left-run", startedAt: "2026-11-13T00:00:00.000Z", processStartedAt: OWN_START })}\n`);
    assert.equal((await inspectLock(root)).state, "stale");
    const next = await acquireLock({ workspaceRoot: root, runId: "run-b", clock });
    assert.ok(next.ok, JSON.stringify(next));
    await releaseLock({ workspaceRoot: root, runId: "run-b" });
  });

  test("a lock this process holds now is never taken back by another attempt here", async () => {
    const root = await workspace();
    assert.ok((await acquireLock({ workspaceRoot: root, runId: "run-a", clock })).ok);
    assert.equal((await inspectLock(root)).state, "held");
    const second = await acquireLock({ workspaceRoot: root, runId: "run-b", clock });
    assert.deepEqual([second.ok, second.ok ? null : second.holder?.runId], [false, "run-a"]);
    assert.equal(await releaseLock({ workspaceRoot: root, runId: "run-a" }), true);
    assert.ok((await acquireLock({ workspaceRoot: root, runId: "run-b", clock })).ok);
    await releaseLock({ workspaceRoot: root, runId: "run-b" });
  });

  test("a lock of this pid without a recorded start (who wrote it cannot be told): never taken back", async () => {
    const root = await workspace();
    await mkdir(join(root, ".codaryn"), { recursive: true });
    const text = `${JSON.stringify({ pid: process.pid, runId: "old-run", startedAt: "2026-11-13T00:00:00.000Z" })}\n`;
    writeFileSync(lockFile(root), text);
    assert.equal((await inspectLock(root)).state, "held");
    const outcome = await acquireLock({ workspaceRoot: root, runId: "run-b", clock });
    assert.equal(outcome.ok, false);
    assert.equal(readFileSync(lockFile(root), "utf8"), text);
  });

  test("a live lock of another process (a child node), with or without its start: never taken back", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    try {
      const pid = child.pid as number;
      const start = await processStartTime(pid);
      for (const lock of [
        { pid, runId: "other-run", startedAt: "2026-11-13T00:00:00.000Z" },
        ...(start === null ? [] : [{ pid, runId: "other-run", startedAt: "2026-11-13T00:00:00.000Z", processStartedAt: new Date(start).toISOString() }]),
      ]) {
        const root = await workspace();
        await mkdir(join(root, ".codaryn"), { recursive: true });
        const text = `${JSON.stringify(lock)}\n`;
        writeFileSync(lockFile(root), text);
        assert.equal((await inspectLock(root)).state, "held", JSON.stringify(lock));
        const outcome = await acquireLock({ workspaceRoot: root, runId: "run-b", clock });
        assert.equal(outcome.ok, false, JSON.stringify(lock));
        assert.equal(readFileSync(lockFile(root), "utf8"), text, "the other process's lock is untouched");
      }
    } finally {
      child.kill();
    }
  });
});
