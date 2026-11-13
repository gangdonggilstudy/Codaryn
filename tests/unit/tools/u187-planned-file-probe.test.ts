/**
 * U-187 (DR-69 B-6): createPlannedFileProbe, what is at a planned file's path now, for the check
 * before a run carries out an approved plan (with plannedFileStale). On a real workspace:
 * - modify: the same file gives its SHA-256 (fits); changed content another one (stale); gone is
 *   `missing`; a folder or a link in its place is `other` (stale).
 * - create: nothing there is `missing` (fits), folders not there yet too; anything there, a parent
 *   that is a file, or a parent link leading outside is `other` (stale).
 * Reads only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { plannedFileStale } from "../../../src/contracts/index.js";
import type { ContentHash, PlannedFileProbe, ResolvedPlannedFile, Workspace } from "../../../src/contracts/index.js";
import { createPlannedFileProbe } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const never = new AbortController().signal;
const sha = (text: string): ContentHash => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex") as ContentHash;

let base: string;
let root: string;
let workspace: Workspace;
let probe: PlannedFileProbe;
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
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u187p-"));
  root = path.join(base, "root");
  fs.mkdirSync(path.join(root, "docs", "folder"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "guide.md"), "guide");
  fs.writeFileSync(path.join(root, "docs", "file.txt"), "f");
  fs.mkdirSync(path.join(base, "outside"));
  links = tryJunction(path.join(base, "outside"), path.join(root, "link-out")) && tryJunction(path.join(root, "docs"), path.join(root, "docs-link"));
  workspace = await createWorkspace({ root });
  probe = createPlannedFileProbe({ workspace });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const modify = (where: string, hash: ContentHash): ResolvedPlannedFile => ({ path: where, change: "modify", sha256: hash });
const create = (where: string): ResolvedPlannedFile => ({ path: where, change: "create", sha256: null });

describe("U-187: the planned file probe", () => {
  test("modify: the same file fits; changed content, a folder or nothing there does not", async () => {
    const same = modify("docs/guide.md", sha("guide"));
    assert.deepEqual(await probe(same, never), { kind: "file", sha256: sha("guide") });
    assert.equal(plannedFileStale(same, await probe(same, never)), false);
    assert.equal(plannedFileStale(modify("docs/guide.md", sha("older")), await probe(modify("docs/guide.md", sha("older")), never)), true);
    assert.deepEqual(await probe(modify("docs/folder", sha("x")), never), { kind: "other" });
    assert.deepEqual(await probe(modify("docs/gone.md", sha("x")), never), { kind: "missing" });
  });

  test("create: nothing there fits, folders not there yet too; something there or a file as parent does not", async () => {
    assert.deepEqual(await probe(create("docs/new.md"), never), { kind: "missing" });
    assert.deepEqual(await probe(create("new/dir/file.md"), never), { kind: "missing" });
    assert.deepEqual(await probe(create("docs/guide.md"), never), { kind: "other" });
    assert.deepEqual(await probe(create("docs/folder"), never), { kind: "other" });
    assert.deepEqual(await probe(create("docs/file.txt/inner.md"), never), { kind: "other" });
  });

  test("links: a modify path whose last name is a link, and a create under a link leading outside, do not fit", { skip: !links && "no junctions here" }, async () => {
    assert.deepEqual(await probe(modify("docs-link", sha("x")), never), { kind: "other" });
    assert.deepEqual(await probe(create("link-out/new.md"), never), { kind: "other" });
  });

  test("a path the workspace refuses does not fit", async () => {
    assert.deepEqual(await probe(create("../outside.md"), never), { kind: "other" });
    assert.deepEqual(await probe(modify(".codaryn/x.md", sha("x")), never), { kind: "other" });
  });

  test("it reads only: the workspace is as before", async () => {
    const before = fs.readdirSync(path.join(root, "docs")).sort();
    await probe(create("docs/new.md"), never);
    await probe(modify("docs/guide.md", sha("guide")), never);
    assert.deepEqual(fs.readdirSync(path.join(root, "docs")).sort(), before);
  });
});
