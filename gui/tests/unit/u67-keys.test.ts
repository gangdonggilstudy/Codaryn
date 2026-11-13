/**
 * U-67 (docs/design/standalone-gui.md 3.13, 10): the command palette (Ctrl+Shift+P) over a fixed
 * list, the shortcuts Ctrl+N, Ctrl+comma and F5, and the tree's first-letter jump.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { Palette, filterCommands } from "../../src/renderer/shell/palette.js";
import type { Command } from "../../src/renderer/shell/palette.js";
import { Shell } from "../../src/renderer/shell/shell.js";
import { TreeModel } from "../../src/renderer/workspace/tree-model.js";
import { TreeView } from "../../src/renderer/workspace/tree-view.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const key = (name: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; prevented?: boolean } = {}) => {
  const event = {
    key: name,
    ctrlKey: mods.ctrl === true,
    shiftKey: mods.shift === true,
    altKey: mods.alt === true,
    metaKey: false,
    defaultPrevented: mods.prevented === true,
    stopped: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {
      event.stopped = true;
    },
  };
  return event;
};

test("U-67: the palette finds commands whose name holds every word typed, case ignored, in the list's order", () => {
  const command = (id: string, label: string): Command => ({ id, label, keys: null, run: () => undefined });
  const list = [command("runs", "Run list"), command("newtask", "New task"), command("taskfile", "Run a task file"), command("checks", "Environment checks")];
  assert.deepEqual(filterCommands(list, "").map((c) => c.id), ["runs", "newtask", "taskfile", "checks"]);
  assert.deepEqual(filterCommands(list, "run").map((c) => c.id), ["runs", "taskfile"]);
  assert.deepEqual(filterCommands(list, "TASK file").map((c) => c.id), ["taskfile"]);
  assert.deepEqual(filterCommands(list, "  checks  ").map((c) => c.id), ["checks"]);
  assert.deepEqual(filterCommands(list, "nothing"), []);
});

test("U-67: the palette opens with the focus in its field, moves, runs the chosen command after it closed, and gives the focus back", async () => {
  const restore = installFakeDom();
  try {
    const ran: string[] = [];
    let going = false;
    const commands = (): Command[] => [
      { id: "newtask", label: "New task", keys: "Ctrl+N", run: () => ran.push("newtask") },
      { id: "runs", label: "Run list", keys: null, run: () => ran.push("runs") },
      { id: "cancel", label: "Cancel the run", keys: null, available: () => going, run: () => ran.push("cancel") },
    ];
    const palette = new Palette(textsFor("en"), commands);
    const element = palette.element as unknown as FakeElement;
    const before = new FakeElement("button");
    before.focus();
    palette.open();
    const byId = (id: string): FakeElement | undefined => element.findAll((e) => e.getAttribute("id") === id)[0];
    const input = byId("palette-input");
    assert.equal(palette.isOpen, true);
    assert.equal((globalThis as unknown as { document: { activeElement: unknown } }).document.activeElement, input, "the focus is in the field");
    const options = (): FakeElement[] => element.findAll((e) => e.getAttribute("role") === "option");
    assert.deepEqual(options().map((o) => o.getAttribute("data-command")), ["newtask", "runs", "cancel"]);
    assert.equal(options()[2]?.getAttribute("aria-disabled"), "true", "no run going: cancel cannot run");
    assert.equal(input?.getAttribute("aria-activedescendant"), "palette-option-newtask");

    const down = key("ArrowDown");
    element.dispatch("keydown", down);
    assert.equal(down.stopped, true, "the window's shortcuts wait while it is open");
    assert.equal(input?.getAttribute("aria-activedescendant"), "palette-option-runs");
    element.dispatch("keydown", key("ArrowDown"));
    element.dispatch("keydown", key("Enter"));
    assert.deepEqual(ran, [], "a command that cannot run now does not");
    assert.equal(palette.isOpen, true);

    (input as unknown as { value: string }).value = "run list";
    input?.dispatch("input");
    assert.deepEqual(options().map((o) => o.getAttribute("data-command")), ["runs"]);
    element.dispatch("keydown", key("Enter"));
    assert.deepEqual(ran, ["runs"]);
    assert.equal(palette.isOpen, false);
    assert.equal((globalThis as unknown as { document: { activeElement: unknown } }).document.activeElement, before, "the focus goes back");

    palette.open();
    (input as unknown as { value: string }).value = "zzz";
    input?.dispatch("input");
    assert.equal(byId("palette-empty")?.hasAttribute("hidden"), false, "no match says so");
    element.dispatch("keydown", key("Escape"));
    assert.equal(palette.isOpen, false);
    going = true;
    palette.open();
    assert.equal(options()[2]?.hasAttribute("aria-disabled"), false, "a run going: cancel can run");
    options()[2]?.click();
    assert.deepEqual(ran, ["runs", "cancel"]);
    for (const language of ["ko", "en"] as const) {
      const t = textsFor(language);
      for (const id of ["palette.label", "palette.input", "palette.empty", "palette.unavailable", "cmd.newTask", "cmd.taskFile", "cmd.cancel", "cmd.refresh"]) assert.ok(t.has(id), `${language} ${id}`);
    }
  } finally {
    restore();
  }
});

test("U-67: the window's shortcuts: Ctrl+Shift+P, Ctrl+N, Ctrl+comma and F5 (unless a panel already took it)", () => {
  const restore = installFakeDom();
  try {
    const called: string[] = [];
    const shell = new Shell(textsFor("en"), {
      openWorkspace: () => called.push("open"),
      palette: () => called.push("palette"),
      newTask: () => called.push("newtask"),
      settings: () => called.push("settings"),
      refresh: () => called.push("refresh"),
    });
    const onKey = (event: ReturnType<typeof key>): void => (shell as unknown as { onKey(e: unknown): void }).onKey(event);
    onKey(key("P", { ctrl: true, shift: true }));
    onKey(key("n", { ctrl: true }));
    onKey(key(",", { ctrl: true }));
    onKey(key("F5"));
    onKey(key("F5", { prevented: true }));
    onKey(key("F5", { ctrl: true }));
    onKey(key("N", { ctrl: true, shift: true }));
    onKey(key("Escape"));
    assert.deepEqual(called, ["palette", "newtask", "settings", "refresh"]);
  } finally {
    restore();
  }
});

test("U-67: first-letter jump moves to the next shown entry starting with the letter, wrapping, case ignored", async () => {
  const model = new TreeModel();
  const entry = (n: number, name: string, kind: "dir" | "file" = "file") => ({ id: n.toString(16).padStart(32, "0"), name, kind, masked: false });
  model.applyPage(model.root, { entries: [entry(1, "docs", "dir"), entry(2, "Src", "dir"), entry(3, "a.txt"), entry(4, "setup.md")], total: 4, offset: 0, nextOffset: null });
  const keyOf = (name: string): string => model.root.children.find((child) => child.name === name)?.key ?? "";
  assert.equal(model.jump(keyOf("docs"), "s"), keyOf("Src"));
  assert.equal(model.jump(keyOf("Src"), "S"), keyOf("setup.md"));
  assert.equal(model.jump(keyOf("setup.md"), "s"), keyOf("Src"), "wraps around");
  assert.equal(model.jump(keyOf("a.txt"), "z"), null);
  assert.equal(model.jump(null, "a"), keyOf("a.txt"));

  const restore = installFakeDom();
  try {
    const api = {
      async tree() {
        return { ok: true, entries: [entry(1, "docs", "dir"), entry(2, "Src", "dir"), entry(3, "a.txt")], total: 3, offset: 0, nextOffset: null };
      },
    } as unknown as CodarynApi;
    const panel = new FakeElement("aside");
    const tree = new TreeView(textsFor("en"), api, panel as unknown as HTMLElement);
    tree.setWorkspace({ handle: "0".repeat(32), name: "ws" });
    await settle();
    const list = panel.findAll((e) => e.getAttribute("role") === "tree")[0];
    const typed = key("s");
    list?.dispatch("keydown", typed);
    assert.equal(typed.defaultPrevented, true);
    const focused = panel.findAll((e) => e.getAttribute("role") === "treeitem" && e.tabIndex === 0)[0];
    assert.equal(focused?.children[1]?.textContent, "Src");
    const ctrl = key("s", { ctrl: true });
    list?.dispatch("keydown", ctrl);
    assert.equal(ctrl.defaultPrevented, false, "with Ctrl it is not a jump");
  } finally {
    restore();
  }
});
