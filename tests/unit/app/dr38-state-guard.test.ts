/**
 * DR-38, the app layer's part (as the CLI's, b8c9c1d): the app's own assembly (createAppAssemble)
 * makes the run's journal, change recorder and plan recorder with the store's createRunRecorders
 * and passes its stateGuard as EngineDeps.stateGuard, so the guard knows what the run wrote: the
 * run's own journal line is no change, a line added by anything else is. Real assembly, store and
 * engine; scripted model; nothing is sent. Fake values only.
 */

import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { JOURNAL_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { EngineDeps, JournalEvent } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import { WRITE_NOTES, appEnvironment, setupRun, taskRequest } from "./support.js";

describe("DR-38: the app's run gives the engine its state guard", () => {
  test("EngineDeps.stateGuard knows the run's own journal line and finds a foreign one", async () => {
    const base = await setupRun({}, {}, [{ text: "done" }]);
    let checked = false;
    const app = createCodarynApp(await appEnvironment(base), {
      runTask: async (deps: EngineDeps) => {
        const guard = deps.stateGuard;
        assert.ok(guard !== undefined, "the app passes no stateGuard to the engine");
        const before = await guard.capture("run");
        await deps.journal.append({ type: "model_request", turn: 1, system: null, messages: [], tools: [] } as unknown as JournalEvent);
        const own = await guard.capture("run");
        assert.deepEqual(guard.compare(before, own).changed, [], "the run's own journal line is no change");
        const workspaceRoot = path.join(base, "work");
        await appendFile(path.join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME, deps.runId, JOURNAL_FILE_NAME), '{"type":"foreign"}\n', "utf8");
        const foreign = await guard.capture("run");
        assert.deepEqual(guard.compare(own, foreign).changed, [`${RUNS_DIR_NAME}/${deps.runId}/${JOURNAL_FILE_NAME}`]);
        checked = true;
        return runTask(deps);
      },
    });
    const started = await app.startRun(taskRequest(base));
    assert.ok(started.ok, JSON.stringify(started));
    await started.handle.done;
    assert.equal(checked, true);
  });

  test("a run through the app with the guard ends as before when nothing else writes", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const started = await createCodarynApp(await appEnvironment(base)).startRun(taskRequest(base));
    assert.ok(started.ok);
    const ended = await started.handle.done;
    assert.ok(ended.ok, JSON.stringify(ended));
    assert.equal(ended.result.reason === "state_changed", false, JSON.stringify(ended.result));
    assert.equal(ended.result.status, "done");
  });
});
