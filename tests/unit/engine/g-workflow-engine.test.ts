/**
 * G-B: the engine changes for general tasks (design general-tasks.md 4.3, GT-E1 to GT-E5).
 * - GT-E1 tool set: only the task's tools are offered and may be called; workflow tools go through
 *   the same checks and `ToolRunner.executeWorkflowTool`.
 * - GT-E2 instructions: appended to the fixed system prompt under a fixed label, masked.
 * - GT-E3 plan step: a plan run offers read tools and the plan tool; each plan action is judged by
 *   the policy; a stored plan ends the run as needs-input/plan_pending without verification.
 * - GT-E4 human review: checks done → needs-input/awaiting_review with the masked checklist.
 * - GT-E5: the plan step follows the descriptor's `endsRun`, not a tool name.
 * Legacy tasks (no workflow settings) are covered here briefly and in
 * tests/unit/contracts/g-legacy-interpretation.test.ts.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { ALL_TOOL_NAMES, TOOL_NAMES, WORKFLOW_TOOL_NAMES, asRawText } from "../../../src/contracts/index.js";
import type {
  AnyToolName,
  EffectiveWorkflowToolCall,
  EngineDeps,
  ModelRequest,
  PolicyDecision,
  RawWorkflowToolOutcome,
  ToolCall,
  Workspace,
} from "../../../src/contracts/index.js";
import { INSTRUCTIONS_LABEL, SYSTEM_PROMPT, offeredTools, runTask } from "../../../src/engine/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import {
  FAKE_SECRET,
  FAKE_TOKEN,
  FakePolicy,
  FakeTools,
  FakeVerifiers,
  HASH_A,
  HASH_B,
  finalAnswer,
  harness,
  readCall,
  response,
} from "./fakes.js";
import type { TaskOverrides } from "./fakes.js";

type WorkflowHandler = (call: EffectiveWorkflowToolCall) => RawWorkflowToolOutcome;

/** FakeTools plus workflow tools. `throwTimes` makes the first calls throw (unknown outcome). */
class FakeWorkflowTools extends FakeTools {
  readonly workflowCalls: EffectiveWorkflowToolCall[] = [];
  private throwsLeft: number;
  constructor(
    private readonly workflowHandler: WorkflowHandler = storedPlan,
    throwTimes = 0,
  ) {
    super();
    this.throwsLeft = throwTimes;
  }
  async executeWorkflowTool(call: EffectiveWorkflowToolCall): Promise<RawWorkflowToolOutcome> {
    this.workflowCalls.push(JSON.parse(JSON.stringify(call)) as EffectiveWorkflowToolCall);
    if (this.throwsLeft > 0) {
      this.throwsLeft -= 1;
      throw new Error("runner failed");
    }
    return this.workflowHandler(call);
  }
}

/** What a plan tool returns once it stored the plan: digest and resolved actions. */
function storedPlan(call: EffectiveWorkflowToolCall): RawWorkflowToolOutcome {
  if (call.name === "inspect_files") {
    return {
      ok: true,
      payload: { entries: [{ path: `photos/${FAKE_SECRET}.jpg`, kind: "file", size: 3, modifiedAt: null }], next: null, hashesIncomplete: false },
    };
  }
  if (call.name === "query_table") return { ok: false, code: "invalid_args", message: asRawText("not expected here") };
  if (call.name === "propose_changes") {
    // U-180: the run plan's tool: a create holds no hash, a modify gets one.
    return {
      ok: true,
      payload: {
        digest: HASH_A,
        files: call.args.files.map((file) =>
          file.change === "create" ? { path: file.path, change: "create" as const, sha256: null } : { path: file.path, change: "modify" as const, sha256: HASH_B },
        ),
      },
    };
  }
  return {
    ok: true,
    payload: {
      digest: HASH_A,
      actions: call.args.actions.map((action) =>
        action.kind === "move" ? { ...action, sha256: HASH_B } : { ...action, sha256: HASH_B },
      ),
    },
  };
}

const call = (id: string, name: string, args: ToolCall["args"]): ToolCall => ({ id, name, args });
const move = (from: string, to: string) => ({ kind: "move", from, to });
const proposeCall = (id: string, actions: ToolCall["args"][]): ToolCall =>
  call(id, "propose_plan", { summary: "group the photos by year", actions });

const PLAN_TASK: TaskOverrides = {
  tools: ["read_file", "search_files", "write_file", "run_command", "inspect_files", "propose_plan"],
  plan: "apply",
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: true, planActions: ["move", "discard"] },
};

