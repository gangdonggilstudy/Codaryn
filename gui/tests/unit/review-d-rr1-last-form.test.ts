/** RR-1: real main start/second-instance flow, preload copy and renderer form selection. */
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { runInNewContext } from "node:vm";
import { randomBytes } from "node:crypto";
import type { IpcDeps } from "../../src/main/ipc-context.js";
import { Workspaces } from "../../src/main/workspaces.js";
import { IPC_EVENTS } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const tick = async () => { await settle(); await settle(); };
const FORM = { profile: "remembered", workflow: "organize" };
const RUN = "20261127T010203Z-00000001";
let boots = 0;
type Workspace = { handle: string; name: string; lastForm?: unknown };

async function main(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "codaryn-rr1-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const folder = join(root, "workspace"), stateFile = join(root, "gui-state.json"); mkdirSync(folder);
  const seed = new Workspaces({ stateFile, platform: process.platform, randomBytes, now: () => new Date(), isDirectory: async () => true });
  const opened = await seed.open(folder); assert.ok(opened.ok); await seed.rememberRun(opened.handle, RUN, FORM); await seed.flush();
  const listeners = new Map<string, (...args: unknown[]) => void>(), sent: { channel: string; payload: Workspace }[] = [];
  let deps: IpcDeps | null = null;
  const loaded = Promise.withResolvers<void>();
  class Window {
    webContents = { send: (channel: string, payload: Workspace) => sent.push({ channel, payload }) };
    isDestroyed() { return false; } isMinimized() { return false; } focus() {} on() {} once() {}
    async loadURL() { loaded.resolve(); }
  }
  const electron = { BrowserWindow: Window, Menu: { setApplicationMenu() {} }, nativeTheme: { shouldUseDarkColors: false },
    screen: { getAllDisplays: () => [] }, session: { defaultSession: {}, fromPartition: () => ({}) },
    app: { isPackaged: false, commandLine: { hasSwitch: () => false }, enableSandbox() {}, setPath() {}, requestSingleInstanceLock: () => true,
      on: (name: string, listener: (...args: unknown[]) => void) => listeners.set(name, listener), whenReady: () => Promise.resolve(), getPath: () => root } };
  return { root, folder, stateFile, electron, listeners, sent, loaded, capture: (value: IpcDeps) => { deps = value; }, deps: () => { assert.ok(deps); return deps; } };
}

function preload() {
  const events = new Map<string, (event: unknown, payload: unknown) => void>(); let api: Record<string, unknown> = {};
  runInNewContext(readFileSync(new URL("../../src/preload/preload.cjs", import.meta.url), "utf8"), {
    exports: {}, require: (name: string) => {
      assert.equal(name, "electron"); return { contextBridge: { exposeInMainWorld: (_: string, value: Record<string, unknown>) => { api = value; } },
        ipcRenderer: { on: (name: string, listener: (event: unknown, payload: unknown) => void) => events.set(name, listener) } };
    },
  });
  return { copy(payload: unknown): unknown {
    let copied: unknown; (api["onWorkspaceOpened"] as (listener: (value: unknown) => void) => void)(value => { copied = value; });
    events.get(IPC_EVENTS.workspaceOpened)!({ secretEvent: true }, payload); return copied;
  } };
}

test("RR-1 preload: only a nullable string pair is copied, without event or extra references", () => {
  const bridge = preload();
  for (const form of [FORM, { profile: null, workflow: null }, { profile: "", workflow: null }]) {
    const payload = { handle: "a".repeat(32), name: "workspace", lastForm: { ...form, extra: "drop" }, extra: "drop" };
    const copied = bridge.copy(payload);
    assert.deepEqual(JSON.parse(JSON.stringify(copied)), { handle: payload.handle, name: payload.name, lastForm: form });
    assert.notEqual((copied as { lastForm: unknown }).lastForm, payload.lastForm);
  }
  for (const lastForm of [undefined, null, [], "bad", {}, { profile: 3, workflow: null }, { profile: null, workflow: false }]) {
    assert.deepEqual(JSON.parse(JSON.stringify(bridge.copy({ handle: "a", name: "b", lastForm }))), { handle: "a", name: "b", lastForm: null });
  }
});

