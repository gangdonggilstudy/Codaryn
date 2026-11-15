/**
 * U-176 after Codex's V-4 (verify-V4-u176.md, its probe.mjs and focused.mjs): the four findings against
 * 2509f10, taken over as tests that pin that none of them happens on this board, where the reclaim of a
 * process's own lock and its list of held locks are taken out (PM).
 * - H-1: a reclaim of this process's own left lock, stopped right before its move, could move and delete
 *   the live lock of another process B that took the lock after the original release succeeded, and let
 *   a third process C in. Now nothing in this process reclaims a lock of a live pid, B's lock stays, C is refused.
 * - M-1: a second, refused acquire with the same run id and time dropped the first owner's listing.
 * - M-2: another spelling of the workspace path, or a lock reformatted or with another runId or startedAt,
 *   made a live lock of this process look left over.
 * - M-3: a read failure during the release left the listing behind. Reading is now retried as removing
 *   is; when it still fails, the release throws and the lock stays, judged as after a failed removal.
 * The failures are injected only into the lock file's removal (`rm`) or reading (nodeLockFileSystem); the
 * other processes are real child processes. Fake run ids only.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, test } from "node:test";

import { acquireLock, inspectLock, nodeLockFileSystem, releaseLock } from "../../../src/store/index.js";
import type { LockFileSystem } from "../../../src/store/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codaryn-u176-v4-"));
  roots.push(root);
  return root;
}
const FIXED = { now: () => Date.UTC(2026, 10, 13) };
const lockFile = (root: string): string => join(root, ".codaryn", "lock.json");
const lockRun = (root: string): unknown => (JSON.parse(readFileSync(lockFile(root), "utf8")) as { runId?: unknown }).runId;
const acquire = (root: string, runId: string, extra: { fileSystem?: LockFileSystem; retryForMs?: number } = {}) =>
  acquireLock({ workspaceRoot: root, runId, clock: FIXED, retryForMs: 400, ...extra });

const require = createRequire(import.meta.url);
const promises: { rm: typeof import("node:fs/promises").rm } = require("node:fs/promises");

/** Runs `run` while removing `file` fails with `code` (V-4's syscall injection); other removals are real. */
async function whileRemovalFails<T>(file: string, code: string, run: () => Promise<T>): Promise<T> {
  const original = promises.rm;
  promises.rm = async (path, options) => {
    if (resolve(String(path)).toLowerCase() === file.toLowerCase()) throw Object.assign(new Error(`U-176 V-4 injected ${code}`), { code });
    return original(path, options);
  };
  syncBuiltinESMExports();
  try {
    return await run();
  } finally {
    promises.rm = original;
    syncBuiltinESMExports();
  }
}

/** Runs `run` while reading `file` fails with `code` for the first `times` reads (V-4's read injection). */
async function whileReadingFails<T>(file: string, code: string, times: number, run: (reads: () => number) => Promise<T>): Promise<T> {
  const target = nodeLockFileSystem as { readText: LockFileSystem["readText"] };
  const original = target.readText;
  let reads = 0;
  target.readText = async (path) => {
    if (path === file && reads++ < times) throw Object.assign(new Error(`U-176 V-4 injected ${code}`), { code });
    return original(path);
  };
  try {
    return await run(() => reads);
  } finally {
    target.readText = original;
  }
}

