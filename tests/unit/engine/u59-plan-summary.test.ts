/**
 * U-59 (AXM-15, the part U-14 left): a plan run's result said a plan is ready (digest, number of
 * actions) but not why: the agent's description (`propose_plan.summary`) reached only the `plan`
 * view and the approval screen, which read it from the journal. A program that ran the plan run got
 * no description from its result. Now the result carries `planSummary` with reason `plan_pending`:
 * the summary of the call that stored the plan, masked and made safe as the agent's last message is
 * (safeModelText: invisible characters out, key shapes as `[key]`). It is not part of the digest
 * and not what a person approves; `plan` stays `{digest, actions}`.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { EffectiveWorkflowToolCall, RawWorkflowToolOutcome, ToolCall } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { FAKE_SECRET, FAKE_TOKEN, FakeTools, HASH_A, HASH_B, finalAnswer, harness, response } from "./fakes.js";
import type { TaskOverrides } from "./fakes.js";

const KEY_SHAPED = ["sk", "ant", "Q".repeat(24)].join("-");

class PlanTools extends FakeTools {
  constructor(private readonly refuseFirst = false) {
    super();
  }
  private calls = 0;
  async executeWorkflowTool(call: EffectiveWorkflowToolCall): Promise<RawWorkflowToolOutcome> {
    this.calls += 1;
    if (this.refuseFirst && this.calls === 1) return { ok: false, code: "invalid_plan", message: "plan rejected: action 0: destination_exists" as never };
    if (call.name !== "propose_plan") return { ok: false, code: "invalid_args", message: "not a plan" as never };
    return { ok: true, payload: { digest: this.calls === 1 ? HASH_A : HASH_B, actions: call.args.actions.map((action) => ({ ...action, sha256: HASH_B })) } };
  }
}

const PLAN_TASK: TaskOverrides = {
  tools: ["read_file", "search_files", "write_file", "run_command", "inspect_files", "propose_plan"],
  plan: "apply",
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: true, planActions: ["move", "discard"] },
};
const propose = (id: string, summary: string): ToolCall => ({
  id,
  name: "propose_plan",
  args: { summary, actions: [{ kind: "move", from: "a.jpg", to: "2026/a.jpg" }] },
});

async function planRun(calls: ToolCall[], tools = new PlanTools()) {
  const h = harness({ steps: [...calls.map((call) => () => response([call])), () => finalAnswer()], task: PLAN_TASK, tools });
  return runTask(h.deps);
}

describe("U-59: a plan run's result says why, as the agent described the plan", () => {
  test("reproduction: the stored plan's summary is in the result, beside the unchanged plan", async () => {
    const result = await planRun([propose("p1", "group the photos by year")]);
    assert.equal(result.reason, "plan_pending");
    assert.deepEqual(result.plan, { digest: HASH_A, actions: 1 }, "plan keeps its two fields");
    assert.equal(result.planSummary, "group the photos by year");
  });

  test("masked: a registered value becomes its token; key shapes and invisible characters are made safe", async () => {
    const result = await planRun([propose("p1", `move ${FAKE_SECRET}'s photos‮, key ${KEY_SHAPED}`)]);
    assert.equal(result.planSummary?.includes(FAKE_SECRET), false);
    assert.ok(result.planSummary?.includes(FAKE_TOKEN), result.planSummary);
    assert.equal(result.planSummary?.includes(KEY_SHAPED), false);
    assert.ok(result.planSummary?.includes("[key]"), result.planSummary);
    assert.equal(result.planSummary?.includes("‮"), false);
  });

  test("the summary of the call that stored the plan: a refused proposal before it is not the one", async () => {
    const result = await planRun([propose("p1", "the refused one"), propose("p2", "the stored one")], new PlanTools(true));
    assert.equal(result.reason, "plan_pending");
    assert.equal(result.planSummary, "the stored one");
  });

  test("no stored plan, or not a plan run: no planSummary", async () => {
    const noPlan = await planRun([]);
    assert.equal(noPlan.reason, "model_error");
    assert.equal(Object.hasOwn(noPlan, "planSummary"), false);
    const plain = await runTask(harness({ steps: [() => finalAnswer()] }).deps);
    assert.equal(Object.hasOwn(plain, "planSummary"), false);
  });
});
