/**
 * U-221 (ne-verify's U-217 F-1, nd-docs' findings): the human texts of a run plan (`plan: "run"`)
 * that disagreed with each other, on the real CLI (a process, scripted model, temporary folders):
 * (1) the end summary of the run that made a run plan used a plan of moves' words ("A plan is ready:
 *     actions 2", and the description "not what you approve"): now as the plan view says it, files to
 *     write and the plan's summary approved with the plan (plan.changes.summary_label);
 * (2) a carried-out plan whose run ended without checks (needs-input/no_verifier) had three names:
 *     runs "plan apply not finished", plan "applied", report "carried out by run …, which ended as
 *     no_verifier": now runs and the plan view say "carried out" as the report does;
 * (3) the writablePaths advice came twice, in the progress line and again in the end summary: now
 *     once, in the progress line written right before the end summary; the summary keeps its count.
 * A plan of moves' texts are pinned as they were, character for character.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { toRunId } from "../../../src/contracts/index.js";
import type { CatalogText, ChangesPlanOutput, ContentHash, EngineResult, JsonObject, MaskedText, MessageCatalog, PlanOutput, RunId, RunListEntry, RunsOutput, RunSummaryContext } from "../../../src/contracts/index.js";
import { createHumanOutput, renderChangesPlan } from "../../../src/cli/human/index.js";
import { renderPlan } from "../../../src/cli/plan-commands.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { runGuarded } from "../../support/fake-anthropic.js";
import { writeConfigFile } from "../../fixtures/anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { createFileArgs, textStep, toolStep, writeGeneralTask } from "../../fixtures/general-tasks.js";

const OLD_GUIDE = "old guide\n";
const LIMITS = { maxModelTurns: 10, maxToolCalls: 24, maxTotalTokens: 200_000, maxDurationMs: 60_000 };
const REWRITE = { tools: ["read_file", "search_files", "write_file", "propose_changes"], plan: "run" };
const PLANNED = [
  { path: "docs/guide.md", change: "modify" },
  { path: "docs/new.md", change: "create" },
];
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const json = (run: CliRun): Record<string, unknown> => JSON.parse(run.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;
/** Catalog lines by id, loosely typed, so this file builds before the new ids exist. */
const say = (catalog: MessageCatalog, id: string, params: object = {}): string => (catalog.format as (id: string, params: object) => string)(id, params);
const en = createMessageCatalog("en");
const ADVICE = "add it to writablePaths";
const occurrences = (text: string, part: string): number => text.split(part).length - 1;

interface Planned {
  readonly form: readonly string[];
  readonly runId: string;
  readonly digest: string;
  readonly made: CliRun;
}

/** A run plan of docs/guide.md and docs/new.md, made with a config's task type; `before` are steps first. */
async function makePlan(sb: Sandbox, before: readonly ReturnType<typeof toolStep>[] = [], policy: JsonObject = {}): Promise<Planned> {
  writeWorkspaceFile(sb, "README.md", "# Title\n");
  writeWorkspaceFile(sb, "docs/guide.md", OLD_GUIDE);
  const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, workflows: { rewrite: REWRITE } }, "c.json");
  const steps = [...before, toolStep("propose_changes", { summary: "rewrite the guide and add a page", files: PLANNED }), textStep("not requested")];
  const task = writeGeneralTask(sb, { id: "u221", goal: "rewrite the guide", fields: { workflowRef: "rewrite" }, limits: LIMITS, policy }, steps);
  const form = ["--task", task, "--config", config];
  const made = await runGuarded(sb, ["run", ...form], cliEnv({ extra: { CODARYN_LANG: "en" } }));
  const result = json(made);
  assert.equal(result["reason"], "plan_pending", made.stdout);
  return { form, runId: result["runId"] as string, digest: (result["plan"] as { digest: string }).digest, made };
}

