/** IR-D1/D2/D3: real renderer entry/screens, deferred API replies and a DOM stand-in. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { CodarynApi, Workspace } from "../../src/renderer/api.js";
import { changesScreen } from "../../src/renderer/changes/changes-screen.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { TreeView } from "../../src/renderer/workspace/tree-view.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const A = { handle: "a".repeat(32), name: "workspace A", lastForm: { profile: "alpha", workflow: "organize" } };
const B = { handle: "b".repeat(32), name: "workspace B", lastForm: { profile: "beta", workflow: "analyze" } };
const RUN = "20261127T010203Z-00000001", OTHER = "20261127T010203Z-00000002";
const view = {
  file: { display: "synthetic-config.json", source: "default", exists: true }, model: null, language: null,
  profiles: ["alpha", "beta"].map(name => ({ name, workflowRef: null, provider: null, limits: [], commands: [], verifiers: 0, protectedPaths: 0 })),
  workflows: { builtin: ["organize", "analyze"], config: [] }, keyAvailable: false, providers: [],
  env: { model: false, language: false }, rules: { limits: [], commands: [], protectedPaths: [], secretEnv: [] },
  policyNarrowings: [], provider: null, defaultProvider: null, apiProviders: [],
};
const written = { ok: true, written: true, changes: [], widening: [] };
const tick = async (): Promise<void> => { await settle(); await settle(); };
let boots = 0;

async function renderer(t: TestContext) {
  const restore = installFakeDom(), root = new FakeElement("div");
  const doc = document as unknown as Record<string, unknown>;
  const replacements = { getElementById: (id: string) => id === "app" ? root : find(id) ?? null, documentElement: new FakeElement("html") };
  const descriptors = Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(doc, key)] as const);
  Object.assign(doc, replacements);
  const globals = ["window", "setInterval", "clearInterval"] as const;
  const originals = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, "setInterval", { configurable: true, value: () => 0 });
  Object.defineProperty(globalThis, "clearInterval", { configurable: true, value: () => undefined });
  t.after(() => {
    root.replaceChildren();
    for (const [key, desc] of descriptors) { if (desc) Object.defineProperty(doc, key, desc); else delete doc[key]; }
    for (const [key, desc] of originals) { if (desc) Object.defineProperty(globalThis, key, desc); else Reflect.deleteProperty(globalThis, key); }
    restore();
  });
  const find = (id: string): FakeElement | undefined => root.findAll(e => e.getAttribute("id") === id)[0];
  const byId = (id: string): FakeElement => { const e = find(id); assert.ok(e, id); return e; };
  const calls: { name: string; args: unknown[] }[] = [];
  const events = new Map<string, (value: unknown) => void>();
  let opening: Workspace = A, startReply: Promise<unknown> | null = null, saveReply: Promise<unknown> | null = null;
  const api = new Proxy({}, { get: (_target, key) => (...args: unknown[]) => {
    const name = String(key);
    if (name.startsWith("on")) { events.set(name, args[0] as (value: unknown) => void); return; }
    calls.push({ name, args });
    if (name === "info") return Promise.resolve({ language: "en", engine: "ready", initialWorkspace: A, ui: { screen: "home", treeWidth: null } });
    if (name === "settings") return Promise.resolve({ ok: true, view });
    if (name === "recent") return Promise.resolve([{ id: "d".repeat(32), name: opening.name, where: "synthetic", exists: true }]);
    if (name === "openFolder" || name === "openRecent") return Promise.resolve({ ok: true, ...opening });
    if (name === "tree") return Promise.resolve({ ok: true, entries: [{ id: "c".repeat(32), name: "edit.md", kind: "file", masked: false, protected: false }], total: 1, offset: 0, nextOffset: null });
    if (name === "openText") return Promise.resolve({ ok: true, opened: true, text: "original", masked: false, protected: false, editable: true, readOnlyReasons: [], lines: 1, editToken: "e".repeat(32) });
    if (name === "proposeSettings") return Promise.resolve({ ok: true, token: "f".repeat(32), changes: [{ field: "limits.maxModelTurns", change: "set" }], widening: [] });
    if (name === "applySettings") return saveReply ?? Promise.resolve(written);
    if (name === "startRun") return startReply ?? Promise.resolve({ ok: true, runId: RUN });
    return Promise.resolve({ ok: false, code: "synthetic_unused" });
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { codaryn: api } });
  await import(`../../src/renderer/app.js?review-d-late=${++boots}`);
  await tick();
  const show = (id: string): void => {
    const tab = root.findAll(e => e.tagName === "button" && e.getAttribute("data-screen") === id)[0];
    assert.ok(tab, `tab ${id}`); tab.click();
  };
  return {
    root, calls, byId, find, show,
    async save(gate: Promise<unknown>) {
      saveReply = gate; show("settings"); await tick();
      byId("settings-limit-maxModelTurns").value = "3";
      const propose = root.findAll(e => e.getAttribute("data-limit-set") === "maxModelTurns")[0];
      assert.ok(propose); propose.click(); await tick(); byId("settings-write").click(); await tick();
      assert.equal(calls.filter(c => c.name === "applySettings").length, 1);
    },
    async edit() {
      const entry = root.findAll(e => e.getAttribute("role") === "treeitem" && e.textContent.includes("edit.md"))[0];
      assert.ok(entry); entry.click(); byId("tree-open").click(); await tick();
      byId("text-content").value = "unsaved synthetic edit"; byId("text-content").dispatch("input");
    },
    async open(workspace: Workspace, route: "folder" | "recent" | "event") {
      opening = workspace;
      if (route === "event") events.get("onWorkspaceOpened")!({ ...workspace });
      else {
        show("home"); await tick();
        if (route === "folder") byId("open-workspace").click();
        else {
          const open = root.findAll(e => e.getAttribute("aria-label") === `Open: ${workspace.name}`)[0];
          assert.ok(open, "recent open button"); open.click();
        }
      }
      await tick();
    },
    async selections() {
      show("newtask"); await tick();
      // FakeElement keeps option.selected without the browser's select.value reflection.
      const selected = (id: string): string => byId(id).children.find(e => e.selected)?.getAttribute("value") ?? "";
      return { profile: selected("task-profile"), workflow: selected("task-workflow") };
    },
    finish() { events.get("onRunDone")!({ ok: false, runId: RUN, code: "synthetic_end" }); },
    async start(gate: Promise<unknown>, form = A.lastForm) {
      startReply = gate; show("newtask"); await tick();
      byId("task-goal").value = "synthetic task";
      byId("task-profile").value = form.profile; byId("task-workflow").value = form.workflow;
      byId("task-run").click(); await tick();
    },
  };
}

for (const destination of ["home", "text"] as const) test(`IR-D1: late non-language save preserves current ${destination} body and dirty state`, async t => {
  const app = await renderer(t), gate = Promise.withResolvers<unknown>();
  await app.save(gate.promise);
  if (destination === "text") await app.edit(); else app.show("home");
  const work = app.byId("work"), children = [...work.children];
  const area = app.find("text-content");
  gate.resolve(written); await tick();
  t.diagnostic(JSON.stringify({ destination, shell: work.getAttribute("data-screen"), settingsBody: app.find("settings") !== undefined, sameBody: children.every((e, i) => work.children[i] === e) }));
  assert.equal(work.getAttribute("data-screen"), destination);
  assert.deepEqual(work.children, children, "save completion must not bypass Shell and replace another screen");
  assert.equal(app.calls.filter(c => c.name === "info").length, 2, "written settings still check language");
  if (area) {
    assert.equal(app.byId("text-content"), area); assert.equal(area.value, "unsaved synthetic edit");
    assert.equal(app.calls.filter(c => c.name === "textDirty").at(-1)?.args[0], true);
    app.show("home"); assert.ok(app.find("text-leave-keep"), "dirty leave question remains active");
    assert.equal(work.getAttribute("data-screen"), "text");
  }
});

test("IR-D1: completion on the current settings view refreshes and announces the saved result", async t => {
  const app = await renderer(t), gate = Promise.withResolvers<unknown>(); await app.save(gate.promise);
  const before = app.byId("settings"); gate.resolve(written); await tick();
  assert.equal(app.byId("work").getAttribute("data-screen"), "settings");
  assert.notEqual(app.byId("settings"), before);
  assert.equal(app.byId("settings-proposal").getAttribute("data-proposal"), "written");
});

test("IR-D1: leaving and returning before save completion keeps the new settings body", async t => {
  const app = await renderer(t), gate = Promise.withResolvers<unknown>(); await app.save(gate.promise);
  app.show("home"); app.show("settings"); await tick();
  const body = app.byId("settings"); gate.resolve(written); await tick();
  assert.equal(app.byId("settings"), body, "an older view must not redraw a newer view of the same screen");
  app.show("home"); app.show("settings"); await tick();
  assert.equal(app.byId("settings-proposal").getAttribute("data-proposal"), "written", "off-screen completion is remembered");
});

for (const route of ["folder", "recent", "event"] as const) test(`IR-D3: ${route} opening keeps lastForm through the actual app's new-task selection`, async t => {
  const app = await renderer(t); await app.open(B, route);
  const selected = await app.selections(); t.diagnostic(JSON.stringify({ route, selected }));
  assert.deepEqual(selected, B.lastForm);
});

test("IR-D3: a late start for A does not replace B's form and retains A's result origin", async t => {
  const app = await renderer(t), gate = Promise.withResolvers<unknown>();
  await app.start(gate.promise); await app.open(B, "event");
  gate.resolve({ ok: true, runId: RUN }); await tick();
  assert.equal(app.calls.filter(c => c.name === "startRun").at(-1)?.args[0], A.handle);
  const selected = await app.selections(); t.diagnostic(JSON.stringify({ selected, expected: B.lastForm }));
  assert.deepEqual(selected, B.lastForm);
  assert.ok(app.byId("status-workspace").textContent.includes(B.name));
});

test("IR-D3: a successful start in the current workspace remembers its newly chosen form", async t => {
  const app = await renderer(t), gate = Promise.withResolvers<unknown>();
  await app.open(B, "event"); await app.start(gate.promise);
  gate.resolve({ ok: true, runId: RUN }); await tick();
  assert.deepEqual(await app.selections(), A.lastForm);
});

test("IR-D3: after a late start, returning through A's result uses A's new form", async t => {
  const app = await renderer(t), gate = Promise.withResolvers<unknown>();
  const form = { profile: "alpha", workflow: "analyze" };
  await app.start(gate.promise, form); await app.open(B, "event");
  gate.resolve({ ok: true, runId: RUN }); await tick();
  app.finish(); await tick(); app.show("run"); await tick();
  app.byId("run-again").click(); await tick();
  assert.ok(app.byId("status-workspace").textContent.includes(A.name));
  assert.deepEqual(await app.selections(), form, "the retained run origin must also get the remembered form");
});

function changesReply(runId: string, path: string) {
  return { ok: true, runId, recordsChanged: false, files: [{ path, created: false, state: "as_run_left", before: "old", after: "new", unavailable: null }] };
}

for (const scenario of ["reverse", "same-run-refresh", "workspace", "hidden"] as const) test(`IR-D2: ${scenario} discards stale changes before updating the real tree`, async t => {
  const restore = installFakeDom(); t.after(restore);
  let current: Workspace = A;
  const replies: ReturnType<typeof Promise.withResolvers<unknown>>[] = [];
  const api = {
    async tree() { return { ok: true, entries: [], total: 0, offset: 0, nextOffset: null }; },
    changes() { const gate = Promise.withResolvers<unknown>(); replies.push(gate); return gate.promise; },
  } as unknown as CodarynApi;
  const panel = new FakeElement("aside"), root = new FakeElement("main"), loaded: string[] = [];
  const tree = new TreeView(textsFor("en"), api, panel as unknown as HTMLElement);
  tree.setWorkspace(A); await tick();
  const screen = changesScreen({ texts: textsFor("en"), api, current: () => current, loaded: (run, files) => { loaded.push(run.runId); tree.markRun(run, files); } });
  screen.choose(RUN, null, null); screen.show(root as unknown as HTMLElement);
  if (scenario === "reverse" || scenario === "same-run-refresh") {
    if (scenario === "reverse") screen.choose(OTHER, null, null);
    screen.show(root as unknown as HTMLElement);
    replies[1]!.resolve(changesReply(scenario === "reverse" ? OTHER : RUN, "latest.txt")); await tick();
  } else if (scenario === "workspace") { current = B; tree.setWorkspace(B); await tick(); }
  else root.replaceChildren(new FakeElement("article"));
  const before = [...loaded], body = [...root.children], marks = panel.textContent;
  replies[0]!.resolve(changesReply(RUN, "stale.txt")); await tick();
  t.diagnostic(JSON.stringify({ scenario, before, loaded }));
  assert.deepEqual(loaded, before, "stale response must not call loaded");
  assert.equal(panel.textContent, marks, "tree marks must remain the latest workspace/view's");
  assert.deepEqual(root.children, body);
  if (before.length > 0) assert.ok(root.textContent.includes("latest.txt"));
});

test("IR-D2: a current changes reply still updates the tree and draws the files", async t => {
  const restore = installFakeDom(); t.after(restore);
  const loaded: string[] = [], root = new FakeElement("main");
  const api = { async changes() { return changesReply(RUN, "current.txt"); } } as unknown as CodarynApi;
  const screen = changesScreen({ texts: textsFor("en"), api, current: () => A, loaded: run => loaded.push(run.runId) });
  screen.choose(RUN, null, null); screen.show(root as unknown as HTMLElement); await tick();
  assert.deepEqual(loaded, [RUN]); assert.ok(root.textContent.includes("current.txt"));
});
