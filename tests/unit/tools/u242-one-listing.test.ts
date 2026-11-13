/**
 * U-242: search_files' listing under unreadable paths is Workspace.list itself (ListOptions.leaveOut,
 * hidden-entries.ts), no longer U-203's own copy (visible-list.ts). Both implementations as they were
 * on main 24ff76e are frozen below and compared with the one listing on the same trees:
 *
 * - Without unreadable paths: Workspace.list with no options, with empty options and with a leaveOut
 *   that leaves nothing out gives exactly the old Workspace.list's outcome (order, kinds, the limit and
 *   `truncated`, the state directory, links, a start at a file).
 * - With unreadable paths: Workspace.list with the unreadable leaveOut gives exactly the old
 *   listVisible's outcome, the hidden entries left out before they are counted (Codex V-13, V-13b),
 *   links into them, dangling and outside links left out, a link to a readable folder kept.
 * - Errors: a readdir failure in a listed folder is io_error for both, one in a left-out folder is
 *   never met (the folder is not read). A folder swapped for a junction once during the listing makes
 *   both try again and give the same listing of the tree after the swap, nothing read through the
 *   swapped folder; a folder that changes on every try is io_error for both after their tries
 *   (U-189's identity checks, U-213's tries again).
 */

import assert from "node:assert/strict";
import type { Dirent } from "node:fs";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, mock, test } from "node:test";

import { MAX_SEARCH_ENTRIES } from "../../../src/contracts/index.js";
import type { ListEntry, ListOutcome, ResolvedPath, Workspace } from "../../../src/contracts/index.js";
import { compilePathSet } from "../../../src/policy/path-set.js";
import type { PathSetSnapshot } from "../../../src/policy/path-set.js";
import { leaveOutUnreadable } from "../../../src/tools/hidden-entries.js";
import { nodeFileLayer } from "../../../src/workspace/file-layer.js";
import { FolderWatch, retried, retryDeadline, sameChain, walkChain } from "../../../src/workspace/guard.js";
import { isStateDirName } from "../../../src/workspace/lexical.js";
import { createWorkspace } from "../../../src/workspace/index.js";

// ---------------------------------------------------------------------------------------------
// Frozen: Workspace.list's one try as on main 24ff76e (src/workspace/workspace.ts, listOnce).

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
interface Pending extends ListEntry {
  readonly absolute: string;
}

async function oldListOnce(root: string, dir: ResolvedPath): Promise<ListOutcome | "changed"> {
  const files = nodeFileLayer;
  const first = await walkChain(files.lstatId, root, dir.relative);
  if (!first.ok) return first.code === "changed" ? "changed" : { ok: false, code: first.code === "not_found" ? "not_found" : "io_error" };
  if (!first.last.isDirectory()) return { ok: false, code: "not_found" };
  const watch = new FolderWatch(files.lstatId);
  const CHANGED = new Error("changed");
  const pending: Pending[] = [];
  async function expand(absolute: string, relative: string): Promise<void> {
    if (!(await watch.enter(absolute))) throw CHANGED;
    for (const entry of await files.readdir(absolute)) {
      if (relative === "." && isStateDirName(entry.name)) {
        continue;
      }
      pending.push({
        absolute: path.join(absolute, entry.name),
        relative: relative === "." ? entry.name : `${relative}/${entry.name}`,
        kind: entry.isDirectory() ? "dir" : "file",
      });
    }
    pending.sort((a, b) => compareCodeUnits(b.relative, a.relative));
  }
  const entries: ListEntry[] = [];
  let truncated = false;
  try {
    await expand(dir.absolute, dir.relative);
    for (;;) {
      const next = pending.pop();
      if (next === undefined) break;
      if (entries.length >= MAX_SEARCH_ENTRIES) {
        truncated = true;
        break;
      }
      entries.push({ relative: next.relative, kind: next.kind });
      if (next.kind === "dir") {
        await expand(next.absolute, next.relative);
      }
    }
  } catch (error) {
    return error === CHANGED ? "changed" : { ok: false, code: "io_error" };
  }
  const second = await walkChain(files.lstatId, root, dir.relative);
  if (!second.ok || !sameChain(first.seen, second.seen) || !(await watch.unchanged())) return "changed";
  return { ok: true, entries, truncated };
}

async function oldList(root: string, dir: ResolvedPath): Promise<ListOutcome> {
  const outcome = await retried(() => oldListOnce(root, dir), { until: retryDeadline() });
  return outcome === "changed" ? { ok: false, code: "io_error" } : outcome;
}

