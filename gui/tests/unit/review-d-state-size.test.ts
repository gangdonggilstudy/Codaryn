/** IR-D5/D6: real temporary state files; only file-I/O timing and accounting are replaced. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import * as stateModule from "../../src/main/gui-state.js";
import type { GuiState, WorkspaceMemory } from "../../src/main/gui-state.js";
import { Workspaces } from "../../src/main/workspaces.js";

const L = 262_144, CAP = 3 * L + 1;
const WINDOW = { bounds: { x: -50000, y: -50000, width: 20000, height: 20000 }, maximized: true, screen: "a".repeat(20), treeWidth: 800 };
const textOf = (state: GuiState): string => `${JSON.stringify({ schemaVersion: 1, recentWorkspaces: state.recentWorkspaces, workspaceMemory: state.workspaceMemory, ...(state.window === undefined ? {} : { window: state.window }) }, null, 2)}\n`;
const runId = (n: number): string => `${new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString().slice(0, 19).replaceAll(/[-:]/g, "")}Z-${n.toString(16).padStart(8, "0")}`;
const fit = (state: GuiState): GuiState => {
  const fn = (stateModule as unknown as { fitGuiState?: (state: GuiState) => GuiState }).fitGuiState;
  assert.equal(typeof fn, "function", "the pure size fitter is exported"); return fn!(state);
};
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function largeState(): GuiState {
  const memory: WorkspaceMemory[] = Array.from({ length: 20 }, (_, w) => ({
    path: `C:\\synthetic\\w${w}`, lastForm: { profile: "p".repeat(200), workflow: "w".repeat(200) },
    runs: Array.from({ length: 200 }, (_, r) => ({ runId: runId((199 - r) * 20 + w), profile: "p".repeat(200), workflow: "w".repeat(200) })),
  }));
  return { recentWorkspaces: memory.map(m => ({ path: m.path, openedAt: "2026-01-01T00:00:00.000Z" })), workspaceMemory: memory, window: WINDOW };
}
async function fixture(t: TestContext) {
  const base = await fs.realpath(tmpdir()), root = await fs.realpath(await fs.mkdtemp(path.join(base, "codaryn-state-size-")));
  const inside = path.relative(base, root); assert.ok(inside && !inside.startsWith("..") && !path.isAbsolute(inside));
  t.after(async () => {
    assert.equal(await fs.realpath(root), root);
    assert.equal(path.relative(base, root), inside);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  return { root, file: path.join(root, "memory.json") };
}

test("IR-D5: 20 by 200 valid run memories survive writer/reader and a new Workspaces instance", async t => {
  const f = await fixture(t), state = largeState();
  assert.deepEqual(stateModule.parseGuiState(textOf(state), "win32"), state, "valid bounded entries before file-size policy");
  await stateModule.writeGuiState(f.file, state);
  const raw = await fs.readFile(f.file, "utf8"), read = await stateModule.readGuiState(f.file, "win32");
  t.diagnostic(JSON.stringify({ originalLength: textOf(state).length, writtenLength: raw.length, memories: read.workspaceMemory.length }));
  assert.ok(raw.length <= L, "writer must not produce a file its reader discards");
  assert.equal(read.workspaceMemory.length, 20); assert.ok(read.workspaceMemory.some(m => m.runs.length > 0));
  const restarted = new Workspaces({ stateFile: f.file, platform: "win32", randomBytes, now: () => new Date("2026-01-01T00:00:00Z"), isDirectory: async () => true });
  const opened = await restarted.open(state.workspaceMemory[0]!.path); assert.ok(opened.ok);
  assert.deepEqual(opened.lastForm, state.workspaceMemory[0]!.lastForm);
  assert.ok((await restarted.runForms(opened.handle)).size > 0);
});

test("IR-D5: fitting is pure, idempotent and drops a global oldest prefix while keeping lastForm", () => {
  const input = freeze(largeState()), before = textOf(input), fitted = fit(input);
  assert.notEqual(fitted, input); assert.equal(textOf(input), before); assert.equal(fit(fitted), fitted);
  assert.ok(textOf(fitted).length <= L); assert.equal(fitted.workspaceMemory.length, 20);
  assert.deepEqual(fitted.workspaceMemory.map(m => m.lastForm), input.workspaceMemory.map(m => m.lastForm));
  const all = input.workspaceMemory.flatMap(m => m.runs.map(r => r.runId)).sort();
  const kept = fitted.workspaceMemory.flatMap(m => m.runs.map(r => r.runId)).sort();
  assert.deepEqual(kept, all.slice(all.length - kept.length));
  const lastRemoved = all[all.length - kept.length - 1]!;
  const owner = input.workspaceMemory.find(m => m.runs.some(r => r.runId === lastRemoved))!;
  const restored = { ...fitted, workspaceMemory: fitted.workspaceMemory.map(m => m.path === owner.path ? { ...m, runs: [...m.runs, owner.runs.find(r => r.runId === lastRemoved)!] } : m) };
  assert.ok(textOf(restored).length > L, "do not discard an extra run after the limit fits");
});

for (const surrogate of [false, true]) test(`IR-D5: escaped paths need trimming stage ${surrogate ? 3 : 2}`, () => {
  const paths = Array.from({ length: 20 }, (_, i) => "C:" + (surrogate ? "\\" + "\ud800".repeat(4091) : "\\".repeat(4092)) + String(i).padStart(2, "0"));
  assert.ok(paths.every(p => p.length === 4096));
  const form = { profile: '"'.repeat(200), workflow: "\\".repeat(200) };
  const state: GuiState = { recentWorkspaces: paths.map(p => ({ path: p, openedAt: "2026-01-01T00:00:00.000Z" })), workspaceMemory: paths.map(p => ({ path: p, lastForm: form, runs: [] })), window: WINDOW };
  assert.deepEqual(stateModule.parseGuiState(textOf(state), "win32"), state);
  const fitted = fit(freeze(state)); assert.ok(textOf(fitted).length <= L); assert.equal(fit(fitted), fitted);
  assert.deepEqual(fitted.window, WINDOW);
  if (surrogate) { assert.equal(fitted.workspaceMemory.length, 0); assert.ok(fitted.recentWorkspaces.length < 20); }
  else { assert.ok(fitted.workspaceMemory.length < 20); assert.equal(fitted.recentWorkspaces.length, 20); }
  assert.deepEqual(fitted.workspaceMemory, state.workspaceMemory.slice(0, fitted.workspaceMemory.length));
  assert.deepEqual(fitted.recentWorkspaces, state.recentWorkspaces.slice(0, fitted.recentWorkspaces.length));
});

test("IR-D5: small state keeps its object and exact writer bytes, including lone surrogate escaping", async t => {
  const f = await fixture(t), state: GuiState = { recentWorkspaces: [{ path: "C:\\synthetic", openedAt: "2026-01-01T00:00:00Z" }], workspaceMemory: [{ path: "C:\\synthetic", lastForm: { profile: "\ud800", workflow: "😀" }, runs: [] }], window: WINDOW };
  assert.equal(fit(freeze(state)), state);
  await stateModule.writeGuiState(f.file, state); assert.equal(await fs.readFile(f.file, "utf8"), textOf(state));
  assert.deepEqual(await stateModule.readGuiState(f.file, "win32"), state);
});

test("IR-D5: an invalid unbounded window cannot cause an oversized file", async t => {
  const f = await fixture(t), state: GuiState = { recentWorkspaces: [], workspaceMemory: [], window: { ...WINDOW, screen: "x".repeat(L) } };
  assert.throws(() => fit(state), RangeError);
  await assert.rejects(stateModule.writeGuiState(f.file, state), RangeError);
  await assert.rejects(fs.stat(f.file));
});

test("IR-D5: memory, written file and restart agree after a mutation crosses the size limit", async t => {
  const f = await fixture(t), full = largeState();
  let seed = { ...full, workspaceMemory: full.workspaceMemory.map(m => ({ ...m, runs: [] as typeof m.runs })) };
  outer: for (const m of full.workspaceMemory) for (const run of m.runs) {
    const next = { ...seed, workspaceMemory: seed.workspaceMemory.map(item => item.path === m.path ? { ...item, runs: [...item.runs, run] } : item) };
    if (textOf(next).length > L) break outer; seed = next;
  }
  await fs.writeFile(f.file, textOf(seed));
  const target = seed.workspaceMemory.find(m => m.runs.length > 0 && m.runs.length < 200)!; assert.ok(target);
  const create = () => new Workspaces({ stateFile: f.file, platform: "win32" as const, randomBytes, now: () => new Date("2026-01-01T00:00:00Z"), isDirectory: async () => true });
  const workspaces = create(), opened = await workspaces.open(target.path); assert.ok(opened.ok);
  const form = { profile: "x".repeat(200), workflow: "y".repeat(200) };
  await workspaces.rememberRun(opened.handle, runId(9000), form); await workspaces.flush();
  const disk = await stateModule.readGuiState(f.file, "win32"), diskForms = disk.workspaceMemory.find(m => m.path === target.path)?.runs;
  assert.ok(diskForms && diskForms.length > 0, "oversized writes must not discard all saved state on restart");
  assert.deepEqual([...(await workspaces.runForms(opened.handle))], diskForms.map(r => [r.runId, { profile: r.profile, workflow: r.workflow }]));
  const again = await create().open(target.path); assert.ok(again.ok); assert.deepEqual(again.lastForm, form);
});

for (const growing of [false, true]) test(`IR-D6: ${growing ? "growing" : "large"} file has bounded actual reads on one closed handle`, async t => {
  const f = await fixture(t); await fs.writeFile(f.file, " ".repeat(growing ? 16 : CAP * 2));
  const actualRead = fs.readFile, actualOpen = fs.open;
  let bytes = 0, opens = 0, closes = 0, grown = false;
  const grow = async () => { if (growing && !grown) { grown = true; await fs.appendFile(f.file, " ".repeat(CAP * 2)); } };
  const readMock = t.mock.method(fs, "readFile", async (...args: unknown[]) => {
    if (args[0] === f.file) await grow();
    const value = await Reflect.apply(actualRead, fs, args);
    if (args[0] === f.file) bytes += Buffer.isBuffer(value) ? value.length : Buffer.byteLength(value);
    return value;
  });
  const openMock = t.mock.method(fs, "open", async (...args: unknown[]) => {
    const handle = await Reflect.apply(actualOpen, fs, args);
    if (args[0] === f.file) {
      opens += 1; const read = handle.read.bind(handle), stat = handle.stat.bind(handle), close = handle.close.bind(handle);
      handle.stat = async (...options: unknown[]) => { const value = await Reflect.apply(stat, handle, options); await grow(); return value; };
      handle.read = async (...options: unknown[]) => { const value = await Reflect.apply(read, handle, options) as { bytesRead: number }; bytes += value.bytesRead; return value; };
      handle.close = async () => { closes += 1; await close(); };
    }
    return handle;
  });
  syncBuiltinESMExports(); t.after(() => { readMock.mock.restore(); openMock.mock.restore(); syncBuiltinESMExports(); });
  assert.deepEqual(await stateModule.readGuiState(f.file, "win32"), stateModule.EMPTY_STATE);
  t.diagnostic(JSON.stringify({ growing, bytes, opens, closes, cap: CAP }));
  assert.ok(bytes <= CAP, "observe actual bytes, not merely the returned empty state");
  assert.equal(opens, 1); assert.equal(closes, 1); if (growing) assert.ok(grown);
});

const prefix = '{"schemaVersion":1,"recentWorkspaces":[],"workspaceMemory":[],"padding":"', suffix = '"}';
function padded(unit: string, length = L): Buffer {
  const count = Math.floor((length - prefix.length - suffix.length) / unit.length);
  return Buffer.from(prefix + unit.repeat(count) + " ".repeat(length - prefix.length - suffix.length - count * unit.length) + suffix);
}
const incomplete = (): Buffer => {
  const rest = L - prefix.length - suffix.length - 1;
  return Buffer.concat([Buffer.from(prefix + " ".repeat(rest)), Buffer.from([0xe2, 0x82]), Buffer.from(suffix)]);
};
for (const [name, bytes] of [
  ["ASCII L", padded(" ")], ["ASCII L+1", padded(" ", L + 1)], ["three-byte L", padded("가")],
  ["three-byte L+1", padded("가", L + 1)], ["surrogate pair L", padded("😀")],
  ["escaped lone surrogate", padded("\\ud800")], ["BOM inside L", padded("\ufeff")],
  ["leading BOM", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), padded(" ", L - 1)])],
  ["incomplete UTF-8 L", incomplete()],
] as const) test(`IR-D6: ${name} preserves the previous decoded-length and parsing rules`, async t => {
  const f = await fixture(t); await fs.writeFile(f.file, bytes);
  const decoded = bytes.toString("utf8"), expected = decoded.length > L ? stateModule.EMPTY_STATE : stateModule.parseGuiState(decoded, "win32");
  assert.deepEqual(await stateModule.readGuiState(f.file, "win32"), expected);
  if (!name.includes("L+1") && name !== "leading BOM") assert.notEqual(expected, stateModule.EMPTY_STATE, "accepted boundary fixture");
});
