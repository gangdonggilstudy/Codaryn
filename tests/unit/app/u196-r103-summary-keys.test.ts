/**
 * Unit U-196, review R-103 M-1 (nc-human): a run plan's summary reaches the GUI through the app
 * (plan()) hidden as a plan of mode apply's summary is (R-49 R49-M1, planSummary in
 * src/cli/plan-commands.ts): the secrets registered now, then the current key and key-shaped text
 * (hideKeys with every API key value set now, knownKeyValues), then control characters (cleanText),
 * trimmed. The summary is the model's text, and the person reads it on the approval screen.
 * - The current key here is 17 characters: below MIN_OTHER_PROVIDER_KEY_LENGTH, so the scripted
 *   run does not register it as a secret and only the key hiding takes it out.
 * - The root is nc-human's changesPlanOutput (U-191: it masked the summary with the registered
 *   secrets only); it takes the current keys, and the app's view (changesPlanViewIn) gives them.
 * Reproduced first (6777b41, todo until the view hid them). Temporary folders, fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import { maskedParts } from "../../../src/contracts/index.js";
import { createPlanRecorder } from "../../../src/store/index.js";
import { FAKE_SECRET, SECRET_ENV, appEnvironment, setupRun, taskForm } from "./support.js";

const PLAN_RUN = "20261101T120000Z-0a1b2c3d";
/** Key shaped (sk-ant-…), fake; built from parts. */
const KEY_SHAPED = ["sk", "ant", "api03", "FAKE".repeat(20)].join("-");
/** The current key: 17 characters, not key shaped, not registered (MIN_OTHER_PROVIDER_KEY_LENGTH is 20). */
const CURRENT_KEY = ["Cur", "Plain", "Value", "1234"].join("");
const BEL = String.fromCharCode(7);

/** A run plan with `summary`, stored as the store writes it, with its plan run's records. */
async function storeRunPlan(base: string, summary: string): Promise<void> {
  const work = path.join(base, "work");
  const digest = await createPlanRecorder({ workspaceRoot: work, runId: PLAN_RUN }).saveChangesPlan!({
    summary: maskedParts(summary),
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
}

test("R-103 M-1: plan() gives a run plan's summary with keys, the current key and control characters hidden", async () => {
  const base = await setupRun({}, {}, []);
  await storeRunPlan(base, `  Use ${KEY_SHAPED} and ${CURRENT_KEY} here${BEL} and go  `);
  const app = createCodarynApp(await appEnvironment(base, { env: { [SECRET_ENV]: FAKE_SECRET, ANTHROPIC_API_KEY: CURRENT_KEY } }));
  const outcome = await app.plan({ settings: taskForm(base), runId: PLAN_RUN });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  const json = JSON.stringify(outcome);
  assert.equal(json.includes(KEY_SHAPED.slice(10)), false, "no part of the key shape");
  assert.equal(json.includes(CURRENT_KEY), false, "not the current key");
  assert.equal(json.includes(BEL), false, "no control character");
  const summary = (outcome as unknown as { output: { summary: string } }).output.summary;
  assert.equal(summary, "Use [key] and [key] here? and go", "as a plan of mode apply's summary (planSummary): hidden, cleaned, trimmed");
});

test("R-103 M-1: without a current key set, a key shape is still hidden", async () => {
  const base = await setupRun({}, {}, []);
  await storeRunPlan(base, `Use ${KEY_SHAPED} here`);
  const app = createCodarynApp(await appEnvironment(base));
  const outcome = await app.plan({ settings: taskForm(base), runId: PLAN_RUN });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal((outcome as unknown as { output: { summary: string } }).output.summary, "Use [key] here");
});
