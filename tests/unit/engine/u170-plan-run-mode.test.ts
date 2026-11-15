/**
 * U-170 (DR-69, P1 bundle B, B-1 contract unit): plan mode `run` exists in the contract before
 * anything carries it out. The engine treats it as a plan run of its own mode: read tools and the
 * plan tool whose descriptor names `run` (ToolDescriptor.planMode): `propose_changes` (U-180). A run
 * whose task does not list it reads, stores no plan, writes nothing and ends as `failed`/`model_error`
 * without a plan, as a plan run without its tool does. `apply` and `none` offer what they did before.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ALL_TOOL_NAMES, TOOL_NAMES } from "../../../src/contracts/index.js";
import type { ModelRequest, ToolCall } from "../../../src/contracts/index.js";
import { offeredTools, runTask } from "../../../src/engine/index.js";
import { FakeTools, finalAnswer, harness, readCall, response } from "./fakes.js";
import type { TaskOverrides } from "./fakes.js";

const RUN_PLAN_TASK: TaskOverrides = {
  tools: ["read_file", "search_files", "write_file", "run_command", "inspect_files", "propose_plan"],
  plan: "run",
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: true, planActions: ["move", "discard"] },
};

const call = (id: string, name: string, args: ToolCall["args"]): ToolCall => ({ id, name, args });

describe("U-170: offeredTools by plan mode", () => {
  test("run: the read tools and its own plan tool only, never the other mode's plan tool or a writing tool", () => {
    // U-180 (B-3): propose_changes is a task type tool now, offered in a run plan run only. U-208:
    // query_table is a read tool by its descriptor, offered with the other read tools.
    assert.deepEqual(offeredTools([...ALL_TOOL_NAMES], "run"), ["read_file", "search_files", "inspect_files", "propose_changes", "query_table"]);
  });

  test("apply and none offer what they did before", () => {
    assert.deepEqual(offeredTools([...ALL_TOOL_NAMES], "apply"), ["read_file", "search_files", "inspect_files", "propose_plan", "query_table"]);
    assert.deepEqual(offeredTools([...TOOL_NAMES], "none"), [...TOOL_NAMES]);
    assert.deepEqual(offeredTools([...ALL_TOOL_NAMES], "none"), ["read_file", "search_files", "write_file", "run_command", "inspect_files", "query_table"]);
  });
});

describe("U-170: a plan run of mode run whose task does not list propose_changes", () => {
  test("reads, cannot write or store a moves plan, and ends without a plan", async () => {
    const requests: ModelRequest[] = [];
    const run = harness({
      steps: [
        (request) => {
          requests.push(request);
          return response([readCall("r1")]);
        },
        (request) => {
          requests.push(request);
          return response([
            call("w1", "write_file", { path: "b.txt", expectedHash: null, change: { kind: "replace_all", content: "changed" } }),
            call("p1", "propose_plan", { summary: "move it", actions: [{ kind: "discard", path: "a.txt" }] }),
          ]);
        },
        () => finalAnswer(),
      ],
      task: RUN_PLAN_TASK,
      tools: new FakeTools(),
    });
    const result = await runTask(run.deps);

    const first = requests[0];
    assert.ok(first !== undefined);
    assert.deepEqual([...first.tools], ["read_file", "search_files"]);
    assert.deepEqual(first.workflowTools === undefined ? undefined : [...first.workflowTools], ["inspect_files"]);

    assert.deepEqual(
      run.tools.executed.map((executed) => executed.name),
      ["read_file"],
      "only the read ran: the write and the other mode's plan tool are not offered",
    );
    const refused = run.journal.ofType("tool_decision").filter((decision) => decision.stage === "validate");
    assert.deepEqual(
      refused.map((decision) => [decision.callId, decision.code]),
      [
        ["w1", "unknown_tool"],
        ["p1", "unknown_tool"],
      ],
    );

    assert.deepEqual([result.status, result.reason], ["failed", "model_error"]);
    assert.ok(result.notices.some((notice) => notice.includes("without a plan")));
    assert.equal(Object.hasOwn(result, "plan"), false);
    assert.equal(Object.hasOwn(result, "planRunId"), false);
    assert.deepEqual(run.verifiers.runs, []);
    const [started] = run.journal.ofType("run_started");
    assert.equal(started?.plan, "run");
    assert.equal(Object.hasOwn(started ?? {}, "planRunId"), false);
  });
});
