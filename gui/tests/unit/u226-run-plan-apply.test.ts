/**
 * U-226 (U-218, DR-69 B-3): the GUI applies a run plan. The app layer carries it out as a model run
 * (the run that carries out the plan, its own run id): its events come as a run's (onRunEvent), its
 * permission questions as a run's (confirm), and it ends as a run's EngineResult with the plan run's
 * id. The engine host passes that on with `deniedNotPlanned`, the run's writes refused because the
 * approved plan does not name the file (path_not_writable, counted from its records as the CLI's end
 * summary counts them). The main process asks first with its own dialog (the number of files, the
 * summary as the model's words, "do not apply" the default); the plan screen applies a run plan as a
 * plan of moves (the check first, then the button); the run screen shows its progress and cancel, and
 * its result says whose plan it carried out and how many writes were refused outside it.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runsValue } from "../../src/engine-host/history.js";
import type { PlanApplyOf } from "../../src/engine-host/history.js";
import { applyOutcomeValue, createRunRegistry, runResultValue } from "../../src/engine-host/runs.js";
import { planValue } from "../../src/engine-host/plans.js";
import { DIALOG_TEXTS } from "../../src/main/dialog-texts.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { planScreen } from "../../src/renderer/plan/plan-screen.js";
import { RunModel } from "../../src/renderer/run/run-model.js";
import { runsScreen } from "../../src/renderer/runs/runs-screen.js";
import { runScreen } from "../../src/renderer/run/run-screen.js";
import type { RunScreenDeps } from "../../src/renderer/run/run-screen.js";
import { toPlanView, toRunResultView, toRunsReply } from "../../src/shared/ipc.js";
import type { RunResultView } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

// This file runs as gui/build/tests/unit/u226-run-plan-apply.test.js.
const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const DIST = path.join(GUI, "..", "dist", "src");
const BUILT = existsSync(path.join(DIST, "i18n", "ko.js"));

const TOKEN = "f".repeat(32);
const HANDLE = "1".repeat(32);
const APPROVAL = "a".repeat(32);
const PLAN = "20261113T150000Z-0000a226";
const CARRY = "20261113T151000Z-0000b226";
const DIGEST = "ab".repeat(32);
const same = (text: string): string => text;
const byId = (root: FakeElement, id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];

/** The carrying run's EngineResult as the app layer gives it at the apply's end. */
const carried = (extra: Record<string, unknown> = {}) => ({
  ok: true,
  output: {
    schemaVersion: 1,
    kind: "run",
    runId: CARRY,
    taskId: "t",
    status: "done",
    reason: "completed",
    exitCode: 0,
    provider: "anthropic",
    verifiers: [],
    changes: [{ path: "docs/new.md", created: true }],
    usage: { modelTurns: 2, toolCalls: 2, inputTokens: null, outputTokens: null, durationMs: 10 },
    journalPath: `.codaryn/runs/${CARRY}/journal.jsonl`,
    notices: [],
    planRunId: PLAN,
    planDigest: DIGEST,
    ...extra,
  },
  lockLeft: true,
});

const decision = (seq: number, allowed: boolean, code: string | null) => ({ kind: "record", record: { seq, type: "tool_decision", allowed, permission: "path", ...(code === null ? {} : { code }) } });

