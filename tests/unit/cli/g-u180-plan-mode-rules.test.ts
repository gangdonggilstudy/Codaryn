/**
 * U-180 (R-99 L-2, DR-69 B-1): the resolver keeps a definition's plan mode and its plan tool.
 * - A task cannot change a definition's "apply" to "run" or "run" to "apply" (`plan_weakened`), as it
 *   cannot set either to "none". Under a definition with "none" it may set either.
 * - Under a plan mode, a plan tool of the other mode in the tools is refused (`tool_not_allowed`): at
 *   the task's tool when the task lists tools, else at the definition's tools. It would never be
 *   offered. Without a plan mode nothing changes: such a tool is just not offered.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ResolveWorkflowInput, WorkflowDefinition } from "../../../src/contracts/index.js";
import { resolveWorkflow, workflowDefinitions } from "../../../src/workflows/index.js";

const RUN: WorkflowDefinition = { tools: ["read_file", "search_files", "write_file", "propose_changes"], plan: "run" };
const RUN_WITH_PLAN_TOOL: WorkflowDefinition = { tools: ["read_file", "propose_plan", "propose_changes"], plan: "run" };
const APPLY_WITH_CHANGES_TOOL: WorkflowDefinition = { tools: ["read_file", "propose_plan", "propose_changes"], plan: "apply" };
const NONE_WITH_BOTH: WorkflowDefinition = { tools: ["read_file", "write_file", "propose_plan", "propose_changes"] };

const definitions = {
  ...workflowDefinitions(undefined),
  "docs-run": RUN,
  "run-mixed": RUN_WITH_PLAN_TOOL,
  "apply-mixed": APPLY_WITH_CHANGES_TOOL,
  "none-both": NONE_WITH_BOTH,
};
const input = (task: ResolveWorkflowInput["task"]): ResolveWorkflowInput => ({ definitions, task, profileWorkflowRef: null, commandRules: 0 });
const refused = (problem: string, field: string) => ({ ok: false, problem, field });

describe("U-180: a task keeps a definition's plan mode", () => {
  test("apply cannot become run, nor run apply", () => {
    assert.deepEqual(resolveWorkflow(input({ workflowRef: "organize", plan: "run" })), refused("plan_weakened", "plan"));
    assert.deepEqual(resolveWorkflow(input({ workflowRef: "docs-run", plan: "apply" })), refused("plan_weakened", "plan"));
  });

  test("stating the same mode, or none of it, keeps it", () => {
    for (const task of [{ workflowRef: "docs-run" }, { workflowRef: "docs-run", plan: "run" as const }]) {
      const resolved = resolveWorkflow(input(task));
      assert.ok(resolved.ok && resolved.settings.plan === "run", JSON.stringify(task));
    }
    const organize = resolveWorkflow(input({ workflowRef: "organize", plan: "apply" }));
    assert.ok(organize.ok && organize.settings.plan === "apply");
  });

  test("under none a task may set either mode", () => {
    for (const plan of ["apply", "run"] as const) {
      const resolved = resolveWorkflow(input({ workflowRef: "none-both", plan, tools: ["read_file", plan === "apply" ? "propose_plan" : "propose_changes"] }));
      assert.ok(resolved.ok && resolved.settings.plan === plan, plan);
    }
  });
});

describe("U-180: no plan tool of the other mode under a plan mode", () => {
  test("in the definition's tools", () => {
    assert.deepEqual(resolveWorkflow(input({ workflowRef: "run-mixed" })), refused("tool_not_allowed", "workflows.tools"));
    assert.deepEqual(resolveWorkflow(input({ workflowRef: "apply-mixed" })), refused("tool_not_allowed", "workflows.tools"));
  });

  test("in the task's tools: at that tool; narrowing it away resolves", () => {
    assert.deepEqual(resolveWorkflow(input({ workflowRef: "run-mixed", tools: ["read_file", "propose_plan"] })), refused("tool_not_allowed", "tools[1]"));
    const narrowed = resolveWorkflow(input({ workflowRef: "run-mixed", tools: ["read_file", "propose_changes"] }));
    assert.ok(narrowed.ok && narrowed.settings.plan === "run");
    assert.deepEqual(narrowed.ok ? [...narrowed.settings.tools] : null, ["read_file", "propose_changes"]);
  });

  test("set under none by the task: the other mode's tool in the definition is refused", () => {
    assert.deepEqual(resolveWorkflow(input({ workflowRef: "none-both", plan: "run" })), refused("tool_not_allowed", "workflows.tools"));
  });

  test("without a plan mode nothing is refused: the plan tools are only not offered", () => {
    const resolved = resolveWorkflow(input({ workflowRef: "none-both" }));
    assert.ok(resolved.ok && resolved.settings.plan === "none");
  });

  test("the built-in definitions all resolve as before", () => {
    for (const ref of ["general", "code", "document", "analyze", "organize"]) assert.equal(resolveWorkflow(input({ workflowRef: ref })).ok, true, ref);
  });
});
