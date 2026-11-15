/**
 * U-184 after Codex V-5 (verify-V5-u184.md): the reproductions as tests.
 * - M-1: a reset (settings written drop every tree id and edit token) holds for requests already
 *   under way. A: a save waiting for the person's answer when the token is dropped writes nothing.
 *   B, C: an open whose read comes back after the reset gives no text and no token (the read was
 *   masked with the values registered before). A write already asked of the host is told as it ended:
 *   saved, with no next token.
 * - M-2: a late save reply for the file before does not touch the file now open (its unsaved mark,
 *   what the main process is told, whether leaving asks).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createTextFiles } from "../../src/main/text-files.js";
import { TextEdits } from "../../src/main/text-edits.js";
import { TreeIds } from "../../src/main/tree-ids.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { textScreen } from "../../src/renderer/text/text-screen.js";
import type { HostCall, HostResponse } from "../../src/shared/protocol.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const HANDLE = "0123456789abcdef0123456789abcdef";
const ROOT = process.platform === "win32" ? "C:\\ws" : "/ws";
const DIGEST = "ab".repeat(32);
const NEW_DIGEST = "cd".repeat(32);

/** A promise and its resolver: the test decides when a wait ends. */
function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const readValue = (text: string) => ({ ok: true, status: "opened", text, masked: false, protected: false, lineEnding: "lf", bom: false, digest: DIGEST, bytes: text.length, editable: true, readOnlyReasons: [] });
const writtenValue = { ok: true, status: "written", digest: NEW_DIGEST, readOnlyReasons: [], textProblems: [], lockLeft: false };

interface Harness {
  readonly files: ReturnType<typeof createTextFiles>;
  readonly edits: TextEdits;
  readonly treeIds: TreeIds;
  readonly calls: { name: HostCall; args: unknown }[];
  /** The host's next answer per call name (a deferred one waits for the test). */
  readonly answers: Map<HostCall, Promise<unknown>>;
  confirm: () => Promise<boolean>;
  /** What a settings write does in the main process: every tree id and edit token goes (dropTreeIds). */
  reset(): void;
}

function harness(): Harness {
  let n = 0;
  const bytes = (size: number): Uint8Array => {
    n += 1;
    return Uint8Array.from({ length: size }, (_v, i) => (i === 0 ? (n >> 8) & 0xff : i === 1 ? n & 0xff : 7));
  };
  const edits = new TextEdits(bytes);
  const treeIds = new TreeIds(bytes);
  const calls: { name: HostCall; args: unknown }[] = [];
  const answers = new Map<HostCall, Promise<unknown>>();
  const h: Harness = {
    edits,
    treeIds,
    calls,
    answers,
    confirm: async () => true,
    reset() {
      treeIds.clear();
      edits.clear();
    },
    files: createTextFiles({
      workspaces: { path: (handle) => (handle === HANDLE ? ROOT : null), treeIds },
      edits,
      host: async () => ({
        host: {
          call: async (name: HostCall, args: unknown): Promise<HostResponse> => {
            calls.push({ name, args });
            const value = await (answers.get(name) ?? Promise.resolve(name === "writeText" ? writtenValue : readValue("now\n")));
            return { v: 1, id: calls.length, ok: true, value };
          },
        },
      }),
      confirm: () => h.confirm(),
      timeoutMs: 1000,
    }),
  };
  return h;
}

test("V-5 M-1 A: a save waiting for the person's answer when the token is dropped writes nothing", async () => {
  const h = harness();
  const id = h.treeIds.issue(HANDLE, "a.txt");
  const opened = await h.files.open([{ workspace: HANDLE, node: id }]);
  assert.ok(opened.ok && opened.opened && opened.editToken !== null);
  const token = opened.ok && opened.opened ? (opened.editToken as string) : "";
  const answer = deferred<boolean>();
  h.confirm = () => answer.promise;
  const saving = h.files.save([{ token, text: "saved-after-reset\n" }]);
  await settle();
  h.reset(); // settings written while the person is asked
  answer.resolve(true);
  assert.deepEqual(await saving, { ok: false, code: "unknown_entry" });
  assert.equal(h.calls.filter((c) => c.name === "writeText").length, 0, "no write asked of the host");
});

test("V-5 M-1 B and C: an open whose read comes back after the reset gives no text and no token", async () => {
  const h = harness();
  const id = h.treeIds.issue(HANDLE, "a.txt");
  const read = deferred<unknown>();
  h.answers.set("readText", read.promise);
  const opening = h.files.open([{ workspace: HANDLE, node: id }]);
  await settle();
  h.reset(); // the read was masked with the values registered before the settings changed
  read.resolve(readValue("private-synthetic-name\n"));
  const reply = await opening;
  assert.deepEqual(reply, { ok: false, code: "unknown_entry" }, "the text from before the reset never reaches the page");
  // No token was issued: nothing can be saved with one.
  const fresh = h.treeIds.issue(HANDLE, "a.txt");
  h.answers.delete("readText");
  const again = await h.files.open([{ workspace: HANDLE, node: fresh }]);
  assert.ok(again.ok && again.opened, "a new id reads the file anew");
});

