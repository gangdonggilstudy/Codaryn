/**
 * U-65 (docs/design/standalone-gui.md 3.3): the file tree's marks. The files the marked run created
 * or changed and the folders above them, matched by shown path (a hidden name never matches);
 * entries the effective policy's protected paths cover, as the app layer's list says (U-89; the
 * real list is tried in tree-host.test.ts); choosing a changed file opens its comparison at that
 * file; F5 and the end of a run read the tree again with its open folders kept.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Workspaces } from "../../src/main/workspaces.js";
import { changesScreen } from "../../src/renderer/changes/changes-screen.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { ChangeMarks } from "../../src/renderer/workspace/tree-marks.js";
import type { MarkedRun } from "../../src/renderer/workspace/tree-marks.js";
import { TreeModel, pathOf } from "../../src/renderer/workspace/tree-model.js";
import { TreeView } from "../../src/renderer/workspace/tree-view.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const RUN_ID = "20261113T010203Z-0a1b2c3d";
const HANDLE = "0123456789abcdef0123456789abcdef";

test("U-65: change marks are by shown path; the folders above a changed file hold it; odd paths mark nothing", () => {
  const run: MarkedRun = { runId: RUN_ID, profile: null, workflow: null };
  const marks = new ChangeMarks(run, [
    { path: "src/a.ts", created: false, state: "changed_since_run" },
    { path: "./new.txt", created: true },
    { path: "src/deep/b.ts", created: true, state: "as_run_left" },
    { path: "../outside", created: true },
    { path: "a//b", created: false },
    { path: "", created: false },
  ]);
  assert.equal(marks.size, 3);
  assert.deepEqual(marks.file("src/a.ts"), { created: false, state: "changed_since_run" });
  assert.deepEqual(marks.file("new.txt"), { created: true, state: null });
  assert.equal(marks.file("../outside"), null);
  assert.equal(marks.holds("src"), true);
  assert.equal(marks.holds("src/deep"), true);
  assert.equal(marks.holds("src/a.ts"), false, "a file holds nothing");
  assert.equal(marks.holds("sr"), false, "whole segments only");

  const model = new TreeModel();
  model.applyPage(model.root, {
    entries: [
      { id: "1".repeat(32), name: "src", kind: "dir", masked: false },
      { id: null, name: "[key]", kind: "dir", masked: true },
      { id: "2".repeat(32), name: "a.ts", kind: "file", masked: false, protected: true },
    ],
    total: 3,
    offset: 0,
    nextOffset: null,
  });
  const [src, hidden, top] = model.root.children;
  assert.ok(src && hidden && top);
  model.applyPage(src, { entries: [{ id: "3".repeat(32), name: "a.ts", kind: "file", masked: false }], total: 1, offset: 0, nextOffset: null });
  assert.equal(pathOf(src.children[0] ?? src), "src/a.ts");
  assert.equal(pathOf(hidden), null, "a hidden name is never matched");
  assert.equal(pathOf(model.root), null);
  assert.equal(top.protected, true);
  assert.equal(src.protected, false, "absent: not protected");
});

test("U-65: the main process passes the mark on as true or false and refuses anything else", () => {
  let n = 0;
  const workspaces = new Workspaces({ stateFile: null, platform: "win32", randomBytes: (size) => Uint8Array.from({ length: size }, (_v, i) => (n++ * 31 + i) & 0xff), now: () => new Date(), isDirectory: async () => true });
  const reply = workspaces.treeReply(HANDLE, "", {
    ok: true,
    entries: [
      { name: "tests", shown: "tests", kind: "dir", masked: false, protected: true },
      { name: "src", shown: "src", kind: "dir", masked: false },
    ],
    total: 2,
    offset: 0,
    nextOffset: null,
  });
  assert.ok(reply.ok);
  assert.deepEqual(reply.ok ? reply.entries.map((entry) => entry.protected) : [], [true, false]);
  const bad = workspaces.treeReply(HANDLE, "", { ok: true, entries: [{ name: "a", shown: "a", kind: "file", masked: false, protected: "yes" }], total: 1, offset: 0, nextOffset: null });
  assert.deepEqual(bad, { ok: false, code: "host_error" });
});

/** A main process stand-in for the tree: fresh ids on every listing, as the real one gives. */
function fakeTreeApi(folders: Record<string, readonly { name: string; kind: "dir" | "file"; protected?: boolean }[]>): { api: CodarynApi; calls: () => number } {
  let issued = 0;
  let calls = 0;
  const paths = new Map<string, string>();
  const api = {
    async tree(_workspace: string, node: string | null) {
      calls += 1;
      const dir = node === null ? "" : (paths.get(node) ?? "?");
      const entries = (folders[dir] ?? []).map((entry) => {
        issued += 1;
        const id = issued.toString(16).padStart(32, "0");
        paths.set(id, dir === "" ? entry.name : `${dir}/${entry.name}`);
        return { id, name: entry.name, kind: entry.kind, masked: false, protected: entry.protected === true };
      });
      return { ok: true, entries, total: entries.length, offset: 0, nextOffset: null };
    },
    async reveal() {
      return true;
    },
  } as unknown as CodarynApi;
  return { api, calls: () => calls };
}

