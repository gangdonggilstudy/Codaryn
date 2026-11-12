/**
 * GU-2: the main process's workspace bookkeeping without Electron: gui-state.json and the recent
 * list, workspace handles, file tree ids, the folder on the command line, and the IPC checks for
 * the new calls.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { folderArgument } from "../../src/main/cli-args.js";
import { EMPTY_STATE, MAX_RECENT, parseGuiState, readGuiState, settingsDir, withOpened, withoutPath, writeGuiState } from "../../src/main/gui-state.js";
import { TreeIds, childPath } from "../../src/main/tree-ids.js";
import { Workspaces, folderName } from "../../src/main/workspaces.js";
import { parseIdArg, parseRevealArgs, parseTreeArgs } from "../../src/shared/ipc.js";

const HANDLE = "0123456789abcdef0123456789abcdef";
let counter = 0;
const random = (size: number): Uint8Array => Uint8Array.from({ length: size }, (_v, i) => (counter++ * 31 + i) & 0xff);

async function tempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gui-ws-"));
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

const isDir = async (p: string): Promise<boolean> => {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
};

test("gui-state: the settings directory follows N-1 on each platform", () => {
  assert.equal(settingsDir("win32", { APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "C:\\Users\\a"), "C:\\Users\\a\\AppData\\Roaming\\Codaryn");
  assert.equal(settingsDir("win32", { AppData: "D:/Roaming" }, null), "D:\\Roaming\\Codaryn", "the name without case");
  assert.equal(settingsDir("win32", { APPDATA: "\\\\server\\share" }, "C:\\Users\\a"), null, "not a drive path");
  assert.equal(settingsDir("win32", { APPDATA: "  " }, "C:\\Users\\a"), null);
  assert.equal(settingsDir("linux", { XDG_CONFIG_HOME: "/home/a/.cfg" }, "/home/a"), "/home/a/.cfg/codaryn");
  assert.equal(settingsDir("linux", { XDG_CONFIG_HOME: "relative" }, "/home/a"), "/home/a/.config/codaryn", "a relative XDG value is ignored");
  assert.equal(settingsDir("darwin", {}, null), null);
});

test("gui-state: parsing keeps valid, absolute, distinct entries and ignores anything else", () => {
  assert.deepEqual(parseGuiState("not json", "win32"), EMPTY_STATE);
  assert.deepEqual(parseGuiState(JSON.stringify({ schemaVersion: 2, recentWorkspaces: [] }), "win32"), EMPTY_STATE);
  const at = "2026-11-12T00:00:00.000Z";
  const state = parseGuiState(
    JSON.stringify({
      schemaVersion: 1,
      recentWorkspaces: [
        { path: "D:\\work\\a", openedAt: at },
        { path: "d:\\WORK\\A", openedAt: at },
        { path: "relative\\b", openedAt: at },
        { path: "D:\\work\\c", openedAt: "yesterday" },
        { path: "D:\\work\\d", openedAt: at, extra: 1 },
        "D:\\work\\e",
      ],
    }),
    "win32",
  );
  assert.deepEqual(state.recentWorkspaces.map((item) => item.path), ["D:\\work\\a", "D:\\work\\d"]);
});

test("gui-state: opening moves a folder to the front once and keeps at most MAX_RECENT", () => {
  let state = EMPTY_STATE;
  const now = new Date("2026-11-12T01:02:03.000Z");
  for (let i = 0; i < MAX_RECENT + 5; i += 1) state = withOpened(state, `C:\\w\\${i}`, now, "win32");
  assert.equal(state.recentWorkspaces.length, MAX_RECENT);
  assert.equal(state.recentWorkspaces[0]?.path, `C:\\w\\${MAX_RECENT + 4}`);
  state = withOpened(state, "c:\\W\\10", now, "win32");
  assert.equal(state.recentWorkspaces[0]?.path, "c:\\W\\10");
  assert.equal(state.recentWorkspaces.filter((item) => item.path.toLowerCase() === "c:\\w\\10").length, 1);
  assert.equal(withoutPath(state, "C:\\w\\10", "win32").recentWorkspaces.some((item) => item.path.toLowerCase() === "c:\\w\\10"), false);
  assert.equal(withOpened(EMPTY_STATE, "/a", now, "linux").recentWorkspaces[0]?.openedAt, now.toISOString());
});

test("gui-state: written through a temporary file, read back, and a broken file reads as empty", async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const file = path.join(dir, "settings", "gui-state.json");
    const state = withOpened(EMPTY_STATE, dir, new Date(), process.platform);
    await writeGuiState(file, state);
    assert.deepEqual(await readGuiState(file, process.platform), state);
    assert.deepEqual((await fs.readdir(path.dirname(file))).sort(), ["gui-state.json"], "no temporary file is left");
    await fs.writeFile(file, "{ broken");
    assert.deepEqual(await readGuiState(file, process.platform), EMPTY_STATE);
    assert.deepEqual(await readGuiState(path.join(dir, "missing.json"), process.platform), EMPTY_STATE);
  } finally {
    await cleanup();
  }
});

test("workspaces: open, recent with fresh ids, open again from the list, forget, and a missing folder", async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const one = path.join(dir, "one");
    const two = path.join(dir, "two");
    await fs.mkdir(one);
    await fs.mkdir(two);
    const stateFile = path.join(dir, "state", "gui-state.json");
    const workspaces = new Workspaces({ stateFile, platform: process.platform, randomBytes: random, now: () => new Date(), isDirectory: isDir });
    const opened = await workspaces.open(one);
    assert.ok(opened.ok);
    assert.equal(opened.ok && opened.name, "one");
    assert.equal(workspaces.path(opened.ok ? opened.handle : ""), one);
    assert.deepEqual(await workspaces.open(path.join(dir, "nothing")), { ok: false, code: "workspace_missing" });
    await workspaces.open(two);

    const recent = await workspaces.recent();
    assert.deepEqual(recent.map((item) => [item.name, item.exists]), [["two", true], ["one", true]]);
    const again = await workspaces.recent();
    assert.deepEqual(await workspaces.openRecent(recent[0]?.id), { ok: false, code: "unknown_recent" }, "ids of an earlier listing stop working");
    const reopened = await workspaces.openRecent(again[1]?.id);
    assert.ok(reopened.ok && reopened.name === "one");
    assert.deepEqual((await workspaces.recent()).map((item) => item.name), ["one", "two"]);

    await fs.rm(two, { recursive: true });
    const listed = await workspaces.recent();
    assert.deepEqual(listed.map((item) => [item.name, item.exists]), [["one", true], ["two", false]]);
    assert.deepEqual(await workspaces.openRecent(listed[1]?.id), { ok: false, code: "workspace_missing" });
    assert.equal(await workspaces.forgetRecent(listed[1]?.id), true);
    assert.equal(await workspaces.forgetRecent("not an id"), false);

    // A new start reads the same list from gui-state.json.
    const later = new Workspaces({ stateFile, platform: process.platform, randomBytes: random, now: () => new Date(), isDirectory: isDir });
    assert.deepEqual((await later.recent()).map((item) => item.name), ["one"]);
    workspaces.clear();
    assert.equal(workspaces.path(reopened.ok ? reopened.handle : ""), null);
  } finally {
    await cleanup();
  }
});

test("workspaces: the tree answer gets ids for plain entries only; real names stay in the main process", () => {
  const workspaces = new Workspaces({ stateFile: null, platform: "win32", randomBytes: random, now: () => new Date(), isDirectory: async () => true });
  const reply = workspaces.treeReply(HANDLE, "sub", {
    ok: true,
    entries: [
      { name: "b.txt", shown: "b.txt", kind: "file", masked: false },
      { name: "deeper", shown: "deeper", kind: "dir", masked: false },
      { name: "link", shown: "link", kind: "link", masked: false },
      { name: "sk-real-name", shown: "[key]", kind: "dir", masked: true },
      { name: "a\u0007b", shown: "", kind: "file", masked: true },
      { name: "cheat", shown: "cheat", kind: "file", masked: true },
    ],
    total: 6,
    offset: 0,
    nextOffset: null,
  });
  assert.ok(reply.ok);
  if (!reply.ok) return;
  assert.deepEqual(
    reply.entries.map((entry) => [entry.name, entry.kind, entry.id !== null]),
    [
      ["b.txt", "file", true],
      ["deeper", "dir", true],
      ["link", "link", false],
      ["[key]", "dir", false],
      ["", "file", false],
      ["", "file", false],
    ],
  );
  assert.doesNotMatch(JSON.stringify(reply), /sk-real-name|\u0007/);
  const deeper = reply.entries[1]?.id ?? "";
  assert.equal(workspaces.treeDir(HANDLE, deeper), "sub/deeper");
  assert.equal(workspaces.treeDir("f".repeat(32), deeper), null, "an id belongs to its workspace");
  assert.equal(workspaces.treeDir(HANDLE, null), "");
  for (const bad of [null, "text", { ok: true, entries: "x", total: 0, offset: 0, nextOffset: null }, { ok: true, entries: [{ name: 1 }], total: 1, offset: 0, nextOffset: null }]) {
    assert.deepEqual(workspaces.treeReply(HANDLE, "", bad), { ok: false, code: "host_error" });
  }
  assert.deepEqual(workspaces.treeReply(HANDLE, "", { ok: false, code: "outside_root" }), { ok: false, code: "outside_root" });
  assert.deepEqual(workspaces.treeReply(HANDLE, "", { ok: false, code: "Bad Code" }), { ok: false, code: "host_error" });
});

test("tree ids: issued per workspace, forgotten with it, bounded", () => {
  const ids = new TreeIds(random);
  const a = ids.issue(HANDLE, "a");
  assert.equal(ids.resolve(HANDLE, a), "a");
  assert.equal(ids.resolve(HANDLE, a.toUpperCase()), null);
  ids.forget(HANDLE);
  assert.equal(ids.resolve(HANDLE, a), null);
  assert.equal(childPath("", "x"), "x");
  assert.equal(childPath("a/b", "x"), "a/b/x");
});

test("command line: the folder argument skips the program, the app path and switches, and resolves against the working directory", () => {
  assert.equal(folderArgument(["C:\\app\\Codaryn.exe", "D:\\work"], true, "C:\\", "win32"), "D:\\work");
  assert.equal(folderArgument(["C:\\app\\Codaryn.exe", "--lang=ko", "notes"], true, "D:\\work", "win32"), "D:\\work\\notes");
  assert.equal(folderArgument(["electron.exe", ".", "D:\\work"], false, "C:\\", "win32"), "D:\\work");
  assert.equal(folderArgument(["electron.exe", "."], false, "C:\\", "win32"), null);
  assert.equal(folderArgument(["Codaryn"], true, "/", "linux"), null);
  assert.equal(folderArgument(["Codaryn", "/home/a/notes"], true, "/", "linux"), "/home/a/notes");
  assert.equal(folderName("D:\\"), "D:\\");
});

test("ipc: the new calls take handles, ids and bounded offsets only", () => {
  assert.deepEqual(parseTreeArgs({ workspace: HANDLE, node: null, offset: 0 }), { workspace: HANDLE, node: null, offset: 0 });
  assert.deepEqual(parseTreeArgs({ workspace: HANDLE }), { workspace: HANDLE, node: null, offset: 0 });
  for (const bad of [
    { workspace: "D:\\work", node: null, offset: 0 },
    { workspace: HANDLE, node: "sub", offset: 0 },
    { workspace: HANDLE, node: null, offset: -1 },
    { workspace: HANDLE, node: null, offset: 1.5 },
    { workspace: HANDLE, node: null, offset: 100_001 },
    { workspace: HANDLE, node: null, offset: 0, dir: "x" },
  ]) {
    assert.equal(parseTreeArgs(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(parseRevealArgs({ workspace: HANDLE, node: HANDLE }), { workspace: HANDLE, node: HANDLE });
  assert.equal(parseRevealArgs({ workspace: HANDLE, node: "C:\\x" }), null);
  assert.equal(parseIdArg([HANDLE]), HANDLE);
  assert.equal(parseIdArg(["D:\\work"]), null);
  assert.equal(parseIdArg([HANDLE, HANDLE]), null);
});