test("U-226: the engine host gives a run plan's apply a run's events and questions, and ends it as a run's result with the plan run and the writes outside it", async () => {
  const written: { type: string; outcome?: unknown; items?: unknown[] }[] = [];
  let observer: { onEvent(event: unknown): void; onRunEvent(event: unknown): void; confirm?: unknown } | null = null;
  let finish: (value: unknown) => void = () => undefined;
  const seen: unknown[] = [];
  const registry = createRunRegistry({
    startRun: async () => null,
    applyPlan: async (_request, given) => {
      observer = given;
      return { ok: true, handle: { runId: CARRY, cancel: () => undefined, done: new Promise((resolve) => (finish = resolve)) } };
    },
    itemOf: (event) => {
      seen.push(event);
      return { at: null, kind: "tool", text: "x" };
    },
    shown: same,
    token: () => TOKEN,
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as unknown as { type: string }),
    log: () => undefined,
    flushMs: 1,
  });
  const started = await registry.startApply({ workspace: "C:\\ws", profile: null, workflowRef: "rewrite", planRunId: PLAN, digest: DIGEST, consent: false });
  assert.deepEqual(started, { ok: true, run: TOKEN, runId: CARRY }, "the run that carries the plan out");
  const given = observer as unknown as { onEvent(event: unknown): void; onRunEvent(event: unknown): void; confirm?: unknown };
  assert.equal(typeof given.confirm, "function", "its questions are asked");
  given.onRunEvent(decision(1, false, "path_not_writable"));
  given.onRunEvent(decision(2, false, "protected_path"));
  given.onRunEvent(decision(3, true, null));
  given.onRunEvent(decision(4, false, "path_not_writable"));
  finish(carried());
  for (let waited = 0; waited < 50 && !written.some((m) => m.type === "done"); waited += 1) await new Promise((done) => setTimeout(done, 5));
  assert.equal(seen.length, 4, "every run event became a progress item");
  assert.ok(written.some((m) => m.type === "events" && (m.items?.length ?? 0) > 0), "the items went out as a run's");
  const done = written.find((m) => m.type === "done") as { outcome: { ok: boolean; result: Record<string, unknown> } };
  assert.equal(done.outcome.ok, true);
  assert.deepEqual([done.outcome.result["planRunId"], done.outcome.result["deniedNotPlanned"], done.outcome.result["kind"]], [PLAN, 2, undefined], "a run's result: the plan run and its two writes outside the plan");
  assert.equal(JSON.stringify(done.outcome).includes("lockLeft"), false, "the lock's state is not a run result's field here");
  const view = toRunResultView(done.outcome);
  assert.ok(view.ok, JSON.stringify(view));
  if (view.ok) assert.deepEqual([view.result.kind, view.result.planRunId, view.result.deniedNotPlanned, view.result.changes], ["run", PLAN, 2, [{ path: "docs/new.md", created: true }]]);
});

test("U-226: a plan of moves still ends as an apply; a run's end without a plan run id is host_error", () => {
  const moves = { ok: true, output: { schemaVersion: 1, kind: "apply", runId: CARRY, planRunId: PLAN, status: "done", reason: "applied", exitCode: 0, applied: [{ action: { kind: "move", from: "a", to: "b" } }], usage: {}, notices: [] } };
  const apply = applyOutcomeValue(moves, same, undefined, 0, 0) as { ok: boolean; result: Record<string, unknown> };
  assert.deepEqual([apply.ok, apply.result["kind"], apply.result["planRunId"], "deniedNotPlanned" in apply.result], [true, "apply", PLAN, false]);
  assert.deepEqual(applyOutcomeValue(carried({ planRunId: undefined }), same, undefined, null, 0), { ok: false, code: "host_error" });
  assert.deepEqual(applyOutcomeValue(carried({ planRunId: "latest" }), same, undefined, null, 0), { ok: false, code: "host_error" });
  assert.deepEqual(applyOutcomeValue({ ok: false, error: { code: "plan_already_applied", message: "m" } }, same, undefined, null, 0), { ok: false, code: "plan_already_applied" });
});

test("U-226: the main process takes the count only for a run that carried out a plan", () => {
  const value = applyOutcomeValue(carried(), same, undefined, null, 1) as { ok: true; result: Record<string, unknown> };
  assert.ok(toRunResultView(value).ok);
  const forged = (result: Record<string, unknown>) => toRunResultView({ ok: true, result: { ...value.result, ...result } }).ok;
  assert.equal(forged({ deniedNotPlanned: -1 }), false);
  assert.equal(forged({ deniedNotPlanned: 1.5 }), false);
  assert.equal(forged({ planRunId: null }), false, "a run that carried out no plan has no such count");
  assert.equal(forged({ kind: "apply", applied: [] }), false, "nor has an apply");
  assert.equal(forged({ deniedNotPlanned: undefined }), true);
});

function viewOf(extra: Partial<RunResultView>): RunResultView {
  return {
    runId: CARRY,
    status: "done",
    reason: "completed",
    exitCode: 0,
    changes: [],
    verifiers: [],
    usage: { turns: 1, tools: 1, inputTokens: null, outputTokens: null, durationMs: 1 },
    notices: [],
    plan: null,
    review: null,
    protectedChanged: null,
    kind: "run",
    planRunId: PLAN,
    unsafeMoves: null,
    applied: [],
    finalMessage: null,
    ...extra,
  };
}

/** Run screens shown here; emptied at the end so their one-second timers stop (as U-61 does). */
const shownRoots: FakeElement[] = [];

