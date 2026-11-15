/**
 * U-228 (nd-docs' findings on the plan run, after U-195 and U-216): what the CLI tells a person.
 * - apply's question for a plan of files to write: nc-human's changesApprovalText and
 *   changesApplyQuestion were there but apply asked the moves plan's apply.question. Now a terminal
 *   apply of such a plan says what approving starts (apply.changes.what, the summary's note, the
 *   commands' note when commands are allowed) and asks apply.changes_question.
 * - apply with a task of the other plan kind (a plan of files to write with a plan "apply" task, or a
 *   plan of moves with a plan "run" task, or a task with no task type): the human line said "that run
 *   has no stored plan" and to give a plan_pending run, although the run has a plan; the JSON message
 *   for a task with no task type spoke of plan "apply" only. Now the line says the plan is of another
 *   kind and the fix is to give the task the plan run used (hint plan_kind_differs); the JSON code is
 *   run_not_plan as before, and the message names the plan's kind.
 * - a plan mode without its plan tool (U-224's plan_tool_missing, refused at resolution): the human
 *   error said to fix "the named field" without one and to check with doctor, which found nothing.
 *   Now the error has a hint line that says which tool each plan mode needs, and doctor fails the check
 *   of the file to fix (the task file, or the config file for a task type or a profile).
 * Scripted model, temporary folders, no network.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import type { TestContext } from "node:test";
import type { MessageId } from "../../../src/contracts/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { runGuarded } from "../../support/fake-anthropic.js";
import { writeConfigFile } from "../../fixtures/anthropic.js";
import { createSandbox, nodeCommand, writeWorkspaceFile } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { proposePlanArgs, textStep, toolStep, writeGeneralTask } from "../../fixtures/general-tasks.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.resolve(here, "..", "..", "..", "src", "cli", "main.js");
const TERMINAL = pathToFileURL(path.join(here, "u110-terminal-preload.js")).href;
const GUARD = pathToFileURL(path.resolve(here, "..", "..", "support", "net-guard.js")).href;

const LIMITS = { maxModelTurns: 8, maxToolCalls: 24, maxTotalTokens: 1000, maxDurationMs: 60_000 };
const READ_WRITE = ["read_file", "search_files", "write_file"];
const WORKFLOWS = {
  rewrite: { tools: [...READ_WRITE, "propose_changes"], plan: "run" },
  "run-no-tool": { tools: [...READ_WRITE], plan: "run" },
};
const OLD_WHAT = "that run has no stored plan";
const OLD_FIX = "plan_pending";

const en = createMessageCatalog("en");
const text = (id: string, params?: Record<string, unknown>): string => (en.format as (id: MessageId, params?: unknown) => string)(id as MessageId, params);
const json = (run: CliRun): Record<string, unknown> => JSON.parse(run.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;

interface Planned {
  readonly sb: Sandbox;
  readonly config: string;
  readonly rewrite: string;
  readonly organize: string;
  readonly plain: string;
  readonly changes: { readonly runId: string; readonly digest: string };
  readonly moves: { readonly runId: string; readonly digest: string };
}

/** A workspace with a plan of files to write (rewrite) and a plan of moves (organize). */
async function planned(t: TestContext): Promise<Planned> {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "docs/guide.md", "old guide\n");
  writeWorkspaceFile(sb, "inbox/a.txt", "a\n");
  const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, workflows: WORKFLOWS }, "c.json");
  // Each task beside the script (its scriptPath is relative to the task file).
  const write = (name: string, fields: Record<string, unknown>, policy: Record<string, unknown> = {}): string => {
    const file = writeGeneralTask(sb, { id: name, goal: "rewrite the guide", fields: fields as never, policy: policy as never });
    const target = path.join(sb.base, `${name}.json`);
    writeFileSync(target, readFileSync(file, "utf8"));
    return target;
  };
  const rewrite = write("rewrite", { workflowRef: "rewrite" });
  const organize = write("organize", { workflowRef: "organize" }, { planActions: ["move", "discard"] });
  const plain = write("plain", {});
  const plan = async (task: string, steps: readonly unknown[]): Promise<{ runId: string; digest: string }> => {
    writeFileSync(sb.scriptPath, JSON.stringify({ schemaVersion: 1, steps }));
    const made = json(await runGuarded(sb, ["run", "--task", task, "--config", config], cliEnv()));
    assert.equal(made["reason"], "plan_pending", JSON.stringify(made));
    return { runId: String(made["runId"]), digest: String((made["plan"] as { digest: string }).digest) };
  };
  const changes = await plan(rewrite, [
    toolStep("propose_changes", { summary: "rewrite the guide and add a page", files: [{ path: "docs/guide.md", change: "modify" }, { path: "docs/new.md", change: "create" }] }),
    textStep("planned"),
  ]);
  const moves = await plan(organize, [toolStep("propose_plan", proposePlanArgs([{ kind: "move", from: "inbox/a.txt", to: "docs/a.txt" }], "move a")), textStep("planned")]);
  return { sb, config, rewrite, organize, plain, changes, moves };
}