function requestTools(request: ModelRequest | undefined): { tools: string[]; workflowTools: string[] | undefined } {
  assert.ok(request !== undefined, "a model request was made");
  return { tools: [...request.tools], workflowTools: request.workflowTools === undefined ? undefined : [...request.workflowTools] };
}

describe("GT-E1 offeredTools", () => {
  test("a run without a plan offers every listed tool except the plan tool, in order and once", () => {
    assert.deepEqual(offeredTools([...TOOL_NAMES], "none"), [...TOOL_NAMES]);
    assert.deepEqual(offeredTools(["inspect_files", "read_file", "read_file", "propose_plan"], "none"), ["inspect_files", "read_file"]);
  });

  test("a plan run offers read tools and the plan tool only (GT-E5: by descriptor, not by name)", () => {
    // U-208: query_table is a read tool by its descriptor, so a plan run offers it too.
    assert.deepEqual(offeredTools([...ALL_TOOL_NAMES], "apply"), ["read_file", "search_files", "inspect_files", "propose_plan", "query_table"]);
  });

  test("names that are not tools are dropped", () => {
    assert.deepEqual(offeredTools(["read_file", "delete_file" as AnyToolName], "none"), ["read_file"]);
  });
});

describe("GT-E1 tool set", () => {
  test("the request offers the task's built-in tools and, apart, its workflow tools", async () => {
    const run = harness({ steps: [() => finalAnswer()], task: { tools: ["read_file", "inspect_files"] } });
    run.deps = { ...run.deps, tools: new FakeWorkflowTools() };
    await runTask(run.deps);
    assert.deepEqual(requestTools(run.model.requests[0]), { tools: ["read_file"], workflowTools: ["inspect_files"] });
  });

  test("a task without workflow tools sends no workflowTools field", async () => {
    const run = harness({ steps: [() => finalAnswer()], task: { tools: ["read_file", "write_file"] } });
    await runTask(run.deps);
    const first = run.model.requests[0];
    assert.deepEqual(requestTools(first), { tools: ["read_file", "write_file"], workflowTools: undefined });
    assert.equal(Object.hasOwn(first ?? {}, "workflowTools"), false);
  });

  test("a built-in tool the task does not list is unknown_tool and is not run", async () => {
    const run = harness({
      steps: [() => response([call("w1", "write_file", { path: "a.txt", expectedHash: null, change: { kind: "replace_all", content: "x" } })]), () => finalAnswer()],
      task: { tools: ["read_file"] },
    });
    const result = await runTask(run.deps);
    assert.equal(run.tools.executed.length, 0);
    const [decision] = run.journal.ofType("tool_decision");
    assert.deepEqual([decision?.stage, decision?.code], ["validate", "unknown_tool"]);
    const [toolResult] = run.journal.ofType("tool_result");
    assert.equal(toolResult?.result.errorCode, "unknown_tool");
    assert.equal(result.status, "done");
  });

  test("a workflow tool goes through the policy and the runner, and its result is masked", async () => {
    const tools = new FakeWorkflowTools();
    const policy = new FakePolicy();
    const run = harness({
      steps: [() => response([call("i1", "inspect_files", { path: FAKE_TOKEN, hash: true })]), () => finalAnswer()],
      task: { tools: ["read_file", "inspect_files"] },
      policy,
    });
    run.deps = { ...run.deps, tools };
    await runTask(run.deps);
    assert.equal(tools.workflowCalls.length, 1);
    // The path field was restored (restorable "path"), as for read_file.
    assert.deepEqual(tools.workflowCalls[0]?.args, { path: FAKE_SECRET, hash: true });
    assert.equal(policy.effectiveCalls.length, 1);
    const [toolResult] = run.journal.ofType("tool_result");
    assert.equal(toolResult?.result.ok, true);
    assert.ok(toolResult?.result.content.includes(FAKE_TOKEN), "the payload is masked");
    assert.equal(toolResult?.result.content.includes(FAKE_SECRET), false);
    assert.equal(run.journal.events.some((event) => event.type === "file_changed"), false);
  });

  test("a runner without executeWorkflowTool answers a workflow tool as unknown_tool", async () => {
    const run = harness({
      steps: [() => response([call("i1", "inspect_files", { path: "." })]), () => finalAnswer()],
      task: { tools: ["inspect_files"] },
    });
    await runTask(run.deps);
    const [decision] = run.journal.ofType("tool_decision");
    assert.deepEqual([decision?.stage, decision?.code], ["validate", "unknown_tool"]);
  });

  test("workflow tool arguments of the wrong shape are invalid_args and are not run", async () => {
    const tools = new FakeWorkflowTools();
    const run = harness({
      steps: [() => response([call("i1", "inspect_files", { path: ".", depth: 2 })]), () => finalAnswer()],
      task: { tools: ["inspect_files"] },
    });
    run.deps = { ...run.deps, tools };
    await runTask(run.deps);
    assert.equal(tools.workflowCalls.length, 0);
    const [decision] = run.journal.ofType("tool_decision");
    assert.deepEqual([decision?.stage, decision?.code], ["validate", "invalid_args"]);
  });

  test("a read-class workflow tool whose runner throws is retried once", async () => {
    const tools = new FakeWorkflowTools(storedPlan, 1);
    const run = harness({
      steps: [() => response([call("i1", "inspect_files", { path: "." })]), () => finalAnswer()],
      task: { tools: ["inspect_files"] },
    });
    run.deps = { ...run.deps, tools };
    const result = await runTask(run.deps);
    assert.equal(tools.workflowCalls.length, 2);
    assert.equal(result.status, "done");
  });

  test("run_started records the workflow settings when the task has them", async () => {
    const run = harness({
      steps: [() => finalAnswer()],
      task: { workflowRef: "memo", tools: ["read_file", "write_file"], completion: "verifiers" },
    });
    await runTask(run.deps);
    const [started] = run.journal.ofType("run_started");
    assert.equal(started?.workflowRef, "memo");
    assert.deepEqual(started?.tools, ["read_file", "write_file"]);
    assert.equal(started?.plan, "none");
    assert.equal(started?.completion, "verifiers");
  });
});