async function resultScreen(language: "ko" | "en", view: RunResultView): Promise<FakeElement> {
  const model = new RunModel();
  model.startingApply(APPROVAL);
  model.started(CARRY, Date.now());
  model.finished({ runId: CARRY, ok: true, result: view, labels: { status: "S", reason: "R" } });
  const deps: RunScreenDeps = {
    texts: textsFor(language),
    api: new Proxy({} as CodarynApi, { get: () => async () => null }),
    run: model,
    newTask: () => undefined,
    announce: () => undefined,
    current: () => ({ handle: HANDLE, name: "ws" }),
    openPlan: () => undefined,
    openChanges: () => undefined,
    openReport: () => undefined,
  };
  const root = new FakeElement("main");
  shownRoots.push(root);
  runScreen(deps).show(root as unknown as HTMLElement);
  await settle();
  return root;
}

test("U-226: the result of a run that carried out a plan says whose plan, and the writes refused outside it with what to do", async () => {
  const restore = installFakeDom();
  try {
    for (const language of ["ko", "en"] as const) {
      const texts = language === "ko" ? KO : EN;
      const refused = await resultScreen(language, viewOf({ deniedNotPlanned: 2 }));
      assert.equal(byId(refused, "run-carried-plan")?.textContent, texts["run.carriedPlan"].replace("{runId}", PLAN));
      assert.equal(byId(refused, "run-denied-not-planned")?.textContent, texts["run.deniedNotPlanned"].replace("{count}", "2"));
      assert.equal(byId(refused, "run-denied-not-planned-hint")?.textContent, texts["run.deniedNotPlannedHint"]);
      const none = await resultScreen(language, viewOf({ deniedNotPlanned: 0 }));
      assert.ok(byId(none, "run-carried-plan") !== undefined && byId(none, "run-denied-not-planned") === undefined, "no line for no refused write");
      const stale = await resultScreen(language, viewOf({ status: "failed", reason: "plan_stale", exitCode: 1, deniedNotPlanned: 0 }));
      assert.equal(byId(stale, "run-plan-stale")?.textContent, texts["run.planStaleCarried"], "a stale plan: stopped before the model, nothing written");
      const plain = await resultScreen(language, viewOf({ planRunId: null }));
      assert.equal(byId(plain, "run-carried-plan"), undefined, "an ordinary run says nothing of a plan");
    }
  } finally {
    for (const root of shownRoots) root.replaceChildren();
    restore();
  }
});

const changesPlan = {
  ok: true,
  output: {
    schemaVersion: 1,
    kind: "plan",
    planKind: "changes",
    runId: PLAN,
    status: "pending",
    exitCode: 0,
    digest: DIGEST,
    files: [{ path: "docs/new.md", change: "create", sha256: null }],
    summary: "Add the guide",
    appliedBy: null,
  },
};

test("U-226: the plan screen applies a run plan once its check answered: the main process is asked, then the run screen shows the run", async () => {
  const restore = installFakeDom();
  try {
    const view = toPlanView(planValue(changesPlan, same, (text) => text.split("\n")));
    assert.ok(view.ok);
    const calls: unknown[][] = [];
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async (...args: unknown[]) => {
        calls.push([name, ...args]);
        if (name === "plan") return { ok: true, view: view.ok ? view.view : null, approval: APPROVAL };
        if (name === "checkPlan") return { ok: true, planKind: "changes", problems: [], unsafeMoves: [], inventoryLimitReached: false, probesLeft: 0, probesRemoved: 0, lockLeft: false };
        if (name === "applyPlan") return { ok: true, runId: CARRY };
        return null;
      },
    });
    const run = new RunModel();
    let shown = 0;
    const screen = planScreen({ texts: textsFor("ko"), api, run, current: () => ({ handle: HANDLE, name: "ws" }), showRun: () => void (shown += 1) });
    screen.choose(PLAN, null, "rewrite");
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    assert.equal(byId(root, "plan-check")?.getAttribute("data-check"), "clean");
    const apply = byId(root, "plan-apply");
    assert.equal(apply?.hasAttribute("disabled"), false, "on after the check");
    apply?.click();
    await settle();
    assert.deepEqual(calls.find((call) => call[0] === "applyPlan"), ["applyPlan", APPROVAL, false], "the token, never a consent");
    assert.equal(shown, 1, "the run screen follows the run");
    assert.equal(run.runId, CARRY);
    // A plan whose form the window does not know is not offered for apply (as a plan of moves).
    const unknown = planScreen({ texts: textsFor("ko"), api, run: new RunModel(), current: () => ({ handle: HANDLE, name: "ws" }), showRun: () => undefined });
    unknown.choose(PLAN, null, null, false);
    const other = new FakeElement("main");
    unknown.show(other as unknown as HTMLElement);
    await settle();
    assert.ok(byId(other, "plan-form-unknown") !== undefined && byId(other, "plan-apply") === undefined);
  } finally {
    restore();
  }
});