/** apply at a terminal (stdin and stderr are terminals), answering `answer`. */
function applyAtTerminal(p: Planned, task: string, runId: string, answer: string): ReturnType<typeof spawnSync> & { stderr: string; stdout: string } {
  const env: Record<string, string> = { ...(cliEnv() as Record<string, string>), CODARYN_TEST_TERMINAL: "stdin,stderr", CODARYN_IT_NET_GUARD_LOG: path.join(p.sb.base, "net-guard.log") };
  return spawnSync(process.execPath, ["--import", GUARD, "--import", TERMINAL, MAIN, "apply", "--task", task, "--config", p.config, "--run", runId], {
    cwd: p.sb.base,
    env,
    encoding: "utf8",
    input: answer,
  }) as ReturnType<typeof spawnSync> & { stderr: string; stdout: string };
}

describe("U-228: apply asks its own question for a plan of files to write", () => {
  test("at a terminal: what approving starts, the summary's note, and apply.changes_question; no is not approved", { timeout: 90_000 }, async (t) => {
    const p = await planned(t);
    const declined = applyAtTerminal(p, p.rewrite, p.changes.runId, "n\n");
    assert.equal(json({ stdout: declined.stdout } as CliRun)["code"], "plan_not_approved", declined.stdout);
    assert.ok(declined.stderr.includes(text("apply.changes.what", { count: 2 })), declined.stderr);
    assert.ok(declined.stderr.includes(text("apply.changes.summary_note")), declined.stderr);
    assert.ok(declined.stderr.includes(`${text("apply.changes_question")} ${text("prompt.yes_no_default_no")}`), declined.stderr);
    assert.equal(declined.stderr.includes(text("apply.question")), false, "not the question for a plan of moves");
    assert.equal(declined.stderr.includes(text("apply.changes.commands_note")), false, "no command is allowed");
  });

  test("with a command rule the question tells that commands are not bound to the files; a plan of moves keeps apply.question", { timeout: 90_000 }, async (t) => {
    const p = await planned(t);
    const script = path.join(p.sb.base, "tool.js");
    writeFileSync(script, "process.exit(0)\n");
    const withRule = path.join(p.sb.base, "rewrite-rule.json");
    const base = JSON.parse(readFileSync(p.rewrite, "utf8")) as { policy: Record<string, unknown> };
    writeFileSync(withRule, JSON.stringify({ ...base, policy: { ...base.policy, commands: [{ ...nodeCommand(script), argsPrefix: [script] }] } }));
    const asked = applyAtTerminal(p, withRule, p.changes.runId, "n\n");
    assert.ok(asked.stderr.includes(text("apply.changes.commands_note")), asked.stderr);
    const moves = applyAtTerminal(p, p.organize, p.moves.runId, "n\n");
    assert.ok(moves.stderr.includes(`${text("apply.question")} ${text("prompt.yes_no_default_no")}`), moves.stderr);
    assert.equal(moves.stderr.includes(text("apply.changes_question")), false, moves.stderr);
  });
});

