/**
 * U-187, review V-11 H-1, the gate's part: the approved plan's writable list holds effective paths
 * (resolved when the plan was made). An entry covers only its own text, and only while it still
 * resolves to itself; it never covers where a link now on its way leads. So after docs became a
 * junction to other, neither other/new.md nor docs/new.md (which now resolves to other/new.md) is
 * writable through the plan's entry docs/new.md, also under the policy list [docs] that covers
 * other/ through its own link. Without the junction the planned file is writable as before.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { BUILTIN_TOOLS } from "../../../src/contracts/index.js";
import type { EffectiveToolCall, PolicyConfig, WritablePathSet, Workspace } from "../../../src/contracts/index.js";
import { compilePathSet, createPolicyGate } from "../../../src/policy/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const ALLOW = { allowed: true };
const NOT_WRITABLE = { allowed: false, permission: "path", code: "path_not_writable" };
const BASE: PolicyConfig = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };

let base: string;
let plain: Workspace;
let linked: Workspace;
let links = false;

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u187v11p-"));
  // The junction first, before anything awaits: the tests read `links` when they are defined.
  const linkedRoot = path.join(base, "linked");
  fs.mkdirSync(path.join(linkedRoot, "other"), { recursive: true });
  try {
    fs.symlinkSync(path.join(linkedRoot, "other"), path.join(linkedRoot, "docs"), "junction");
    links = true;
  } catch {
    links = false;
  }
  const plainRoot = path.join(base, "plain");
  fs.mkdirSync(path.join(plainRoot, "docs"), { recursive: true });
  fs.mkdirSync(path.join(plainRoot, "other"));
  plain = await createWorkspace({ root: plainRoot });
  linked = await createWorkspace({ root: linkedRoot });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

async function write(workspace: Workspace, sets: readonly WritablePathSet[], target: string): Promise<object> {
  const gate = createPolicyGate({ config: BASE, workspace, writablePathSets: sets });
  const args = { path: target, expectedHash: null, change: { kind: "replace_all", content: "x" } };
  return gate.checkEffective({ id: "c1", name: "write_file", args } as unknown as EffectiveToolCall, BUILTIN_TOOLS.write_file);
}

const PLAN: WritablePathSet = { source: "plan", entries: ["docs/new.md"] };

describe("V-11 H-1: the plan's entries cover only themselves, unlinked", () => {
  test("without the junction: the planned file is writable, nothing beside it", async () => {
    assert.deepEqual(await write(plain, [PLAN], "docs/new.md"), ALLOW);
    assert.deepEqual(await write(plain, [PLAN], "other/new.md"), NOT_WRITABLE);
  });

  test("docs now a junction to other: neither other/new.md nor docs/new.md is writable through the plan", { skip: !links && "no junctions here" }, async () => {
    assert.deepEqual(await write(linked, [PLAN], "other/new.md"), NOT_WRITABLE);
    assert.deepEqual(await write(linked, [PLAN], "docs/new.md"), NOT_WRITABLE, "it resolves to other/new.md now");
    assert.deepEqual(await write(linked, [{ source: "config", entries: ["docs"] }, PLAN], "other/new.md"), NOT_WRITABLE, "the policy list's own link does not help");
  });

  test("the matcher: an entry that no longer resolves to itself allows nothing; follow stays as it was", { skip: !links && "no junctions here" }, async () => {
    const refuse = compilePathSet(["docs/new.md"], { match: "exact", onUnusable: "misses", entryLinks: "refuse" });
    const follow = compilePathSet(["docs/new.md"], { match: "exact", onUnusable: "misses" });
    assert.equal(await refuse.coversEffective("other/new.md", linked), false);
    assert.equal(await follow.coversEffective("other/new.md", linked), true, "a link entry covers its real path when links are followed");
    assert.equal(await refuse.coversEffective("docs/new.md", plain), true);
  });
});
