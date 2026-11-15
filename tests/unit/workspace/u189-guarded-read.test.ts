/**
 * U-189 (W-2 of the tool path race study, report-tool-path-race.md): `Workspace.readText` gives only
 * the file `resolve` checked. It walks the real path (root, folders, file) and keeps each identity,
 * opens the file, checks the handle is the walked file, walks again, and only then reads through
 * that handle. A folder swapped for a junction (or the file swapped) between the check and the use
 * is `io_error`, and nothing read through the swapped path is given. A link inside the root that was
 * there when the path was resolved is still read (the walk goes along the real path).
 * The swaps come from a file layer that does them at a chosen step, as U-172's race tests pause.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import type { ResolvedPath, Workspace } from "../../../src/contracts/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { nodeFileLayer } from "../../../src/workspace/file-layer.js";
import type { FileLayer } from "../../../src/workspace/file-layer.js";
import { createWorkspaceWithFileLayer } from "../../../src/workspace/workspace.js";

let base = "";
let root = "";
let outside = "";
let junctions = true;

/** A junction (a directory link Windows makes without rights); false when the platform will not. */
function junction(target: string, at: string): boolean {
  try {
    fs.symlinkSync(target, at, "junction");
    return true;
  } catch {
    return false;
  }
}

before(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u189-read-")));
  root = path.join(base, "root");
  outside = path.join(base, "outside");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, "src", "a.txt"), "inside\n");
  fs.writeFileSync(path.join(outside, "a.txt"), "OUTSIDE\n");
  junctions = junction(path.join(root, "src"), path.join(root, "link-in"));
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

/** A fresh folder `name` in the root holding `a.txt`, and its resolved path. */
async function prepared(workspace: Workspace, name: string): Promise<ResolvedPath> {
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.writeFileSync(path.join(root, name, "a.txt"), "inside\n");
  const resolved = await workspace.resolve(`${name}/a.txt`, "read");
  assert.ok(resolved.ok);
  return resolved.ok ? resolved.path : (undefined as never);
}

/** The folder `name` swapped for a junction to the outside folder (which has its own a.txt). */
function swap(name: string): boolean {
  fs.renameSync(path.join(root, name), path.join(root, `${name}-moved`));
  return junction(outside, path.join(root, name));
}

test("U-189: a plain read and a read through a link inside the root give the file, as before", async () => {
  const workspace = await createWorkspace({ root });
  const plain = await workspace.resolve("src/a.txt", "read");
  assert.ok(plain.ok);
  if (!plain.ok) return;
  const read = await workspace.readText(plain.path);
  assert.ok(read.ok && read.snapshot.text === "inside\n");
  if (!junctions) return;
  const linked = await workspace.resolve("link-in/a.txt", "read");
  assert.ok(linked.ok && linked.path.relative === "src/a.txt", "resolve gives the real path");
  if (!linked.ok) return;
  const again = await workspace.readText(linked.path);
  assert.ok(again.ok && again.snapshot.text === "inside\n");
});

test("U-189: a folder swapped for a junction after resolve: io_error, and the outside file is not read", { skip: !junctions && "no junctions here" }, async () => {
  const workspace = await createWorkspace({ root });
  const resolved = await prepared(workspace, "w1");
  assert.ok(swap("w1"));
  const read = await workspace.readText(resolved);
  assert.deepEqual(read, { ok: false, code: "io_error" });
});

test("U-189: a folder swapped between the walk and the open: the handle is another file, io_error", { skip: !junctions && "no junctions here" }, async () => {
  let armed = false;
  const layer: FileLayer = {
    ...nodeFileLayer,
    openRead: async (target) => {
      if (armed) {
        armed = false;
        assert.ok(swap("w2"));
      }
      return nodeFileLayer.openRead(target);
    },
  };
  const workspace = await createWorkspaceWithFileLayer({ root }, layer);
  const resolved = await prepared(workspace, "w2");
  armed = true;
  const read = await workspace.readText(resolved);
  assert.deepEqual(read, { ok: false, code: "io_error" });
});

test("U-189: a folder swapped after the open: the second walk sees it (or the platform will not let it move)", { skip: !junctions && "no junctions here" }, async () => {
  let armed = false;
  let swapped = false;
  const layer: FileLayer = {
    ...nodeFileLayer,
    openRead: async (target) => {
      const handle = await nodeFileLayer.openRead(target);
      if (armed) {
        armed = false;
        try {
          swapped = swap("w3");
        } catch {
          // Windows: a folder whose file is open cannot be renamed. The swap cannot happen then.
          swapped = false;
        }
      }
      return handle;
    },
  };
  const workspace = await createWorkspaceWithFileLayer({ root }, layer);
  const resolved = await prepared(workspace, "w3");
  armed = true;
  const read = await workspace.readText(resolved);
  if (swapped) assert.deepEqual(read, { ok: false, code: "io_error" });
  else assert.ok(read.ok && read.snapshot.text === "inside\n", "no swap: the checked file, as it is");
});

test("U-189: the file replaced by another at the same path between the walk and the open: tried again, the file there now", async () => {
  let armed = false;
  const layer: FileLayer = {
    ...nodeFileLayer,
    openRead: async (target) => {
      if (armed) {
        armed = false;
        fs.renameSync(target, `${target}.old`);
        fs.writeFileSync(target, "another file\n");
      }
      return nodeFileLayer.openRead(target);
    },
  };
  const workspace = await createWorkspaceWithFileLayer({ root }, layer);
  const resolved = await prepared(workspace, "w4");
  armed = true;
  const read = await workspace.readText(resolved);
  // Codex V-10: the change is seen and the read tried again; the path is the same place, so the file there
  // now is given (a replacement in place is not a swap of location: nothing from elsewhere comes out).
  assert.ok(read.ok && read.snapshot.text === "another file\n", JSON.stringify(read));
});

test("U-189: missing, a folder, and too large keep their codes", async () => {
  const workspace = await createWorkspace({ root });
  const missing = await workspace.resolve("src/none.txt", "read");
  const folder = await workspace.resolve("src", "read");
  fs.writeFileSync(path.join(root, "src", "big.txt"), "x".repeat(300_000));
  const big = await workspace.resolve("src/big.txt", "read");
  assert.ok(missing.ok && folder.ok && big.ok);
  if (!(missing.ok && folder.ok && big.ok)) return;
  assert.deepEqual(await workspace.readText(missing.path), { ok: false, code: "not_found" });
  assert.deepEqual(await workspace.readText(folder.path), { ok: false, code: "not_text" });
  assert.deepEqual(await workspace.readText(big.path), { ok: false, code: "too_large" });
});
