/**
 * Unit U-91 (gap survey, GUI 3.9, DR-21; PM: implement the draft, the engine's PlanExecutor.check
 * as it is, no copied judgement): the app layer checks a pending plan before it is applied,
 * `checkApply`, so the plan screen can show which actions cannot be applied and which moves would
 * need the person's consent before the first apply instead of after it.
 * - The same refusals as the apply's before anything runs (the plan view's checks, then the apply
 *   task's plan setting, the plan already applied, a records-changed mark, the digest).
 * - The same judgement as the apply's preflight: the apply task's planActions and the policy gate,
 *   then the executor's check of each action; the inventory limit as the plan view lists it.
 * - Nothing is moved, recorded or claimed. The check holds the workspace lock while the executor
 *   probes for hard links, and takes back both before it ends; a probe or a lock it cannot take back
 *   is told in the result (`probesLeft`, `lockLeft`), never hidden.
 * Reproduced first (9f32ee5, todo until the app layer gave it). Scripted model, temporary folders,
 * fake values only. Every probe and lock a test leaves is taken back by the test.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { RECORDS_CHANGED_FILE_NAME } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, AppHooks, ApplyCheckOperations, ApplyResult, CheckApplyRequest, CodarynApp, PlanCheck, PlanOutput, TaskForm } from "../../../src/app/index.js";
import { acquireLock, isRunTimestamp, releaseLock } from "../../../src/store/index.js";
import { PLAN_TASK, SECRET_ENV, WRITE_NOTES, appEnvironment, planSteps, plannedRun, readJournal, runDir, setupRun, taskForm, taskRequest } from "./support.js";

type Check = PlanCheck;
type Request = { readonly settings: TaskForm; readonly planRunId: string; readonly digest: string };

const NO_RUN = "20200101T000000Z-00000000";
const OTHER_SECRET = "other-fake-APP-VALUE-0099";
const PROBE_PREFIX = ".codaryn-link-probe-";

/** The app's checkApply, called as an adapter calls it; a test may hand it what an adapter must not. */
const check = (app: CodarynApp) => (request: Request) => app.checkApply(request as CheckApplyRequest);

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

function code(outcome: AppCallOutcome<unknown>): string {
  return outcome.ok ? "ok" : outcome.error.code;
}

/** Every path under the workspace, its state directory included, with file contents. */
async function tree(work: string): Promise<string[]> {
  const names = (await readdir(work, { recursive: true })).map((name) => name.split(path.sep).join("/")).sort();
  const out: string[] = [];
  for (const name of names) {
    const content = await readFile(path.join(work, name)).then(
      (bytes) => bytes.toString("base64"),
      () => "(dir)",
    );
    out.push(`${name}=${content}`);
  }
  return out;
}

/** Probe names left in the state directory and the workspace root. */
async function probes(work: string): Promise<string[]> {
  const found: string[] = [];
  for (const dir of [path.join(work, ".codaryn"), work]) {
    for (const name of await readdir(dir).catch(() => [] as string[])) if (name.startsWith(PROBE_PREFIX)) found.push(path.join(dir, name));
  }
  return found;
}

/** Hooks only the check uses (the file operations of its executor, its probe removal and its lock release). */
function checkHooks(applyCheck: ApplyCheckOperations): AppHooks {
  return { applyCheck };
}

/** A plan run whose task allows moves and discards, with `actions`; and an apply task that allows moves only. */
async function plannedWith(files: Readonly<Record<string, string>>, actions: readonly unknown[]): Promise<{ base: string; app: CodarynApp; planRunId: string; digest: string; movesOnly: TaskForm }> {
  const base = await setupRun(files, { ...PLAN_TASK, policy: { ...PLAN_TASK.policy, planActions: ["move", "discard"] } }, [
    { toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions } }] },
  ]);
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok, JSON.stringify(started));
  const ended = await started.handle.done;
  assert.ok(ended.ok && ended.result.reason === "plan_pending", JSON.stringify(ended));
  const task = JSON.parse(await readFile(path.join(base, "task.json"), "utf8")) as Record<string, unknown>;
  await writeFile(path.join(base, "moves-task.json"), JSON.stringify({ ...task, policy: { ...PLAN_TASK.policy, planActions: ["move"] } }), "utf8");
  const movesOnly = taskForm(base, { input: { kind: "task", taskPath: path.join(base, "moves-task.json") } });
  return { base, app, planRunId: started.handle.runId, digest: ended.result.plan?.digest ?? "", movesOnly };
}

