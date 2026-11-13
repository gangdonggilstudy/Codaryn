/**
 * G-sec (U-274; GS-8, standalone-gui 4.2, 6.4, adapter-contract 5): what the app layer answers fits
 * what the GUI checks, and what reaches the window holds no secret, no key and no unsafe character.
 * Real runs through the real app layer (the root build, dist: scripted model, temporary folders);
 * their outcomes go through the engine host's own value functions with the host's own text safety
 * (cleanText, then hideKeys, as engine-host/main.ts builds `shown` and `shownText`), then through
 * the main process's own checkers (src/shared/ipc.ts), as a window would get them:
 * - the run's end (runResultValue, toRunResultView), the report (reportValue, toReportReply), the
 *   changes view (changesValue, toChangesReply), the run list (runsValue, toRunsReply), a revert
 *   preview (revertValue, toRevertView), a plan view with its summary (planValue with modelTextOf,
 *   toPlanView) and the plan's check (planCheckValue, toPlanCheckReply);
 * - each is accepted (an app answer the GUI would refuse is a contract mismatch);
 * - no string in any of them holds the registered secret, a key-shaped text, a bidirectional
 *   override or a control character other than a line break or a tab, though the workspace file the
 *   run read, the file it wrote, the plan's summary and the model's last message hold all of them.
 * Written by a session that did not implement the GUI.
 */

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { revertValue, runsValue } from "../../src/engine-host/history.js";
import { modelTextOf } from "../../src/engine-host/model-text.js";
import type { ModelTextRows } from "../../src/engine-host/model-text.js";
import { planCheckValue } from "../../src/engine-host/plan-check.js";
import { changesValue, planValue } from "../../src/engine-host/plans.js";
import { reportValue } from "../../src/engine-host/report.js";
import { runResultValue } from "../../src/engine-host/runs.js";
import { MAX_PLAN_SUMMARY_ROWS, toChangesReply, toPlanCheckReply, toPlanView, toReportReply, toRevertView, toRunResultView, toRunsReply } from "../../src/shared/ipc.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const ENGINE = path.join(GUI, "..", "dist");
const load = async <T>(...parts: string[]): Promise<T> => (await import(pathToFileURL(path.join(ENGINE, ...parts)).href)) as T;

type Outcome = { readonly ok: boolean; readonly [key: string]: unknown };
interface App {
  startRun(request: unknown): Promise<{ ok: boolean; handle: { runId: string; done: Promise<Outcome> } }>;
  report(request: unknown): Promise<Outcome>;
  changes(request: unknown): Promise<Outcome>;
  listRuns(request: unknown): Promise<Outcome>;
  revert(request: unknown): Promise<Outcome>;
  plan(request: unknown): Promise<Outcome>;
  checkApply(request: unknown): Promise<Outcome>;
}
const appModule = await load<{ createCodarynApp(environment: unknown): App; modelTextRows: ModelTextRows; MODEL_TEXT_MAX_ROWS: number }>("src", "app", "index.js");
const support = await load<{
  FAKE_SECRET: string;
  PLAN_TASK: Record<string, unknown>;
  setupRun(files: Record<string, string>, task: Record<string, unknown>, steps: readonly unknown[]): Promise<string>;
  appEnvironment(base: string): Promise<unknown>;
  taskRequest(base: string): unknown;
  taskForm(base: string): unknown;
}>("tests", "unit", "app", "support.js");
const safety = await load<{ cleanText(text: string, keepLineBreaks?: boolean): string; hideKeys(text: string, currentKey: string | null): string }>("src", "cli", "text-safety.js");

/** The engine host's `shown` and `shownText` (engine-host/main.ts), with no key variable set. */
const shown = (text: string): string => safety.hideKeys(safety.cleanText(text), null);
const shownText = (text: string): string => safety.hideKeys(safety.cleanText(text.replace(/\r\n/g, "\n"), true), null);
const modelText = modelTextOf((text, options) => appModule.modelTextRows(text, options), Math.min(MAX_PLAN_SUMMARY_ROWS - 1, appModule.MODEL_TEXT_MAX_ROWS), (text) => safety.hideKeys(text, null));

/** A key-shaped text, built here (never written in a file of the repository). */
const KEY = ["sk", "ant", "api03", "GSECFAKE".repeat(10)].join("-");
const RLO = "‮";
const ESC = "\u001b";
/** Text that carries everything the window must not get: the registered secret, a key, a bidi override, an escape. */
const TAINTED = `secret ${support.FAKE_SECRET} key ${KEY} bidi ${RLO}desrever${ESC}[31m red`;

