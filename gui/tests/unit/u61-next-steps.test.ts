/**
 * U-61 (docs/design/standalone-gui.md 3.12, 3.8, 3.2):
 * - A run's result offers the next steps the design names for how it ended: a revert preview when
 *   the run or apply changed something, the protected items' tab for protected_changed, the settings'
 *   limits for budget-exhausted, and a new run for a new plan after plan_stale.
 * - The run list says what became of a plan's apply (U-16), judged by the contract's one rule
 *   (planApplyStateOf) in the engine host and checked by the main process, in the CLI's runs words.
 * - The new task screen says, for data analysis, that the tables' rows go to the model as they are
 *   (DR-23, GT-D8, usage 18.7): only what is so.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runsValue } from "../../src/engine-host/history.js";
import type { PlanApplyOf } from "../../src/engine-host/history.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { reportScreen } from "../../src/renderer/report/report-screen.js";
import { newTaskScreen } from "../../src/renderer/run/new-task.js";
import { RunModel } from "../../src/renderer/run/run-model.js";
import { runScreen } from "../../src/renderer/run/run-screen.js";
import type { RunScreenDeps } from "../../src/renderer/run/run-screen.js";
import { runsScreen } from "../../src/renderer/runs/runs-screen.js";
import { PLAN_APPLY_STATES, toRunsReply } from "../../src/shared/ipc.js";
import type { RunResultView } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

// This file runs as gui/build/tests/unit/u61-next-steps.test.js.
const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const DIST = path.join(GUI, "..", "dist", "src");
const BUILT = existsSync(path.join(DIST, "contracts", "index.js"));
const skip = !BUILT && "the engine is not built (npm run build in the root)";
const same = (text: string): string => text;
const HANDLE = "1".repeat(32);
const byId = (root: FakeElement, id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];

const PLAN = "20261113T010000Z-0000a061";
const APPLY = "20261113T020000Z-0000b061";
const entry = (extra: Record<string, unknown>) => ({ state: "checked", kind: "run", startedAt: "2026-11-13T01:00:00.000Z", taskId: "t", status: "needs-input", reason: "plan_pending", changes: 0, reverted: null, revertRecordDamaged: false, ...extra });
const planEntry = entry({ runId: PLAN, appliedBy: { runId: APPLY, at: "2026-11-13T02:00:00.000Z" } });
const applyEntry = (extra: Record<string, unknown>) => entry({ runId: APPLY, kind: "apply", planRunId: PLAN, status: "done", reason: "applied", ...extra });

async function contractRule(): Promise<PlanApplyOf> {
  const contracts = (await import(pathToFileURL(path.join(DIST, "contracts", "index.js")).href)) as { planApplyStateOf: PlanApplyOf; PLAN_APPLY_STATES: readonly string[] };
  assert.deepEqual([...PLAN_APPLY_STATES], [...contracts.PLAN_APPLY_STATES], "the window's copy of the contract's states");
  return contracts.planApplyStateOf;
}

const planRow = (rule: PlanApplyOf | undefined, runs: readonly unknown[]): unknown => {
  const value = runsValue({ ok: true, output: { kind: "runs", runs, omitted: 0 } }, same, rule) as { runs: { runId: string; planApply: unknown }[] };
  return value.runs.find((run) => run.runId === PLAN)?.planApply;
};

test("U-61: the engine host judges a plan's apply by the contract's rule; the main process checks it", { skip }, async () => {
  const rule = await contractRule();
  assert.deepEqual(planRow(rule, [applyEntry({}), planEntry]), { state: "applied", applyRunId: APPLY, reason: null });
  assert.deepEqual(planRow(rule, [applyEntry({ status: "failed", reason: "apply_incomplete" }), planEntry]), { state: "unfinished", applyRunId: APPLY, reason: "apply_incomplete" });
  assert.deepEqual(planRow(rule, [applyEntry({ status: null, reason: null }), planEntry]), { state: "applying", applyRunId: APPLY, reason: null });
  assert.deepEqual(planRow(rule, [applyEntry({ reverted: { at: "2026-11-13T03:00:00.000Z", status: "complete" } }), planEntry]), { state: "reverted", applyRunId: APPLY, reason: null });
  assert.deepEqual(planRow(rule, [planEntry]), { state: "record_missing", applyRunId: APPLY, reason: null }, "the apply run's records are gone");
  assert.equal(planRow(rule, [entry({ runId: PLAN })]), null, "a plan no apply claimed");
  assert.equal(planRow(undefined, [applyEntry({}), planEntry]), null, "an engine without the rule");
  assert.equal(planRow(() => { throw new Error("x"); }, [planEntry]), null);
  assert.equal(planRow(() => ({ state: "other", applyRunId: APPLY }), [planEntry]), null, "not one of the states");

  const reply = toRunsReply(runsValue({ ok: true, output: { kind: "runs", runs: [applyEntry({}), planEntry], omitted: 0 } }, same, rule));
  assert.ok(reply.ok);
  if (!reply.ok) return;
  const plan = reply.runs.find((run) => run.runId === PLAN);
  assert.deepEqual(plan?.state === "checked" ? plan.planApply : undefined, { state: "applied", applyRunId: APPLY, reason: null });
  const base = runsValue({ ok: true, output: { kind: "runs", runs: [planEntry], omitted: 0 } }, same) as { ok: true; runs: Record<string, unknown>[]; omitted: number };
  const forged = (planApply: unknown) => toRunsReply({ ...base, runs: [{ ...base.runs[0], planApply }] }).ok;
  assert.equal(forged(null), true);
  assert.equal(forged({ state: "applied", applyRunId: APPLY, reason: null }), true);
  assert.equal(forged({ state: "done", applyRunId: APPLY, reason: null }), false, "a state the contract has not");
  assert.equal(forged({ state: "applied", applyRunId: "latest", reason: null }), false, "not a run id");
  assert.equal(forged({ state: "applied", applyRunId: APPLY, reason: null, path: "C:/x" }), false, "another field");
});

test("U-61: the run list says it in the CLI's runs words, in both languages", { skip }, async () => {
  const ko = (await import(pathToFileURL(path.join(DIST, "i18n", "ko.js")).href)) as { KO_MESSAGES: Record<string, string> };
  const en = (await import(pathToFileURL(path.join(DIST, "i18n", "en.js")).href)) as { EN_MESSAGES: Record<string, string> };
  const cli: Record<(typeof PLAN_APPLY_STATES)[number], string> = { applied: "runs.plan_applied", unfinished: "runs.plan_apply_unfinished", applying: "runs.plan_applying", reverted: "runs.plan_apply_reverted", record_missing: "runs.plan_apply_missing" };
  const window: Record<"en" | "ko", Readonly<Record<string, string>>> = { en: EN, ko: KO };
  for (const state of PLAN_APPLY_STATES) {
    assert.equal(window.en[`runs.planApply.${state}`], en.EN_MESSAGES[cli[state]], `en ${state}`);
    assert.equal(window.ko[`runs.planApply.${state}`], ko.KO_MESSAGES[cli[state]], `ko ${state}`);
  }
});

function runsApi(calls: string[]): CodarynApi {
  const runs = [
    { state: "checked", runId: PLAN, kind: "run", startedAt: null, taskId: "t", status: "needs-input", reason: "plan_pending", changes: 0, reverted: null, revertRecordDamaged: false, planApply: { state: "applied", applyRunId: APPLY, reason: null } },
    { state: "checked", runId: APPLY, kind: "apply", startedAt: null, taskId: "t", status: "done", reason: "applied", changes: 0, reverted: null, revertRecordDamaged: false, planApply: null },
  ];
  return new Proxy({} as CodarynApi, {
    get: (_t, name: string) => async (...args: unknown[]) => {
      calls.push(`${name}:${String(args[1] ?? "")}`);
      if (name === "listRuns") return { ok: true, runs, omitted: 0 };
      if (name === "previewRevert") return { ok: true, view: { runId: args[1], status: "complete", dryRun: true, reverted: [], skipped: [], moveSafetyUnchecked: false, revertedBefore: null }, preview: null };
      return null;
    },
  });
}

test("U-61: a plan run's row tells of its apply; a preview asked from a result opens once the list is in", async () => {
  const restore = installFakeDom();
  try {
    const calls: string[] = [];
    const screen = runsScreen({ texts: textsFor("ko"), api: runsApi(calls), current: () => ({ handle: HANDLE, name: "ws" }), open: () => undefined, announce: () => undefined, openPlan: () => undefined, openChanges: () => undefined, openReport: () => undefined });
    screen.choosePreview(APPLY);
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    await settle();
    const line = root.findAll((e) => e.getAttribute("data-plan-apply") === "applied");
    assert.equal(line.length, 1);
    assert.equal(line[0]?.textContent, `계획 적용됨(적용 실행 ${APPLY})`);
    assert.deepEqual(calls, ["listRuns:", `previewRevert:${APPLY}`], "the list first, then the preview the main process checks against it");
    assert.ok(byId(root, "revert-panel")?.getAttribute("data-preview") !== null);
    calls.length = 0;
    screen.show(root as unknown as HTMLElement);
    await settle();
    assert.deepEqual(calls, ["listRuns:"], "asked once only");
    screen.choosePreview("20261113T090000Z-0000dead");
    screen.show(root as unknown as HTMLElement);
    await settle();
    assert.deepEqual(calls, ["listRuns:", "listRuns:"], "a run not in the list is not previewed");
  } finally {
    restore();
  }
});

const RUN = "20261113T040000Z-0000c061";
function result(extra: Partial<RunResultView>): RunResultView {
  return {
    runId: RUN,
    status: "done",
    reason: "verified",
    exitCode: 0,
    changes: [],
    verifiers: [],
    usage: { turns: 1, tools: 0, inputTokens: null, outputTokens: null, durationMs: null },
    notices: [],
    plan: null,
    review: null,
    protectedChanged: null,
    kind: "run",
    planRunId: null,
    unsafeMoves: null,
    applied: [],
    finalMessage: null,
    ...extra,
  };
}

interface Asked {
  revert: string[];
  report: unknown[][];
  settings: number;
  newTask: number;
}

async function ended(view: RunResultView, asked: Asked): Promise<FakeElement> {
  const model = new RunModel();
  model.starting({ goal: "g", profile: "doc", workflow: "document" });
  model.started(RUN, Date.now());
  model.finished({ runId: RUN, ok: true, result: view, labels: { status: "S", reason: "R" } });
  const deps: RunScreenDeps = {
    texts: textsFor("en"),
    api: new Proxy({} as CodarynApi, { get: () => async () => null }),
    run: model,
    newTask: () => void (asked.newTask += 1),
    announce: () => undefined,
    current: () => ({ handle: HANDLE, name: "ws" }),
    openPlan: () => undefined,
    openChanges: () => undefined,
    openReport: (...args) => void asked.report.push(args),
    openRevert: (runId) => void asked.revert.push(runId),
    openSettings: () => void (asked.settings += 1),
  };
  const root = new FakeElement("main");
  runScreen(deps).show(root as unknown as HTMLElement);
  await settle();
  return root;
}

test("U-61: a result's next steps follow how the run ended (3.12)", async () => {
  const restore = installFakeDom();
  const roots: FakeElement[] = [];
  try {
    const asked: Asked = { revert: [], report: [], settings: 0, newTask: 0 };
    const show = async (view: RunResultView): Promise<FakeElement> => {
      const root = await ended(view, asked);
      roots.push(root);
      return root;
    };
    const changedRun = await show(result({ changes: [{ path: "a.md", created: false }] }));
    byId(changedRun, "run-revert-preview")?.click();
    assert.deepEqual(asked.revert, [RUN], "a run that changed files: its revert preview");
    assert.equal(byId(await show(result({})), "run-revert-preview"), undefined, "nothing changed, nothing to revert");
    const cancelled = await show(result({ status: "cancelled", reason: "cancelled", changes: [{ path: "a.md", created: true }] }));
    assert.ok(byId(cancelled, "run-revert-preview") !== undefined, "a cancelled run keeps its changes");
    const apply = await show(result({ kind: "apply", status: "failed", reason: "apply_incomplete", planRunId: PLAN, applied: [{ kind: "move", from: "a", to: "b" }] }));
    assert.ok(byId(apply, "run-revert-preview") !== undefined, "an apply that moved something");

    const protectedRun = await show(result({ status: "needs-input", reason: "protected_changed", protectedChanged: 1 }));
    byId(protectedRun, "run-view-protected")?.click();
    assert.deepEqual(asked.report, [[RUN, { profile: "doc", workflow: "document" }, "protected"]], "the report on its protected items' tab");

    const budget = await show(result({ status: "budget-exhausted", reason: "turn_limit" }));
    byId(budget, "run-view-limits")?.click();
    assert.equal(asked.settings, 1);
    assert.equal(byId(await show(result({})), "run-view-limits"), undefined);

    const stale = await show(result({ kind: "apply", status: "failed", reason: "plan_stale", planRunId: PLAN }));
    assert.ok(byId(stale, "run-plan-stale")?.textContent.includes("make a new plan"));
    byId(stale, "run-new-plan")?.click();
    assert.equal(asked.newTask, 1);
    assert.equal(byId(stale, "run-revert-preview"), undefined, "a stale plan moved nothing");
  } finally {
    // The run screen's elapsed-time timer stops when the screen is gone.
    for (const root of roots) root.replaceChildren();
    restore();
  }
});

test("U-61: the report opens on the tab a next step names", async () => {
  const restore = installFakeDom();
  try {
    const view = { runId: RUN, kind: "run", status: "complete", recordsChanged: false, finalMessage: null, masking: null, finished: { status: "needs-input", reason: "protected_changed" }, usage: null, verifiers: [], integrity: [{ phase: "after_run", changed: ["notes.md"] }], records: 3, taskId: "t", run: { workflow: "document", provider: null, modelRequests: 1, deniedToolCalls: 0, repairs: 0, changes: [], verdict: null }, apply: null };
    const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "report" ? { ok: true, view, labels: null } : null) });
    const screen = reportScreen({ texts: textsFor("en"), api, current: () => ({ handle: HANDLE, name: "ws" }), openChanges: () => undefined });
    const selected = async (tab: string | null): Promise<string | null> => {
      screen.choose(RUN, null, tab);
      const root = new FakeElement("main");
      screen.show(root as unknown as HTMLElement);
      await settle();
      await settle();
      return root.findAll((e) => e.getAttribute("role") === "tab" && e.getAttribute("aria-selected") === "true")[0]?.getAttribute("data-tab") ?? null;
    };
    assert.equal(await selected("protected"), "protected");
    assert.equal(await selected(null), "summary");
    assert.equal(await selected("nonesuch"), "summary", "an unknown tab: the summary");
  } finally {
    restore();
  }
});

test("U-61 (DR-23): data analysis says the rows go to the model as they are, for the task type or the profile's", async () => {
  const restore = installFakeDom();
  try {
    const view = {
      file: { display: "~/config.json", source: "default", exists: true },
      model: "m",
      language: null,
      profiles: [{ name: "tables", workflowRef: "analyze", provider: null, limits: [], commands: [], verifiers: 0, protectedPaths: 0 }],
      workflows: { builtin: ["document", "analyze"], config: [] },
      keyAvailable: true,
      providers: ["anthropic"],
      env: { model: false, language: false },
      rules: { limits: [], commands: [], protectedPaths: [], secretEnv: [] },
      provider: null,
      defaultProvider: "anthropic",
      apiProviders: [],
    };
    for (const language of ["ko", "en"] as const) {
      const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "settings" ? { ok: true, view } : null) });
      const screen = newTaskScreen({ texts: textsFor(language), api, run: new RunModel(), current: () => ({ handle: HANDLE, name: "ws" }), open: () => undefined, showRun: () => undefined });
      const root = new FakeElement("main");
      screen.show(root as unknown as HTMLElement);
      await settle();
      const notice = byId(root, "task-analyze-notice") as FakeElement;
      assert.ok(notice.hasAttribute("hidden"), `${language}: not for other task types`);
      const workflow = byId(root, "task-workflow") as FakeElement;
      workflow.value = "analyze";
      workflow.dispatch("change");
      assert.equal(notice.hasAttribute("hidden"), false, `${language}: the task type`);
      workflow.value = "";
      workflow.dispatch("change");
      const profile = byId(root, "task-profile") as FakeElement;
      profile.value = "tables";
      profile.dispatch("change");
      assert.equal(notice.hasAttribute("hidden"), false, `${language}: the profile's task type`);
    }
    // Only what is so (M-8): the rows are sent; nothing claims they are not.
    assert.match(EN["task.analyzeNotice"], /sends the rows of the tables to the model as they are/);
    assert.match(KO["task.analyzeNotice"], /표의 행을 그대로 모델에 보냅니다/);
    assert.doesNotMatch(EN["task.analyzeNotice"], /not sen[dt]/);
    assert.doesNotMatch(KO["task.analyzeNotice"], /보내지 않/);
  } finally {
    restore();
  }
});
