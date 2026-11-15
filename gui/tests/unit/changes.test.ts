/**
 * DR-29, DR-32 (c): the changes view. The app layer gives a file's masked texts only when masked
 * now as the run masked them; the engine host passes them on cleaned (line breaks kept), the main
 * process checks them, and the window compares them line by line. The engine host's call with a
 * fake app (src/engine-host/plans.ts), the main process's check (src/shared/ipc.ts) and the line
 * comparison (src/renderer/diff/line-diff.ts).
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import type { HostDeps } from "../../src/engine-host/host.js";
import { MAX_CHANGES_TEXT_CHARS } from "../../src/engine-host/plans.js";
import { MAX_CELLS, hunkStarts, lineDiff, splitLines } from "../../src/renderer/diff/line-diff.js";
import { MAX_CHANGE_TEXT_CHARS, toChangesReply } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { changesScreen } from "../../src/renderer/changes/changes-screen.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const WS = path.resolve("ws-for-changes");
const RUN = "20261112T010203Z-0000abcd";
const TOKEN = "[[CODARYN_SECRET:0123456789abcdef]]";

function host(files: unknown[], shownText?: (text: string) => string) {
  const calls: unknown[] = [];
  const written: HostMessage[] = [];
  const deps: HostDeps = {
    app: fakeApp({
      changes: async (request) => {
        calls.push(request);
        return { ok: true, output: { schemaVersion: 1, kind: "changes", runId: RUN, exitCode: 0, masking: "current_secrets", files } };
      },
    }),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => `<${text}>`,
    ...(shownText === undefined ? {} : { shownText }),
    providers: [],
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
  };
  const handler = createHostHandler(deps);
  const call = async (id: number, args: unknown): Promise<unknown> => {
    await handler.handleLine(JSON.stringify({ v: 1, id, call: "changes", args }));
    const message = written.find((m) => "id" in m && m.id === id) as { ok: boolean; value?: unknown; error?: { code: string } };
    return message.ok ? message.value : message.error?.code;
  };
  return { call, calls };
}

test("changes (DR-29): texts the app layer verified go on cleaned with their lines; unverified ones stay out", async () => {
  const { call, calls } = host(
    [
      { path: "a.md", created: false, state: "as_run_left", before: `key: ${TOKEN}\nold\n`, after: `key: ${TOKEN}\nnew\n`, unavailable: null },
      { path: "b.md", created: false, state: "as_run_left", before: null, after: null, unavailable: "masking_unverified" },
      { path: "c.md", created: true, state: "missing", before: null, after: null, unavailable: null },
    ],
    (text) => `[${text}]`,
  );
  assert.equal(await call(1, { workspace: WS, profile: null, runId: "latest" }), "invalid_args");
  const value = await call(2, { workspace: WS, profile: "doc", runId: RUN });
  assert.deepEqual(calls, [{ settings: { input: { kind: "workspace", workspace: WS }, configPath: null, varsFile: null, profile: "doc", workflowRef: null }, runId: RUN }]);
  assert.deepEqual(toChangesReply(value), {
    ok: true,
    runId: RUN,
    // U-48 (U-43): no records-changed mark on this run.
    recordsChanged: false,
    files: [
      { path: "<a.md>", created: false, state: "as_run_left", unavailable: null, before: `[key: ${TOKEN}\nold\n]`, after: `[key: ${TOKEN}\nnew\n]` },
      { path: "<b.md>", created: false, state: "as_run_left", unavailable: "masking_unverified", before: null, after: null },
      { path: "<c.md>", created: true, state: "missing", unavailable: null, before: null, after: null },
    ],
  });
});

test("changes (DR-29): without a text cleaner each line passes the name cleaner; past the budget a file goes without text", async () => {
  const big = "x".repeat(MAX_CHANGES_TEXT_CHARS);
  const { call } = host([
    { path: "a.md", created: false, state: "as_run_left", before: "one\r\ntwo\n", after: "one\nthree\n", unavailable: null },
    { path: "big.md", created: false, state: "as_run_left", before: big, after: big, unavailable: null },
  ]);
  const reply = toChangesReply(await call(1, { workspace: WS, profile: null, runId: RUN }));
  assert.equal(reply.ok, true);
  if (!reply.ok) return;
  assert.equal(reply.files[0]?.before, "<one>\n<two>\n<>");
  assert.deepEqual(reply.files[1], { path: "<big.md>", created: false, state: "as_run_left", unavailable: "too_large", before: null, after: null });
});

test("changes (DR-29): the main process takes these fields only, with texts within their limits", () => {
  const file = { path: "a.md", created: false, state: "as_run_left", unavailable: null, before: "a\n", after: "b\n" };
  const good = { ok: true, runId: RUN, masking: "current_secrets", files: [file] };
  assert.equal(toChangesReply(good).ok, true);
  for (const bad of [
    { ...good, files: [{ ...file, raw: "text" }] },
    { ...good, masking: "run_table" },
    { ...good, files: [{ ...file, state: "gone" }] },
    { ...good, files: [{ ...file, after: "y".repeat(MAX_CHANGE_TEXT_CHARS + 1) }] },
    { ...good, files: Array.from({ length: 11 }, () => ({ ...file, before: "z".repeat(MAX_CHANGE_TEXT_CHARS), after: null })) },
  ]) {
    assert.deepEqual(toChangesReply(bad), { ok: false, code: "host_error" });
  }
  assert.deepEqual(toChangesReply({ ok: false, code: "invalid_config" }), { ok: false, code: "invalid_config" });
});

test("changes (DR-29): the line comparison keeps the common lines and marks what was removed and added", () => {
  const shape = (before: string | null, after: string | null): string[] => lineDiff(before, after).map((line) => `${line.kind[0]}${line.oldNo ?? "-"}:${line.newNo ?? "-"} ${line.text}`);
  assert.deepEqual(shape("a\nb\nc\n", "a\nb\nc\n"), ["s1:1 a", "s2:2 b", "s3:3 c"]);
  assert.deepEqual(shape(null, "x\ny\n"), ["a-:1 x", "a-:2 y"], "a created file is all added");
  assert.deepEqual(shape("x\ny\n", null), ["r1:- x", "r2:- y"], "a file that is gone is all removed");
  assert.deepEqual(shape("a\nold\nc\nd\n", "a\nnew\nc\nd\ne\n"), ["s1:1 a", "r2:- old", "a-:2 new", "s3:3 c", "s4:4 d", "a-:5 e"]);
  assert.deepEqual(shape("a\nb\nc\n", "b\nc\nx\n"), ["r1:- a", "s2:1 b", "s3:2 c", "a-:3 x"]);
  assert.deepEqual(splitLines(""), []);
  assert.deepEqual(splitLines("no newline at end"), ["no newline at end"]);
  const lines = lineDiff("a\nold\nc\nd\n", "a\nnew\nc\nd\ne\n");
  assert.deepEqual(hunkStarts(lines), [1, 5]);
});

test("changes (DR-29): a middle too large to compare is listed as removed then added, still in order", () => {
  const n = Math.ceil(Math.sqrt(MAX_CELLS)) + 10;
  const before = Array.from({ length: n }, (_v, i) => `old ${i}`).join("\n");
  const after = Array.from({ length: n }, (_v, i) => `new ${i}`).join("\n");
  const lines = lineDiff(`head\n${before}\ntail\n`, `head\n${after}\ntail\n`);
  assert.equal(lines.length, 2 * n + 2);
  assert.equal(lines[0]?.kind, "same");
  assert.equal(lines.at(-1)?.kind, "same");
  assert.equal(lines.at(-1)?.oldNo, n + 2);
  assert.equal(lines.at(-1)?.newNo, n + 2);
  assert.ok(lines.slice(1, n + 1).every((line) => line.kind === "removed"));
  assert.ok(lines.slice(n + 1, 2 * n + 1).every((line) => line.kind === "added"));
});

test("changes (per file): a side longer than the main process takes leaves only that file without text", async () => {
  const long = "y".repeat(MAX_CHANGE_TEXT_CHARS + 1);
  const { call } = host(
    [
      { path: "long.md", created: false, state: "as_run_left", before: "short\n", after: long, unavailable: null },
      { path: "ok.md", created: false, state: "as_run_left", before: "a\n", after: "b\n", unavailable: null },
    ],
    (text) => text,
  );
  const reply = toChangesReply(await call(1, { workspace: WS, profile: null, runId: RUN }));
  assert.equal(reply.ok, true, "the whole view is not refused");
  if (!reply.ok) return;
  assert.deepEqual(reply.files[0], { path: "<long.md>", created: false, state: "as_run_left", unavailable: "too_large", before: null, after: null });
  assert.deepEqual(reply.files[1], { path: "<ok.md>", created: false, state: "as_run_left", unavailable: null, before: "a\n", after: "b\n" });
});

test("changes (per file): the screen shows each file by itself: compared, path and state only, or one side as it is", async () => {
  const restore = installFakeDom();
  try {
    const files = [
      { path: "shown.md", created: false, state: "as_run_left", unavailable: null, before: "a\n", after: "b\n" },
      { path: "unverified.md", created: false, state: "changed_since_run", unavailable: "masking_unverified", before: null, after: null },
      { path: "current.md", created: false, state: "as_run_left", unavailable: "snapshot_missing", before: null, after: "x\ny\n" },
      { path: "made.md", created: true, state: "as_run_left", unavailable: null, before: null, after: "new\n" },
    ];
    const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "changes" ? { ok: true, runId: RUN, files } : null) });
    const screen = changesScreen({ texts: textsFor("en"), api, current: () => ({ handle: "1".repeat(32), name: "ws" }) });
    screen.choose(RUN, null, null);
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    await settle();
    const sections = root.findAll((e) => e.getAttribute("class") === "changed-file");
    assert.deepEqual(
      sections.map((s) => s.getAttribute("data-text")),
      ["shown", "none", "current", "shown"],
    );
    assert.equal(sections[1]?.findAll((e) => e.getAttribute("data-text") === "hidden").length, 1, "says why there is no text");
    const current = sections[2]?.findAll((e) => e.tagName === "li") ?? [];
    assert.deepEqual(
      current.map((li) => [li.getAttribute("data-kind"), li.textContent]),
      [
        ["same", "1x"],
        ["same", "2y"],
      ],
      "no line is marked added: the original is unknown",
    );
    assert.ok(sections[2]?.textContent.includes("only the current content is shown"));
    const made = sections[3]?.findAll((e) => e.tagName === "li") ?? [];
    assert.deepEqual(
      made.map((li) => li.getAttribute("data-kind")),
      ["added"],
      "a file the run made is compared with nothing: every line added",
    );
  } finally {
    restore();
  }
});