describe("GT-E2 instructions", () => {
  test("instructions follow the fixed prompt under the label, masked, in the first request only", async () => {
    const run = harness({
      steps: [() => response([readCall("r1")]), () => finalAnswer()],
      task: { instructions: `Sort by year. Never print ${FAKE_SECRET}.` },
    });
    await runTask(run.deps);
    const expected = `${SYSTEM_PROMPT}\n\n${INSTRUCTIONS_LABEL}\nSort by year. Never print ${FAKE_TOKEN}.`;
    assert.equal(run.model.requests[0]?.system, expected);
    const requests = run.journal.ofType("model_request");
    assert.equal(requests[0]?.system, expected);
    assert.equal(requests[1]?.system, null);
  });

  test("blank or null instructions leave the system prompt as it is", async () => {
    for (const instructions of ["   ", null]) {
      const run = harness({ steps: [() => finalAnswer()], task: { instructions } });
      await runTask(run.deps);
      assert.equal(run.model.requests[0]?.system, SYSTEM_PROMPT);
    }
  });
});

describe("GT-E3 plan step", () => {
  test("a plan run offers read tools and the plan tool only", async () => {
    const run = harness({ steps: [() => finalAnswer()], task: PLAN_TASK });
    run.deps = { ...run.deps, tools: new FakeWorkflowTools() };
    await runTask(run.deps);
    assert.deepEqual(requestTools(run.model.requests[0]), {
      tools: ["read_file", "search_files"],
      workflowTools: ["inspect_files", "propose_plan"],
    });
  });

  test("a stored plan ends the run as plan_pending, without verification, with the digest", async () => {
    const tools = new FakeWorkflowTools();
    const run = harness({
      steps: [() => response([readCall("r1"), proposeCall("p1", [move("a.jpg", "2026/a.jpg"), { kind: "discard", path: "b.tmp" }]), readCall("r2")])],
      task: PLAN_TASK,
    });
    run.deps = { ...run.deps, tools };
    const result = await runTask(run.deps);
    assert.equal(result.status, "needs-input");
    assert.equal(result.reason, "plan_pending");
    assert.equal(result.exitCode, 3);
    assert.deepEqual(result.plan, { digest: HASH_A, actions: 2 });
    assert.equal(Object.hasOwn(result, "review"), false);
    assert.equal(Object.hasOwn(result, "finalMessage"), false, "DR-47: a plan run's place is the plan's summary");
    assert.deepEqual(run.verifiers.runs, [], "the plan run verifies nothing");
    assert.deepEqual(result.verifiers, []);
    // The read before the plan ran; the read after it in the same turn did not.
    assert.deepEqual(tools.executed.map((executed) => executed.id), ["r1"]);
    assert.deepEqual(tools.workflowCalls[0]?.args, {
      summary: "group the photos by year",
      actions: [move("a.jpg", "2026/a.jpg"), { kind: "discard", path: "b.tmp" }],
    });
    assert.equal(run.journal.ofType("tool_result").length, 2);
    assert.equal(run.journal.ofType("run_finished")[0]?.reason, "plan_pending");
  });

  test("a plan action kind the policy does not list is denied before the policy gate and the runner", async () => {
    const tools = new FakeWorkflowTools();
    const policy = new FakePolicy();
    const run = harness({
      steps: [
        () => response([proposeCall("p1", [{ kind: "discard", path: "b.tmp" }])]),
        () => response([proposeCall("p2", [move("a.jpg", "2026/a.jpg")])]),
      ],
      task: { ...PLAN_TASK, policy: { ...PLAN_TASK.policy!, planActions: ["move"] } },
      policy,
    });
    run.deps = { ...run.deps, tools };
    const result = await runTask(run.deps);
    const [denied] = run.journal.ofType("tool_decision");
    assert.deepEqual([denied?.callId, denied?.permission, denied?.code], ["p1", "destructive", "plan_action_not_allowed"]);
    const [first] = run.journal.ofType("tool_result");
    assert.equal(first?.result.errorCode, "policy_denied");
    assert.ok(first?.result.content.includes("action 0"), "the message names the action index");
    // The model proposed again; that plan was stored.
    assert.deepEqual(tools.workflowCalls.map((stored) => stored.id), ["p2"]);
    assert.equal(result.reason, "plan_pending");
  });

  test("each action is judged by the gate before and after restoration; a denial stops the call", async () => {
    const tools = new FakeWorkflowTools();
    const seen: string[] = [];
    const deny: PolicyDecision = { allowed: false, permission: "path", code: "protected_path" };
    const policy = new FakePolicy({
      requested: (requested) => {
        seen.push(`requested:${requested.name}`);
        return ALLOW_IF_NOT(requested, "keep/x.jpg", deny);
      },
      effective: (effective) => {
        seen.push(`effective:${effective.name}`);
        return { allowed: true };
      },
    });
    const run = harness({
      steps: [() => response([proposeCall("p1", [move("a.jpg", "2026/a.jpg"), move("keep/x.jpg", "y.jpg")])]), () => finalAnswer()],
      task: PLAN_TASK,
      policy,
    });
    run.deps = { ...run.deps, tools };
    const result = await runTask(run.deps);
    assert.deepEqual(seen, ["requested:plan.move", "effective:plan.move", "requested:plan.move"]);
    assert.equal(tools.workflowCalls.length, 0, "nothing is stored when one action is denied");
    const [decision] = run.journal.ofType("tool_decision");
    assert.deepEqual([decision?.stage, decision?.permission, decision?.code], ["policy_requested", "path", "protected_path"]);
    assert.equal(result.status, "failed", "the model then ended without a plan");
  });

  test("tokens in action paths are restored only when the policy allows it", async () => {
    const allowed = new FakeWorkflowTools();
    const runAllowed = harness({
      steps: [() => response([proposeCall("p1", [move(`${FAKE_TOKEN}.jpg`, "2026/a.jpg")])])],
      task: PLAN_TASK,
      policy: new FakePolicy({ restorable: ["from", "to"] }),
    });
    runAllowed.deps = { ...runAllowed.deps, tools: allowed };
    assert.equal((await runTask(runAllowed.deps)).reason, "plan_pending");
    const stored = allowed.workflowCalls[0];
    assert.ok(stored?.name === "propose_plan");
    assert.deepEqual(stored.args.actions, [move(`${FAKE_SECRET}.jpg`, "2026/a.jpg")]);

    const refused = new FakeWorkflowTools();
    const runRefused = harness({
      steps: [() => response([proposeCall("p1", [move(`${FAKE_TOKEN}.jpg`, "2026/a.jpg")])]), () => finalAnswer()],
      task: PLAN_TASK,
      policy: new FakePolicy({ restorable: [] }),
    });
    runRefused.deps = { ...runRefused.deps, tools: refused };
    await runTask(runRefused.deps);
    assert.equal(refused.workflowCalls.length, 0);
    const [decision] = runRefused.journal.ofType("tool_decision");
    assert.deepEqual([decision?.stage, decision?.permission], ["restore", "restore"]);
  });

  test("a plan run whose model ends without a stored plan fails as model_error and verifies nothing", async () => {
    const run = harness({ steps: [() => response([readCall("r1")]), () => finalAnswer()], task: PLAN_TASK });
    run.deps = { ...run.deps, tools: new FakeWorkflowTools() };
    const result = await runTask(run.deps);
    assert.deepEqual([result.status, result.reason], ["failed", "model_error"]);
    assert.deepEqual(run.verifiers.runs, []);
    const [error] = run.journal.ofType("model_error");
    assert.equal(error?.kind, "malformed_response");
    assert.ok(result.notices.some((notice) => notice.includes("without a plan")));
    assert.equal(Object.hasOwn(result, "plan"), false);
  });

  test("a plan the tool refuses goes back to the model as an error and the run goes on", async () => {
    const tools = new FakeWorkflowTools(() => ({ ok: false, code: "invalid_plan", message: asRawText("action 0: destination_exists") }));
    const run = harness({
      steps: [() => response([proposeCall("p1", [move("a.jpg", "b.jpg")])]), () => finalAnswer()],
      task: PLAN_TASK,
    });
    run.deps = { ...run.deps, tools };
    const result = await runTask(run.deps);
    const [toolResult] = run.journal.ofType("tool_result");
    assert.equal(toolResult?.result.errorCode, "invalid_plan");
    assert.equal(run.model.requests.length, 2);
    assert.equal(result.reason, "model_error");
  });

  test("a plan tool whose runner throws is an unknown outcome and is not retried", async () => {
    const tools = new FakeWorkflowTools(storedPlan, 1);
    const run = harness({ steps: [() => response([proposeCall("p1", [move("a.jpg", "b.jpg")])])], task: PLAN_TASK });
    run.deps = { ...run.deps, tools };
    const result = await runTask(run.deps);
    assert.equal(tools.workflowCalls.length, 1);
    assert.deepEqual([result.status, result.reason], ["needs-input", "unknown_tool_outcome"]);
  });

  test("outside a plan run the plan tool is not offered, so a call to it is unknown_tool", async () => {
    const tools = new FakeWorkflowTools();
    const run = harness({
      steps: [() => response([proposeCall("p1", [move("a.jpg", "b.jpg")])]), () => finalAnswer()],
      task: { tools: ["read_file", "propose_plan"] },
    });
    run.deps = { ...run.deps, tools };
    const result = await runTask(run.deps);
    assert.equal(tools.workflowCalls.length, 0);
    assert.equal(run.journal.ofType("tool_decision")[0]?.code, "unknown_tool");
    assert.equal(result.status, "done");
  });
});

