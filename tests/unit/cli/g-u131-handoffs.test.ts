/**
 * U-131 (nc-human's U-129 hand-off, five places where the CLI's text said something the records did
 * not): the real CLI, scripted model, no key, every command behind the network guard. The JSON of
 * each command is unchanged; only the text for people is.
 * - N1 (AXM-21): a report of a reviewed run still said the run waited for a verdict. Now, with a
 *   verdict, it says how a later review replaces it instead.
 * - N2 (UXM-5): the report of a plan run whose plan was applied said it waited for approval. Now it
 *   says what became of the apply, by the rule of `runs` (planApplyStateOf).
 * - N3 (AXM-21): after `review --reject` of a run that changed files, nothing said how to undo
 *   them. Now the revert command follows (the workspace as the next commands give it).
 * - N4 (UXM-4, 5): `changes` of a plan run said only "the run changed no file". Now it says the run
 *   only made a plan, and which run applied it.
 * - N5 (UXM-15): applying a plan made with another task told so only in the end summary. Now also
 *   right after the apply's start line, and, at a terminal, before the approval question.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import type { TestContext } from "node:test";
import type { EngineResult, MessageId } from "../../../src/contracts/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { createSandbox } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { analyzeScript, organizeScript, salesDataChecks, writeGeneralTask, writeOrganizeTask, writeOrganizeWorkspace, writeSalesSource } from "../../fixtures/general-tasks.js";
import { cliEnv, expectRunResult } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { runGuarded } from "../../support/fake-anthropic.js";
import { applyArgs, planDigestOf, reviewArgs } from "../../support/general.js";

const english = createMessageCatalog("en");
const en = (id: string, params?: Record<string, unknown>): string => (english.format as (id: MessageId, params?: Record<string, unknown>) => string)(id as MessageId, params);

/** An analyze run that ended waiting for review; it wrote out/summary.csv and out/report.md. */
async function analysis(t: TestContext): Promise<{ sb: Sandbox; task: string; runId: string; cli: (args: readonly string[]) => Promise<CliRun> }> {
  const sb = createSandbox(t);
  writeSalesSource(sb);
  const task = writeGeneralTask(sb, {
    id: "u131-analyze",
    label: "analyze",
    goal: "data/sales.csv로 지역별 합계 표와 보고서를 만든다",
    fields: { workflowRef: "analyze" },
    policy: { protectedPaths: ["data"] },
    verifiers: [salesDataChecks()],
    limits: { maxRepairAttempts: 1 },
  }, analyzeScript());
  const cli = (args: readonly string[]): Promise<CliRun> => runGuarded(sb, args, cliEnv());
  const run = expectRunResult(await cli(["run", "--task", task]));
  assert.deepEqual([run.status, run.reason], ["needs-input", "awaiting_review"]);
  assert.ok(run.changes.length > 0, "the analysis changed files");
  return { sb, task, runId: run.runId, cli };
}

/** An organize plan run (plan_pending) and its digest. */
async function planned(t: TestContext): Promise<{ sb: Sandbox; task: string; plan: EngineResult; digest: string; cli: (args: readonly string[]) => Promise<CliRun> }> {
  const sb = createSandbox(t);
  writeOrganizeWorkspace(sb);
  const task = writeOrganizeTask(sb, "u131-organize", organizeScript());
  const cli = (args: readonly string[]): Promise<CliRun> => runGuarded(sb, args, cliEnv());
  const plan = expectRunResult(await cli(["run", "--task", task]));
  return { sb, task, plan, digest: planDigestOf(plan), cli };
}

describe("U-131 N1, N3: a reviewed run", () => {
  test("N1: before a verdict the report says the run waits; after one it says how a later review replaces it", async (t) => {
    const a = await analysis(t);
    const waiting = `The run waits for a person's verdict (\`codaryn review --run ${a.runId} --accept | --reject\`).`;
    const before = (await a.cli(["report", "--workspace", a.sb.workspace, "--run", a.runId])).stdout;
    assert.ok(before.includes(waiting) && before.includes("No verdict yet."), before);
    await a.cli(reviewArgs(a.task, a.runId, "reject"));
    const after = (await a.cli(["report", "--workspace", a.sb.workspace, "--run", a.runId])).stdout;
    assert.equal(after.includes(waiting), false, after);
    assert.ok(after.includes("Verdict: **rejected**"), after);
    assert.ok(after.includes(`A later review replaces it: \`codaryn review --run ${a.runId} --accept | --reject\`.`), after);
  });

  test("N3: --reject of a run that changed files gives the revert command; --accept does not", async (t) => {
    const a = await analysis(t);
    const rejected = await a.cli(reviewArgs(a.task, a.runId, "reject", undefined, false));
    assert.ok(rejected.stdout.includes(en("summary.next_revert", { runId: a.runId })), rejected.stdout);
    const accepted = await a.cli(reviewArgs(a.task, a.runId, "accept", undefined, false));
    assert.equal(accepted.stdout.includes("codaryn revert"), false, accepted.stdout);
    const json = JSON.parse((await a.cli(reviewArgs(a.task, a.runId, "reject"))).stdout.trim()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(json).sort(), ["checklist", "exitCode", "kind", "replaced", "runId", "schemaVersion", "verdict"], "review --json is as before");
  });
});