/** A real child process that tries the lock for `runId` and stays alive until stopped (V-4's holder.mjs). */
async function holder(root: string, runId: string): Promise<{ readonly acquired: boolean; readonly child: ChildProcess; stop(): Promise<void> }> {
  const store = new URL("../../../src/store/index.js", import.meta.url).href;
  const code = [
    "const [url, root, runId] = process.argv.slice(1);",
    "const store = await import(url);",
    "const result = await store.acquireLock({ workspaceRoot: root, runId, clock: { now: () => Date.now() }, retryForMs: 300 });",
    "process.send({ ok: result.ok });",
    "process.on('message', (message) => { if (message === 'stop') process.exit(0); });",
    "setTimeout(() => process.exit(2), 30000).unref();",
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, store, root, runId], { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const acquired = await new Promise<boolean>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`holder timeout ${stderr}`)), 15000);
    child.once("message", (message: { ok: boolean }) => {
      clearTimeout(timer);
      done(message.ok);
    });
    child.once("exit", (exitCode) => {
      clearTimeout(timer);
      fail(new Error(`holder ended early (${String(exitCode)}) ${stderr}`));
    });
  });
  return {
    acquired,
    child,
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise((done) => child.once("exit", done));
      child.send("stop");
      await exited;
    },
  };
}

