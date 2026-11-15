/**
 * U-189 after Codex V-10 (race-results.json, normal-results.json):
 * - aba-parent: the parent folder swapped for a junction after its lstat and swapped back before the
 *   second walk looks at it. Every identity is the same again, but the root's change time is not
 *   (an entry renamed and a junction made and removed in it), so the read sees the change. Kept up on
 *   every try, the read is io_error; never the outside file's text.
 * - the listing (search_files' name search, W-3): a folder swapped while it is listed gives no name
 *   from where it led; kept up, io_error.
 * - inspect_files (P-1 and T-1): its folder argument must be the real path the gate judged, and its
 *   names and hashes come only from folders that stayed the ones checked.
 * The swaps come from a file layer (or the file system itself) at a chosen step.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { WORKFLOW_TOOLS } from "../../../src/contracts/index.js";
import type { EffectiveWorkflowToolCall, PolicyConfig } from "../../../src/contracts/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { nodeFileLayer } from "../../../src/workspace/file-layer.js";
import type { FileLayer } from "../../../src/workspace/file-layer.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { createWorkspaceWithFileLayer } from "../../../src/workspace/workspace.js";
import { createFakePrivacy } from "../tools/doubles.js";

const never = new AbortController().signal;
let base = "";
let root = "";
let outside = "";
let junctions = true;

function junction(target: string, at: string): boolean {
  try {
    fs.symlinkSync(target, at, "junction");
    return true;
  } catch {
    return false;
  }
}

before(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u189-v10-")));
  root = path.join(base, "root");
  outside = path.join(base, "outside");
  fs.mkdirSync(path.join(root, "secret"), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "a.txt"), "OUTSIDE\n");
  fs.writeFileSync(path.join(outside, "outside-name.txt"), "x");
  fs.writeFileSync(path.join(root, "secret", "secret-name.txt"), "SECRET\n");
  const probe = path.join(base, "probe");
  junctions = junction(outside, probe);
  if (junctions) fs.rmSync(probe);
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

/** `name` (in the root) swapped for a junction to the outside folder, and back. */
function swapOut(name: string): void {
  fs.renameSync(path.join(root, name), path.join(root, `${name}-real`));
  assert.ok(junction(outside, path.join(root, name)));
}
function swapBack(name: string): void {
  fs.rmSync(path.join(root, name));
  fs.renameSync(path.join(root, `${name}-real`), path.join(root, name));
}

test("V-10 aba-parent: swapped after the parent's lstat and back before the second walk sees it: never the outside text", { skip: !junctions && "no junctions here" }, async () => {
  fs.mkdirSync(path.join(root, "aba"));
  fs.writeFileSync(path.join(root, "aba", "a.txt"), "inside\n");
  const leaf = path.join(root, "aba", "a.txt");
  const parent = path.join(root, "aba");
  // Codex's order, on every try: parent lstat (real) → swap → leaf lstat and open (outside) → restore →
  // second walk's parent lstat (real) → swap → leaf lstat (outside) → read.
  let swapped = false;
  let reads = 0;
  const layer: FileLayer = {
    ...nodeFileLayer,
    lstatId: async (target) => {
      if (target === leaf && !swapped) {
        swapOut("aba");
        swapped = true;
      } else if (target === parent && swapped) {
        swapBack("aba");
        swapped = false;
      }
      return nodeFileLayer.lstatId(target);
    },
    openRead: async (target) => {
      reads += 1;
      return nodeFileLayer.openRead(target);
    },
  };
  const workspace = await createWorkspaceWithFileLayer({ root }, layer);
  const resolved = await workspace.resolve("aba/a.txt", "read");
  assert.ok(resolved.ok);
  if (!resolved.ok) return;
  const read = await workspace.readText(resolved.path);
  if (swapped) swapBack("aba");
  assert.deepEqual(read, { ok: false, code: "io_error" }, "kept up on every try: io_error");
  assert.ok(reads >= 2, "tried again before giving up");
  assert.equal(JSON.stringify(read).includes("OUTSIDE"), false);
});

test("V-10 listing: a folder swapped while it is listed gives no outside name; kept up, io_error", { skip: !junctions && "no junctions here" }, async () => {
  fs.mkdirSync(path.join(root, "list", "sub"), { recursive: true });
  fs.writeFileSync(path.join(root, "list", "sub", "inside-name.txt"), "x");
  const sub = path.join(root, "list", "sub");
  // Before each readdir of sub: swap it out; after: back (an aba around the readdir), on every try.
  const layer: FileLayer = {
    ...nodeFileLayer,
    readdir: async (target) => {
      if (target !== sub) return nodeFileLayer.readdir(target);
      fs.renameSync(sub, `${sub}-real`);
      assert.ok(junction(outside, sub));
      try {
        return await nodeFileLayer.readdir(target);
      } finally {
        fs.rmSync(sub);
        fs.renameSync(`${sub}-real`, sub);
      }
    },
  };
  const workspace = await createWorkspaceWithFileLayer({ root }, layer);
  const dir = await workspace.resolve("list", "read");
  assert.ok(dir.ok);
  if (!dir.ok) return;
  const listed = await workspace.list(dir.path);
  assert.deepEqual(listed, { ok: false, code: "io_error" });
  assert.equal(JSON.stringify(listed).includes("outside-name"), false);
  // Without the swap the listing is as before.
  const plain = await createWorkspace({ root });
  const again = await plain.resolve("list", "read");
  assert.ok(again.ok);
  if (!again.ok) return;
  const ok = await plain.list(again.path);
  assert.ok(ok.ok && ok.entries.some((entry) => entry.relative === "list/sub/inside-name.txt"));
});

