/**
 * GU-2: the engine host's directory listing for the file tree (src/engine-host/tree.ts) with the
 * real engine's workspace rules and text safety helpers (the root build, dist/src), on real
 * folders. Names with the shape of a key are fake values built at run time.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createHostHandler } from "../../src/engine-host/host.js";
import { MAX_TREE_ENTRIES, TREE_PAGE_SIZE, createTreeLister, isTreeDir } from "../../src/engine-host/tree.js";
import type { TreeEngine, TreeResult } from "../../src/engine-host/tree.js";
import { parseHostMessage } from "../../src/shared/protocol.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const ENGINE_DIR = path.join(GUI, "..", "dist", "src");
const ENGINE_BUILT = existsSync(path.join(ENGINE_DIR, "workspace", "index.js")) && existsSync(path.join(ENGINE_DIR, "cli", "text-safety.js"));
const KEY_SHAPED = ["sk", "ant", "FAKE".repeat(10)].join("-");

async function engine(currentKey: string | null = null): Promise<TreeEngine> {
  const workspace = (await import(pathToFileURL(path.join(ENGINE_DIR, "workspace", "index.js")).href)) as Pick<TreeEngine, "createWorkspace">;
  const safety = (await import(pathToFileURL(path.join(ENGINE_DIR, "cli", "text-safety.js")).href)) as Pick<TreeEngine, "cleanText" | "hideKeys">;
  return {
    createWorkspace: (options) => workspace.createWorkspace(options),
    cleanText: (text) => safety.cleanText(text),
    hideKeys: (text, key) => safety.hideKeys(text, key),
    currentKey: () => currentKey,
    platform: process.platform,
  };
}

async function fixture(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gui-tree-"));
  const root = path.join(base, "ws");
  await fs.mkdir(path.join(root, "sub", "deeper"), { recursive: true });
  await fs.mkdir(path.join(root, ".codaryn", "runs"), { recursive: true });
  await fs.writeFile(path.join(root, "a.txt"), "a");
  await fs.writeFile(path.join(root, "B.txt"), "b");
  await fs.writeFile(path.join(root, "file10.txt"), "10");
  await fs.writeFile(path.join(root, "file9.txt"), "9");
  await fs.writeFile(path.join(root, "sub", "c.txt"), "c");
  await fs.writeFile(path.join(root, `${KEY_SHAPED}.txt`), "fake");
  await fs.mkdir(path.join(base, "outside"));
  return { root, cleanup: () => fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

const names = (result: TreeResult): string[] => (result.ok ? result.entries.map((entry) => `${entry.kind}:${entry.shown}`) : [result.code]);

test("tree: relative directories are plain segments only", () => {
  for (const ok of ["", "a", "a/b", "a b/c"]) assert.equal(isTreeDir(ok), true, ok);
  for (const bad of ["/a", "a//b", "a/", "..", "a/../b", ".", "a\\b", "C:", "a\u0001b", Array.from({ length: 65 }, () => "x").join("/")]) {
    assert.equal(isTreeDir(bad), false, bad);
  }
});

test("tree: the top level lists folders first in a natural order, the state directory apart, a key-shaped name hidden", { skip: !ENGINE_BUILT && "the engine is not built" }, async () => {
  const { root, cleanup } = await fixture();
  try {
    const list = createTreeLister(await engine());
    const top = await list({ workspace: root, dir: "", offset: 0 });
    assert.deepEqual(names(top), ["state:.codaryn", "dir:sub", "file:a.txt", "file:B.txt", "file:file9.txt", "file:file10.txt", "file:[key].txt"]);
    assert.ok(top.ok);
    if (!top.ok) return;
    const masked = top.entries.find((entry) => entry.masked);
    assert.equal(masked?.name, `${KEY_SHAPED}.txt`, "the real name stays for the main process");
    assert.equal(top.entries.filter((entry) => entry.masked).length, 1);
    assert.deepEqual(names(await list({ workspace: root, dir: "sub", offset: 0 })), ["dir:deeper", "file:c.txt"]);
    assert.deepEqual(names(await list({ workspace: root, dir: "sub/deeper", offset: 0 })), []);
  } finally {
    await cleanup();
  }
});

test("tree: the state directory, places outside and missing folders are refused", { skip: !ENGINE_BUILT && "the engine is not built" }, async () => {
  const { root, cleanup } = await fixture();
  try {
    const list = createTreeLister(await engine());
    assert.deepEqual(names(await list({ workspace: root, dir: ".codaryn", offset: 0 })), ["state_dir"]);
    assert.deepEqual(names(await list({ workspace: root, dir: ".codaryn/runs", offset: 0 })), ["state_dir"]);
    assert.deepEqual(names(await list({ workspace: root, dir: "../outside", offset: 0 })), ["invalid_path"]);
    assert.deepEqual(names(await list({ workspace: root, dir: "a.txt", offset: 0 })), ["not_dir"]);
    const missing = names(await list({ workspace: root, dir: "nothing", offset: 0 }));
    assert.ok(missing[0] === "not_found" || missing[0] === "invalid_path", String(missing[0]));
  } finally {
    await cleanup();
  }
});

test("tree: a junction is listed as a link and is not followed, also when it points outside", { skip: !ENGINE_BUILT && "the engine is not built" }, async (t) => {
  const { root, cleanup } = await fixture();
  try {
    try {
      await fs.symlink(path.join(root, "..", "outside"), path.join(root, "out-link"), "junction");
      await fs.symlink(path.join(root, "sub"), path.join(root, "in-link"), "junction");
    } catch {
      t.skip("links cannot be made here");
      return;
    }
    const list = createTreeLister(await engine());
    const top = names(await list({ workspace: root, dir: "", offset: 0 }));
    assert.ok(top.includes("link:out-link") && top.includes("link:in-link"), top.join(","));
    assert.deepEqual(names(await list({ workspace: root, dir: "out-link", offset: 0 })), ["outside_root"], "asking for it directly resolves outside");
  } finally {
    await cleanup();
  }
});

test("tree: the current key and control characters in names are hidden", { skip: !ENGINE_BUILT && "the engine is not built" }, async () => {
  const { root, cleanup } = await fixture();
  try {
    const currentKey = `fake-current-key-${"x".repeat(24)}`;
    await fs.writeFile(path.join(root, `${currentKey}.md`), "k");
    const list = createTreeLister(await engine(currentKey));
    const top = await list({ workspace: root, dir: "", offset: 0 });
    assert.ok(top.ok);
    assert.doesNotMatch(JSON.stringify(top.ok ? top.entries.map((entry) => entry.shown) : []), /fake-current-key|FAKEFAKE/);
    // NTFS cannot hold control characters in names, so the rule is checked with a cleanText that
    // treats "z" as one: a name it would change is not shown at all and is masked.
    await fs.writeFile(path.join(root, "zebra.txt"), "z");
    const strict = createTreeLister({ ...(await engine()), cleanText: (text) => text.replace(/z/g, "?") });
    const listed = await strict({ workspace: root, dir: "", offset: 0 });
    assert.ok(listed.ok);
    const zebra = listed.ok ? listed.entries.find((entry) => entry.name === "zebra.txt") : undefined;
    assert.deepEqual(zebra && { shown: zebra.shown, masked: zebra.masked }, { shown: "", masked: true });
  } finally {
    await cleanup();
  }
});

test("tree: large folders come in pages of TREE_PAGE_SIZE", { skip: !ENGINE_BUILT && "the engine is not built" }, async () => {
  const { root, cleanup } = await fixture();
  try {
    const many = path.join(root, "many");
    await fs.mkdir(many);
    await Promise.all(Array.from({ length: TREE_PAGE_SIZE + 7 }, (_v, i) => fs.writeFile(path.join(many, `f${i}.txt`), "")));
    const list = createTreeLister(await engine());
    const first = await list({ workspace: root, dir: "many", offset: 0 });
    assert.ok(first.ok);
    if (!first.ok) return;
    assert.equal(first.entries.length, TREE_PAGE_SIZE);
    assert.equal(first.total, TREE_PAGE_SIZE + 7);
    assert.equal(first.nextOffset, TREE_PAGE_SIZE);
    const second = await list({ workspace: root, dir: "many", offset: TREE_PAGE_SIZE });
    assert.ok(second.ok && second.entries.length === 7 && second.nextOffset === null);
    assert.ok(MAX_TREE_ENTRIES >= 100_000);
  } finally {
    await cleanup();
  }
});

test("tree: the host checks the call's arguments before listing", async () => {
  const requests: unknown[] = [];
  const written: unknown[] = [];
  const handler = createHostHandler({
    app: { doctor: async () => null, readSettings: async () => null, listModels: async () => null, selectModel: async () => null },
    messages: { texts: () => ({ language: "en", texts: {} }) },
    shown: (text) => text,
    providers: [],
    tree: async (request) => {
      requests.push(request);
      return { ok: true, entries: [], total: 0, offset: 0, nextOffset: null };
    },
    write: (line) => written.push(parseHostMessage(line.trimEnd())),
    log: () => undefined,
  });
  const abs = path.resolve("ws");
  await handler.handleLine(JSON.stringify({ v: 1, id: 1, call: "tree", args: { workspace: abs, dir: "sub", offset: 0 } }));
  for (const [id, args] of [
    [2, { workspace: "relative", dir: "", offset: 0 }],
    [3, { workspace: abs, dir: 5, offset: 0 }],
    [4, { workspace: abs, dir: "", offset: -1 }],
    [5, { workspace: abs, dir: "", offset: 0, extra: true }],
  ] as const) {
    await handler.handleLine(JSON.stringify({ v: 1, id, call: "tree", args }));
  }
  assert.deepEqual(requests, [{ workspace: abs, dir: "sub", offset: 0 }]);
  assert.deepEqual(
    written.map((message) => (message as { ok: boolean; error?: { code: string } }).ok || (message as { error: { code: string } }).error.code),
    [true, "invalid_args", "invalid_args", "invalid_args", "invalid_args"],
  );
});
