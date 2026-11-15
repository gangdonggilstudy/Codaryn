/**
 * GT-U09: the apply run's inventory (VF-05, DR-6) on real files, and with an injected file system
 * where a failure must be produced.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { INVENTORY_VERIFIER_ID, MAX_INVENTORY_FILES, MAX_INTEGRITY_FILES, asRawText } from "../../../src/contracts/index.js";
import type { AppliedPlanAction, ContentHash, InventoryManifest } from "../../../src/contracts/index.js";
import { createInventoryChecker } from "../../../src/verify/index.js";
import { INVENTORY_LIMITS, MAX_LISTED_PATHS, buildInventoryChecker, nodeInventoryFileSystem } from "../../../src/verify/inventory.js";

const roots: string[] = [];

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codaryn-gd-inv-"));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) {
    await mkdir(join(root, name, ".."), { recursive: true });
    await writeFile(join(root, name), text, "utf8");
  }
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const sha = (text: string): ContentHash => createHash("sha256").update(text, "utf8").digest("hex");

function listing(manifest: InventoryManifest): string[] {
  return manifest.entries.map((entry) => (entry.kind === "unchecked" ? `${entry.path} unchecked` : `${entry.path} ${entry.kind} ${entry.size}`));
}

const move = (index: number, from: string, to: string, text: string): AppliedPlanAction => ({ index, action: { kind: "move", from, to, sha256: sha(text) }, stored: null });
const discard = (index: number, path: string, text: string, stored = `${index}`): AppliedPlanAction => ({ index, action: { kind: "discard", path, sha256: sha(text) }, stored });

/** Applies the actions on disk as the apply run would: renames inside the root and into the store. */
async function applyOnDisk(root: string, store: string, actions: readonly AppliedPlanAction[]): Promise<void> {
  await mkdir(store, { recursive: true });
  for (const { action, stored } of actions) {
    if (action.kind === "move") {
      await mkdir(join(root, action.to, ".."), { recursive: true });
      await rename(join(root, action.from), join(root, action.to));
    } else {
      await rename(join(root, action.path), join(store, stored as string));
    }
  }
}

const FILES = {
  "a.txt": "alpha",
  "b.txt": "bravo!",
  "docs/c.md": "charlie",
  "photos/d.jpg": "\u00ff\u00d8binary",
  ".codaryn/runs/x/journal.jsonl": "{}\n",
};

