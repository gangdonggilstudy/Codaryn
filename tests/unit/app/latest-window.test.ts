/** U-22: the real first append is held after an empty journal and live lock already exist. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import { resolveRunReference, STORE_RUN_REFERENCE_DEPS } from "../../../src/app/input/run-ref.js";
import { inspectLock, listRuns } from "../../../src/store/index.js";
import type { AppCallOutcome } from "../../../src/app/index.js";
import { appEnvironment, runDir, setupRun, taskForm, taskRequest } from "./support.js";

async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("first run_started append was not reached within 10 seconds")), 10000); })]); }
  finally { clearTimeout(timer); }
}
async function fixture(older: boolean | "same-second") {
  const base = await setupRun({ "NOTES.md": "# Notes\n" }, {}, [{ text: "done" }]);
  let time = older === "same-second" ? Math.floor((Date.now() - 60000) / 1000) * 1000 + 100 : Date.now() - 60000;
  let idByte = 0xee;
  const env = await appEnvironment(base, { clock: { now: () => time }, ...(older === "same-second" ? { randomBytes: (size: number) => new Uint8Array(size).fill(idByte) } : {}) }), app = createCodarynApp(env);
  let previous: string | null = null;
  if (older) {
    const run = await app.startRun(taskRequest(base)); assert.ok(run.ok); previous = run.handle.runId;
    const end = await run.handle.done; assert.ok(end.ok && end.result.status === "done"); time += older === "same-second" ? 100 : 1000; idByte = 0x11;
  }
  const damaged = new Date(time + 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z") + "-eeeeeeee";
  return { base, app, workspace: path.join(base, "work"), previous, damaged };
}

/** Only the first real run_started write waits. Directory creation, open, lock and all reads are real. */
function gate(t: TestContext, workspace: string) {
  const entered = Promise.withResolvers<{ runId: string; file: string }>(), release = Promise.withResolvers<void>();
  const open = fs.open; let held = false;
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args), file = String(args[0]);
    if (args[1] !== "a" || !file.startsWith(path.join(workspace, ".codaryn", "runs") + path.sep) || path.basename(file) !== "journal.jsonl") return handle;
    const append = handle.appendFile.bind(handle);
    t.mock.method(handle, "appendFile", async (...values: Parameters<FileHandle["appendFile"]>) => {
      const line = typeof values[0] === "string" ? JSON.parse(values[0]) as { type?: string; runId?: string } : null;
      if (!held && line?.type === "run_started" && typeof line.runId === "string") {
        held = true; entered.resolve({ runId: line.runId, file }); await release.promise;
      }
      return append(...values);
    });
    return handle;
  });
  syncBuiltinESMExports();
  t.after(() => { release.resolve(); t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { entered: entered.promise, release: () => release.resolve() };
}

for (const older of [false, true, "same-second"] as const) for (const route of ["report", "changes", "resolveRun"] as const) {
  test(`latest window ${route}, older=${older}: a gated empty journal with its live lock is run_in_progress`, async t => {
    const f = await fixture(older), first = gate(t, f.workspace), starting = f.app.startRun(taskRequest(f.base));
    let id: string | null = null;
    try {
      const entered = await within(first.entered); id = entered.runId;
      assert.equal((await fs.readFile(entered.file)).length, 0);
      const listing = await listRuns({ workspaceRoot: f.workspace });
      const pending = listing.runs.find(run => run.runId === id);
      assert.deepEqual(pending, { state: "damaged", runId: id });
      if (older === "same-second") { assert.ok(f.previous); assert.equal(id.slice(0, 16), f.previous.slice(0, 16)); assert.ok(id < f.previous, "newer must not depend on the random run-id suffix"); }
      const lock = await inspectLock(f.workspace); assert.equal(lock.state, "held"); if (lock.state === "held") assert.equal(lock.holder.runId, id);
      const outcome: AppCallOutcome<unknown> = route === "report" ? await f.app.report({ workspace: f.workspace, runId: "latest" })
        : route === "changes" ? await f.app.changes({ settings: taskForm(f.base), runId: "latest" })
        : await f.app.resolveRun({ workspace: f.workspace, run: "latest" });
      t.diagnostic(JSON.stringify({ route, older, runId: id, pendingState: pending.state, firstListed: listing.runs[0]?.runId, outcome }));
      assert.equal(outcome.ok ? null : outcome.error.code, "run_in_progress");
    } finally {
      first.release(); const started = await starting;
      if (started.ok) await started.handle.done;
    }
    const ended = await f.app.resolveRun({ workspace: f.workspace, run: "latest" });
    assert.ok(ended.ok); assert.equal(ended.output.runId, id); assert.equal(ended.output.damaged, false);
  });
}

for (const older of [false, true]) for (const state of ["missing-lock", "other-run", "stale-probe", "probe-error"] as const) {
  test(`latest window control ${state}, older=${older}: a damaged run without its own live lock stays skipped`, async () => {
    const f = await fixture(older), dir = runDir(f.base, f.damaged); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, "journal.jsonl"), "");
    if (state === "other-run") await fs.writeFile(path.join(f.workspace, ".codaryn", "lock.json"), JSON.stringify({ pid: process.pid, runId: f.damaged.replace("eeeeeeee", "dddddddd"), startedAt: new Date().toISOString() }) + "\n");
    // Staleness and unreadability are existing lock-probe outcomes; no unrelated PID is inspected.
    const deps = { ...STORE_RUN_REFERENCE_DEPS, ...(state === "stale-probe" ? { runInProgress: async () => false } : state === "probe-error" ? { runInProgress: async () => { throw new Error("synthetic lock probe failure"); } } : {}) };
    const result = await resolveRunReference(f.workspace, "latest", deps);
    if (f.previous === null) assert.equal(result.ok ? null : result.code, "run_not_found");
    else { assert.ok(result.ok); assert.equal(result.runId, f.previous); }
    assert.equal((await listRuns({ workspaceRoot: f.workspace })).runs.find(run => run.runId === f.damaged)?.state, "damaged");
  });
}

