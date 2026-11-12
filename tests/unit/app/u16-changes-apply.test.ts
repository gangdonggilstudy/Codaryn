/**
 * Unit U-16 (UXM-4), the app layer's part: `changes` of an apply run says it is one. An apply run's
 * moves and discards are its plan's actions, not file writes of its own, so its `files` is empty and
 * the view read "no file changed". The app's ChangesOutput now carries `applyRun` (the contract's
 * ChangesApplyRun: the plan run it applied and how many actions it applied), for an apply run only,
 * judged as the run list judges it. Reproduced first, todo until the app layer follows the contract.
 * Real runs through the app (scripted model), the real store. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, ChangesOutput, CodarynApp } from "../../../src/app/index.js";
import { WRITE_NOTES, appEnvironment, setupRun, taskForm, taskRequest } from "./support.js";

const TODO = { todo: "U-16: wait for the app's ChangesOutput to carry applyRun" };

/** ChangesOutput before U-16 has no applyRun; read it loosely until it does. */
const applyRunOf = (output: ChangesOutput): unknown => (output as { applyRun?: unknown }).applyRun;

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

const ORGANIZE = { workflowRef: "organize", policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move", "discard"] }, verifiers: [] };

/** A plan that moves a.txt and discards c.log, applied through the app. */
async function appliedPlan(): Promise<{ base: string; app: CodarynApp; planRunId: string; applyRunId: string }> {
  const base = await setupRun({ "a.txt": "a\n", "c.log": "old log\n" }, ORGANIZE, [
    {
      toolCalls: [
        {
          name: "propose_plan",
          args: { summary: "tidy", actions: [{ kind: "move", from: "a.txt", to: "docs/a.txt" }, { kind: "discard", path: "c.log" }] },
        },
      ],
    },
  ]);
  const app = createCodarynApp(await appEnvironment(base));
  const planned = await app.startRun(taskRequest(base));
  assert.ok(planned.ok, JSON.stringify(planned));
  const plan = await planned.handle.done;
  assert.ok(plan.ok && plan.result.plan !== undefined, JSON.stringify(plan));
  const applied = await app.applyPlan({ settings: taskForm(base), planRunId: plan.result.runId, digest: plan.result.plan.digest, cancelFile: null, unsafeMoveConsent: null });
  assert.ok(applied.ok, JSON.stringify(applied));
  const done = await applied.handle.done;
  assert.ok(done.ok, JSON.stringify(done));
  return { base, app, planRunId: plan.result.runId, applyRunId: applied.handle.runId };
}

describe("U-16 (UXM-4): changes of an apply run says it is one", () => {
  test("an apply run: applyRun names its plan run and the actions applied; no file writes of its own", TODO, async () => {
    const run = await appliedPlan();
    const output = ok<ChangesOutput>(await run.app.changes({ settings: taskForm(run.base), runId: run.applyRunId }));
    assert.deepEqual(output.files, []);
    assert.deepEqual(applyRunOf(output), { planRunId: run.planRunId, actions: 2 });
  });

  test("the plan run it applied has no applyRun", async () => {
    const run = await appliedPlan();
    const output = ok<ChangesOutput>(await run.app.changes({ settings: taskForm(run.base), runId: run.planRunId }));
    assert.equal(applyRunOf(output), undefined);
  });

  test("a model run has no applyRun and lists its file writes", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.ok(started.ok, JSON.stringify(started));
    await started.handle.done;
    const output = ok<ChangesOutput>(await app.changes({ settings: taskForm(base), runId: started.handle.runId }));
    assert.equal(applyRunOf(output), undefined);
    assert.deepEqual(output.files.map((file) => file.path), ["NOTES.md"]);
  });
});