describe("GT-E3 plan actions with the real policy gate and privacy gateway", () => {
  let base: string;
  let workspace: Workspace;

  before(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-gb-"));
    fs.writeFileSync(path.join(base, "a.jpg"), "a");
    fs.mkdirSync(path.join(base, "keep"));
    workspace = await createWorkspace({ root: base });
  });

  after(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  function realDeps(run: ReturnType<typeof harness>, tools: FakeWorkflowTools): EngineDeps {
    return {
      ...run.deps,
      tools,
      privacy: createPrivacyGateway({ secrets: [] }),
      policy: createPolicyGate({ config: run.deps.task.policy, workspace }),
    };
  }

  const PROTECTED: TaskOverrides = { ...PLAN_TASK, policy: { ...PLAN_TASK.policy!, protectedPaths: ["keep"] } };

  for (const [to, code] of [
    ["../out.jpg", "outside_root"],
    [".codaryn/a.jpg", "state_dir"],
    ["keep/a.jpg", "protected_path"],
  ] as const) {
    test(`a move to ${to} is denied as path/${code} and nothing is stored`, async () => {
      const tools = new FakeWorkflowTools();
      const run = harness({ steps: [() => response([proposeCall("p1", [move("a.jpg", to)])]), () => finalAnswer()], task: PROTECTED });
      await runTask(realDeps(run, tools));
      assert.equal(tools.workflowCalls.length, 0);
      const [decision] = run.journal.ofType("tool_decision");
      assert.deepEqual([decision?.permission, decision?.code], ["path", code]);
    });
  }

  test("a move inside the workspace passes both checks and is stored", async () => {
    const tools = new FakeWorkflowTools();
    const run = harness({ steps: [() => response([proposeCall("p1", [move("a.jpg", "2026/a.jpg")])])], task: PROTECTED });
    const result = await runTask(realDeps(run, tools));
    assert.equal(result.reason, "plan_pending");
    assert.equal(tools.workflowCalls.length, 1);
  });
});

