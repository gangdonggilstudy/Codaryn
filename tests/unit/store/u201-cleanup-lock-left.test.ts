/**
 * U-201 (U-176's hand-off; contract U-193, CleanupOutcome.lockLeft): a cleanup that finished but could
 * not release the workspace lock says so. The release threw after its retries, or answered false (the
 * lock was not the cleanup's any more): `lockLeft: true`, and the outcome's status, lists and totals are
 * as without it. A lock released as always: no `lockLeft` at all, so every existing outcome is as before.
 * The release's failure is injected only into removing the lock file (`rm`, as Codex's V-4 did); the
 * real handle case is the app layer's U-193 test. Fake values only.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, test } from "node:test";

import type { EngineResult, JournalEvent } from "../../../src/contracts/index.js";
import { applyCleanupWith, createJournal, journalRelativePath, planCleanup, releaseLock, writeResult } from "../../../src/store/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const RUN = "20260101T010000Z-0000000a";
const NOW = "2026-03-01T00:00:00.000Z";
const STARTED = { type: "run_started", schemaVersion: 1, taskId: "t", workflow: "document", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 } } as unknown as JournalEvent;
const usage = { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 9 };
const lockFile = (root: string): string => join(root, ".codaryn", "lock.json");

/** A workspace with one finished run that changed nothing, and the cleanup's confirmed plan for it. */
async function workspace(): Promise<{ root: string; digest: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u201-")));
  roots.push(root);
  const journal = createJournal({ workspaceRoot: root, runId: RUN, clock: { now: () => Date.UTC(2026, 0, 1, 1, 0, 1) } });
  await journal.append(STARTED);
  await journal.append({ type: "run_finished", status: "done", reason: "verified", usage });
  await journal.close();
  await writeResult(root, {
    schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted", verifiers: [], changes: [],
    usage, journalPath: journalRelativePath(RUN), notices: [],
  } as unknown as EngineResult);
  const shown = await planCleanup({ workspaceRoot: root, selection: { runs: { runIds: [RUN] } }, now: NOW });
  return { root, digest: shown.digest };
}
const apply = (root: string, digest: string, operations: Parameters<typeof applyCleanupWith>[1] = {}) =>
  applyCleanupWith({ workspaceRoot: root, selection: { runs: { runIds: [RUN] } }, now: NOW, confirmation: { digest, discarded: false, includeNotReverted: true } }, operations);

const require = createRequire(import.meta.url);
const promises: { rm: typeof import("node:fs/promises").rm } = require("node:fs/promises");

/** Runs `run` while removing `file` fails with EBUSY; other removals are real. */
async function whileLockRemovalFails<T>(file: string, run: () => Promise<T>): Promise<T> {
  const original = promises.rm;
  promises.rm = async (path, options) => {
    if (resolve(String(path)).toLowerCase() === file.toLowerCase()) throw Object.assign(new Error("U-201 injected EBUSY"), { code: "EBUSY" });
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

describe("U-201: applyCleanup fills CleanupOutcome.lockLeft", () => {
  test("a release that throws after its retries: lockLeft, and the cleanup is as it was", async () => {
    const { root, digest } = await workspace();
    const outcome = await whileLockRemovalFails(lockFile(root), () => apply(root, digest));
    assert.ok(outcome.ok, JSON.stringify(outcome));
    assert.equal(outcome.lockLeft, true);
    assert.deepEqual(outcome.removed.map((item) => (item.target === "run" ? item.runId : null)), [RUN]);
    assert.deepEqual(outcome.kept, []);
    // The lock is left with the cleanup's own id; U-176: the same id's later release still removes it.
    const left = JSON.parse(readFileSync(lockFile(root), "utf8")) as { runId: string };
    assert.match(left.runId, /^cleanup-[0-9a-f]{8}$/);
    assert.equal(await releaseLock({ workspaceRoot: root, runId: left.runId }), true);
  });

  test("a release that answers false (the lock is not the cleanup's any more): lockLeft", async () => {
    const { root, digest } = await workspace();
    let removedLock = false;
    const outcome = await apply(root, digest, {
      remove: async (dir) => {
        await rm(dir, { recursive: true, force: true });
        if (!removedLock) {
          removedLock = true;
          await rm(lockFile(root));
        }
      },
    });
    assert.ok(outcome.ok, JSON.stringify(outcome));
    assert.equal(outcome.lockLeft, true);
  });

  test("a lock released as always: no lockLeft key, the lock is gone", async () => {
    const { root, digest } = await workspace();
    const outcome = await apply(root, digest);
    assert.ok(outcome.ok, JSON.stringify(outcome));
    assert.equal(Object.hasOwn(outcome, "lockLeft"), false);
    assert.deepEqual(Object.keys(outcome), ["ok", "removed", "kept", "totals"]);
    assert.equal(existsSync(lockFile(root)), false);
  });

  test("a plan that changed: as before, plan_changed with no lockLeft, and the lock released", async () => {
    const { root } = await workspace();
    const outcome = await apply(root, "0".repeat(64));
    assert.deepEqual(outcome, { ok: false, code: "plan_changed" });
    assert.equal(existsSync(lockFile(root)), false);
  });
});
