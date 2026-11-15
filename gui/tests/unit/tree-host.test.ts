/**
 * GU-2, U-103 (G-list): the engine host's file tree is the app layer's `listWorkspaceDir` (U-89,
 * adapter-contract 5.12). Its value is checked field by field (tree.ts); a masked entry has no real
 * name. With the real app layer (the root build, dist/src) on real folders: key shapes and the
 * values the settings register (`secretEnv`, R-73 M1) are masked, a junction is a link and is not
 * followed, the state directory is apart, and the protected paths mark entries. Names with the
 * shape of a key and registered values are fake values built at run time.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createHostHandler } from "../../src/engine-host/host.js";
import { taskForm } from "../../src/engine-host/runs.js";
import { TREE_PAGE_SIZE, createTreeLister, treeValue } from "../../src/engine-host/tree.js";
import type { TreeApp, TreeResult } from "../../src/engine-host/tree.js";
import { fakeApp } from "./fake-app.js";
import { parseHostMessage } from "../../src/shared/protocol.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const ENGINE_DIR = path.join(GUI, "..", "dist", "src");
const ENGINE_BUILT = existsSync(path.join(ENGINE_DIR, "app", "index.js"));
const KEY_SHAPED = ["sk", "ant", "FAKE".repeat(10)].join("-");
const REGISTERED = "fake-registered-VALUE-u103";
const listed = (entries: unknown[], extra: Record<string, unknown> = {}) => ({
  ok: true,
  output: { kind: "workspace_dir", status: "listed", masking: "current_secrets", entries, total: entries.length, offset: 0, nextOffset: null, ...extra },
});
const plain = (name: string, kind = "file", marked = false) => ({ name, shown: name, kind, masked: false, protected: marked });

test("U-103: the tree value takes the app layer's listing field by field; a masked entry has no name", () => {
  assert.deepEqual(treeValue(listed([plain("sub", "dir", true), { name: null, shown: "[key].txt", kind: "file", masked: true, protected: false }])), {
    ok: true,
    entries: [
      { name: "sub", shown: "sub", kind: "dir", masked: false, protected: true },
      { name: null, shown: "[key].txt", kind: "file", masked: true, protected: false },
    ],
    total: 2,
    offset: 0,
    nextOffset: null,
  });
  for (const status of ["not_found", "not_dir", "too_large", "refused", "unreadable"]) {
    assert.deepEqual(treeValue({ ok: true, output: { kind: "workspace_dir", status } }), { ok: false, code: status });
  }
  assert.deepEqual(treeValue({ ok: false, error: { code: "invalid_config", message: "x" } }), { ok: false, code: "invalid_config" });
  assert.deepEqual(treeValue({ ok: false, error: { code: "Not A Code" } }), { ok: false, code: "host_error" });
  const bad: unknown[] = [
    null,
    { ok: true, output: { kind: "other", status: "listed" } },
    listed([plain("a")], { masking: "none" }),
    listed([{ ...plain("a"), masked: true }]),
    listed([{ name: "real", shown: "[key]", kind: "file", masked: true, protected: false }]),
    listed([{ name: "real", shown: "shown", kind: "file", masked: false, protected: false }]),
    listed([{ name: null, shown: "x", kind: "file", masked: false, protected: false }]),
    listed([{ ...plain("a"), kind: "socket" }]),
    listed([{ ...plain("a"), protected: "yes" }]),
    listed([plain("a")], { total: -1 }),
    listed(Array.from({ length: TREE_PAGE_SIZE + 1 }, (_v, i) => plain(`f${i}`))),
  ];
  for (const value of bad) assert.deepEqual(treeValue(value), { ok: false, code: "host_error" }, JSON.stringify(value).slice(0, 120));
});

test("U-103: the lister asks the app layer with the open workspace and the config file's defaults; a throw is host_error", async () => {
  const asked: unknown[] = [];
  const app: TreeApp = {
    async listWorkspaceDir(request) {
      asked.push(request);
      return listed([plain("a.txt")]);
    },
  };
  const list = createTreeLister(app, (workspace) => taskForm(workspace, null, null));
  const result = await list({ workspace: "C:\\ws", dir: "sub", offset: 500 });
  assert.equal(result.ok, true);
  assert.deepEqual(asked, [{ settings: { input: { kind: "workspace", workspace: "C:\\ws" }, configPath: null, varsFile: null, profile: null, workflowRef: null }, dir: "sub", offset: 500 }]);
  const throwing = createTreeLister({ listWorkspaceDir: async () => Promise.reject(new Error("boom")) }, (workspace) => taskForm(workspace, null, null));
  assert.deepEqual(await throwing({ workspace: "C:\\ws", dir: "", offset: 0 }), { ok: false, code: "host_error" });
});

interface AppModule {
  createNodeAppEnvironment(): Promise<unknown>;
  createCodarynApp(environment: unknown): TreeApp;
}

/** The real app layer with `env` set for its environment until `restore`. */
async function realLister(env: Record<string, string>): Promise<{ list: (dir: string, workspace: string) => Promise<TreeResult>; restore: () => void }> {
  const module = (await import(pathToFileURL(path.join(ENGINE_DIR, "app", "index.js")).href)) as AppModule;
  const before = new Map(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
  const restore = (): void => {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  const app = module.createCodarynApp(await module.createNodeAppEnvironment());
  const lister = createTreeLister(app, (workspace) => taskForm(workspace, null, null));
  return { list: (dir, workspace) => lister({ workspace, dir, offset: 0 }), restore };
}

test("U-103: with the real app layer, key shapes and registered values are masked without a name, links are not followed, protected paths mark", { skip: !ENGINE_BUILT && "the engine is not built" }, async (t) => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gui-u103-")));
  let restoreEnv = (): void => undefined;
  try {
    const root = path.join(base, "ws");
    await fs.mkdir(path.join(root, "sub", "deeper"), { recursive: true });
    await fs.mkdir(path.join(root, ".codaryn", "runs"), { recursive: true });
    await fs.mkdir(path.join(base, "outside"));
    await fs.writeFile(path.join(root, "a.txt"), "a");
    await fs.writeFile(path.join(root, `${KEY_SHAPED}.txt`), "k");
    await fs.writeFile(path.join(root, `note-${REGISTERED}.txt`), "r");
    await fs.writeFile(path.join(root, "sub", "b.txt"), "b");
    let junction = true;
    try {
      await fs.symlink(path.join(base, "outside"), path.join(root, "jump"), "junction");
    } catch {
      junction = false;
    }
    const config = path.join(base, "config.json");
    await fs.writeFile(
      config,
      JSON.stringify({ schemaVersion: 1, secretEnv: ["CODARYN_U103_SECRET"], policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, protectedPaths: ["sub"] } }),
    );
    const real = await realLister({ CODARYN_CONFIG: config, CODARYN_U103_SECRET: REGISTERED, APPDATA: path.join(base, "appdata"), XDG_CONFIG_HOME: path.join(base, "xdg") });
    restoreEnv = real.restore;
    const list = real.list;
    const top = await list("", root);
    assert.ok(top.ok, JSON.stringify(top));
    if (!top.ok) return;
    const text = JSON.stringify(top);
    assert.equal(text.includes(KEY_SHAPED), false, "no key shape");
    assert.equal(text.includes(REGISTERED), false, "R-73 M1: a value the settings register is masked too");
    const masked = top.entries.filter((entry) => entry.masked);
    assert.equal(masked.length, 2);
    assert.ok(masked.every((entry) => entry.name === null), "a masked entry has no real name");
    const byName = (name: string) => top.entries.find((entry) => entry.name === name);
    assert.deepEqual(byName(".codaryn")?.kind, "state");
    assert.deepEqual(byName("sub"), { name: "sub", shown: "sub", kind: "dir", masked: false, protected: true });
    assert.equal(byName("a.txt")?.protected, false);
    const firstOther = top.entries.findIndex((entry) => entry.kind !== "dir" && entry.kind !== "state");
    assert.ok(firstOther > 0 && top.entries.slice(firstOther).every((entry) => entry.kind !== "dir" && entry.kind !== "state"), "folders first");
    assert.deepEqual(await list(".codaryn", root), { ok: false, code: "refused" });
    assert.deepEqual(await list("missing", root), { ok: false, code: "not_found" });
    assert.deepEqual(await list("a.txt", root), { ok: false, code: "not_dir" });
    const sub = await list("sub", root);
    assert.ok(sub.ok && sub.entries.some((entry) => entry.name === "b.txt" && entry.protected), "below a protected folder, protected too");
    if (!junction) {
      t.diagnostic("junctions cannot be made here; the link case is skipped");
      return;
    }
    assert.equal(byName("jump")?.kind, "link");
    assert.deepEqual(await list("jump", root), { ok: false, code: "refused" }, "a link is never followed");
  } finally {
    restoreEnv();
    await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("tree: the host checks the call's arguments before listing", async () => {
  const requests: unknown[] = [];
  const written: unknown[] = [];
  const handler = createHostHandler({
    app: fakeApp(),
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
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
