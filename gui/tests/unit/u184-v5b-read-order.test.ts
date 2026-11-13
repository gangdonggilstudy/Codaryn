/**
 * U-184 after Codex V-5b M-3 (verify-V5b-u184.md): a read that comes back after a newer one began
 * (read again, or another file) is dropped, so only the newest read builds the text; a save from that
 * text is then the current view's, and its reply is shown (saved, the next token, no unsaved mark).
 * Before the fix the late first read built the text, and a save from it stayed at "Saving." with the
 * edit still unsaved.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { textScreen } from "../../src/renderer/text/text-screen.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const HANDLE = "0123456789abcdef0123456789abcdef";
const NODE = "a".repeat(32);

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const opened = (token: string) => ({ ok: true, opened: true, text: "base\n", masked: false, protected: false, editable: true, readOnlyReasons: [], lines: 2, editToken: token });

test("V-5b M-3: reads that come back in reverse order: the late first one is dropped, and a save from the shown text completes", async () => {
  const restore = installFakeDom();
  try {
    const reads = [deferred<unknown>(), deferred<unknown>()];
    let readIndex = 0;
    const calls: unknown[][] = [];
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async (...args: unknown[]) => {
        calls.push([name, ...args]);
        if (name === "openText") return reads[readIndex++]?.promise;
        if (name === "saveText") return { ok: true, saved: true, unchanged: false, lockLeft: false, editToken: "3".repeat(32) };
        return true;
      },
    });
    const root = new FakeElement("main");
    const screen = textScreen({ texts: textsFor("en"), api, current: () => ({ handle: HANDLE, name: "ws" }), back: () => undefined });
    const byId = (id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];
    screen.choose({ node: NODE, name: "a.txt" }, "home");
    screen.show(root as unknown as HTMLElement);
    await settle();
    byId("text-reload")?.click(); // a second read before the first came back
    await settle();
    reads[1]?.resolve(opened("2".repeat(32))); // the newer read first
    await settle();
    reads[0]?.resolve(opened("1".repeat(32))); // then the older one, late
    await settle();
    const area = byId("text-content");
    assert.ok(area);
    area.value = "committed\n";
    area.dispatch("input");
    byId("text-save")?.click();
    await settle();
    assert.deepEqual(calls.filter((c) => c[0] === "saveText")[0], ["saveText", "2".repeat(32), "committed\n"], "the newest read's token");
    assert.equal(byId("text-result")?.textContent, EN["text.saved"], "the save is shown done");
    assert.equal(screen.dirty, false);
    assert.deepEqual(calls.filter((c) => c[0] === "textDirty").at(-1), ["textDirty", false]);
    assert.equal(byId("text-content")?.hasAttribute("readonly"), false, "editable again (not stuck saving)");
  } finally {
    restore();
  }
});
