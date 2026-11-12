/**
 * DR-14: the run list, `latest` and the revert dry run in the app layer, on main's N-7 store
 * functions; DR-17: the task form. Which runs are listed and which one `latest` names is the
 * store's decision (N-18, N-23), so these cases only use runs every version of those rules agrees
 * on, and check that the app layer gives the store's answer. Scripted model, fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import type { EngineResult, RevertOutput, RunsOutput } from "../../../src/contracts/index.js";
import { latestRunId } from "../../../src/store/index.js";
import { PROBE_GOAL, createCodarynApp, runRequestOf } from "../../../src/app/index.js";
import type { AppCallOutcome, CodarynApp, ResolvedRun, RunHandle } from "../../../src/app/index.js";
import { WRITE_NOTES, appEnvironment, exists, runDir, setupRun, taskForm, taskRequest } from "./support.js";

const WAIT = { text: "waiting", delayMs: 30_000 };

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

function code<T>(outcome: AppCallOutcome<T>): string | null {
  return outcome.ok ? null : outcome.error.code;
}

async function runOnce(app: CodarynApp, base: string): Promise<EngineResult> {
  const started = await app.startRun(taskRequest(base));
  assert.equal(started.ok, true, JSON.stringify(started));
  const outcome = await (started as { handle: RunHandle }).handle.done;
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { result: EngineResult }).result;
}

/** One workspace with two finished runs; returns their ids, older first. */
async function twoRuns(): Promise<{ base: string; app: CodarynApp; older: string; newer: string }> {
  const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
  const app = createCodarynApp(await appEnvironment(base));
  const older = (await runOnce(app, base)).runId;
  await new Promise((resolve) => setTimeout(resolve, 20));
  const newer = (await runOnce(app, base)).runId;
  return { base, app, older, newer };
}

describe("listRuns (N-7)", () => {
  test("lists the store's runs newest first, honours the limit, and refuses a bad one", async () => {
    const { base, app, older, newer } = await twoRuns();
    const workspace = path.join(base, "work");
    const all = ok<RunsOutput>(await app.listRuns({ workspace }));
    assert.deepEqual([all.kind, all.status, all.exitCode, all.omitted], ["runs", "listed", 0, 0]);
    assert.deepEqual(all.runs.map((run) => run.runId), [newer, older]);
    const first = all.runs[0];
    assert.ok(first !== undefined && first.state === "checked" && first.status === "done");

    const one = ok<RunsOutput>(await app.listRuns({ workspace, limit: 1 }));
    assert.deepEqual([one.runs.map((run) => run.runId), one.omitted], [[newer], 1]);
    assert.equal(code(await app.listRuns({ workspace, limit: 0 })), "invalid_arguments");

    const empty = await setupRun({}, {}, []);
    assert.deepEqual(ok<RunsOutput>(await app.listRuns({ workspace: path.join(empty, "work") })).runs, []);
    assert.equal(code(await app.listRuns({ workspace: path.join(empty, "absent") })), "workspace_not_found");
  });
});

describe("latest (N-7, N-18, N-23 b)", () => {
  test("names the run the store names, with its start time", async () => {
    const { base, app, newer } = await twoRuns();
    const workspace = path.join(base, "work");
    const resolved = ok<ResolvedRun>(await app.resolveRun({ workspace, run: "latest" }));
    assert.equal(resolved.runId, await latestRunId(await realpath(workspace)), "the store's latest");
    assert.deepEqual([resolved.runId, resolved.latest, resolved.damaged], [newer, true, false]);
    assert.ok(resolved.startedAt !== null && Number.isFinite(Date.parse(resolved.startedAt)));

    const report = ok(await app.report({ workspace, runId: "latest" }));
    assert.equal((report as { runId: string }).runId, newer);
  });

  test("a run directory named latest makes the alias ambiguous; no run means run_not_found; a bad id is refused", async () => {
    const { base, app } = await twoRuns();
    const workspace = path.join(base, "work");
    await mkdir(path.join(workspace, ".codaryn", "runs", "latest"));
    assert.equal(code(await app.resolveRun({ workspace, run: "latest" })), "invalid_arguments");
    assert.equal(code(await app.revert({ workspace, runId: "latest", dryRun: true })), "invalid_arguments");

    const empty = await setupRun({}, {}, []);
    assert.equal(code(await app.resolveRun({ workspace: path.join(empty, "work"), run: "latest" })), "run_not_found");
    assert.equal(code(await app.report({ workspace: path.join(empty, "work"), runId: "latest" })), "run_not_found");
    assert.equal(code(await app.resolveRun({ workspace, run: "../outside" })), "invalid_arguments");
  });
});

