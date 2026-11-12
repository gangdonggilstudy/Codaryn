/**
 * Review R-14 L-3 (docs/reviews/2026-11-12-r14-review-app-layer-additions.md), reproduction first:
 * the task form names a workflow (`--workflow`), so a plan can be applied on the quick form with the
 * plan's workflow and no profile. Fake values only; nothing is sent.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { writeFile } from "node:fs/promises";
import type { AppCallOutcome, TaskForm } from "../../../src/app/index.js";
import type { ApplyResult } from "../../../src/contracts/index.js";
import { exists, plannedRun } from "./support.js";

function code<T>(outcome: AppCallOutcome<T>): string | null {
  return outcome.ok ? null : outcome.error.code;
}

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

describe("R-14 L-3: the task form names a workflow", () => {
  test("a plan applied on the quick form with the plan's workflow, without a profile", async () => {
    const { base, app, plan, digest } = await plannedRun();
    const config = path.join(base, "quick-config.json");
    await writeFile(
      config,
      JSON.stringify({
        schemaVersion: 1,
        limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: 100_000, maxDurationMs: 60_000 },
        policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] },
      }),
      "utf8",
    );
    const settings = { input: { kind: "workspace", workspace: path.join(base, "work") }, configPath: config, varsFile: null, profile: null, workflowRef: "organize" } as TaskForm;
    const started = await app.applyPlan!({ settings, planRunId: plan.runId, digest: digest.slice(0, 12), cancelFile: null, unsafeMoveConsent: null });
    assert.ok(started.ok, JSON.stringify(started));
    const result = ok<ApplyResult>(await started.handle.done);
    assert.equal(result.kind, "apply");
    assert.equal(await exists(path.join(base, "work", "sorted", "a.txt")), true, "the move was made");
  });
});
