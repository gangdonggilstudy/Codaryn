/**
 * Unit U-218 (DR-69 B-4, after na-core's U-195 and U-196; PM (a), AC-D16): the app's applyPlan carries
 * out a run plan. The CLI's apply chooses by the task's plan setting: plan "run" goes to its
 * applyChangesPlan, which checks the approval (the adapter's digest) and then carries the plan out
 * with a model run (runPrepared with the approved plan, given the plan run's goal). The app hands
 * that way the hooks a run started through the app has:
 * - the run's events to the observer (`onRunEvent`, as startRun's observer gets them) and its
 *   permission questions to `confirm` (U-108);
 * - the cancel channel (handle.cancel) and the start gate: the handle, with the carrying run's id,
 *   comes before its first event and before its engine starts;
 * - U-193's lockLeft and U-211's later release tries.
 * The approval is recorded as `adapter` (run_started.approval); the result is the carrying run's
 * EngineResult with planRunId and planDigest. A plan of moves applies as before.
 * The scripted model starts each run's script at its first step, so the carrying run's steps are
 * written after the plan run. Reproduced first (todo until the app hands the CLI its run hooks).
 * Temporary folders, scripted model, fake values only.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppError, AppHooks, ApplyHandle, ApplyObserver, CodarynApp, PlanCheck, RunEvent, TaskForm } from "../../../src/app/index.js";
import type { ConfirmRequest, EngineResult, JournalRecord } from "../../../src/contracts/index.js";
import { runApprovedPlan as engineRunApprovedPlan } from "../../../src/engine/index.js";
import { releaseLock } from "../../../src/store/index.js";
import { WRITE_NOTES, appEnvironment, exists, readJournal, setupRun, taskForm, taskRequest } from "./support.js";

const TODO = { todo: "U-218: the app does not hand the CLI's run plan way its run hooks yet" };
const windowsOnly = process.platform === "win32" ? false : "a handle that does not share deletion is made with PowerShell on Windows";

const REWRITE = { tools: ["read_file", "search_files", "write_file", "propose_changes"], plan: "run" };
const PROPOSE = { toolCalls: [{ name: "propose_changes", args: { summary: "add the notes", files: [{ path: "NOTES.md", change: "create" }] } }] };
const WAIT = { text: "waiting", delayMs: 30_000 };

type Hooks = Record<string, unknown>;
const hooksWith = (hooks: Hooks): AppHooks => hooks as unknown as AppHooks;
/** The observer of an apply with the run plan hooks (U-218). */
type PlanObserver = ApplyObserver & { onRunEvent?(event: RunEvent): void; confirm?(request: ConfirmRequest, signal: AbortSignal): Promise<{ decision: string }> };
type Done = { readonly ok: true; readonly output: EngineResult & { readonly planRunId?: string; readonly planDigest?: string }; readonly lockLeft?: true } | { readonly ok: false; readonly error: AppError };

interface Made {
  readonly base: string;
  readonly form: TaskForm;
  readonly app: CodarynApp;
  readonly planRunId: string;
  readonly digest: string;
}

/** A run plan made through the app (a config task type with plan "run"), then the carrying run's steps in the script. */
async function runPlanMade(hooks: Hooks = {}, carrying: readonly unknown[] = [WRITE_NOTES, { text: "done" }]): Promise<Made> {
  const base = await setupRun({}, { workflowRef: "rewrite" }, [PROPOSE, { text: "planned" }]);
  const config = path.join(base, "config.json");
  await writeFile(config, JSON.stringify({ schemaVersion: 1, workflows: { rewrite: REWRITE } }));
  const app = createCodarynApp(await appEnvironment(base), hooksWith(hooks));
  const started = await app.startRun(taskRequest(base, { configPath: config }));
  assert.ok(started.ok, JSON.stringify(started));
  const ended = await started.handle.done;
  assert.ok(ended.ok, JSON.stringify(ended));
  const plan = ended.result.plan as { digest: string; kind?: string } | undefined;
  assert.deepEqual([ended.result.reason, plan?.kind], ["plan_pending", "changes"], JSON.stringify(ended.result));
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps: carrying }));
  return { base, form: taskForm(base, { configPath: config }), app, planRunId: ended.result.runId, digest: (plan as { digest: string }).digest };
}

