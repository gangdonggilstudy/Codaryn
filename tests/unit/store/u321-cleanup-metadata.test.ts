/** U-321: prepared metadata links must be refused before deletion or outside writes. Synthetic data only. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { acquireLock, applyCleanupWith, createJournal, journalRelativePath, planCleanup, releaseLock, writeResult } from "../../../src/store/index.js";
import type { EngineResult, JournalEvent } from "../../../src/contracts/index.js";

const RUN = "20260101T010000Z-00000321";
const NOW = "2026-03-01T00:00:00.000Z";
async function fixture(t: TestContext, withRun = true) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u321-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "work"), outside = join(base, "outside"), state = join(root, ".codaryn");
  await mkdir(root); await mkdir(outside);
  await writeFile(join(outside, "sentinel"), "SYNTHETIC ORIGINAL\n");
  if (withRun) {
    const journal = createJournal({ workspaceRoot: root, runId: RUN, clock: { now: () => Date.UTC(2026, 0, 1) } });
    await journal.append({ type: "run_started", schemaVersion: 1, taskId: "t", workflow: "document", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60000 } } as unknown as JournalEvent);
    const usage = { modelTurns: 1, toolCalls: 0, inputTokens: null, outputTokens: null, durationMs: 1 };
    await journal.append({ type: "run_finished", status: "done", reason: "verified", usage }); await journal.close();
    await writeResult(root, { schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted", verifiers: [], changes: [], usage, journalPath: journalRelativePath(RUN), notices: [] } as EngineResult);
  }
  const selection = { runs: { runIds: withRun ? [RUN] : [] } };
  const plan = await planCleanup({ workspaceRoot: root, selection, now: NOW });
  const request = { workspaceRoot: root, selection, now: NOW, confirmation: { digest: plan.digest, discarded: false, includeNotReverted: true } };
  return { base, root, outside, state, request, log: join(state, "cleanup.jsonl"), run: join(state, "runs", RUN) };
}
async function unchanged(f: Awaited<ReturnType<typeof fixture>>) {
  assert.equal(await readFile(join(f.outside, "sentinel"), "utf8"), "SYNTHETIC ORIGINAL\n");
  assert.deepEqual(await readdir(f.outside), ["sentinel"]);
}

test("U321: prepared state junction is refused before gitignore, lock or log writes", async (t) => {
  const f = await fixture(t, false);
  await symlink(f.outside, f.state, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(applyCleanupWith(f.request));
  await unchanged(f);
});
for (const kind of ["hardlink", "directory", "symlink"] as const) {
  test(`U321: prepared log ${kind} refuses before removing a selected record and releases the lock`, async (t) => {
    const f = await fixture(t);
    if (kind === "hardlink") await link(join(f.outside, "sentinel"), f.log);
    else if (kind === "directory") await mkdir(f.log);
    else {
      try { await symlink(join(f.outside, "sentinel"), f.log, "file"); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === "EPERM") { t.skip("file symlinks unavailable"); return; } throw e; }
    }
    await assert.rejects(applyCleanupWith(f.request));
    assert.ok(existsSync(f.run)); assert.equal(existsSync(join(f.state, "lock.json")), false);
    await unchanged(f);
  });
}
for (const existing of [false, true]) {
  test(`U321: normal cleanup, existing log ${existing}, preserves prior bytes and appends once`, async (t) => {
    const f = await fixture(t);
    if (existing) await writeFile(f.log, "PRIOR\n");
    const result = await applyCleanupWith(f.request);
    assert.ok(result.ok); assert.equal(result.removed.length, 1); assert.equal(result.lockLeft, undefined);
    assert.equal(existsSync(f.run), false);
    const lines = (await readFile(f.log, "utf8")).trimEnd().split("\n");
    assert.equal(lines.length, existing ? 2 : 1); if (existing) assert.equal(lines[0], "PRIOR");
    assert.equal(JSON.parse(lines.at(-1)!).runs.count, 1); await unchanged(f);
  });
}
test("U321: changed digest and held lock retain precedence over an unsafe log", async (t) => {
  const f = await fixture(t); await link(join(f.outside, "sentinel"), f.log);
  assert.deepEqual(await applyCleanupWith({ ...f.request, confirmation: { ...f.request.confirmation, digest: "0".repeat(64) } }), { ok: false, code: "plan_changed" });
  const lock = await acquireLock({ workspaceRoot: f.root, runId: "holder", clock: { now: () => Date.now() } }); assert.ok(lock.ok);
  try { assert.deepEqual(await applyCleanupWith(f.request), { ok: false, code: "workspace_locked" }); }
  finally { await releaseLock({ workspaceRoot: f.root, runId: "holder" }); }
  assert.ok(existsSync(f.run)); await unchanged(f);
});
test("U321: preview of absent state stays read only; confirmed empty cleanup works", async (t) => {
  const f = await fixture(t, false); assert.equal(existsSync(f.state), false);
  const result = await applyCleanupWith(f.request); assert.ok(result.ok); assert.equal(result.removed.length, 0);
  assert.equal(JSON.parse(await readFile(f.log, "utf8")).runs.count, 0);
});
test("U321: log relinked after deletion starts is not appended; completed removal stands", async (t) => {
  const f = await fixture(t); let changed = false;
  const result = await applyCleanupWith(f.request, { remove: async (dir) => {
    if (!changed) { changed = true; await rename(f.log, join(f.state, "old-log")); await link(join(f.outside, "sentinel"), f.log); }
    await rm(dir, { recursive: true, force: true });
  } });
  assert.ok(result.ok); assert.equal(result.removed.length, 1); await unchanged(f);
  assert.equal(await readFile(join(f.state, "old-log"), "utf8"), "");
});

for (const boundary of ["before-open", "after-open", "parent-after-open"] as const) {
  test(`U321: metadata replacement ${boundary} refuses before deletion and closes its handle`, async (t) => {
    const f = await fixture(t); await writeFile(f.log, "PRIOR\n");
    const promises: typeof import("node:fs/promises") = createRequire(import.meta.url)("node:fs/promises");
    const original = promises.open; let closed = false, injected = false, parentMoveRefused = false;
    promises.open = async (file, flags, mode) => {
      if (String(file) !== f.log || injected) return original(file, flags, mode);
      injected = true;
      if (boundary === "before-open") { await rename(f.log, join(f.state, "old-log")); await link(join(f.outside, "sentinel"), f.log); }
      const handle = await original(file, flags, mode);
      const close = handle.close.bind(handle);
      handle.close = async () => { closed = true; return close(); };
      if (boundary === "after-open") { await rename(f.log, join(f.state, "old-log")); await link(join(f.outside, "sentinel"), f.log); }
      if (boundary === "parent-after-open") {
        try { await rename(f.state, join(f.root, "aside")); }
        catch (error) {
          await handle.close();
          if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          parentMoveRefused = true;
          return handle;
        }
        await symlink(f.outside, f.state, process.platform === "win32" ? "junction" : "dir");
      }
      return handle;
    };
    syncBuiltinESMExports();
    try { await assert.rejects(applyCleanupWith(f.request)); }
    finally { promises.open = original; syncBuiltinESMExports(); }
    assert.ok(injected); assert.ok(closed); await unchanged(f);
    if (parentMoveRefused) { t.skip("Windows refused renaming the parent while the log handle was open"); return; }
    if (boundary === "parent-after-open") {
      assert.ok(existsSync(join(f.root, "aside", "runs", RUN)));
      // The lock belongs to the renamed state. Never delete an unrelated outside lock by name.
      await rm(f.state); await rename(join(f.root, "aside"), f.state);
      const lock = JSON.parse(await readFile(join(f.state, "lock.json"), "utf8")) as { runId: string };
      await releaseLock({ workspaceRoot: f.root, runId: lock.runId });
    } else { assert.ok(existsSync(f.run)); assert.equal(existsSync(join(f.state, "lock.json")), false); }
  });
}

test("U321: a close error after closing the log does not replace removal or prevent lock release", async (t) => {
  const f = await fixture(t);
  const promises: typeof import("node:fs/promises") = createRequire(import.meta.url)("node:fs/promises");
  const original = promises.open; let closed = false;
  promises.open = async (file, flags, mode) => {
    const handle = await original(file, flags, mode);
    if (String(file) === f.log) {
      const close = handle.close.bind(handle);
      handle.close = async () => { await close(); closed = true; throw new Error("synthetic close error"); };
    }
    return handle;
  };
  syncBuiltinESMExports();
  try {
    const result = await applyCleanupWith(f.request);
    assert.ok(result.ok); assert.equal(result.removed.length, 1); assert.equal(result.lockLeft, undefined);
  } finally { promises.open = original; syncBuiltinESMExports(); }
  assert.ok(closed); assert.equal(existsSync(join(f.state, "lock.json")), false); await unchanged(f);
});
