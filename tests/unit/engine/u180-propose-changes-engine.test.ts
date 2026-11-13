/**
 * U-180 (DR-69 B-1, B-3): the engine and `propose_changes`, the plan tool of plan mode `run`.
 * - Only a `run` plan run offers it (ToolDescriptor.planMode); an `apply` plan run never does.
 * - Every planned file is judged on its own with PLANNED_FILE_DESCRIPTOR (the gate before
 *   restoration, then on the effective path). One denied file denies the call with its index and no
 *   path; nothing is stored and the model may try again.
 * - A stored plan ends the run as needs-input/plan_pending with EngineResult.plan
 *   `{ digest, actions: <files>, kind: "changes" }` and the masked summary; nothing is verified.
 * - A `run` plan run that ends without a plan says propose_changes did not succeed.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PLANNED_FILE_DESCRIPTOR } from "../../../src/contracts/index.js";
import type { EffectiveWorkflowToolCall, ModelRequest, PolicyDecision, RawWorkflowToolOutcome, ToolCall } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { FakePolicy, FakeTools, HASH_A, HASH_B, finalAnswer, harness, readCall, response } from "./fakes.js";
import type { TaskOverrides } from "./fakes.js";

class ChangesTools extends FakeTools {
  readonly workflowCalls: EffectiveWorkflowToolCall[] = [];
  async executeWorkflowTool(call: EffectiveWorkflowToolCall): Promise<RawWorkflowToolOutcome> {
    this.workflowCalls.push(JSON.parse(JSON.stringify(call)) as EffectiveWorkflowToolCall);
    if (call.name !== "propose_changes") return { ok: false, code: "invalid_args", message: "not expected" as never };
    return {
      ok: true,
      payload: {
        digest: HASH_A,
        files: call.args.files.map((file) => (file.change === "create" ? { path: file.path, change: "create" as const, sha256: null } : { path: file.path, change: "modify" as const, sha256: HASH_B })),
      },
    };
  }
}

const RUN_PLAN: TaskOverrides = {
  tools: ["read_file", "search_files", "write_file", "inspect_files", "propose_plan", "propose_changes"],
  plan: "run",
};
const call = (id: string, name: string, args: ToolCall["args"]): ToolCall => ({ id, name, args });
const changes = (id: string, files: { path: string; change: "create" | "modify" }[], summary = "rewrite the guide"): ToolCall => call(id, "propose_changes", { summary, files });
const DENIED: PolicyDecision = { allowed: false, permission: "path", code: "protected_path" };

describe("U-180: propose_changes in the engine", () => {
  test("a run plan run offers it, not propose_plan nor a writing tool; an apply plan run never offers it", async () => {
    const seen: ModelRequest[] = [];
    const run = harness({ steps: [(request) => (seen.push(request), finalAnswer())], task: RUN_PLAN, tools: new ChangesTools() });
    await runTask(run.deps);
    assert.deepEqual([...(seen[0]?.tools ?? [])], ["read_file", "search_files"]);
    assert.deepEqual([...(seen[0]?.workflowTools ?? [])], ["inspect_files", "propose_changes"]);
    const applySeen: ModelRequest[] = [];
    const apply = harness({ steps: [(request) => (applySeen.push(request), finalAnswer())], task: { ...RUN_PLAN, plan: "apply" }, tools: new ChangesTools() });
    await runTask(apply.deps);
    assert.deepEqual([...(applySeen[0]?.workflowTools ?? [])], ["inspect_files", "propose_plan"]);
  });

  test("a stored plan ends the run as plan_pending with the files counted and kind changes", async () => {
    const tools = new ChangesTools();
    const run = harness({
      steps: [() => response([readCall("r1", "docs/guide.md")]), () => response([changes("c1", [{ path: "docs/guide.md", change: "modify" }, { path: "docs/new.md", change: "create" }])])],
      task: RUN_PLAN,
      tools,
    });
    const result = await runTask(run.deps);
    assert.deepEqual([result.status, result.reason], ["needs-input", "plan_pending"]);
    assert.deepEqual(result.plan, { digest: HASH_A, actions: 2, kind: "changes" });
    assert.equal(result.planSummary, "rewrite the guide");
    assert.deepEqual(run.verifiers.runs, [], "a plan run verifies nothing");
    assert.deepEqual(
      tools.workflowCalls.map((one) => one.args),
      [{ summary: "rewrite the guide", files: [{ path: "docs/guide.md", change: "modify" }, { path: "docs/new.md", change: "create" }] }],
    );
    const decisions = run.journal.ofType("tool_decision").filter((decision) => decision.callId === "c1");
    assert.deepEqual(decisions.map((decision) => [decision.stage, decision.allowed]), [["policy_effective", true]]);
  });

  test("each file is judged as a write of its path by the gate, before and after restoration", async () => {
    const requested: ToolCall[] = [];
    const policy = new FakePolicy({
      requested: (one) => {
        if (one.name === PLANNED_FILE_DESCRIPTOR.name) requested.push(one);
        return { allowed: true };
      },
    });
    const run = harness({ steps: [() => response([changes("c1", [{ path: "a.md", change: "modify" }, { path: "b.md", change: "create" }])])], task: RUN_PLAN, tools: new ChangesTools(), policy });
    await runTask(run.deps);
    assert.deepEqual(requested.map((one) => one.args), [{ path: "a.md" }, { path: "b.md" }]);
    const effective = policy.effectiveCalls.filter((one) => one.name === PLANNED_FILE_DESCRIPTOR.name);
    assert.deepEqual(effective.map((one) => one.args), [{ path: "a.md" }, { path: "b.md" }]);
  });

  test("one denied file denies the call with its index, stores nothing, and the run goes on", async () => {
    const tools = new ChangesTools();
    const policy = new FakePolicy({ effective: (one) => (one.name === PLANNED_FILE_DESCRIPTOR.name && (one.args as { path?: string }).path === "secret/b.md" ? DENIED : { allowed: true }) });
    const run = harness({
      steps: [() => response([changes("c1", [{ path: "a.md", change: "modify" }, { path: "secret/b.md", change: "create" }])]), () => finalAnswer()],
      task: RUN_PLAN,
      tools,
      policy,
    });
    const result = await runTask(run.deps);
    assert.equal(tools.workflowCalls.length, 0, "the tool did not run");
    const [denied] = run.journal.ofType("tool_result").filter((one) => one.result.callId === "c1");
    assert.equal(denied?.result.errorCode, "policy_denied");
    assert.match(denied?.result.content ?? "", /denied by policy: file 1: path\/protected_path\./);
    assert.doesNotMatch(denied?.result.content ?? "", /secret\/b\.md/, "the reason names the index, never the path");
    assert.deepEqual([result.status, result.reason], ["failed", "model_error"], "then it ended without a plan");
    assert.ok(result.notices.some((notice) => notice.includes("propose_changes did not succeed")));
    assert.equal(Object.hasOwn(result, "plan"), false);
  });

  test("arguments that do not fit the schema are refused before any check", async () => {
    const tools = new ChangesTools();
    const run = harness({
      steps: [() => response([call("c1", "propose_changes", { summary: "x", files: [{ path: "a.md", change: "delete" }] })]), () => finalAnswer()],
      task: RUN_PLAN,
      tools,
    });
    await runTask(run.deps);
    const [refused] = run.journal.ofType("tool_result").filter((one) => one.result.callId === "c1");
    assert.equal(refused?.result.errorCode, "invalid_args");
    assert.match(refused?.result.content ?? "", /files\[0\]\.change: must be "create" or "modify"/);
    assert.equal(tools.workflowCalls.length, 0);
  });
});
