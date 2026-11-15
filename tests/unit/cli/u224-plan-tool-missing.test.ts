/**
 * U-224 (nd-docs' finding after U-195): a task type whose resolved plan mode is "run" without
 * propose_changes among its tools, or "apply" without propose_plan, could never store a plan; such a
 * run ended failed/model_error ("propose_changes did not succeed"). resolveWorkflow now refuses it
 * before anything runs (`plan_tool_missing`), with the field to fix: the definition's list, the
 * task's narrower list, or the task's own plan mode. Valid plan definitions (organize, a run
 * definition with propose_changes) resolve as before, and the earlier problems keep their order.
 * On the real CLI the refusal is invalid_config or invalid_task and no run is made.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { LEGACY_WORKFLOW_SETTINGS } from "../../../src/contracts/index.js";
import type { ResolveWorkflowInput, WorkflowDefinition } from "../../../src/contracts/index.js";
import { resolveWorkflow, workflowDefinitions } from "../../../src/workflows/index.js";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { runGuarded } from "../../support/fake-anthropic.js";
import { writeConfigFile } from "../../fixtures/anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { textStep, writeGeneralTask } from "../../fixtures/general-tasks.js";

const READ_WRITE = ["read_file", "search_files", "write_file"] as const;
const DEFINITIONS: { readonly [id: string]: WorkflowDefinition } = {
  ...workflowDefinitions(undefined),
  "run-no-tool": { tools: [...READ_WRITE], plan: "run" },
  "apply-no-tool": { tools: ["read_file", "search_files", "inspect_files"], plan: "apply" },
  rewrite: { tools: [...READ_WRITE, "propose_changes"], plan: "run" },
  "none-with-plan-tool": { tools: [...READ_WRITE, "propose_plan"] },
};

const resolve = (task: ResolveWorkflowInput["task"], profileWorkflowRef: string | null = null) =>
  resolveWorkflow({ definitions: DEFINITIONS, task, profileWorkflowRef, commandRules: 0 });
const missing = (field: string) => ({ ok: false, problem: "plan_tool_missing", field });

describe("U-224: resolveWorkflow refuses a plan mode without its plan tool", () => {
  test("a definition's run or apply without the tool: the definition's list", () => {
    assert.deepEqual(resolve({ workflowRef: "run-no-tool" }), missing("workflows.tools"));
    assert.deepEqual(resolve({ workflowRef: "apply-no-tool" }), missing("workflows.tools"));
    assert.deepEqual(resolve({}, "run-no-tool"), missing("workflows.tools"), "named by the profile");
  });

  test("a task's narrower list that leaves the definition's plan tool out: the task's tools", () => {
    assert.deepEqual(resolve({ workflowRef: "organize", tools: ["read_file", "search_files"] }), missing("tools"));
    assert.deepEqual(resolve({ workflowRef: "rewrite", tools: ["read_file", "write_file"] }), missing("tools"));
  });

  test("a task's own plan mode where no plan tool is offered: the task's plan", () => {
    for (const plan of ["apply", "run"] as const) {
      assert.deepEqual(resolve({ plan }), missing("plan"), `legacy ${plan}`);
      assert.deepEqual(resolve({ workflowRef: "document", plan }), missing("plan"), `document ${plan}`);
    }
  });

  test("valid plan definitions resolve as before; none needs no plan tool", () => {
    const organize = resolve({ workflowRef: "organize" });
    assert.ok(organize.ok && organize.settings.plan === "apply" && organize.settings.tools.includes("propose_plan"));
    const rewrite = resolve({ workflowRef: "rewrite" });
    assert.ok(rewrite.ok && rewrite.settings.plan === "run");
    const strengthened = resolve({ workflowRef: "none-with-plan-tool", plan: "apply" });
    assert.ok(strengthened.ok && strengthened.settings.plan === "apply");
    for (const workflowRef of ["general", "code", "document", "analyze"]) {
      assert.ok(resolve({ workflowRef }).ok, workflowRef);
    }
    const legacy = resolve({});
    assert.ok(legacy.ok);
    assert.strictEqual(legacy.settings, LEGACY_WORKFLOW_SETTINGS);
  });

  test("the earlier problems keep their place: plan_weakened, then the other mode's tool", () => {
    assert.deepEqual(resolve({ workflowRef: "run-no-tool", plan: "none" }), { ok: false, problem: "plan_weakened", field: "plan" });
    assert.deepEqual(resolve({ workflowRef: "none-with-plan-tool", plan: "run" }), { ok: false, problem: "tool_not_allowed", field: "workflows.tools" });
  });
});

const json = (run: CliRun): Record<string, unknown> => JSON.parse(run.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;
const runsOf = (sb: Sandbox): string[] => {
  const runs = path.join(sb.workspace, ".codaryn", "runs");
  return existsSync(runs) ? readdirSync(runs) : [];
};

describe("U-224 on the real CLI: refused before the run", () => {
  test("a config's run definition without propose_changes is invalid_config, and no run is made", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "README.md", "# Title\n");
    const config = writeConfigFile(sb, { schemaVersion: 1, workflows: { "run-no-tool": { tools: [...READ_WRITE], plan: "run" } } }, "c.json");
    const task = writeGeneralTask(sb, { id: "u224-config", fields: { workflowRef: "run-no-tool" } }, [textStep("not requested")]);
    const run = await runGuarded(sb, ["run", "--task", task, "--config", config], cliEnv());
    const output = json(run);
    assert.notEqual(run.exitCode, 0);
    assert.equal(output["code"], "invalid_config", run.stdout);
    assert.match(String(output["message"]), /workflows\.tools leaves out the plan tool of the plan mode/);
    assert.deepEqual(runsOf(sb), []);
  });

  test("a task file's own plan run without the tool is invalid_task, and no run is made", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "README.md", "# Title\n");
    const task = writeGeneralTask(sb, { id: "u224-task", fields: { plan: "run" } }, [textStep("not requested")]);
    const run = await runGuarded(sb, ["run", "--task", task], cliEnv());
    const output = json(run);
    assert.notEqual(run.exitCode, 0);
    assert.equal(output["code"], "invalid_task", run.stdout);
    assert.match(String(output["message"]), /plan leaves out the plan tool of the plan mode/);
    assert.deepEqual(runsOf(sb), []);
  });
});
