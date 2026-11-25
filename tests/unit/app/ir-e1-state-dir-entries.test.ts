/**
 * IR-E1 (review E): every app-layer entry that takes the workspace lock refuses a state directory
 * that is a link with the one code, state_dir_not_plain, and writes nothing through the link: run
 * (the assembly), the GUI's text save, revert, review, the GUI's apply check and apply.
 * - run and the text save do not read run records first, so the junction is there from the start.
 * - revert, review, the check and apply read the run's records first (a reader refuses a linked
 *   layout as invalid_run_record, unchanged), so here `.codaryn` becomes a junction while the lock is
 *   being taken: the fs boundary moves the real folder aside and puts a junction in its place at the
 *   first mkdir of `.codaryn` (the lock's). Junctions are Windows only; elsewhere these cases skip.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { renameSync, symlinkSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { createCodarynApp } from "../../../src/app/index.js";
import { WRITE_NOTES, appEnvironment, plannedRun, setupRun, taskForm, taskRequest } from "./support.js";

const SKIP = process.platform === "win32" ? false : "junctions exist on Windows only";

const codeOf = (outcome: unknown): unknown => {
  const value = outcome as { ok?: boolean; error?: { code?: unknown } };
  return value.ok === false ? value.error?.code : `ok: ${JSON.stringify(outcome).slice(0, 120)}`;
};

async function listed(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    out.push(entry.name);
    if (entry.isDirectory()) out.push(...(await listed(path.join(dir, entry.name))).map((name) => `${entry.name}/${name}`));
  }
  return out;
}

/** An empty folder beside the workspace that the junction points at. */
async function outsideOf(base: string): Promise<string> {
  const outside = path.join(base, "outside");
  await fs.mkdir(outside);
  return outside;
}

/** At the first mkdir of `<work>/.codaryn` the real folder is moved aside and a junction to `outside` takes its place. */
async function linkAtLock(t: TestContext, base: string, outside: string): Promise<() => boolean> {
  const stateDir = path.join(await fs.realpath(path.join(base, "work")), ".codaryn");
  let swapped = false;
  const actual = fs.mkdir;
  t.mock.method(fs, "mkdir", async (...args: Parameters<typeof fs.mkdir>) => {
    if (!swapped && args[0] === stateDir) {
      swapped = true;
      renameSync(stateDir, `${stateDir}-moved`);
      symlinkSync(outside, stateDir, "junction");
    }
    return Reflect.apply(actual, fs, args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return () => swapped;
}

test("IR-E1 run: a junction .codaryn ends the start as state_dir_not_plain; nothing outside", { skip: SKIP }, async () => {
  const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
  const outside = await outsideOf(base);
  symlinkSync(outside, path.join(base, "work", ".codaryn"), "junction");
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base));
  const code = codeOf(started);
  if (started.ok) await started.handle.done;
  assert.equal(code, "state_dir_not_plain");
  assert.deepEqual(await listed(outside), []);
});

test("IR-E1 text save: a junction .codaryn refuses the write as state_dir_not_plain; the file and outside stay", { skip: SKIP }, async () => {
  const base = await setupRun({ "a.txt": "first\n" }, {}, []);
  const outside = await outsideOf(base);
  symlinkSync(outside, path.join(base, "work", ".codaryn"), "junction");
  const app = createCodarynApp(await appEnvironment(base));
  const baseDigest = createHash("sha256").update("first\n").digest("hex");
  const written = await app.writeWorkspaceText({ settings: taskForm(base), path: "a.txt", text: "mine\n", baseDigest });
  assert.equal(codeOf(written), "state_dir_not_plain");
  assert.equal(await fs.readFile(path.join(base, "work", "a.txt"), "utf8"), "first\n");
  assert.deepEqual(await listed(outside), []);
});

test("IR-E1 revert: the lock meets a junction .codaryn: state_dir_not_plain; nothing outside", { skip: SKIP }, async (t) => {
  const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok);
  assert.ok((await started.handle.done).ok);
  const outside = await outsideOf(base);
  const swapped = await linkAtLock(t, base, outside);
  const reverted = await app.revert({ workspace: path.join(base, "work"), runId: started.handle.runId });
  assert.equal(swapped(), true, "the lock made .codaryn");
  assert.equal(codeOf(reverted), "state_dir_not_plain");
  assert.deepEqual(await listed(outside), []);
});

test("IR-E1 review: the lock meets a junction .codaryn: state_dir_not_plain; nothing outside", { skip: SKIP }, async (t) => {
  const base = await setupRun({}, { workflowRef: "analyze" }, [WRITE_NOTES, { text: "done" }]);
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok);
  const ended = await started.handle.done;
  assert.ok(ended.ok);
  assert.deepEqual([ended.result.status, ended.result.reason], ["needs-input", "awaiting_review"]);
  const outside = await outsideOf(base);
  const swapped = await linkAtLock(t, base, outside);
  const reviewed = await app.review({ settings: taskForm(base), runId: started.handle.runId, decision: "accept", note: null });
  assert.equal(swapped(), true, "the lock made .codaryn");
  assert.equal(codeOf(reviewed), "state_dir_not_plain");
  assert.deepEqual(await listed(outside), []);
});

test("IR-E1 apply check (GUI): the lock meets a junction .codaryn: state_dir_not_plain; nothing outside", { skip: SKIP }, async (t) => {
  const { base, app, plan, digest } = await plannedRun();
  const outside = await outsideOf(base);
  const swapped = await linkAtLock(t, base, outside);
  const checked = await app.checkApply({ settings: taskForm(base), planRunId: plan.runId, digest });
  assert.equal(swapped(), true, "the lock made .codaryn");
  assert.equal(codeOf(checked), "state_dir_not_plain");
  assert.deepEqual(await listed(outside), []);
});

test("IR-E1 apply: the lock meets a junction .codaryn: state_dir_not_plain; nothing moved or outside", { skip: SKIP }, async (t) => {
  const { base, app, plan, digest } = await plannedRun();
  const outside = await outsideOf(base);
  const swapped = await linkAtLock(t, base, outside);
  const applied = await app.applyPlan({ settings: taskForm(base), planRunId: plan.runId, digest: digest.slice(0, 12), cancelFile: null, unsafeMoveConsent: null });
  const code = codeOf(applied);
  if (applied.ok) await applied.handle.done;
  assert.equal(swapped(), true, "the lock made .codaryn");
  assert.equal(code, "state_dir_not_plain");
  assert.equal(await fs.readFile(path.join(base, "work", "a.txt"), "utf8"), "alpha\n", "nothing was moved");
  assert.deepEqual(await listed(outside), []);
});
