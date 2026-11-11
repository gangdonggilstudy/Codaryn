/**
 * T-9: EPERM and EBUSY while taking or reclaiming the workspace lock end as workspace_locked,
 * never as an exception (the review saw them from open and unlink under contention).
 * One file operation is replaced; everything else is the real file system.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { acquireLock, nodeLockFileSystem } from "../../../src/store/index.js";
import type { LockFileSystem } from "../../../src/store/index.js";

const clock = { now: () => Date.UTC(2026, 10, 12, 6, 0, 0) };

/**
 * W-4: pids of the crashed run, a crashed reclaimer and a live reclaimer in another process. The
 * injected check decides, so a pid the system reuses cannot change a case's outcome.
 */
const CRASHED_PID = 4_000_001;
const CRASHED_RECLAIMER_PID = 4_000_003;
const LIVE_RECLAIMER_PID = 4_000_005;
const isProcessAlive = (pid: number): boolean => pid !== CRASHED_PID && pid !== CRASHED_RECLAIMER_PID;

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "codaryn-lock-err-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const lockFile = (root: string): string => join(root, ".codaryn", "lock.json");

async function leaveDeadLock(root: string): Promise<string> {
  await mkdir(join(root, ".codaryn"), { recursive: true });
  const text = `${JSON.stringify({ pid: CRASHED_PID, runId: "crashed-run", startedAt: "2026-11-11T00:00:00.000Z" })}\n`;
  await writeFile(lockFile(root), text);
  return text;
}

/** The real file system with one operation failing `times` times with `code`. */
function failing(operation: keyof LockFileSystem, code: string, times = Number.POSITIVE_INFINITY): LockFileSystem {
  let left = times;
  const real = nodeLockFileSystem[operation] as (...args: string[]) => Promise<unknown>;
  const replaced = async (...args: string[]): Promise<unknown> => {
    if (left > 0) {
      left -= 1;
      throw Object.assign(new Error(`${code}: injected`), { code });
    }
    return real(...args);
  };
  return { ...nodeLockFileSystem, [operation]: replaced } as LockFileSystem;
}

for (const code of ["EPERM", "EBUSY"]) {
  test(`T-9: ${code} while linking a free lock ends as workspace_locked`, async () => {
    await withRoot(async (root) => {
      const outcome = await acquireLock({ workspaceRoot: root, runId: "run-x", clock, fileSystem: failing("link", code), retryForMs: 150 });
      assert.deepEqual(outcome, { ok: false, code: "workspace_locked", holder: null });
      assert.deepEqual(await readdir(join(root, ".codaryn")), [".gitignore"], "no lock and no leftovers");
    });
  });

  test(`T-9: ${code} while reading the existing lock ends as workspace_locked`, async () => {
    await withRoot(async (root) => {
      const before = await leaveDeadLock(root);
      const outcome = await acquireLock({ workspaceRoot: root, runId: "run-x", clock, fileSystem: failing("readText", code), retryForMs: 150, isProcessAlive });
      assert.equal(outcome.ok, false);
      assert.equal(outcome.ok ? "" : outcome.code, "workspace_locked");
      assert.equal(await readFile(lockFile(root), "utf8"), before);
    });
  });

  test(`T-9: ${code} while moving a dead lock away ends as workspace_locked and keeps it`, async () => {
    await withRoot(async (root) => {
      const before = await leaveDeadLock(root);
      const outcome = await acquireLock({ workspaceRoot: root, runId: "run-x", clock, fileSystem: failing("rename", code), retryForMs: 150, isProcessAlive });
      assert.equal(outcome.ok, false);
      assert.equal(outcome.ok ? "" : outcome.code, "workspace_locked");
      assert.equal(await readFile(lockFile(root), "utf8"), before, "the dead lock stays in place");
      assert.deepEqual((await readdir(join(root, ".codaryn"))).sort(), [".gitignore", "lock.json"], "no leftovers");
    });
  });

  test(`T-9: ${code} that clears after two tries still takes the lock`, async () => {
    await withRoot(async (root) => {
      const outcome = await acquireLock({ workspaceRoot: root, runId: "run-y", clock, fileSystem: failing("link", code, 2) });
      assert.equal(outcome.ok, true);
      assert.equal((JSON.parse(await readFile(lockFile(root), "utf8")) as { runId: string }).runId, "run-y");
    });
  });
}

test("T-9: a reclaim file left by a dead reclaimer does not block reclaiming forever", async () => {
  await withRoot(async (root) => {
    await leaveDeadLock(root);
    await writeFile(
      join(root, ".codaryn", "lock.json.reclaim"),
      `${JSON.stringify({ pid: CRASHED_RECLAIMER_PID, runId: "crashed-reclaimer", startedAt: "2026-11-11T00:00:00.000Z" })}\n`,
    );
    const outcome = await acquireLock({ workspaceRoot: root, runId: "run-z", clock, isProcessAlive });
    assert.equal(outcome.ok, true);
    assert.deepEqual((await readdir(join(root, ".codaryn"))).sort(), [".gitignore", "lock.json"]);
  });
});

