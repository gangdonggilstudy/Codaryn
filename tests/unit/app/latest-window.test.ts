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
import { inspectLock, listRuns, nodeLockFileSystem } from "../../../src/store/index.js";
import { nodeFileLayer } from "../../../src/workspace/file-layer.js";
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

test("latest window control: the injected live holder wins even with an older damaged id", async () => {
  const f = await fixture(true), old = "20000101T000000Z-eeeeeeee";
  const dir = runDir(f.base, old); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, "journal.jsonl"), "");
  let probes = 0;
  const result = await resolveRunReference(f.workspace, "latest", { ...STORE_RUN_REFERENCE_DEPS, runInProgress: async () => { probes++; return true; } });
  assert.equal(result.ok ? null : result.code, "run_in_progress"); assert.equal(probes, 1);
});

test("latest window control: an explicit damaged id remains explicit and never asks the live-lock probe", async () => {
  const f = await fixture(false); let probes = 0;
  const dir = runDir(f.base, f.damaged); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, "journal.jsonl"), "");
  const result = await resolveRunReference(f.workspace, f.damaged, { ...STORE_RUN_REFERENCE_DEPS, runInProgress: async () => { probes++; return true; } });
  assert.deepEqual(result, { ok: true, runId: f.damaged, latest: null }); assert.equal(probes, 0);
});

test("latest window control: a live damaged holder wins even with an earlier lock time", async () => {
  const f = await fixture("same-second"), listed = await listRuns({ workspaceRoot: f.workspace });
  const latest = listed.runs.find(run => run.runId === f.previous); assert.ok(latest?.state === "checked");
  const id = latest.runId.slice(0, 16) + "-01010101", dir = runDir(f.base, id);
  await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, "journal.jsonl"), "");
  await fs.writeFile(path.join(f.workspace, ".codaryn", "lock.json"), JSON.stringify({ pid: process.pid, runId: id, startedAt: new Date(Date.parse(latest.startedAt) - 1).toISOString() }) + "\n");
  const lock = await inspectLock(f.workspace); assert.equal(lock.state, "held");
  const result = await resolveRunReference(f.workspace, "latest", STORE_RUN_REFERENCE_DEPS);
  assert.equal(result.ok ? null : result.code, "run_in_progress");
});

const routes = ["report", "changes", "resolveRun"] as const;
type Route = typeof routes[number];
async function latestVia(f: { app: ReturnType<typeof createCodarynApp>; base: string; workspace: string }, route: Route): Promise<AppCallOutcome<unknown>> {
  return route === "report" ? f.app.report({ workspace: f.workspace, runId: "latest" })
    : route === "changes" ? f.app.changes({ settings: taskForm(f.base), runId: "latest" })
    : f.app.resolveRun({ workspace: f.workspace, run: "latest" });
}

for (const route of routes) test(`LW-1 ${route}: id allocation before another run does not order the later live lock`, async t => {
  const base = await setupRun({ "NOTES.md": "# Notes\n" }, {}, [{ text: "done" }]);
  const workspace = path.join(base, "work"), time0 = Date.now() - 60_000;
  let time = time0, allocated = false, paused = false;
  const waiting = Promise.withResolvers<void>(), allowAssembly = Promise.withResolvers<void>();
  const realpath = nodeFileLayer.realpath;
  t.mock.method(nodeFileLayer, "realpath", async (root: string) => {
    if (allocated && !paused && path.resolve(root) === path.resolve(workspace)) {
      paused = true; waiting.resolve(); await allowAssembly.promise;
    }
    return realpath(root);
  });
  const delayed = createCodarynApp(await appEnvironment(base, {
    clock: { now: () => time }, randomBytes: size => { allocated = true; return new Uint8Array(size).fill(0x11); },
  }));
  const starting = delayed.startRun(taskRequest(base));
  let first: ReturnType<typeof gate> | null = null, delayedId: string | null = null;
  try {
    await within(waiting.promise);
    assert.equal((await inspectLock(workspace)).state, "none", "the allocated id has not taken the lock");
    time += 1000;
    const other = createCodarynApp(await appEnvironment(base, { clock: { now: () => time } }));
    const completed = await other.startRun(taskRequest(base)); assert.ok(completed.ok);
    const end = await completed.handle.done; assert.ok(end.ok && end.result.status === "done");
    time += 1000;
    first = gate(t, workspace); allowAssembly.resolve();
    const entered = await within(first.entered); delayedId = entered.runId;
    assert.ok(delayedId.slice(0, 16) < completed.handle.runId.slice(0, 16));
    const lock = await inspectLock(workspace); assert.equal(lock.state, "held");
    if (lock.state === "held") { assert.equal(lock.holder.runId, delayedId); assert.equal(Date.parse(lock.holder.startedAt), time); }
    assert.deepEqual((await listRuns({ workspaceRoot: workspace })).runs.find(run => run.runId === delayedId), { state: "damaged", runId: delayedId });
    const outcome = await latestVia({ app: delayed, base, workspace }, route);
    assert.equal(outcome.ok ? null : outcome.error.code, "run_in_progress");
  } finally {
    allowAssembly.resolve(); first?.release();
    const started = await starting; if (started.ok) await started.handle.done;
  }
  const result = await delayed.resolveRun({ workspace, run: "latest" });
  assert.ok(result.ok); assert.equal(result.output.runId, delayedId);
});