describe("revert with dry run and the revert record (N-7)", () => {
  test("a dry run changes nothing and writes no record; the revert does and the list shows it", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base));
    const runId = (await runOnce(app, base)).runId;
    const workspace = path.join(base, "work");
    const notes = path.join(workspace, "NOTES.md");
    const record = path.join(runDir(base, runId), "revert.json");

    const preview = ok<RevertOutput>(await app.revert({ workspace, runId: "latest", dryRun: true }));
    assert.deepEqual([preview.runId, preview.dryRun, preview.status, preview.exitCode], [runId, true, "complete", 0]);
    assert.deepEqual(preview.reverted, [{ path: "NOTES.md", action: "deleted" }]);
    assert.equal(await exists(notes), true, "a dry run changes nothing");
    assert.equal(await exists(record), false, "a dry run writes no revert record");
    assert.equal(preview.revertedBefore, undefined);

    const done = ok<RevertOutput>(await app.revert({ workspace, runId }));
    assert.deepEqual([done.dryRun, done.status], [undefined, "complete"]);
    assert.equal(await exists(notes), false);
    const stored = JSON.parse(await readFile(record, "utf8")) as { kind: string; status: string; reverted: number; skipped: number };
    assert.deepEqual([stored.kind, stored.status, stored.reverted, stored.skipped], ["revert_record", "complete", 1, 0]);
    const listed = ok<RunsOutput>(await app.listRuns({ workspace })).runs[0];
    assert.ok(listed !== undefined && listed.state === "checked" && listed.reverted?.status === "complete");

    const again = ok<RevertOutput>(await app.revert({ workspace, runId, dryRun: true }));
    assert.equal(again.revertedBefore?.status, "complete", "the earlier revert is reported");
    // N-22: the CLI's revert names an already reverted file as such.
    assert.deepEqual(again.skipped.map((file) => file.reason), ["already_reverted"]);
    assert.equal(await exists(path.join(workspace, ".codaryn", "lock.json")), false);
  });

  test("a revert waits for no running task: it is refused while one holds the lock, a dry run is not", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base));
    const runId = (await runOnce(app, base)).runId;
    const busy = await setupRun({}, {}, [WAIT]);
    // A second task on the same workspace keeps the lock while it waits.
    const busyTask = path.join(busy, "task.json");
    const text = JSON.parse(await readFile(busyTask, "utf8")) as Record<string, unknown>;
    await writeFile(busyTask, JSON.stringify({ ...text, workspaceRoot: path.join(base, "work") }), "utf8");
    const running = await app.startRun({ ...taskRequest(busy) });
    assert.equal(running.ok, true, JSON.stringify(running));
    const handle = (running as { handle: RunHandle }).handle;

    const workspace = path.join(base, "work");
    assert.equal(code(await app.revert({ workspace, runId })), "workspace_locked");
    assert.equal(ok<RevertOutput>(await app.revert({ workspace, runId, dryRun: true })).dryRun, true);
    assert.equal(await exists(path.join(workspace, "NOTES.md")), true);

    handle.cancel();
    await handle.done;
  });
});

describe("DR-17: the task form", () => {
  test("maps to the run settings that register the same secrets, with no goal of its own", () => {
    assert.deepEqual(runRequestOf(taskForm("/base", { configPath: "c.json", varsFile: "v.env" })), {
      input: { kind: "task", taskPath: path.join("/base", "task.json") },
      configPath: "c.json",
      varsFile: "v.env",
      profile: null,
      workflowRef: null,
      cancelFile: null,
    });
    assert.deepEqual(runRequestOf({ input: { kind: "workspace", workspace: "w" }, configPath: null, varsFile: null, profile: "doc", workflowRef: null }).input, {
      kind: "quick",
      workspace: "w",
      goal: PROBE_GOAL,
    });
  });

  test("changes takes latest", async () => {
    const { base, app, newer } = await twoRuns();
    const view = ok(await app.changes({ settings: taskForm(base), runId: "latest" }));
    assert.equal((view as { runId: string }).runId, newer);
  });
});
