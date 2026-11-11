/**
 * T-9: EPERM and EBUSY while taking or reclaiming the workspace lock end as workspace_locked,
 * never as an exception (the review saw them from open and unlink under contention).
 * One file operation is replaced; everything else is the real file system.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { acquireLock, nodeLockFileSystem } from "../../../src/store/index.js";
import type { LockFileSystem } from "../../../src/store/index.js";

const clock = { now: () => Date.UTC(2026, 10, 12, 6, 0, 0) };

function exitedPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(child.status, 0);
  return child.pid;
}

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
  const text = `${JSON.stringify({ pid: exitedPid(), runId: "crashed-run", startedAt: "2026-11-11T00:00:00.000Z" })}\n`;
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
      const outcome = await acquireLock({ workspaceRoot: root, runId: "run-x", clock, fileSystem: failing("readText", code), retryForMs: 150 });
      assert.equal(outcome.ok, false);
      assert.equal(outcome.ok ? "" : outcome.code, "workspace_locked");
      assert.equal(await readFile(lockFile(root), "utf8"), before);
    });
  });

  test(`T-9: ${code} while moving a dead lock away ends as workspace_locked and keeps it`, async () => {
    await withRoot(async (root) => {
      const before = await leaveDeadLock(root);
      const outcome = await acquireLock({ workspaceRoot: root, runId: "run-x", clock, fileSystem: failing("rename", code), retryForMs: 150 });
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
      `${JSON.stringify({ pid: exitedPid(), runId: "crashed-reclaimer", startedAt: "2026-11-11T00:00:00.000Z" })}\n`,
    );
    const outcome = await acquireLock({ workspaceRoot: root, runId: "run-z", clock });
    assert.equal(outcome.ok, true);
    assert.deepEqual((await readdir(join(root, ".codaryn"))).sort(), [".gitignore", "lock.json"]);
  });
});

test("T-9: a reclaim file held by a live process makes a dead lock wait, then workspace_locked", async () => {
  await withRoot(async (root) => {
    const before = await leaveDeadLock(root);
    // This process is alive, so its reclaim file is in use for the whole attempt budget.
    await writeFile(
      join(root, ".codaryn", "lock.json.reclaim"),
      `${JSON.stringify({ pid: process.pid, runId: "busy-reclaimer", startedAt: "2026-11-12T00:00:00.000Z" })}\n`,
    );
    const started = Date.now();
    const outcome = await acquireLock({ workspaceRoot: root, runId: "run-w", clock, retryForMs: 150 });
    assert.ok(Date.now() - started >= 150, "it waited for the reclaimer");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok ? "" : outcome.code, "workspace_locked");
    assert.equal(await readFile(lockFile(root), "utf8"), before);
  });
});
