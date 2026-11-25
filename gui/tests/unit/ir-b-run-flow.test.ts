/** IR-B1/B2/B3: real IPC handlers and the actual renderer app, with host/DOM/API boundaries faked. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { IpcDeps } from "../../src/main/ipc.js";
import type { HostRunMessage } from "../../src/shared/protocol.js";
import type { RunResultView } from "../../src/shared/ipc.js";
import { IPC_CHANNELS, createIpc } from "./gsec-ipc-harness.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const A = { handle: "a".repeat(32), name: "folder A" };
const B = { handle: "b".repeat(32), name: "folder B" };
const RUN = "20261125T080000Z-00000001";
const APPLY = "20261125T080000Z-00000002";
const PLAN = "20261125T080000Z-00000003";
const TOKEN = "1".repeat(32);
const settings = { ok: true, view: { file: null, model: null, language: null, profiles: [], workflows: { builtin: [], config: [] }, keyAvailable: false, providers: [], env: { model: false, language: false }, rules: { limits: [], commands: [], protectedPaths: [], secretEnv: [] }, provider: null, defaultProvider: null, apiProviders: [] } };
const result = (): RunResultView => ({ runId: RUN, status: "needs-input", reason: "awaiting_review", exitCode: 3, changes: [{ path: "a.md", created: false }], verifiers: [], usage: { turns: 1, tools: 0, inputTokens: 1, outputTokens: 1, durationMs: 1 }, notices: [], plan: null, review: { checklist: ["check the result"] }, protectedChanged: null, kind: "run", planRunId: null, unsafeMoves: null, applied: [], finalMessage: null });

for (const [firstKind, secondKind] of [["start", "start"], ["start", "apply"], ["apply", "start"], ["apply", "apply"], ["task", "task"], ["task", "start"], ["task", "apply"], ["start", "task"], ["apply", "task"]] as const) {
  test(`IR-B1: delayed host reserves ${firstKind} against ${secondKind} in another workspace`, async () => {
    const ipc = await createIpc();
    const firstSpace = await ipc.openWorkspace(), secondSpace = await ipc.openWorkspace();
    const available = await ipc.deps.host();
    const gate = Promise.withResolvers<Awaited<ReturnType<IpcDeps["host"]>>>();
    let arrivals = 0, starts = 0;
    Object.assign(ipc.deps, { host: async () => { arrivals += 1; return gate.promise; } });
    ipc.confirm = true;
    Object.assign(ipc.deps, { chooseOpenFile: async () => "fixture-task.json" });
    ipc.answer = call => call === "cancelRun" ? { v: 1, id: 0, ok: true, value: { ok: true } }
      : { v: 1, id: 0, ok: true, value: { ok: true, runId: `20261125T080000Z-${String(++starts).padStart(8, "0")}`, run: String(starts).repeat(32) } };
    const request = (kind: "start" | "apply" | "task", workspace: string) => kind === "task"
      ? ipc.call(IPC_CHANNELS.startTaskRun, [{ workspace, withVars: false }]) : kind === "start"
      ? ipc.call(IPC_CHANNELS.startRun, [{ workspace, goal: "do the work", profile: null, workflow: null }])
      : ipc.call(IPC_CHANNELS.applyPlan, [{ approval: ipc.deps.approvals.issue({ workspace, profile: null, workflowRef: null, planRunId: RUN, digest: "d".repeat(64), moves: 1, discards: 0 }), askConsent: false }]);
    const first = request(firstKind, firstSpace.handle);
    await settle();
    const second = request(secondKind, secondSpace.handle);
    await settle();
    const waiting = arrivals;
    gate.resolve(available);
    const [accepted, refused] = await Promise.all([first, second]);
    assert.deepEqual(refused, { ok: false, code: "run_active" });
    assert.deepEqual(accepted, { ok: true, runId: RUN });
    assert.equal(waiting, 1, "only the reserved request acquires the host");
    assert.equal(ipc.hostCalls.filter(call => call.call === "startRun" || call.call === "applyPlan" || call.call === "startTaskRun").length, 1);
    assert.equal(ipc.deps.runs.token, TOKEN, "the first run keeps its token");
    await ipc.deps.runs.receive({ v: 1, type: "events", run: TOKEN, items: [], counts: { turns: 1, tools: 0 } } as HostRunMessage);
    assert.ok(ipc.sent.some(row => (row.payload as { runId?: string }).runId === RUN), "first run progress still reaches the window");
    assert.equal(await ipc.call(IPC_CHANNELS.cancelRun, []), true);
    assert.deepEqual(ipc.hostCalls.at(-1), { call: "cancelRun", args: { run: TOKEN } });
  });
}

for (const kind of ["start", "apply"] as const) for (const outcome of ["unavailable", "throws"] as const) {
  test(`IR-B1: a ${outcome} host releases the ${kind} reservation`, async () => {
    const ipc = await createIpc(), workspace = await ipc.openWorkspace();
    const available = await ipc.deps.host();
    Object.assign(ipc.deps, { host: async () => { if (outcome === "throws") throw new Error("synthetic host failure"); return { failure: "host_not_started" }; } });
    ipc.confirm = true;
    const request = () => kind === "start"
      ? ipc.call(IPC_CHANNELS.startRun, [{ workspace: workspace.handle, goal: "work", profile: null, workflow: null }])
      : ipc.call(IPC_CHANNELS.applyPlan, [{ approval: ipc.deps.approvals.issue({ workspace: workspace.handle, profile: null, workflowRef: null, planRunId: PLAN, digest: "d".repeat(64), moves: 1, discards: 0 }), askConsent: false }]);
    if (outcome === "throws") await assert.rejects(request(), /synthetic host failure/);
    else assert.deepEqual(await request(), { ok: false, code: "host_not_started" });
    Object.assign(ipc.deps, { host: async () => available });
    ipc.answer = () => ({ v: 1, id: 0, ok: true, value: { ok: true, run: TOKEN, runId: RUN } });
    assert.deepEqual(await request(), { ok: true, runId: RUN });
  });
}

test("IR-B1: declining apply confirmation releases the common reservation", async () => {
  const ipc = await createIpc(), workspace = await ipc.openWorkspace();
  const approval = ipc.deps.approvals.issue({ workspace: workspace.handle, profile: null, workflowRef: null, planRunId: RUN, digest: "d".repeat(64), moves: 1, discards: 0 });
  assert.deepEqual(await ipc.call(IPC_CHANNELS.applyPlan, [{ approval, askConsent: false }]), { ok: false, code: "not_confirmed" });
  ipc.answer = () => ({ v: 1, id: 0, ok: true, value: { ok: true, run: TOKEN, runId: RUN } });
  assert.deepEqual(await ipc.call(IPC_CHANNELS.startRun, [{ workspace: workspace.handle, goal: "work", profile: null, workflow: null }]), { ok: true, runId: RUN });
});

let boots = 0;
async function renderer(t: TestContext) {
  const restoreDom = installFakeDom();
  const root = new FakeElement("div"); root.setAttribute("id", "app");
  const doc = document as unknown as Record<string, unknown>;
  const keys = ["getElementById", "documentElement", "addEventListener", "removeEventListener"];
  const descriptors = keys.map(key => [key, Object.getOwnPropertyDescriptor(doc, key)] as const);
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  Object.assign(doc, {
    getElementById: (id: string) => id === "app" ? root : root.findAll(e => e.getAttribute("id") === id)[0] ?? null,
    documentElement: new FakeElement("html"),
    addEventListener: (name: string, fn: (value: unknown) => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
    removeEventListener: (name: string, fn: (value: unknown) => void) => listeners.get(name)?.delete(fn),
  });
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const intervalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "setInterval");
  const clearDescriptor = Object.getOwnPropertyDescriptor(globalThis, "clearInterval");
  // Only the renderer's elapsed-time display is replaced; no engine/host/test timeout is changed.
  Object.defineProperty(globalThis, "setInterval", { configurable: true, value: () => 0 });
  Object.defineProperty(globalThis, "clearInterval", { configurable: true, value: () => undefined });
  t.after(() => {
    for (const work of root.findAll(e => e.getAttribute("id") === "work")) work.replaceChildren();
    root.replaceChildren();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(doc, key, descriptor); else delete doc[key]; }
    for (const [key, descriptor] of [["window", windowDescriptor], ["setInterval", intervalDescriptor], ["clearInterval", clearDescriptor]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
    restoreDom();
  });
  const calls: { name: string; args: unknown[] }[] = [], events = new Map<string, (payload: unknown) => void>();
  let delayedSettings: Promise<unknown> | null = null, listedInB = true, planKind: "moves" | "changes" | null = null;
  const row = { state: "checked", runId: RUN, kind: "run", startedAt: null, taskId: "fixture", status: "needs-input", reason: "awaiting_review", changes: 1, reverted: null, revertRecordDamaged: false };
  const api = new Proxy({}, { get: (_target, key) => (...args: unknown[]) => {
    const name = String(key);
    if (name.startsWith("on")) { events.set(name, args[0] as (payload: unknown) => void); return; }
    calls.push({ name, args });
    if (name === "info") return Promise.resolve({ language: "en", engine: "ready", initialWorkspace: A, ui: { screen: "home", treeWidth: null } });
    if (name === "settings") return delayedSettings ?? Promise.resolve(settings);
    if (name === "tree") return Promise.resolve({ ok: true, entries: [{ id: "c".repeat(32), name: "edit.md", kind: "file", masked: false, protected: false }], total: 1, offset: 0, nextOffset: null });
    if (name === "openText") return Promise.resolve({ ok: true, opened: true, text: "original", masked: false, protected: false, editable: true, readOnlyReasons: [], lines: 1, editToken: "e".repeat(32) });
    if (name === "recent") return Promise.resolve({ ok: true, recent: [] });
    if (name === "startRun" || name === "startTaskRun") return Promise.resolve({ ok: true, runId: RUN });
    if (name === "listRuns") return Promise.resolve({ ok: true, runs: args[0] === B.handle && !listedInB ? [] : planKind === null ? [row] : [row, { ...row, runId: APPLY }, { ...row, runId: PLAN, reason: "plan_pending", changes: 0, form: { profile: null, workflow: null } }], omitted: 0 });
    if (name === "plan") return Promise.resolve({ ok: true, approval: TOKEN, view: { runId: PLAN, digest: "d".repeat(64), status: "pending", actions: planKind === "moves" ? [{ kind: "move", from: "a.md", to: "b.md" }] : [], appliedBy: null, summary: [], inventoryLimitReached: false, ...(planKind === "changes" ? { planKind, files: [{ path: "a.md", change: "modify", sha256: "d".repeat(64) }] } : {}) } });
    if (name === "checkPlan") return Promise.resolve({ ok: true, problems: [], unsafeMoves: [], probesLeft: 0, probesRemoved: 0, lockLeft: false });
    if (name === "applyPlan") return Promise.resolve({ ok: true, runId: APPLY });
    return Promise.resolve({ ok: false, code: "fixture_unused" });
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { codaryn: api } });
  await import(`../../src/renderer/app.js?ir-run-flow=${++boots}`);
  await settle(); await settle();
  const byId = (id: string): FakeElement => { const e = root.findAll(el => el.getAttribute("id") === id)[0]; assert.ok(e, `actual app element ${id}`); return e; };
  const show = (id: string): void => { const tab = root.findAll(el => el.tagName === "button" && el.getAttribute("data-screen") === id)[0]; assert.ok(tab, `screen ${id}`); tab.click(); };
  const command = (id: string): void => {
    const event = { key: "P", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, preventDefault() {} };
    for (const fn of listeners.get("keydown") ?? []) fn(event);
    byId(`palette-option-${id}`).click();
  };
  return {
    root, calls, byId, show, command,
    delaySettings: (promise: Promise<unknown> | null) => { delayedSettings = promise; },
    async start(taskFile = false) {
      show("newtask"); await settle();
      if (taskFile) byId("task-run-file").click();
      else { byId("task-goal").value = "make a result"; byId("task-run").click(); }
      await settle(); await settle();
    },
    finish(view = result()) { events.get("onRunDone")!({ ok: true, runId: view.runId, result: view, labels: { status: "Needs input", reason: "Awaiting review" } }); },
    async applyListedPlan(kind: "moves" | "changes") {
      planKind = kind;
      show("runs"); await settle();
      const open = root.findAll(e => e.getAttribute("data-plan") === PLAN)[0];
      assert.ok(open, "quick plan in the actual run list"); open.click(); await settle(); await settle();
      assert.equal(byId("plan-apply").hasAttribute("disabled"), false, "the plan check finished");
      byId("plan-apply").click(); await settle(); await settle();
      assert.deepEqual(calls.find(call => call.name === "plan")?.args, [A.handle, PLAN, null, null]);
      assert.deepEqual(calls.filter(call => call.name === "applyPlan").at(-1)?.args, [TOKEN, false]);
      assert.equal(byId("run-state").getAttribute("data-phase"), "running");
    },
    openB() { events.get("onWorkspaceOpened")!({ ...B }); },
    setListedInB(value: boolean) { listedInB = value; },
    async editText() {
      const entry = root.findAll(e => e.getAttribute("role") === "treeitem" && e.textContent.includes("edit.md"))[0];
      assert.ok(entry, "actual app's tree file"); entry.click(); byId("tree-open").click(); await settle();
      byId("text-content").value = "changed"; byId("text-content").dispatch("input");
    },
    async showResult() { show("run"); await settle(); await settle(); assert.equal(byId("run-state").getAttribute("data-phase"), "done"); },
  };
}

for (const switchBeforeDone of [false, true]) {
  for (const [action, method] of [["run-save-report", "saveReport"], ["run-view-report", "report"], ["run-view-changes", "changes"], ["run-revert-preview", "previewRevert"], ["review-record", "review"]] as const) {
    test(`IR-B2: actual app ${action} stays with A after opening B ${switchBeforeDone ? "before" : "after"} completion`, async t => {
      const app = await renderer(t);
      await app.start();
      if (switchBeforeDone) app.openB();
      app.finish();
      if (!switchBeforeDone) app.openB();
      await app.showResult();
      const before = app.calls.length;
      if (action === "review-record") app.byId("review-accept").click();
      app.byId(action).click();
      await settle(); await settle();
      const used = app.calls.slice(before).filter(call => call.name === method);
      assert.equal(used.length, 1, `one ${method} request`);
      assert.deepEqual(used[0]!.args.slice(0, 2), [A.handle, RUN], "the run origin, even when B lists the same id");
    });
  }
}

test("IR-B2: same-folder next steps keep their existing workspace", async t => {
  const app = await renderer(t); await app.start(); app.finish(); await app.showResult();
  app.byId("run-save-report").click(); await settle();
  assert.deepEqual(app.calls.find(call => call.name === "saveReport")?.args, [A.handle, RUN]);
});

for (const listed of [false, true]) test(`IR-B2: task-file result keeps its separate listed-workspace boundary (${listed})`, async t => {
  const app = await renderer(t); app.setListedInB(listed); await app.start(true); app.finish(); app.openB(); await app.showResult();
  assert.ok(app.calls.some(call => call.name === "listRuns" && call.args[0] === B.handle));
  assert.equal(app.root.findAll(e => e.getAttribute("id") === "run-view-report").length, listed ? 1 : 0);
  assert.equal(app.root.findAll(e => e.getAttribute("id") === "review-accept").length, 0, "task-file form is unknown");
});

function appliedResult(kind: "moves" | "changes"): RunResultView {
  return kind === "changes" ? { ...result(), runId: APPLY, planRunId: PLAN }
    : { ...result(), runId: APPLY, kind: "apply", planRunId: PLAN, status: "done", reason: "applied", exitCode: 0, changes: [], review: null, applied: [{ kind: "move", from: "a.md", to: "b.md" }] };
}

for (const kind of ["moves", "changes"] as const) {
  const actions = kind === "moves"
    ? [["run-save-report", "saveReport"], ["run-view-report", "report"], ["run-revert-preview", "previewRevert"]] as const
    : [["run-save-report", "saveReport"], ["run-view-report", "report"], ["run-view-changes", "changes"], ["run-revert-preview", "previewRevert"], ["review-record", "review"]] as const;
  for (const [action, method] of actions) test(`G-1: task file then listed ${kind} plan: ${action} uses the apply origin A`, async t => {
    const app = await renderer(t);
    await app.start(true); app.finish();
    await app.applyListedPlan(kind); app.finish(appliedResult(kind)); app.openB(); await app.showResult();
    assert.ok(app.byId("status-workspace").textContent.includes(B.name));
    const before = app.calls.length;
    if (action === "review-record") app.byId("review-accept").click();
    app.byId(action).click(); await settle(); await settle();
    const used = app.calls.slice(before).filter(call => call.name === method);
    assert.equal(used.length, 1, `one ${method} request`);
    assert.deepEqual(used[0]!.args.slice(0, 2), [A.handle, APPLY], "the new apply origin, regardless of the earlier task file");
    if (action !== "run-save-report" && action !== "review-record") {
      assert.ok(app.byId("status-workspace").textContent.includes(A.name), "navigation changes the open workspace to A");
      assert.ok(document.title.startsWith(A.name));
    }
  });
}

for (const taskFile of [false, true]) test(`G-2: consent retry after opening B activates A (earlier task file: ${taskFile})`, async t => {
  const app = await renderer(t); await app.start(taskFile); app.finish();
  await app.applyListedPlan("moves");
  app.finish({ ...appliedResult("moves"), status: "needs-input", reason: "consent_required", exitCode: 3, applied: [], unsafeMoves: 1 });
  app.openB(); await app.showResult();
  assert.ok(app.byId("status-workspace").textContent.includes(B.name));
  app.byId("run-consent").click(); await settle(); await settle();
  assert.deepEqual(app.calls.filter(call => call.name === "applyPlan").map(call => call.args), [[TOKEN, false], [TOKEN, true]], "only the explicit retry grants consent");
  assert.ok(app.byId("status-workspace").textContent.includes(A.name));
  app.finish(appliedResult("moves")); await app.showResult();
  app.byId("run-save-report").click(); await settle();
  assert.deepEqual(app.calls.filter(call => call.name === "saveReport").at(-1)?.args, [A.handle, APPLY], "the retry also keeps A as its origin");
});

for (const action of ["run-again", "run-new-plan"] as const) test(`G-2: ${action} opens a new task in A after B was opened`, async t => {
  const app = await renderer(t); await app.start();
  app.finish(action === "run-new-plan" ? { ...result(), reason: "plan_stale", planRunId: PLAN, changes: [], review: null } : result());
  app.openB(); await app.showResult();
  app.byId(action).click(); await settle(); await settle();
  assert.equal(app.byId("work").getAttribute("data-screen"), "newtask");
  assert.ok(app.byId("status-workspace").textContent.includes(A.name));
  app.byId("task-goal").value = "retry in the original folder";
  app.byId("task-run").click(); await settle();
  assert.equal(app.calls.filter(call => call.name === "startRun").at(-1)?.args[0], A.handle);
});

test("IR-B3: actual app taskfile command waits for settings, then selects exactly once", async t => {
  const app = await renderer(t), gate = Promise.withResolvers<unknown>();
  app.delaySettings(gate.promise); app.command("taskfile");
  await settle();
  assert.equal(app.calls.filter(call => call.name === "startTaskRun").length, 0, "no selection while the screen is being prepared");
  gate.resolve(settings); await settle(); await settle();
  assert.deepEqual(app.calls.filter(call => call.name === "startTaskRun").map(call => call.args), [[A.handle, false]]);
  await settle(); assert.equal(app.calls.filter(call => call.name === "startTaskRun").length, 1);
});

test("IR-B3: direct task-file button still sends the selected variables option", async t => {
  const app = await renderer(t); app.show("newtask"); await settle();
  (app.byId("task-with-vars") as FakeElement & { checked: boolean }).checked = true;
  app.byId("task-run-file").click(); await settle();
  assert.deepEqual(app.calls.filter(call => call.name === "startTaskRun").map(call => call.args), [[A.handle, true]]);
});

test("IR-B3: leaving a waiting new-task screen does not open a late task-file selector", async t => {
  const app = await renderer(t), gate = Promise.withResolvers<unknown>();
  app.delaySettings(gate.promise); app.command("taskfile"); app.show("home");
  gate.resolve(settings); await settle(); await settle();
  assert.equal(app.calls.filter(call => call.name === "startTaskRun").length, 0);
});

test("IR-B3: repeated pending commands discard the old settings continuation", async t => {
  const app = await renderer(t), old = Promise.withResolvers<unknown>(), latest = Promise.withResolvers<unknown>();
  app.delaySettings(old.promise); app.command("taskfile");
  app.delaySettings(latest.promise); app.command("taskfile");
  old.resolve(settings); await settle();
  assert.equal(app.calls.filter(call => call.name === "startTaskRun").length, 0);
  latest.resolve(settings); await settle(); await settle();
  assert.equal(app.calls.filter(call => call.name === "startTaskRun").length, 1);
});

test("IR-B3: the command cannot start a task file while a quick run is active", async t => {
  const app = await renderer(t); await app.start(); app.command("taskfile"); await settle();
  assert.equal(app.calls.filter(call => call.name === "startRun").length, 1);
  assert.equal(app.calls.filter(call => call.name === "startTaskRun").length, 0);
});

for (const decision of ["keep", "discard"] as const) test(`IR-B3: actual app taskfile command respects the unsaved-text ${decision} decision`, async t => {
  const app = await renderer(t); await app.editText(); app.command("taskfile");
  assert.equal(app.calls.filter(call => call.name === "startTaskRun").length, 0);
  app.byId(`text-leave-${decision}`).click(); await settle(); await settle();
  if (decision === "keep") {
    assert.equal(app.byId("work").getAttribute("data-screen"), "text");
    app.show("newtask"); app.byId("text-leave-discard").click(); await settle();
    assert.equal(app.calls.filter(call => call.name === "startTaskRun").length, 0, "the cancelled taskfile intent does not survive a later normal navigation");
  } else assert.equal(app.calls.filter(call => call.name === "startTaskRun").length, 1);
});
