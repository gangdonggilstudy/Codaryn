/**
 * G-F: built-in workflow definitions and `resolveWorkflow` (GT-U02, GT-U14 for the resolver).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BUILTIN_WORKFLOW_IDS, LEGACY_WORKFLOW_SETTINGS, MAX_WORKFLOW_INSTRUCTIONS_CHARS, TOOL_NAMES } from "../../../src/contracts/index.js";
import type { ResolveWorkflowInput, WorkflowDefinition } from "../../../src/contracts/index.js";
import { BUILTIN_WORKFLOWS, resolveWorkflow, workflowDefinitions } from "../../../src/workflows/index.js";

const definitions = workflowDefinitions(undefined);
const input = (overrides: Partial<ResolveWorkflowInput> = {}): ResolveWorkflowInput => ({
  definitions,
  task: {},
  profileWorkflowRef: null,
  commandRules: 0,
  ...overrides,
});

describe("built-in definitions (GT-D12)", () => {
  test("there is one per BUILTIN_WORKFLOW_IDS entry, data only", () => {
    assert.deepEqual(Object.keys(BUILTIN_WORKFLOWS).sort(), [...BUILTIN_WORKFLOW_IDS].sort());
    for (const definition of Object.values(BUILTIN_WORKFLOWS)) {
      assert.ok(definition.tools.length > 0);
      assert.ok((definition.instructions ?? "").length <= MAX_WORKFLOW_INSTRUCTIONS_CHARS);
      assert.equal((definition.instructions ?? "").includes("CODARYN_SECRET"), false, "no privacy token marker");
    }
  });

  test("organize proposes only, never writes or runs commands (GT-D4, GT-D10)", () => {
    const organize = resolveWorkflow(input({ task: { workflowRef: "organize" } }));
    assert.ok(organize.ok);
    assert.equal(organize.settings.plan, "apply");
    assert.deepEqual([...organize.settings.tools].sort(), ["inspect_files", "propose_plan", "read_file", "search_files"]);
    assert.equal(BUILTIN_WORKFLOWS.organize.allowCommands, false);
    assert.deepEqual(BUILTIN_WORKFLOWS.organize.policy?.planActions, ["move", "discard"]);
  });

  test("analyze ends with a person's review after the checks (GT-D7)", () => {
    const analyze = resolveWorkflow(input({ task: { workflowRef: "analyze" } }));
    assert.ok(analyze.ok);
    assert.equal(analyze.settings.completion, "human_review");
    assert.ok((analyze.settings.humanReview?.checklist.length ?? 0) > 0);
    assert.equal(analyze.settings.tools.includes("run_command"), false);
  });
});

describe("resolveWorkflow (GT-U02)", () => {
  test("a task with none of the fields resolves to exactly the legacy settings (GT-U14)", () => {
    const outcome = resolveWorkflow(input());
    assert.ok(outcome.ok);
    assert.equal(outcome.workflowRef, null);
    assert.equal(outcome.settings, LEGACY_WORKFLOW_SETTINGS);
    assert.deepEqual(outcome.settings.tools, TOOL_NAMES);
  });

  test("the task's workflowRef wins over the profile's; an unknown id is unknown_workflow", () => {
    const both = resolveWorkflow(input({ task: { workflowRef: "document" }, profileWorkflowRef: "organize" }));
    assert.ok(both.ok && both.workflowRef === "document");
    const profile = resolveWorkflow(input({ profileWorkflowRef: "organize" }));
    assert.ok(profile.ok && profile.workflowRef === "organize");
    assert.deepEqual(resolveWorkflow(input({ task: { workflowRef: "nope" } })), { ok: false, problem: "unknown_workflow", field: "workflowRef" });
    assert.deepEqual(resolveWorkflow(input({ profileWorkflowRef: "nope" })), { ok: false, problem: "unknown_workflow", field: "profiles.workflowRef" });
    // Inherited names are not definitions.
    assert.equal(resolveWorkflow(input({ task: { workflowRef: "constructor" } })).ok, false);
  });

  test("tools only narrow", () => {
    const narrowed = resolveWorkflow(input({ task: { workflowRef: "document", tools: ["read_file", "read_file"] } }));
    assert.ok(narrowed.ok);
    assert.deepEqual(narrowed.settings.tools, ["read_file"]);
    assert.deepEqual(resolveWorkflow(input({ task: { workflowRef: "document", tools: ["read_file", "run_command"] } })), {
      ok: false,
      problem: "tool_not_allowed",
      field: "tools[1]",
    });
    // Without a definition the legacy tools are the ceiling.
    assert.equal(resolveWorkflow(input({ task: { tools: ["propose_plan"] } })).ok, false);
  });

  test("plan apply cannot be weakened; none may be strengthened", () => {
    assert.deepEqual(resolveWorkflow(input({ task: { workflowRef: "organize", plan: "none" } })), { ok: false, problem: "plan_weakened", field: "plan" });
    // U-224: strengthening needs the mode's plan tool among the tools; document offers none.
    assert.deepEqual(resolveWorkflow(input({ task: { workflowRef: "document", plan: "apply" } })), { ok: false, problem: "plan_tool_missing", field: "plan" });
    const withPlanTool = { ...definitions, "doc-plan": { tools: ["read_file", "search_files", "write_file", "propose_plan"] } satisfies WorkflowDefinition };
    const strengthened = resolveWorkflow(input({ definitions: withPlanTool, task: { workflowRef: "doc-plan", plan: "apply" } }));
    assert.ok(strengthened.ok && strengthened.settings.plan === "apply");
  });

  test("allowCommands false admits no command rule and drops run_command", () => {
    const custom: WorkflowDefinition = { tools: TOOL_NAMES, allowCommands: false };
    const withCustom = { ...definitions, strict: custom };
    assert.deepEqual(resolveWorkflow(input({ definitions: withCustom, task: { workflowRef: "strict" }, commandRules: 1 })), {
      ok: false,
      problem: "commands_not_allowed",
      field: "policy.commands",
    });
    const fine = resolveWorkflow(input({ definitions: withCustom, task: { workflowRef: "strict" } }));
    assert.ok(fine.ok);
    assert.equal(fine.settings.tools.includes("run_command"), false);
  });

  test("human review needs a checklist; verifiers admits none from the task and drops the definition's", () => {
    assert.deepEqual(resolveWorkflow(input({ task: { completion: "human_review" } })), {
      ok: false,
      problem: "review_without_checklist",
      field: "humanReview",
    });
    assert.deepEqual(resolveWorkflow(input({ task: { humanReview: { checklist: ["x"] } } })), {
      ok: false,
      problem: "checklist_without_review",
      field: "humanReview",
    });
    const dropped = resolveWorkflow(input({ task: { workflowRef: "analyze", completion: "verifiers" } }));
    assert.ok(dropped.ok && dropped.settings.humanReview === null);
    assert.deepEqual(resolveWorkflow(input({ task: { completion: "human_review", humanReview: { checklist: [] } } })), {
      ok: false,
      problem: "checklist_too_long",
      field: "humanReview.checklist",
    });
  });

  test("instructions over the limit are refused", () => {
    const long: WorkflowDefinition = { tools: TOOL_NAMES, instructions: "x".repeat(MAX_WORKFLOW_INSTRUCTIONS_CHARS + 1) };
    assert.deepEqual(resolveWorkflow(input({ definitions: { ...definitions, long }, task: { workflowRef: "long" } })), {
      ok: false,
      problem: "instructions_too_long",
      field: "workflows.instructions",
    });
  });
});
