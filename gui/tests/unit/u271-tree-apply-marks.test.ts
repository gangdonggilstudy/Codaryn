/**
 * U-271 (docs/design/standalone-gui.md 3.3): the tree's marks of a chosen run were "created" and
 * "changed" only; "[moved here]" and "[to the discard box]" were not shown, as an apply's actions are not
 * in `changes`. Now an apply of moves that ends in this window marks each file it moved at its new place
 * ("moved here by the apply"; the folders above it say they hold changed files) and says above the tree
 * how many files it sent to the discard box: those left the workspace, so no entry can carry a mark.
 * A moved file opens no comparison (an apply has no changes view).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { ChangeMarks } from "../../src/renderer/workspace/tree-marks.js";
import type { MarkedRun } from "../../src/renderer/workspace/tree-marks.js";
import { TreeView } from "../../src/renderer/workspace/tree-view.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const APPLY = "20261114T050000Z-0000e271";
const HANDLE = "0123456789abcdef0123456789abcdef";

function fakeTreeApi(folders: Record<string, readonly { name: string; kind: "dir" | "file" }[]>): CodarynApi {
  let issued = 0;
  const paths = new Map<string, string>();
  return {
    async tree(_workspace: string, node: string | null) {
      const dir = node === null ? "" : (paths.get(node) ?? "?");
      const entries = (folders[dir] ?? []).map((entry) => {
        issued += 1;
        const id = issued.toString(16).padStart(32, "0");
        paths.set(id, dir === "" ? entry.name : `${dir}/${entry.name}`);
        return { id, name: entry.name, kind: entry.kind, masked: false, protected: false };
      });
      return { ok: true, entries, total: entries.length, offset: 0, nextOffset: null };
    },
  } as unknown as CodarynApi;
}

test("U-271 (3.3): an apply's moved files are marked at their new place; its discards are counted above the tree", async () => {
  const restore = installFakeDom();
  try {
    const api = fakeTreeApi({ "": [{ name: "moved", kind: "dir" }, { name: "b.txt", kind: "file" }], moved: [{ name: "a.txt", kind: "file" }] });
    const opened: [MarkedRun, string][] = [];
    const panel = new FakeElement("aside");
    const tree = new TreeView(textsFor("en"), api, panel as unknown as HTMLElement, { openChange: (run, file) => opened.push([run, file]) });
    const byId = (id: string): FakeElement | undefined => panel.findAll((e) => e.getAttribute("id") === id)[0];
    const row = (name: string): FakeElement | undefined => panel.findAll((e) => e.getAttribute("role") === "treeitem" && (e.children[1]?.textContent ?? "") === name)[0];
    tree.setWorkspace({ handle: HANDLE, name: "ws" });
    await settle();
    const run: MarkedRun = { runId: APPLY, profile: null, workflow: null };
    tree.markApply(run, [
      { kind: "move", to: "moved/a.txt" },
      { kind: "discard", to: null },
      { kind: "discard", to: null },
    ]);
    const note = byId("tree-marks-text")?.textContent ?? "";
    assert.ok(note.startsWith(EN["tree.marksOfApply"].replace("{runId}", APPLY).replace("{count}", "1")), note);
    assert.ok(note.includes(EN["tree.marksDiscarded"].replace("{count}", "2")), "the discards, which have no entry");
    assert.equal(row("moved")?.getAttribute("data-holds-changes"), "true");
    row("moved")?.click();
    await settle();
    assert.equal(row("a.txt")?.getAttribute("data-change"), "moved");
    assert.match(row("a.txt")?.textContent ?? "", /moved here by the apply/);
    assert.equal(row("b.txt")?.hasAttribute("data-change"), false);
    row("a.txt")?.click();
    assert.deepEqual(opened, [], "an apply has no comparison to open");
    // An apply that did nothing clears the marks; a run's marks still say "created or changed".
    tree.markApply(run, []);
    assert.equal(byId("tree-marks")?.hasAttribute("hidden"), true);
    tree.markRun(run, [{ path: "b.txt", created: true }]);
    assert.ok((byId("tree-marks-text")?.textContent ?? "").startsWith(EN["tree.marksOf"].replace("{runId}", APPLY).replace("{count}", "1")));
    row("b.txt")?.click();
    assert.deepEqual(opened, [[run, "b.txt"]], "a run's changed file still opens its comparison");
    // Only discards: the note says so with no file marked.
    tree.markApply(run, [{ kind: "discard", to: null }]);
    assert.equal(byId("tree-marks")?.hasAttribute("hidden"), false);
    assert.ok((byId("tree-marks-text")?.textContent ?? "").includes(EN["tree.marksDiscarded"].replace("{count}", "1")));
  } finally {
    restore();
  }
});

test("U-271 (3.3): a moved mark is kept apart from created and changed; both languages have the words", () => {
  const marks = new ChangeMarks({ runId: APPLY, profile: null, workflow: null }, [{ path: "x/a.txt", created: false, moved: true }, { path: "b.txt", created: true }], 3);
  assert.deepEqual(marks.file("x/a.txt"), { created: false, moved: true, state: null });
  assert.deepEqual(marks.file("b.txt"), { created: true, state: null }, "a run's mark is as before (U-65)");
  assert.equal(marks.discarded, 3);
  assert.equal(marks.holds("x"), true);
  for (const id of ["tree.mark.moved", "tree.marksOfApply", "tree.marksDiscarded"] as const) assert.ok(KO[id] && EN[id], id);
  assert.ok(KO["tree.marksDiscarded"].includes(KO["nav.cleanup"]) && EN["tree.marksDiscarded"].includes(EN["nav.cleanup"]), "names where the discard box is");
});
