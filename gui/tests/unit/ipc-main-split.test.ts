/** Main IPC extraction: registration order, inert factories and live dependency lookup. */
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { IpcDeps } from "../../src/main/ipc.js";
import type { ModelsReply } from "../../src/shared/ipc.js";
import { IPC_CHANNELS, createIpc } from "./gsec-ipc-harness.js";

// The harness installs the Electron substitute before these runtime imports.
const { handlers, ipcMain, dialog } = await import("./gsec-electron.js");
const { createWorkspaceHandlers } = await import("../../src/main/ipc-workspace.js");
const { createSettingsHandlers } = await import("../../src/main/ipc-settings.js");
const { SettingsProposals } = await import("../../src/main/settings-proposals.js");
const { ModelEntries, ModelListLimit } = await import("../../src/main/model-entries.js");
const { createHistoryHandlers } = await import("../../src/main/ipc-history.js");
const { RunHistory } = await import("../../src/main/history.js");
const { CleanupPreviews } = await import("../../src/main/cleanup-previews.js");
import type { CleanupPlanView } from "../../src/shared/cleanup.js";

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
  const treeEpoch = t.mock.fn((): number => { throw new Error("factory read the tree epoch"); });
  const callbacks = createWorkspaceHandlers({ deps, workspaces }, treeEpoch);
  const reset = t.mock.fn(() => { throw new Error("factory reset tokens"); });
  const settings = createSettingsHandlers({ deps, workspaces }, reset);
  const history = createHistoryHandlers({ deps, workspaces });
  assert.equal(typeof callbacks.tree, "function");
  assert.equal(typeof settings.settings, "function");
  assert.equal(typeof history.previewRevert, "function");
  assert.equal(treeEpoch.mock.callCount(), 0);
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

