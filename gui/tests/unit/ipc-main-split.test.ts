/** Main IPC extraction: registration order, inert factories and live dependency lookup. */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import type { IpcDeps } from "../../src/main/ipc.js";
import { IPC_CHANNELS, createIpc } from "./gsec-ipc-harness.js";

// The harness installs the Electron substitute before these runtime imports.
const { handlers, ipcMain, dialog } = await import("./gsec-electron.js");
const { createWorkspaceHandlers } = await import("../../src/main/ipc-workspace.js");
const { createSettingsHandlers } = await import("../../src/main/ipc-settings.js");
const { SettingsProposals } = await import("../../src/main/settings-proposals.js");
const { ModelEntries, ModelListLimit } = await import("../../src/main/model-entries.js");

// The order observed from ipcMain.handle on the pre-extraction pin 0e93670c.
const REGISTRATION_ORDER = [
  IPC_CHANNELS.info, IPC_CHANNELS.openFolder, IPC_CHANNELS.recent, IPC_CHANNELS.openRecent,
  IPC_CHANNELS.forgetRecent, IPC_CHANNELS.tree, IPC_CHANNELS.openText, IPC_CHANNELS.saveText,
  IPC_CHANNELS.textDirty, IPC_CHANNELS.reveal, IPC_CHANNELS.copyText, IPC_CHANNELS.copyPath,
  IPC_CHANNELS.revealConfig, IPC_CHANNELS.saveUi, IPC_CHANNELS.doctor, IPC_CHANNELS.settings,
  IPC_CHANNELS.createSettings, IPC_CHANNELS.settingsSuggestions, IPC_CHANNELS.saveReport,
  IPC_CHANNELS.stateSummary, IPC_CHANNELS.previewCleanup, IPC_CHANNELS.applyCleanup,
  IPC_CHANNELS.proposeSettings, IPC_CHANNELS.applySettings, IPC_CHANNELS.listModels,
  IPC_CHANNELS.selectModel, IPC_CHANNELS.startRun, IPC_CHANNELS.startTaskRun, IPC_CHANNELS.listRuns,
  IPC_CHANNELS.previewRevert, IPC_CHANNELS.revert, IPC_CHANNELS.revertConsent, IPC_CHANNELS.plan,
  IPC_CHANNELS.applyPlan, IPC_CHANNELS.checkPlan, IPC_CHANNELS.runEvents, IPC_CHANNELS.changes,
  IPC_CHANNELS.report, IPC_CHANNELS.review, IPC_CHANNELS.restartEngine, IPC_CHANNELS.cancelRun,
] as const;

test("main IPC split: registration keeps the original 41-channel order", async () => {
  await createIpc();
  assert.deepEqual([...handlers.keys()], REGISTRATION_ORDER);
});

test("main IPC split: factory creation reads no dependencies and opens or registers nothing", t => {
  const reads: PropertyKey[] = [];
  const rejectRead = (_target: object, key: PropertyKey): never => {
    reads.push(key);
    throw new Error(`factory read ${String(key)}`);
  };
  const deps = new Proxy<IpcDeps>({} as IpcDeps, { get: rejectRead });
  const workspaces = new Proxy<IpcDeps["workspaces"]>({} as IpcDeps["workspaces"], { get: rejectRead });
  const register = t.mock.method(ipcMain, "handle", () => { throw new Error("factory registered IPC"); });
  const open = t.mock.method(dialog, "showOpenDialog", async () => { throw new Error("factory opened a dialog"); });
  const callbacks = createWorkspaceHandlers({ deps, workspaces });
  const reset = t.mock.fn(() => { throw new Error("factory reset tokens"); });
  const settings = createSettingsHandlers({ deps, workspaces }, reset);
  assert.equal(typeof callbacks.tree, "function");
  assert.equal(typeof settings.settings, "function");
  assert.equal(reset.mock.callCount(), 0);
  assert.deepEqual(reads, []);
  assert.equal(register.mock.callCount(), 0);
  assert.equal(open.mock.callCount(), 0);
});

