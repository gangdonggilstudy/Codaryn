/**
 * Unit U-193 (after nc-human's U-176: releaseLock tries again briefly on EBUSY/EPERM, then throws):
 * a lock that could not be released is told to the app layer's callers, and never hides a result.
 * - A run through the app: its finish wrote result.json, then the release failed; the run ended as
 *   internal_error although its result was there. Now the run's result stays and `lockLeft: true`
 *   is added to its outcome (RunOutcome; nothing in the result or result.json changes).
 * - checkApply: a release that answers false (the lock is not this check's any more) is a lock
 *   left too, as for writeWorkspaceText (V-1 L-1).
 * - applyCleanup: the store's CleanupOutcome gains `lockLeft?` (the contract line of this unit); the
 *   app passes it on. The store fills it in nc-human's part, so that test stays todo until then.
 * The handle cases need Windows: another process (PowerShell) opens the lock file sharing reading
 * only, as U-176's tests do, past the release's retries. Temporary folders, scripted model.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, CleanupApplied, CleanupPreview, PlanCheck, RunOutcome } from "../../../src/app/index.js";
import { runTask as engineRunTask } from "../../../src/engine/index.js";
import { inspectLock, releaseLock } from "../../../src/store/index.js";
import { WRITE_NOTES, appEnvironment, exists, plannedRun, setupRun, taskForm, taskRequest } from "./support.js";

const windowsOnly = process.platform === "win32" ? false : "a handle that does not share deletion is made with PowerShell on Windows";

/** Another process opens `file` for `ms` milliseconds sharing reading only (no deletion); resolves once it holds it. */
async function holdOpen(file: string, ms: number): Promise<{ readonly closed: Promise<void> }> {
  const script = `$h = [System.IO.File]::Open($env:U193_FILE, "Open", "Read", "Read"); [Console]::Out.WriteLine("held"); Start-Sleep -Milliseconds ${ms}; $h.Close()`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, U193_FILE: file }, stdio: ["ignore", "pipe", "ignore"] });
  const closed = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  await new Promise<void>((resolve, reject) => {
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("held")) resolve();
    });
    child.once("exit", () => reject(new Error("the holder ended before it held the file")));
  });
  return { closed };
}

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}
const lockFile = (work: string): string => path.join(work, ".codaryn", "lock.json");

describe("U-193: a run through the app whose lock cannot be released", () => {
  test("the run's result stays and lockLeft is told; result.json is the result", { skip: windowsOnly }, async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const work = path.join(base, "work");
    let holder: { readonly closed: Promise<void> } | null = null;
    // After the engine's run, before the CLI's finish releases the lock: hold the lock file past the retries.
    const app = createCodarynApp(await appEnvironment(base), {
      runTask: async (deps) => {
        const ended = await engineRunTask(deps);
        holder = await holdOpen(lockFile(work), 2500);
        return ended;
      },
    });
    const started = await app.startRun(taskRequest(base));
    assert.ok(started.ok, JSON.stringify(started));
    const done: RunOutcome = await started.handle.done;
    try {
      assert.ok(done.ok, JSON.stringify(done));
      assert.equal(done.result.status, "done");
      assert.equal((done as { lockLeft?: boolean }).lockLeft, true);
      const stored = JSON.parse(await readFile(path.join(work, ".codaryn", "runs", done.result.runId, "result.json"), "utf8")) as { runId: string; status: string };
      assert.deepEqual([stored.runId, stored.status], [done.result.runId, "done"]);
      assert.equal(Object.hasOwn(done.result, "lockLeft"), false, "the result itself is as before");
    } finally {
      await (holder as { closed: Promise<void> } | null)?.closed;
      // U-176: the same run's later release still removes it.
      if (await exists(lockFile(work))) await releaseLock({ workspaceRoot: work, runId: started.handle.runId });
    }
  });

  test("a lock released as always: no lockLeft", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.ok(started.ok, JSON.stringify(started));
    const done = await started.handle.done;
    assert.ok(done.ok, JSON.stringify(done));
    assert.equal(Object.hasOwn(done, "lockLeft"), false);
    assert.equal(await exists(lockFile(path.join(base, "work"))), false);
  });
});

describe("U-193: checkApply's release", () => {
  async function checkWith(release: () => Promise<boolean>): Promise<{ check: PlanCheck; work: string }> {
    const planned = await plannedRun();
    const app = createCodarynApp(await appEnvironment(planned.base), { applyCheck: { releaseLock: release } });
    const check = ok(await app.checkApply({ settings: taskForm(planned.base), planRunId: planned.plan.runId, digest: planned.digest }));
    return { check, work: path.join(planned.base, "work") };
  }
  const takeBack = async (work: string): Promise<void> => {
    if (!(await exists(lockFile(work)))) return;
    const runId = (JSON.parse(await readFile(lockFile(work), "utf8")) as { runId: string }).runId;
    await releaseLock({ workspaceRoot: work, runId });
  };

  test("a release that answers false is a lock left", async () => {
    const { check, work } = await checkWith(async () => false);
    try {
      assert.equal(check.lockLeft, true);
      assert.equal((await inspectLock(work)).state, "held");
    } finally {
      await takeBack(work);
    }
  });

  test("a release that throws is a lock left (as before)", async () => {
    const { check, work } = await checkWith(() => Promise.reject(new Error("refused by the test")));
    try {
      assert.equal(check.lockLeft, true);
    } finally {
      await takeBack(work);
    }
  });
});

describe("U-193: applyCleanup passes the store's lockLeft", () => {
  test("the lock held open at the cleanup's release: lockLeft in the outcome", { todo: "the store fills CleanupOutcome.lockLeft (nc-human's part of U-176's hand-off)", skip: windowsOnly }, async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const work = path.join(base, "work");
    const first = createCodarynApp(await appEnvironment(base));
    const started = await first.startRun(taskRequest(base));
    assert.ok(started.ok);
    await started.handle.done;
    let holder: { readonly closed: Promise<void> } | null = null;
    const app = createCodarynApp(await appEnvironment(base), {
      cleanupOperations: {
        remove: async (dir) => {
          await rm(dir, { recursive: true, force: true });
          if (holder === null) holder = await holdOpen(lockFile(work), 2500);
        },
      },
    });
    const selection = { runs: { runIds: [started.handle.runId] } };
    const preview = ok<CleanupPreview>(await app.previewCleanup({ workspace: work, selection }));
    const applied = ok<CleanupApplied>(await app.applyCleanup({ workspace: work, selection, now: preview.now, confirmation: { digest: preview.plan.digest, discarded: true, includeNotReverted: true } }));
    try {
      assert.equal(applied.status, "removed", JSON.stringify(applied));
      assert.equal((applied.outcome as { lockLeft?: boolean }).lockLeft, true);
    } finally {
      await (holder as { closed: Promise<void> } | null)?.closed;
      if (await exists(lockFile(work))) {
        const runId = (JSON.parse(await readFile(lockFile(work), "utf8")) as { runId: string }).runId;
        await releaseLock({ workspaceRoot: work, runId });
      }
    }
  });
});
