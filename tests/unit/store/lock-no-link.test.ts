/**
 * DR-27 (b), review R-9b N-2: on a volume without hard links the workspace lock is taken by an
 * exclusive create instead, so a run, plan or apply can start there (and reach DR-21's consent
 * step). The rules stay: one holder, a live lock is never taken, a dead one is reclaimed by exactly
 * one contender, and a lock file still being written (no final newline) is never reclaimed.
 * Hard links are made to fail by injection: this host has NTFS only.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { acquireLock, nodeLockFileSystem } from "../../../src/store/index.js";
import type { LockFileSystem } from "../../../src/store/index.js";
import { moveWithoutReplacing } from "../../../src/store/apply-revert.js";
import { createExclusive } from "../../../src/store/common.js";

const clock = { now: () => Date.UTC(2026, 10, 12, 6, 0, 0) };
const CRASHED_PID = 4_000_001;
const crashedIsDead = (pid: number): boolean => pid !== CRASHED_PID;

/**
 * Codes a volume without hard links gives for link(): EPERM (POSIX, and the review's injection),
 * ENOTSUP, and EISDIR, which libuv makes of Windows' ERROR_INVALID_FUNCTION (FAT32, exFAT) [assumed].
 */
const NO_LINK_CODES = ["EPERM", "ENOTSUP", "EISDIR"];

function noLinks(code: string, base: LockFileSystem = nodeLockFileSystem): LockFileSystem {
  return {
    ...base,
    link: async () => {
      throw Object.assign(new Error(`${code}: no hard links (injected)`), { code });
    },
  };
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "codaryn-lock-nolink-"));
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

for (const code of NO_LINK_CODES) {
  test(`review reproduction: without hard links (${code}) a free lock is taken by an exclusive create`, async () => {
    await withRoot(async (root) => {
      const outcome = await acquireLock({ workspaceRoot: root, runId: "run-x", clock, fileSystem: noLinks(code), retryForMs: 150 });
      assert.equal(outcome.ok, true, JSON.stringify(outcome));
      const held = JSON.parse(await readFile(lockFile(root), "utf8")) as { runId: string; pid: number };
      assert.deepEqual([held.runId, held.pid], ["run-x", process.pid]);
      assert.deepEqual((await readdir(join(root, ".codaryn"))).sort(), [".gitignore", "lock.json"], "no leftovers");
      // A live lock is not taken by a second run on the same volume.
      const second = await acquireLock({ workspaceRoot: root, runId: "run-y", clock, fileSystem: noLinks(code), retryForMs: 150 });
      assert.equal(second.ok, false);
      assert.equal(second.ok ? null : second.holder?.runId, "run-x");
    });
  });
}

test("without hard links, EPERM from the exclusive create too (a lock being deleted) is retried and ends as workspace_locked", async () => {
  await withRoot(async (root) => {
    const fileSystem: LockFileSystem = {
      ...noLinks("EPERM"),
      writeNew: async (path, text) => {
        if (path.endsWith("lock.json")) throw Object.assign(new Error("EPERM: injected"), { code: "EPERM" });
        return nodeLockFileSystem.writeNew(path, text);
      },
    };
    const outcome = await acquireLock({ workspaceRoot: root, runId: "run-x", clock, fileSystem, retryForMs: 150 });
    assert.deepEqual(outcome, { ok: false, code: "workspace_locked", holder: null });
    assert.deepEqual(await readdir(join(root, ".codaryn")), [".gitignore"], "no lock and no leftovers");
  });
});

test("without hard links, contenders reclaiming one dead lock in the same process end with exactly one holder", async () => {
  for (const code of NO_LINK_CODES) {
    for (let round = 0; round < 30; round += 1) {
      await withRoot(async (root) => {
        await leaveDeadLock(root);
        const ids = ["run-a", "run-b", "run-c"];
        const outcomes = await Promise.all(
          ids.map((runId) => acquireLock({ workspaceRoot: root, runId, clock, fileSystem: noLinks(code), isProcessAlive: crashedIsDead })),
        );
        const winners = ids.filter((_, index) => outcomes[index]?.ok === true);
        assert.equal(winners.length, 1, `${code} round ${round}: winners ${JSON.stringify(winners)}`);
        const holder = JSON.parse(await readFile(lockFile(root), "utf8")) as { runId: string };
        assert.equal(holder.runId, winners[0], `${code} round ${round}: lock.json must name the winner`);
        for (const outcome of outcomes) if (!outcome.ok) assert.equal(outcome.code, "workspace_locked");
        assert.deepEqual((await readdir(join(root, ".codaryn"))).sort(), [".gitignore", "lock.json"], "no leftovers");
      });
    }
  }
});