for (const route of routes) test(`LW-2 ${route}: a real held lock with invalid startedAt still means in progress`, async () => {
  const f = await fixture(true), dir = runDir(f.base, f.damaged);
  await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, "journal.jsonl"), "");
  await fs.writeFile(path.join(f.workspace, ".codaryn", "lock.json"), JSON.stringify({
    pid: process.pid, runId: f.damaged, startedAt: "bad", processStartedAt: new Date(performance.timeOrigin).toISOString(),
  }) + "\n");
  const held = await inspectLock(f.workspace); assert.equal(held.state, "held");
  const outcome = await latestVia(f, route);
  assert.equal(outcome.ok ? null : outcome.error.code, "run_in_progress");
});

for (const older of [false, true]) for (const matched of [false, true]) {
  test(`LW-3 older=${older}, matched=${matched}: twelve damaged candidates inspect the lock once`, async t => {
    const f = await fixture(older), ids = Array.from({ length: 12 }, (_, i) => f.damaged.slice(0, 17) + i.toString(16).padStart(8, "0"));
    for (const id of ids) { const dir = runDir(f.base, id); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, "journal.jsonl"), ""); }
    const lockFile = path.join(f.workspace, ".codaryn", "lock.json");
    await fs.writeFile(lockFile, JSON.stringify({ pid: process.pid, runId: matched ? ids[0] : "non-run-lock", startedAt: new Date().toISOString() }) + "\n");
    const readText = nodeLockFileSystem.readText; let lockReads = 0;
    t.mock.method(nodeLockFileSystem, "readText", async (file: string) => { if (file === lockFile) lockReads++; return readText(file); });
    // No checked/no-result entry: listRuns itself does not inspect a phase lock here.
    const result = await resolveRunReference(f.workspace, "latest", STORE_RUN_REFERENCE_DEPS);
    if (matched) assert.equal(result.ok ? null : result.code, "run_in_progress");
    else if (f.previous === null) assert.equal(result.ok ? null : result.code, "run_not_found");
    else { assert.ok(result.ok); assert.equal(result.runId, f.previous); }
    t.diagnostic(JSON.stringify({ older, matched, candidates: ids.length, lockReads }));
    assert.equal(lockReads, 1, "one lock snapshot, regardless of damaged candidate count");
  });
}

test("LW-4: default and injected probes agree for the same old-id live holder", async () => {
  const f = await fixture(true), id = "20000101T000000Z-01010101", dir = runDir(f.base, id);
  await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, "journal.jsonl"), "");
  await fs.writeFile(path.join(f.workspace, ".codaryn", "lock.json"), JSON.stringify({ pid: process.pid, runId: id, startedAt: "bad" }) + "\n");
  assert.equal((await inspectLock(f.workspace)).state, "held");
  let probes = 0;
  for (const deps of [STORE_RUN_REFERENCE_DEPS, { ...STORE_RUN_REFERENCE_DEPS, runInProgress: async (_root: string, runId: string) => { probes++; return runId === id; } }]) {
    const result = await resolveRunReference(f.workspace, "latest", deps);
    assert.equal(result.ok ? null : result.code, "run_in_progress");
  }
  assert.equal(probes, 1);
});

test("LW-1: a checked no-result holder behind a completed run is still current", async () => {
  const f = await fixture(true); assert.ok(f.previous);
  const second = await f.app.startRun(taskRequest(f.base)); assert.ok(second.ok); await second.handle.done;
  await fs.rm(path.join(runDir(f.base, f.previous), "result.json"));
  await fs.writeFile(path.join(f.workspace, ".codaryn", "lock.json"), JSON.stringify({ pid: process.pid, runId: f.previous, startedAt: "bad" }) + "\n");
  const listing = await listRuns({ workspaceRoot: f.workspace });
  assert.equal(listing.runs[0]?.runId, second.handle.runId);
  const result = await resolveRunReference(f.workspace, "latest", STORE_RUN_REFERENCE_DEPS);
  assert.equal(result.ok ? null : result.code, "run_in_progress");
});
