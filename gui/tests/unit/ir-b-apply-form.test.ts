/** H-1/H-2: boot the real renderer app; replace only DOM and IPC/host boundaries. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { ReportView, RunResultView } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const A = { handle: "a".repeat(32), name: "folder A" };
const B = { handle: "b".repeat(32), name: "folder B" };
const FIRST = "20261125T090000Z-00000001";
const PLAN = "20261125T090000Z-00000002";
const APPLY = "20261125T090000Z-00000003";
const APPROVAL = "1".repeat(32);
const PLAN_FORM = { profile: "plan-profile", workflow: "plan-workflow" };
const OLD_FORM = { profile: "earlier-profile", workflow: "earlier-workflow" };
const GOAL = "keep this session goal";
const SAMPLE = "masked-sample-value";
type Prior = "task" | "quick" | "none";
type PlanKind = "moves" | "changes";
const settings = { ok: true, view: { file: null, model: null, language: null, profiles: [OLD_FORM.profile, PLAN_FORM.profile].map(name => ({ name, workflowRef: null, commands: [] })), workflows: { builtin: [], config: [OLD_FORM.workflow, PLAN_FORM.workflow] }, keyAvailable: false, providers: [], env: { model: false, language: false }, rules: { limits: [], commands: [], protectedPaths: [], secretEnv: [] }, provider: null, defaultProvider: null, apiProviders: [] } };
const result = (runId = APPLY): RunResultView => ({ runId, status: "needs-input", reason: "awaiting_review", exitCode: 3, changes: [{ path: "edit.md", created: false }], verifiers: [], usage: { turns: 1, tools: 0, inputTokens: 1, outputTokens: 1, durationMs: 1 }, notices: [], plan: null, review: { checklist: ["check this result"] }, protectedChanged: null, kind: "run", planRunId: runId === APPLY ? PLAN : null, unsafeMoves: null, applied: [], finalMessage: null });
const applyResult = (kind: PlanKind): RunResultView => kind === "changes" ? result()
  : { ...result(), kind: "apply", status: "done", reason: "applied", exitCode: 0, changes: [], review: null, applied: [{ kind: "move", from: "edit.md", to: "moved.md" }] };

let boots = 0;
async function renderer(t: TestContext, kind: PlanKind) {
  const restoreDom = installFakeDom();
  const root = new FakeElement("div"); root.setAttribute("id", "app");
  const doc = document as unknown as Record<string, unknown>;
  const keys = ["getElementById", "documentElement", "addEventListener", "removeEventListener"];
  const descriptors = keys.map(key => [key, Object.getOwnPropertyDescriptor(doc, key)] as const);
  Object.assign(doc, { getElementById: (id: string) => id === "app" ? root : root.findAll(e => e.getAttribute("id") === id)[0] ?? null, documentElement: new FakeElement("html"), addEventListener() {}, removeEventListener() {} });
  const globals = ["window", "setInterval", "clearInterval"] as const;
  const globalDescriptors = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  // Only the renderer's elapsed-time display is replaced, without changing host/test timeouts.
  Object.defineProperty(globalThis, "setInterval", { configurable: true, value: () => 0 });
  Object.defineProperty(globalThis, "clearInterval", { configurable: true, value: () => undefined });
  t.after(() => {
    for (const work of root.findAll(e => e.getAttribute("id") === "work")) work.replaceChildren();
    root.replaceChildren();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(doc, key, descriptor); else delete doc[key]; }
    for (const [key, descriptor] of globalDescriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    restoreDom();
  });
  const calls: { name: string; args: unknown[] }[] = [], hostNotes: string[] = [];
  const events = new Map<string, (payload: unknown) => void>();
  const row = { state: "checked", runId: PLAN, kind: "run", startedAt: null, taskId: "fixture", status: "needs-input", reason: "plan_pending", changes: 0, reverted: null, revertRecordDamaged: false, form: PLAN_FORM };
  const view: ReportView = {
    runId: APPLY, kind: kind === "moves" ? "apply" : "run", status: "complete", finished: { status: "needs-input", reason: "awaiting_review" }, usage: null, verifiers: [], integrity: [], records: 0, taskId: "fixture",
    run: kind === "changes" ? { workflow: PLAN_FORM.workflow, provider: null, modelRequests: 1, deniedToolCalls: 0, repairs: 0, changes: [{ path: "edit.md", created: false }], verdict: null } : null,
    apply: kind === "moves" ? { planRunId: PLAN, digest: "d".repeat(64), approval: "adapter", unsafeMoveConsent: null, actions: 1, unsafeMoves: 0, inventoryLimitReached: false, moved: [{ from: "edit.md", to: "moved.md", unsafe: false }], discarded: [], failed: [] } : null,
    review: kind === "changes" ? { checklist: ["check this result"] } : null,
  };
  const api = new Proxy({}, { get: (_target, key) => (...args: unknown[]) => {
    const name = String(key);
    if (name.startsWith("on")) { events.set(name, args[0] as (payload: unknown) => void); return; }
    calls.push({ name, args });
    if (name === "info") return Promise.resolve({ language: "en", engine: "ready", initialWorkspace: A, ui: { screen: "home", treeWidth: null } });
    if (name === "settings") return Promise.resolve(settings);
    if (name === "recent") return Promise.resolve({ ok: true, recent: [] });
    if (name === "tree") return Promise.resolve({ ok: true, entries: [{ id: "c".repeat(32), name: "edit.md", kind: "file", masked: false, protected: false }], total: 1, offset: 0, nextOffset: null });
    if (name === "startRun" || name === "startTaskRun") return Promise.resolve({ ok: true, runId: FIRST });
    if (name === "listRuns") return Promise.resolve({ ok: true, runs: [row], omitted: 0 });
    if (name === "plan") return Promise.resolve({ ok: true, approval: APPROVAL, view: { runId: PLAN, digest: "d".repeat(64), status: "pending", actions: kind === "moves" ? [{ kind: "move", from: "edit.md", to: "moved.md" }] : [], appliedBy: null, summary: [], inventoryLimitReached: false, ...(kind === "changes" ? { planKind: kind, files: [{ path: "edit.md", change: "modify", sha256: "d".repeat(64) }] } : {}) } });
    if (name === "checkPlan") return Promise.resolve({ ok: true, problems: [], unsafeMoves: [], probesLeft: 0, probesRemoved: 0, lockLeft: false });
    if (name === "applyPlan") return Promise.resolve({ ok: true, runId: APPLY });
    if (name === "report") return Promise.resolve({ ok: true, view });
    if (name === "review") {
      // Synthetic host policy only: the plan's form enables its additional registered value.
      const note = String(args[5]);
      hostNotes.push(args[2] === PLAN_FORM.profile && args[3] === PLAN_FORM.workflow ? note.replaceAll(SAMPLE, "[masked]") : note);
      return Promise.resolve({ ok: true, verdict: "accepted", replaced: false });
    }
    return Promise.resolve({ ok: false, code: "fixture_unused" });
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { codaryn: api } });
  await import(`../../src/renderer/app.js?ir-apply-form=${++boots}`);
  await settle(); await settle();
  const byId = (id: string): FakeElement => { const item = root.findAll(e => e.getAttribute("id") === id)[0]; assert.ok(item, `actual app element ${id}`); return item; };
  const show = (id: string): void => { const tab = root.findAll(e => e.tagName === "button" && e.getAttribute("data-screen") === id)[0]; assert.ok(tab, `screen ${id}`); tab.click(); };
  const finish = (value: RunResultView): void => { events.get("onRunDone")!({ ok: true, runId: value.runId, result: value, labels: { status: "Needs input", reason: "Awaiting review" } }); };
  return {
    root, calls, hostNotes, byId, show, finish,
    async start(prior: Prior) {
      if (prior === "none") return;
      show("newtask"); await settle();
      if (prior === "task") byId("task-run-file").click();
      else {
        byId("task-goal").value = GOAL; byId("task-profile").value = OLD_FORM.profile; byId("task-workflow").value = OLD_FORM.workflow;
        byId("task-run").click();
      }
      await settle(); await settle();
      assert.deepEqual(calls.filter(call => call.name === (prior === "task" ? "startTaskRun" : "startRun")).at(-1)?.args, prior === "task" ? [A.handle, false] : [A.handle, GOAL, OLD_FORM.profile, OLD_FORM.workflow]);
      finish(result(FIRST));
    },
    async applyPlan() {
      show("runs"); await settle();
      const open = root.findAll(e => e.getAttribute("data-plan") === PLAN)[0]; assert.ok(open); open.click(); await settle(); await settle();
      assert.deepEqual(calls.find(call => call.name === "plan")?.args, [A.handle, PLAN, PLAN_FORM.profile, PLAN_FORM.workflow]);
      assert.equal(byId("plan-apply").hasAttribute("disabled"), false);
      byId("plan-apply").click(); await settle(); await settle();
      assert.deepEqual(calls.filter(call => call.name === "applyPlan").at(-1)?.args, [APPROVAL, false]);
      assert.equal(byId("run-state").getAttribute("data-phase"), "running");
    },
    async finishApply(value = applyResult(kind)) { finish(value); show("run"); await settle(); await settle(); assert.equal(byId("run-state").getAttribute("data-phase"), "done"); },
    async review() {
      byId("review-note").value = `review ${SAMPLE}`; byId("review-accept").click(); byId("review-record").click(); await settle();
    },
    async reportLog() { byId("run-view-report").click(); await settle(); byId("report-tab-log").click(); await settle(); },
    openB() { events.get("onWorkspaceOpened")!({ ...B }); },
  };
}

for (const prior of ["task", "quick"] as const) for (const action of ["inline review", "report review", "changes", "tree"] as const) {
  test(`H-1 [모의 API·실제 API 아님]: ${prior} then different plan form reaches ${action}`, async t => {
    const app = await renderer(t, "changes"); await app.start(prior); await app.applyPlan(); await app.finishApply();
    const before = app.calls.length;
    if (action === "inline review" || action === "report review") {
      if (action === "report review") { app.byId("run-view-report").click(); await settle(); app.byId("report-tab-review").click(); }
      await app.review();
      assert.equal(app.hostNotes.at(-1), "review [masked]", "the synthetic host's additional plan-form value is masked");
      assert.deepEqual(app.calls.slice(before).find(call => call.name === "review")?.args, [A.handle, APPLY, PLAN_FORM.profile, PLAN_FORM.workflow, "accept", `review ${SAMPLE}`]);
    } else {
      if (action === "changes") app.byId("run-view-changes").click();
      else { const file = app.root.findAll(e => e.getAttribute("role") === "treeitem" && e.getAttribute("data-change") !== null)[0]; assert.ok(file, "actual app's changed-file mark"); file.click(); }
      await settle();
      assert.deepEqual(app.calls.slice(before).find(call => call.name === "changes")?.args, [A.handle, APPLY, PLAN_FORM.profile, PLAN_FORM.workflow]);
    }
  });
}

for (const prior of ["task", "quick"] as const) for (const kind of ["moves", "changes"] as const) {
  test(`H-1 [모의 API·실제 API 아님]: ${prior} then ${kind} plan report log keeps its plan form`, async t => {
    const app = await renderer(t, kind); await app.start(prior); await app.applyPlan(); await app.finishApply(); await app.reportLog();
    assert.deepEqual(app.calls.filter(call => call.name === "runEvents").at(-1)?.args, [A.handle, APPLY, PLAN_FORM.profile, PLAN_FORM.workflow, 0]);
  });
}

for (const prior of ["task", "quick"] as const) test(`H-1 [모의 API·실제 API 아님]: consent retry after ${prior} and opening B retains the plan form`, async t => {
  const app = await renderer(t, "moves"); await app.start(prior); await app.applyPlan();
  await app.finishApply({ ...applyResult("moves"), status: "needs-input", reason: "consent_required", exitCode: 3, applied: [], unsafeMoves: 1 });
  app.openB(); app.show("run"); await settle(); await settle();
  app.byId("run-consent").click(); await settle(); await settle();
  assert.deepEqual(app.calls.filter(call => call.name === "applyPlan").map(call => call.args), [[APPROVAL, false], [APPROVAL, true]]);
  assert.ok(app.byId("status-workspace").textContent.includes(A.name));
  await app.finishApply(); await app.reportLog();
  assert.deepEqual(app.calls.filter(call => call.name === "runEvents").at(-1)?.args, [A.handle, APPLY, PLAN_FORM.profile, PLAN_FORM.workflow, 0]);
});

for (const prior of ["task", "quick"] as const) for (const action of ["run-again", "run-new-plan"] as const) {
  test(`H-1 [모의 API·실제 API 아님]: ${action} after ${prior} retains the available session goal`, async t => {
    const app = await renderer(t, "changes"); await app.start(prior); await app.applyPlan();
    await app.finishApply(action === "run-new-plan" ? { ...result(), reason: "plan_stale", changes: [], review: null } : result());
    app.byId(action).click(); await settle();
    assert.equal(app.byId("task-goal").value, prior === "quick" ? GOAL : "");
  });
}

test("H-1 [모의 API·실제 API 아님]: applying a listed plan without an earlier request still supplies its form", async t => {
  const app = await renderer(t, "changes"); await app.start("none"); await app.applyPlan(); await app.finishApply();
  app.byId("run-view-changes").click(); await settle();
  assert.deepEqual(app.calls.filter(call => call.name === "changes").at(-1)?.args, [A.handle, APPLY, PLAN_FORM.profile, PLAN_FORM.workflow]);
});