test("latest window control: an older damaged run cannot block a newer completed run", async () => {
  const f = await fixture(true), old = "20000101T000000Z-eeeeeeee";
  const dir = runDir(f.base, old); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, "journal.jsonl"), "");
  let probes = 0;
  const result = await resolveRunReference(f.workspace, "latest", { ...STORE_RUN_REFERENCE_DEPS, runInProgress: async () => { probes++; return true; } });
  assert.ok(result.ok); assert.equal(result.runId, f.previous); assert.equal(probes, 0);
});

test("latest window control: an explicit damaged id remains explicit and never asks the live-lock probe", async () => {
  const f = await fixture(false); let probes = 0;
  const dir = runDir(f.base, f.damaged); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, "journal.jsonl"), "");
  const result = await resolveRunReference(f.workspace, f.damaged, { ...STORE_RUN_REFERENCE_DEPS, runInProgress: async () => { probes++; return true; } });
  assert.deepEqual(result, { ok: true, runId: f.damaged, latest: null }); assert.equal(probes, 0);
});

test("latest window control: an older live lock in the same second cannot hide a completed run", async () => {
  const f = await fixture("same-second"), listed = await listRuns({ workspaceRoot: f.workspace });
  const latest = listed.runs.find(run => run.runId === f.previous); assert.ok(latest?.state === "checked");
  const id = latest.runId.slice(0, 16) + "-01010101", dir = runDir(f.base, id);
  await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, "journal.jsonl"), "");
  await fs.writeFile(path.join(f.workspace, ".codaryn", "lock.json"), JSON.stringify({ pid: process.pid, runId: id, startedAt: new Date(Date.parse(latest.startedAt) - 1).toISOString() }) + "\n");
  const lock = await inspectLock(f.workspace); assert.equal(lock.state, "held");
  const result = await resolveRunReference(f.workspace, "latest", STORE_RUN_REFERENCE_DEPS);
  assert.ok(result.ok); assert.equal(result.runId, f.previous);
});
