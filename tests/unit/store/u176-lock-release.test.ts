/**
 * U-176 (ne-verify's smoke flake; design in the unit's report; changed after Codex's V-4): a lock that
 * could not be released stayed with this process's live pid, so every later start in this process was
 * workspace_locked.
 * - (1) releaseLock tries again, briefly, when reading or removing the lock fails with EBUSY or EPERM (a
 *   handle that does not share deletion or reading, as some scanners open files).
 * - (2) When it still cannot, it throws, so the caller can say so; the lock stays and is judged by the
 *   rules as before: held while this process lives, never taken back by this process (V-4 H-1: the
 *   reclaim of a process's own lock is taken out). A later release of the same run still removes it.
 * The handle cases need Windows: another process (PowerShell) opens the lock file sharing reading only
 * (no deletion), as the smoke flake's holder did, or sharing nothing (no reading either). Fake run ids only.
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
 * Another process opens `file` for `ms` milliseconds, sharing reading only ("Read": no deletion) or
 * nothing ("None": no reading either). Resolves once it holds the file; `closed` resolves when it has let go.
 */
async function holdOpen(file: string, ms: number, share: "Read" | "None" = "Read"): Promise<{ readonly closed: Promise<void> }> {
  const script = `$h = [System.IO.File]::Open($env:U176_FILE, "Open", "Read", "${share}"); [Console]::Out.WriteLine("held"); Start-Sleep -Milliseconds ${ms}; $h.Close()`;
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
  for (const share of ["Read", "None"] as const) {
    const what = share === "Read" ? "removing" : "reading";
    test(`a handle that stops ${what} closes after a short while: the release succeeds and the lock is gone`, { skip: windowsOnly }, async () => {
      const root = await workspace();
      assert.ok((await acquireLock({ workspaceRoot: root, runId: "run-a", clock })).ok);
      const holder = await holdOpen(lockFile(root), 300, share);
      assert.equal(await releaseLock({ workspaceRoot: root, runId: "run-a" }), true);
      await holder.closed;
      assert.equal(existsSync(lockFile(root)), false);
      assert.ok((await acquireLock({ workspaceRoot: root, runId: "run-b", clock })).ok);
      assert.equal(await releaseLock({ workspaceRoot: root, runId: "run-b" }), true);
    });

    test(`a handle that stops ${what} past the retries: the release throws, the lock stays`, { skip: windowsOnly }, async () => {
      const root = await workspace();
      assert.ok((await acquireLock({ workspaceRoot: root, runId: "run-a", clock })).ok);
      const holder = await holdOpen(lockFile(root), 3000, share);
      try {
        if (share === "Read") await assert.rejects(releaseLock({ workspaceRoot: root, runId: "run-a" }), transient);
        else await assert.rejects(releaseLock({ workspaceRoot: root, runId: "run-a" }));
        assert.equal(existsSync(lockFile(root)), true);
      } finally {
        await holder.closed;
      }
    });
  }
});

describe("U-176 (2): a lock left by a failed release is judged as before; this process never takes it back", () => {
  test("after the handle closed: held, the next acquire here is refused and moves nothing; releasing the run again removes it", { skip: windowsOnly }, async () => {
    const root = await workspace();
    assert.ok((await acquireLock({ workspaceRoot: root, runId: "run-a", clock })).ok);
    const holder = await holdOpen(lockFile(root), 3000);
    await assert.rejects(releaseLock({ workspaceRoot: root, runId: "run-a" }), transient);
    await holder.closed;
    const text = readFileSync(lockFile(root), "utf8");
    assert.equal((await inspectLock(root)).state, "held");
    const next = await acquireLock({ workspaceRoot: root, runId: "run-b", clock, retryForMs: 200 });
    assert.deepEqual([next.ok, next.ok ? null : next.holder?.runId], [false, "run-a"]);
    assert.equal(readFileSync(lockFile(root), "utf8"), text, "the left lock is untouched");
    assert.equal(await releaseLock({ workspaceRoot: root, runId: "run-a" }), true);
    assert.ok((await acquireLock({ workspaceRoot: root, runId: "run-b", clock })).ok);
    assert.equal(await releaseLock({ workspaceRoot: root, runId: "run-b" }), true);
  });

  test("a lock written with this process's pid and exact start that nothing here holds: held, never taken back (any platform)", async () => {
    const root = await workspace();
    await mkdir(join(root, ".codaryn"), { recursive: true });
    const text = `${JSON.stringify({ pid: process.pid, runId: "left-run", startedAt: "2026-11-13T00:00:00.000Z", processStartedAt: OWN_START })}\n`;
    writeFileSync(lockFile(root), text);
    assert.equal((await inspectLock(root)).state, "held");
    const next = await acquireLock({ workspaceRoot: root, runId: "run-b", clock, retryForMs: 200 });
    assert.equal(next.ok, false);
    assert.equal(readFileSync(lockFile(root), "utf8"), text);
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