test("U-226: the words: the main process's dialog names the files and the summary as the model's; the run's words are the CLI's", { skip: !BUILT && "the engine is not built (npm run build in the root)" }, async () => {
  for (const [language, words] of [["ko", /모델이 쓴 글/], ["en", /words of the model/]] as const) {
    const dialog = DIALOG_TEXTS[language] as Readonly<Record<string, string>>;
    assert.ok(dialog["applyRun.message"]?.includes("{files}") && dialog["applyRun.message"]?.includes("{digest}"), language);
    assert.match(dialog["applyRun.detail"] ?? "", words, language);
  }
  const ko = (await import(pathToFileURL(path.join(DIST, "i18n", "ko.js")).href)) as { KO_MESSAGES: Record<string, string> };
  const en = (await import(pathToFileURL(path.join(DIST, "i18n", "en.js")).href)) as { EN_MESSAGES: Record<string, string> };
  assert.equal(KO["run.deniedNotPlanned"], ko.KO_MESSAGES["summary.denied_not_planned"]);
  assert.equal(EN["run.deniedNotPlanned"], en.EN_MESSAGES["summary.denied_not_planned"]);
  assert.equal(KO["run.deniedNotPlannedHint"], ko.KO_MESSAGES["summary.denied_not_planned_hint"]);
  assert.equal(EN["run.deniedNotPlannedHint"], en.EN_MESSAGES["summary.denied_not_planned_hint"]);
  // U-221's names of a run plan carried out: the plan's status line and the plan run's row.
  const named: [string, string][] = [
    ["plan.carriedOut", "plan.changes.status_carried_out"],
    ["plan.carriedBy", "plan.changes.carried_by"],
    ["runs.planCarried.applied", "runs.plan_carried_out"],
    ["runs.planCarried.unfinished", "runs.plan_carried_ended"],
    ["runs.planCarried.applying", "runs.plan_carrying"],
    ["runs.planCarried.reverted", "runs.plan_carried_reverted"],
  ];
  for (const [gui, cli] of named) {
    assert.equal((KO as Readonly<Record<string, string>>)[gui], ko.KO_MESSAGES[cli], `ko ${gui}`);
    assert.equal((EN as Readonly<Record<string, string>>)[gui], en.EN_MESSAGES[cli], `en ${gui}`);
  }
  for (const texts of [KO, EN] as Readonly<Record<string, string>>[]) {
    assert.equal("plan.runApplyUnavailable" in texts || "error.run_plan_apply_unavailable" in texts, false, "no longer said");
    assert.ok(texts["error.run_not_plan"]?.includes("\"run\""), "how a run plan is applied");
  }
});

/** The contract's rule as far as these rows need it: the entry whose run id appliedBy names. */
const ruleOf: PlanApplyOf = (entry, entries) => {
  const by = (entry as { appliedBy?: { runId?: string } }).appliedBy?.runId;
  const taker = (entries as { runId: string; status?: string }[]).find((other) => other.runId === by);
  return by === undefined || taker === undefined ? null : { state: "applied", applyRunId: by, reason: null };
};