describe("U-221 (1): the end summary of the run that made a run plan says what the plan view says", () => {
  test("files to write, and the summary under the plan view's label (approved with the plan)", { timeout: 60_000 }, async (t) => {
    const { made } = await makePlan(createSandbox(t));
    assert.ok(made.stderr.includes(say(en, "summary.plan_ready_changes", { count: 2 })), made.stderr);
    assert.ok(made.stderr.includes(`${en.format("plan.changes.summary_label")}:\n  | rewrite the guide and add a page`), made.stderr);
    // Not a plan of moves' words.
    assert.equal(made.stderr.includes("A plan is ready: actions 2."), false, made.stderr);
    assert.equal(made.stderr.includes("not what you approve"), false, made.stderr);
  });
});

describe("U-221 (2): one name for a carried-out run plan in runs, plan and report", () => {
  test("a carrying run without checks (needs-input/no_verifier): 'carried out by run …' in all three", { timeout: 120_000 }, async (t) => {
    const sb = createSandbox(t);
    const planned = await makePlan(sb);
    const guideWrite = toolStep("write_file", { path: "docs/guide.md", expectedHash: sha256(OLD_GUIDE), change: { kind: "replace_all", content: "new guide\n" } });
    writeFileSync(sb.scriptPath, JSON.stringify({ schemaVersion: 1, steps: [guideWrite, toolStep("write_file", createFileArgs("docs/new.md", "new page\n")), textStep("done")] }));
    const env = cliEnv({ extra: { CODARYN_LANG: "en" } });
    const carried = json(await runGuarded(sb, ["apply", ...planned.form, "--run", planned.runId, "--digest", planned.digest.slice(0, 12)], env));
    assert.deepEqual([carried["kind"], carried["status"], carried["reason"]], ["run", "needs-input", "no_verifier"], JSON.stringify(carried));
    const carry = carried["runId"] as string;

    const runs = await runGuarded(sb, ["runs", "--workspace", sb.workspace], env);
    const planRow = runs.stdout.split("\n").find((line) => line.startsWith(planned.runId)) ?? "";
    assert.ok(planRow.includes(say(en, "runs.plan_carried_ended", { runId: carry, reason: "no_verifier" })), runs.stdout);
    assert.ok(planRow.includes(`plan carried out by run ${carry}, which ended as no_verifier`), planRow);
    assert.equal(planRow.includes("plan apply not finished"), false, planRow);

    const plan = await runGuarded(sb, ["plan", ...planned.form, "--run", planned.runId], env);
    assert.ok(plan.stdout.includes(`Plan of run ${planned.runId}: 2 file(s) to write, carried out\n`), plan.stdout);
    assert.ok(plan.stdout.includes(`Carried out by run ${carry} (`), plan.stdout);
    assert.equal(plan.stdout.includes("Applied by run"), false, plan.stdout);
    assert.equal(json(await runGuarded(sb, ["plan", ...planned.form, "--run", planned.runId, "--json"], env))["status"], "applied", "the JSON keeps its status");

    // The report's line, as it was (U-195): the name the other two now use.
    const report = await runGuarded(sb, ["report", "--workspace", sb.workspace, "--run", planned.runId], env);
    assert.ok(report.stdout.includes(`- Plan: 2 file(s) to write; carried out by run \`${carry}\`, which ended as \`no_verifier\``), report.stdout);
  });
});

describe("U-221 (3): the writablePaths advice once", () => {
  test("the run that makes a plan, a planned file outside writablePaths refused: the advice once, the summary's count kept", { timeout: 60_000 }, async (t) => {
    const outside = toolStep("propose_changes", { summary: "also out", files: [{ path: "docs/guide.md", change: "modify" }, { path: "out.txt", change: "create" }] });
    const { made } = await makePlan(createSandbox(t), [outside], { writablePaths: ["docs"] });
    assert.equal(occurrences(made.stderr, ADVICE), 1, made.stderr);
    assert.ok(made.stderr.includes(say(en, "progress.not_writable_hint", { count: 1 })), made.stderr);
    assert.ok(made.stderr.includes(say(en, "summary.denied_not_writable", { count: 1 })), made.stderr);
  });

  test("a run without a plan, a write outside writablePaths: the advice once", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "README.md", "# Title\n");
    const task = writeGeneralTask(sb, { id: "u221-plain", policy: { writablePaths: ["out"] } }, [toolStep("write_file", createFileArgs("b.txt", "x\n")), textStep("done")]);
    const ran = await runGuarded(sb, ["run", "--task", task], cliEnv({ extra: { CODARYN_LANG: "en" } }));
    assert.equal(json(ran)["kind"], "run", ran.stdout);
    assert.equal(occurrences(ran.stderr, ADVICE), 1, ran.stderr);
    assert.ok(ran.stderr.includes(say(en, "summary.denied_not_writable", { count: 1 })), ran.stderr);
    assert.equal(readdirSync(sb.workspace).includes("b.txt"), false);
  });
});

