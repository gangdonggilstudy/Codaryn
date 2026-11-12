/**
 * Unit U-21 (DR-47, AXM-1) through the app layer, the GUI's path: the agent's last message reaches
 * the GUI with the run's result (the run handle's `done` and the app's `report`), as the contract's
 * EngineResult.finalMessage: masked, cut at MAX_FINAL_MESSAGE_CHARS code points with `truncated`,
 * absent for a plan run and for an empty or white-space text. The app layer passes the result on as
 * it is; the label ("the agent's words, not a verified fact") is the GUI's and the CLI's.
 * Reproduced first, todo until the engine writes the field. Real runs through the app (scripted
 * model), the real store. Fake values only.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { API_PROVIDERS, MAX_FINAL_MESSAGE_CHARS } from "../../../src/contracts/index.js";
import type { EngineResult } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, CodarynApp } from "../../../src/app/index.js";
import { FAKE_API_KEY } from "../../fixtures/secrets.js";
import { FAKE_SECRET, WRITE_NOTES, appEnvironment, setupRun, taskRequest } from "./support.js";

const TODO = { todo: "U-21: wait for the engine to write EngineResult.finalMessage" };

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

/** A run that writes NOTES.md and then ends with `last` as its final text, through the app. */
async function runEndingWith(last: string): Promise<{ app: CodarynApp; workspace: string; runId: string; result: EngineResult }> {
  const base = await setupRun({}, {}, [WRITE_NOTES, { text: last }]);
  const environment = await appEnvironment(base);
  const app = createCodarynApp({ ...environment, env: { ...environment.env, [API_PROVIDERS.anthropic.keyEnv]: FAKE_API_KEY } });
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok, JSON.stringify(started));
  const done = await started.handle.done;
  assert.ok(done.ok, JSON.stringify(done));
  return { app, workspace: path.join(base, "work"), runId: started.handle.runId, result: done.result };
}

const codePoints = (text: string): number => [...text].length;

describe("U-21 (DR-47): the agent's last message reaches the GUI with the result", () => {
  test("the run handle's result and the report carry it, masked", TODO, async () => {
    const { app, workspace, runId, result } = await runEndingWith(`All done. Kept ${FAKE_SECRET} and ${FAKE_API_KEY} out of the notes; please check the list.`);
    assert.equal(result.status, "done", JSON.stringify(result));
    const message = result.finalMessage;
    assert.ok(message !== undefined, "the result has the agent's last message");
    assert.equal(message.truncated, false);
    assert.match(message.text, /^All done\. Kept .+ out of the notes; please check the list\.$/);
    assert.equal(message.text.includes(FAKE_SECRET), false, "a registered value is masked");
    assert.equal(message.text.includes(FAKE_API_KEY), false, "a key is masked");
    // The report (the run's result.json) gives the same, as the app passes it on.
    const report = ok(await app.report({ workspace, runId }));
    assert.deepEqual(report.result?.finalMessage, message);
    assert.equal(JSON.stringify(report).includes(FAKE_SECRET), false);
  });

  test("a long last message is cut at MAX_FINAL_MESSAGE_CHARS code points and says so", TODO, async () => {
    const { result } = await runEndingWith(`${"가".repeat(MAX_FINAL_MESSAGE_CHARS)}${"😀".repeat(500)}`);
    const message = result.finalMessage;
    assert.ok(message !== undefined);
    assert.equal(message.truncated, true);
    assert.ok(codePoints(message.text) <= MAX_FINAL_MESSAGE_CHARS, String(codePoints(message.text)));
    assert.ok(message.text.startsWith("가".repeat(100)));
  });

  test("an empty or white-space last text gives no final message", async () => {
    const { result } = await runEndingWith(" \n\t ");
    assert.equal(result.finalMessage, undefined);
  });

  test("a plan run has none: its place is the plan's summary", async () => {
    const base = await setupRun({ "c.log": "old log\n" }, { workflowRef: "organize", policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["discard"] }, verifiers: [] }, [
      { toolCalls: [{ name: "propose_plan", args: { summary: "drop the log", actions: [{ kind: "discard", path: "c.log" }] } }] },
      { text: "I proposed a plan." },
    ]);
    const app = createCodarynApp(await appEnvironment(base));
    const planned = await app.startRun(taskRequest(base));
    assert.ok(planned.ok, JSON.stringify(planned));
    const done = await planned.handle.done;
    assert.ok(done.ok && done.result.reason === "plan_pending", JSON.stringify(done));
    assert.equal(done.result.finalMessage, undefined);
  });
});
