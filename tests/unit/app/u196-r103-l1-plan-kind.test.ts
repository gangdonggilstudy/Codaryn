/**
 * Unit U-196, review R-103 L-1 (nc-human): checkApply tells a run plan from a plan of mode apply by
 * the stored plan's kind (storedPlanKindOf on the store's loadAnyPlan). When the plan cannot be read
 * (plan.json damaged or gone, no such run), the kind is not known, and the check took it for a plan
 * of mode apply: with a task that does not resolve to plan "apply" it refused with run_not_plan about
 * the task, hiding the cause. Now storedPlanKindOf gives loadAnyPlan's code and checkApply gives it
 * first, as the plan view (the CLI's loadPlan, the same codes) does.
 * - With the apply task the codes were already loadAnyPlan's (through the plan view): unchanged.
 * Reproduced first (todo until the check gives the code). Temporary folders, fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import * as appModule from "../../../src/app/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome } from "../../../src/app/index.js";
import { maskedParts } from "../../../src/contracts/index.js";
import { createPlanRecorder } from "../../../src/store/index.js";
import { PLAN_TASK, appEnvironment, setupRun, taskForm } from "./support.js";

const TODO = { todo: "R-103 L-1: checkApply takes a plan it cannot read for a plan of mode apply" };
const PLAN_RUN = "20261101T120000Z-0a1b2c3d";
const OTHER_RUN = "20261101T140000Z-22222222";

const failure = (outcome: AppCallOutcome<unknown>): { code: string; message: string } => {
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  return (outcome as { error: { code: string; message: string } }).error;
};

/** A run plan stored in the workspace of `base` as the store writes it, with its plan run's records; its digest. */
async function storeRunPlan(base: string): Promise<string> {
  const work = path.join(base, "work");
  const digest = await createPlanRecorder({ workspaceRoot: work, runId: PLAN_RUN }).saveChangesPlan!({
    summary: maskedParts("Tidy the guide."),
    files: [{ path: "docs/CHANGELOG.md", change: "create", sha256: null, shown: maskedParts("docs/CHANGELOG.md") }],
  });
  const dir = path.join(work, ".codaryn", "runs", PLAN_RUN);
  await mkdir(dir, { recursive: true });
  const started = { seq: 1, at: "2026-11-01T12:00:01.000Z", runId: PLAN_RUN, type: "run_started", schemaVersion: 1, taskId: "app-task", workflow: "write", provider: "scripted", limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: null, maxDurationMs: 1000 } };
  const finished = { seq: 2, at: "2026-11-01T12:00:02.000Z", runId: PLAN_RUN, type: "run_finished", status: "needs-input", reason: "plan_pending", usage: { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 1, repairAttempts: 0 } };
  await writeFile(path.join(dir, "journal.jsonl"), `${JSON.stringify(started)}\n${JSON.stringify(finished)}\n`);
  const result = {
    schemaVersion: 1, kind: "run", runId: PLAN_RUN, taskId: "app-task", status: "needs-input", reason: "plan_pending", exitCode: 3, provider: "scripted", verifiers: [], changes: [],
    usage: { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 1 }, journalPath: `.codaryn/runs/${PLAN_RUN}/journal.jsonl`, notices: [],
    plan: { digest, actions: 1, kind: "changes" },
  };
  await writeFile(path.join(dir, "result.json"), `${JSON.stringify(result)}\n`);
  return digest;
}

const planFile = (base: string): string => path.join(base, "work", ".codaryn", "runs", PLAN_RUN, "plan.json");

/** checkApply's refusal for the plan of `runId`, with the default task (no plan setting) or the apply task. */
async function refusal(task: Readonly<Record<string, unknown>>, damage: (base: string) => Promise<void>, runId = PLAN_RUN): Promise<{ code: string; message: string }> {
  const base = await setupRun({}, task, []);
  const digest = await storeRunPlan(base);
  await damage(base);
  const app = createCodarynApp(await appEnvironment(base));
  return failure(await app.checkApply({ settings: taskForm(base), planRunId: runId, digest }));
}

const DAMAGES = [
  ["plan.json damaged", (base: string) => writeFile(planFile(base), "{"), PLAN_RUN, "invalid_run_record"],
  ["plan.json gone", (base: string) => rm(planFile(base)), PLAN_RUN, "plan_run_missing"],
  ["no such run", async () => undefined, OTHER_RUN, "run_not_found"],
] as const;

describe("R-103 L-1: a plan checkApply cannot read gives the store's code first", () => {
  for (const [name, damage, runId, code] of DAMAGES) {
    test(`${name}, a task without plan "apply": ${code}, not run_not_plan about the task`, TODO, async () => {
      const error = await refusal({}, damage, runId);
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /resolve to a workflow/);
    });

    test(`${name}, the apply task: ${code} as before`, async () => {
      assert.equal((await refusal(PLAN_TASK, damage, runId)).code, code);
    });
  }

  test("storedPlanKindOf gives the kind, or loadAnyPlan's code", TODO, async () => {
    const kindOf = (appModule as unknown as Record<string, (root: string, runId: string) => Promise<unknown>>)["storedPlanKindOf"] as (root: string, runId: string) => Promise<unknown>;
    const base = await setupRun({}, {}, []);
    await storeRunPlan(base);
    const work = path.join(base, "work");
    assert.deepEqual(await kindOf(work, PLAN_RUN), { ok: true, kind: "changes" });
    assert.deepEqual(await kindOf(work, OTHER_RUN), { ok: false, code: "run_not_found" });
    await writeFile(planFile(base), "{");
    assert.deepEqual(await kindOf(work, PLAN_RUN), { ok: false, code: "invalid_run_record" });
  });
});
