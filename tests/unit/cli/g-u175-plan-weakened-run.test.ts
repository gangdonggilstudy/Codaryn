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

const RUN_DEFINITION: WorkflowDefinition = {
  tools: ["read_file", "search_files", "write_file"],
  plan: "run",
};

const definitions = { ...workflowDefinitions(undefined), "docs-run": RUN_DEFINITION };
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
    for (const plan of ["apply", "run"] as const) {
      const resolved = resolveWorkflow(input({ workflowRef: "document", plan }));
      assert.ok(resolved.ok && resolved.settings.plan === plan, plan);
    }
  });
});