test("T-9: a reclaim file held by a live process makes a dead lock wait, then workspace_locked", async () => {
  await withRoot(async (root) => {
    const before = await leaveDeadLock(root);
    // Another process that is alive (by the injected check) holds the reclaim file for the whole budget.
    await writeFile(
      join(root, ".codaryn", "lock.json.reclaim"),
      `${JSON.stringify({ pid: LIVE_RECLAIMER_PID, runId: "busy-reclaimer", startedAt: "2026-11-12T00:00:00.000Z" })}\n`,
    );
    const started = Date.now();
    const outcome = await acquireLock({ workspaceRoot: root, runId: "run-w", clock, retryForMs: 150, isProcessAlive });
    assert.ok(Date.now() - started >= 150, "it waited for the reclaimer");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok ? "" : outcome.code, "workspace_locked");
    assert.equal(await readFile(lockFile(root), "utf8"), before);
  });
});

test("W-4: a reclaim file this process left behind (its removal failed) does not stop later attempts", async () => {
  await withRoot(async (root) => {
    await leaveDeadLock(root);
    // The first reclaim cannot move the dead lock (EPERM), and removing its own reclaim file then
    // fails too, so the file stays with this process's pid, which is always alive here.
    let renameFailures = 1;
    let reclaimRemoveFailures = 1;
    const fileSystem: LockFileSystem = {
      ...nodeLockFileSystem,
      rename: async (from, to) => {
        if (renameFailures > 0 && from.endsWith("lock.json")) {
          renameFailures -= 1;
          throw Object.assign(new Error("EPERM: injected"), { code: "EPERM" });
        }
        return nodeLockFileSystem.rename(from, to);
      },
      remove: async (path) => {
        if (reclaimRemoveFailures > 0 && path.endsWith("lock.json.reclaim")) {
          reclaimRemoveFailures -= 1;
          throw Object.assign(new Error("EPERM: injected"), { code: "EPERM" });
        }
        return nodeLockFileSystem.remove(path);
      },
    };
    const outcome = await acquireLock({ workspaceRoot: root, runId: "run-v", clock, fileSystem, retryForMs: 1_000, isProcessAlive });
    assert.equal(renameFailures + reclaimRemoveFailures, 0, "test assumption: both injected failures happened");
    assert.equal(outcome.ok, true, "the left-over reclaim file of a finished attempt is cleared");
    assert.equal((JSON.parse(await readFile(lockFile(root), "utf8")) as { runId: string }).runId, "run-v");
    assert.deepEqual((await readdir(join(root, ".codaryn"))).sort(), [".gitignore", "lock.json"], "no leftovers");

    // A later attempt in the same process is not blocked either.
    assert.equal((await acquireLock({ workspaceRoot: root, runId: "run-u", clock, isProcessAlive })).ok, false, "run-v holds it");
  });
});

test("W-4: a reclaim held by an attempt still at work in this process keeps other attempts out", async () => {
  await withRoot(async (root) => {
    const before = await leaveDeadLock(root);
    // The first attempt takes the reclaim file, then its read of lock.json stalls until released.
    let release: () => void = () => undefined;
    const stalled = new Promise<void>((resolve) => (release = resolve));
    let reads = 0;
    const slow: LockFileSystem = {
      ...nodeLockFileSystem,
      readText: async (path) => {
        if (path.endsWith("lock.json")) {
          reads += 1;
          // The second read of lock.json happens under the reclaim file.
          if (reads === 2) await stalled;
        }
        return nodeLockFileSystem.readText(path);
      },
    };
    const first = acquireLock({ workspaceRoot: root, runId: "run-s", clock, fileSystem: slow, isProcessAlive });
    // Wait until the reclaim file exists, then a second attempt in this process must wait for it.
    for (let i = 0; i < 200 && !(await readdir(join(root, ".codaryn"))).includes("lock.json.reclaim"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok((await readdir(join(root, ".codaryn"))).includes("lock.json.reclaim"), "test assumption: the reclaim is held");
    const second = await acquireLock({ workspaceRoot: root, runId: "run-t", clock, retryForMs: 150, isProcessAlive });
    assert.equal(second.ok, false, "the held reclaim of a running attempt is not cleared as left over");
    assert.equal(await readFile(lockFile(root), "utf8"), before, "the dead lock was not touched by the second attempt");
    release();
    assert.equal((await first).ok, true);
    assert.equal((JSON.parse(await readFile(lockFile(root), "utf8")) as { runId: string }).runId, "run-s");
  });
});