test("without hard links, separate processes reclaiming one dead lock at the same moment end with one holder", async () => {
  const storeUrl = new URL("../../../src/store/index.js", import.meta.url).href;
  for (let round = 0; round < 6; round += 1) {
    await withRoot(async (root) => {
      await leaveDeadLock(root);
      const startAt = Date.now() + 400;
      const script = [
        `const { acquireLock, nodeLockFileSystem } = await import(${JSON.stringify(storeUrl)});`,
        `const fileSystem = { ...nodeLockFileSystem, link: async () => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); } };`,
        `while (Date.now() < ${startAt}) {}`,
        `const outcome = await acquireLock({ workspaceRoot: ${JSON.stringify(root)}, runId: process.argv[1], clock: { now: () => 0 }, fileSystem, isProcessAlive: (pid) => pid !== ${CRASHED_PID} });`,
        "process.stdout.write(JSON.stringify({ ok: outcome.ok, code: outcome.code ?? null }));",
        `await new Promise((resolve) => setTimeout(resolve, Math.max(0, ${startAt + 900} - Date.now())));`,
      ].join("\n");
      const ids = ["proc-a", "proc-b", "proc-c"];
      const results = await Promise.all(
        ids.map(
          (runId) =>
            new Promise<{ ok: boolean; code: string | null }>((resolve, reject) => {
              const child = spawn(process.execPath, ["--input-type=module", "-e", script, runId], { stdio: ["ignore", "pipe", "pipe"] });
              let out = "";
              let err = "";
              child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
              child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
              child.on("error", reject);
              child.on("close", () => {
                try {
                  resolve(JSON.parse(out) as { ok: boolean; code: string | null });
                } catch {
                  reject(new Error(`child ${runId} printed no outcome: ${err.slice(0, 300)}`));
                }
              });
            }),
        ),
      );
      const winners = ids.filter((_, index) => results[index]?.ok === true);
      assert.equal(winners.length, 1, `round ${round}: ${JSON.stringify(results)}`);
      assert.ok(results.every((result) => result.ok || result.code === "workspace_locked"), JSON.stringify(results));
      const holder = JSON.parse(await readFile(lockFile(root), "utf8")) as { runId: string };
      assert.equal(holder.runId, winners[0]);
    });
  }
});

test("a reclaim file still being written (created, no final newline yet) is not cleared: the dead lock waits", async () => {
  await withRoot(async (root) => {
    const before = await leaveDeadLock(root);
    for (const [fileSystem, partial] of [nodeLockFileSystem, noLinks("EPERM")].flatMap((one) => ["", '{"pid":4000005,"runId":"rec'].map((text) => [one, text] as const))) {
      await writeFile(join(root, ".codaryn", "lock.json.reclaim"), partial);
      const outcome = await acquireLock({ workspaceRoot: root, runId: "run-w", clock, fileSystem, retryForMs: 120, isProcessAlive: crashedIsDead });
      assert.equal(outcome.ok, false, JSON.stringify(partial));
      assert.equal(await readFile(lockFile(root), "utf8"), before, "the dead lock was not reclaimed under a reclaim being written");
      assert.equal(await readFile(join(root, ".codaryn", "lock.json.reclaim"), "utf8"), partial, "the reclaim file is left to its writer");
    }
  });
});

test("a lock file still being written is never reclaimed; the attempt waits and ends as workspace_locked", async () => {
  await withRoot(async (root) => {
    await mkdir(join(root, ".codaryn"), { recursive: true });
    for (const partial of ["", `{"pid":${CRASHED_PID},"runId":"crashed-run","startedAt":"2026-11-11T00:0`]) {
      await writeFile(lockFile(root), partial);
      const outcome = await acquireLock({ workspaceRoot: root, runId: "run-w", clock, retryForMs: 120, isProcessAlive: crashedIsDead });
      assert.deepEqual(outcome, { ok: false, code: "workspace_locked", holder: null }, JSON.stringify(partial));
      assert.equal(await readFile(lockFile(root), "utf8"), partial);
    }
  });
});

test("a complete lock written without a final newline (by hand, other tools, the integration tests) is still judged: a dead one is reclaimed", async () => {
  // A cut-off JSON object never parses, so text that parses is complete even without the newline.
  for (const fileSystem of [nodeLockFileSystem, noLinks("EPERM")]) {
    await withRoot(async (root) => {
      await mkdir(join(root, ".codaryn"), { recursive: true });
      await writeFile(lockFile(root), JSON.stringify({ pid: CRASHED_PID, runId: "crashed-run", startedAt: "2026-11-11T00:00:00.000Z" }));
      const outcome = await acquireLock({ workspaceRoot: root, runId: "run-n", clock, fileSystem, isProcessAlive: crashedIsDead });
      assert.equal(outcome.ok, true, JSON.stringify(outcome));
      assert.equal((JSON.parse(await readFile(lockFile(root), "utf8")) as { runId: string }).runId, "run-n");
    });
  }
});

test("one rule for 'no hard links': createExclusive and a revert's move know EISDIR too", async () => {
  await withRoot(async (root) => {
    const failLink = { link: async () => Promise.reject(Object.assign(new Error("EISDIR"), { code: "EISDIR" })) };
    assert.equal(await createExclusive(join(root, "a.json"), "{}\n", failLink), true);
    assert.equal(await createExclusive(join(root, "a.json"), "{}\n", failLink), false, "still exclusive");
    await writeFile(join(root, "from.txt"), "x\n");
    assert.equal(await moveWithoutReplacing(join(root, "from.txt"), join(root, "to.txt"), failLink), "unsafe");
  });
});