test("V-5 M-1: a write already asked of the host is told as it ended: saved, with no next token", async () => {
  const h = harness();
  const id = h.treeIds.issue(HANDLE, "a.txt");
  const opened = await h.files.open([{ workspace: HANDLE, node: id }]);
  const token = opened.ok && opened.opened ? (opened.editToken as string) : "";
  const write = deferred<unknown>();
  h.answers.set("writeText", write.promise);
  const saving = h.files.save([{ token, text: "written\n" }]);
  await settle();
  assert.equal(h.calls.filter((c) => c.name === "writeText").length, 1, "the write was asked before the reset");
  h.reset();
  write.resolve(writtenValue);
  assert.deepEqual(await saving, { ok: true, saved: true, unchanged: false, lockLeft: false, editToken: null });
});

test("V-5 M-1: without a reset the save goes on as before, and the next token stands for the file as written", async () => {
  const h = harness();
  const id = h.treeIds.issue(HANDLE, "a.txt");
  const opened = await h.files.open([{ workspace: HANDLE, node: id }]);
  const token = opened.ok && opened.opened ? (opened.editToken as string) : "";
  const saved = await h.files.save([{ token, text: "next\n" }]);
  assert.ok(saved.ok && saved.saved && typeof saved.editToken === "string");
  assert.deepEqual(h.calls.at(-1), { name: "writeText", args: { workspace: ROOT, path: "a.txt", text: "next\n", baseDigest: DIGEST } });
  assert.equal(h.edits.get(saved.ok && saved.saved ? saved.editToken : null)?.digest, NEW_DIGEST);
});

test("V-5 M-2: a late save reply for the file before leaves the file now open unsaved, and leaving still asks", async () => {
  const restore = installFakeDom();
  try {
    const calls: unknown[][] = [];
    const saveA = deferred<unknown>();
    const files: Record<string, unknown> = {
      ["a".repeat(32)]: { ok: true, opened: true, text: "A", masked: false, protected: false, editable: true, readOnlyReasons: [], lines: 1, editToken: "1".repeat(32) },
      ["b".repeat(32)]: { ok: true, opened: true, text: "B", masked: false, protected: false, editable: true, readOnlyReasons: [], lines: 1, editToken: "2".repeat(32) },
    };
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async (...args: unknown[]) => {
        calls.push([name, ...args]);
        if (name === "openText") return files[args[1] as string];
        if (name === "saveText") return saveA.promise;
        return true;
      },
    });
    const back: string[] = [];
    const root = new FakeElement("main");
    const screen = textScreen({ texts: textsFor("en"), api, current: () => ({ handle: HANDLE, name: "ws" }), back: (id) => back.push(id) });
    const byId = (id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];
    const type = (text: string): void => {
      const area = byId("text-content");
      assert.ok(area);
      area.value = text;
      area.dispatch("input");
    };
    screen.choose({ node: "a".repeat(32), name: "a.txt" }, "home");
    screen.show(root as unknown as HTMLElement);
    await settle();
    type("A changed");
    byId("text-save")?.click(); // A's save is under way
    await settle();
    // B chosen; A's unsaved edit let go; B shown.
    assert.equal(screen.choose({ node: "b".repeat(32), name: "b.txt" }, "text"), false);
    byId("text-leave-discard")?.click();
    assert.deepEqual(back, ["text"]);
    screen.show(root as unknown as HTMLElement);
    await settle();
    type("unsaved B");
    assert.equal(screen.dirty, true);
    // A's reply comes now.
    saveA.resolve({ ok: true, saved: true, unchanged: false, lockLeft: false, editToken: "3".repeat(32) });
    await settle();
    assert.equal(byId("text-content")?.value, "unsaved B");
    assert.equal(screen.dirty, true, "B is still unsaved");
    assert.deepEqual(calls.filter((c) => c[0] === "textDirty").at(-1), ["textDirty", true], "the main process is still told so (closing asks)");
    assert.equal(screen.leave("home"), false, "leaving still asks");
    assert.notEqual(byId("text-result")?.textContent, EN["text.saved"], "A's result is not shown on B");
  } finally {
    restore();
  }
});

test("V-5 M-1: a saved reply with no next token leaves the view read only and says to open it again", async () => {
  const restore = installFakeDom();
  try {
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async () => {
        if (name === "openText") return { ok: true, opened: true, text: "A", masked: false, protected: false, editable: true, readOnlyReasons: [], lines: 1, editToken: "1".repeat(32) };
        if (name === "saveText") return { ok: true, saved: true, unchanged: false, lockLeft: false, editToken: null };
        return true;
      },
    });
    const root = new FakeElement("main");
    const screen = textScreen({ texts: textsFor("en"), api, current: () => ({ handle: HANDLE, name: "ws" }), back: () => undefined });
    screen.choose({ node: "a".repeat(32), name: "a.txt" }, "home");
    screen.show(root as unknown as HTMLElement);
    await settle();
    const area = root.findAll((e) => e.getAttribute("id") === "text-content")[0];
    assert.ok(area);
    area.value = "A changed";
    area.dispatch("input");
    root.findAll((e) => e.getAttribute("id") === "text-save")[0]?.click();
    await settle();
    assert.equal(root.findAll((e) => e.getAttribute("id") === "text-saved-reopen")[0]?.textContent, EN["text.savedReopen"]);
    assert.equal(area.hasAttribute("readonly"), true);
    assert.equal(screen.dirty, false);
  } finally {
    restore();
  }
});
