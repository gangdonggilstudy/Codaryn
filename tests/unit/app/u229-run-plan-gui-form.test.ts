/**
 * Unit U-229 (after U-218): the app's answers to a run plan with the form the GUI sends - a workspace,
 * a config file and the workflow (TaskForm input "workspace" with workflowRef), as the GUI's plan
 * screen passes them to checkApply and applyPlan. U-218's tests used the plan run's task file; the
 * workspace form reads the run settings from the config file (limits, the provider and its model),
 * as the GUI's config has them. These answers are the ones p5u-gui adapts to (the table in the U-229
 * report): with a config whose workflow has plan "run", the check is a plan_check of kind changes and
 * the apply starts the carrying run (a new run id; its records reach onRunEvent; the result names the
 * plan run); the plan view says applied afterwards; a workflow without plan "run" is run_not_plan for
 * both. Measured against main cff3c764 the same way: there the apply ended as internal_error.
 * The provider is the app's createAnthropicProvider hook replaying the script; the key is a fake value
 * built from parts. Temporary folders, nothing sent.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppError, AppHooks, CodarynApp, PlanCheck, RunEvent, TaskForm } from "../../../src/app/index.js";
import type { EngineResult } from "../../../src/contracts/index.js";
import { createScriptedProvider } from "../../../src/model/scripted.js";
import { WRITE_NOTES, appEnvironment, setupRun, taskRequest } from "./support.js";

const REWRITE_TOOLS = ["read_file", "search_files", "write_file", "propose_changes"];
/** A token limit that is a number needs usage on every scripted step. */
const USAGE = { usage: { inputTokens: 10, outputTokens: 5 } };
const PROPOSE = { ...USAGE, toolCalls: [{ name: "propose_changes", args: { summary: "add the notes", files: [{ path: "NOTES.md", change: "create" }] } }] };
const LIMITS = { maxModelTurns: 6, maxToolCalls: 10, maxTotalTokens: 100_000, maxDurationMs: 60_000 };
/** The run settings the workspace form reads from the config file, as the GUI's config has them. */
const RUN_SETTINGS = {
  provider: "anthropic",
  providers: { anthropic: { model: "claude-u229-model", maxOutputTokens: 1024 } },
  limits: LIMITS,
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
};
const FAKE_KEY = ["cdy-fake", "u229", "anthropic", "value", "0001"].join("-");

type Done = { readonly ok: true; readonly output: EngineResult & { readonly planRunId?: string; readonly planDigest?: string }; readonly lockLeft?: true } | { readonly ok: false; readonly error: AppError };

interface Made {
  readonly app: CodarynApp;
  readonly work: string;
  readonly planRunId: string;
  readonly digest: string;
  /** The GUI's form: the workspace, a config file and the workflow. */
  readonly form: (plan: "run" | "none") => TaskForm;
}

/** A run plan made through the app (the plan run's task file), then the carrying run's steps in the script. */
async function runPlanMade(): Promise<Made> {
  const base = await setupRun({}, { workflowRef: "rewrite", limits: LIMITS }, [PROPOSE, { ...USAGE, text: "planned" }]);
  const configs = { run: path.join(base, "config.json"), none: path.join(base, "config-none.json") };
  await writeFile(configs.run, JSON.stringify({ schemaVersion: 1, ...RUN_SETTINGS, workflows: { rewrite: { tools: REWRITE_TOOLS, plan: "run" } } }));
  await writeFile(configs.none, JSON.stringify({ schemaVersion: 1, ...RUN_SETTINGS, workflows: { rewrite: { tools: REWRITE_TOOLS } } }));
  const script = path.join(base, "script.json");
  const hooks = { createAnthropicProvider: () => createScriptedProvider(JSON.parse(readFileSync(script, "utf8"))) } as unknown as AppHooks;
  const app = createCodarynApp(await appEnvironment(base, { env: { ...(await appEnvironment(base)).env, ANTHROPIC_API_KEY: FAKE_KEY } }), hooks);
  const started = await app.startRun(taskRequest(base, { configPath: configs.run }));
  assert.ok(started.ok, JSON.stringify(started));
  const ended = await started.handle.done;
  assert.ok(ended.ok, JSON.stringify(ended));
  const plan = ended.result.plan as { digest: string; kind?: string } | undefined;
  assert.deepEqual([ended.result.reason, plan?.kind], ["plan_pending", "changes"], JSON.stringify(ended.result));
  await writeFile(script, JSON.stringify({ schemaVersion: 1, steps: [{ ...USAGE, ...WRITE_NOTES }, { ...USAGE, text: "done" }] }));
  const work = path.join(base, "work");
  return {
    app,
    work,
    planRunId: ended.result.runId,
    digest: (plan as { digest: string }).digest,
    form: (kind) => ({ input: { kind: "workspace", workspace: work }, configPath: configs[kind], varsFile: null, profile: null, workflowRef: "rewrite" }),
  };
}

