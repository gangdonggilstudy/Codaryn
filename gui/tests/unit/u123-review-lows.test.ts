/**
 * U-123: three low findings of the reviews.
 * - R-87 U-66 L1: a changed file gets a "show in folder" id only when its path is there on disk; a
 *   path the app layer masked (a key shape shown as [key]) names nothing there.
 * - R-87 U-68 L1: a lock another process held is looked at again when the workspace or the new task
 *   screen is shown, and the words say F5.
 * - R-82 U-103 L1: a settings write drops every tree id the main process gave, and tells the window,
 *   which reads its tree again.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { pathOnDisk } from "../../src/main/on-disk.js";
import { TreeIds } from "../../src/main/tree-ids.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { IPC_EVENTS } from "../../src/shared/ipc.js";

const KEY_SHAPED = ["sk", "ant", "FAKE".repeat(10)].join("-");

test("U-123 (R-87 U-66 L1): only a path that is there on disk counts; a masked name, a link and a way out do not", async (t) => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gui-u123-")));
  try {
    const root = path.join(base, "ws");
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "docs", "notes.md"), "n");
    await fs.writeFile(path.join(root, `k-${KEY_SHAPED}.txt`), "k");
    await fs.writeFile(path.join(base, "outside.txt"), "o");
    assert.equal(await pathOnDisk(root, "docs/notes.md"), true);
    assert.equal(await pathOnDisk(root, "docs"), true);
    assert.equal(await pathOnDisk(root, "k-[key].txt"), false, "the masked name is not on disk (the real one is)");
    assert.equal(await pathOnDisk(root, "gone.md"), false);
    assert.equal(await pathOnDisk(root, "../outside.txt"), false);
    assert.equal(await pathOnDisk(root, ""), false);
    try {
      await fs.symlink(path.join(base), path.join(root, "jump"), "junction");
      assert.equal(await pathOnDisk(root, "jump"), false, "a junction is not a plain folder");
    } catch {
      t.diagnostic("junctions cannot be made here; the link case is skipped");
    }
  } finally {
    await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("U-123 (R-82 U-103 L1): dropping the ids makes every id given before unknown; the window is told by its own event", () => {
  let n = 0;
  const ids = new TreeIds((size) => Uint8Array.from({ length: size }, () => n++ & 0xff));
  const handle = "0".repeat(32);
  const before = ids.issue(handle, "a.txt");
  assert.equal(ids.resolve(handle, before), "a.txt");
  ids.clear();
  assert.equal(ids.resolve(handle, before), null, "copyPath and reveal refuse it as unknown_entry");
  assert.equal(IPC_EVENTS.treeReset, "codaryn:event:treereset");
});

test("U-123 (R-87 U-68 L1): the lock's words say how to look again", () => {
  for (const language of ["ko", "en"] as const) {
    const t = textsFor(language);
    for (const id of ["open.locked", "task.locked"] as const) assert.match(t.format(id), /F5/, `${language} ${id}`);
  }
});
