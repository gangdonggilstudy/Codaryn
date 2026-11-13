/**
 * U-118 (docs/design/standalone-gui.md 3.7, adapter-contract 5.13): the result's records tab. The
 * engine host turns each stored record into the progress list's line (records with none are only
 * counted); the main process checks the page; the window shows the page's state first (damaged:
 * an alert with the missing numbers and the lines left out), then the lines with the run screen's
 * filter, page by page. A report refused as a damaged record still offers the readable records.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import { runEventsValue } from "../../src/engine-host/run-events.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { reportScreen } from "../../src/renderer/report/report-screen.js";
import { runLog } from "../../src/renderer/report/run-log.js";
import { RunModel, filterItems } from "../../src/renderer/run/run-model.js";
import { IPC_CHANNELS, parseRunEventsArgs, toRunEventsReply } from "../../src/shared/ipc.js";
import { parseHostMessage, parseRunItems } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const RUN_ID = "20261113T120000Z-0000a118";
const HANDLE = "0123456789abcdef0123456789abcdef";
const AT = "2026-11-13T12:00:01.000Z";
const record = (seq: number, type: string, extra: Record<string, unknown> = {}) => ({ seq, at: AT, runId: RUN_ID, type, ...extra });
const page = (records: unknown[], extra: Record<string, unknown> = {}) => ({
  ok: true,
  output: { kind: "run_events", runId: RUN_ID, runKind: "run", status: "complete", masking: "current_secrets", records, total: records.length, skipped: 0, missing: 0, offset: 0, nextOffset: null, ...extra },
});
const itemOf = (event: unknown) => {
  const r = (event as { record: { type: string; seq: number; allowed?: boolean } }).record;
  if (r.type === "model_response") return null;
  return { at: AT, kind: r.type === "tool_decision" && r.allowed === false ? "tool_denied" : r.type, text: `line ${r.seq}` };
};

test("U-118: the engine host gives each record the progress list's line, counts the ones without, and passes the page's state on", () => {
  const value = runEventsValue(
    page([record(1, "run_started"), record(2, "model_response"), record(3, "tool_decision", { allowed: false }), record(4, "file_changed")], { status: "damaged", skipped: 2, missing: 1, recordsChanged: true, nextOffset: 4 }),
    itemOf,
  );
  assert.deepEqual(value, {
    ok: true,
    runId: RUN_ID,
    runKind: "run",
    status: "damaged",
    recordsChanged: true,
    items: [
      { at: AT, kind: "run_started", text: "line 1" },
      { at: AT, kind: "tool_denied", text: "line 3" },
      { at: AT, kind: "file_changed", text: "line 4" },
    ],
    records: 4,
    total: 4,
    skipped: 2,
    missing: 1,
    offset: 0,
    nextOffset: 4,
  });
  assert.deepEqual(runEventsValue({ ok: false, error: { code: "invalid_run_record", message: "x" } }, itemOf), { ok: false, code: "invalid_run_record" });
  for (const bad of [null, page([], { status: "broken" }), page([], { runKind: "other" }), page([], { total: -1 }), { ok: true, output: { kind: "report" } }]) {
    assert.deepEqual(runEventsValue(bad, itemOf), { ok: false, code: "host_error" }, JSON.stringify(bad).slice(0, 80));
  }
});

test("U-118: the host checks the call and makes the lines in the window's language; the main process checks the page", async () => {
  const asked: unknown[] = [];
  const languages: string[] = [];
  const written: unknown[] = [];
  const handler = createHostHandler({
    app: fakeApp({ listRunEvents: async (request) => (asked.push(request), page([record(1, "run_started")])) }),
    itemsIn: (language) => (languages.push(language), itemOf),
    token: () => "0".repeat(32),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => text,
    providers: [],
    write: (line) => written.push(parseHostMessage(line.trimEnd())),
    log: () => undefined,
  });
  const abs = process.platform === "win32" ? "C:\\ws" : "/ws";
  await handler.handleLine(JSON.stringify({ v: 1, id: 1, call: "runEvents", args: { workspace: abs, profile: null, workflowRef: null, runId: RUN_ID, offset: 0, language: "ko" } }));
  for (const [id, args] of [
    [2, { workspace: abs, profile: null, workflowRef: null, runId: "latest", offset: 0, language: "ko" }],
    [3, { workspace: abs, profile: null, workflowRef: null, runId: RUN_ID, offset: -1, language: "ko" }],
    [4, { workspace: abs, profile: null, workflowRef: null, runId: RUN_ID, offset: 0, language: "fr" }],
  ] as const) {
    await handler.handleLine(JSON.stringify({ v: 1, id, call: "runEvents", args }));
  }
  assert.deepEqual(languages, ["ko"]);
  assert.equal((asked[0] as { runId: string }).runId, RUN_ID);
  assert.deepEqual(written.slice(1).map((m) => (m as { error?: { code: string } }).error?.code), ["invalid_args", "invalid_args", "invalid_args"]);
  const value = (written[0] as { value: unknown }).value;
  const reply = toRunEventsReply(value, parseRunItems);
  assert.ok(reply.ok && reply.items.length === 1 && reply.status === "complete");
  assert.deepEqual(toRunEventsReply({ ...(value as object), items: [{ at: null, kind: "x", text: "a" }, { at: null, kind: "x", text: "b" }], records: 1 }, parseRunItems), { ok: false, code: "host_error" }, "more lines than records");
  assert.deepEqual(toRunEventsReply({ ...(value as object), status: "fine" }, parseRunItems), { ok: false, code: "host_error" });
  assert.equal(IPC_CHANNELS.runEvents, "codaryn:runs:events");
  assert.deepEqual(parseRunEventsArgs({ workspace: HANDLE, runId: RUN_ID, profile: null, workflow: null, offset: 200 }), { workspace: HANDLE, runId: RUN_ID, profile: null, workflow: null, offset: 200 });
  for (const bad of [{ workspace: HANDLE, runId: RUN_ID, profile: null, workflow: null }, { workspace: HANDLE, runId: RUN_ID, profile: null, workflow: null, offset: 1.5 }, { workspace: HANDLE, runId: "latest", profile: null, workflow: null, offset: 0 }]) {
    assert.equal(parseRunEventsArgs(bad), null, JSON.stringify(bad));
  }
});

function pageReply(items: { kind: string; text: string }[], extra: Record<string, unknown> = {}) {
  return { ok: true, runId: RUN_ID, runKind: "run", status: "complete", recordsChanged: false, items: items.map((item) => ({ at: AT, ...item })), records: items.length + 1, total: 5, skipped: 0, missing: 0, offset: 0, nextOffset: null, ...extra };
}

test("U-118: the tab says the page's state first, shows the lines with the run screen's filter, and loads the next page", async () => {
  const restore = installFakeDom();
  try {
    const pages = [
      pageReply([{ kind: "run_started", text: "started" }, { kind: "tool_denied", text: "denied once" }], { status: "damaged", skipped: 3, missing: 2, nextOffset: 3, recordsChanged: true }),
      pageReply([{ kind: "file_changed", text: "changed a file" }], { offset: 3 }),
    ];
    const offsets: number[] = [];
    const api = {
      async runEvents(_w: string, _r: string, _p: string | null, _f: string | null, offset: number) {
        offsets.push(offset);
        return pages.shift();
      },
    } as unknown as CodarynApi;
    const root = new FakeElement("section");
    root.append(...(runLog(textsFor("en"), api, { workspace: { handle: HANDLE, name: "ws" }, runId: RUN_ID, profile: null, workflow: null }) as unknown as FakeElement[]));
    await settle();
    const byId = (id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];
    const damaged = byId("report-log-damaged");
    assert.equal(damaged?.getAttribute("role"), "alert");
    assert.match(damaged?.textContent ?? "", /2 record numbers are missing and 3 lines were left out/);
    assert.ok(byId("report-log-records-changed"));
    assert.equal(byId("report-log")?.getAttribute("data-log-ready"), "damaged");
    const lines = (): string[] => root.findAll((e) => e.tagName === "li" && e.hasAttribute("data-kind")).map((li) => li.getAttribute("data-kind") ?? "");
    assert.deepEqual(lines(), ["run_started", "tool_denied"]);
    const filter = byId("report-log-filter");
    (filter as unknown as { value: string }).value = "denied";
    filter?.dispatch("change");
    assert.deepEqual(lines(), ["tool_denied"]);
    assert.equal(byId("report-log-more")?.hasAttribute("hidden"), false);
    byId("report-log-more")?.click();
    await settle();
    assert.deepEqual(offsets, [0, 3]);
    (filter as unknown as { value: string }).value = "files";
    filter?.dispatch("change");
    assert.deepEqual(lines(), ["file_changed"]);
    assert.equal(byId("report-log-more")?.hasAttribute("hidden"), true, "the last page");
    assert.match(byId("report-log-counts")?.textContent ?? "", /5 of 5 records read; 3 have a line here/);
    assert.equal(byId("report-log-damaged"), undefined, "the second page is not damaged");
    const model = new RunModel();
    model.items = [{ at: null, kind: "tool_denied", text: "a" }, { at: null, kind: "file_changed", text: "b" }];
    assert.deepEqual(model.shown("denied"), filterItems(model.items, "denied"), "the run screen filters the same way");
  } finally {
    restore();
  }
});

test("U-118: a report refused as a damaged record offers the records that can still be read", async () => {
  const restore = installFakeDom();
  try {
    let asked = 0;
    const api = {
      async report() {
        return { ok: false, code: "invalid_run_record" };
      },
      async runEvents() {
        asked += 1;
        return pageReply([{ kind: "run_started", text: "started" }], { status: "damaged", skipped: 1, missing: 0 });
      },
    } as unknown as CodarynApi;
    const screen = reportScreen({ texts: textsFor("en"), api, current: () => ({ handle: HANDLE, name: "ws" }), openChanges: () => undefined });
    const root = new FakeElement("main");
    screen.choose(RUN_ID, null);
    screen.show(root as unknown as HTMLElement);
    await settle();
    const open = root.findAll((e) => e.getAttribute("id") === "report-log-open")[0];
    assert.ok(open, "the readable records are offered");
    open.click();
    await settle();
    assert.equal(asked, 1);
    assert.ok(root.findAll((e) => e.getAttribute("id") === "report-log-damaged").length === 1);
    for (const language of ["ko", "en"] as const) {
      const t = textsFor(language);
      for (const id of ["report.tab.log", "report.log.damaged", "report.log.skipped", "report.log.incomplete", "report.log.counts", "report.log.more", "report.log.open"]) assert.ok(t.has(id), `${language} ${id}`);
    }
  } finally {
    restore();
  }
});
