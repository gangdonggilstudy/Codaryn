/**
 * U-175 (DR-69 B-1, follow-up F-1 of U-170): a task type definition's `plan: "run"` cannot become
 * "none" either (`plan_weakened`), as `plan: "apply"` cannot: both ask a person before anything is
 * written, and a task file must not take that away from the user's own definition. The rest of the
 * rule is as before: "none" may be strengthened, and a task that leaves `plan` out keeps the
 * definition's.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ResolveWorkflowInput, WorkflowDefinition } from "../../../src/contracts/index.js";
import { resolveWorkflow, workflowDefinitions } from "../../../src/workflows/index.js";

// U-224: a run definition offers propose_changes, or it is plan_tool_missing.
const RUN_DEFINITION: WorkflowDefinition = {
  tools: ["read_file", "search_files", "write_file", "propose_changes"],
  plan: "run",
};

const definitions = {
  ...workflowDefinitions(undefined),
  "docs-run": RUN_DEFINITION,
  "docs-apply-tool": { tools: ["read_file", "search_files", "write_file", "propose_plan"] },
  "docs-run-tool": { tools: ["read_file", "search_files", "write_file", "propose_changes"] },
} satisfies { readonly [id: string]: WorkflowDefinition };
const input = (task: ResolveWorkflowInput["task"]): ResolveWorkflowInput => ({ definitions, task, profileWorkflowRef: null, commandRules: 0 });

describe("U-175: plan_weakened covers run", () => {
  test("a definition's run cannot become none", () => {
    assert.deepEqual(resolveWorkflow(input({ workflowRef: "docs-run", plan: "none" })), { ok: false, problem: "plan_weakened", field: "plan" });
  });

  test("a task that leaves plan out, or states run, keeps run", () => {
    for (const task of [{ workflowRef: "docs-run" }, { workflowRef: "docs-run", plan: "run" as const }]) {
      const resolved = resolveWorkflow(input(task));
      assert.ok(resolved.ok, JSON.stringify(task));
      assert.equal(resolved.settings.plan, "run");
    }
  });

  test("apply is as before, and none may still be strengthened to apply or run", () => {
    assert.deepEqual(resolveWorkflow(input({ workflowRef: "organize", plan: "none" })), { ok: false, problem: "plan_weakened", field: "plan" });
    // U-224: under a definition that offers the mode's plan tool; document offers none.
    for (const [plan, workflowRef] of [["apply", "docs-apply-tool"], ["run", "docs-run-tool"]] as const) {
      const resolved = resolveWorkflow(input({ workflowRef, plan }));
      assert.ok(resolved.ok && resolved.settings.plan === plan, plan);
      assert.deepEqual(resolveWorkflow(input({ workflowRef: "document", plan })), { ok: false, problem: "plan_tool_missing", field: "plan" });
    }
  });
});