/** Every string in `value`, with where it is. */
function strings(value: unknown, at = "$"): { at: string; text: string }[] {
  if (typeof value === "string") return [{ at, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, index) => strings(item, `${at}[${index}]`));
  if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([key, item]) => [...strings(key, `${at}.<key>`), ...strings(item, `${at}.${key}`)]);
  return [];
}

/** The view a window would get holds none of the tainted parts. */
function assertClean(what: string, view: unknown): void {
  for (const { at, text } of strings(view)) {
    assert.equal(text.includes(support.FAKE_SECRET), false, `${what} ${at}: the registered secret`);
    assert.equal(text.includes(KEY), false, `${what} ${at}: a key-shaped text`);
    assert.equal(/[‪-‮⁦-⁩]/.test(text), false, `${what} ${at}: a bidirectional control`);
    assert.equal(/[\u0000-\u0008\u000B-\u001F\u007F]/.test(text), false, `${what} ${at}: a control character`);
  }
}

describe("G-sec: the app layer's answers through the engine host and the main process's checks", () => {
  test("a run that read and wrote tainted text: its end, report, changes, run list and revert preview fit the GUI and are clean", async () => {
    const steps = [
      { toolCalls: [{ name: "read_file", args: { path: "notes.txt" } }] },
      { toolCalls: [{ name: "write_file", args: { path: "NOTES.md", expectedHash: null, change: { kind: "replace_all", content: `# Notes\n\nkey ${KEY}\nbidi ${RLO}x\n` } } }] },
      { text: `Done. ${TAINTED}` },
    ];
    const base = await support.setupRun({ "notes.txt": `${TAINTED}\n` }, {}, steps);
    const work = path.join(base, "work");
    const app = appModule.createCodarynApp(await support.appEnvironment(base));
    const started = await app.startRun(support.taskRequest(base));
    assert.ok(started.ok, JSON.stringify(started));
    const runId = started.handle.runId;
    const done = await started.handle.done;
    assert.ok(done.ok, JSON.stringify(done));

    const end = toRunResultView(runResultValue(done, shown, shownText));
    assert.equal(end.ok, true, `the run's end: ${JSON.stringify(end)}`);
    assertClean("the run's end", end);

    const report = toReportReply(reportValue(await app.report({ workspace: work, runId }), shown, shownText));
    assert.equal(report.ok, true, `the report: ${JSON.stringify(report).slice(0, 300)}`);
    assertClean("the report", report);

    const changes = toChangesReply(changesValue(await app.changes({ settings: support.taskForm(base), runId }), shown, shownText));
    assert.equal(changes.ok, true, `the changes view: ${JSON.stringify(changes).slice(0, 300)}`);
    assertClean("the changes view", changes);

    const runs = toRunsReply(runsValue(await app.listRuns({ workspace: work }), shown));
    assert.equal(runs.ok, true, `the run list: ${JSON.stringify(runs).slice(0, 300)}`);
    assertClean("the run list", runs);

    const preview = toRevertView(revertValue(await app.revert({ workspace: work, runId, dryRun: true }), shown));
    assert.equal(preview.ok, true, `the revert preview: ${JSON.stringify(preview).slice(0, 300)}`);
    assertClean("the revert preview", preview);
  });

  test("a plan run whose summary holds tainted text: its plan view and its check fit the GUI and are clean", async () => {
    const propose = { toolCalls: [{ name: "propose_plan", args: { summary: `Sort it. ${TAINTED}`, actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] };
    const base = await support.setupRun({ "a.txt": "alpha\n" }, support.PLAN_TASK, [propose]);
    const app = appModule.createCodarynApp(await support.appEnvironment(base));
    const started = await app.startRun(support.taskRequest(base));
    assert.ok(started.ok, JSON.stringify(started));
    const planned = (await started.handle.done) as { ok: boolean; result?: { runId: string; plan?: { digest: string } } };
    assert.ok(planned.ok && planned.result?.plan !== undefined, JSON.stringify(planned));
    const planRunId = planned.result!.runId;
    const digest = planned.result!.plan!.digest;

    const plan = toPlanView(planValue(await app.plan({ settings: support.taskForm(base), runId: planRunId }), shown, modelText));
    assert.equal(plan.ok, true, `the plan view: ${JSON.stringify(plan).slice(0, 300)}`);
    assert.ok(plan.ok && plan.view.summary !== undefined && plan.view.summary.length > 0, "the summary is shown");
    assertClean("the plan view", plan);

    const check = toPlanCheckReply(planCheckValue(await app.checkApply({ settings: support.taskForm(base), planRunId, digest })), planRunId, digest, 1);
    assert.equal(check.ok, true, `the plan check: ${JSON.stringify(check).slice(0, 300)}`);
    assertClean("the plan check", check);
  });
});
