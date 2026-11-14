/** U-322: public app revert seams, fixed before wiring. Scripted/local fixtures only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { RevertRequest } from "../../../src/app/index.js";
import { releaseLock } from "../../../src/store/index.js";
import { installFsFaults } from "../../support/fs-faults.js";
import { appEnvironment, setupRun, taskForm, taskRequest, WRITE_NOTES } from "./support.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const exists = async (file: string) => (await stat(file).catch(() => null)) !== null;

async function snapshot(root: string): Promise<unknown> {
  const entries = await readdir(root, { withFileTypes: true });
  return Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(async (entry) => [
    entry.name, entry.isDirectory() ? await snapshot(path.join(root, entry.name)) : (await readFile(path.join(root, entry.name))).toString("hex"),
  ]));
}

async function fixture(moves = false) {
  const base = await setupRun({ "guide.md": "old\n", "a.txt": "alpha\n", "b.txt": "beta\n" }, moves ? {
    workflowRef: "organize", verifiers: [], privacy: { secretEnv: [] },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move", "discard"] },
  } : { privacy: { secretEnv: [] } }, moves ? [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [
    { kind: "move", from: "a.txt", to: "sorted/a.txt" }, { kind: "discard", path: "b.txt" },
  ] } }] }] : [WRITE_NOTES, { toolCalls: [{ name: "write_file", args: {
    path: "guide.md", expectedHash: hash("old\n"), change: { kind: "replace_all", content: "new\n" },
  } }] }, { text: "done" }]);
  let now = Date.now() - 600_000;
  let seed = 31;
  const env = await appEnvironment(base, { env: {}, clock: { now: () => (now += 1000) }, randomBytes: (size) => new Uint8Array(size).fill(seed++) });
  const app = createCodarynApp(env);
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok, JSON.stringify(started));
  const ended = await started.handle.done;
  assert.ok(ended.ok);
  let runId = started.handle.runId;
  if (moves) {
    assert.ok(ended.result.plan);
    const apply = await app.applyPlan({ settings: taskForm(base), planRunId: runId, digest: ended.result.plan.digest, cancelFile: null, unsafeMoveConsent: null });
    assert.ok(apply.ok);
    assert.ok((await apply.handle.done).ok);
    runId = apply.handle.runId;
  }
  return { base, env, app, workspace: path.join(base, "work"), runId, planRunId: started.handle.runId };
}

test("U-322: dry run changes no bytes, then one real revert restores/deletes and records exactly its output", async () => {
  const f = await fixture();
  const request = { workspace: f.workspace, runId: f.runId };
  const before = await snapshot(f.workspace);
  const preview = await f.app.revert({ ...request, dryRun: true });
  assert.ok(preview.ok);
  assert.equal(preview.output.dryRun, true);
  assert.deepEqual(await snapshot(f.workspace), before);
  const out = await f.app.revert(request);
  assert.deepEqual(out, { ok: true, output: { schemaVersion: 1, kind: "revert", runId: f.runId, status: "complete", exitCode: 0,
    reverted: [{ path: "NOTES.md", action: "deleted" }, { path: "guide.md", action: "restored" }], skipped: [],
  } });
  assert.ok(out.ok);
  assert.deepEqual(Object.keys(out.output), ["schemaVersion", "kind", "runId", "status", "exitCode", "reverted", "skipped"]);
  assert.equal(await exists(path.join(f.workspace, "NOTES.md")), false);
  assert.equal(await readFile(path.join(f.workspace, "guide.md"), "utf8"), "old\n");
  assert.equal(await exists(path.join(f.workspace, ".codaryn/lock.json")), false);
  const record = JSON.parse(await readFile(path.join(f.workspace, ".codaryn/runs", f.runId, "revert.json"), "utf8"));
  assert.equal(record.status, "complete");
  const again = await f.app.revert(request);
  assert.ok(again.ok);
  assert.equal(again.output.status, "complete");
  assert.deepEqual(again.output.reverted, []);
  assert.ok(again.output.skipped.every((file) => file.reason === "already_reverted"));
  assert.deepEqual(again.output.revertedBefore, { at: record.at, status: "complete" });
});

test("U-322: partial revert preserves a user's changed file and the existing JSON shape", async () => {
  const f = await fixture();
  await writeFile(path.join(f.workspace, "NOTES.md"), "user edit\n", "utf8");
  const out = await f.app.revert({ workspace: f.workspace, runId: f.runId });
  assert.deepEqual(out, { ok: true, output: { schemaVersion: 1, kind: "revert", runId: f.runId, status: "partial", exitCode: 3,
    reverted: [{ path: "guide.md", action: "restored" }], skipped: [{ path: "NOTES.md", reason: "changed_since_run" }],
  } });
  assert.equal(await readFile(path.join(f.workspace, "NOTES.md"), "utf8"), "user edit\n");
});

test("U-322: consent precedes parsing/filesystem, malformed request rejection remains outside catch", async () => {
  const f = await fixture();
  let touched = 0;
  const unexpected = () => { touched++; throw new Error("must not reach environment"); };
  const app = createCodarynApp({ ...f.env, isDirectory: unexpected, clock: { now: unexpected }, randomBytes: unexpected });
  const cases: Array<[RevertRequest, string]> = [
    [{ workspace: "--invalid", runId: "latest", unsafeMoveConsent: {} } as RevertRequest, "a consent to unsafe moves names the run reverted; nothing was changed"],
    [{ workspace: "missing", runId: f.runId, dryRun: true, unsafeMoveConsent: { runId: f.runId } }, "a dry run moves nothing and takes no consent to unsafe moves; nothing was read or changed"],
    [{ workspace: "missing", runId: "latest", unsafeMoveConsent: { runId: f.runId } }, "the consent to unsafe moves names another run than the one reverted; nothing was changed"],
  ];
  for (const [request, message] of cases) assert.deepEqual(await app.revert(request), { ok: false, error: { code: "invalid_arguments", message } });
  await assert.rejects(app.revert(null as unknown as RevertRequest), TypeError);
  assert.equal(touched, 0);
});

test("U-322: parser/path refusals precede filesystem; null-result and outer errors stay distinct", async () => {
  const f = await fixture();
  let touched = 0;
  const rejecting = createCodarynApp({ ...f.env, isDirectory: async () => { touched++; throw new Error("synthetic directory failure"); } });
  for (const request of [
    { workspace: "", runId: "latest" }, { workspace: f.workspace, runId: "--bad" },
    { workspace: "//127.0.0.1/share", runId: f.runId }, { workspace: f.workspace, runId: "../outside" },
  ]) {
    const out = await rejecting.revert(request);
    assert.ok(!out.ok && out.error.code === "invalid_arguments");
  }
  assert.equal(touched, 0);
  const outer = await rejecting.revert({ workspace: f.workspace, runId: f.runId });
  assert.deepEqual(outer, { ok: false, error: { code: "internal_error", message: "the call stopped because of an internal error" } });
  let calls = 0;
  const commandThrows = createCodarynApp({ ...f.env, clock: { now() { if (++calls === 2) throw new Error("synthetic lock clock failure"); return f.env.clock.now(); } } });
  const before = await snapshot(f.workspace);
  const inner = await commandThrows.revert({ workspace: f.workspace, runId: f.runId });
  assert.deepEqual(inner, { ok: false, error: { code: "internal_error", message: "the revert stopped because of an internal error", category: "internal", retryable: false } });
  assert.equal(calls, 2);
  assert.deepEqual(await snapshot(f.workspace), before);
});

test("U-322: unsafe moves/discards require a separate consent request, one revert per request", async () => {
  const f = await fixture(true);
  let runs = 0;
  const app = createCodarynApp({ ...f.env, randomBytes: (size) => { runs++; return f.env.randomBytes(size); } });
  const faults = installFsFaults({ noLinksUnder: f.workspace });
  try {
    const unsafe = await app.revert({ workspace: f.workspace, runId: f.runId });
    assert.ok(unsafe.ok && unsafe.output.status === "partial");
    assert.ok(unsafe.output.skipped.length > 0 && unsafe.output.skipped.every((file) => file.reason === "unsafe_move"));
    assert.equal(runs, 1);
    assert.equal(await exists(path.join(f.workspace, "a.txt")), false);
    const restored = await app.revert({ workspace: f.workspace, runId: f.runId, unsafeMoveConsent: { runId: f.runId } });
    assert.ok(restored.ok && restored.output.status === "complete");
    assert.equal(runs, 2);
    assert.equal(await readFile(path.join(f.workspace, "a.txt"), "utf8"), "alpha\n");
    assert.equal(await readFile(path.join(f.workspace, "b.txt"), "utf8"), "beta\n");
  } finally { faults.remove(); }
});

test("U-322: release failure keeps output and lockLeft sibling, never a JSON field", async () => {
  const f = await fixture();
  const lockFile = path.join(f.workspace, ".codaryn/lock.json");
  const faults = installFsFaults({ failLockRemoval: lockFile });
  try {
    const out = await f.app.revert({ workspace: f.workspace, runId: f.runId });
    assert.ok(out.ok);
    assert.equal(out.lockLeft, true);
    assert.equal("lockLeft" in out.output, false);
    assert.equal(out.output.status, "complete");
    assert.deepEqual(Object.keys(out), ["ok", "output", "lockLeft"]);
    assert.ok(faults.counts.removals > 0);
  } finally {
    faults.remove();
    const lock = JSON.parse(await readFile(lockFile, "utf8"));
    assert.notEqual(lock.runId, f.runId);
    await releaseLock({ workspaceRoot: f.workspace, runId: lock.runId });
  }
});

test("U-322: reverting a plan-only run keeps the app's existing absence of loadPlan hints", async () => {
  const f = await fixture(true);
  const out = await f.app.revert({ workspace: f.workspace, runId: f.planRunId });
  assert.deepEqual(out, { ok: true, output: { schemaVersion: 1, kind: "revert", runId: f.planRunId, status: "complete", exitCode: 0, reverted: [], skipped: [] } });
  assert.equal(await exists(path.join(f.workspace, "sorted/a.txt")), true);
});
