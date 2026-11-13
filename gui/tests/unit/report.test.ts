/**
 * GU-3 (3.7): a run's report. The engine host's call with a fake app (src/engine-host/report.ts),
 * the main process's check (src/shared/ipc.ts), and the report screen's tabs with a DOM stand-in.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import { MAX_EVIDENCE_CHARS } from "../../src/engine-host/report.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { reportScreen } from "../../src/renderer/report/report-screen.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { toReportReply } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const WS = path.resolve("ws-for-report");
const RUN = "20261112T010203Z-0000abcd";
const PLAN = "20261112T000000Z-0000beef";

const RUN_REPORT = {
  ok: true,
  output: {
    schemaVersion: 1,
    kind: "report",
    runId: RUN,
    status: "complete",
    exitCode: 0,
    result: { usage: { modelTurns: 2, toolCalls: 1, inputTokens: 10, outputTokens: 5, durationMs: 3000 }, journalPath: ".codaryn/runs/x/journal.jsonl" },
    journal: {
      taskId: "task",
      workflow: "analyze",
      provider: "anthropic",
      limits: {},
      records: 12,
      modelRequests: 2,
      deniedToolCalls: 0,
      repairs: 0,
      lastRound: [{ id: "verifier-id-not-shown", kind: "file_rules", outcome: "pass", evidence: `line one\nline two\n${"x".repeat(MAX_EVIDENCE_CHARS)}`, checked: ["rule\u0007"], limits: [] }],
      changes: [{ path: "report.md", previousHash: null, newHash: "a".repeat(64), created: true }],
      integrityChecks: [{ phase: "after_verify", changed: [] }],
      finished: { status: "needs-input", reason: "awaiting_review" },
    },
    verdict: { schemaVersion: 1, kind: "review_record", runId: RUN, at: "2026-11-12T01:05:00.000Z", verdict: "accepted", note: "fine" },
  },
};

const APPLY_REPORT = {
  ok: true,
  output: {
    schemaVersion: 1,
    kind: "report",
    runKind: "apply",
    runId: RUN,
    status: "complete",
    exitCode: 0,
    result: null,
    journal: {
      planRunId: PLAN,
      taskId: "tidy",
      digest: "d".repeat(64),
      approval: "adapter",
      unsafeMoveConsent: null,
      actions: 3,
      maxDurationMs: 1000,
      records: 9,
      checked: { problems: 0, inventoryLimitReached: false, unsafeMoves: 0 },
      started: 3,
      moved: [{ index: 0, from: "a.txt", to: "x/a.txt", unsafe: false }],
      discarded: [{ index: 1, path: "b.tmp", stored: "1" }],
      failed: [{ index: 2, problem: "source_changed" }],
      lastRound: [],
      integrityChecks: [],
      finished: { status: "failed", reason: "apply_incomplete" },
    },
  },
};

function host(report: (request: unknown) => unknown) {
  const written: HostMessage[] = [];
  const handler = createHostHandler({
    app: fakeApp({ report: async (request) => report(request) }),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => `<${text.replace(/[\u0000-\u001f]/g, "?")}>`,
    providers: [],
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
  });
  return async (id: number, args: unknown): Promise<unknown> => {
    await handler.handleLine(JSON.stringify({ v: 1, id, call: "report", args }));
    const message = written.find((m) => "id" in m && m.id === id) as { ok: boolean; value?: unknown; error?: { code: string } };
    return message.ok ? message.value : message.error?.code;
  };
}

test("report (GU-3): a run's report keeps the shown fields, cleans every text and cuts long evidence", async () => {
  const calls: unknown[] = [];
  const call = host((request) => {
    calls.push(request);
    return RUN_REPORT;
  });
  assert.equal(await call(1, { workspace: WS, runId: "latest" }), "invalid_args");
  const value = await call(2, { workspace: WS, runId: RUN });
  assert.deepEqual(calls, [{ workspace: WS, runId: RUN }]);
  const text = JSON.stringify(value);
  assert.equal(text.includes("journal.jsonl") || text.includes("verifier-id-not-shown"), false, "no journal path, no verifier id");
  const reply = toReportReply(value);
  assert.equal(reply.ok, true);
  if (!reply.ok) return;
  const view = reply.view;
  assert.equal(view.kind, "run");
  assert.deepEqual(view.finished, { status: "needs-input", reason: "awaiting_review" });
  assert.equal(view.verifiers[0]?.number, 1);
  assert.equal(view.verifiers[0]?.evidenceCut, true);
  assert.equal(view.verifiers[0]?.evidence.length, MAX_EVIDENCE_CHARS);
  assert.ok(view.verifiers[0]?.evidence.startsWith("<line one>\n<line two>\n"), "lines kept, each cleaned");
  assert.deepEqual(view.verifiers[0]?.checked, ["<rule?>"]);
  assert.deepEqual(view.run?.changes, [{ path: "<report.md>", created: true }]);
  assert.deepEqual(view.run?.verdict, { verdict: "accepted", at: "2026-11-12T01:05:00.000Z", note: "<fine>" });
  assert.deepEqual(view.usage, { turns: 2, tools: 1, inputTokens: 10, outputTokens: 5, durationMs: 3000 });
});

test("report (GU-3): an apply's report gives its actions; errors are codes; bad values are refused", async () => {
  const call = host((request) => ((request as { runId: string }).runId === RUN ? APPLY_REPORT : { ok: false, error: { code: "run_not_found", message: "C:\\x" } }));
  const reply = toReportReply(await call(1, { workspace: WS, runId: RUN }));
  assert.equal(reply.ok, true);
  if (reply.ok) {
    assert.equal(reply.view.kind, "apply");
    assert.deepEqual(reply.view.apply?.moved, [{ from: "<a.txt>", to: "<x/a.txt>", unsafe: false }]);
    assert.deepEqual(reply.view.apply?.discarded, [{ path: "<b.tmp>" }]);
    assert.deepEqual(reply.view.apply?.failed, [{ number: 3, problem: "source_changed" }]);
    assert.equal(reply.view.apply?.approval, "adapter");
  }
  assert.deepEqual(await call(2, { workspace: WS, runId: PLAN }), { ok: false, code: "run_not_found" });
  const good = (await call(3, { workspace: WS, runId: RUN })) as Record<string, unknown>;
  assert.equal(toReportReply({ ...good, kind: "other" }).ok, false);
  assert.equal(toReportReply({ ...good, runId: "latest" }).ok, false);
  assert.equal(toReportReply({ ...good, verifiers: [{ number: 1, kind: null, outcome: "pass", evidence: "e".repeat(6000), evidenceCut: false, checked: [], limits: [] }] }).ok, false);
});

test("report (GU-3): the report screen shows its tabs and switches between them", async () => {
  const restore = installFakeDom();
  try {
    const call = host(() => RUN_REPORT);
    const value = await call(1, { workspace: WS, runId: RUN });
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => (name === "report" ? async () => ({ ...toReportReply(value), labels: { status: "S", reason: "R" } }) : async () => null),
    });
    const screen = reportScreen({ texts: textsFor("en"), api, current: () => ({ handle: "1".repeat(32), name: "ws" }), openChanges: () => undefined });
    screen.choose(RUN);
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    await settle();
    const tabs = root.findAll((e) => e.getAttribute("role") === "tab").map((e) => e.getAttribute("data-tab"));
    // U-118: the records tab is the last one (3.7).
    assert.deepEqual(tabs, ["summary", "checks", "changes", "protected", "usage", "review", "log"]);
    const panel = root.findAll((e) => e.getAttribute("role") === "tabpanel")[0];
    assert.equal(panel?.getAttribute("data-tab"), "summary");
    assert.ok(panel?.textContent.includes("Result S: R"));
    root.findAll((e) => e.getAttribute("data-tab") === "review" && e.getAttribute("role") === "tab")[0]?.click();
    assert.equal(panel?.getAttribute("data-tab"), "review");
    assert.ok(panel?.textContent.includes("accepted by a person"));
  } finally {
    restore();
  }
});