describe("U-228: apply with a task of the other plan kind tells that the run has a plan", () => {
  const otherKind = (run: CliRun): void => {
    const output = json(run);
    assert.equal(output["code"], "run_not_plan", run.stdout);
    assert.equal(output["hint"], "plan_kind_differs", run.stdout);
    assert.equal(run.stderr.includes(OLD_WHAT) || run.stderr.includes(OLD_FIX), false, run.stderr);
    assert.ok(run.stderr.includes(text("error.run_not_plan.other_kind")), run.stderr);
    assert.ok(run.stderr.includes(text("error.hint.plan_kind_differs")), run.stderr);
  };

  test("a plan of files to write with a plan apply task, and a plan of moves with a plan run task: the JSON messages as before", { timeout: 90_000 }, async (t) => {
    const p = await planned(t);
    const first = await runGuarded(p.sb, ["apply", "--task", p.organize, "--config", p.config, "--run", p.changes.runId, "--digest", p.changes.digest.slice(0, 12)], cliEnv());
    otherKind(first);
    assert.equal(
      json(first)["message"],
      'that run made a plan of files to write (plan "run"), but the task given to apply resolves to plan "apply"; give the task the plan run used; nothing was moved',
    );
    const second = await runGuarded(p.sb, ["apply", "--task", p.rewrite, "--config", p.config, "--run", p.moves.runId, "--digest", p.moves.digest.slice(0, 12)], cliEnv());
    otherKind(second);
    assert.equal(
      json(second)["message"],
      'that run made a plan of moves and discards (plan "apply"), but the task given to apply resolves to plan "run"; give the task the plan run used; nothing was run',
    );
  });

  test("a task with no task type: the message names the plan's kind; a run with no plan keeps the line of before", { timeout: 90_000 }, async (t) => {
    const p = await planned(t);
    const changes = await runGuarded(p.sb, ["apply", "--task", p.plain, "--config", p.config, "--run", p.changes.runId, "--digest", p.changes.digest.slice(0, 12)], cliEnv());
    otherKind(changes);
    assert.equal(
      json(changes)["message"],
      'that run made a plan of files to write (plan "run"), but the task given to apply resolves to no plan mode; give the task the plan run used; nothing was moved or run',
    );
    const moves = await runGuarded(p.sb, ["apply", "--task", p.plain, "--config", p.config, "--run", p.moves.runId, "--digest", p.moves.digest.slice(0, 12)], cliEnv());
    otherKind(moves);
    assert.match(String(json(moves)["message"]), /^that run made a plan of moves and discards \(plan "apply"\), but the task given to apply resolves to no plan mode/);
    // A run that made no plan: still run_not_plan, no hint, the line of before.
    writeFileSync(p.sb.scriptPath, JSON.stringify({ schemaVersion: 1, steps: [textStep("no plan")] }));
    const plainRun = json(await runGuarded(p.sb, ["run", "--task", p.plain, "--config", p.config], cliEnv()));
    const none = await runGuarded(p.sb, ["apply", "--task", p.plain, "--config", p.config, "--run", String(plainRun["runId"]), "--digest", "0".repeat(12)], cliEnv());
    const output = json(none);
    assert.deepEqual([output["code"], output["hint"]], ["run_not_plan", undefined], none.stdout);
    assert.equal(output["message"], 'the task given to apply resolves to no plan mode (neither plan "apply" nor plan "run"); nothing was moved or run');
    assert.ok(none.stderr.includes(OLD_WHAT), none.stderr);
  });
});