// The renderer, in both languages: the run plan's words, and a plan of moves' as they were.
const PLAN = toRunId("20261113T120000Z-0a1b2c3d") as RunId;
const APPLY = toRunId("20261113T130000Z-11111111") as RunId;
const DIGEST = "d".repeat(64) as ContentHash;
const planResult = (kind: "changes" | undefined, summary: string): EngineResult =>
  ({
    schemaVersion: 1, kind: "run", runId: PLAN, taskId: "t", status: "needs-input", reason: "plan_pending", exitCode: 3, provider: "scripted",
    verifiers: [], changes: [], usage: { modelTurns: 2, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 0 }, journalPath: "x", notices: [],
    plan: { digest: DIGEST, actions: 2, ...(kind === undefined ? {} : { kind }) }, planSummary: summary,
  }) as unknown as EngineResult;
const context = (extra: Record<string, unknown> = {}): RunSummaryContext =>
  ({ workspaceForm: "task", configDefault: null, profileApplied: false, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0, policySource: "task", ...extra }) as unknown as RunSummaryContext;
const entry = (runId: RunId, extra: Record<string, unknown>): RunListEntry =>
  ({
    state: "checked", runId, kind: "run", startedAt: "2026-11-13T12:00:01.000Z", profile: null, workflowRef: null, taskId: "t",
    status: "done", reason: "verified", changes: 1, reverted: null, revertRecordDamaged: false, ...extra,
  }) as unknown as RunListEntry;
const planRun = entry(PLAN, { status: "needs-input", reason: "plan_pending", changes: 0, appliedBy: { runId: APPLY, at: "2026-11-13T13:00:05.000Z" } });
const runsOf = (catalog: MessageCatalog, runs: RunListEntry[]): string => createHumanOutput(catalog).runsText({ schemaVersion: 1, kind: "runs", runs, omitted: 0 } as unknown as RunsOutput);
const planRowOf = (catalog: MessageCatalog, applier: Record<string, unknown>): string =>
  runsOf(catalog, [entry(APPLY, { planRunId: PLAN, ...applier }), planRun]).split("\n").find((line) => line.startsWith(PLAN)) ?? "";