test("main IPC split: registered callbacks use replaced deps and the original workspace object", async () => {
  const ipc = await createIpc(), workspace = await ipc.openWorkspace();
  const originalWorkspaces = ipc.deps.workspaces, originalWindow = ipc.deps.window;
  const node = originalWorkspaces.treeIds.issue(workspace.handle, "notes.txt");
  const effects: unknown[] = [];
  let windowCalls = 0;
  Object.assign(ipc.deps, {
    host: async () => { effects.push("new host"); return { failure: "replacement_host" }; },
    window: () => { windowCalls += 1; return originalWindow(); },
    writeClipboard: (text: string) => effects.push(["clipboard", text]),
    showItemInFolder: (file: string) => effects.push(["reveal", file]),
    setTextDirty: (dirty: boolean) => effects.push(["dirty", dirty]),
    saveUi: async (change: unknown) => { effects.push(["ui", change]); },
    workspaces: new Proxy({}, { get: () => { throw new Error("read replaced deps.workspaces"); } }),
  });
  assert.deepEqual(await ipc.call(IPC_CHANNELS.tree, [{ workspace: workspace.handle }]), { ok: false, code: "replacement_host" });
  assert.deepEqual(await ipc.call(IPC_CHANNELS.copyText, [{ text: "20261126T080000Z-00000002" }]), { ok: true });
  assert.deepEqual(await ipc.call(IPC_CHANNELS.copyPath, [{ workspace: workspace.handle, node }]), { ok: true });
  assert.equal(await ipc.call(IPC_CHANNELS.reveal, [{ workspace: workspace.handle, node }]), true);
  assert.equal(await ipc.call(IPC_CHANNELS.textDirty, [{ dirty: true }]), true);
  assert.equal(await ipc.call(IPC_CHANNELS.saveUi, [{ treeWidth: 300 }]), true);
  const recent = await ipc.call(IPC_CHANNELS.recent, []) as Awaited<ReturnType<IpcDeps["workspaces"]["recent"]>>;
  assert.equal(recent.length, 1);
  assert.equal(recent[0]?.name, path.basename(workspace.root));
  assert.equal(recent[0]?.exists, true);
  const beforeOpen = windowCalls;
  assert.equal(await ipc.call(IPC_CHANNELS.openFolder, []), null);
  assert.equal(windowCalls - beforeOpen, 2, "the gate and the callback each use the replacement window getter");
  assert.deepEqual(effects, ["new host", ["clipboard", "20261126T080000Z-00000002"], ["clipboard", "notes.txt"],
    ["reveal", path.join(workspace.root, "notes.txt")], ["dirty", true], ["ui", { treeWidth: 300 }]]);
  assert.deepEqual(ipc.hostCalls, [], "the old host was not used");
  assert.deepEqual(ipc.effects, ["dialog.showOpenDialog"], "the old UI/clipboard dependencies were not used");
});

test("main IPC split: a dependency read after host acquisition stays after the await", { timeout: 5000 }, async () => {
  const ipc = await createIpc(), available = await ipc.deps.host();
  const entered = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<Awaited<ReturnType<IpcDeps["host"]>>>();
  Object.assign(ipc.deps, { host: () => { entered.resolve(); return waiting.promise; } });
  ipc.answer = () => ({ v: 1, id: 0, ok: true, value: { ok: true, path: path.resolve("synthetic-config.json"), exists: true } });
  const pending = ipc.call(IPC_CHANNELS.revealConfig, []);
  await entered.promise;
  const shown: string[] = [];
  Object.assign(ipc.deps, { showItemInFolder: (file: string) => shown.push(file) });
  waiting.resolve(available);
  assert.deepEqual(await pending, { ok: true });
  assert.deepEqual(shown, [path.resolve("synthetic-config.json")]);
  assert.deepEqual(ipc.effects, []);
});

test("main IPC split: all eight settings callbacks use replaced deps and the original workspace", async () => {
  const ipc = await createIpc(), workspace = await ipc.openWorkspace();
  const proposals = new SettingsProposals(size => new Uint8Array(size).fill(2), () => 0);
  const token = proposals.issue({ next: {}, baseDigest: "a".repeat(64), changes: [], widening: [] });
  const entries = new ModelEntries(size => new Uint8Array(size).fill(3));
  const [model] = entries.issue("anthropic", [{ number: 1, id: "synthetic-model", shown: "synthetic-model", name: "Synthetic" }]);
  assert.ok(model);
  let hosts = 0;
  Object.assign(ipc.deps, {
    host: async () => { hosts += 1; return { failure: "replacement_settings" }; },
    settingsProposals: proposals,
    modelEntries: entries,
    workspaces: new Proxy({}, { get: () => { throw new Error("read replaced deps.workspaces"); } }),
  });
  const requests: readonly [string, unknown[]][] = [
    [IPC_CHANNELS.doctor, [{ workspace: workspace.handle }]], [IPC_CHANNELS.settings, []],
    [IPC_CHANNELS.createSettings, [{ workspace: workspace.handle }]],
    [IPC_CHANNELS.settingsSuggestions, [{ workspace: workspace.handle }]],
    [IPC_CHANNELS.proposeSettings, [{ edit: { op: "language", value: "en" } }]],
    [IPC_CHANNELS.applySettings, [{ token }]], [IPC_CHANNELS.listModels, [{ provider: "anthropic" }]],
    [IPC_CHANNELS.selectModel, [{ entry: model.entry }]],
  ];
  for (const [channel, args] of requests) assert.deepEqual(await ipc.call(channel, args), { ok: false, code: "replacement_settings" }, channel);
  assert.equal(hosts, 8);
  assert.equal(proposals.take(token), null, "apply consumed the current store's proposal before host acquisition");
  assert.deepEqual([ipc.hostCalls, ipc.effects, ipc.sent], [[], [], []]);
});