test("capture lists files and links with sizes, leaves out the state directory and follows no link", async () => {
  const root = await workspace(FILES);
  await mkdir(join(root, "empty-dir"));
  const outside = await mkdtemp(join(tmpdir(), "codaryn-gd-out-"));
  roots.push(outside);
  await writeFile(join(outside, "secret.txt"), "not listed", "utf8");
  await symlink(outside, join(root, "linked"), "junction");

  const manifest = await createInventoryChecker({ workspaceRoot: root }).capture();
  assert.equal(manifest.limitReached, false);
  const lines = listing(manifest);
  assert.deepEqual(
    lines.filter((line) => !line.startsWith("linked")),
    ["a.txt file 5", "b.txt file 6", "docs/c.md file 7", `photos/d.jpg file ${Buffer.byteLength(FILES["photos/d.jpg"], "utf8")}`],
  );
  const link = manifest.entries.find((entry) => entry.path === "linked");
  assert.equal(link?.kind, "link");
  assert.ok(lines.every((line) => !line.includes("secret.txt") && !line.includes(".codaryn")));
  assert.deepEqual(
    manifest.entries.map((entry) => entry.path),
    [...manifest.entries.map((entry) => entry.path)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
});

test("more files than the integrity limit are still listed (R-1 M-5 input)", async () => {
  const root = await workspace({});
  const count = MAX_INTEGRITY_FILES + 1;
  await mkdir(join(root, "many"));
  for (let start = 0; start < count; start += 500) {
    await Promise.all(
      Array.from({ length: Math.min(500, count - start) }, (_v, offset) =>
        writeFile(join(root, "many", `f${String(start + offset).padStart(5, "0")}.jpg`), "x"),
      ),
    );
  }
  const manifest = await createInventoryChecker({ workspaceRoot: root }).capture();
  assert.equal(manifest.limitReached, false);
  assert.equal(manifest.entries.length, count);
  assert.ok(manifest.entries.every((entry) => entry.kind === "file"));
  assert.ok(MAX_INVENTORY_FILES > count);
});

test("the inventory's own limit stops the listing and marks it", async () => {
  const root = await workspace(FILES);
  const checker = buildInventoryChecker({ workspaceRoot: root }, { maxFiles: 3 });
  const manifest = await checker.capture();
  assert.equal(manifest.limitReached, true);
  assert.equal(manifest.entries.length, 3);
  const exact = await buildInventoryChecker({ workspaceRoot: root }, { maxFiles: 4 }).capture();
  assert.equal(exact.limitReached, false);
  assert.equal(exact.entries.length, 4);
});

test("a path that cannot be listed or measured is unchecked", async () => {
  const root = await workspace(FILES);
  const checker = buildInventoryChecker({ workspaceRoot: root }, { maxFiles: 100 }, {
    ...nodeInventoryFileSystem,
    async readdir(dir) {
      if (dir.endsWith("docs")) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return nodeInventoryFileSystem.readdir(dir);
    },
    async lstat(target) {
      if (target.endsWith("b.txt")) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      return nodeInventoryFileSystem.lstat(target);
    },
  });
  const lines = listing(await checker.capture());
  assert.ok(lines.includes("docs unchecked"), lines.join("\n"));
  assert.ok(lines.includes("b.txt unchecked"), lines.join("\n"));
});

async function applied(files: Record<string, string>, actions: AppliedPlanAction[], change?: (root: string, store: string) => Promise<void>) {
  const root = await workspace(files);
  const store = join(root, ".codaryn", "discarded", "apply-1");
  const checker = createInventoryChecker({ workspaceRoot: root });
  const before = await checker.capture();
  await applyOnDisk(root, store, actions);
  if (change !== undefined) await change(root, store);
  const after = await checker.capture();
  return { root, store, result: await checker.check({ before, after, applied: actions, discardedRoot: store }) };
}

test("pass: the planned moves and discards and nothing else", async () => {
  const actions = [move(0, "a.txt", "sorted/text/a.txt", "alpha"), discard(1, "b.txt", "bravo!"), move(2, "photos/d.jpg", "sorted/d.jpg", FILES["photos/d.jpg"])];
  const { result } = await applied(FILES, actions);
  assert.equal(result.outcome, "pass", result.evidence);
  assert.equal(result.id, INVENTORY_VERIFIER_ID);
  assert.equal(result.kind, "inventory");
  assert.deepEqual(result.limits, INVENTORY_LIMITS);
  assert.match(result.evidence, /3 of 3 plan targets have the plan's SHA-256/);
});

test("fail: a file outside the plan added, removed or resized", async () => {
  const actions = [move(0, "a.txt", "sorted/a.txt", "alpha")];
  const cases: [string, (root: string) => Promise<void>, RegExp][] = [
    ["added", (root) => writeFile(join(root, "new.txt"), "n"), /added \(1\):\n {2}new\.txt/],
    ["removed", (root) => rm(join(root, "docs", "c.md")), /missing \(1\):\n {2}docs\/c\.md/],
    ["resized", (root) => writeFile(join(root, "docs", "c.md"), "charlie+"), /changed \(1\):\n {2}docs\/c\.md \(file 7 bytes, now file 8 bytes\)/],
  ];
  for (const [name, change, pattern] of cases) {
    const { result } = await applied(FILES, actions, change);
    assert.equal(result.outcome, "fail", name);
    assert.match(result.evidence, pattern, name);
  }
});

test("fail: a plan target whose content is not the plan's, or a discarded file not in the store", async () => {
  const moved = await applied(FILES, [move(0, "a.txt", "sorted/a.txt", "alpha")], (root) => writeFile(join(root, "sorted", "a.txt"), "ALPHA"));
  assert.equal(moved.result.outcome, "fail");
  assert.match(moved.result.evidence, /plan targets that differ \(1\):\n {2}sorted\/a\.txt: SHA-256 differs from the plan/);

  const gone = await applied(FILES, [discard(0, "b.txt", "bravo!")], (_root, store) => rm(join(store, "0")));
  assert.equal(gone.result.outcome, "fail");
  assert.match(gone.result.evidence, /b\.txt \(discarded\): not found/);

  // The plan named another content than the file had: the apply moved a different file.
  const planned = await applied(FILES, [{ ...move(0, "a.txt", "sorted/a.txt", "alpha"), action: { kind: "move", from: "a.txt", to: "sorted/a.txt", sha256: sha("other") } }]);
  assert.equal(planned.result.outcome, "fail");
});

test("fail: an action whose source was not a file before", async () => {
  const root = await workspace(FILES);
  const checker = createInventoryChecker({ workspaceRoot: root });
  const manifest = await checker.capture();
  const result = await checker.check({ before: manifest, after: manifest, applied: [move(0, "nope.txt", "x.txt", "")], discardedRoot: join(root, ".codaryn", "discarded", "r") });
  assert.equal(result.outcome, "fail");
  assert.match(result.evidence, /action 0: the source nope\.txt was not a file before the apply/);
});

test("inconclusive: a listing that reached its limit, an unchecked path, a target that cannot be read safely", async () => {
  const root = await workspace(FILES);
  const checker = createInventoryChecker({ workspaceRoot: root });
  const manifest = await checker.capture();
  const store = join(root, ".codaryn", "discarded", "r");

  const limited = await checker.check({ before: { ...manifest, limitReached: true }, after: manifest, applied: [], discardedRoot: store });
  assert.equal(limited.outcome, "inconclusive");
  assert.match(limited.evidence, /stopped at 100000 entries/);

  const withUnchecked: InventoryManifest = { ...manifest, entries: [...manifest.entries, { path: asRawText("zz-locked.bin"), kind: "unchecked" }] };
  const unchecked = await checker.check({ before: manifest, after: withUnchecked, applied: [], discardedRoot: store });
  assert.equal(unchecked.outcome, "inconclusive");
  assert.match(unchecked.evidence, /could not list or measure zz-locked\.bin/);

  // A stored place that would leave the store is refused before anything is read.
  const reads: string[] = [];
  const watched = buildInventoryChecker({ workspaceRoot: root }, { maxFiles: 100 }, {
    ...nodeInventoryFileSystem,
    async lstat(target) {
      reads.push(target);
      return nodeInventoryFileSystem.lstat(target);
    },
    async hashFile(file) {
      reads.push(file);
      return nodeInventoryFileSystem.hashFile(file);
    },
  });
  for (const stored of ["../../a.txt", "/etc/passwd", "C:/Windows/win.ini", "a\\b", "", "./0", "x/../../a.txt"]) {
    const after = { ...manifest, entries: manifest.entries.filter((entry) => entry.path !== "b.txt") };
    const result = await watched.check({ before: manifest, after, applied: [discard(0, "b.txt", "bravo!", stored)], discardedRoot: store });
    assert.equal(result.outcome, "inconclusive", stored);
    assert.match(result.evidence, /b\.txt \(discarded\): could not be read as a regular file/, stored);
  }
  assert.deepEqual(reads, []);
});

test("a known limit: a same-size content change outside the plan is not detected", async () => {
  const { result } = await applied(FILES, [move(0, "a.txt", "sorted/a.txt", "alpha")], (root) => writeFile(join(root, "docs", "c.md"), "CHARLIE"));
  assert.equal(result.outcome, "pass");
  assert.ok(result.limits.some((limit) => limit.includes("same size") || limit.includes("kept its size")));
  assert.equal(await readFile(join(roots[roots.length - 1] as string, "docs", "c.md"), "utf8"), "CHARLIE");
});

test("Windows compares paths without case; other systems with case", async () => {
  const root = await workspace({ "A.TXT": "alpha" });
  const entries = (path: string) => ({ entries: [{ path: asRawText(path), kind: "file" as const, size: 5 }], limitReached: false });
  const actions = [move(0, "a.txt", "Sorted/A.txt", "alpha")];
  await mkdir(join(root, "Sorted"));
  await rename(join(root, "A.TXT"), join(root, "Sorted", "A.txt"));
  const windows = buildInventoryChecker({ workspaceRoot: root, platform: "win32" });
  const result = await windows.check({ before: entries("A.TXT"), after: entries("sorted/a.txt"), applied: actions, discardedRoot: join(root, "store") });
  assert.equal(result.outcome, "pass", result.evidence);
  const posix = buildInventoryChecker({ workspaceRoot: root, platform: "linux" });
  assert.equal((await posix.check({ before: entries("A.TXT"), after: entries("sorted/a.txt"), applied: actions, discardedRoot: join(root, "store") })).outcome, "fail");
});

test("evidence lists at most MAX_LISTED_PATHS paths per difference and counts the rest", async () => {
  const files: Record<string, string> = { "keep.txt": "k" };
  const { result } = await applied(files, [], async (root) => {
    for (let index = 0; index < MAX_LISTED_PATHS + 5; index += 1) await writeFile(join(root, `n${String(index).padStart(2, "0")}.txt`), "n");
  });
  assert.equal(result.outcome, "fail");
  assert.match(result.evidence, new RegExp(`added \\(${MAX_LISTED_PATHS + 5}\\)`));
  assert.match(result.evidence, /… 5 more/);
});
