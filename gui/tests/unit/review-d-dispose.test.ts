/** IR-D4: real renderer language rebuilds, with the existing DOM/API stand-ins. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { RunModel } from "../../src/renderer/run/run-model.js";
import { Shell } from "../../src/renderer/shell/shell.js";
import { textScreen } from "../../src/renderer/text/text-screen.js";
import { runScreen } from "../../src/renderer/run/run-screen.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const tick = async () => { await settle(); await settle(); };
const view = { file: { display: "synthetic.json", source: "default", exists: true }, model: null, language: null,
  profiles: [], workflows: { builtin: [], config: [] }, keyAvailable: false, providers: [],
  env: { model: false, language: false }, rules: { limits: [], commands: [], protectedPaths: [], secretEnv: [] },
  policyNarrowings: [], provider: null, defaultProvider: null, apiProviders: [] };

test("IR-D4: repeated real language changes retain only current RunModel listeners and timer", async t => {
  const restore = installFakeDom();
  const root = new FakeElement("div"), doc = document as unknown as Record<string, unknown>;
  const changes: Record<string, unknown> = { getElementById: (id: string) => id === "app" ? root : find(id), documentElement: new FakeElement("html") };
  const before = Object.keys(changes).map(k => [k, Object.getOwnPropertyDescriptor(doc, k)] as const);
  Object.assign(doc, changes);
  const timers = new Map<number, () => void>(), active = new Set<() => void>(); let timerId = 0;
  t.mock.method(globalThis, "setInterval", ((fn: () => void) => { const id = ++timerId; timers.set(id, fn); return id; }) as unknown as typeof setInterval);
  t.mock.method(globalThis, "clearInterval", ((id: number) => timers.delete(id)) as unknown as typeof clearInterval);
  const subscribe = RunModel.prototype.subscribe;
  t.mock.method(RunModel.prototype, "subscribe", function(this: RunModel, listener: () => void) {
    const stop = subscribe.call(this, listener); active.add(stop);
    return () => { active.delete(stop); stop(); };
  });
  const win = Object.getOwnPropertyDescriptor(globalThis, "window");
  let language: "en" | "ko" = "en";
  let save = Promise.withResolvers<unknown>();
  const api = new Proxy({}, { get: (_target, key) => () => {
    const name = String(key);
    if (name.startsWith("on")) return;
    if (name === "info") return Promise.resolve({ language, engine: "ready", initialWorkspace: null });
    if (name === "settings") return Promise.resolve({ ok: true, view });
    if (name === "proposeSettings") return Promise.resolve({ ok: true, token: "a".repeat(32), changes: [{ field: "language", change: "set" }], widening: [] });
    if (name === "applySettings") return save.promise;
    return Promise.resolve({ ok: false, code: "synthetic_unused" });
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { codaryn: api } });
  t.after(() => {
    for (const stop of active) stop();
    for (const [k, desc] of before) { if (desc) Object.defineProperty(doc, k, desc); else delete doc[k]; }
    if (win) Object.defineProperty(globalThis, "window", win); else Reflect.deleteProperty(globalThis, "window");
    t.mock.restoreAll(); restore();
  });
  const find = (id: string) => root.findAll(e => e.getAttribute("id") === id)[0] ?? null;
  const click = (id: string) => { const e = find(id); assert.ok(e, id); e.click(); };
  const show = (id: string) => { const tab = root.findAll(e => e.getAttribute("data-screen") === id)[0]; assert.ok(tab); tab.click(); };
  const entry = "../../src/renderer/app.js?ir-d4-dispose";
  await import(entry); await tick();
  const samples: { listeners: number; timers: number }[] = [];
  for (let i = 0; i < 4; i++) {
    show("run"); await tick();
    show("settings"); await tick();
    save = Promise.withResolvers<unknown>();
    click("settings-language-change"); await tick(); click("settings-write"); await tick();
    show("run"); await tick();
    language = language === "en" ? "ko" : "en";
    save.resolve({ ok: true, written: true, changes: [], widening: [] }); await tick(); await tick();
    show("run"); await tick();
    // In a browser the old detached main still contains its state node. Ticks must not preserve it.
    for (const fn of [...timers.values()]) fn();
    samples.push({ listeners: active.size, timers: timers.size });
  }
  t.diagnostic(JSON.stringify({ samples }));
  assert.deepEqual(samples, Array.from({ length: 4 }, () => ({ listeners: 3, timers: 1 })));
});

test("IR-D4: Shell disposal releases text watchRun and run resources, including repeated destroy/show", t => {
  const restore = installFakeDom(); t.after(restore);
  const watches = new Set<() => void>(), timers = new Set<number>(); let n = 0, releases = 0;
  t.mock.method(globalThis, "setInterval", (() => { timers.add(++n); return n; }) as unknown as typeof setInterval);
  t.mock.method(globalThis, "clearInterval", ((id: number) => timers.delete(id)) as unknown as typeof clearInterval);
  const api = {} as CodarynApi, model = new RunModel();
  const text = textScreen({ texts: textsFor("en"), api, current: () => null, back: () => undefined,
    watchRun: listener => { watches.add(listener); return () => { releases++; watches.delete(listener); }; } });
  const shell = new Shell(textsFor("en"), { openWorkspace: () => undefined });
  shell.mount(new FakeElement("div") as unknown as HTMLElement); shell.add(text);
  shell.add(runScreen({ texts: textsFor("en"), api, run: model, newTask: () => undefined, announce: () => undefined,
    current: () => null, openPlan: () => undefined, openChanges: () => undefined, openReport: () => undefined }));
  shell.show("run"); shell.refresh();
  const during = timers.size; shell.destroy(); shell.destroy();
  t.diagnostic(JSON.stringify({ during, watches: watches.size, timers: timers.size, releases }));
  assert.deepEqual({ during, watches: watches.size, timers: timers.size, releases }, { during: 1, watches: 0, timers: 0, releases: 1 });
});
