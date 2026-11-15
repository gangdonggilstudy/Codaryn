/**
 * U-103 (G-list; docs/design/standalone-gui.md 3.3, 6.4; adapter-contract 5.12): the file tree is
 * the app layer's workspace list. A masked entry comes without its real name, so the main process
 * gives it no id: it cannot be opened, shown in the folder or copied. "Copy relative path" copies a
 * plain entry's path, which the main process resolves from the entry's id and checks again.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Workspaces } from "../../src/main/workspaces.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { TreeView } from "../../src/renderer/workspace/tree-view.js";
import { IPC_CHANNELS, MAX_COPY_PATH_CHARS, copyablePath } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const HANDLE = "0123456789abcdef0123456789abcdef";

test("U-103: a copied path is plain '/'-separated segments of shown names, with no hidden character", () => {
  for (const ok of ["a.txt", "sub/b.txt", "문서/회의록 2026-11.md", "a b/c-d_e.txt", "x".repeat(MAX_COPY_PATH_CHARS)]) assert.equal(copyablePath(ok), ok, ok.slice(0, 40));
  const refused: unknown[] = [
    "",
    "../x",
    "./a",
    "a//b",
    "a/",
    "/a",
    "a\\b",
    "C:x",
    "a\u0007b",
    "a\nb",
    "a​b",
    "a‮b",
    "a﻿b",
    "x".repeat(MAX_COPY_PATH_CHARS + 1),
    12,
    null,
  ];
  for (const value of refused) assert.equal(copyablePath(value), null, JSON.stringify(value)?.slice(0, 40));
  assert.equal(IPC_CHANNELS.copyPath, "codaryn:workspace:copypath");
});

test("U-103: the main process issues ids for plain entries only; an id resolves to the path copyPath copies", () => {
  let n = 0;
  const workspaces = new Workspaces({ stateFile: null, platform: "win32", randomBytes: (size) => Uint8Array.from({ length: size }, (_v, i) => (n++ * 17 + i) & 0xff), now: () => new Date(), isDirectory: async () => true });
  const reply = workspaces.treeReply(HANDLE, "sub", {
    ok: true,
    entries: [
      { name: "b.txt", shown: "b.txt", kind: "file", masked: false, protected: false },
      { name: null, shown: "[key].txt", kind: "file", masked: true, protected: false },
      { name: "deeper", shown: "deeper", kind: "dir", masked: false, protected: true },
    ],
    total: 3,
    offset: 0,
    nextOffset: null,
  });
  assert.ok(reply.ok);
  if (!reply.ok) return;
  const [plain, masked, folder] = reply.entries;
  assert.equal(masked?.id, null, "a masked entry has no id: nothing to open, show or copy");
  assert.equal(masked?.name, "[key].txt");
  const file = workspaces.treeIds.resolve(HANDLE, plain?.id);
  assert.equal(file, "sub/b.txt");
  assert.equal(copyablePath(file), "sub/b.txt");
  assert.equal(copyablePath(workspaces.treeIds.resolve(HANDLE, folder?.id)), "sub/deeper");
  assert.equal(workspaces.treeIds.resolve("f".repeat(32), plain?.id), null, "an id belongs to its workspace");
  assert.deepEqual([plain?.protected, masked?.protected, folder?.protected], [false, false, true], "U-65: the app layer's mark is passed on");
});

test("U-103: the tree's copy button copies the focused plain entry by its id and says so; a masked entry cannot be copied", async () => {
  const restore = installFakeDom();
  try {
    const copied: [string, string][] = [];
    const id = (k: number): string => k.toString(16).padStart(32, "0");
    const api = {
      async tree() {
        return {
          ok: true,
          entries: [
            { id: id(1), name: "a.txt", kind: "file", masked: false },
            { id: null, name: "[key].txt", kind: "file", masked: true },
          ],
          total: 2,
          offset: 0,
          nextOffset: null,
        };
      },
      async copyPath(workspace: string, node: string) {
        copied.push([workspace, node]);
        return copied.length === 1 ? { ok: true } : { ok: false, code: "unknown_entry" };
      },
    } as unknown as CodarynApi;
    const panel = new FakeElement("aside");
    const tree = new TreeView(textsFor("en"), api, panel as unknown as HTMLElement);
    const byId = (key: string): FakeElement | undefined => panel.findAll((e) => e.getAttribute("id") === key)[0];
    const row = (name: string): FakeElement | undefined => panel.findAll((e) => e.getAttribute("role") === "treeitem" && (e.children[1]?.textContent ?? "").startsWith(name))[0];
    tree.setWorkspace({ handle: HANDLE, name: "ws" });
    await settle();
    assert.equal(byId("tree-copy-path")?.textContent, "Copy relative path");
    row("a.txt")?.click();
    assert.equal(byId("tree-copy-path")?.hasAttribute("disabled"), false);
    byId("tree-copy-path")?.click();
    await settle();
    assert.deepEqual(copied, [[HANDLE, id(1)]]);
    assert.equal(byId("tree-copy-status")?.getAttribute("data-copied"), "ok");
    assert.equal(byId("tree-copy-status")?.textContent, "Copied.");
    byId("tree-copy-path")?.click();
    await settle();
    assert.equal(byId("tree-copy-status")?.getAttribute("data-copied"), "unknown_entry", "a refusal says why");
    row("[key].txt")?.click();
    assert.equal(byId("tree-copy-path")?.hasAttribute("disabled"), true, "a masked entry: no id, no copy");
    assert.equal(byId("tree-reveal")?.hasAttribute("disabled"), true);
    for (const language of ["ko", "en"] as const) assert.ok(textsFor(language).has("copy.path"), language);
  } finally {
    restore();
  }
});