describe("GT-E4 human review", () => {
  const REVIEW: TaskOverrides = {
    completion: "human_review",
    humanReview: { checklist: ["the report matches the table", `no line mentions ${FAKE_SECRET}`] },
  };

  test("passing verifiers end as awaiting_review with the masked checklist, never as done", async () => {
    const run = harness({ steps: [() => finalAnswer()], task: REVIEW });
    const result = await runTask(run.deps);
    assert.deepEqual([result.status, result.reason, result.exitCode], ["needs-input", "awaiting_review", 3]);
    assert.deepEqual(result.review, { checklist: ["the report matches the table", `no line mentions ${FAKE_TOKEN}`] });
    assert.deepEqual(run.verifiers.runs, ["v1"]);
    assert.ok(result.notices.some((notice) => notice.includes("awaiting human review")));
    assert.equal(Object.hasOwn(result, "plan"), false);
  });

  test("no verifier with human review ends as awaiting_review and says there is no automatic check", async () => {
    const run = harness({ steps: [() => finalAnswer()], task: { ...REVIEW, verifiers: [] } });
    const result = await runTask(run.deps);
    assert.equal(result.reason, "awaiting_review");
    assert.ok(result.notices.some((notice) => notice.includes("no automatic verification")));
  });

  test("a failed or inconclusive verification ends as without review", async () => {
    const failed = harness({ steps: [() => finalAnswer()], task: REVIEW, verifiers: new FakeVerifiers({ v1: "fail" }) });
    const failedResult = await runTask(failed.deps);
    assert.deepEqual([failedResult.status, failedResult.reason], ["failed", "verifier_failed"]);
    assert.equal(Object.hasOwn(failedResult, "review"), false);

    const unsure = harness({ steps: [() => finalAnswer()], task: REVIEW, verifiers: new FakeVerifiers({ v1: "inconclusive" }) });
    const unsureResult = await runTask(unsure.deps);
    assert.deepEqual([unsureResult.status, unsureResult.reason], ["needs-input", "verifier_inconclusive"]);
  });

  test("a failed check is repaired first; review follows only once the checks pass", async () => {
    const run = harness({
      steps: [() => finalAnswer(), () => finalAnswer()],
      task: { ...REVIEW, limits: { maxRepairAttempts: 1 } },
      verifiers: new FakeVerifiers({ v1: ["fail", "pass"] }),
    });
    const result = await runTask(run.deps);
    assert.equal(result.reason, "awaiting_review");
    assert.equal(result.usage.repairAttempts, 1);
  });

  test("completion verifiers keeps done/verified", async () => {
    const run = harness({ steps: [() => finalAnswer()], task: { completion: "verifiers" } });
    const result = await runTask(run.deps);
    assert.deepEqual([result.status, result.reason], ["done", "verified"]);
  });
});