describe("U-131 N2, N4: a plan run and its apply", () => {
  test("N2 and N4 before the apply: the report waits for approval as before; changes says the run only made a plan", async (t) => {
    const p = await planned(t);
    const report = (await p.cli(["report", "--workspace", p.sb.workspace, "--run", p.plan.runId])).stdout;
    assert.ok(report.includes("waiting for approval"), report);
    const changes = (await p.cli(["changes", "--task", p.task, "--run", p.plan.runId])).stdout;
    assert.ok(changes.includes(en("changes.plan_only")), changes);
    assert.equal(changes.includes(en("changes.none")), false, changes);
  });

  test("N2 and N4 after the apply: the report and changes name the apply run; their JSON is as before", async (t) => {
    const p = await planned(t);
    const applied = JSON.parse((await p.cli(applyArgs(p.task, p.plan.runId, p.digest))).stdout.trim()) as { runId: string; status: string };
    assert.equal(applied.status, "done");
    const report = (await p.cli(["report", "--workspace", p.sb.workspace, "--run", p.plan.runId])).stdout;
    assert.equal(report.includes("waiting for approval"), false, report);
    assert.ok(report.includes(`- Plan: ${p.plan.plan?.actions} action(s), applied by run \`${applied.runId}\` (its report: \`codaryn report --run ${applied.runId}\`).`), report);
    const changes = (await p.cli(["changes", "--task", p.task, "--run", p.plan.runId])).stdout;
    assert.ok(changes.includes(en("changes.plan_only")) && changes.includes(en("changes.plan_applied", { runId: applied.runId })), changes);
    const reportJson = JSON.parse((await p.cli(["report", "--workspace", p.sb.workspace, "--run", p.plan.runId, "--json"])).stdout.trim()) as { result: { plan: unknown } };
    assert.deepEqual(reportJson.result.plan, p.plan.plan, "report --json is as before");
    const changesJson = JSON.parse((await p.cli(["changes", "--task", p.task, "--run", p.plan.runId, "--json"])).stdout.trim()) as Record<string, unknown>;
    assert.deepEqual([changesJson["files"], "applyRun" in changesJson], [[], false], "changes --json is as before");
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.resolve(here, "..", "..", "..", "src", "cli", "main.js");
const TERMINAL = pathToFileURL(path.join(here, "u115-terminal-preload.js")).href;
const GUARD = pathToFileURL(path.resolve(here, "..", "..", "support", "net-guard.js")).href;

describe("U-131 N5: a plan applied with another task is told at the start and before the question", () => {
  /** The plan made with the task file; the apply in the quick form with organize (another task id). */
  async function quickApply(t: TestContext) {
    const p = await planned(t);
    const config = path.join(p.sb.base, "u131-config.json");
    writeFileSync(config, JSON.stringify({ schemaVersion: 1, limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 10_000, maxDurationMs: 60_000 }, policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move", "discard"] } }));
    return { p, quick: ["apply", "--workspace", p.sb.workspace, "--workflow", "organize", "--config", config, "--run", p.plan.runId] };
  }
  const NOTICE = en("apply.notice.plan_task_differs");

  test("the progress lines: the notice right after the start line; the end summary keeps it", async (t) => {
    const { p, quick } = await quickApply(t);
    const run = await p.cli([...quick, "--digest", p.digest]);
    const lines = run.stderr.split("\n");
    const start = lines.findIndex((line) => line.startsWith("codaryn: apply started"));
    assert.ok(start >= 0, run.stderr);
    assert.equal(lines[start + 1], `codaryn: ${NOTICE}`, run.stderr);
    assert.ok(lines.slice(start + 2).some((line) => line.includes(NOTICE)), "the end summary still tells it");
  });

  test("at a terminal: the notice comes before the approval question", async (t) => {
    const { p, quick } = await quickApply(t);
    const env: Record<string, string> = { ...(cliEnv() as Record<string, string>), CODARYN_TEST_TERMINAL: "stdin,stderr", CODARYN_IT_NET_GUARD_LOG: path.join(p.sb.base, "net-guard.log") };
    const run = spawnSync(process.execPath, ["--import", GUARD, "--import", TERMINAL, MAIN, ...quick], { cwd: p.sb.base, env, encoding: "utf8", input: "n\n" });
    assert.equal(run.status, 2, run.stderr);
    const notice = run.stderr.indexOf(NOTICE);
    const question = run.stderr.indexOf(en("apply.question"));
    assert.ok(notice >= 0 && question > notice, run.stderr);
  });
});
