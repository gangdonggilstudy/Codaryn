/**
 * DR-18 (c), review R-5 L-2 (reproduction P13b): a cancel that arrives while `propose_plan` stores
 * the plan used to be ignored, and the run ended as needs-input/plan_pending with the digest. It now
 * ends as cancelled (or budget-exhausted for the duration limit) without `EngineResult.plan`; the
 * plan.json that may remain cannot be applied, because its run did not end as plan_pending
 * (LoadPlan → run_not_plan).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { EffectiveWorkflowToolCall, RawWorkflowToolOutcome, ToolCall } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { FakeTools, HASH_A, harness, response } from "./fakes.js";
import type { TaskOverrides } from "./fakes.js";

const PLAN_TASK: TaskOverrides = {
  tools: ["read_file", "inspect_files", "propose_plan"],
  plan: "apply",
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] },
};

const propose: ToolCall = {
  id: "p1",
  name: "propose_plan",
  args: { summary: "tidy", actions: [{ kind: "move", from: "a.txt", to: "docs/a.txt" }] },
};

/** A runner whose plan tool stores the plan and, while doing so, sees `during` happen. */
class StoringTools extends FakeTools {
  stored = 0;
  constructor(private readonly during: () => void) {
    super();
  }
  async executeWorkflowTool(call: EffectiveWorkflowToolCall): Promise<RawWorkflowToolOutcome> {
    this.stored += 1;
    this.during();
    const actions = call.name === "propose_plan" ? call.args.actions.map((action) => ({ ...action, sha256: HASH_A })) : [];
    return { ok: true, payload: { digest: "e".repeat(64), actions } as never };
  }
}

describe("DR-18 (c): a plan run interrupted while the plan is stored", () => {
  test("P13b: a cancel during the store ends as cancelled, without the plan", async () => {
    let cancel = (): void => {};
    const tools = new StoringTools(() => cancel());
    const run = harness({ steps: [() => response([propose])], task: PLAN_TASK });
    run.deps = { ...run.deps, tools };
    cancel = () => run.controller.abort();
    const result = await runTask(run.deps);
    assert.equal(tools.stored, 1, "the plan was stored");
    assert.deepEqual([result.status, result.reason, result.exitCode], ["cancelled", "cancelled", 5]);
    assert.equal(Object.hasOwn(result, "plan"), false, "no digest is offered for approval");
    assert.equal(run.journal.ofType("run_finished")[0]?.reason, "cancelled");
  });

  test("the duration limit during the store ends as budget-exhausted, without the plan", async () => {
    let expire = (): void => {};
    const tools = new StoringTools(() => expire());
    const run = harness({ steps: [() => response([propose])], task: { ...PLAN_TASK, limits: { maxDurationMs: 1_000 } } });
    run.deps = { ...run.deps, tools };
    expire = () => {
      run.clock.t = 1_000;
    };
    const result = await runTask(run.deps);
    assert.deepEqual([result.status, result.reason], ["budget-exhausted", "max_duration"]);
    assert.equal(Object.hasOwn(result, "plan"), false);
  });

  test("without an interruption the stored plan still ends as plan_pending", async () => {
    const tools = new StoringTools(() => {});
    const run = harness({ steps: [() => response([propose])], task: PLAN_TASK });
    run.deps = { ...run.deps, tools };
    const result = await runTask(run.deps);
    assert.deepEqual([result.status, result.reason], ["needs-input", "plan_pending"]);
    assert.deepEqual(result.plan, { digest: "e".repeat(64), actions: 1 });
  });
});
