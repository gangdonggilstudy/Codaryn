/** Main IPC extraction: registration order, inert factories and live dependency lookup. */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import type { IpcDeps } from "../../src/main/ipc.js";
import { IPC_CHANNELS, createIpc } from "./gsec-ipc-harness.js";

// The harness installs the Electron substitute before these runtime imports.
const { handlers, ipcMain, dialog } = await import("./gsec-electron.js");
const { createWorkspaceHandlers } = await import("../../src/main/ipc-workspace.js");

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
  assert.equal(typeof callbacks.tree, "function");
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