describe("U-228: a plan mode without its plan tool (U-224) is told to a person and by doctor", () => {
  test("a task type's plan run without propose_changes: the hint line; doctor fails the config file's check", { timeout: 90_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "README.md", "# Title\n");
    const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, workflows: WORKFLOWS }, "c.json");
    const task = writeGeneralTask(sb, { id: "u228-no-tool", fields: { workflowRef: "run-no-tool" } }, [textStep("not requested")]);
    const ran = await runGuarded(sb, ["run", "--task", task, "--config", config], cliEnv());
    const output = json(ran);
    assert.deepEqual([output["code"], output["hint"]], ["invalid_config", "plan_tool_missing"], ran.stdout);
    assert.match(String(output["message"]), /^workflows\.tools leaves out the plan tool of the plan mode/);
    assert.ok(ran.stderr.includes(text("error.hint.plan_tool_missing")), ran.stderr);
    const doctor = await runGuarded(sb, ["doctor", "--task", task, "--config", config, "--json"], cliEnv());
    const checks = (JSON.parse(doctor.stdout) as { checks: { id: string; status: string; message: string; text?: { id: string } }[] }).checks;
    const configCheck = checks.find((check) => check.id === "config_file");
    assert.deepEqual([configCheck?.status, configCheck?.text?.id], ["fail", "doctor.config_file.plan_tool_missing"], doctor.stdout);
    assert.match(String(configCheck?.message), /^workflows\.tools leaves out the plan tool of the plan mode/);
    assert.equal(checks.find((check) => check.id === "task_file")?.status, "ok");
    assert.notEqual(doctor.exitCode, 0);
  });

  test("a task file's own plan run with no task type: the hint line; doctor fails the task file's check", { timeout: 90_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "README.md", "# Title\n");
    const task = writeGeneralTask(sb, { id: "u228-own-plan", fields: { plan: "run" } }, [textStep("not requested")]);
    const ran = await runGuarded(sb, ["run", "--task", task], cliEnv({ extra: { CODARYN_LANG: "ko" } }));
    const output = json(ran);
    assert.deepEqual([output["code"], output["hint"]], ["invalid_task", "plan_tool_missing"], ran.stdout);
    assert.ok(ran.stderr.includes((createMessageCatalog("ko").format as (id: MessageId) => string)("error.hint.plan_tool_missing" as MessageId)), ran.stderr);
    const doctor = await runGuarded(sb, ["doctor", "--task", task, "--json"], cliEnv());
    const checks = (JSON.parse(doctor.stdout) as { checks: { id: string; status: string; message: string; text?: { id: string } }[] }).checks;
    const taskCheck = checks.find((check) => check.id === "task_file");
    assert.deepEqual([taskCheck?.status, taskCheck?.text?.id], ["fail", "doctor.task_file.plan_tool_missing"], doctor.stdout);
    assert.match(String(taskCheck?.message), /^plan leaves out the plan tool of the plan mode/);
  });

  test("a profile naming such a task type, without a task file: doctor fails the config file's check; a valid one is ok", { timeout: 90_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "README.md", "# Title\n");
    const doctorFor = async (profile: string): Promise<{ status?: string; textId?: string }> => {
      const config = writeConfigFile(sb, { schemaVersion: 1, model: "fake-model-id", maxOutputTokens: 1000, limits: LIMITS, workflows: WORKFLOWS, profiles: { p: { workflowRef: profile } } }, `${profile}.json`);
      const doctor = await runGuarded(sb, ["doctor", "--workspace", sb.workspace, "--profile", "p", "--config", config, "--json"], cliEnv());
      const check = (JSON.parse(doctor.stdout) as { checks: { id: string; status: string; text?: { id: string } }[] }).checks.find((entry) => entry.id === "config_file");
      return { ...(check?.status === undefined ? {} : { status: check.status }), ...(check?.text?.id === undefined ? {} : { textId: check.text.id }) };
    };
    assert.deepEqual(await doctorFor("run-no-tool"), { status: "fail", textId: "doctor.config_file.plan_tool_missing" });
    assert.equal((await doctorFor("rewrite")).status, "ok");
  });
});