const request = (made: Made, form: TaskForm, more: Record<string, unknown> = {}) => ({ settings: form, planRunId: made.planRunId, digest: made.digest, cancelFile: null, unsafeMoveConsent: null, ...more });
const failed = (outcome: { ok: boolean }): string => (outcome as unknown as { error: AppError }).error.code;

describe("U-229: a run plan with the GUI's form (workspace, config, workflow)", () => {
  test("a workflow with plan \"run\": checked, carried out by a new run whose records reach onRunEvent, then applied", async () => {
    const made = await runPlanMade();
    const form = made.form("run");
    const checked = await made.app.checkApply({ settings: form, planRunId: made.planRunId, digest: made.digest });
    assert.ok(checked.ok, JSON.stringify(checked));
    const check = (checked as { output: PlanCheck }).output;
    assert.deepEqual([check.kind, check.planKind, check.problems, check.lockLeft], ["plan_check", "changes", [], false]);

    const runEvents: RunEvent[] = [];
    let applyEvents = 0;
    const applied = await made.app.applyPlan(request(made, form), { onEvent: () => (applyEvents += 1), onRunEvent: (event: RunEvent) => runEvents.push(event) } as never);
    assert.ok(applied.ok, JSON.stringify(applied));
    assert.equal(runEvents.length, 0, "no event before the handle");
    assert.notEqual(applied.handle.runId, made.planRunId);
    const done = (await applied.handle.done) as unknown as Done;
    assert.ok(done.ok, JSON.stringify(done));
    assert.deepEqual([done.output.kind, done.output.runId, done.output.planRunId, done.output.planDigest, done.lockLeft], ["run", applied.handle.runId, made.planRunId, made.digest, undefined]);
    assert.equal(await readFile(path.join(made.work, "NOTES.md"), "utf8"), "# Notes\n");
    const types = runEvents.flatMap((event) => (event.kind === "record" ? [event.record.type] : []));
    assert.deepEqual([types[0], types.at(-1), types.includes("file_changed")], ["run_started", "run_finished", true], types.join(","));
    assert.equal(applyEvents, 0, "no apply events: no move is made");

    const view = await made.app.plan({ settings: form, runId: made.planRunId });
    assert.ok(view.ok, JSON.stringify(view));
    assert.deepEqual([(view.output as { planKind?: string }).planKind, (view.output as { status?: string }).status], ["changes", "applied"]);
    assert.equal(failed(await made.app.checkApply({ settings: form, planRunId: made.planRunId, digest: made.digest })), "plan_already_applied");
    assert.equal(failed(await made.app.applyPlan(request(made, form))), "plan_already_applied");
  });

  test("the refusals: a digest that is not the plan's, the move consent, a workflow without plan \"run\"", async () => {
    const made = await runPlanMade();
    assert.equal(failed(await made.app.applyPlan(request(made, made.form("run"), { digest: "0".repeat(64) }))), "plan_not_approved");
    assert.equal(failed(await made.app.applyPlan(request(made, made.form("run"), { unsafeMoveConsent: { digest: made.digest } }))), "invalid_arguments");
    assert.equal(failed(await made.app.applyPlan(request(made, made.form("none")))), "run_not_plan");
    assert.equal(failed(await made.app.checkApply({ settings: made.form("none"), planRunId: made.planRunId, digest: made.digest })), "run_not_plan");
    // Nothing was carried out.
    await assert.rejects(readFile(path.join(made.work, "NOTES.md"), "utf8"));
  });
});