// ---------------------------------------------------------------------------------------------
// Frozen: listVisible as on main 24ff76e (src/tools/visible-list.ts).

async function oldLeadsToVisible(workspace: Workspace, relative: string, hidden: PathSetSnapshot): Promise<boolean> {
  let resolved: Awaited<ReturnType<Workspace["resolve"]>>;
  try {
    resolved = await workspace.resolve(relative, "read");
  } catch {
    return false;
  }
  return resolved.ok && !hidden.covers(resolved.path.relative);
}

async function oldVisibleOnce(workspace: Workspace, dir: ResolvedPath, hidden: PathSetSnapshot): Promise<ListOutcome | "changed"> {
  const first = await walkChain(nodeFileLayer.lstatId, workspace.root, dir.relative);
  if (!first.ok) return first.code === "changed" ? "changed" : { ok: false, code: first.code === "not_found" ? "not_found" : "io_error" };
  if (!first.last.isDirectory()) return { ok: false, code: "not_found" };
  const watch = new FolderWatch(nodeFileLayer.lstatId);
  const CHANGED = new Error("changed");
  const pending: Pending[] = [];
  async function expand(absolute: string, relative: string): Promise<void> {
    if (!(await watch.enter(absolute))) throw CHANGED;
    const children: Dirent[] = await fsp.readdir(absolute, { withFileTypes: true });
    for (const child of children) {
      if (relative === "." && isStateDirName(child.name)) continue;
      const childRelative = relative === "." ? child.name : `${relative}/${child.name}`;
      if (hidden.covers(childRelative)) continue;
      if (!child.isDirectory() && !child.isFile() && !(await oldLeadsToVisible(workspace, childRelative, hidden))) continue;
      pending.push({ absolute: path.join(absolute, child.name), relative: childRelative, kind: child.isDirectory() ? "dir" : "file" });
    }
    pending.sort((a, b) => compareCodeUnits(b.relative, a.relative));
  }
  const entries: ListEntry[] = [];
  let truncated = false;
  try {
    await expand(dir.absolute, dir.relative);
    for (;;) {
      const next = pending.pop();
      if (next === undefined) break;
      if (entries.length >= MAX_SEARCH_ENTRIES) {
        truncated = true;
        break;
      }
      entries.push({ relative: next.relative, kind: next.kind });
      if (next.kind === "dir") await expand(next.absolute, next.relative);
    }
  } catch (error) {
    return error === CHANGED ? "changed" : { ok: false, code: "io_error" };
  }
  const second = await walkChain(nodeFileLayer.lstatId, workspace.root, dir.relative);
  if (!second.ok || !sameChain(first.seen, second.seen) || !(await watch.unchanged())) return "changed";
  return { ok: true, entries, truncated };
}

async function oldListVisible(workspace: Workspace, dir: ResolvedPath, hidden: PathSetSnapshot): Promise<ListOutcome> {
  const outcome = await retried(() => oldVisibleOnce(workspace, dir, hidden), { until: retryDeadline() });
  return outcome === "changed" ? { ok: false, code: "io_error" } : outcome;
}

// ---------------------------------------------------------------------------------------------

let base: string;
let junctions = true;

function junction(target: string, at: string): void {
  try {
    fs.symlinkSync(target, at, "junction");
  } catch {
    junctions = false;
  }
}

/** A tree with nested folders, the state directory, junctions (inside, dangling, outside) and a folder of more than the limit. */
function makeTree(name: string): string {
  const root = path.join(base, name);
  // zbig sorts last, so the limit is reached after every other entry of the root.
  for (const dir of ["a/b/c", "docs", "private/person", "zbig", ".codaryn/runs", "z"]) fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of ["a/one.txt", "a/b/two.txt", "a/b/c/three.txt", "docs/readme.md", "private/person/record.csv", "z/last.txt", "README.md", "a/한글.txt", ".codaryn/runs/x.json"]) {
    fs.writeFileSync(path.join(root, file), `${file}\n`);
  }
  for (let index = 0; index < MAX_SEARCH_ENTRIES + 7; index += 1) fs.writeFileSync(path.join(root, "zbig", `f${String(index).padStart(4, "0")}.txt`), "x\n");
  for (let index = 0; index < MAX_SEARCH_ENTRIES; index += 1) fs.writeFileSync(path.join(root, "private", `p${index}.csv`), "x\n");
  fs.mkdirSync(path.join(base, `${name}-outside`), { recursive: true });
  junction(path.join(root, "docs"), path.join(root, "docs-alias"));
  junction(path.join(root, "private", "person"), path.join(root, "person-alias"));
  junction(path.join(root, "private", "gone"), path.join(root, "gone-alias"));
  junction(path.join(base, `${name}-outside`), path.join(root, "outside-alias"));
  return root;
}

