/**
 * U-70 (docs/design/standalone-gui.md 4.5, 3.1): the window remembers its size and place (used only
 * when enough of it is on a display now), whether it was maximized, the last screen and the file
 * panel's width, in gui-state.json; the separator between the panel and the work area sets the
 * width by the pointer or the keys. Each remembered value that does not fit is dropped on its own.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { EMPTY_WINDOW, parseGuiState, readGuiState, windowOf, writeGuiState } from "../../src/main/gui-state.js";
import { fitBounds } from "../../src/main/window-bounds.js";
import { Workspaces } from "../../src/main/workspaces.js";
import { asInfo } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { Shell, TREE_WIDTH_MAX as SHELL_MAX, TREE_WIDTH_MIN as SHELL_MIN, clampTreeWidth } from "../../src/renderer/shell/shell.js";
import { IPC_CHANNELS, TREE_WIDTH_MAX, TREE_WIDTH_MIN, parseSaveUiArgs } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom } from "./fake-dom.js";

test("U-70: the window's memory is checked part by part; old files without it still read", async () => {
  const good = { bounds: { x: -1200, y: 40, width: 1100, height: 760 }, maximized: true, screen: "runs", treeWidth: 300 };
  assert.deepEqual(windowOf(good), good);
  assert.deepEqual(windowOf({ ...good, bounds: { x: 0, y: 0, width: 50, height: 760 } }).bounds, null, "too small");
  assert.deepEqual(windowOf({ ...good, bounds: { x: 0.5, y: 0, width: 900, height: 700 } }).bounds, null);
  assert.equal(windowOf({ ...good, screen: "Runs!" }).screen, null);
  assert.equal(windowOf({ ...good, treeWidth: 90 }).treeWidth, null);
  assert.equal(windowOf({ ...good, maximized: "yes" }).maximized, false);
  assert.deepEqual(windowOf("x"), EMPTY_WINDOW);
  const old = parseGuiState(JSON.stringify({ schemaVersion: 1, recentWorkspaces: [], workspaceMemory: [] }), "win32");
  assert.equal(old.window, undefined);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gui-u70-"));
  try {
    const file = path.join(dir, "gui-state.json");
    await writeGuiState(file, { recentWorkspaces: [], workspaceMemory: [], window: good });
    assert.deepEqual((await readGuiState(file, "win32")).window, good);
    let n = 0;
    const workspaces = new Workspaces({ stateFile: file, platform: "win32", randomBytes: (size) => Uint8Array.from({ length: size }, () => n++ & 0xff), now: () => new Date(), isDirectory: async () => true });
    await workspaces.rememberWindow({ screen: "checks", treeWidth: 9999 });
    await workspaces.flush();
    const kept = await workspaces.windowMemory();
    assert.equal(kept.screen, "checks");
    assert.equal(kept.treeWidth, null, "a width out of range is dropped");
    assert.deepEqual(kept.bounds, good.bounds, "the rest stays");
    assert.equal(JSON.parse(await fs.readFile(file, "utf8")).window.screen, "checks");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("U-70: the remembered place is used only when enough of it is on a display now; a larger window is made to fit", () => {
  const display = { x: 0, y: 0, width: 1920, height: 1040 };
  const second = { x: 1920, y: 0, width: 1280, height: 1000 };
  assert.deepEqual(fitBounds({ x: 100, y: 50, width: 1100, height: 760 }, [display]), { x: 100, y: 50, width: 1100, height: 760 });
  assert.deepEqual(fitBounds({ x: 2000, y: 50, width: 1100, height: 760 }, [display, second]), { x: 2000, y: 50, width: 1100, height: 760 });
  assert.equal(fitBounds({ x: 2000, y: 50, width: 1100, height: 760 }, [display]), null, "the display it was on is gone");
  assert.equal(fitBounds({ x: 1880, y: 50, width: 1100, height: 760 }, [display]), null, "less than 100 pixels on it");
  assert.deepEqual(fitBounds({ x: 0, y: 0, width: 3000, height: 2000 }, [display]), { x: 0, y: 0, width: 1920, height: 1040 });
  assert.equal(fitBounds(null, [display]), null);
});

test("U-70: the main process takes a screen id and a width in range only; the window reads what it remembered", () => {
  assert.equal(IPC_CHANNELS.saveUi, "codaryn:app:saveui");
  assert.deepEqual(parseSaveUiArgs({ screen: "runs" }), { screen: "runs" });
  assert.deepEqual(parseSaveUiArgs({ treeWidth: 320 }), { treeWidth: 320 });
  assert.deepEqual(parseSaveUiArgs({ screen: "home", treeWidth: 160 }), { screen: "home", treeWidth: 160 });
  for (const bad of [{}, { screen: "C:\\x" }, { screen: "" }, { treeWidth: 159 }, { treeWidth: 801 }, { treeWidth: 300.5 }, { screen: "runs", path: "x" }, null, "runs"]) {
    assert.equal(parseSaveUiArgs(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual([SHELL_MIN, SHELL_MAX], [TREE_WIDTH_MIN, TREE_WIDTH_MAX], "the window and the main process use the same range");
  assert.deepEqual(asInfo({ language: "en", engine: "ready", initialWorkspace: null, ui: { screen: "checks", treeWidth: 400 } }).ui, { screen: "checks", treeWidth: 400 });
  assert.deepEqual(asInfo({ language: "en", engine: "ready", initialWorkspace: null, ui: { screen: "<x>", treeWidth: 2 } }).ui, { screen: null, treeWidth: null });
  assert.deepEqual(asInfo({ language: "en", engine: "ready", initialWorkspace: null }).ui, { screen: null, treeWidth: null });
});

test("U-70: the separator sets the panel's width by keys, within its range, and tells the width and the screen shown", () => {
  const restore = installFakeDom();
  try {
    const widths: number[] = [];
    const screens: string[] = [];
    const shell = new Shell(textsFor("en"), { openWorkspace: () => undefined, treeWidth: (width) => widths.push(width), shown: (id) => screens.push(id) });
    const root = new FakeElement("div");
    shell.mount(root as unknown as HTMLElement);
    const splitter = root.findAll((e) => e.getAttribute("id") === "splitter")[0];
    assert.ok(splitter);
    assert.equal(splitter.getAttribute("role"), "separator");
    assert.equal(splitter.getAttribute("aria-orientation"), "vertical");
    assert.equal(splitter.getAttribute("tabindex"), "0");
    const key = (name: string) => ({ key: name, ctrlKey: false, altKey: false, metaKey: false, preventDefault: () => undefined });
    splitter.dispatch("keydown", key("Home"));
    splitter.dispatch("keydown", key("ArrowRight"));
    splitter.dispatch("keydown", key("ArrowRight"));
    splitter.dispatch("keydown", key("ArrowLeft"));
    splitter.dispatch("keydown", key("End"));
    splitter.dispatch("keydown", key("ArrowRight"));
    splitter.dispatch("keydown", key("x"));
    assert.deepEqual(widths, [160, 176, 192, 176, 800, 800]);
    assert.equal(splitter.getAttribute("aria-valuenow"), "800");
    shell.setTreeWidth(10);
    assert.equal(splitter.getAttribute("aria-valuenow"), "160", "clamped");
    shell.setTreeWidth(null);
    assert.equal(splitter.hasAttribute("aria-valuenow"), false);
    assert.equal(clampTreeWidth(333.6), 334);
    shell.add({ id: "home", title: "nav.home", show: () => undefined });
    shell.show("home");
    assert.deepEqual(screens, ["home"]);
    for (const language of ["ko", "en"] as const) assert.ok(textsFor(language).has("region.splitter"), language);
  } finally {
    restore();
  }
});
