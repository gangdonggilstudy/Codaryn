/**
 * U-174 (DR-71, DR-72; standalone-gui 3.14, adapter-contract 5.15): the read-only text view. The
 * engine host passes the app layer's readWorkspaceText (U-172) on, field by field, and hides key
 * shapes and control characters once more; the main process checks the value again and keeps the
 * digest, line ending and byte order mark; the page shows the masked text in a read-only textarea
 * and says why the file could not be edited, or why it was not opened.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import { textValue } from "../../src/engine-host/text.js";
import { asText } from "../../src/renderer/api.js";
import { changesScreen } from "../../src/renderer/changes/changes-screen.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { lineAt, lineNumbers, textScreen } from "../../src/renderer/text/text-screen.js";
import { TreeView } from "../../src/renderer/workspace/tree-view.js";
import { IPC_CHANNELS, MAX_TEXT_CHARS, TEXT_NOT_OPENED, TEXT_READ_ONLY_REASONS, toTextReply } from "../../src/shared/ipc.js";
import { HOST_CALLS, parseHostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const HANDLE = "0123456789abcdef0123456789abcdef";
const NODE = "fedcba9876543210fedcba9876543210";
const DIGEST = "ab".repeat(32);
const same = (text: string): string => text;

const opened = (extra: Record<string, unknown> = {}) => ({
  ok: true,
  output: {
    kind: "workspace_text",
    status: "opened",
    path: "notes/a.txt",
    text: "first\nsecond\n",
    masking: "current_secrets",
    masked: false,
    protected: false,
    lineEnding: "crlf",
    bom: true,
    digest: DIGEST,
    bytes: 18,
    editable: true,
    readOnlyReasons: [],
    ...extra,
  },
});

test("U-174: the engine host passes the opened file's fields on, and a file not opened as its status only", () => {
  assert.deepEqual(textValue(opened(), same), {
    ok: true,
    status: "opened",
    text: "first\nsecond\n",
    masked: false,
    protected: false,
    lineEnding: "crlf",
    bom: true,
    digest: DIGEST,
    bytes: 18,
    editable: true,
    readOnlyReasons: [],
  });
  const masked = textValue(opened({ text: "token = [key]\n", masked: true, editable: false, readOnlyReasons: ["masked", "protected"], protected: true }), same);
  assert.ok(masked.ok && masked.status === "opened" && masked.editable === false && masked.masked);
  for (const status of TEXT_NOT_OPENED) {
    assert.deepEqual(textValue({ ok: true, output: { kind: "workspace_text", status, path: "a" } }, same), { ok: true, status }, status);
  }
  assert.deepEqual(textValue({ ok: false, error: { code: "secret_env_missing" } }, same), { ok: false, code: "secret_env_missing" });
});

test("U-174: when the host's own pass changes the text, the window gets that text and the file is not editable", () => {
  const value = textValue(opened(), (text) => text.replace("second", "[key]"));
  assert.ok(value.ok && value.status === "opened");
  if (!(value.ok && value.status === "opened")) return;
  assert.equal(value.text, "first\n[key]\n");
  assert.equal(value.masked, true);
  assert.equal(value.editable, false);
  assert.deepEqual(value.readOnlyReasons, ["masked"]);
});

test("U-174: a value that does not fit the contract is host_error", () => {
  const bad = [
    opened({ editable: true, readOnlyReasons: ["protected"] }),
    opened({ editable: false, readOnlyReasons: [] }),
    opened({ masked: true, editable: false, readOnlyReasons: ["protected"] }),
    opened({ readOnlyReasons: ["unknown"], editable: false }),
    opened({ readOnlyReasons: ["protected", "protected"], editable: false }),
    opened({ digest: "short" }),
    opened({ lineEnding: "cr" }),
    opened({ text: "x".repeat(MAX_TEXT_CHARS + 1) }),
    opened({ masking: "none" }),
    { ok: true, output: { kind: "workspace_dir", status: "listed" } },
    { ok: true, output: { kind: "workspace_text", status: "invented" } },
    null,
  ];
  for (const value of bad) assert.deepEqual(textValue(value, same), { ok: false, code: "host_error" }, JSON.stringify(value).slice(0, 80));
});

test("U-174: the host reads with the tree's form (no profile, no task type) and refuses arguments that do not fit", async () => {
  const asked: unknown[] = [];
  const written: unknown[] = [];
  const handler = createHostHandler({
    app: fakeApp({ readWorkspaceText: async (request) => (asked.push(request), opened()) }),
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: same,
    providers: [],
    write: (line) => written.push(parseHostMessage(line.trimEnd())),
    log: () => undefined,
  });
  const abs = process.platform === "win32" ? "C:\\ws" : "/ws";
  assert.ok((HOST_CALLS as readonly string[]).includes("readText"));
  await handler.handleLine(JSON.stringify({ v: 1, id: 1, call: "readText", args: { workspace: abs, path: "notes/a.txt" } }));
  await handler.handleLine(JSON.stringify({ v: 1, id: 2, call: "readText", args: { workspace: abs, path: "" } }));
  await handler.handleLine(JSON.stringify({ v: 1, id: 3, call: "readText", args: { workspace: "relative", path: "a" } }));
  await handler.handleLine(JSON.stringify({ v: 1, id: 4, call: "readText", args: { workspace: abs, path: "a", extra: 1 } }));
  assert.deepEqual(asked, [{ settings: { input: { kind: "workspace", workspace: abs }, configPath: null, varsFile: null, profile: null, workflowRef: null }, path: "notes/a.txt" }]);
  for (const index of [1, 2, 3]) assert.equal((written[index] as { error?: { code: string } }).error?.code, "invalid_args", `request ${index + 1}`);
  const reply = toTextReply((written[0] as { value: unknown }).value);
  assert.ok(reply.ok && reply.opened);
});

test("U-174: the main process passes the text, the marks and the reasons; never the digest, line ending or byte order mark", () => {
  const reply = toTextReply(textValue(opened(), same));
  // U-184: the token is the main process's to add (toTextReply gives none).
  assert.deepEqual(reply, { ok: true, opened: true, text: "first\nsecond\n", masked: false, protected: false, editable: true, readOnlyReasons: [], lines: 3, editToken: null });
  assert.equal(JSON.stringify(reply).includes(DIGEST), false);
  assert.deepEqual(toTextReply({ ok: true, status: "too_large" }), { ok: true, opened: false, reason: "too_large" });
  assert.deepEqual(toTextReply({ ok: false, code: "unknown_entry" }), { ok: false, code: "unknown_entry" });
  const value = textValue(opened(), same) as Record<string, unknown>;
  const bad: unknown[] = [
    { ...value, text: "line\rcarriage" },
    { ...value, text: "bidi \u202e mark" },
    { ...value, text: "nul \u0000" },
    { ...value, editable: true, readOnlyReasons: ["read_only"] },
    { ...value, masked: true, editable: false, readOnlyReasons: ["protected"] },
    { ...value, digest: "x" },
    { ok: true, status: "too_large", text: "hidden" },
    { ok: true, status: "invented" },
  ];
  for (const item of bad) assert.deepEqual(toTextReply(item), { ok: false, code: "host_error" }, JSON.stringify(item).slice(0, 60));
  // Tabs and line breaks are the file's own and stay.
  assert.ok(toTextReply({ ...value, text: "a\tb\nc" }).ok);
  assert.equal(IPC_CHANNELS.openText, "codaryn:workspace:opentext");
});

test("U-174: the page's parser keeps known reasons only, and an unknown one leaves the file not editable", () => {
  const reply = asText({ ok: true, opened: true, text: "a", masked: false, protected: false, editable: true, readOnlyReasons: ["new_reason"], lines: 1 });
  assert.ok(reply.ok && reply.opened);
  if (!(reply.ok && reply.opened)) return;
  assert.deepEqual(reply.readOnlyReasons, []);
  assert.equal(reply.editable, false);
  assert.deepEqual(asText({ ok: true, opened: false, reason: "not_text" }), { ok: true, opened: false, reason: "not_text" });
  assert.deepEqual(asText({ ok: true, opened: false, reason: "made_up" }), { ok: false, code: "host_error" });
  assert.deepEqual(asText({ ok: false, code: "unknown_entry" }), { ok: false, code: "unknown_entry" });
});

test("U-174: every reason and every status has its words in both languages", () => {
  for (const reason of TEXT_READ_ONLY_REASONS) {
    assert.ok(`text.reason.${reason}` in KO && `text.reason.${reason}` in EN, reason);
  }
  for (const status of TEXT_NOT_OPENED) assert.ok(`text.notOpened.${status}` in KO && `text.notOpened.${status}` in EN, status);
  assert.match(KO["text.reason.masked"], /가린 글/);
  assert.match(EN["text.reason.masked"], /not the file's text/);
});

test("U-174: the cursor's line and the line numbers column", () => {
  assert.equal(lineAt("a\nb\nc", 0), 1);
  assert.equal(lineAt("a\nb\nc", 2), 2);
  assert.equal(lineAt("a\nb\nc", 99), 3);
  assert.equal(lineNumbers(3), "1\n2\n3");
});

function api(reply: unknown, calls: unknown[][] = []): CodarynApi {
  return new Proxy({} as CodarynApi, {
    get: (_target, name: string) => async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return name === "openText" ? reply : name === "reveal" ? true : null;
    },
  });
}

async function shown(reply: unknown, language: "ko" | "en" = "en", calls: unknown[][] = []): Promise<{ root: FakeElement; back: string[] }> {
  const back: string[] = [];
  const screen = textScreen({ texts: textsFor(language), api: api(reply, calls), current: () => ({ handle: HANDLE, name: "ws" }), back: (id) => back.push(id) });
  screen.choose({ node: NODE, name: "notes/a.txt" }, "changes");
  const root = new FakeElement("main");
  screen.show(root as unknown as HTMLElement);
  await settle();
  return { root, back };
}

const byId = (root: FakeElement, id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];

test("U-174: an opened file is a read-only textarea with the text as its value, the reasons in words, and a status line", async () => {
  const restore = installFakeDom();
  try {
    const calls: unknown[][] = [];
    const reply = { ok: true, opened: true, text: "token = [key]\nnext", masked: true, protected: true, editable: false, readOnlyReasons: ["masked", "protected"], lines: 2 };
    const { root, back } = await shown(reply, "en", calls);
    assert.deepEqual(calls[0], ["openText", HANDLE, NODE], "the id only, never a path");
    const view = byId(root, "text");
    assert.equal(view?.getAttribute("data-text-ready"), "opened");
    assert.equal(view?.getAttribute("data-masked"), "true");
    const area = byId(root, "text-content");
    assert.equal(area?.tagName, "textarea");
    assert.equal(area?.value, "token = [key]\nnext");
    assert.equal(area?.hasAttribute("readonly"), true);
    assert.equal(area?.textContent, "", "the text goes in as the value, never as markup or children");
    assert.ok(byId(root, "text-title")?.textContent.includes("notes/a.txt"));
    assert.deepEqual(byId(root, "text-reasons")?.children.map((li) => li.getAttribute("data-reason")), ["masked", "protected"]);
    assert.ok(byId(root, "text-reasons")?.textContent.includes("not the file's text"));
    assert.equal(byId(root, "text-protected")?.textContent, EN["tree.mark.protected"]);
    assert.equal(byId(root, "text-status")?.textContent, "Line 1 of 2");
    // Wrapping is on first: the line numbers column is hidden; off shows it.
    const gutter = root.findAll((e) => e.getAttribute("class") === "text-lines")[0];
    assert.equal(gutter?.hasAttribute("hidden"), true);
    assert.equal(area?.getAttribute("wrap"), "soft");
    const box = byId(root, "text-wrap") as unknown as { checked: boolean; dispatch(type: string): void };
    box.checked = false;
    box.dispatch("change");
    assert.equal(gutter?.hasAttribute("hidden"), false);
    assert.equal(gutter?.textContent, "1\n2");
    assert.equal(area?.getAttribute("wrap"), "off");
    byId(root, "text-reveal")?.click();
    await settle();
    assert.deepEqual(calls.at(-1), ["reveal", HANDLE, NODE]);
    byId(root, "text-close")?.click();
    assert.deepEqual(back, ["changes"]);
  } finally {
    restore();
  }
});

test("U-174: a file not opened shows why and no text; an error shows its code; nothing chosen says how to choose", async () => {
  const restore = installFakeDom();
  try {
    const { root } = await shown({ ok: true, opened: false, reason: "too_large" }, "ko");
    assert.equal(byId(root, "text")?.getAttribute("data-text-ready"), "not_opened");
    assert.equal(byId(root, "text-not-opened")?.textContent, KO["text.notOpened.too_large"]);
    assert.equal(byId(root, "text-content"), undefined, "no text");
    const failed = await shown({ ok: false, code: "unknown_entry" });
    assert.equal(byId(failed.root, "text")?.getAttribute("data-text-ready"), "error");
    assert.ok(failed.root.findAll((e) => e.getAttribute("data-error") === "unknown_entry").length === 1);
    const screen = textScreen({ texts: textsFor("en"), api: api(null), current: () => ({ handle: HANDLE, name: "ws" }), back: () => undefined });
    const empty = new FakeElement("main");
    screen.show(empty as unknown as HTMLElement);
    assert.equal(byId(empty, "text")?.getAttribute("data-text-ready"), "none");
  } finally {
    restore();
  }
});

test("U-174: opening another file from the view keeps the screen to go back to", async () => {
  const restore = installFakeDom();
  try {
    const back: string[] = [];
    const screen = textScreen({ texts: textsFor("en"), api: api({ ok: true, opened: false, reason: "not_text" }), current: () => ({ handle: HANDLE, name: "ws" }), back: (id) => back.push(id) });
    screen.choose({ node: NODE, name: "a" }, "runs");
    screen.choose({ node: NODE, name: "b" }, "text");
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    byId(root, "text-close")?.click();
    assert.deepEqual(back, ["runs"]);
  } finally {
    restore();
  }
});

test("U-174: the tree's Open is for a file with an id; it hands the id and the shown name", async () => {
  const restore = installFakeDom();
  try {
    const opened: string[][] = [];
    const listing = {
      ok: true,
      entries: [
        { id: "1".repeat(32), name: "a.txt", kind: "file", masked: false, protected: false },
        { id: null, name: "[key].txt", kind: "file", masked: true, protected: false },
        { id: "2".repeat(32), name: "sub", kind: "dir", masked: false, protected: false },
      ],
      total: 3,
      offset: 0,
      nextOffset: null,
    };
    const treeApi = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "tree" ? listing : null) });
    const panel = new FakeElement("section");
    const tree = new TreeView(textsFor("en"), treeApi, panel as unknown as HTMLElement, { openText: (node, name) => opened.push([node, name]) });
    tree.setWorkspace({ handle: HANDLE, name: "ws" });
    await settle();
    const open = byId(panel, "tree-open");
    const row = (name: string) => panel.findAll((e) => e.getAttribute("role") === "treeitem" && e.textContent.includes(name))[0];
    row("a.txt")?.click();
    assert.equal(open?.hasAttribute("disabled"), false);
    open?.click();
    assert.deepEqual(opened, [["1".repeat(32), "a.txt"]]);
    row("[key].txt")?.click();
    assert.equal(open?.hasAttribute("disabled"), true, "a masked entry has no id");
    row("sub")?.click();
    assert.equal(open?.hasAttribute("disabled"), true, "a folder is not opened as text");
    // The folder's click lists it: let that finish before the page goes.
    await settle();
  } finally {
    restore();
  }
});

test("U-174: the changes view offers Open this file for a file with an id that is there; it hands the id and the shown path", async () => {
  const restore = installFakeDom();
  try {
    const opened: string[][] = [];
    const base = { created: false, unavailable: null, before: "one\n", after: "two\n" };
    const reply = {
      ok: true,
      runId: "20261113T010203Z-0000abcd",
      recordsChanged: false,
      files: [
        { ...base, path: "notes.md", state: "as_run_left", id: "a".repeat(32) },
        { ...base, path: "gone.md", state: "missing", after: null, id: "b".repeat(32) },
        { ...base, path: "[key].md", state: "unknown", unavailable: "masked_path", before: null, after: null },
      ],
    };
    const changesApi = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "changes" ? reply : null) });
    const screen = changesScreen({ texts: textsFor("en"), api: changesApi, current: () => ({ handle: HANDLE, name: "ws" }), openText: (node, name) => opened.push([node, name]) });
    screen.choose(reply.runId, null, null);
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    const buttons = root.findAll((e) => e.getAttribute("data-open-text") !== null);
    assert.deepEqual(buttons.map((b) => b.getAttribute("data-open-text")), ["0"], "only the file that is there and has an id");
    assert.equal(buttons[0]?.textContent, EN["changes.openText"]);
    buttons[0]?.click();
    assert.deepEqual(opened, [["a".repeat(32), "notes.md"]]);
  } finally {
    restore();
  }
});
