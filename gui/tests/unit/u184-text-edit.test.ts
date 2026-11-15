/**
 * U-184 (DR-72; standalone-gui 3.14, adapter-contract 5.15): editing and saving in the text view.
 * The page sends the main process's edit token and the textarea's text only; the main process asks
 * once per opened file and the app layer judges and writes. Refusals are said in words and the text
 * stays; a run in this window makes the text read only; leaving with an unsaved edit asks first;
 * Ctrl+S does nothing while an input method composes.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import { textWrittenValue } from "../../src/engine-host/text.js";
import { MAX_TEXT_EDITS, TextEdits } from "../../src/main/text-edits.js";
import { DIALOG_TEXTS } from "../../src/main/dialog-texts.js";
import { asSaveText } from "../../src/renderer/api.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { isSaveKey, textScreen } from "../../src/renderer/text/text-screen.js";
import { IPC_CHANNELS, MAX_TEXT_CHARS, TEXT_PROBLEMS, TEXT_SAVE_REFUSALS, parseSaveTextArgs, parseTextDirtyArgs, toSaveOutcome } from "../../src/shared/ipc.js";
import { HOST_CALLS, parseHostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const HANDLE = "0123456789abcdef0123456789abcdef";
const NODE = "fedcba9876543210fedcba9876543210";
const TOKEN = "1".repeat(32);
const NEXT = "2".repeat(32);
const DIGEST = "ab".repeat(32);
const NEW_DIGEST = "cd".repeat(32);

const written = (extra: Record<string, unknown> = {}) => ({
  ok: true,
  output: { kind: "workspace_text_write", status: "written", path: "a.txt", digest: NEW_DIGEST, readOnlyReasons: [], textProblems: [], lockLeft: false, ...extra },
});

test("U-184: the engine host passes the write's status, digest, reasons, problems and lock on, nothing else", () => {
  assert.deepEqual(textWrittenValue(written()), { ok: true, status: "written", digest: NEW_DIGEST, readOnlyReasons: [], textProblems: [], lockLeft: false });
  assert.deepEqual(textWrittenValue(written({ status: "text_refused", digest: null, textProblems: ["masked", "too_large"] })), {
    ok: true,
    status: "text_refused",
    digest: null,
    readOnlyReasons: [],
    textProblems: ["masked", "too_large"],
    lockLeft: false,
  });
  assert.ok(textWrittenValue(written({ status: "path_changed", digest: null, lockLeft: true })).ok);
  assert.deepEqual(textWrittenValue({ ok: false, error: { code: "invalid_arguments" } }), { ok: false, code: "invalid_arguments" });
  for (const bad of [written({ status: "invented" }), written({ digest: "x" }), written({ textProblems: ["other"] }), written({ readOnlyReasons: ["masked", "masked"] }), written({ lockLeft: "no" }), { ok: true, output: { kind: "workspace_text" } }]) {
    assert.deepEqual(textWrittenValue(bad), { ok: false, code: "host_error" }, JSON.stringify(bad).slice(0, 80));
  }
});

test("U-184: the host writes with the tree's form, the path, the text and the base digest; arguments that do not fit are refused", async () => {
  const asked: unknown[] = [];
  const out: unknown[] = [];
  const handler = createHostHandler({
    app: fakeApp({ writeWorkspaceText: async (request) => (asked.push(request), written()) }),
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => text,
    providers: [],
    write: (line) => out.push(parseHostMessage(line.trimEnd())),
    log: () => undefined,
  });
  const abs = process.platform === "win32" ? "C:\\ws" : "/ws";
  assert.ok((HOST_CALLS as readonly string[]).includes("writeText"));
  await handler.handleLine(JSON.stringify({ v: 1, id: 1, call: "writeText", args: { workspace: abs, path: "a.txt", text: "new\n", baseDigest: DIGEST } }));
  await handler.handleLine(JSON.stringify({ v: 1, id: 2, call: "writeText", args: { workspace: abs, path: "a.txt", text: "new", baseDigest: "short" } }));
  await handler.handleLine(JSON.stringify({ v: 1, id: 3, call: "writeText", args: { workspace: abs, path: "a.txt", text: "x".repeat(MAX_TEXT_CHARS + 1), baseDigest: DIGEST } }));
  await handler.handleLine(JSON.stringify({ v: 1, id: 4, call: "writeText", args: { workspace: abs, path: "", text: "x", baseDigest: DIGEST } }));
  assert.deepEqual(asked, [{ settings: { input: { kind: "workspace", workspace: abs }, configPath: null, varsFile: null, profile: null, workflowRef: null }, path: "a.txt", text: "new\n", baseDigest: DIGEST }]);
  for (const index of [1, 2, 3]) assert.equal((out[index] as { error?: { code: string } }).error?.code, "invalid_args", `request ${index + 1}`);
});

test("U-184: the main process takes a save's value only when it fits the contract", () => {
  assert.deepEqual(toSaveOutcome(textWrittenValue(written())), { saved: true, unchanged: false, digest: NEW_DIGEST, lockLeft: false });
  assert.deepEqual(toSaveOutcome(textWrittenValue(written({ status: "unchanged" }))), { saved: true, unchanged: true, digest: NEW_DIGEST, lockLeft: false });
  assert.deepEqual(toSaveOutcome(textWrittenValue(written({ status: "not_editable", digest: null, readOnlyReasons: ["workspace_locked"] }))), {
    ok: true,
    saved: false,
    status: "not_editable",
    readOnlyReasons: ["workspace_locked"],
    textProblems: [],
    lockLeft: false,
  });
  for (const status of TEXT_SAVE_REFUSALS.filter((s) => s !== "not_editable" && s !== "text_refused")) {
    const outcome = toSaveOutcome({ ok: true, status, digest: null, readOnlyReasons: [], textProblems: [], lockLeft: false });
    assert.ok("ok" in outcome && outcome.ok && outcome.saved === false && outcome.status === status, status);
  }
  const bad: unknown[] = [
    { ok: true, status: "written", digest: null, readOnlyReasons: [], textProblems: [], lockLeft: false },
    { ok: true, status: "conflict", digest: NEW_DIGEST, readOnlyReasons: [], textProblems: [], lockLeft: false },
    { ok: true, status: "not_editable", digest: null, readOnlyReasons: [], textProblems: [], lockLeft: false },
    { ok: true, status: "text_refused", digest: null, readOnlyReasons: [], textProblems: [], lockLeft: false },
    { ok: true, status: "conflict", digest: null, readOnlyReasons: ["masked"], textProblems: [], lockLeft: false },
    { ok: true, status: "written", digest: NEW_DIGEST, readOnlyReasons: [], textProblems: ["masked"], lockLeft: false },
    { ok: true, status: "written", digest: NEW_DIGEST, readOnlyReasons: [], textProblems: [] },
  ];
  for (const value of bad) assert.deepEqual(toSaveOutcome(value), { ok: false, code: "host_error" }, JSON.stringify(value));
  assert.deepEqual(toSaveOutcome({ ok: false, code: "host_gone" }), { ok: false, code: "host_gone" });
});

test("U-184: the page's save arguments are a token and a well-formed text; the dirty flag a boolean", () => {
  assert.deepEqual(parseSaveTextArgs({ token: TOKEN, text: "a\nb" }), { token: TOKEN, text: "a\nb" });
  assert.deepEqual(parseSaveTextArgs({ token: TOKEN, text: "😀" }), { token: TOKEN, text: "😀" });
  for (const bad of [{ token: TOKEN, text: "\ud800" }, { token: TOKEN, text: "x\udc00" }, { token: "C:\\a.txt", text: "x" }, { token: TOKEN, text: 3 }, { token: TOKEN, text: "x", path: "a.txt" }, null]) {
    assert.equal(parseSaveTextArgs(bad), null, JSON.stringify(bad));
  }
  assert.equal(parseTextDirtyArgs({ dirty: true }), true);
  assert.equal(parseTextDirtyArgs({ dirty: "yes" }), null);
  assert.equal(IPC_CHANNELS.saveText, "codaryn:workspace:savetext");
  assert.equal(IPC_CHANNELS.textDirty, "codaryn:workspace:textdirty");
});

test("U-184: edit tokens: one per opened file, the agreement kept over a save, a new token per save, all dropped on clear", () => {
  // A different token every call (a counter in the first two bytes).
  let n = 0;
  const edits = new TextEdits((size) => {
    n += 1;
    return Uint8Array.from({ length: size }, (_v, i) => (i === 0 ? (n >> 8) & 0xff : i === 1 ? n & 0xff : 0));
  });
  const token = edits.issue(HANDLE, "a.txt", DIGEST);
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.deepEqual(edits.get(token), { workspace: HANDLE, path: "a.txt", digest: DIGEST, confirmed: false });
  edits.confirm(token);
  assert.equal(edits.begin(token), true);
  assert.equal(edits.begin(token), false, "one save of a file at a time");
  edits.end(token);
  const next = edits.replace(token, NEW_DIGEST);
  assert.ok(next !== null && next !== token);
  assert.equal(edits.get(token), null, "the old token goes");
  assert.deepEqual(edits.get(next), { workspace: HANDLE, path: "a.txt", digest: NEW_DIGEST, confirmed: true }, "asked once per opened file");
  for (let i = 0; i < MAX_TEXT_EDITS + 3; i += 1) edits.issue(HANDLE, `f${i}.txt`, DIGEST);
  assert.equal(edits.get(next), null, "the oldest go first");
  edits.clear();
  assert.equal(edits.get(next), null);
});

test("U-184: the main process's dialog texts: no path, in both languages, default not saving", () => {
  for (const language of ["ko", "en"] as const) {
    const texts = DIALOG_TEXTS[language];
    for (const id of ["textSave.message", "textSave.detail", "textSave.confirm", "textSave.keep", "textClose.message", "textClose.detail", "textClose.discard", "textClose.keep"] as const) {
      assert.ok(texts[id].length > 0, `${language} ${id}`);
      assert.doesNotMatch(texts[id], /\{[a-zA-Z]+\}/, `${language} ${id}: no value put in (never a path)`);
    }
  }
  assert.match(DIALOG_TEXTS.ko["textSave.detail"], /되돌리기/);
  assert.match(DIALOG_TEXTS.en["textSave.detail"], /revert/);
});

test("U-184: every refusal, problem and new word has its text in both languages", () => {
  for (const status of TEXT_SAVE_REFUSALS) assert.ok(`text.refused.${status}` in KO && `text.refused.${status}` in EN, status);
  for (const problem of TEXT_PROBLEMS) assert.ok(`text.problem.${problem}` in KO && `text.problem.${problem}` in EN, problem);
  assert.match(KO["text.saveNote"], /건너뜁니다/);
  assert.match(EN["text.saveNote"], /skips this file/);
});

test("U-184: Ctrl+S saves, never while an input method composes", () => {
  const key = (extra: Record<string, unknown>) => ({ key: "s", ctrlKey: true, metaKey: false, altKey: false, ...extra });
  assert.equal(isSaveKey(key({})), true);
  assert.equal(isSaveKey(key({ key: "S" })), true);
  assert.equal(isSaveKey(key({ isComposing: true })), false, "Korean input composing");
  assert.equal(isSaveKey(key({ keyCode: 229 })), false);
  assert.equal(isSaveKey(key({ ctrlKey: false })), false);
  assert.equal(isSaveKey(key({ altKey: true })), false);
  assert.equal(isSaveKey(key({ ctrlKey: false, metaKey: true })), true);
});

const OPENED = { ok: true, opened: true, text: "first\nsecond", masked: false, protected: false, editable: true, readOnlyReasons: [], lines: 2, editToken: TOKEN };

function editorApi(saves: unknown[], calls: unknown[][]): CodarynApi {
  return new Proxy({} as CodarynApi, {
    get: (_target, name: string) => async (...args: unknown[]) => {
      calls.push([name, ...args]);
      if (name === "openText") return OPENED;
      if (name === "saveText") return saves.shift() ?? { ok: false, code: "host_error" };
      return true;
    },
  });
}

interface Editor {
  readonly root: FakeElement;
  readonly calls: unknown[][];
  readonly back: string[];
  readonly screen: ReturnType<typeof textScreen>;
  readonly runState: { running: boolean; listener: (() => void) | null };
}

async function editor(saves: unknown[] = [], language: "ko" | "en" = "en"): Promise<Editor> {
  const calls: unknown[][] = [];
  const back: string[] = [];
  const runState: { running: boolean; listener: (() => void) | null } = { running: false, listener: null };
  const screen = textScreen({
    texts: textsFor(language),
    api: editorApi(saves, calls),
    current: () => ({ handle: HANDLE, name: "ws" }),
    back: (id) => back.push(id),
    running: () => runState.running,
    watchRun: (listener) => {
      runState.listener = listener;
      return () => undefined;
    },
  });
  screen.choose({ node: NODE, name: "notes/a.txt" }, "home");
  const root = new FakeElement("main");
  screen.show(root as unknown as HTMLElement);
  await settle();
  return { root, calls, back, screen, runState };
}

const byId = (root: FakeElement, id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];
const type = (root: FakeElement, text: string): void => {
  const area = byId(root, "text-content");
  assert.ok(area);
  area.value = text;
  area.dispatch("input");
};

test("U-184: an editable file can be changed; Save sends the token and the text, takes the next token, and the edit is no longer unsaved", async () => {
  const restore = installFakeDom();
  try {
    const { root, calls, screen } = await editor([
      { ok: true, saved: true, unchanged: false, lockLeft: false, editToken: NEXT },
      { ok: true, saved: true, unchanged: false, lockLeft: false, editToken: "3".repeat(32) },
    ]);
    const area = byId(root, "text-content");
    assert.equal(area?.hasAttribute("readonly"), false);
    assert.ok(byId(root, "text-save-note")?.textContent.includes("skips this file"), "told before any save");
    assert.equal(byId(root, "text-save")?.hasAttribute("disabled"), true, "nothing to save yet");
    type(root, "first\nchanged");
    assert.equal(screen.dirty, true);
    assert.deepEqual(calls.filter((c) => c[0] === "textDirty").at(-1), ["textDirty", true], "the main process is told (closing asks)");
    assert.ok(byId(root, "text-status")?.textContent.includes("Unsaved edits"));
    byId(root, "text-save")?.click();
    await settle();
    assert.deepEqual(calls.filter((c) => c[0] === "saveText")[0], ["saveText", TOKEN, "first\nchanged"], "the token and the text only");
    assert.equal(byId(root, "text-result")?.textContent, EN["text.saved"]);
    assert.equal(screen.dirty, false);
    assert.deepEqual(calls.filter((c) => c[0] === "textDirty").at(-1), ["textDirty", false]);
    type(root, "first\nchanged again");
    byId(root, "text-save")?.click();
    await settle();
    assert.deepEqual(calls.filter((c) => c[0] === "saveText")[1], ["saveText", NEXT, "first\nchanged again"], "the next save uses the next token");
  } finally {
    restore();
  }
});

test("U-184: a refused save says why in words and keeps the text", async () => {
  const restore = installFakeDom();
  try {
    const refused = { ok: true, saved: false, status: "text_refused", readOnlyReasons: [], textProblems: ["masked", "control_characters"], lockLeft: false };
    const conflict = { ok: true, saved: false, status: "conflict", readOnlyReasons: [], textProblems: [], lockLeft: true };
    const notEditable = { ok: true, saved: false, status: "not_editable", readOnlyReasons: ["workspace_locked"], textProblems: [], lockLeft: false };
    const { root, screen } = await editor([refused, conflict, { ok: false, code: "cancelled" }, notEditable], "ko");
    type(root, "token here");
    byId(root, "text-save")?.click();
    await settle();
    assert.ok(byId(root, "text-result")?.textContent.startsWith(KO["text.refused.text_refused"]));
    assert.deepEqual(byId(root, "text-save-why")?.children.map((li) => li.textContent), [KO["text.problem.masked"], KO["text.problem.control_characters"]]);
    assert.equal(byId(root, "text-content")?.value, "token here", "the text stays");
    assert.equal(screen.dirty, true);
    byId(root, "text-save")?.click();
    await settle();
    assert.ok(byId(root, "text-result")?.textContent.includes(KO["text.refused.conflict"]));
    assert.ok(byId(root, "text-result")?.textContent.includes(KO["text.lockLeft"]), "a lock left is told");
    byId(root, "text-save")?.click();
    await settle();
    assert.equal(byId(root, "text-result")?.textContent, KO["text.saveCancelled"]);
    byId(root, "text-save")?.click();
    await settle();
    assert.ok(byId(root, "text-result")?.textContent.includes(KO["text.reason.workspace_locked"]));
    assert.equal(byId(root, "text-content")?.hasAttribute("readonly"), true, "not editable any more: read only, the text kept to copy");
    assert.equal(byId(root, "text-save")?.hasAttribute("disabled"), true);
  } finally {
    restore();
  }
});

test("U-184: Ctrl+S saves from the text; while an input method composes it does nothing", async () => {
  const restore = installFakeDom();
  try {
    const { root, calls } = await editor([{ ok: true, saved: true, unchanged: true, lockLeft: false, editToken: NEXT }]);
    type(root, "first\nsecond!");
    const area = byId(root, "text-content");
    let prevented = 0;
    area?.dispatch("keydown", { key: "s", ctrlKey: true, metaKey: false, altKey: false, isComposing: true, preventDefault: () => (prevented += 1) });
    await settle();
    assert.equal(calls.filter((c) => c[0] === "saveText").length, 0);
    area?.dispatch("keydown", { key: "s", ctrlKey: true, metaKey: false, altKey: false, isComposing: false, preventDefault: () => (prevented += 1) });
    await settle();
    assert.equal(calls.filter((c) => c[0] === "saveText").length, 1);
    assert.equal(prevented, 1);
    assert.equal(byId(root, "text-result")?.textContent, EN["text.saveUnchanged"]);
  } finally {
    restore();
  }
});

test("U-184: while a run goes on in this window the text is read only; after it, editable again", async () => {
  const restore = installFakeDom();
  try {
    const { root, runState } = await editor();
    type(root, "first\nedited");
    runState.running = true;
    runState.listener?.();
    assert.equal(byId(root, "text-content")?.hasAttribute("readonly"), true);
    assert.equal(byId(root, "text-save")?.hasAttribute("disabled"), true);
    assert.equal(byId(root, "text-run-note")?.hasAttribute("hidden"), false);
    runState.running = false;
    runState.listener?.();
    assert.equal(byId(root, "text-content")?.hasAttribute("readonly"), false);
    assert.equal(byId(root, "text-save")?.hasAttribute("disabled"), false, "the unsaved edit can be saved now");
  } finally {
    restore();
  }
});

test("U-184: leaving with an unsaved edit asks; keep stays, discard goes on; another file waits for the same answer", async () => {
  const restore = installFakeDom();
  try {
    const { root, back, screen } = await editor();
    assert.equal(screen.leave("runs"), true, "nothing unsaved: leave at once");
    type(root, "first\nedited");
    assert.equal(screen.leave("runs"), false);
    const prompt = byId(root, "text-leave");
    assert.equal(prompt?.hasAttribute("hidden"), false);
    assert.equal(prompt?.getAttribute("role"), "alert");
    byId(root, "text-leave-keep")?.click();
    assert.equal(prompt?.hasAttribute("hidden"), true);
    assert.deepEqual(back, []);
    assert.equal(screen.leave("runs"), false);
    byId(root, "text-leave-discard")?.click();
    assert.deepEqual(back, ["runs"]);
    assert.equal(screen.dirty, false);
    // Another file while editing: asked first, opened after the answer.
    type(root, "first\nedited again");
    assert.equal(screen.choose({ node: "9".repeat(32), name: "b.txt" }, "text"), false);
    byId(root, "text-leave-discard")?.click();
    assert.deepEqual(back, ["runs", "text"]);
  } finally {
    restore();
  }
});

test("U-184: Back to when opened puts the opened text back; an unknown token or a host error is said as an error", async () => {
  const restore = installFakeDom();
  try {
    const { root, screen } = await editor([{ ok: false, code: "unknown_entry" }]);
    type(root, "something else");
    byId(root, "text-restore")?.click();
    assert.equal(byId(root, "text-content")?.value, "first\nsecond");
    assert.equal(screen.dirty, false);
    type(root, "something else");
    byId(root, "text-save")?.click();
    await settle();
    assert.ok(root.findAll((e) => e.getAttribute("data-save") === "unknown_entry").length === 1);
    assert.equal(screen.dirty, true);
  } finally {
    restore();
  }
});

test("U-184: the page's save parser keeps known refusals, reasons and problems only", () => {
  assert.deepEqual(asSaveText({ ok: true, saved: true, unchanged: false, lockLeft: false, editToken: NEXT }), { ok: true, saved: true, unchanged: false, lockLeft: false, editToken: NEXT });
  assert.deepEqual(asSaveText({ ok: true, saved: true, editToken: "C:/x" }), { ok: false, code: "host_error" });
  assert.deepEqual(asSaveText({ ok: true, saved: false, status: "text_refused", readOnlyReasons: [], textProblems: ["masked", "unknown"], lockLeft: false }), {
    ok: true,
    saved: false,
    status: "text_refused",
    readOnlyReasons: [],
    textProblems: ["masked"],
    lockLeft: false,
  });
  assert.deepEqual(asSaveText({ ok: true, saved: false, status: "made_up" }), { ok: false, code: "host_error" });
});