test("main IPC split: model listing success validates before issuing into the replacement entries", { timeout: 5000 }, async t => {
  const ipc = await createIpc(), available = await ipc.deps.host();
  assert.ok("host" in available);
  const events: string[] = [], called = Promise.withResolvers<void>(), waiting = Promise.withResolvers<void>();
  const limit = new ModelListLimit(() => 0);
  const cleared = new ModelEntries(size => new Uint8Array(size).fill(10));
  const issued = new ModelEntries(size => new Uint8Array(size).fill(11));
  const begin = limit.begin.bind(limit), end = limit.end.bind(limit), clear = cleared.clear.bind(cleared), issue = issued.issue.bind(issued);
  t.mock.method(limit, "begin", () => { events.push("begin"); return begin(); });
  t.mock.method(limit, "end", () => { events.push("end"); end(); });
  t.mock.method(cleared, "clear", () => { events.push("clear"); clear(); });
  t.mock.method(issued, "issue", (provider: string, models: Parameters<IpcDeps["modelEntries"]["issue"]>[1]) => {
    events.push("issue"); return issue(provider, models);
  });
  const value = { ok: true, get provider() { events.push("validate"); return "anthropic"; },
    models: [{ number: 1, id: "synthetic-success", shown: "Synthetic model", name: "Synthetic" }], current: null };
  Object.assign(ipc.deps, { modelListLimit: limit, modelEntries: cleared, host: async () => {
    events.push("host");
    return { host: { ...available.host, call: async () => {
      events.push("call"); called.resolve(); await waiting.promise;
      return { v: 1, id: 0, ok: true, value };
    } } };
  } });
  const pending = ipc.call(IPC_CHANNELS.listModels, [{ provider: "anthropic" }]);
  try {
    await called.promise;
    Object.assign(ipc.deps, { modelEntries: issued });
  } finally {
    waiting.resolve();
  }
  const reply = await pending as ModelsReply;
  assert.ok(reply.ok);
  const [model] = reply.models; assert.ok(model);
  assert.deepEqual(events, ["host", "begin", "clear", "call", "end", "validate", "issue"]);
  assert.deepEqual(issued.resolve(model.entry), { provider: "anthropic", id: "synthetic-success" });
  assert.equal(cleared.resolve(model.entry), null);
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

function cleanupPlan(notReverted: boolean, discarded: boolean, empty = false): CleanupPlanView {
  const run = "20261126T080000Z-00000002";
  return {
    items: empty ? [] : [{ target: "run", id: run, files: 1, bytes: 10, warnings: notReverted ? ["not_reverted"] : [] },
      ...(discarded ? [{ target: "discarded" as const, id: run, files: 2, bytes: 20, warnings: ["people_files"] }] : [])],
    blocked: [], totals: { runs: { count: empty ? 0 : 1, notReverted: notReverted ? 1 : 0, files: 1, bytes: 10 },
      discarded: { count: discarded ? 1 : 0, files: 2, bytes: 20 }, leftovers: { count: 0, files: 0, bytes: 0 } },
    parked: { files: 0, bytes: 0 }, digest: "d".repeat(64),
  };
}

test("main IPC split: all five history callbacks use current dependencies and the captured workspace", async () => {
  const ipc = await createIpc(), workspace = await ipc.openWorkspace(), runId = "20261126T080000Z-00000002";
  const history = new RunHistory(size => new Uint8Array(size).fill(5), () => 0);
  history.listedRuns(workspace.handle, [runId]);
  const previews = new CleanupPreviews(size => new Uint8Array(size).fill(6), () => 0);
  const token = previews.issue({ workspace: workspace.handle, root: workspace.root, selection: {}, now: "2026-11-26T08:00:00.000Z", plan: cleanupPlan(false, false) });
  let hosts = 0;
  Object.assign(ipc.deps, { history, cleanupPreviews: previews, confirmCleanup: async () => true,
    host: async () => { hosts++; return { failure: "replacement_history" }; },
    workspaces: new Proxy({}, { get: () => { throw new Error("read replaced deps.workspaces"); } }),
  });
  const requests: readonly [string, unknown[]][] = [
    [IPC_CHANNELS.stateSummary, [{ workspace: workspace.handle }]],
    [IPC_CHANNELS.previewCleanup, [{ workspace: workspace.handle, selection: {} }]],
    [IPC_CHANNELS.applyCleanup, [{ token }]], [IPC_CHANNELS.listRuns, [{ workspace: workspace.handle }]],
    [IPC_CHANNELS.previewRevert, [{ workspace: workspace.handle, runId }]],
  ];
  for (const [channel, args] of requests) assert.deepEqual(await ipc.call(channel, args), { ok: false, code: "replacement_history" }, channel);
  assert.equal(hosts, 5);
  assert.equal(previews.take(token), null);
  assert.deepEqual([ipc.hostCalls, ipc.effects, ipc.sent], [[], [], []]);
});

test("main IPC split: preview and root revert share history replaced during host acquisition", { timeout: 5000 }, async () => {
  const ipc = await createIpc(), workspace = await ipc.openWorkspace(), runId = "20261126T080000Z-00000002";
  const old = ipc.deps.history, available = await ipc.deps.host();
  const listed = new RunHistory(size => new Uint8Array(size).fill(7), () => 0);
  listed.listedRuns(workspace.handle, [runId]);
  const current = new RunHistory(size => new Uint8Array(size).fill(8), () => 0);
  const entered = Promise.withResolvers<void>(), waiting = Promise.withResolvers<Awaited<ReturnType<IpcDeps["host"]>>>();
  Object.assign(ipc.deps, { history: listed, host: () => { entered.resolve(); return waiting.promise; } });
  ipc.answer = (_call, args) => ({ v: 1, id: 0, ok: true, value: { ok: true, runId, status: "complete",
    dryRun: (args as { dryRun: boolean }).dryRun, reverted: [], skipped: [], moveSafetyUnchecked: false, revertedBefore: null } });
  const pending = ipc.call(IPC_CHANNELS.previewRevert, [{ workspace: workspace.handle, runId }]);
  await entered.promise;
  Object.assign(ipc.deps, { history: current });
  waiting.resolve(available);
  const preview = await pending as { ok: boolean; preview: string };
  assert.equal(preview.ok, true);
  assert.equal(old.takePreview(preview.preview), null);
  assert.equal(listed.takePreview(preview.preview), null);
  let questions = 0;
  Object.assign(ipc.deps, { confirmRevert: async () => {
    questions++; assert.equal(current.takePreview(preview.preview), null, "root consumed the current history token first"); return true;
  } });
  const reverted = await ipc.call(IPC_CHANNELS.revert, [{ preview: preview.preview }]) as { ok: boolean };
  assert.equal(reverted.ok, true); assert.equal(questions, 1);
  assert.deepEqual(ipc.hostCalls.map(row => [row.call, (row.args as { dryRun: boolean }).dryRun]), [["revert", true], ["revert", false]]);
  assert.deepEqual(await ipc.call(IPC_CHANNELS.revert, [{ preview: preview.preview }]), { ok: false, code: "unknown_preview" });
});

test("main IPC split: cleanup consumes before its ordered, conditional questions and host call", async t => {
  const ipc = await createIpc(), workspace = await ipc.openWorkspace(), available = await ipc.deps.host();
  const previews = new CleanupPreviews(size => new Uint8Array(size).fill(9), () => 0), effects: string[] = [];
  const take = previews.take.bind(previews);
  t.mock.method(previews, "take", (token: string) => { effects.push("take"); return take(token); });
  let allowed = true, token = "", expectedNotReverted = false, expectedDiscarded = false;
  Object.assign(ipc.deps, {
    cleanupPreviews: previews,
    confirmCleanup: async () => { effects.push("main question"); assert.equal(take(token), null); return allowed; },
    confirmCleanupNotReverted: async () => { effects.push("not reverted"); return true; },
    confirmCleanupDiscarded: async () => { effects.push("discarded"); return true; },
    host: async () => { effects.push("host"); return available; },
  });
  ipc.answer = (call, args) => {
    effects.push(call);
    assert.deepEqual((args as { confirmation: unknown }).confirmation, { digest: "d".repeat(64), discarded: expectedDiscarded, includeNotReverted: expectedNotReverted });
    return { v: 1, id: 0, ok: false, error: { code: "synthetic_cleanup", message: "synthetic" } };
  };
  for (const scenario of [{ notReverted: true, discarded: true, allowed: true, empty: false },
    { notReverted: true, discarded: false, allowed: true, empty: false },
    { notReverted: false, discarded: true, allowed: true, empty: false },
    { notReverted: false, discarded: false, allowed: true, empty: false },
    { notReverted: true, discarded: true, allowed: false, empty: false },
    { notReverted: false, discarded: false, allowed: true, empty: true }]) {
    effects.length = 0; allowed = scenario.allowed;
    expectedNotReverted = scenario.notReverted; expectedDiscarded = scenario.discarded;
    token = previews.issue({ workspace: workspace.handle, root: workspace.root, selection: {}, now: "2026-11-26T08:00:00.000Z", plan: cleanupPlan(scenario.notReverted, scenario.discarded, scenario.empty) });
    const reply = await ipc.call(IPC_CHANNELS.applyCleanup, [{ token }]);
    assert.deepEqual(reply, { ok: false, code: scenario.empty ? "nothing_to_clean" : allowed ? "synthetic_cleanup" : "not_confirmed" });
    assert.deepEqual(effects, ["take", ...(scenario.empty ? [] : ["main question", ...(allowed ? [
      ...(scenario.notReverted ? ["not reverted"] : []), ...(scenario.discarded ? ["discarded"] : []), "host", "applyCleanup"] : [])])]);
    assert.equal(take(token), null);
  }
});

// BEGIN MAIN IPC SOURCE GUARD
// Tokenizer and literal/computed loader scans copied from ipc-guards.test.ts; kept private here.
interface Token { readonly kind: "word" | "string" | "punct"; readonly value: string; readonly at: number }
interface ModuleReference { readonly specifier: string; readonly at: number; readonly calculated: boolean }
interface SourceFile { readonly file: string; readonly text: string }

/** Read literal escapes without executing source text. */
function decoded(value: string): string {
  return value.replace(/\\(?:u\{([0-9a-f]+)\}|u([0-9a-f]{4})|x([0-9a-f]{2})|(\r?\n)|([\s\S]))/gi, (_all, point: string | undefined, unit: string | undefined, byte: string | undefined, continuation: string | undefined, other: string | undefined) => {
    if (point !== undefined) return String.fromCodePoint(Number.parseInt(point, 16));
    if (unit !== undefined || byte !== undefined) return String.fromCharCode(Number.parseInt(unit ?? byte!, 16));
    if (continuation !== undefined) return "";
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" } as Record<string, string>)[other!] ?? other!;
  });
}

/** Skip comments and regex literals; keep module strings and template interpolations separate. */
function tokens(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const scan = (interpolation = false): void => {
    let braces = 0;
    while (i < source.length) {
      const c = source[i]!;
      if (/\s/.test(c)) { i++; continue; }
      if (source.startsWith("//", i)) { while (i < source.length && source[i] !== "\n") i++; continue; }
      if (source.startsWith("/*", i)) { const end = source.indexOf("*/", i + 2); assert.ok(end >= 0, "unterminated comment"); i = end + 2; continue; }
      if (c === "}" && interpolation && braces === 0) { i++; return; }
      if (c === "{" ) braces++;
      if (c === "}") braces--;
      if (c === "'" || c === '"' || c === "`") {
        const quote = c, at = i++;
        let raw = "";
        while (i < source.length) {
          if (source[i] === "\\") { raw += source.slice(i, i + 2); i += 2; continue; }
          if (source[i] === quote) { i++; break; }
          if (quote === "`" && source.startsWith("${", i)) {
            out.push({ kind: "string", value: decoded(raw), at }); raw = "";
            out.push({ kind: "punct", value: "+", at: i }); i += 2; scan(true);
            out.push({ kind: "punct", value: "+", at: i }); continue;
          }
          raw += source[i++];
        }
        out.push({ kind: "string", value: decoded(raw), at }); continue;
      }
      const previous = out.at(-1)?.value;
      if (c === "/" && (previous === undefined || ["=", "(", "[", ",", ":", "return", "=>", "!", "&&", "||"].includes(previous))) {
        i++; let inClass = false;
        while (i < source.length) {
          const r = source[i++];
          if (r === "\\") { i++; continue; }
          if (r === "[") inClass = true;
          if (r === "]") inClass = false;
          if (r === "/" && !inClass) break;
        }
        while (/[a-z]/i.test(source[i] ?? "")) i++;
        continue;
      }
      if (/[a-z_$]/i.test(c)) {
        const at = i++; while (/[\w$]/.test(source[i] ?? "")) i++;
        out.push({ kind: "word", value: source.slice(at, i), at }); continue;
      }
      out.push({ kind: "punct", value: c, at: i++ });
    }
  };
  scan(); return out;
}

/** Literal import/export/require addresses, including import type and folded literal joins. */
function moduleReferences(source: string): ModuleReference[] {
  const ts = tokens(source), refs: ModuleReference[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]!;
    if (t.kind !== "word" || !["import", "export", "require"].includes(t.value)) continue;
    if (t.value === "import" && ts[i + 1]?.value === ".") continue;
    if (ts[i + 1]?.value === "(" && t.value !== "export") {
      let depth = 0, j = i + 2;
      for (; j < ts.length; j++) { const value = ts[j]!.value; if (value === "(" || value === "[") depth++; if ((value === ")" || value === ",") && depth === 0) break; if (value === ")" || value === "]") depth--; }
      const arg = ts.slice(i + 2, j), literal = arg.length > 0 && arg.every((v, n) => n % 2 === 0 ? v.kind === "string" : v.value === "+");
      const strings = arg.filter(v => v.kind === "string");
      if (literal) refs.push({ specifier: strings.map(s => s.value).join(""), at: t.at, calculated: false });
      else for (const s of strings) refs.push({ specifier: s.value, at: t.at, calculated: true });
      continue;
    }
    if (t.value === "require") continue;
    if (t.value === "import" && ts[i + 1]?.kind === "string") { refs.push({ specifier: ts[i + 1]!.value, at: t.at, calculated: false }); continue; }
    if (t.value === "export" && !["{", "*", "type"].includes(ts[i + 1]?.value ?? "")) continue;
    for (let j = i + 1; j < ts.length && ts[j]!.value !== ";"; j++) {
      if (ts[j]!.value === "from" && ts[j + 1]?.kind === "string") { refs.push({ specifier: ts[j + 1]!.value, at: t.at, calculated: false }); break; }
      if (["import", "export"].includes(ts[j]!.value)) break;
    }
  }
  return refs;
}

type LoaderKind = "import" | "require" | "createRequire";
interface CalculatedLoad { readonly kind: LoaderKind; readonly at: number }

/** Nonliteral calls and loader factory references need review, even without module string fragments. */
function calculatedLoads(source: string): CalculatedLoad[] {
  const ts = tokens(source), loads: CalculatedLoad[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]!;
    const member = ts[i - 1]?.value === "[" && ts[i + 1]?.value === "]" && (ts[i - 2]?.kind === "word" || [")", "]"].includes(ts[i - 2]?.value ?? ""));
    // Factory imports (including aliases), property access and calls are reviewed as a whole.
    if (t.value === "createRequire" && (t.kind === "word" || t.kind === "string" && member)) { loads.push({ kind: "createRequire", at: t.at }); continue; }
    if (t.kind !== "word" || (t.value !== "import" && t.value !== "require")) continue;
    if (ts[i + 1]?.value !== "(") {
      // Taking a require alias or an optional reference must not hide a later computed call.
      if (t.value === "require") loads.push({ kind: "require", at: t.at });
      continue;
    }
    let depth = 0, end = i + 2;
    for (; end < ts.length; end++) {
      const next = ts[end]!;
      if (next.kind !== "punct") continue;
      if ((next.value === ")" || next.value === ",") && depth === 0) break;
      if (["(", "[", "{"].includes(next.value)) depth++;
      if ([")", "]", "}"].includes(next.value)) depth--;
    }
    const argument = ts.slice(i + 2, end);
    if (argument.length !== 1 || argument[0]!.kind !== "string") loads.push({ kind: t.value, at: t.at });
  }
  return loads;
}