const request = (made: Made, overrides: Record<string, unknown> = {}) => ({ settings: made.form, planRunId: made.planRunId, digest: made.digest, cancelFile: null, unsafeMoveConsent: null, ...overrides });
const records = (events: readonly RunEvent[]): JournalRecord[] => events.flatMap((event) => (event.kind === "record" ? [event.record] : []));
const failed = (outcome: { ok: boolean }): string => (outcome as unknown as { error: AppError }).error.code;

async function started(app: CodarynApp, made: Made, observer?: PlanObserver): Promise<ApplyHandle> {
  const applied = await app.applyPlan(request(made), observer);
  assert.ok(applied.ok, JSON.stringify(applied));
  return applied.handle;
}

/** Another process opens `file` for `ms` milliseconds sharing reading only (no deletion); resolves once it holds it. */
async function holdOpen(file: string, ms: number): Promise<{ readonly closed: Promise<void> }> {
  const script = `$h = [System.IO.File]::Open($env:U218_FILE, "Open", "Read", "Read"); [Console]::Out.WriteLine("held"); Start-Sleep -Milliseconds ${ms}; $h.Close()`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, U218_FILE: file }, stdio: ["ignore", "pipe", "ignore"] });
  const closed = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  await new Promise<void>((resolve, reject) => {
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("held")) resolve();
    });
    child.once("exit", () => reject(new Error("the holder ended before it held the file")));
  });
  return { closed };
}

describe("U-218: applyPlan carries out a run plan through the CLI's way", () => {
  test("the handle names the carrying run before its first event; its events reach onRunEvent; the result names the plan run", TODO, async () => {
    const made = await runPlanMade();
    const runEvents: RunEvent[] = [];
    const applyEvents: unknown[] = [];
    const handle = await started(made.app, made, { onEvent: (event) => applyEvents.push(event), onRunEvent: (event) => runEvents.push(event) });
    assert.equal(runEvents.length, 0, "no event before the handle");
    assert.notEqual(handle.runId, made.planRunId, "a new run carries the plan out");
    const done = (await handle.done) as unknown as Done;
    assert.ok(done.ok, JSON.stringify(done));
    assert.deepEqual([done.output.kind, done.output.status, done.output.runId], ["run", "done", handle.runId]);
    assert.deepEqual([done.output.planRunId, done.output.planDigest], [made.planRunId, made.digest]);
    assert.equal(await readFile(path.join(made.base, "work", "NOTES.md"), "utf8"), "# Notes\n", "the planned file is written");
    const seen = records(runEvents);
    assert.ok(seen.length > 0, "the run's records reach onRunEvent");
    assert.ok(seen.every((record) => record.runId === handle.runId));
    assert.equal(applyEvents.length, 0, "no apply events: no move is made");
    const startedRecord = (await readJournal(made.base, handle.runId)).find((record) => record.type === "run_started") as unknown as { approval?: string; planRunId?: string };
    assert.deepEqual([startedRecord?.approval, startedRecord?.planRunId], ["adapter", made.planRunId], "the approval is the adapter's");
  });

  test("the carrying run's permission questions reach the observer's confirm", TODO, async () => {
    const question: ConfirmRequest = { kind: "permission", id: "c-1", callId: "call-1", tool: "run_command", permission: "command", subject: "node" as ConfirmRequest["subject"], argumentCount: 1 };
    let answer: unknown = null;
    const made = await runPlanMade({
      runApprovedPlan: async (deps: Parameters<typeof engineRunApprovedPlan>[0]) => {
        answer = await deps.confirm?.(question, new AbortController().signal);
        return engineRunApprovedPlan(deps);
      },
    });
    const asked: ConfirmRequest[] = [];
    const handle = await started(made.app, made, {
      confirm: async (request) => {
        asked.push(request);
        return { decision: "allow_once" };
      },
    });
    const done = (await handle.done) as unknown as Done;
    assert.ok(done.ok, JSON.stringify(done));
    assert.deepEqual(asked, [question]);
    assert.deepEqual(answer, { decision: "allow_once" });
  });

  test("handle.cancel() ends the carrying run as cancelled", TODO, async () => {
    const made = await runPlanMade({}, [WRITE_NOTES, WAIT]);
    let handle: ApplyHandle | undefined;
    let cancelledWithHandle = false;
    handle = await started(made.app, made, {
      onRunEvent: (event) => {
        if (event.kind === "record" && event.record.type === "file_changed") {
          cancelledWithHandle = handle !== undefined;
          handle?.cancel();
        }
      },
    });
    const done = (await handle.done) as unknown as Done;
    assert.ok(done.ok, JSON.stringify(done));
    assert.equal(cancelledWithHandle, true);
    assert.deepEqual([done.output.status, done.output.reason], ["cancelled", "cancelled"]);
  });

  test("a lock left at the carrying run's end is told and tried again later", { ...TODO, skip: windowsOnly }, async () => {
    let holder: { readonly closed: Promise<void> } | null = null;
    let ended: string | null = null;
    let work = "";
    const made = await runPlanMade({
      runApprovedPlan: async (deps: Parameters<typeof engineRunApprovedPlan>[0]) => {
        const result = await engineRunApprovedPlan(deps);
        holder = await holdOpen(path.join(work, ".codaryn", "lock.json"), 1500);
        return result;
      },
      lockRetry: { delaysMs: [1500, 3000], onEnd: (end: string) => (ended = end) },
    });
    work = path.join(made.base, "work");
    const handle = await started(made.app, made);
    const done = (await handle.done) as unknown as Done;
    try {
      assert.ok(done.ok, JSON.stringify(done));
      assert.equal(done.lockLeft, true);
      for (let waited = 0; ended === null && waited < 15_000; waited += 100) await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(ended, "released");
      assert.equal(await exists(path.join(work, ".codaryn", "lock.json")), false);
    } finally {
      await (holder as { closed: Promise<void> } | null)?.closed;
      if (await exists(path.join(work, ".codaryn", "lock.json"))) await releaseLock({ workspaceRoot: work, runId: handle.runId });
    }
  });
});