test("U-65: the tree shows the marks in words, opens a changed file's comparison, and keeps open folders over F5", async () => {
  const restore = installFakeDom();
  try {
    const { api, calls } = fakeTreeApi({
      "": [
        { name: "src", kind: "dir" },
        { name: "tests", kind: "dir", protected: true },
        { name: "README.md", kind: "file" },
      ],
      src: [
        { name: "a.ts", kind: "file" },
        { name: "new.ts", kind: "file" },
        { name: "same.ts", kind: "file" },
      ],
    });
    const opened: [MarkedRun, string][] = [];
    const panel = new FakeElement("aside");
    const tree = new TreeView(textsFor("en"), api, panel as unknown as HTMLElement, { openChange: (run, file) => opened.push([run, file]) });
    const byId = (id: string): FakeElement | undefined => panel.findAll((e) => e.getAttribute("id") === id)[0];
    const row = (name: string): FakeElement | undefined => panel.findAll((e) => e.getAttribute("role") === "treeitem" && (e.children[1]?.textContent ?? "") === name)[0];
    assert.equal(byId("tree-refresh")?.hasAttribute("disabled"), true, "no workspace, nothing to read");
    tree.setWorkspace({ handle: HANDLE, name: "ws" });
    await settle();
    assert.equal(byId("tree-refresh")?.hasAttribute("disabled"), false);
    assert.equal(row("tests")?.getAttribute("data-protected"), "true");
    assert.match(row("tests")?.textContent ?? "", /\(protected\)/);
    assert.equal(byId("tree-protected-note")?.hasAttribute("hidden"), false, "a protected entry is shown: the note says what the mark covers");
    assert.equal(byId("tree-marks")?.hasAttribute("hidden"), true);

    const run: MarkedRun = { runId: RUN_ID, profile: "fast", workflow: null };
    tree.markRun(run, [
      { path: "src/a.ts", created: false, state: "changed_since_run" },
      { path: "src/new.ts", created: true },
    ]);
    assert.equal(byId("tree-marks")?.hasAttribute("hidden"), false);
    assert.ok(byId("tree-marks-text")?.textContent.includes(RUN_ID));
    assert.match(byId("tree-marks-text")?.textContent ?? "", /2 files/);
    assert.equal(row("src")?.getAttribute("data-holds-changes"), "true");
    assert.match(row("src")?.textContent ?? "", /holds changed files/);
    assert.equal(row("README.md")?.hasAttribute("data-change"), false);

    row("src")?.click();
    await settle();
    assert.equal(row("a.ts")?.getAttribute("data-change"), "changed");
    assert.match(row("a.ts")?.textContent ?? "", /changed by the run, changed again since/);
    assert.equal(row("new.ts")?.getAttribute("data-change"), "created");
    row("same.ts")?.click();
    assert.equal(opened.length, 0, "an unchanged file opens nothing");
    row("a.ts")?.click();
    assert.deepEqual(opened, [[run, "src/a.ts"]]);

    // F5 in the panel: read again; the open folder stays open and the marks stay.
    const before = calls();
    let prevented = false;
    panel.dispatch("keydown", { key: "F5", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, preventDefault: () => (prevented = true) });
    await settle();
    await settle();
    assert.equal(prevented, true);
    assert.equal(calls(), before + 2, "the top level and the open folder");
    assert.equal(row("src")?.getAttribute("aria-expanded"), "true");
    assert.equal(row("new.ts")?.getAttribute("data-change"), "created");
    panel.dispatch("keydown", { key: "F5", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, preventDefault: () => undefined });
    await settle();
    assert.equal(calls(), before + 2, "Ctrl+F5 is not the tree's");

    byId("tree-marks-clear")?.click();
    assert.equal(byId("tree-marks")?.hasAttribute("hidden"), true);
    assert.equal(panel.findAll((e) => e.hasAttribute("data-change")).length, 0);
    tree.markRun(run, [{ path: "src/a.ts", created: false }]);
    assert.equal(tree.markedRun()?.runId, RUN_ID);
    tree.markRun(run, []);
    assert.equal(tree.markedRun(), null, "a run that changed nothing clears the marks");
    tree.markRun(run, [{ path: "src/a.ts", created: false }]);
    tree.setWorkspace({ handle: "f".repeat(32), name: "other" });
    assert.equal(tree.markedRun(), null, "the marks go with the workspace");
    await settle();
  } finally {
    restore();
  }
});

test("U-65: the changes view starts at the file the tree chose, once, and gives its files to the tree", async () => {
  const restore = installFakeDom();
  try {
    const file = (name: string): Record<string, unknown> => ({ path: name, created: false, state: "as_run_left", unavailable: null, before: "a\n", after: "b\n" });
    const api = {
      async changes(_workspace: string, runId: string) {
        return { ok: true, runId, recordsChanged: false, files: [file("a.ts"), file("src/b.ts")] };
      },
    } as unknown as CodarynApi;
    const loaded: [string, string[]][] = [];
    const screen = changesScreen({
      texts: textsFor("en"),
      api,
      current: () => ({ handle: HANDLE, name: "ws" }),
      loaded: (run, files) => loaded.push([run.runId, files.map((f) => f.path)]),
    });
    const root = new FakeElement("main");
    screen.choose(RUN_ID, null, null, "src/b.ts");
    screen.show(root as unknown as HTMLElement);
    await settle();
    const body = root.findAll((e) => e.getAttribute("id") === "changes")[0];
    assert.equal(body?.getAttribute("data-focus-file"), "1");
    const section = root.findAll((e) => e.getAttribute("data-file") === "1")[0];
    assert.equal((globalThis as unknown as { document: { activeElement: unknown } }).document.activeElement, section);
    assert.deepEqual(loaded, [[RUN_ID, ["a.ts", "src/b.ts"]]]);
    screen.show(root as unknown as HTMLElement);
    await settle();
    assert.equal(root.findAll((e) => e.getAttribute("id") === "changes")[0]?.hasAttribute("data-focus-file"), false, "shown again: from the top");
  } finally {
    restore();
  }
});