test("U-226 (U-221): a run plan's plan run carried out by a run is marked, and its row says so in the CLI's carried words", async () => {
  const planEntry = { state: "checked", runId: PLAN, kind: "run", startedAt: null, taskId: "t", status: "needs-input", reason: "plan_pending", changes: 0, reverted: null, revertRecordDamaged: false, appliedBy: { runId: CARRY, at: "2026-11-13T15:10:05.000Z" } };
  const carryEntry = { state: "checked", runId: CARRY, kind: "run", planRunId: PLAN, startedAt: null, taskId: "t", status: "needs-input", reason: "no_verifier", changes: 1, reverted: null, revertRecordDamaged: false };
  const applyEntry = { ...carryEntry, kind: "apply" };
  const rowOf = (entries: unknown[]) => (runsValue({ ok: true, output: { kind: "runs", runs: entries, omitted: 0 } }, same, ruleOf) as { runs: { runId: string; planApply: unknown }[] }).runs.find((run) => run.runId === PLAN)?.planApply;
  assert.deepEqual(rowOf([planEntry, carryEntry]), { state: "applied", applyRunId: CARRY, reason: null, carried: true });
  assert.deepEqual(rowOf([planEntry, applyEntry]), { state: "applied", applyRunId: CARRY, reason: null }, "an apply run's plan of moves: as before");
  const base = runsValue({ ok: true, output: { kind: "runs", runs: [planEntry, carryEntry], omitted: 0 } }, same, ruleOf) as { ok: true; runs: Record<string, unknown>[]; omitted: number };
  const reply = toRunsReply(base);
  assert.ok(reply.ok);
  const forged = (planApply: unknown) => toRunsReply({ ...base, runs: [{ ...base.runs[0], planApply }, base.runs[1]] }).ok;
  assert.equal(forged({ state: "applied", applyRunId: CARRY, reason: null, carried: false }), false, "only true");
  assert.equal(forged({ state: "applied", applyRunId: CARRY, reason: null, carried: "yes" }), false);
  const restore = installFakeDom();
  try {
    for (const language of ["ko", "en"] as const) {
      const texts = language === "ko" ? KO : EN;
      const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "listRuns" ? (reply.ok ? { ok: true, runs: reply.runs, omitted: 0 } : null) : null) });
      const screen = runsScreen({ texts: textsFor(language), api, current: () => ({ handle: HANDLE, name: "ws" }), open: () => undefined, announce: () => undefined, openPlan: () => undefined, openChanges: () => undefined, openReport: () => undefined });
      const root = new FakeElement("main");
      screen.show(root as unknown as HTMLElement);
      await settle();
      const mark = root.findAll((e) => e.getAttribute("data-plan-apply") === "applied")[0];
      assert.equal(mark?.getAttribute("data-plan-carried"), "true");
      assert.equal(mark?.textContent, texts["runs.planCarried.applied"].replace("{runId}", CARRY));
    }
  } finally {
    restore();
  }
});

test("U-226 (U-221): a carried-out run plan's screen names the run that carried it out; its plan run's result counts files", async () => {
  const restore = installFakeDom();
  try {
    const applied = { ...changesPlan, output: { ...changesPlan.output, status: "applied", appliedBy: { runId: CARRY, at: "2026-11-13T15:10:05.000Z" } } };
    const view = toPlanView(planValue(applied, same, (text) => text.split("\n")));
    assert.ok(view.ok);
    const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "plan" ? { ok: true, view: view.ok ? view.view : null, approval: null } : null) });
    for (const language of ["ko", "en"] as const) {
      const texts = language === "ko" ? KO : EN;
      const screen = planScreen({ texts: textsFor(language), api, run: new RunModel(), current: () => ({ handle: HANDLE, name: "ws" }), showRun: () => undefined });
      screen.choose(PLAN, null, "rewrite");
      const root = new FakeElement("main");
      screen.show(root as unknown as HTMLElement);
      await settle();
      const line = byId(root, "plan-applied");
      assert.equal(line?.getAttribute("data-carried"), "true");
      assert.ok(line?.textContent.startsWith(texts["plan.carriedBy"].replace("{runId}", CARRY)), line?.textContent);
    }
  } finally {
    restore();
  }
  const made = runResultValue({ ok: true, result: { ...carried().output, planRunId: undefined, planDigest: undefined, runId: PLAN, status: "needs-input", reason: "plan_pending", plan: { digest: DIGEST, actions: 1, kind: "changes" } } }, same) as { ok: true; result: Record<string, unknown> };
  assert.deepEqual(made.result["plan"], { digest: DIGEST, actions: 1, kind: "changes" });
  const checked = toRunResultView(made);
  assert.ok(checked.ok && checked.result.plan?.kind === "changes");
  assert.equal(toRunResultView({ ok: true, result: { ...made.result, plan: { digest: DIGEST, actions: 1, kind: "moves" } } }).ok, false, "no other kind");
  const restore2 = installFakeDom();
  try {
    const root = await resultScreen("ko", viewOf({ runId: PLAN, status: "needs-input", reason: "plan_pending", planRunId: null, plan: { digest: DIGEST, actions: 1, kind: "changes" } }));
    assert.equal(byId(root, "run-plan")?.textContent, KO["run.planChanges"].replace("{count}", "1").replace("{digest}", DIGEST.slice(0, 12)));
  } finally {
    for (const root of shownRoots) root.replaceChildren();
    restore2();
  }
});
