/**
 * U-62 (docs/design/standalone-gui.md 6.4, 2 principle 4; 3.7, 3.8, 3.9, 3.3): copying. The page
 * never writes the clipboard; it asks the main process, which takes one line of masked text only
 * (length, no control, line, format, direction or invisible character) and has the engine host check
 * that its own hiding (key shapes, every key value now set) leaves the text as it is. A tree entry's
 * path is copied by its id. The run id (the result, the run list, the report), the digest's first
 * 12 characters (the plan) and a file's relative path (the tree) have copy buttons.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { copyControl } from "../../src/renderer/shell/copy.js";
import { MAX_COPY_CHARS, copyableText, parseCopyArgs, toCopyCheck } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

/** A fake key value the host hides (as it hides every key value now set); not a real key. */
const FAKE = ["fake", "value", "u62"].join("-");

test("U-62: the main process takes one line of text only, within its length", () => {
  for (const text of ["20261113T010203Z-0000abcd", "0123456789ab", "sub/b.txt", "회의록/2026 메모.md", "x".repeat(MAX_COPY_CHARS)]) assert.equal(copyableText(text), text, text);
  const refused = ["", "x".repeat(MAX_COPY_CHARS + 1), "a\nb", "a\tb", "a\rb", "a\u0007b", "a\u001bb", "a\u0085b", "a\u200bb", "a\u200eb", "a\u202eb", "a\u2028b", "a\u2066b", "a\u00adb", "a\ufeffb", "a\u061cb"];
  for (const text of refused) assert.equal(copyableText(text), null, JSON.stringify(text));
  assert.equal(copyableText(12), null);
  assert.equal(parseCopyArgs({ text: "ok" }), "ok");
  assert.equal(parseCopyArgs({ text: "ok", path: "C:/x" }), null, "nothing else rides along");
  assert.equal(parseCopyArgs("ok"), null);
  assert.equal(toCopyCheck({ ok: true, clean: true }), true);
  for (const value of [{ ok: true, clean: false }, { ok: true }, { clean: true }, null]) assert.equal(toCopyCheck(value), false, JSON.stringify(value));
});

test("U-62: the engine host says whether its hiding leaves the text as it is", async () => {
  const written: HostMessage[] = [];
  const handler = createHostHandler({
    app: fakeApp({}),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => text.replace(/[\u0000-\u001f]/g, "?").split(FAKE).join("[key]"),
    providers: [],
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
  });
  const call = async (id: number, args: unknown): Promise<unknown> => {
    await handler.handleLine(JSON.stringify({ v: 1, id, call: "copyCheck", args }));
    const message = written.find((m) => "id" in m && m.id === id) as { ok: boolean; value?: unknown; error?: { code: string } };
    return message.ok ? message.value : message.error?.code;
  };
  assert.deepEqual(await call(1, { text: "20261113T010203Z-0000abcd" }), { ok: true, clean: true });
  assert.deepEqual(await call(2, { text: `the key ${FAKE}` }), { ok: true, clean: false }, "a key value now set");
  assert.equal(await call(3, { text: "a\u0007b" }), "invalid_args", "not one line");
  assert.equal(await call(4, { text: "ok", more: 1 }), "invalid_args");
});

test("U-62: a copy button asks the main process and says what came of it", async () => {
  const restore = installFakeDom();
  try {
    const asked: string[] = [];
    const replies: unknown[] = [{ ok: true }, { ok: false, code: "not_copyable" }];
    const box = copyControl(textsFor("en"), "Copy run id", async () => {
      asked.push("copy");
      return replies.shift();
    }, { id: "x-copy" }) as unknown as FakeElement;
    const control = box.findAll((e) => e.getAttribute("id") === "x-copy")[0];
    const status = box.findAll((e) => e.getAttribute("role") === "status")[0];
    control?.click();
    await settle();
    assert.equal(status?.getAttribute("data-copied"), "ok");
    assert.equal(status?.textContent, "Copied.");
    control?.click();
    await settle();
    assert.equal(status?.getAttribute("data-copied"), "not_copyable");
    assert.ok(status?.textContent.includes("not_copyable"));
    assert.deepEqual(asked, ["copy", "copy"]);
  } finally {
    restore();
  }
});

test("U-62: the screens copy the run id, the digest's first 12 and a tree entry by its id", async () => {
  const restore = installFakeDom();
  try {
    const copiedText: string[] = [];
    const copiedPath: unknown[][] = [];
    const RUN = "20261113T060000Z-0000a062";
    const DIGEST = "0123456789abcdef".padEnd(64, "e");
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async (...args: unknown[]) => {
        if (name === "copyText") {
          copiedText.push(String(args[0]));
          return { ok: true };
        }
        if (name === "copyPath") {
          copiedPath.push(args);
          return { ok: true };
        }
        if (name === "listRuns") return { ok: true, runs: [{ state: "checked", runId: RUN, kind: "run", startedAt: null, taskId: "t", status: "done", reason: "verified", changes: 0, reverted: null, revertRecordDamaged: false }], omitted: 0 };
        if (name === "plan") return { ok: true, view: { runId: RUN, status: "pending", digest: DIGEST, actions: [{ kind: "move", from: "a", to: "b" }], inventoryLimitReached: false, appliedBy: null }, approval: null };
        if (name === "tree") return { ok: true, entries: [{ id: "f".repeat(32), name: "a.txt", kind: "file" }], next: null };
        return null;
      },
    });
    const { runsScreen } = await import("../../src/renderer/runs/runs-screen.js");
    const { planScreen } = await import("../../src/renderer/plan/plan-screen.js");
    const { RunModel } = await import("../../src/renderer/run/run-model.js");
    const workspace = { handle: "1".repeat(32), name: "ws" };
    const runs = runsScreen({ texts: textsFor("en"), api, current: () => workspace, open: () => undefined, announce: () => undefined, openPlan: () => undefined, openChanges: () => undefined, openReport: () => undefined });
    const runsRoot = new FakeElement("main");
    runs.show(runsRoot as unknown as HTMLElement);
    await settle();
    runsRoot.findAll((e) => e.getAttribute("data-copy") === RUN)[0]?.click();
    await settle();
    const plan = planScreen({ texts: textsFor("en"), api, run: new RunModel(), current: () => workspace, showRun: () => undefined });
    plan.choose(RUN, null, null);
    const planRoot = new FakeElement("main");
    plan.show(planRoot as unknown as HTMLElement);
    await settle();
    planRoot.findAll((e) => e.getAttribute("id") === "plan-copy-digest")[0]?.click();
    await settle();
    assert.deepEqual(copiedText, [RUN, DIGEST.slice(0, 12)], "the run id from the list, the digest's first 12 from the plan");
    assert.deepEqual(copiedPath, [], "a path is never sent as text");
  } finally {
    restore();
  }
});
