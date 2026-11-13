/**
 * U-213 after main's U-203: search_files with unreadable paths lists through visible-list.ts
 * (listVisible), the tools' own listing that leaves unreadable entries out before it counts or enters
 * them. Its folder guards are Workspace.list's (a walk, each folder looked at before its readdir,
 * walked and looked at again at the end); its tries again are too: six, twice at once and then after
 * waits of 50, 200 and 500 ms, none started 2 s or more after the search began, and the run's signal
 * ends a wait. The search's error texts do not change.
 *
 * listVisible resolves a link in a listed folder through Workspace.resolve; the test's workspace
 * wraps resolve to change the folder there (a burst), inside a try, after the folder was looked at.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import type { Workspace } from "../../../src/contracts/index.js";
import { compilePathSet } from "../../../src/policy/path-set.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { listVisible } from "../../../src/tools/visible-list.js";
import { GUARD_ATTEMPTS } from "../../../src/workspace/guard.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { createFakePrivacy } from "./doubles.js";

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
let base = "";
let root = "";
let junctions = true;

before(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u213-visible-")));
  root = path.join(base, "root");
  fs.mkdirSync(path.join(root, "vis"), { recursive: true });
  fs.mkdirSync(path.join(root, "vis-target"));
  fs.mkdirSync(path.join(root, "secret"));
  fs.writeFileSync(path.join(root, "vis", "a.txt"), "alpha\n");
  fs.writeFileSync(path.join(root, "vis-target", "t.txt"), "target\n");
  try {
    fs.symlinkSync(path.join(root, "vis-target"), path.join(root, "vis", "link"), "junction");
  } catch {
    junctions = false;
  }
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

/**
 * The workspace with resolve wrapped: resolving `vis/link` (listVisible does, for a link) waits
 * `slowMs` and, for the first `burst` times, changes `vis` past the clock tick of its last change.
 */
async function burstWorkspace(burst: number, slowMs = 0): Promise<{ workspace: Workspace; links: () => number }> {
  const real = await createWorkspace({ root });
  let links = 0;
  const workspace: Workspace = {
    ...real,
    resolve: async (input, access) => {
      if (input === "vis/link") {
        links += 1;
        if (slowMs > 0) await sleep(slowMs);
        if (links <= burst) {
          await sleep(20);
          const sibling = path.join(root, "vis", `burst-${process.pid}.tmp`);
          fs.writeFileSync(sibling, "x");
          fs.unlinkSync(sibling);
        }
      }
      return real.resolve(input, access);
    },
  };
  return { workspace, links: () => links };
}

async function search(workspace: Workspace, signal = new AbortController().signal) {
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy(), unreadablePaths: ["secret"] });
  return tools.execute({ id: "c1", name: "search_files", args: { path: "vis" } }, signal);
}

test("U-213 visible listing: a folder changed on its first three tries is listed on the fourth", { skip: !junctions && "no junctions here" }, async () => {
  const { workspace, links } = await burstWorkspace(3);
  const outcome = await search(workspace);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const paths = (outcome.payload as unknown as { entries: { path: string }[] }).entries.map((entry) => entry.path);
  assert.ok(paths.includes("vis/a.txt") && paths.includes("vis/link"), JSON.stringify(paths));
  assert.equal(links(), 4);
});

test("U-213 visible listing: a folder that changes on every try is io_error after six, in the search's words", { skip: !junctions && "no junctions here" }, async () => {
  const { workspace, links } = await burstWorkspace(Infinity);
  const outcome = await search(workspace);
  assert.deepEqual(outcome.ok ? "listed" : [outcome.code, outcome.message], ["io_error", "cannot list directory: io_error"]);
  assert.equal(links(), GUARD_ATTEMPTS);
});

test("U-213 visible listing: no try starts 2 s or more after the search began (slow tries of a large tree)", { skip: !junctions && "no junctions here" }, async () => {
  const { workspace, links } = await burstWorkspace(Infinity, 700);
  const outcome = await search(workspace);
  assert.equal(outcome.ok ? "listed" : outcome.code, "io_error");
  assert.equal(links(), 3, "tries of over 700 ms: the fourth would start after 2 s");
});

test("U-213 visible listing: the run's signal ends a wait at once", { skip: !junctions && "no junctions here" }, async () => {
  const { workspace, links } = await burstWorkspace(Infinity);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const started = performance.now();
  const outcome = await search(workspace, controller.signal);
  const took = performance.now() - started;
  assert.ok(took < 500, `ended ${Math.round(took)} ms after the start, not after the waits`);
  assert.equal(outcome.ok ? "listed" : outcome.code, "io_error");
  assert.ok(links() <= 3, `${links()} tries`);
});

test("U-213 visible listing: called without options it keeps its own 2 s limit, as Workspace.list does", { skip: !junctions && "no junctions here" }, async () => {
  const { workspace, links } = await burstWorkspace(Infinity, 700);
  const dir = await workspace.resolve("vis", "read");
  assert.ok(dir.ok, JSON.stringify(dir));
  const hidden = await compilePathSet(["secret"], { match: "prefix", onUnusable: "covers" }).snapshot(workspace);
  const listed = await listVisible(workspace, dir.path, hidden);
  assert.equal(listed.ok ? "listed" : listed.code, "io_error");
  assert.equal(links(), 3, "tries of over 700 ms: the fourth would start after 2 s");
});
