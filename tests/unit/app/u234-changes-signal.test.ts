/**
 * Unit U-234 (ne-verify's R-107 O-1, after U-213): the app's changes view passes the caller's signal
 * to its reads of the workspace.
 * U-213 made a guarded read try again during a burst of changes near its path, after waits of
 * GUARD_PAUSES_MS (750 ms in all) that end when the signal given to it is aborted. The changes view
 * (src/app/changes.ts) read each current file with no options, so nothing could end those waits: a
 * view asked for during a burst and given up meanwhile still waited up to 750 ms per file. Now
 * `changes` takes `{ signal }` (ChangesOptions) and hands it to every read of a current file.
 * A test hook wraps the workspace to see what each read is given; the burst is the guard's own
 * `retried` with a try that always sees a change, so the waits are the real ones. Reproduced first
 * (todo until the view passed the signal). Temporary folders, scripted model, fake values only.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, AppHooks, ChangesOutput, ChangesRequest, CodarynApp, RunHandle } from "../../../src/app/index.js";
import type { GuardedCallOptions, ReadTextOutcome, ResolvedPath, Workspace } from "../../../src/contracts/index.js";
import { retried } from "../../../src/workspace/guard.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { WRITE_NOTES, appEnvironment, setupRun, taskForm, taskRequest } from "./support.js";

const TODO = { todo: "U-234: the changes view passes the caller's signal to its reads" };

type Read = (target: ResolvedPath, options?: GuardedCallOptions) => Promise<ReadTextOutcome>;
/** A workspace whose readText is `read`, given the real one; everything else is the real workspace. */
const wrapping = (read: (real: Read) => Read) => async (root: string): Promise<Workspace> => {
  const real = await createWorkspace({ root });
  return { ...real, readText: read(real.readText.bind(real)) };
};
const hooksWith = (hooks: Record<string, unknown>): AppHooks => hooks as unknown as AppHooks;
/** `changes` with its second argument (ChangesOptions), as this unit gives it. */
const changesWith = (app: CodarynApp, request: ChangesRequest, options?: { signal?: AbortSignal }): Promise<AppCallOutcome<ChangesOutput>> =>
  (app.changes as unknown as (request: ChangesRequest, options?: { signal?: AbortSignal }) => Promise<AppCallOutcome<ChangesOutput>>)(request, options);

/** A run through the app that wrote NOTES.md; the app made with `hooks`. */
async function ranWith(hooks: Record<string, unknown>): Promise<{ readonly app: CodarynApp; readonly request: ChangesRequest }> {
  const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
  const app = createCodarynApp(await appEnvironment(base), hooksWith(hooks));
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok, JSON.stringify(started));
  const handle = (started as { handle: RunHandle }).handle;
  assert.ok((await handle.done).ok);
  return { app, request: { settings: taskForm(base), runId: handle.runId } };
}

function view(outcome: AppCallOutcome<ChangesOutput>): ChangesOutput {
  assert.ok(outcome.ok, JSON.stringify(outcome));
  return (outcome as { output: ChangesOutput }).output;
}

describe("U-234: the changes view and the caller's signal", () => {
  test("the signal given to changes reaches the read of each current file", TODO, async () => {
    const given: (AbortSignal | undefined)[] = [];
    const { app, request } = await ranWith({
      changesRead: { createWorkspace: wrapping((real) => (target, options) => (given.push(options?.signal), real(target, options))) },
    });
    const controller = new AbortController();
    const output = view(await changesWith(app, request, { signal: controller.signal }));
    assert.deepEqual(output.files.map((file) => [file.path, file.state]), [["NOTES.md", "as_run_left"]]);
    assert.equal(given.length, 1, "one current file read");
    assert.equal(given[0], controller.signal);
  });

  test("without a signal the reads get none, and the view is as before", TODO, async () => {
    const given: (GuardedCallOptions | undefined)[] = [];
    const { app, request } = await ranWith({
      changesRead: { createWorkspace: wrapping((real) => (target, options) => (given.push(options), real(target, options))) },
    });
    const output = view(await app.changes(request));
    assert.deepEqual(output.files.map((file) => [file.path, file.state, file.before, file.after]), [["NOTES.md", "as_run_left", null, "# Notes\n"]]);
    assert.equal(given.length, 1);
    assert.equal(given[0]?.signal, undefined);
  });

  test("a read in a burst ends once the signal is aborted, not after the guard's 750 ms of waits", TODO, async () => {
    // The guard's own retries, with a try that sees a change every time (a burst that never stops).
    const burst: Read = async (_target, options) => {
      const outcome = await retried(async () => "changed" as const, { signal: options?.signal });
      return outcome === "changed" ? { ok: false, code: "io_error" } : outcome;
    };
    const { app, request } = await ranWith({ changesRead: { createWorkspace: wrapping(() => burst) } });

    const waited = Date.now();
    const unbounded = view(await changesWith(app, request));
    const fullWait = Date.now() - waited;
    assert.ok(fullWait >= 700, `without a signal the waits run out (${fullWait} ms)`);

    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 30);
    const cancelled = view(await changesWith(app, request, { signal: controller.signal }));
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 400, `the wait ended at the abort (${elapsed} ms)`);
    for (const output of [unbounded, cancelled]) {
      assert.deepEqual(output.files.map((file) => [file.path, file.unavailable]), [["NOTES.md", "unreadable"]], "a file still changing is unreadable, as before");
    }
  });
});
