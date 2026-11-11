/**
 * T-9: reclaiming a dead lock is atomic. Several runs that reclaim the same dead lock at the same
 * time end with exactly one holder, and lock.json names that holder. EPERM and EBUSY end as
 * workspace_locked, not as an exception. Review input: store-revert 1 (exp-lock.mjs).
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { acquireLock } from "../../../src/store/index.js";

const clock = { now: () => Date.UTC(2026, 10, 12, 6, 0, 0) };

function exitedPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(child.status, 0);
  return child.pid;
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "codaryn-lock-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const lockFile = (root: string): string => join(root, ".codaryn", "lock.json");

async function leaveDeadLock(root: string, pid: number): Promise<void> {
  await mkdir(join(root, ".codaryn"), { recursive: true });
  await writeFile(lockFile(root), `${JSON.stringify({ pid, runId: "crashed-run", startedAt: "2026-11-11T00:00:00.000Z" })}\n`);
}

test("T-9: contenders reclaiming one dead lock in the same process end with exactly one holder", async () => {
  const dead = exitedPid();
  for (let round = 0; round < 40; round += 1) {
    await withRoot(async (root) => {
      await leaveDeadLock(root, dead);
      const ids = ["run-a", "run-b", "run-c"];
      const outcomes = await Promise.all(ids.map((runId) => acquireLock({ workspaceRoot: root, runId, clock })));
      const winners = ids.filter((_, index) => outcomes[index]?.ok === true);
      assert.equal(winners.length, 1, `round ${round}: winners ${JSON.stringify(winners)}`);
      const holder = JSON.parse(await readFile(lockFile(root), "utf8")) as { runId: string; pid: number };
      assert.equal(holder.runId, winners[0], `round ${round}: lock.json must name the winner`);
      for (const [index, outcome] of outcomes.entries()) {
        if (outcome.ok) continue;
        assert.equal(outcome.code, "workspace_locked", `round ${round}: ${ids[index]}`);
      }
      assert.deepEqual((await readdir(join(root, ".codaryn"))).sort(), [".gitignore", "lock.json"], "no leftovers");
    });
  }
});

test("T-9: separate processes reclaiming one dead lock at the same moment end with one holder", async () => {
  const storeUrl = new URL("../../../src/store/index.js", import.meta.url).href;
  const dead = exitedPid();
  for (let round = 0; round < 6; round += 1) {
    await withRoot(async (root) => {
      await leaveDeadLock(root, dead);
      const startAt = Date.now() + 400;
      // Every contender stays alive until all have finished, so a winner's lock is never dead
      // while the others are still trying (a lock of an exited process may be reclaimed).
      const script = [
        `const { acquireLock } = await import(${JSON.stringify(storeUrl)});`,
        `while (Date.now() < ${startAt}) {}`,
        `const outcome = await acquireLock({ workspaceRoot: ${JSON.stringify(root)}, runId: process.argv[1], clock: { now: () => 0 } });`,
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