describe("U-218: what refuses a run plan's apply", () => {
  test("a digest that is not the plan's: plan_not_approved, nothing run", TODO, async () => {
    const made = await runPlanMade();
    const applied = await made.app.applyPlan(request(made, { digest: "0".repeat(64) }));
    assert.equal(failed(applied), "plan_not_approved");
    assert.equal(await exists(path.join(made.base, "work", "NOTES.md")), false);
  });

  test("a second apply of the same plan: plan_already_applied", TODO, async () => {
    const made = await runPlanMade();
    const first = await started(made.app, made);
    assert.ok((await first.done).ok);
    assert.equal(failed(await made.app.applyPlan(request(made))), "plan_already_applied");
  });

  test("the consent to unsafe moves is for moves: invalid_arguments", async () => {
    const made = await runPlanMade();
    assert.equal(failed(await made.app.applyPlan(request(made, { unsafeMoveConsent: { digest: made.digest } }))), "invalid_arguments");
  });

  test("a task form that does not resolve to plan \"run\": run_not_plan, as the CLI says", async () => {
    const made = await runPlanMade();
    // The same task type without plan "run": the CLI's apply takes the task's plan setting, not the plan's kind.
    const other = path.join(made.base, "config-none.json");
    await writeFile(other, JSON.stringify({ schemaVersion: 1, workflows: { rewrite: { tools: REWRITE.tools } } }));
    const applied = await made.app.applyPlan(request(made, { settings: taskForm(made.base, { configPath: other }) }));
    assert.equal(failed(applied), "run_not_plan");
  });
});

describe("U-218: checkApply on a run plan with the plan run's own form", () => {
  test("a plan_check of kind changes with no problem (no setting could resolve to plan \"run\" before U-195)", async () => {
    const made = await runPlanMade();
    const checked = await made.app.checkApply({ settings: made.form, planRunId: made.planRunId, digest: made.digest });
    assert.ok(checked.ok, JSON.stringify(checked));
    const check = (checked as { output: PlanCheck }).output;
    assert.deepEqual([check.kind, check.planKind, check.problems, check.lockLeft], ["plan_check", "changes", [], false]);
  });

  test("after the apply, the check says plan_already_applied", TODO, async () => {
    const made = await runPlanMade();
    const first = await started(made.app, made);
    assert.ok((await first.done).ok);
    assert.equal(failed(await made.app.checkApply({ settings: made.form, planRunId: made.planRunId, digest: made.digest })), "plan_already_applied");
  });
});