test("main IPC split: settings creation and writes reset root tokens only after the original success conditions", async t => {
  const ipc = await createIpc(), workspace = await ipc.openWorkspace();
  const ids = ipc.deps.workspaces.treeIds, events: string[] = [];
  const clearIds = ids.clear.bind(ids), clearEdits = ipc.deps.textEdits.clear.bind(ipc.deps.textEdits);
  t.mock.method(ids, "clear", () => { events.push("tree clear"); clearIds(); });
  t.mock.method(ipc.deps.textEdits, "clear", () => { events.push("text clear"); clearEdits(); });
  const window = ipc.deps.window;
  let token = "";
  Object.assign(ipc.deps, {
    window: () => { events.push("window"); return window(); },
    confirmWidening: async () => {
      assert.equal(ipc.deps.settingsProposals.take(token), null, "the proposal was consumed before confirmation");
      events.push("confirmation"); return true;
    },
  });
  const cases = [
    { apply: false, value: { ok: true, created: false, model: "placeholder", keySet: false, overridden: false }, ok: true, reset: true },
    { apply: false, value: { ok: true, created: true, model: "placeholder", keySet: false, overridden: false }, ok: true, reset: true },
    { apply: false, value: { ok: false, code: "synthetic_failure" }, ok: false, reset: false },
    { apply: false, value: { ok: true }, ok: false, reset: false },
    { apply: true, value: { ok: true, written: false, changes: [], widening: [] }, ok: true, reset: false },
    { apply: true, value: { ok: true, written: true, changes: [], widening: [] }, ok: true, reset: true },
    { apply: true, value: { ok: false, code: "synthetic_failure" }, ok: false, reset: false },
    { apply: true, value: { ok: true }, ok: false, reset: false },
  ];
  for (const scenario of cases) {
    const node = ids.issue(workspace.handle, "notes.txt");
    events.length = 0; ipc.sent.length = 0;
    ipc.answer = call => { events.push(call); return { v: 1, id: 0, ok: true, value: scenario.value }; };
    token = ipc.deps.settingsProposals.issue({ next: {}, baseDigest: "a".repeat(64), changes: [], widening: [{ kind: "limit_raised", field: "limits.maxModelTurns" }] });
    const channel = scenario.apply ? IPC_CHANNELS.applySettings : IPC_CHANNELS.createSettings;
    const args = scenario.apply ? [{ token }] : [{ workspace: workspace.handle }];
    const reply = await ipc.call(channel, args) as { readonly ok: boolean };
    assert.equal(reply.ok, scenario.ok);
    assert.equal(ids.resolve(workspace.handle, node), scenario.reset ? null : "notes.txt");
    assert.deepEqual(events, ["window", ...(scenario.apply ? ["confirmation", "applySettings"] : ["createSettings"]),
      ...(scenario.reset ? ["tree clear", "text clear", "window"] : [])]);
    assert.deepEqual(ipc.sent.map(event => event.channel), scenario.reset ? ["codaryn:event:treereset"] : []);
  }
});

test("main IPC split: model listing reads current limiter and entries after host await and releases on exception", { timeout: 5000 }, async t => {
  const ipc = await createIpc(), available = await ipc.deps.host();
  const entered = Promise.withResolvers<void>(), waiting = Promise.withResolvers<Awaited<ReturnType<IpcDeps["host"]>>>();
  const events: string[] = [];
  Object.assign(ipc.deps, { host: () => { events.push("host"); entered.resolve(); return waiting.promise; } });
  const pending = ipc.call(IPC_CHANNELS.listModels, [{ provider: "anthropic" }]);
  await entered.promise;
  const limit = new ModelListLimit(() => 0), entries = new ModelEntries(size => new Uint8Array(size).fill(4));
  const [old] = entries.issue("anthropic", [{ number: 1, id: "synthetic-model", shown: "synthetic-model", name: "Synthetic" }]);
  assert.ok(old);
  const begin = limit.begin.bind(limit), end = limit.end.bind(limit), clear = entries.clear.bind(entries);
  t.mock.method(limit, "begin", () => { events.push("begin"); return begin(); });
  t.mock.method(limit, "end", () => { events.push("end"); end(); });
  t.mock.method(entries, "clear", () => { events.push("clear"); clear(); });
  Object.assign(ipc.deps, { modelListLimit: limit, modelEntries: entries });
  ipc.answer = () => { events.push("call"); throw new Error("synthetic model list failure"); };
  const rejected = assert.rejects(pending, /synthetic model list failure/);
  waiting.resolve(available);
  await rejected;
  assert.deepEqual(events, ["host", "begin", "clear", "call", "end"]);
  assert.equal(entries.resolve(old.entry), null);
  assert.equal(begin(), true, "the replacement limiter was released by finally");
  end();
});
