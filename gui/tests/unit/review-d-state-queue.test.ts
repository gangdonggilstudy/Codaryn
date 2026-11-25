/** IR-D7: state mutations keep one another's changes, on disk and in memory. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { Workspaces } from "../../src/main/workspaces.js";
import { EMPTY_STATE, readGuiState, writeGuiState } from "../../src/main/gui-state.js";

const RUN = "20261127T010203Z-00000001";
const OTHER = "20261127T010204Z-00000002";
const FORM = { profile: "document", workflow: "organize" };
async function fixture(t: TestContext, failingWrite = false) {
  const temporary = await fs.realpath(tmpdir());
  const root = await fs.realpath(await fs.mkdtemp(path.join(temporary, "codaryn-review-d-state-")));
  assert.ok(root.startsWith(temporary.endsWith(path.sep) ? temporary : temporary + path.sep));
  t.after(async () => {
    assert.ok(root.startsWith(temporary.endsWith(path.sep) ? temporary : temporary + path.sep));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const one = path.join(root, "one");
  await fs.mkdir(one);
  const parent = path.join(root, "state");
  if (failingWrite) await fs.writeFile(parent, "a file cannot be the state directory");
  const stateFile = path.join(parent, "memory.json");
  const create = () => new Workspaces({ stateFile, platform: process.platform, randomBytes, now: () => new Date("2026-11-27T01:02:03Z"), isDirectory: async target => {
    try { return (await fs.stat(target)).isDirectory(); } catch { return false; }
  } });
  return { root, one, stateFile, create };
}

test("IR-D7: concurrent rememberWindow/rememberRun keep both changes after flush", async t => {
  const f = await fixture(t), workspaces = f.create(), opened = await workspaces.open(f.one);
  assert.ok(opened.ok);
  await Promise.all([workspaces.rememberWindow({ screen: "runs", treeWidth: 360 }), workspaces.rememberRun(opened.handle, RUN, FORM)]);
  await workspaces.flush();
  const forms = [...(await workspaces.runForms(opened.handle))], memory = await workspaces.windowMemory();
  t.diagnostic(JSON.stringify({ forms, memory }));
  assert.deepEqual(forms, [[RUN, FORM]]);
  assert.deepEqual([memory.screen, memory.treeWidth], ["runs", 360]);
  const disk = await readGuiState(f.stateFile, process.platform);
  assert.deepEqual(disk.workspaceMemory[0]?.runs, [{ runId: RUN, ...FORM }]);
  assert.equal(disk.window?.screen, "runs");
});

test("IR-D7: two concurrent run memories retain both forms", async t => {
  const f = await fixture(t), workspaces = f.create(), opened = await workspaces.open(f.one);
  assert.ok(opened.ok);
  await Promise.all([workspaces.rememberRun(opened.handle, RUN, FORM), workspaces.rememberRun(opened.handle, OTHER, { profile: null, workflow: "analyze" })]);
  await workspaces.flush();
  assert.deepEqual([...(await workspaces.runForms(opened.handle))], [[OTHER, { profile: null, workflow: "analyze" }], [RUN, FORM]]);
});

test("IR-D7: forgetting a recent workspace and remembering a window cannot restore the forgotten entry", async t => {
  const f = await fixture(t), workspaces = f.create();
  await workspaces.open(f.one);
  const recent = await workspaces.recent();
  assert.ok(recent[0]);
  await Promise.all([workspaces.rememberWindow({ screen: "checks" }), workspaces.forgetRecent(recent[0].id)]);
  await workspaces.flush();
  const disk = await readGuiState(f.stateFile, process.platform);
  assert.deepEqual(disk.recentWorkspaces, []);
  assert.equal(disk.window?.screen, "checks");
});

test("IR-D7: flush waits for already queued run and window writes without separately awaiting them", async t => {
  const f = await fixture(t), workspaces = f.create(), opened = await workspaces.open(f.one);
  assert.ok(opened.ok);
  const jobs = [workspaces.rememberWindow({ screen: "settings" }), workspaces.rememberRun(opened.handle, RUN, FORM)];
  await workspaces.flush();
  const disk = await readGuiState(f.stateFile, process.platform);
  assert.equal(disk.window?.screen, "settings");
  assert.deepEqual(disk.workspaceMemory[0]?.runs, [{ runId: RUN, ...FORM }]);
  await Promise.all(jobs);
});

test("IR-D7: a failed state write still keeps memory and does not block later mutations", async t => {
  const f = await fixture(t, true), workspaces = f.create(), opened = await workspaces.open(f.one);
  assert.ok(opened.ok);
  await Promise.all([workspaces.rememberWindow({ screen: "runs" }), workspaces.rememberRun(opened.handle, RUN, FORM)]);
  await workspaces.rememberWindow({ treeWidth: 400 });
  await workspaces.flush();
  assert.deepEqual([...(await workspaces.runForms(opened.handle))], [[RUN, FORM]]);
  const memory = await workspaces.windowMemory();
  assert.deepEqual([memory.screen, memory.treeWidth], ["runs", 400]);
  await assert.rejects(fs.stat(f.stateFile));
});

test("IR-D7: an old initial read cannot replace state changed while that read was pending", { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  await writeGuiState(f.stateFile, EMPTY_STATE);
  const workspaces = f.create(), actual = fs.readFile;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let first = true;
  const mock = t.mock.method(fs, "readFile", async (...args: unknown[]) => {
    const text = await Reflect.apply(actual, fs, args);
    if (args[0] === f.stateFile && first) { first = false; entered.resolve(); await release.promise; }
    return text;
  });
  syncBuiltinESMExports();
  t.after(() => { release.resolve(); mock.mock.restore(); syncBuiltinESMExports(); });
  const pending = workspaces.windowMemory();
  await entered.promise;
  const opened = await workspaces.open(f.one);
  assert.ok(opened.ok);
  await workspaces.rememberRun(opened.handle, RUN, FORM);
  release.resolve();
  await pending;
  await workspaces.flush();
  assert.deepEqual([...(await workspaces.runForms(opened.handle))], [[RUN, FORM]]);
});