describe("U-221: the renderer's run plan words, and a plan of moves' unchanged (English, pinned)", () => {
  test("(1) a plan of moves' end summary: the same characters as before", () => {
    const text = createHumanOutput(en).runSummary(planResult(undefined, "sort the inbox"), context());
    assert.ok(text.includes("\nA plan is ready: actions 2. Nothing was changed; it waits for approval.\n"), text);
    assert.ok(text.includes("\nThe agent's description (the model's own words, not checked, and not what you approve):\n  | sort the inbox\n"), text);
  });

  test("(1) a run plan's end summary: files to write and the plan view's label; the rest as a plan of moves'", () => {
    const moves = createHumanOutput(en).runSummary(planResult(undefined, "rewrite"), context()).split("\n");
    const changes = createHumanOutput(en).runSummary(planResult("changes", "rewrite"), context()).split("\n");
    assert.equal(changes[1], "A plan is ready: 2 file(s) to write. Nothing was changed; it waits for approval.");
    const label = changes.indexOf(`${en.format("plan.changes.summary_label")}:`);
    assert.ok(label > 0 && changes[label + 1] === "  | rewrite", changes.join("\n"));
    const same = (lines: string[]): string[] => lines.filter((_, at) => at !== 1 && at !== label);
    assert.deepEqual(same(changes), same(moves), "only the two lines differ");
  });

  test("(2) the plan run's row of a plan of moves: as before in every state", () => {
    const apply = { kind: "apply" };
    assert.ok(planRowOf(en, { ...apply }).includes(`plan applied by run ${APPLY} (needs-input/plan_pending)`));
    assert.ok(planRowOf(en, { ...apply, status: "needs-input", reason: "no_verifier" }).includes(`plan apply not finished (apply run ${APPLY}, no_verifier)`));
    assert.ok(planRowOf(en, { ...apply, status: null, reason: null }).includes(`plan being applied, or its apply stopped (apply run ${APPLY}, no result yet)`));
    assert.ok(planRowOf(en, { ...apply, reverted: { status: "complete" } }).includes(`plan applied, then reverted (apply run ${APPLY})`));
  });

  test("(2) the plan run's row of a run plan (its applier is a run): carried out, in every state with an applier", () => {
    assert.ok(planRowOf(en, {}).includes(`plan carried out by run ${APPLY} (needs-input/plan_pending)`), planRowOf(en, {}));
    assert.ok(planRowOf(en, { status: "needs-input", reason: "no_verifier" }).includes(`plan carried out by run ${APPLY}, which ended as no_verifier (needs-input/plan_pending)`));
    assert.ok(planRowOf(en, { status: null, reason: null }).includes(`plan being carried out by run ${APPLY}, or that run stopped (no result yet)`));
    assert.ok(planRowOf(en, { reverted: { status: "complete" } }).includes(`plan carried out by run ${APPLY}, then reverted`));
    // No applier in the list: the words as before (the list cannot tell the plan's kind).
    const missing = runsOf(en, [planRun]).split("\n").find((line) => line.startsWith(PLAN)) ?? "";
    assert.ok(missing.includes(`no readable records of the apply run ${APPLY}`), missing);
  });

  test("(2) the plan views: a run plan carried out says so; a plan of moves says applied as before", () => {
    const changes: ChangesPlanOutput = {
      schemaVersion: 1, kind: "plan", planKind: "changes", runId: PLAN, status: "applied", exitCode: 0, digest: DIGEST,
      files: [{ path: "docs/guide.md" as MaskedText, change: "modify", sha256: "a".repeat(64) as ContentHash }],
      summary: "rewrite" as MaskedText, appliedBy: { runId: APPLY, at: "not a time" },
    } as unknown as ChangesPlanOutput;
    const shown = renderChangesPlan(changes, null, en).split("\n");
    assert.equal(shown[0], `Plan of run ${PLAN}: 1 file(s) to write, carried out`);
    assert.ok(shown.includes(`Carried out by run ${APPLY}`), shown.join("\n"));
    const pending = renderChangesPlan({ ...changes, status: "pending", appliedBy: null } as ChangesPlanOutput, null, en).split("\n");
    assert.equal(pending[0], `Plan of run ${PLAN}: 1 file(s) to write, pending`);
    const moves = { schemaVersion: 1, kind: "plan", runId: PLAN, status: "applied", exitCode: 0, digest: DIGEST, actions: [], inventoryLimitReached: false, appliedBy: { runId: APPLY, at: "not a time" } } as unknown as PlanOutput;
    const movesText = renderPlan(moves, null, en);
    assert.ok(movesText.includes(`, applied\n`) && movesText.includes(`Applied by run ${APPLY}\n`), movesText);
  });

  test("(3) the end summary keeps the writablePaths count without the advice; a plan's own advice stays", () => {
    const t = en.format as (id: string, params?: object) => CatalogText;
    const lines = createHumanOutput(en).runSummary(planResult(undefined, "x"), context({ deniedToolCalls: 2, deniedNotWritable: 2 })).split("\n");
    const at = lines.indexOf(t("summary.denied_not_writable", { count: 2 }));
    assert.ok(at > 0, lines.join("\n"));
    assert.equal(lines.join("\n").includes(ADVICE), false, lines.join("\n"));
    const planned = createHumanOutput(en).runSummary(planResult(undefined, "x"), context({ deniedToolCalls: 1, deniedNotPlanned: 1 })).split("\n");
    const own = planned.indexOf(t("summary.denied_not_planned", { count: 1 }));
    assert.equal(planned[own + 1], t("summary.denied_not_planned_hint"));
  });
});