describe("legacy tasks keep their requests and records", () => {
  test("no workflow settings: the four tools, no workflowTools, no workflow fields in run_started", async () => {
    const run = harness({ steps: [() => response([readCall("r1")]), () => finalAnswer()] });
    const result = await runTask(run.deps);
    for (const request of run.model.requests) {
      assert.deepEqual([...request.tools], [...TOOL_NAMES]);
      assert.equal(Object.hasOwn(request, "workflowTools"), false);
    }
    const [started] = run.journal.ofType("run_started");
    for (const field of ["workflowRef", "tools", "plan", "completion"]) assert.equal(Object.hasOwn(started ?? {}, field), false);
    assert.deepEqual([result.status, result.reason], ["done", "verified"]);
  });

  test("a call to a workflow tool name in a legacy run is unknown_tool, as any unknown name was", async () => {
    for (const name of WORKFLOW_TOOL_NAMES) {
      const run = harness({ steps: [() => response([call("x", name, { path: "." })]), () => finalAnswer()] });
      run.deps = { ...run.deps, tools: new FakeWorkflowTools() };
      await runTask(run.deps);
      assert.equal(run.journal.ofType("tool_decision")[0]?.code, "unknown_tool", name);
    }
  });
});

/** Allows every call except one whose `from` or `path` is the given path. */
function ALLOW_IF_NOT(requested: ToolCall, blocked: string, decision: PolicyDecision): PolicyDecision {
  const args = requested.args;
  return args["from"] === blocked || args["path"] === blocked ? decision : { allowed: true };
}