test("V-10 name search: search_files by name through a swapped folder gives no outside name", { skip: !junctions && "no junctions here" }, async () => {
  fs.mkdirSync(path.join(root, "names", "sub"), { recursive: true });
  fs.writeFileSync(path.join(root, "names", "sub", "inside-name.txt"), "x");
  const sub = path.join(root, "names", "sub");
  const layer: FileLayer = {
    ...nodeFileLayer,
    readdir: async (target) => {
      if (target === sub) {
        fs.renameSync(sub, `${sub}-real`);
        junction(outside, sub);
      }
      return nodeFileLayer.readdir(target);
    },
  };
  const workspace = await createWorkspaceWithFileLayer({ root }, layer);
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy() });
  const found = await tools.execute({ id: "c1", name: "search_files", args: { path: "names", nameContains: "name" } }, never);
  assert.equal(JSON.stringify(found).includes("outside-name"), false, JSON.stringify(found));
});

function inspectCall(dir: string): EffectiveWorkflowToolCall {
  return { id: "c1", name: "inspect_files", args: { path: dir, hash: true } } as unknown as EffectiveWorkflowToolCall;
}

const config: PolicyConfig = { commands: [], network: "deny", destructive: "deny", protectedPaths: [], restorePathTokens: false, planActions: ["move", "discard"] };

test("V-10 inspect_files gate-to-tool-inside: the folder swapped after the gate judged it: policy_denied, no secret name or hash", { skip: !junctions && "no junctions here" }, async () => {
  fs.mkdirSync(path.join(root, "insp"));
  fs.writeFileSync(path.join(root, "insp", "plain.txt"), "plain\n");
  const workspace = await createWorkspace({ root });
  const gate = createPolicyGate({ config, workspace });
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy() });
  assert.ok(tools.executeWorkflowTool !== undefined);
  const call = inspectCall("insp");
  assert.ok((await gate.checkEffective(call, WORKFLOW_TOOLS.inspect_files)).allowed);
  fs.renameSync(path.join(root, "insp"), path.join(root, "insp-real"));
  assert.ok(junction(path.join(root, "secret"), path.join(root, "insp")));
  const outcome = await tools.executeWorkflowTool(call, never);
  assert.equal(outcome.ok === false && outcome.code, "policy_denied");
  assert.equal(JSON.stringify(outcome).includes("secret-name"), false);
});

test("V-10 inspect_files resolved-to-use: a subfolder swapped while it is read gives no outside name or hash; kept up, io_error", { skip: !junctions && "no junctions here" }, async () => {
  fs.mkdirSync(path.join(root, "insp2", "sub"), { recursive: true });
  fs.writeFileSync(path.join(root, "insp2", "sub", "inside-name.txt"), "x");
  const workspace = await createWorkspace({ root });
  const sub = path.join(root, "insp2", "sub");
  // The plan file operations' lstat runs per entry after the folders were read: the swap goes in there,
  // and back after (an aba between the walk and the end check), on every try.
  const tools = createToolRunner({
    workspace,
    privacy: createFakePrivacy(),
    fileOps: {
      lstat: async (target) => {
        if (target === sub) {
          fs.renameSync(sub, `${sub}-real`);
          junction(outside, sub);
          try {
            return await fs.promises.lstat(target, { bigint: true });
          } finally {
            fs.rmSync(sub);
            fs.renameSync(`${sub}-real`, sub);
          }
        }
        return fs.promises.lstat(target, { bigint: true });
      },
    },
  });
  assert.ok(tools.executeWorkflowTool !== undefined);
  const outcome = await tools.executeWorkflowTool(inspectCall("insp2"), never);
  assert.equal(outcome.ok === false && outcome.code, "io_error", JSON.stringify(outcome));
  assert.equal(JSON.stringify(outcome).includes("outside-name"), false);
  // Untouched, inspect_files lists as before.
  const plain = createToolRunner({ workspace, privacy: createFakePrivacy() });
  const listed = await plain.executeWorkflowTool?.(inspectCall("insp2"), never);
  assert.ok(listed?.ok && JSON.stringify(listed).includes("inside-name.txt"));
});
