/**
 * G-A: a task without `workflowRef` and without the workflow fields is interpreted exactly as
 * before stage 4. These cases pin the legacy interpretation at three layers:
 * - the contract defaults (LEGACY_WORKFLOW_SETTINGS, workflowSettingsOf),
 * - the real task parsers on the shipped example tasks and the quick form,
 * - the engine's first model request, run_started record and result for such a task.
 * The engine cases describe today's behaviour; the stage 4 engine (G-B) must keep them passing.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  LEGACY_WORKFLOW_SETTINGS,
  QUICK_TASK_WORKFLOW,
  TOOL_NAMES,
  workflowSettingsOf,
} from "../../../src/contracts/index.js";
import type { CodarynConfig, ResolvedTaskSpec } from "../../../src/contracts/index.js";
import { buildQuickTask, parseTask } from "../../../src/cli/task.js";
import { SYSTEM_PROMPT, runTask } from "../../../src/engine/index.js";
import { finalAnswer, harness } from "../engine/fakes.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Every task field stage 4 adds (TaskSpec and ResolvedTaskSpec). None may appear on a legacy task. */
const WORKFLOW_TASK_FIELDS = ["workflowRef", "tools", "instructions", "plan", "completion", "humanReview"] as const;

const LEGACY = {
  tools: [...TOOL_NAMES],
  instructions: null,
  plan: "none",
  completion: "verifiers",
  humanReview: null,
};

function exampleTask(relative: string): ResolvedTaskSpec {
  const file = path.join(REPO_ROOT, relative);
  const parsed = parseTask(JSON.parse(readFileSync(file, "utf8")) as unknown, path.dirname(file));
  assert.ok(parsed.ok, `${relative} parses: ${parsed.ok ? "" : parsed.message}`);
  return parsed.task;
}

function assertLegacyTask(task: ResolvedTaskSpec, label: string): void {
  for (const field of WORKFLOW_TASK_FIELDS) {
    assert.equal(Object.hasOwn(task, field), false, `${label}: ${field} is not set`);
  }
  assert.equal(Object.hasOwn(task.policy, "planActions"), false, `${label}: policy.planActions is not set`);
  assert.deepEqual({ ...workflowSettingsOf(task), tools: [...workflowSettingsOf(task).tools] }, LEGACY, label);
}

describe("G-A legacy interpretation: contract defaults", () => {
  test("the legacy settings are the four built-in tools, no instructions, no plan, verifiers decide", () => {
    assert.deepEqual({ ...LEGACY_WORKFLOW_SETTINGS, tools: [...LEGACY_WORKFLOW_SETTINGS.tools] }, LEGACY);
    assert.ok(Object.isFrozen(LEGACY_WORKFLOW_SETTINGS));
  });

  test("the legacy tools are exactly what the engine offers today, in the same order", () => {
    // engine/index.ts passes TOOL_NAMES to every model request; the legacy setting must equal it.
    assert.strictEqual(LEGACY_WORKFLOW_SETTINGS.tools, TOOL_NAMES);
  });

  test("workflowSettingsOf takes each field the task sets and the legacy value for the rest", () => {
    const base = exampleTask("examples/doc-task.json");
    const narrowed = workflowSettingsOf({ ...base, tools: ["read_file"] });
    assert.deepEqual(narrowed.tools, ["read_file"]);
    assert.equal(narrowed.plan, "none");
    assert.equal(narrowed.completion, "verifiers");
    assert.equal(narrowed.instructions, null);
    assert.equal(narrowed.humanReview, null);

    const review = workflowSettingsOf({ ...base, completion: "human_review", humanReview: { checklist: ["read it"] } });
    assert.equal(review.completion, "human_review");
    assert.deepEqual(review.humanReview, { checklist: ["read it"] });
    assert.deepEqual([...review.tools], [...TOOL_NAMES]);

    const nullInstructions = workflowSettingsOf({ ...base, instructions: null });
    assert.equal(nullInstructions.instructions, null);
  });
});

describe("G-A legacy interpretation: the real task parsers", () => {
  for (const relative of ["examples/doc-task.json", "examples/code-task.json", "examples/demo/task.json"]) {
    test(`${relative} resolves without workflow fields and to the legacy settings`, () => {
      assertLegacyTask(exampleTask(relative), relative);
    });
  }

  test("the quick form resolves without workflow fields and to the legacy settings", () => {
    const config: CodarynConfig = {
      schemaVersion: 1,
      limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 1000, maxDurationMs: 60_000 },
    };
    const built = buildQuickTask({ workspace: "work", goal: "tidy the notes", cwd: REPO_ROOT, config });
    assert.ok(built.ok, built.ok ? "" : built.message);
    assert.equal(built.task.workflow, QUICK_TASK_WORKFLOW);
    assertLegacyTask(built.task, "quick form");
  });
});

describe("G-A legacy interpretation: what the engine does with a legacy task", () => {
  test("the model is offered the four built-in tools and no workflow tool", async () => {
    const run = harness({ steps: [() => finalAnswer()] });
    await runTask(run.deps);
    const [first] = run.model.requests;
    assert.ok(first !== undefined);
    assert.deepEqual([...first.tools], [...TOOL_NAMES]);
    assert.equal(first.workflowTools === undefined || first.workflowTools.length === 0, true);
  });

  test("the system text is the fixed system prompt alone (no instructions appended)", async () => {
    const run = harness({ steps: [() => finalAnswer()] });
    await runTask(run.deps);
    assert.equal(run.model.requests[0]?.system, SYSTEM_PROMPT);
    const [request] = run.journal.ofType("model_request");
    assert.equal(request?.system, SYSTEM_PROMPT);
  });

  test("run_started carries no workflow fields", async () => {
    const run = harness({ steps: [() => finalAnswer()] });
    await runTask(run.deps);
    const [started] = run.journal.ofType("run_started");
    assert.ok(started !== undefined);
    for (const field of ["workflowRef", "tools", "plan", "completion"]) {
      assert.equal(Object.hasOwn(started, field), false, field);
    }
  });

  test("passing verifiers end as done/verified with no plan or review in the result", async () => {
    const run = harness({ steps: [() => finalAnswer()] });
    const result = await runTask(run.deps);
    assert.equal(result.status, "done");
    assert.equal(result.reason, "verified");
    assert.equal(Object.hasOwn(result, "plan"), false);
    assert.equal(Object.hasOwn(result, "review"), false);
  });

  test("no verifier still ends as needs-input/no_verifier, not as a review", async () => {
    const run = harness({ steps: [() => finalAnswer()], task: { verifiers: [] } });
    const result = await runTask(run.deps);
    assert.equal(result.status, "needs-input");
    assert.equal(result.reason, "no_verifier");
    assert.equal(Object.hasOwn(result, "review"), false);
  });
});