describe("U-91: checkApply checks a pending plan as the apply's preflight would, and changes nothing", () => {
  test("a plan that can be applied: nothing to tell, nothing left or changed, and it can still be applied", async () => {
    const { base, app, plan, digest } = await plannedRun();
    const work = path.join(base, "work");
    const before = await tree(work);
    const checked = ok(await check(app)({ settings: taskForm(base), planRunId: plan.runId, digest: digest.slice(0, 12) }));
    assert.deepEqual(
      [checked.kind, checked.planRunId, checked.digest, checked.problems, checked.unsafeMoves, checked.inventoryLimitReached, checked.probesLeft, checked.lockLeft],
      ["plan_check", plan.runId, digest, [], [], false, 0, false],
    );
    assert.ok(isRunTimestamp(checked.checkedAt));
    assert.deepEqual(await tree(work), before, "no file, record, lock or probe is left or changed");
    const view = ok(await app.plan({ settings: taskForm(base), runId: plan.runId })) as PlanOutput;
    assert.deepEqual([view.status, view.appliedBy], ["pending", null]);
    const started = await app.applyPlan({ settings: taskForm(base), planRunId: plan.runId, digest: digest.slice(0, 12), cancelFile: null, unsafeMoveConsent: null });
    assert.ok(started.ok, JSON.stringify(started));
    ok<ApplyResult>(await started.handle.done);
    assert.equal(existsSync(path.join(work, "sorted", "a.txt")), true, "the apply after the check moved the file");
  });

  test("the same judgement as the apply's preflight record (plan_checked), action by action", async () => {
    const run = await plannedWith({ "a.txt": "a\n", "b.txt": "b\n", "c.txt": "c\n", "d.txt": "d\n" }, [
      { kind: "move", from: "a.txt", to: "x/a.txt" },
      { kind: "move", from: "b.txt", to: "x/b.txt" },
      { kind: "move", from: "c.txt", to: "x/c.txt" },
      { kind: "discard", path: "d.txt" },
    ]);
    const work = path.join(run.base, "work");
    await writeFile(path.join(work, "b.txt"), "changed\n", "utf8");
    await mkdir(path.join(work, "x"));
    await writeFile(path.join(work, "x", "c.txt"), "taken\n", "utf8");
    const checked = ok(await check(run.app)({ settings: run.movesOnly, planRunId: run.planRunId, digest: run.digest }));
    assert.deepEqual(checked.problems, [
      { index: 1, problem: "source_changed" },
      { index: 2, problem: "destination_exists" },
      { index: 3, problem: "denied" },
    ]);
    assert.deepEqual(checked.unsafeMoves, []);
    const started = await run.app.applyPlan({ settings: run.movesOnly, planRunId: run.planRunId, digest: run.digest, cancelFile: null, unsafeMoveConsent: null });
    assert.ok(started.ok, JSON.stringify(started));
    const applied = ok<ApplyResult>(await started.handle.done);
    assert.equal(applied.reason, "plan_stale");
    const record = (await readJournal(run.base, started.handle.runId)).find((line) => (line.type as string) === "plan_checked") as unknown as Record<string, unknown>;
    assert.deepEqual([record["problems"], record["unsafeMoves"], record["inventoryLimitReached"]], [checked.problems, checked.unsafeMoves, checked.inventoryLimitReached]);
    assert.equal(existsSync(path.join(work, "a.txt")), true, "nothing was moved");
  });

  test("DR-21: a move that could only be made unsafely is listed, as the consent it would need", async () => {
    const { base, plan, digest } = await plannedRun();
    const noLinks = Object.assign(new Error("no hard links here"), { code: "EPERM" });
    const app = createCodarynApp(await appEnvironment(base), checkHooks({ fileOps: { link: async () => Promise.reject(noLinks) } }));
    const checked = ok(await check(app)({ settings: taskForm(base), planRunId: plan.runId, digest }));
    assert.deepEqual([checked.problems, checked.unsafeMoves, checked.probesLeft], [[], [0], 0]);
  });

  test("a probe the executor could not take back is taken back by the check", async () => {
    const { base, plan, digest } = await plannedRun();
    const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
    const app = createCodarynApp(await appEnvironment(base), checkHooks({ fileOps: { unlink: async () => Promise.reject(busy) } }));
    const checked = ok(await check(app)({ settings: taskForm(base), planRunId: plan.runId, digest }));
    assert.deepEqual([checked.problems, checked.unsafeMoves, checked.probesLeft], [[], [], 0]);
    assert.deepEqual(await probes(path.join(base, "work")), []);
  });

  test("a probe that cannot be taken back at all is told (probesLeft), not hidden", async () => {
    const { base, plan, digest } = await plannedRun();
    const work = path.join(base, "work");
    const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
    const app = createCodarynApp(
      await appEnvironment(base),
      checkHooks({ fileOps: { unlink: async () => Promise.reject(busy) }, removeProbe: async () => Promise.reject(busy) }),
    );
    try {
      const checked = ok(await check(app)({ settings: taskForm(base), planRunId: plan.runId, digest }));
      assert.equal(checked.probesLeft, 1);
      assert.equal((await probes(work)).length, 1, "the probe the result tells of is there");
    } finally {
      // The test takes back what it made the check leave.
      for (const probe of await probes(work)) await rm(probe);
    }
    assert.deepEqual(await probes(work), []);
  });

  test("the workspace lock: held while checking and released after; a held lock is workspace_locked", async () => {
    const { base, plan, digest } = await plannedRun();
    const work = path.join(base, "work");
    const lockFile = path.join(work, ".codaryn", "lock.json");
    const seen: boolean[] = [];
    const { lstat } = await import("node:fs/promises");
    const app = createCodarynApp(
      await appEnvironment(base),
      checkHooks({ fileOps: { lstat: async (target: string) => (seen.push(existsSync(lockFile)), lstat(target, { bigint: true })) } }),
    );
    ok(await check(app)({ settings: taskForm(base), planRunId: plan.runId, digest }));
    assert.ok(seen.length > 0 && seen.every(Boolean), "the executor looked at files only under the lock");
    assert.equal(existsSync(lockFile), false, "and the lock was released");

    const root = await realpath(work);
    const holder = "20200101T000000Z-11111111";
    assert.ok((await acquireLock({ workspaceRoot: root, runId: holder, clock: { now: () => Date.now() } })).ok);
    try {
      assert.equal(code(await check(app)({ settings: taskForm(base), planRunId: plan.runId, digest })), "workspace_locked");
      assert.equal((JSON.parse(await readFile(lockFile, "utf8")) as { runId?: unknown }).runId, holder, "the holder's lock is untouched");
    } finally {
      await releaseLock({ workspaceRoot: root, runId: holder });
    }
    assert.equal(existsSync(lockFile), false);
  });

  test("a lock that cannot be released is told (lockLeft), not hidden", async () => {
    const { base, plan, digest } = await plannedRun();
    const work = path.join(base, "work");
    const lockFile = path.join(work, ".codaryn", "lock.json");
    const app = createCodarynApp(await appEnvironment(base), checkHooks({ releaseLock: async () => Promise.reject(new Error("busy")) }));
    try {
      const checked = ok(await check(app)({ settings: taskForm(base), planRunId: plan.runId, digest }));
      assert.equal(checked.lockLeft, true);
      assert.equal(existsSync(lockFile), true, "the lock the result tells of is there");
    } finally {
      // The test takes back the lock it made the check leave (same process, so releaseLock may).
      const left = JSON.parse(await readFile(lockFile, "utf8").catch(() => "{}")) as { runId?: string };
      if (typeof left.runId === "string") await releaseLock({ workspaceRoot: await realpath(work), runId: left.runId });
    }
    assert.equal(existsSync(lockFile), false);
  });

  test("the apply's refusals, before anything is checked; none leaves a lock", async () => {
    const { base, app, plan, digest } = await plannedRun();
    const work = path.join(base, "work");
    const form = taskForm(base);
    for (const request of [
      { planRunId: "latest", digest },
      { planRunId: "../x", digest },
      { planRunId: plan.runId, digest: digest.slice(0, 11) },
      { planRunId: plan.runId, digest: "g".repeat(12) },
      { planRunId: plan.runId, digest: 12 },
    ]) {
      assert.equal(code(await check(app)({ settings: form, ...(request as { planRunId: string; digest: string }) })), "invalid_arguments", JSON.stringify(request));
    }
    const other = digest.startsWith("0") ? "1".repeat(12) : "0".repeat(12);
    assert.equal(code(await check(app)({ settings: form, planRunId: plan.runId, digest: other })), "plan_not_approved");
    assert.equal(code(await check(app)({ settings: form, planRunId: NO_RUN, digest })), "run_not_found");

    const task = JSON.parse(await readFile(path.join(base, "task.json"), "utf8")) as Record<string, unknown>;
    const { workflowRef: _workflowRef, ...plain } = task;
    await writeFile(path.join(base, "plain-task.json"), JSON.stringify({ ...plain, policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false } }), "utf8");
    const plainForm = taskForm(base, { input: { kind: "task", taskPath: path.join(base, "plain-task.json") } });
    assert.equal(code(await check(app)({ settings: plainForm, planRunId: plan.runId, digest })), "run_not_plan", "the apply task does not resolve to plan apply");

    await writeFile(path.join(runDir(base, plan.runId), RECORDS_CHANGED_FILE_NAME), "{}", "utf8");
    assert.equal(code(await check(app)({ settings: form, planRunId: plan.runId, digest })), "plan_records_changed");
    assert.equal(existsSync(path.join(work, ".codaryn", "lock.json")), false);
  });

  test("a plan already applied, and a run that is not a plan", async () => {
    const { base, app, plan, digest } = await plannedRun();
    const started = await app.applyPlan({ settings: taskForm(base), planRunId: plan.runId, digest, cancelFile: null, unsafeMoveConsent: null });
    assert.ok(started.ok, JSON.stringify(started));
    await started.handle.done;
    assert.equal(code(await check(app)({ settings: taskForm(base), planRunId: plan.runId, digest })), "plan_already_applied");
    // An apply run holds no plan: refused as the apply refuses it.
    const applyRun = started.handle.runId;
    const viaApply = await app.applyPlan({ settings: taskForm(base), planRunId: applyRun, digest, cancelFile: null, unsafeMoveConsent: null });
    assert.equal(viaApply.ok, false);
    assert.equal(code(await check(app)({ settings: taskForm(base), planRunId: applyRun, digest })), viaApply.ok ? "ok" : viaApply.error.code);

    const plain = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const plainApp = createCodarynApp(await appEnvironment(plain));
    const ran = await plainApp.startRun(taskRequest(plain));
    assert.ok(ran.ok);
    await ran.handle.done;
    assert.equal(code(await check(plainApp)({ settings: taskForm(plain), planRunId: ran.handle.runId, digest })), "run_not_plan");
  });

  test("DR-28: values registered now that mask the plan's paths otherwise: plan_secrets_differ", async () => {
    const name = `${OTHER_SECRET}.txt`;
    const { base, plan, digest } = await plannedRun({ [name]: "o" }, planSteps(name, "sorted/o.txt"));
    const later = createCodarynApp(await appEnvironment(base, { env: { [SECRET_ENV]: OTHER_SECRET } }));
    assert.equal(code(await check(later)({ settings: taskForm(base), planRunId: plan.runId, digest })), "plan_secrets_differ");
    assert.equal(existsSync(path.join(base, "work", ".codaryn", "lock.json")), false);
  });

  test("settings that do not resolve give their error and nothing is checked", async () => {
    const { base, plan, digest } = await plannedRun();
    const app = createCodarynApp(await appEnvironment(base, { env: {} }));
    assert.equal(code(await check(app)({ settings: taskForm(base), planRunId: plan.runId, digest })), "secret_env_missing");
  });
});