let root: string;
let workspace: Workspace;
let hidden: PathSetSnapshot;

before(async () => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u242-")));
  root = makeTree("tree");
  workspace = await createWorkspace({ root });
  hidden = await compilePathSet(["private"], { match: "prefix", onUnusable: "covers" }).snapshot(workspace);
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

async function dirOf(ws: Workspace, relative: string): Promise<ResolvedPath> {
  const resolved = await ws.resolve(relative, "read");
  assert.ok(resolved.ok, relative);
  return resolved.ok ? resolved.path : (undefined as never);
}
const text = (value: unknown): string => JSON.stringify(value);

describe("U-242: without unreadable paths, the listing is the old Workspace.list, letter for letter", () => {
  for (const start of [".", "a", "zbig", "docs", "a/one.txt"]) {
    test(`from ${start}`, async () => {
      const dir = await dirOf(workspace, start);
      const old = text(await oldList(root, dir));
      for (const options of [undefined, {}, { leaveOut: () => false }] as const) {
        assert.equal(text(await workspace.list(dir, options)), old, text(options));
      }
    });
  }

  test("the control: the limit is reached from the root", async () => {
    const listed = await workspace.list(await dirOf(workspace, "."));
    assert.ok(listed.ok && listed.truncated && listed.entries.length === MAX_SEARCH_ENTRIES);
  });
});

describe("U-242: with unreadable paths, the listing is the old listVisible, letter for letter", () => {
  for (const start of [".", "a", "zbig", "docs"]) {
    test(`from ${start}`, async (t) => {
      if (!junctions) t.diagnostic("no junctions here: the link cases are not met");
      const dir = await dirOf(workspace, start);
      const now = await workspace.list(dir, { leaveOut: leaveOutUnreadable(workspace, hidden) });
      assert.equal(text(now), text(await oldListVisible(workspace, dir, hidden)));
    });
  }

  test("the control: from the root nothing under private is listed or counted, links into it or nowhere are left out", async (t) => {
    const listed = await workspace.list(await dirOf(workspace, "."), { leaveOut: leaveOutUnreadable(workspace, hidden) });
    assert.ok(listed.ok);
    if (!listed.ok) return;
    const paths = listed.entries.map((entry) => entry.relative);
    assert.equal(paths.some((one) => one === "private" || one.startsWith("private/")), false);
    if (junctions) {
      assert.ok(paths.includes("docs-alias"), "a link to a readable folder stays");
      for (const gone of ["person-alias", "gone-alias", "outside-alias"]) assert.equal(paths.includes(gone), false, gone);
    } else {
      t.diagnostic("no junctions here");
    }
  });
});

/** fs.readdir with `folder` answered by a synthetic EACCES; how many times it was asked for it. */
function failingReaddir(folder: string): { reads: () => number; restore: () => void } {
  const original = fsp.readdir.bind(fsp) as (...args: unknown[]) => Promise<unknown>;
  let reads = 0;
  const same = (a: string): boolean => path.resolve(a).toLowerCase() === path.resolve(folder).toLowerCase();
  const replaced = mock.method(fsp, "readdir", async (...args: unknown[]) => {
    if (typeof args[0] === "string" && same(args[0])) {
      reads += 1;
      throw Object.assign(new Error("synthetic EACCES"), { code: "EACCES" });
    }
    return original(...args);
  });
  return { reads: () => reads, restore: () => replaced.mock.restore() };
}

describe("U-242: the same errors", () => {
  test("a listed folder that cannot be read: io_error for both, with and without unreadable paths", async () => {
    const dir = await dirOf(workspace, "a");
    const failing = failingReaddir(path.join(root, "a", "b"));
    try {
      const expected = text({ ok: false, code: "io_error" });
      assert.equal(text(await oldList(root, dir)), expected);
      assert.equal(text(await workspace.list(dir)), expected);
      assert.equal(text(await oldListVisible(workspace, dir, hidden)), expected);
      assert.equal(text(await workspace.list(dir, { leaveOut: leaveOutUnreadable(workspace, hidden) })), expected);
    } finally {
      failing.restore();
    }
  });

  test("a left-out folder that cannot be read is never read: the same listing as without the failure", async () => {
    const dir = await dirOf(workspace, ".");
    const plain = text(await workspace.list(dir, { leaveOut: leaveOutUnreadable(workspace, hidden) }));
    const failing = failingReaddir(path.join(root, "private"));
    try {
      assert.equal(text(await workspace.list(dir, { leaveOut: leaveOutUnreadable(workspace, hidden) })), plain);
      assert.equal(text(await oldListVisible(workspace, dir, hidden)), plain);
      assert.equal(failing.reads(), 0);
    } finally {
      failing.restore();
    }
  });

  /** A synchronous wait, so a change made inside the old listing's synchronous covers passes the clock tick. */
  const wait = (ms: number): void => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  };

  test("a folder that changes on every try: io_error for both after their tries", async () => {
    const outcomes: string[] = [];
    for (const which of ["old", "new"] as const) {
      const busyRoot = path.join(base, `busy-${which}`);
      for (const dir of ["vis", "private"]) fs.mkdirSync(path.join(busyRoot, dir), { recursive: true });
      fs.writeFileSync(path.join(busyRoot, "vis", "a.txt"), "a\n");
      const ws = await createWorkspace({ root: busyRoot });
      const snapshot = await compilePathSet(["private"], { match: "prefix", onUnusable: "covers" }).snapshot(ws);
      const touch = (relative: string): void => {
        if (relative !== "vis/a.txt") return;
        wait(20);
        const sibling = path.join(busyRoot, "vis", `busy-${process.pid}.tmp`);
        fs.writeFileSync(sibling, "x");
        fs.unlinkSync(sibling);
      };
      const dir = await dirOf(ws, "vis");
      if (which === "old") {
        const watching: PathSetSnapshot = { covers: (relative) => (touch(relative), snapshot.covers(relative)), within: (relative) => snapshot.within(relative) };
        outcomes.push(text(await oldListVisible(ws, dir, watching)));
      } else {
        const leaveOut = leaveOutUnreadable(ws, snapshot);
        outcomes.push(text(await ws.list(dir, { leaveOut: (entry) => (touch(entry.relative), leaveOut(entry)) })));
      }
    }
    assert.deepEqual(outcomes, [text({ ok: false, code: "io_error" }), text({ ok: false, code: "io_error" })]);
  });

  test("a folder swapped for a junction once while it is listed: both try again and list the tree after the swap", async (t) => {
    const outcomes: string[] = [];
    for (const which of ["old", "new"] as const) {
      const swapRoot = path.join(base, `swap-${which}`);
      for (const dir of ["vis/sub", "elsewhere", "private"]) fs.mkdirSync(path.join(swapRoot, dir), { recursive: true });
      fs.writeFileSync(path.join(swapRoot, "vis", "sub", "s.txt"), "s\n");
      fs.writeFileSync(path.join(swapRoot, "vis", "a.txt"), "a\n");
      const ws = await createWorkspace({ root: swapRoot });
      const snapshot = await compilePathSet(["private"], { match: "prefix", onUnusable: "covers" }).snapshot(ws);
      let swapped = false;
      const swap = (relative: string): void => {
        if (swapped || relative !== "vis/sub") return;
        swapped = true;
        fs.renameSync(path.join(swapRoot, "vis", "sub"), path.join(swapRoot, "vis", "sub-old"));
        try {
          fs.symlinkSync(path.join(swapRoot, "elsewhere"), path.join(swapRoot, "vis", "sub"), "junction");
        } catch {
          fs.mkdirSync(path.join(swapRoot, "vis", "sub"));
        }
      };
      const dir = await dirOf(ws, "vis");
      if (which === "old") {
        const watching: PathSetSnapshot = { covers: (relative) => (swap(relative), snapshot.covers(relative)), within: (relative) => snapshot.within(relative) };
        outcomes.push(text(await oldListVisible(ws, dir, watching)));
      } else {
        const leaveOut = leaveOutUnreadable(ws, snapshot);
        outcomes.push(text(await ws.list(dir, { leaveOut: (entry) => (swap(entry.relative), leaveOut(entry)) })));
      }
      if (!junctions) t.diagnostic("no junctions here: the folder is replaced by a new folder instead");
    }
    assert.equal(outcomes[0], outcomes[1]);
    const listed = JSON.parse(outcomes[1] ?? "{}") as { ok: boolean; entries?: { relative: string }[] };
    assert.ok(listed.ok, outcomes[1] ?? "no outcome");
    const paths = (listed.entries ?? []).map((entry) => entry.relative);
    assert.ok(paths.includes("vis/sub-old/s.txt"), "the folder's file under its new name");
    assert.equal(paths.includes("vis/sub/s.txt"), false, "nothing read through the swapped folder");
  });
});
