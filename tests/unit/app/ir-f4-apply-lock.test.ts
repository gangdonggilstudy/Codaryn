/**
 * IR-F4: the apply of a plan of moves releases its workspace lock when its cancel source cannot be
 * made (a signal registration of the app's onSignal hook throws). Nothing runs then: no engine call,
 * no move, no apply run record; the handler registered before the failing one is taken off, the
 * error is internal_error as before, and the next ordinary apply is not refused as workspace_locked.
 * Scripted fixtures in temporary folders; no API, no real config (the app's env is empty).
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { createCodarynApp } from "../../../src/app/index.js";
import type { AppHooks, ApplyPlanRequest } from "../../../src/app/index.js";
import { applyPlan as applyEngine } from "../../../src/engine/index.js";
import { appEnvironment, setupRun, taskForm, taskRequest } from "./support.js";

/** A plan run of moves (as U-323's), made with a working onSignal hook. */
async function movesPlan(t: TestContext) {
  const actions = [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }, { kind: "discard", path: "b.txt" }];
  const base = await setupRun({ "a.txt": "alpha\n", "b.txt": "beta\n" }, {
    workflowRef: "organize", privacy: { secretEnv: [] }, verifiers: [],
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move", "discard"] },
  }, [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions } }] }, { text: "planned" }]);
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const env = await appEnvironment(base, { env: {}, onSignal: () => () => undefined });
  const start = await createCodarynApp(env).startRun(taskRequest(base));
  assert.ok(start.ok, JSON.stringify(start));
  const end = await start.handle.done;
  assert.ok(end.ok && end.result.plan, JSON.stringify(end));
  const request: ApplyPlanRequest = { settings: taskForm(base), planRunId: start.handle.runId, digest: end.result.plan.digest, cancelFile: null, unsafeMoveConsent: null };
  return { base, request, work: path.join(base, "work"), planRunId: start.handle.runId };
}

function countingHooks(): { hooks: AppHooks; calls: { engine: number } } {
  const calls = { engine: 0 };
  return { calls, hooks: { applyPlan: async (deps) => { calls.engine += 1; return applyEngine(deps); } } };
}

test("IR-F4 a signal registration that throws releases the apply's lock; nothing runs; the next apply works", async (t) => {
  const f = await movesPlan(t);
  const { hooks, calls } = countingHooks();
  const registered = new Set<string>();
  const failing = await appEnvironment(f.base, {
    env: {},
    onSignal: (name) => {
      if (name === "SIGTERM") throw new Error("synthetic signal registration failure");
      registered.add(name);
      return () => { registered.delete(name); };
    },
  });
  const refused = await createCodarynApp(failing, hooks).applyPlan(f.request);
  assert.equal(refused.ok, false, JSON.stringify(refused));
  assert.equal(refused.ok ? "" : refused.error.code, "internal_error");
  assert.equal(calls.engine, 0);
  assert.equal(registered.size, 0, "the handler registered before the failing one was taken off");
  assert.equal(existsSync(path.join(f.work, "a.txt")), true, "nothing was moved");
  assert.deepEqual(await readdir(path.join(f.work, ".codaryn", "runs")), [f.planRunId], "no apply run record");
  assert.equal(existsSync(path.join(f.work, ".codaryn", "lock.json")), false, "the apply's lock was released");

  const env = await appEnvironment(f.base, { env: {}, onSignal: () => () => undefined });
  const started = await createCodarynApp(env, hooks).applyPlan(f.request);
  assert.ok(started.ok, JSON.stringify(started));
  const done = await started.handle.done;
  assert.ok(done.ok, JSON.stringify(done));
  assert.equal(calls.engine, 1);
  assert.equal(existsSync(path.join(f.work, "sorted", "a.txt")), true);
  assert.equal(existsSync(path.join(f.work, ".codaryn", "lock.json")), false);
});

test("IR-F4 control: an apply whose signals register releases its lock and takes its handlers off", async (t) => {
  const f = await movesPlan(t);
  const { hooks, calls } = countingHooks();
  const registered = new Set<string>();
  const env = await appEnvironment(f.base, {
    env: {},
    onSignal: (name) => {
      registered.add(name);
      return () => { registered.delete(name); };
    },
  });
  const started = await createCodarynApp(env, hooks).applyPlan(f.request);
  assert.ok(started.ok, JSON.stringify(started));
  const done = await started.handle.done;
  assert.ok(done.ok, JSON.stringify(done));
  assert.equal(done.ok ? done.output.status : "", "done");
  assert.equal(calls.engine, 1);
  assert.equal(registered.size, 0);
  assert.equal(existsSync(path.join(f.work, ".codaryn", "lock.json")), false);
});