async function selections(t: TestContext, initial: unknown, event?: unknown) {
  const restore = installFakeDom(), root = new FakeElement("div"), doc = document as unknown as Record<string, unknown>;
  const replacements = { getElementById: (id: string) => id === "app" ? root : null, documentElement: new FakeElement("html") };
  const originals = Object.keys(replacements).map(k => [k, Object.getOwnPropertyDescriptor(doc, k)] as const);
  Object.assign(doc, replacements); const win = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new Map<string, (value: unknown) => void>();
  const view = { file: { display: "synthetic.json", source: "default", exists: true }, model: null, language: null,
    profiles: [{ name: FORM.profile, workflowRef: null, provider: null, limits: [], commands: [], verifiers: 0, protectedPaths: [] }],
    workflows: { builtin: [FORM.workflow], config: [] }, keyAvailable: false, providers: [], env: { model: false, language: false },
    rules: { limits: [], commands: [], protectedPaths: [], secretEnv: [] }, policyNarrowings: [], provider: null, defaultProvider: null, apiProviders: [] };
  const api = new Proxy({}, { get: (_target, key) => (...args: unknown[]) => {
    const name = String(key); if (name.startsWith("on")) { events.set(name, args[0] as (value: unknown) => void); return; }
    if (name === "info") return Promise.resolve({ language: "en", engine: "ready", initialWorkspace: initial });
    if (name === "settings") return Promise.resolve({ ok: true, view });
    return Promise.resolve({ ok: false, code: "synthetic_unused" });
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { codaryn: api } });
  t.after(() => { for (const [k, d] of originals) { if (d) Object.defineProperty(doc, k, d); else delete doc[k]; }
    if (win) Object.defineProperty(globalThis, "window", win); else Reflect.deleteProperty(globalThis, "window"); restore(); });
  await import(`../../src/renderer/app.js?rr1=${++boots}`); await tick();
  if (event !== undefined) { events.get("onWorkspaceOpened")!(event); await tick(); }
  const tab = root.findAll(e => e.getAttribute("data-screen") === "newtask")[0]; assert.ok(tab); tab.click(); await tick();
  const selected = (id: string) => root.findAll(e => e.getAttribute("id") === id)[0]?.children.find(e => e.selected)?.getAttribute("value") ?? "";
  return { profile: selected("task-profile"), workflow: selected("task-workflow") };
}

for (const route of ["initial", "second-instance"] as const) test(`RR-1 ${route}: real main payload reaches new-task form`, async t => {
  const app = await main(t);
  // Execute the whole built main module; bind imports to external effects' stand-ins.
  // The real folder parser receives synthetic argv, and all state I/O stays in the temporary root.
  const electron = app.electron;
  const url = new URL("../../src/main/app.js", import.meta.url), actual = createRequire(url), exports: Record<string, unknown> = {};
  const source = readFileSync(url, "utf8");
  const code = source.replace(/^import (.+) from "([^"]+)";$/gm, (_match, binding: string, name: string) =>
    `const ${binding} = load(${JSON.stringify(name)});`)
    .replace("export function startGui", "function startGui") + "\nexports.startGui = startGui;";
  runInNewContext(code, { exports, load: (name: string) => {
    if (name === "electron") return electron;
    if (name === "node:inspector") return { url: () => undefined, close() {} };
    if (name === "./protocol.js") return { registerAppScheme() {}, handleAppProtocol() {} };
    if (name === "./security.js") return { guardContents() {}, secureSession() {} };
    if (name === "./ipc.js") return { registerIpc: app.capture };
    if (name === "./engine-client.js") return { startEngineHost: () => { throw new Error("unexpected host"); } };
    return actual(name);
  }, process: { argv: ["synthetic-electron", "synthetic-app", ...(route === "initial" ? [app.folder] : [])], env: {}, platform: process.platform, cwd: () => app.root }, setTimeout, clearTimeout });
  (exports["startGui"] as (options: unknown) => void)({ guiRoot: app.root, userDataDir: join(app.root, "user-data"), stateFile: app.stateFile });
  await app.loaded.promise; await tick();
  let payload: unknown;
  if (route === "initial") payload = app.deps().initialWorkspace();
  else {
    app.listeners.get("second-instance")!({}, ["synthetic-electron", "synthetic-app", app.folder], app.root);
    await tick(); await tick();
    assert.equal(app.sent.at(-1)?.channel, IPC_EVENTS.workspaceOpened);
    payload = preload().copy(app.sent.at(-1)?.payload);
  }
  t.diagnostic(JSON.stringify({ route, payload }));
  const selected = await selections(t, route === "initial" ? payload : null, route === "second-instance" ? payload : undefined);
  t.diagnostic(JSON.stringify({ route, selected }));
  assert.deepEqual(JSON.parse(JSON.stringify((payload as Workspace).lastForm ?? null)), FORM);
  assert.deepEqual(selected, FORM);
});
