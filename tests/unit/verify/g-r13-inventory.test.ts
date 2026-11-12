/**
 * Review R-13 (G-D, 2026-11-12) L-3, reproduced first: the inventory listing measures entries a
 * bounded number at a time, lists exactly what a one-by-one listing lists (the limit included), and
 * stops when its signal is aborted.
 */

import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { INVENTORY_LSTAT_CONCURRENCY, buildInventoryChecker, nodeInventoryFileSystem } from "../../../src/verify/inventory.js";
import type { InventoryFileSystem } from "../../../src/verify/inventory.js";

let listRoot = "";
const LISTED = 200;

before(async () => {
  listRoot = await mkdtemp(join(tmpdir(), "codaryn-r13-list-"));
  for (let i = 0; i < LISTED; i += 1) await writeFile(join(listRoot, `f${String(i).padStart(4, "0")}.txt`), "x".repeat(i % 7));
});

after(async () => {
  await rm(listRoot, { recursive: true, force: true });
});

/** The node file system with lstat counted and slowed a little, so overlapping calls show. */
function counting(onCall?: (calls: number) => void): { files: InventoryFileSystem; stats: { calls: number; inFlight: number; most: number } } {
  const stats = { calls: 0, inFlight: 0, most: 0 };
  const files: InventoryFileSystem = {
    ...nodeInventoryFileSystem,
    async lstat(target) {
      stats.calls += 1;
      onCall?.(stats.calls);
      stats.inFlight += 1;
      stats.most = Math.max(stats.most, stats.inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return await nodeInventoryFileSystem.lstat(target);
      } finally {
        stats.inFlight -= 1;
      }
    },
  };
  return { files, stats };
}

test("R-13 L-3: entries are measured a bounded number at a time and listed as one by one", async () => {
  const { files, stats } = counting();
  const manifest = await buildInventoryChecker({ workspaceRoot: listRoot }, { maxFiles: 1000 }, files).capture();
  assert.equal(manifest.limitReached, false);
  assert.equal(manifest.entries.length, LISTED);
  assert.ok(stats.most > 1, `lstat calls overlapped (most at once: ${stats.most})`);
  assert.ok(stats.most <= INVENTORY_LSTAT_CONCURRENCY, `at most ${INVENTORY_LSTAT_CONCURRENCY} at once (${stats.most})`);
  const names = await readdir(listRoot);
  assert.deepEqual(
    manifest.entries.map((entry) => `${entry.path}:${entry.kind}:${entry.kind === "unchecked" ? "" : entry.size}`),
    [...names].sort().map((name) => `${name}:file:${Number(name.slice(1, 5)) % 7}`),
  );
  // At the limit the entries are the first ones in listing order, as one-by-one listing gives.
  const limited = await buildInventoryChecker({ workspaceRoot: listRoot }, { maxFiles: 50 }, counting().files).capture();
  assert.equal(limited.limitReached, true);
  assert.deepEqual(limited.entries.map((entry) => entry.path), names.slice(0, 50).sort());
});

test("R-13 L-3: an aborted signal stops the listing", async () => {
  const before = new AbortController();
  before.abort();
  const unused = counting();
  await assert.rejects(buildInventoryChecker({ workspaceRoot: listRoot, signal: before.signal }, { maxFiles: 1000 }, unused.files).capture(), { name: "AbortError" });
  assert.equal(unused.stats.calls, 0, "nothing was measured");

  const during = new AbortController();
  const { files, stats } = counting((calls) => {
    if (calls === 10) during.abort();
  });
  await assert.rejects(buildInventoryChecker({ workspaceRoot: listRoot, signal: during.signal }, { maxFiles: 1000 }, files).capture(), { name: "AbortError" });
  assert.ok(stats.calls < LISTED, `the listing stopped early (${stats.calls} of ${LISTED} measured)`);
});
