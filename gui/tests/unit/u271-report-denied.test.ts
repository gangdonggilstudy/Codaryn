/**
 * U-271 (docs/design/standalone-gui.md 3.7): the report's summary tab has "the denials and how to allow
 * them (to Settings › Permission rules)". The denied count was only a number in the usage tab. Now, when
 * the run had denied calls, the summary says how many, opens the records tab with "denials only" to see
 * them, says how to allow them (the config file's permission rules, or a task file's policy; from the
 * next run) and opens the settings. A run without denials shows none of it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { reportValue } from "../../src/engine-host/report.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { reportScreen } from "../../src/renderer/report/report-screen.js";
import { toReportReply } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const RUN = "20261114T040000Z-0000d271";
const same = (text: string): string => text;

function reportReply(denied: number) {
  const output = {
    schemaVersion: 1,
    kind: "report",
    runId: RUN,
    status: "complete",
    exitCode: 0,
    result: { schemaVersion: 1, kind: "run", runId: RUN, status: "done", reason: "verified", exitCode: 0, verifiers: [], changes: [], usage: { modelTurns: 2, toolCalls: 3, inputTokens: 10, outputTokens: 5, durationMs: 1500 }, notices: [] },
    journal: { taskId: "task", workflow: "edit", provider: "anthropic", limits: {}, records: 6, modelRequests: 2, deniedToolCalls: denied, repairs: 0, lastRound: [], changes: [], integrityChecks: [], finished: { status: "done", reason: "verified" } },
  };
  const reply = toReportReply(reportValue({ ok: true, output }, same, same));
  assert.ok(reply.ok);
  return reply;
}

async function shown(denied: number, openSettings?: () => void) {
  const pages: { types: unknown }[] = [];
  const reply = reportReply(denied);
  const api = new Proxy({} as CodarynApi, {
    get: (_t, name: string) => {
      if (name === "report") return async () => ({ ...reply, labels: { status: "S", reason: "R" } });
      if (name === "runEvents") {
        return async (...args: unknown[]) => {
          pages.push({ types: args[4] });
          return { ok: true, runId: RUN, runKind: "run", status: "complete", recordsChanged: false, items: [{ at: null, kind: "tool_denied", text: "denied" }, { at: null, kind: "file_changed", text: "changed" }], records: 6, total: 6, skipped: 0, missing: 0, offset: 0, nextOffset: null };
        };
      }
      return async () => null;
    },
  });
  const screen = reportScreen({ texts: textsFor("ko"), api, current: () => ({ handle: "1".repeat(32), name: "ws" }), openChanges: () => undefined, ...(openSettings === undefined ? {} : { openSettings }) });
  screen.choose(RUN);
  const root = new FakeElement("main");
  screen.show(root as unknown as HTMLElement);
  await settle();
  await settle();
  const byId = (id: string) => root.findAll((e) => e.getAttribute("id") === id)[0];
  return { root, byId, pages };
}

test("U-271 (3.7): the summary's denials: how many, see them in the records (denials only), how to allow, the settings", async () => {
  const restore = installFakeDom();
  try {
    let opened = 0;
    const { byId } = await shown(2, () => void (opened += 1));
    assert.equal(byId("report-panel")?.getAttribute("data-tab"), "summary");
    assert.equal(byId("report-denied-title")?.textContent, KO["report.denied"].replace("{count}", "2"));
    assert.ok(byId("report-denied")?.textContent.includes(KO["report.deniedHow"]));
    byId("report-denied-settings")?.click();
    assert.equal(opened, 1, "the settings, where the permission rules are");
    byId("report-denied-show")?.click();
    await settle();
    await settle();
    assert.equal(byId("report-panel")?.getAttribute("data-tab"), "log");
    assert.equal((byId("report-log-filter") as unknown as { value?: string } | undefined)?.value, "denied");
    const lines = byId("report-log")?.findAll((e) => e.tagName === "li").map((li) => li.getAttribute("data-kind"));
    assert.deepEqual(lines, ["tool_denied"], "denials only");
    // The records tab chosen by itself again starts with every line.
    byId("report-tab-log")?.click();
    await settle();
    assert.equal((byId("report-log-filter") as unknown as { value?: string } | undefined)?.value, "all");
  } finally {
    restore();
  }
});

test("U-271 (3.7): a run without denials shows none of it; both languages have the texts", async () => {
  const restore = installFakeDom();
  try {
    const { byId } = await shown(0, () => undefined);
    assert.equal(byId("report-panel")?.getAttribute("data-tab"), "summary");
    assert.equal(byId("report-denied"), undefined);
    for (const id of ["report.denied", "report.deniedShow", "report.deniedHow", "report.deniedSettings"] as const) assert.ok(KO[id] && EN[id], id);
    // U-294 (R-113 L-2): the permission rules are named where a command was denied (by kind, u294-report-denied-kinds).
    assert.ok(KO["report.deniedKind.command"].includes(KO["settings.rules"]) && EN["report.deniedKind.command"].includes(EN["settings.rules"]), "names the permission rules");
  } finally {
    restore();
  }
});