const MAIN_DOMAIN_FILE = /^ipc-[^/]+\.ts$/;

function readMainIpcSources(root: string): SourceFile[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), `main source symlink needs review: ${entry.name}`);
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? readMainIpcSources(file) : entry.name.endsWith(".ts") ? [{ file, text: readFileSync(file, "utf8") }] : [];
  });
}

function mainIpcBoundaryViolations(root: string, sources: readonly SourceFile[]): string[] {
  const failures: string[] = [];
  const domains = new Set(sources.map(source => path.relative(root, source.file).replace(/\\/g, "/")).filter(name => MAIN_DOMAIN_FILE.test(name)));
  if (!sources.some(source => path.relative(root, source.file) === "ipc.ts")) failures.push("missing ipc.ts");
  if (domains.size === 0) failures.push("missing ipc-*.ts domains");
  for (const source of sources) {
    const from = path.relative(root, source.file).replace(/\\/g, "/"), ts = tokens(source.text);
    const domain = domains.has(from);
    const fail = (at: number, what: string) => failures.push(`${from}:${source.text.slice(0, at).split("\n").length}: ${what}`);
    if (from !== "ipc.ts") for (let i = 0; i < ts.length; i++) {
      const t = ts[i]!;
      if (t.value === "ipcMain" && (t.kind === "word" || t.kind === "string" && ts[i - 1]?.value === "[" && ts[i + 1]?.value === "]")) fail(t.at, "ipcMain belongs to root");
    }
    if (from === "ipc.ts") {
      const importStatement = ["import", "{", "ipcMain", "}", "from", "electron", ";"];
      const imports = ts.flatMap((t, i) => t.kind === "word" && t.value === "import" && ts[i + 5]?.kind === "string"
        && JSON.stringify(ts.slice(i, i + importStatement.length).map(token => token.value)) === JSON.stringify(importStatement) ? [ts[i + 2]!] : []);
      if (imports.length !== 1) fail(0, "root needs one unaliased ipcMain import from electron");
      const imported = new Set(imports.map(t => t.at));
      const wrappers = ts.flatMap((t, i) => t.kind === "word" && t.value === "const" && ts[i + 1]?.value === "handle" && ts[i + 2]?.value === "=" ? [i] : []);
      const body = wrappers.length === 1 ? ts.findIndex((t, i) => i > wrappers[0]! && t.kind === "punct" && t.value === "{") : -1;
      let bodyEnd = -1, depth = 0;
      if (body >= 0) for (let i = body; i < ts.length; i++) {
        if (ts[i]!.kind !== "punct") continue;
        if (ts[i]!.value === "{") depth++;
        if (ts[i]!.value === "}" && --depth === 0) { bodyEnd = i; break; }
      }
      let registrations = 0;
      for (let i = 0; i < ts.length; i++) {
        const t = ts[i]!;
        if (t.value !== "ipcMain") continue;
        if (t.kind === "string" && ts[i - 1]?.value === "[" && ts[i + 1]?.value === "]") fail(t.at, "ipcMain string member in root");
        if (t.kind !== "word" || imported.has(t.at)) continue;
        if (![".", "[", "?"].includes(ts[i + 1]?.value ?? "")) {
          fail(t.at, "unreviewed ipcMain reference in root");
          continue;
        }
        const allowed = i > body && i < bodyEnd && ts[i - 1]?.value !== "."
          && ts[i + 1]?.value === "." && ts[i + 2]?.value === "handle" && ts[i + 3]?.value === "(";
        if (allowed) registrations++;
        else fail(t.at, "unreviewed ipcMain member");
      }
      if (body < 0 || bodyEnd < 0 || registrations !== 1) fail(0, "root needs one ipcMain.handle wrapper");
    }
    if (!domain) continue;
    for (const load of calculatedLoads(source.text)) fail(load.at, "calculated loader needs review");
    for (const ref of moduleReferences(source.text)) {
      const spec = ref.specifier.replace(/\\/g, "/").split(/[?#]/, 1)[0]!;
      const target = spec.startsWith(".") || path.isAbsolute(spec) ? path.resolve(path.dirname(source.file), spec) : spec.startsWith("file:") ? fileURLToPath(new URL(spec)) : null;
      const to = target === null ? null : path.relative(root, target).replace(/\\/g, "/").replace(/\.(?:[cm]?js|ts)$/, "");
      if (ref.calculated) fail(ref.at, "calculated module address");
      if (to === "ipc") fail(ref.at, "domain imports root");
      if (to !== null && to !== "ipc-context" && domains.has(`${to}.ts`)) fail(ref.at, "domain imports sibling");
      if (spec === "electron") {
        const start = ts.findIndex(t => t.at === ref.at), end = ts.findIndex((t, i) => i >= start && t.value === ";");
        const statement = ts.slice(start, end < 0 ? undefined : end + 1).map(t => t.value);
        const expected = from === "ipc-context.ts" ? ["import", "type", "{", "BrowserWindow", "}", "from", "electron", ";"]
          : from === "ipc-workspace.ts" ? ["import", "{", "dialog", "}", "from", "electron", ";"] : [];
        if (JSON.stringify(statement) !== JSON.stringify(expected)) fail(ref.at, "unreviewed Electron import");
      }
    }
  }
  return failures;
}
// END MAIN IPC SOURCE GUARD

test("main IPC split: source domains keep registration in root and import in one direction", () => {
  const root = fileURLToPath(new URL("../../../src/main/", import.meta.url));
  assert.deepEqual(mainIpcBoundaryViolations(root, readMainIpcSources(root)), []);
});

test("main IPC split: source guard rejects broken copies and ignores quoted or commented examples", () => {
  const root = fileURLToPath(new URL("../../../src/main/", import.meta.url)), sources = readMainIpcSources(root);
  const injected = (suffix: string) => sources.map(source => path.basename(source.file) === "ipc-history.ts" ? { ...source, text: source.text + "\n" + suffix } : source);
  for (const [suffix, why] of [
    ['import { ipcMain as bus } from "electron"; bus.handle("bad", async () => null);', "ipcMain belongs to root"],
    ['import type { IpcDeps } from "./ipc.js";', "domain imports root"],
    ['export type { IpcDeps } from "./ipc.js";', "domain imports root"],
    ['require("./" + "ipc.js");', "domain imports root"],
    [String.raw`import type { IpcDeps } from "./\u0069pc.js";`, "domain imports root"],
    ['await import(address);', "calculated loader needs review"],
    ['const load = require;', "calculated loader needs review"],
    ['import type { X } from "./ipc-settings.js";', "domain imports sibling"],
    ['import * as electron from "electron";', "unreviewed Electron import"],
    ['electron["ipcMain"].handle("bad", async () => null);', "ipcMain belongs to root"],
  ] as const) assert.ok(mainIpcBoundaryViolations(root, injected(suffix)).some(failure => failure.includes(why)), suffix);
  for (const suffix of ['ipcMain.on("bad", () => {});', 'ipcMain.handleOnce("bad", async () => null);',
    'ipcMain["handle"]("bad", async () => null);', 'const alias = ipcMain.handle;', 'ipcMain?.handle("bad", async () => null);']) {
    const broken = sources.map(source => path.basename(source.file) === "ipc.ts" ? { ...source, text: source.text + "\n" + suffix } : source);
    assert.ok(mainIpcBoundaryViolations(root, broken).some(failure => failure.includes("unreviewed ipcMain member")), suffix);
  }
  const extra = { file: path.join(root, "ipc-extra.ts"), text: 'import type { IpcDeps } from "./ipc.js";' };
  assert.ok(mainIpcBoundaryViolations(root, [...sources, extra]).some(failure => failure.includes("ipc-extra.ts") && failure.includes("domain imports root")));
  const sibling = injected('import type { X } from "./ipc-extra.js";');
  assert.ok(mainIpcBoundaryViolations(root, [...sibling, { ...extra, text: "export {};" }]).some(failure => failure.includes("domain imports sibling")));
  assert.deepEqual(mainIpcBoundaryViolations(root, [...sources, { ...extra, text: 'import type { IpcDeps } from "./ipc-context.js";' }]), []);
  const harmless = '// import type { X } from "./ipc.js"; ipcMain.handle("bad", f);\nconst example = "ipcMain"; const pattern = /ipcMain/;';
  assert.deepEqual(mainIpcBoundaryViolations(root, injected(harmless)), []);
});

test("main IPC split: root rejects ipcMain aliases, forwarding and string members outside its wrapper", () => {
  const root = fileURLToPath(new URL("../../../src/main/", import.meta.url)), sources = readMainIpcSources(root);
  const injected = (suffix: string) => sources.map(source => path.basename(source.file) === "ipc.ts" ? { ...source, text: source.text + "\n" + suffix } : source);
  for (const [suffix, why] of [
    ['import { ipcMain as bus } from "electron"; bus.on("bad", f);', "unreviewed ipcMain reference in root"],
    ['const bus = ipcMain; bus.on("bad", f);', "unreviewed ipcMain reference in root"],
    ['const bus = register(ipcMain); bus.on("bad", f);', "unreviewed ipcMain reference in root"],
    ['electron["ipcMain"].on("bad", f);', "ipcMain string member in root"],
  ] as const) assert.ok(mainIpcBoundaryViolations(root, injected(suffix)).some(failure => failure.includes(why)), suffix);
  const rootSource = sources.find(source => path.basename(source.file) === "ipc.ts")!;
  const replaced = (text: string) => sources.map(source => source === rootSource ? { ...source, text } : source);
  assert.ok(mainIpcBoundaryViolations(root, replaced(rootSource.text.replace('import { ipcMain } from "electron";',
    'import { ipcMain as bus } from "electron";'))).some(failure => failure.includes("root needs one unaliased ipcMain import")));
  assert.ok(mainIpcBoundaryViolations(root, replaced(rootSource.text.replace("ipcMain.handle(", "electron.ipcMain.handle(")))
    .some(failure => failure.includes("root needs one ipcMain.handle wrapper")));
  const harmless = '// ipcMain; electron["ipcMain"];\nconst example = "ipcMain"; const pattern = /ipcMain/;';
  assert.deepEqual(mainIpcBoundaryViolations(root, injected(harmless)), []);
});
