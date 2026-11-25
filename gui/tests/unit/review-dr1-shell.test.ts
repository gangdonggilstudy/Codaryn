/** DR-1: a real Shell/runScreen must remain disposed after asynchronous or explicit redraws. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { RunModel } from "../../src/renderer/run/run-model.js";
import { runScreen } from "../../src/renderer/run/run-screen.js";
import { Shell } from "../../src/renderer/shell/shell.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const snapshot = (root: FakeElement): unknown => ({ tag: root.tagName, text: root.textContent,
  attrs: ["id", "data-engine", "data-restart", "data-run-phase", "hidden", "disabled", "aria-current"].map(k => [k, root.getAttribute(k)]),
  children: root.children.map(snapshot) });

function fixture(t: TestContext) {
  const restore = installFakeDom(), timers = new Set<number>(), listeners = new Set<() => void>(); let timerId = 0;
  t.mock.method(globalThis, "setInterval", (() => { const id = ++timerId; timers.add(id); return id; }) as unknown as typeof setInterval);
  t.mock.method(globalThis, "clearInterval", ((id: number) => timers.delete(id)) as unknown as typeof clearInterval);
  const model = new RunModel(), subscribe = model.subscribe.bind(model);
  t.mock.method(model, "subscribe", (listener: () => void) => {
    const unsubscribe = subscribe(listener); listeners.add(unsubscribe);
    return () => { listeners.delete(unsubscribe); unsubscribe(); };
  });
  let shown = 0;
  const shell = new Shell(textsFor("en"), { openWorkspace: () => undefined, shown: () => { shown++; } });
  const page = new FakeElement("div"), oldRoot = new FakeElement("div"); page.append(oldRoot);
  shell.mount(oldRoot as unknown as HTMLElement);
  shell.add(runScreen({ texts: textsFor("en"), api: {} as CodarynApi, run: model, current: () => null,
    newTask: () => undefined, announce: () => undefined, openPlan: () => undefined, openChanges: () => undefined, openReport: () => undefined }));
  shell.show("run");
  const byId = (id: string) => { const found = oldRoot.findAll(e => e.getAttribute("id") === id)[0]; assert.ok(found, id); return found; };
  const discard = () => { shell.destroy(); page.replaceChildren(new FakeElement("article")); };
  t.after(() => { shell.destroy(); for (const stop of listeners) stop(); t.mock.restoreAll(); restore(); });
  return { shell, byId, oldRoot, discard, counts: () => ({ listeners: listeners.size, timers: timers.size }), shown: () => shown };
}

for (const answer of ["ready", "synthetic_restart_failed"]) test(`DR-1: a discarded Shell ignores late ${answer} without DOM work or new resources`, async t => {
  const f = fixture(t), gate = Promise.withResolvers<string>(); let restarts = 0;
  f.shell.engineEnded("adapter_host_exited", () => { restarts++; return gate.promise; });
  f.byId("engine-restart").click(); assert.equal(restarts, 1);
  f.discard(); const before = snapshot(f.oldRoot), shown = f.shown();
  assert.deepEqual(f.counts(), { listeners: 0, timers: 0 });
  gate.resolve(answer); await settle(); await settle();
  t.diagnostic(JSON.stringify({ answer, counts: f.counts(), shownBefore: shown, shownAfter: f.shown(), sameDOM: JSON.stringify(before) === JSON.stringify(snapshot(f.oldRoot)) }));
  assert.deepEqual(f.counts(), { listeners: 0, timers: 0 });
  assert.deepEqual(snapshot(f.oldRoot), before); assert.equal(f.shown(), shown);
  f.shell.destroy(); assert.deepEqual(f.counts(), { listeners: 0, timers: 0 });
});

for (const action of ["show", "refresh"] as const) test(`DR-1: ${action} on a discarded Shell cannot recreate the run view`, t => {
  const f = fixture(t); f.discard(); const before = snapshot(f.oldRoot), shown = f.shown();
  if (action === "show") f.shell.show("run"); else f.shell.refresh();
  assert.deepEqual(f.counts(), { listeners: 0, timers: 0 });
  assert.deepEqual(snapshot(f.oldRoot), before); assert.equal(f.shown(), shown);
});

for (const answer of ["ready", "synthetic_restart_failed"]) test(`DR-1 control: a live Shell handles ${answer} and still changes screens`, async t => {
  const f = fixture(t), gate = Promise.withResolvers<string>();
  f.shell.engineEnded("adapter_host_exited", () => gate.promise);
  f.byId("engine-restart").click(); assert.equal(f.byId("engine-restart").hasAttribute("disabled"), true);
  gate.resolve(answer); await settle(); await settle();
  if (answer === "ready") {
    assert.equal(f.byId("status-engine").getAttribute("data-engine"), "ready");
    assert.equal(f.byId("engine-ended").hasAttribute("hidden"), true);
  } else {
    assert.equal(f.byId("engine-ended").getAttribute("data-restart"), answer);
    assert.equal(f.byId("engine-restart").hasAttribute("disabled"), false);
  }
  f.shell.add({ id: "synthetic", title: "nav.home", show: root => root.replaceChildren(new FakeElement("p") as unknown as HTMLElement) });
  f.shell.show("synthetic"); assert.equal(f.shell.currentScreen, "synthetic");
  f.shell.show("run"); assert.deepEqual(f.counts(), { listeners: 1, timers: 1 });
});
