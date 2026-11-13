/**
 * U-180 (PM after merging U-175; review R-101 L-2): writable lists and files that do not exist yet.
 * - An allow list allows only through an entry whose real path was found (V-3 M-1). A plan's
 *   `create` file does not exist yet, and the workspace resolves such a path as usual (its parents'
 *   real path and its name), so creating it is allowed; so is a file under a folder of a policy
 *   list that does not exist yet.
 * - When the new file's parent is a link that leads outside the workspace, the entry cannot be
 *   resolved (it allows nothing) and the write itself is refused at its own resolve (outside_root).
 * - A parent link that stays inside covers the real place, as any link entry does.
 * - R-101 L-2: the entries whose text covers the write are resolved first, so an allowed write
 *   costs one resolve of an entry; a refused one resolves them all.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { BUILTIN_TOOLS } from "../../../src/contracts/index.js";
import type { EffectiveToolCall, PathAccess, PolicyConfig, ResolvePathOutcome, WritablePathSet, Workspace } from "../../../src/contracts/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { compilePathSet } from "../../../src/policy/path-set.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const ALLOW = { allowed: true };
const NOT_WRITABLE = { allowed: false, permission: "path", code: "path_not_writable" };
const OUTSIDE = { allowed: false, permission: "path", code: "outside_root" };
const BASE: PolicyConfig = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };

let base: string;
let workspace: Workspace;
let links = false;

function tryJunction(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link, "junction");
    return true;
  } catch {
    return false;
  }
}

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u180c-"));
  const root = path.join(base, "root");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "a.ts"), "a\n");
  fs.mkdirSync(path.join(base, "outside"));
  links = tryJunction(path.join(base, "outside"), path.join(root, "link-out")) && tryJunction(path.join(root, "src"), path.join(root, "link-in"));
  workspace = await createWorkspace({ root });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

async function writeVerdict(ws: Workspace, sets: readonly WritablePathSet[], target: string): Promise<object> {
  const gate = createPolicyGate({ config: BASE, workspace: ws, writablePathSets: sets });
  const args = { path: target, expectedHash: null, change: { kind: "replace_all", content: "new" } };
  return gate.checkEffective({ id: "c1", name: "write_file", args } as unknown as EffectiveToolCall, BUILTIN_TOOLS.write_file);
}

/** The real workspace, counting the entry resolves (`read` access; a write's target uses `write`). */
function counting(ws: Workspace): Workspace & { readonly reads: () => number } {
  let reads = 0;
  return {
    root: ws.root,
    readText: (p) => ws.readText(p),
    list: (p) => ws.list(p),
    writeText: (r) => ws.writeText(r),
    resolve(given: string, access: PathAccess): Promise<ResolvePathOutcome> {
      if (access === "read") reads += 1;
      return ws.resolve(given, access);
    },
    reads: () => reads,
  };
}

describe("U-180: creating a file that does not exist yet under a writable list", () => {
  test("the workspace resolves a path that does not exist yet", async () => {
    const resolved = await workspace.resolve("new/dir/file.md", "read");
    assert.ok(resolved.ok, JSON.stringify(resolved));
    assert.equal(resolved.path.relative, "new/dir/file.md");
  });

  test("a plan's create file is allowed, with its folders not there yet", async () => {
    assert.deepEqual(await writeVerdict(workspace, [{ source: "plan", entries: ["new/dir/file.md"] }], "new/dir/file.md"), ALLOW);
    assert.equal(await compilePathSet(["new/dir/file.md"], { match: "exact", onUnusable: "misses" }).coversEffective("new/dir/file.md", workspace), true);
    assert.deepEqual(await writeVerdict(workspace, [{ source: "plan", entries: ["new/dir/file.md"] }], "new/dir/other.md"), NOT_WRITABLE, "only that file");
  });

  test("a new file under a policy list's folder that does not exist yet is allowed", async () => {
    assert.deepEqual(await writeVerdict(workspace, [{ source: "config", entries: ["out"] }], "out/report.md"), ALLOW);
  });

  test("the policy's list and the plan's together: the new file is in both", async () => {
    const sets: WritablePathSet[] = [
      { source: "config", entries: ["new"] },
      { source: "plan", entries: ["new/dir/file.md"] },
    ];
    assert.deepEqual(await writeVerdict(workspace, sets, "new/dir/file.md"), ALLOW);
  });

  test("its parent a link leading outside: the entry allows nothing and the write is refused", { skip: !links && "no junctions here" }, async () => {
    const entry = await workspace.resolve("link-out/new.md", "read");
    assert.deepEqual(entry, { ok: false, code: "outside_root" });
    assert.equal(await compilePathSet(["link-out/new.md"], { match: "exact", onUnusable: "misses" }).coversEffective("link-out/new.md", workspace), false);
    assert.deepEqual(await writeVerdict(workspace, [{ source: "plan", entries: ["link-out/new.md"] }], "link-out/new.md"), OUTSIDE);
  });

  test("its parent a link that stays inside: the real place is covered, as with any link entry", { skip: !links && "no junctions here" }, async () => {
    const sets: WritablePathSet[] = [{ source: "plan", entries: ["link-in/new.ts"] }];
    assert.deepEqual(await writeVerdict(workspace, sets, "link-in/new.ts"), ALLOW);
    assert.deepEqual(await writeVerdict(workspace, sets, "src/new.ts"), ALLOW, "the same file by its real path");
    assert.deepEqual(await writeVerdict(workspace, sets, "src/other.ts"), NOT_WRITABLE);
  });
});

describe("U-180 (R-101 L-2): an allowed write resolves the entry that allows it first", () => {
  const files = Array.from({ length: 100 }, (_, index) => `docs/file-${String(index).padStart(3, "0")}.md`);

  test("100 planned files: an allowed write resolves one entry, a refused one all of them", async () => {
    const allowed = counting(workspace);
    assert.deepEqual(await writeVerdict(allowed, [{ source: "plan", entries: files }], "docs/file-050.md"), ALLOW);
    assert.equal(allowed.reads(), 1);
    const refused = counting(workspace);
    assert.deepEqual(await writeVerdict(refused, [{ source: "plan", entries: files }], "docs/other.md"), NOT_WRITABLE);
    assert.equal(refused.reads(), 100);
  });
});
