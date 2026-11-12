/**
 * Unit U-25 (DR-52, AXM-17) through the app layer, the GUI's path: whether masking worked reaches the
 * GUI with the run's result (the run handle's `done` and the app's `report`), as the contract's
 * EngineResult.masking: counts only (values registered, places masked in what the model got),
 * never a value, a place or a length; absent when nothing was registered. "Nothing to mask"
 * (registered, 0 places) and "nothing registered" (absent) are told apart.
 * The app layer makes the run's gateway with createPrivacyGateway (assemble.ts) and passes the
 * result on as it is. Reproduced first, todo until the gateway says how many values it holds
 * (PrivacyGateway.registeredValues). Real runs through the app (scripted model), the real store.
 * Fake values only.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import type { EngineResult } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, CodarynApp } from "../../../src/app/index.js";
import { FAKE_SECRET, WRITE_NOTES, appEnvironment, setupRun, taskRequest } from "./support.js";

const TODO = { todo: "U-25: wait for createPrivacyGateway to set registeredValues" };
/** The report's reader (src/cli/report.ts readResult) keeps only the result.json fields it knows (seen with U-21's finalMessage). */
const REPORT_TODO = { todo: "U-25: wait for the gateway's registeredValues and the CLI's report to keep masking" };

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

const READ_NOTES = { toolCalls: [{ name: "read_file", args: { path: "notes.txt" } }] };

/** A run through the app that reads notes.txt (holding `notes`), writes NOTES.md and ends. */
async function run(notes: string, task: Readonly<Record<string, unknown>> = {}): Promise<{ app: CodarynApp; workspace: string; runId: string; result: EngineResult }> {
  const base = await setupRun({ "notes.txt": notes }, task, [READ_NOTES, WRITE_NOTES, { text: "done" }]);
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok, JSON.stringify(started));
  const done = await started.handle.done;
  assert.ok(done.ok, JSON.stringify(done));
  return { app, workspace: path.join(base, "work"), runId: started.handle.runId, result: done.result };
}

describe("U-25 (DR-52): the masking counts reach the GUI with the result", () => {
  test("a registered value the model's input held: one value registered, one place masked, counts only", TODO, async () => {
    const { result } = await run(`the token is ${FAKE_SECRET}\n`);
    assert.deepEqual(result.masking, { registeredValues: 1, maskedPlaces: 1 });
    assert.equal(JSON.stringify(result).includes(FAKE_SECRET), false);
  });

  test("the report's result (the run's result.json) says the same", REPORT_TODO, async () => {
    const { app, workspace, runId, result } = await run(`the token is ${FAKE_SECRET}\n`);
    assert.ok(result.masking !== undefined);
    const report = ok(await app.report({ workspace, runId }));
    assert.deepEqual(report.result?.masking, result.masking);
  });

  test("a registered value nothing held: registered, nothing to mask", TODO, async () => {
    const { result } = await run("nothing secret here\n");
    assert.deepEqual(result.masking, { registeredValues: 1, maskedPlaces: 0 });
  });

  test("nothing registered: no counts at all", async () => {
    const { result } = await run("nothing secret here\n", { privacy: { secretEnv: [] } });
    assert.equal(result.masking, undefined);
  });
});
