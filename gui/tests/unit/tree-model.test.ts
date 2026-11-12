/** GU-2: the read-only file tree's model (src/renderer/workspace/tree-model.ts), without a DOM. */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { TreeEntryView } from "../../src/shared/ipc.js";
import { TreeModel } from "../../src/renderer/workspace/tree-model.js";
import type { TreeNode } from "../../src/renderer/workspace/tree-model.js";

const id = (n: number): string => n.toString(16).padStart(32, "0");
const dir = (n: number, name: string): TreeEntryView => ({ id: id(n), name, kind: "dir", masked: false });
const file = (n: number, name: string): TreeEntryView => ({ id: id(n), name, kind: "file", masked: false });

function loaded(): { model: TreeModel; sub: TreeNode } {
  const model = new TreeModel();
  const action = model.beginLoad(model.root, 0);
  assert.equal(action?.offset, 0);
  model.applyPage(model.root, {
    entries: [dir(1, "sub"), { id: null, name: ".codaryn", kind: "state", masked: false }, file(2, "a.txt"), { id: null, name: "", kind: "file", masked: true }],
    total: 4,
    offset: 0,
    nextOffset: null,
  });
  return { model, sub: model.find(id(1)) as TreeNode };
}

const keys = (model: TreeModel): string[] => model.rows().map((row) => (row.type === "node" ? row.node.name || "(masked)" : `${row.type}`));

test("tree model: the root shows a loading row, then its entries with positions", () => {
  const model = new TreeModel();
  model.beginLoad(model.root, 0);
  assert.deepEqual(model.rows().map((row) => row.type), ["status"]);
  const { model: full } = loaded();
  const rows = full.rows();
  assert.deepEqual(keys(full), ["sub", ".codaryn", "a.txt", "(masked)"]);
  const first = rows[0];
  assert.ok(first !== undefined && first.type === "node");
  assert.equal(first.position, 1);
  assert.equal(first.setSize, 4);
});

test("tree model: Right opens a folder and asks for its first page; children show one level deeper", () => {
  const { model, sub } = loaded();
  const step = model.navigate(sub.key, "ArrowRight");
  assert.deepEqual(step?.action !== null && step?.action !== undefined ? [step.action.node.name, step.action.offset] : null, ["sub", 0]);
  assert.equal(sub.expanded, true);
  assert.deepEqual(keys(model), ["sub", "status", ".codaryn", "a.txt", "(masked)"], "a loading row under the folder");
  model.applyPage(sub, { entries: [file(3, "b.txt")], total: 1, offset: 0, nextOffset: null });
  assert.deepEqual(keys(model), ["sub", "b.txt", ".codaryn", "a.txt", "(masked)"]);
  const child = model.find(id(3));
  assert.equal(child?.depth, 1);
  assert.deepEqual(model.navigate(sub.key, "ArrowRight"), { focus: id(3), action: null }, "Right on an open folder moves into it");
  assert.deepEqual(model.navigate(id(3), "ArrowLeft"), { focus: sub.key, action: null }, "Left on a child moves to its parent");
  assert.deepEqual(model.navigate(sub.key, "ArrowLeft"), { focus: sub.key, action: null });
  assert.equal(sub.expanded, false, "Left on an open folder closes it");
  assert.equal(model.navigate(sub.key, "ArrowRight")?.action, null, "a loaded folder is not fetched again");
});

test("tree model: Up, Down, Home and End move between rows; entries that cannot open stay closed", () => {
  const { model, sub } = loaded();
  const masked = model.root.children[3] as TreeNode;
  const state = model.root.children[1] as TreeNode;
  assert.equal(model.navigate(sub.key, "ArrowDown")?.focus, state.key);
  assert.equal(model.navigate(sub.key, "End")?.focus, masked.key);
  assert.equal(model.navigate(masked.key, "Home")?.focus, sub.key);
  assert.equal(model.navigate(sub.key, "ArrowUp")?.focus, sub.key, "the first row stays");
  assert.deepEqual(model.navigate(state.key, "Enter"), { focus: state.key, action: null });
  assert.equal(state.expanded, false);
  assert.deepEqual(model.navigate(masked.key, "ArrowRight"), { focus: masked.key, action: null });
  assert.equal(model.navigate(sub.key, "x"), null, "other keys are left to the page");
});

test("tree model: pages append, a 'more' row loads the next one, and a stale page is ignored", () => {
  const model = new TreeModel();
  model.beginLoad(model.root, 0);
  model.applyPage(model.root, { entries: [file(1, "a"), file(2, "b")], total: 3, offset: 0, nextOffset: 2 });
  const more = model.rows().at(-1);
  assert.ok(more !== undefined && more.type === "more");
  assert.equal(more.remaining, 1);
  const step = model.navigate(more.key, "Enter");
  assert.equal(step?.action?.offset, 2);
  model.applyPage(model.root, { entries: [file(9, "late")], total: 3, offset: 0, nextOffset: 1 });
  assert.equal(model.root.children.length, 2, "a page for an earlier offset is dropped");
  model.applyPage(model.root, { entries: [file(3, "c")], total: 3, offset: 2, nextOffset: null });
  assert.deepEqual(keys(model), ["a", "b", "c"]);
});

test("tree model: an error and an empty folder are status rows that keys skip", () => {
  const { model, sub } = loaded();
  model.expand(sub);
  model.applyError(sub, "io_error");
  const rows = model.rows();
  assert.ok(rows.some((row) => row.type === "status" && row.status === "error" && row.code === "io_error"));
  assert.equal(model.navigate(sub.key, "ArrowDown")?.focus, (model.root.children[1] as TreeNode).key, "the status row is skipped");
  const other = new TreeModel();
  other.beginLoad(other.root, 0);
  other.applyPage(other.root, { entries: [dir(5, "empty")], total: 1, offset: 0, nextOffset: null });
  const empty = other.find(id(5)) as TreeNode;
  other.expand(empty);
  other.applyPage(empty, { entries: [], total: 0, offset: 0, nextOffset: null });
  assert.ok(other.rows().some((row) => row.type === "status" && row.status === "empty"));
});