describe("U-176 after V-4: none of the four findings happens", () => {
  test("H-1: after a failed release this process moves nothing; B's live lock stays and C is refused", async () => {
    const root = await workspace();
    assert.ok((await acquire(root, "run-a")).ok);
    await assert.rejects(whileRemovalFails(lockFile(root), "EBUSY", () => releaseLock({ workspaceRoot: root, runId: "run-a" })));
    assert.equal(lockRun(root), "run-a", "the failed release left the lock");

    // V-4's schedule: if this process ever moves lock.json aside, first the original release succeeds and
    // a real process B takes the lock, then the move happens and a real process C takes the gap.
    const started: { stop(): Promise<void> }[] = [];
    let lockMoves = 0;
    const scheduled: LockFileSystem = {
      ...nodeLockFileSystem,
      rename: async (from, to) => {
        if (from === lockFile(root) && lockMoves++ === 0) {
          await releaseLock({ workspaceRoot: root, runId: "run-a" });
          started.push(await holder(root, "child-b"));
          await nodeLockFileSystem.rename(from, to);
          started.push(await holder(root, "child-c"));
          return;
        }
        return nodeLockFileSystem.rename(from, to);
      },
    };
    try {
      const reclaimer = await acquire(root, "reclaimer", { fileSystem: scheduled, retryForMs: 1500 });
      assert.deepEqual([reclaimer.ok, lockMoves, lockRun(root)], [false, 0, "run-a"], "the left lock of this live process is not reclaimed or moved");

      // The original run releases after all, and a real process B takes the lock.
      assert.equal(await releaseLock({ workspaceRoot: root, runId: "run-a" }), true);
      const b = await holder(root, "child-b");
      started.push(b);
      assert.equal(b.acquired, true);
      const again = await acquire(root, "reclaimer", { fileSystem: scheduled, retryForMs: 600 });
      const c = await holder(root, "child-c");
      started.push(c);
      assert.deepEqual([again.ok, again.ok ? null : again.holder?.runId, c.acquired], [false, "child-b", false]);
      assert.deepEqual([lockMoves, lockRun(root), b.child.exitCode], [0, "child-b", null], "B's live lock is where it was");
    } finally {
      for (const child of started) await child.stop();
    }
  });

  test("M-1: a refused second acquire with the same run id and time leaves the first owner holding", async () => {
    const root = await workspace();
    assert.ok((await acquire(root, "run-a")).ok);
    const second = await acquire(root, "run-a");
    const afterSecond = (await inspectLock(root)).state;
    const third = await acquire(root, "run-c");
    assert.deepEqual([second.ok, afterSecond, third.ok, lockRun(root)], [false, "held", false, "run-a"]);
    assert.equal(await releaseLock({ workspaceRoot: root, runId: "run-a" }), true);
  });

  test("M-2: another spelling of the path, or a reformatted or edited lock, is still this live process's lock", async () => {
    if (process.platform === "win32") {
      const root = await workspace();
      assert.ok((await acquire(root, "run-a")).ok);
      const alias = await acquire(root.toUpperCase(), "run-b");
      assert.deepEqual([alias.ok, (await inspectLock(root)).state, lockRun(root)], [false, "held", "run-a"], "the path in other letter case");
      assert.equal(await releaseLock({ workspaceRoot: root, runId: "run-a" }), true);
    }
    for (const edit of ["format", "runId", "startedAt"] as const) {
      const root = await workspace();
      assert.ok((await acquire(root, "run-a")).ok);
      const lock = JSON.parse(readFileSync(lockFile(root), "utf8")) as Record<string, unknown>;
      if (edit === "runId") lock["runId"] = "edited-run";
      if (edit === "startedAt") lock["startedAt"] = "2020-01-01T00:00:00.000Z";
      writeFileSync(lockFile(root), edit === "format" ? `${JSON.stringify(lock, null, 2)}\n` : `${JSON.stringify(lock)}\n`);
      const text = readFileSync(lockFile(root), "utf8");
      const second = await acquire(root, "run-b");
      assert.deepEqual([(await inspectLock(root)).state, second.ok], ["held", false], edit);
      assert.equal(readFileSync(lockFile(root), "utf8"), text, `${edit}: the lock is untouched`);
    }
  });

  test("M-3: reading is retried as removing is; a read that keeps failing throws and leaves only the lock file", async () => {
    // A read that fails a few times: the release retries it and removes the lock.
    for (const code of ["EPERM", "EBUSY"]) {
      const root = await workspace();
      assert.ok((await acquire(root, "run-a")).ok);
      const outcome = await whileReadingFails(lockFile(root), code, 3, async (reads) => [await releaseLock({ workspaceRoot: root, runId: "run-a" }), reads()]);
      assert.deepEqual(outcome, [true, 4], code);
      assert.equal(existsSync(lockFile(root)), false, code);
      assert.ok((await acquire(root, "run-next")).ok, code);
    }
    // A removal that keeps failing and a read that keeps failing leave the same state (2509f10 reclaimed
    // after the first only): held while this process lives, refused, untouched.
    {
      const root = await workspace();
      assert.ok((await acquire(root, "run-a")).ok);
      const text = readFileSync(lockFile(root), "utf8");
      await assert.rejects(whileRemovalFails(lockFile(root), "EPERM", () => releaseLock({ workspaceRoot: root, runId: "run-a" })));
      assert.deepEqual([(await inspectLock(root)).state, (await acquire(root, "run-next")).ok, readFileSync(lockFile(root), "utf8") === text], ["held", false, true], "removal");
      assert.equal(await releaseLock({ workspaceRoot: root, runId: "run-a" }), true);
    }
    // A read that keeps failing: six reads, then the release throws; the lock stays as after a failed removal.
    for (const code of ["EPERM", "EBUSY"]) {
      const root = await workspace();
      assert.ok((await acquire(root, "run-a")).ok);
      const text = readFileSync(lockFile(root), "utf8");
      const reads = await whileReadingFails(lockFile(root), code, Number.POSITIVE_INFINITY, async (count) => {
        await assert.rejects(releaseLock({ workspaceRoot: root, runId: "run-a" }));
        return count();
      });
      assert.equal(reads, 6, code);
      assert.deepEqual([(await inspectLock(root)).state, (await acquire(root, "run-next")).ok, readFileSync(lockFile(root), "utf8") === text], ["held", false, true], code);
      // Nothing else in this process remembers it: once the cause is gone the run's release removes it,
      // and a lock file a person removed (as doctor advises) stops nothing either.
      assert.equal(await releaseLock({ workspaceRoot: root, runId: "run-a" }), true, code);
      assert.ok((await acquire(root, "run-next")).ok, code);
      assert.equal(await releaseLock({ workspaceRoot: root, runId: "run-next" }), true, code);
    }
    {
      const root = await workspace();
      assert.ok((await acquire(root, "run-a")).ok);
      await whileReadingFails(lockFile(root), "EBUSY", Number.POSITIVE_INFINITY, () => assert.rejects(releaseLock({ workspaceRoot: root, runId: "run-a" })));
      await rm(lockFile(root));
      assert.ok((await acquire(root, "run-next")).ok, "after a person removed the left lock file");
    }
  });
});
