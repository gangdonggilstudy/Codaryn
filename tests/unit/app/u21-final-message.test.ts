/**
 * Unit U-21 (DR-47, AXM-1) through the app layer, the GUI's path: the agent's last message reaches
 * the GUI with the run's result (the run handle's `done` and the app's `report`), as the contract's
 * EngineResult.finalMessage: masked, cut at MAX_FINAL_MESSAGE_CHARS code points with `truncated`,
 * absent for a plan run and for an empty or white-space text. The app layer passes the result on as
 * it is; the label ("the agent's words, not a verified fact") is the GUI's and the CLI's.
 * Reproduced first (d4756db, todo); the engine writes the field now (99f10cc), with the text rules
 * of 15a9cd7 (LF, tabs kept, other control and invisible characters left out, key shapes as [key]). Real runs through the app (scripted
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

/** result.json has it; the report's reader (src/cli/report.ts readResult) keeps only the fields it knows. */
const REPORT_TODO = { todo: "U-21: wait for the CLI's report to keep finalMessage when it reads result.json" };

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
  test("the run handle's result carries it, masked", async () => {
    const { result } = await runEndingWith(`All done. Kept ${FAKE_SECRET} and ${FAKE_API_KEY} out of the notes; please check the list.`);
    assert.equal(result.status, "done", JSON.stringify(result));
    const message = result.finalMessage;
    assert.ok(message !== undefined, "the result has the agent's last message");
    assert.equal(message.truncated, false);
    assert.match(message.text, /^All done\. Kept .+ out of the notes; please check the list\.$/);
    assert.equal(message.text.includes(FAKE_SECRET), false, "a registered value is masked");
    assert.equal(message.text.includes(FAKE_API_KEY), false, "a key is masked");
  });

  test("the report's result (the run's result.json) carries the same", REPORT_TODO, async () => {
    const { app, workspace, runId, result } = await runEndingWith(`All done. Kept ${FAKE_SECRET} out of the notes.`);
    assert.ok(result.finalMessage !== undefined);
    const report = ok(await app.report({ workspace, runId }));
    assert.deepEqual(report.result?.finalMessage, result.finalMessage);
    assert.equal(JSON.stringify(report).includes(FAKE_SECRET), false);
  });

  test("a long last message is cut at MAX_FINAL_MESSAGE_CHARS code points and says so", async () => {
    const { result } = await runEndingWith(`${"가".repeat(MAX_FINAL_MESSAGE_CHARS)}${"😀".repeat(500)}`);
    const message = result.finalMessage;
    assert.ok(message !== undefined);
    assert.equal(message.truncated, true);
    assert.ok(codePoints(message.text) <= MAX_FINAL_MESSAGE_CHARS, String(codePoints(message.text)));
    assert.ok(message.text.startsWith("가".repeat(100)));
  });

  test("line breaks become LF and tabs stay; other control and invisible characters are left out (15a9cd7)", async () => {
    const { result } = await runEndingWith("line one\r\nline\ttwo\u0007\u200b end\u001b[31m");
    assert.deepEqual(result.finalMessage, { text: "line one\nline\ttwo end[31m", truncated: false });
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
