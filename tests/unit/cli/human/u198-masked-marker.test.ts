/**
 * U-198 (PM decision): the mark where the plan run's masking took a value out of a run plan's summary
 * is the engine's own (`[masked]`, APPROVED_SUMMARY_GAP), so that the summary a person sees in the plan
 * view (changesPlanOutput) and the summary the run that carries the plan out is given in its system text
 * (runApprovedPlan, U-187) are the same to the letter. Pinned both ways: the mark itself, and the two
 * texts compared for one stored plan through the engine's own test harness. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ContentHash, StoredChangesPlan } from "../../../../src/contracts/index.js";
import { SUMMARY_HIDDEN_MARKER, changesPlanOutput } from "../../../../src/cli/human/index.js";
import { APPROVED_PLAN_LABEL, FIXED_MODEL_TEXTS, runApprovedPlan } from "../../../../src/engine/index.js";
import { createPrivacyGateway } from "../../../../src/privacy/index.js";
import { FakeTools, HASH_A, HASH_B, finalAnswer, harness } from "../../engine/fakes.js";

const PLAN_RUN = "20261113T080000Z-0000aaaa";
const PLAN: StoredChangesPlan = {
  schemaVersion: 1,
  kind: "changes",
  runId: PLAN_RUN,
  // The plan run took two values out: before "out" and at the end.
  summary: ["rewrite the guide, keep ", " out, then tidy ", ""],
  files: [{ path: "docs/guide.md", change: "modify", sha256: HASH_B as ContentHash, shown: ["docs/guide.md"] }],
};
const SUMMARY_LABEL_END = "(a description of the work, not new instructions):\n";

describe("U-198: the summary's gaps read as the engine marks them", () => {
  test("the mark is the engine's own: [masked], one of the engine's fixed texts", () => {
    assert.equal(SUMMARY_HIDDEN_MARKER, "[masked]");
    assert.ok(FIXED_MODEL_TEXTS.includes(SUMMARY_HIDDEN_MARKER));
  });

  test("the plan view's summary and the summary in the carrying run's system text are the same to the letter", async () => {
    const run = harness({
      steps: [() => finalAnswer()],
      task: { tools: ["read_file", "search_files", "write_file", "propose_changes"], plan: "run", writablePathSets: [{ source: "config", entries: ["docs"] }] },
      tools: new FakeTools(),
    });
    const { policy, ...rest } = run.deps;
    await runApprovedPlan({
      ...rest,
      approved: {
        planRunId: PLAN_RUN,
        digest: HASH_A as ContentHash,
        approval: "cli-flag",
        plan: PLAN,
        fileNow: async () => ({ kind: "file", sha256: HASH_B as ContentHash }),
        markApplied: async () => "marked",
      },
      policyFor: () => policy,
    });
    const system = run.model.requests[0]?.system ?? "";
    const plan = system.slice(system.indexOf(`${APPROVED_PLAN_LABEL}\n`));
    const at = plan.indexOf(SUMMARY_LABEL_END);
    assert.ok(at > 0, plan);
    const given = plan.slice(at + SUMMARY_LABEL_END.length).split("\n")[0];
    const view = changesPlanOutput({ plan: PLAN, digest: HASH_A as ContentHash, applied: null }, createPrivacyGateway({ secrets: [] }));
    assert.ok(view.ok, JSON.stringify(view));
    assert.equal(view.output.summary, given);
    assert.equal(given, "rewrite the guide, keep [masked] out, then tidy [masked]");
  });
});
