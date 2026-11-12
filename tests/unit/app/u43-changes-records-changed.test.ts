/**
 * Unit U-43 (U-32, the GUI owner's report): the app layer's `changes` says when the run has a
 * records-changed mark (DR-38). For a marked run the store gives no `shown` record, so no file text
 * is shown, only paths and states (contracts/state.ts); the output did not say why, so the GUI's
 * changes screen could not show the mark that `runs`, `report`, `revert` and `plan` show.
 * ChangesOutput now carries `recordsChanged: true` for a marked run, judged by the store's
 * hasRecordsChangedMark (the one `report` and `revert` use; a mark that cannot be checked counts,
 * fail closed), and nothing for a run without one. The CLI's `changes --json` prints the app's
 * output, so it carries it too.
 * Reproduced first (todo until the output carries it). Real runs through the app (scripted model),
 * the real store. Fake values only.
 */

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { RECORDS_CHANGED_FILE_NAME } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, ChangesOutput, CodarynApp } from "../../../src/app/index.js";
import { readChanges } from "../../../src/app/changes.js";
import type { ReadChangesDeps } from "../../../src/app/changes.js";
import { runChanges } from "../../../src/cli/changes.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { WRITE_NOTES, appEnvironment, runDir, setupRun, taskForm, taskRequest } from "./support.js";

const TODO = { todo: "U-43: the app layer's changes output does not carry recordsChanged yet" };

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

/** The output's recordsChanged field, whatever its type says. */
const markOf = (output: ChangesOutput): unknown => (output as unknown as Record<string, unknown>)["recordsChanged"];

/** A finished run that created NOTES.md, through the app; `marked` writes a records-changed mark afterwards. */
async function finishedRun(marked: boolean): Promise<{ base: string; app: CodarynApp; runId: string }> {
  const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok, JSON.stringify(started));
  await started.handle.done;
  if (marked) await writeFile(path.join(runDir(base, started.handle.runId), RECORDS_CHANGED_FILE_NAME), "{}", "utf8");
  return { base, app, runId: started.handle.runId };
}

describe("U-43 (DR-38): changes says when the run has a records-changed mark", () => {
  test("a marked run: recordsChanged is true", TODO, async () => {
    const run = await finishedRun(true);
    const output = ok<ChangesOutput>(await run.app.changes({ settings: taskForm(run.base), runId: run.runId }));
    assert.equal(markOf(output), true);
  });

  test("a marked run: its paths and states are listed, no text (as before)", async () => {
    const run = await finishedRun(true);
    const output = ok<ChangesOutput>(await run.app.changes({ settings: taskForm(run.base), runId: run.runId }));
    assert.deepEqual(
      output.files.map((file) => [file.path, file.state, file.before, file.after, file.unavailable]),
      [["NOTES.md", "as_run_left", null, null, "masking_unverified"]],
    );
  });

  test("a run without a mark: no recordsChanged field, its text shown (as before)", async () => {
    const run = await finishedRun(false);
    const output = ok<ChangesOutput>(await run.app.changes({ settings: taskForm(run.base), runId: run.runId }));
    assert.equal("recordsChanged" in output, false);
    assert.equal(output.files[0]?.after, "# Notes\n");
  });

  test("a mark that cannot be checked counts as one (fail closed)", TODO, async () => {
    const run = await finishedRun(false);
    const deps = { recordsChanged: async () => Promise.reject(new Error("cannot be checked")) } as unknown as ReadChangesDeps;
    const output = ok<ChangesOutput>(await readChanges(path.join(run.base, "work"), run.runId, createPrivacyGateway({ secrets: [] }), deps));
    assert.equal(markOf(output), true);
  });

  test("the CLI's changes --json prints it, as the app gives it", TODO, async () => {
    const run = await finishedRun(true);
    const outcome = await runChanges({ argv: ["changes", "--task", path.join(run.base, "task.json"), "--run", run.runId, "--json"], env: {}, app: run.app });
    assert.ok("text" in outcome, JSON.stringify(outcome));
    const json = JSON.parse(outcome.text) as Record<string, unknown>;
    assert.equal(json["recordsChanged"], true);
  });
});
