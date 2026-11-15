/**
 * U-21 (DR-47, AXM-1): the agent's last message (EngineResult.finalMessage) in the window: the run's
 * result and the report show it under a label that says it is the agent's own words, not a verified
 * fact, with a line when it was cut. The engine host cleans it keeping line breaks and tabs and
 * hides keys again; the main process checks it; the screens put it in as text only.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createHostHandler } from "../../src/engine-host/host.js";
import { runResultValue } from "../../src/engine-host/runs.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { reportScreen } from "../../src/renderer/report/report-screen.js";
import { FINAL_MESSAGE_LIMIT, RunModel } from "../../src/renderer/run/run-model.js";
import { runScreen } from "../../src/renderer/run/run-screen.js";
import { MAX_FINAL_MESSAGE_CHARS, toReportReply, toRunResultView } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const RUN = "20261113T010203Z-0000a021";
const WS = path.resolve("ws-for-u21");
/** A key-shaped fake value the host hides again (defence in depth); not a real key. */
const FAKE = ["fake", "value", "u21"].join("-");
const shown = (text: string): string => text.replace(/[\u0000-\u001f]/g, "?").split(FAKE).join("[hidden]");
const shownText = (text: string): string => text.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f]/g, "?").split(FAKE).join("[hidden]");

// This file runs as gui/build/tests/unit/u21-final-message.test.js.
const CONTRACTS = path.join(fileURLToPath(new URL("../../../", import.meta.url)), "..", "dist", "src", "contracts", "index.js");

test("U-21: the window's limit is the contract's", async () => {
  const contracts = (await import(pathToFileURL(CONTRACTS).href)) as { MAX_FINAL_MESSAGE_CHARS: number };
  assert.equal(MAX_FINAL_MESSAGE_CHARS, contracts.MAX_FINAL_MESSAGE_CHARS);
  assert.equal(FINAL_MESSAGE_LIMIT, MAX_FINAL_MESSAGE_CHARS);
});

const RESULT = {
  schemaVersion: 1,
  kind: "run",
  runId: RUN,
  status: "done",
  reason: "verified",
  exitCode: 0,
  verifiers: [],
  changes: [],
  usage: { modelTurns: 2, toolCalls: 1, inputTokens: 10, outputTokens: 5, durationMs: 1500 },
  notices: [],
};
const LAST = { text: `All done.\nKept\t${FAKE} out of the notes.`, truncated: false };

test("U-21: the engine host passes the agent's last message on, lines and tabs kept, keys hidden again", () => {
  const value = runResultValue({ ok: true, result: { ...RESULT, finalMessage: LAST } }, shown, shownText) as { result: Record<string, unknown> };
  assert.deepEqual(value.result["finalMessage"], { text: "All done.\nKept\t[hidden] out of the notes.", truncated: false });
  const none = runResultValue({ ok: true, result: RESULT }, shown, shownText) as { result: Record<string, unknown> };
  assert.equal(none.result["finalMessage"], null, "a result without one (a plan run, an older result) has none");
  const bad = runResultValue({ ok: true, result: { ...RESULT, finalMessage: { text: 3, truncated: false } } }, shown, shownText) as { result: Record<string, unknown> };
  assert.equal(bad.result["finalMessage"], null);
});

test("U-21: the main process keeps a clean message and refuses one with control characters or too long", () => {
  const checked = toRunResultView(runResultValue({ ok: true, result: { ...RESULT, finalMessage: LAST } }, shown, shownText));
  assert.ok(checked.ok);
  if (!checked.ok) return;
  assert.deepEqual(checked.result.finalMessage, { text: "All done.\nKept\t[hidden] out of the notes.", truncated: false });
  const base = runResultValue({ ok: true, result: RESULT }, shown, shownText) as { ok: true; result: Record<string, unknown> };
  const withMessage = (finalMessage: unknown) => toRunResultView({ ...base, result: { ...base.result, finalMessage } });
  assert.equal(withMessage(null).ok, true, "none");
  assert.equal(withMessage({ text: "a\rb", truncated: false }).ok, false, "CR");
  assert.equal(withMessage({ text: "a\u001b[31m", truncated: false }).ok, false, "an escape");
  assert.equal(withMessage({ text: "a‮b", truncated: false }).ok, false, "a direction control");
  assert.equal(withMessage({ text: "가".repeat(MAX_FINAL_MESSAGE_CHARS + 1), truncated: true }).ok, false, "longer than the engine cuts");
  assert.equal(withMessage({ text: "😀".repeat(MAX_FINAL_MESSAGE_CHARS), truncated: true }).ok, true, "code points, not UTF-16 units");
  assert.equal(withMessage({ text: "ok", truncated: "no" }).ok, false);
});

test("U-21: the label says it is the agent's own words, not a verified fact, in both languages", () => {
  assert.match(EN["run.finalMessage"], /agent's own words, not a verified fact/);
  assert.match(KO["run.finalMessage"], /에이전트의 말이며 검증된 사실이 아님/);
  assert.match(EN["report.finalMessage"], /agent's own words, not a verified fact/);
  assert.match(KO["report.finalMessage"], /에이전트의 말이며 검증된 사실이 아닙니다/);
});

async function runShown(finalMessage: unknown): Promise<FakeElement> {
  const model = new RunModel();
  model.starting({ goal: "g", profile: null, workflow: null });
  model.started(RUN, Date.now());
  const value = runResultValue({ ok: true, result: { ...RESULT, finalMessage } }, shown, shownText);
  const checked = toRunResultView(value);
  assert.ok(checked.ok);
  if (!checked.ok) throw new Error("not ok");
  model.finished({ runId: RUN, ok: true, result: checked.result, labels: { status: "S", reason: "R" } });
  const api = new Proxy({} as CodarynApi, { get: () => async () => null });
  const screen = runScreen({ texts: textsFor("en"), api, run: model, newTask: () => undefined, announce: () => undefined, current: () => null, openPlan: () => undefined, openChanges: () => undefined, openReport: () => undefined });
  const root = new FakeElement("main");
  screen.show(root as unknown as HTMLElement);
  await settle();
  return root;
}

test("U-21: the run's result shows the message after its label, as text; a cut one says so; none, no section", async () => {
  const restore = installFakeDom();
  try {
    const root = await runShown({ text: "<b>done</b>\nsecond line", truncated: true });
    const box = root.findAll((e) => e.getAttribute("id") === "run-final-message")[0];
    assert.ok(box !== undefined);
    assert.equal(box.findAll((e) => e.tagName === "h4")[0]?.textContent, EN["run.finalMessage"]);
    const words = box.findAll((e) => e.getAttribute("id") === "run-final-message-text")[0];
    assert.equal(words?.textContent, "<b>done</b>\nsecond line", "as text, lines kept");
    assert.equal(words?.findAll((e) => e.tagName === "b").length, 0, "no markup made");
    assert.match(box.textContent, new RegExp(`first ${MAX_FINAL_MESSAGE_CHARS} characters`));
    root.replaceChildren();
    const none = await runShown(undefined);
    assert.equal(none.findAll((e) => e.getAttribute("id") === "run-final-message").length, 0);
    none.replaceChildren();
  } finally {
    restore();
  }
});

test("U-21: the report's summary shows the message after the report's label", async () => {
  const restore = installFakeDom();
  try {
    const written: HostMessage[] = [];
    const report = {
      ok: true,
      output: {
        schemaVersion: 1,
        kind: "report",
        runId: RUN,
        status: "complete",
        exitCode: 0,
        result: { ...RESULT, finalMessage: LAST },
        journal: { taskId: "task", workflow: "edit", provider: "anthropic", limits: {}, records: 3, modelRequests: 2, deniedToolCalls: 0, repairs: 0, lastRound: [], changes: [], integrityChecks: [], finished: { status: "done", reason: "verified" } },
      },
    };
    const handler = createHostHandler({
      app: fakeApp({ report: async () => report }),
      messages: { texts: () => ({ language: "en", texts: {} }) },
      tree: async () => null,
      shown,
      shownText,
      providers: [],
      itemsIn: () => () => null,
      token: () => "0".repeat(32),
      write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
      log: () => undefined,
    });
    await handler.handleLine(JSON.stringify({ v: 1, id: 1, call: "report", args: { workspace: WS, runId: RUN } }));
    const message = written.find((m) => "id" in m && m.id === 1) as { ok: boolean; value?: unknown };
    const reply = toReportReply(message.value);
    assert.ok(reply.ok);
    if (!reply.ok) return;
    assert.deepEqual(reply.view.finalMessage, { text: "All done.\nKept\t[hidden] out of the notes.", truncated: false });
    const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => (name === "report" ? async () => ({ ...reply, labels: { status: "S", reason: "R" } }) : async () => null) });
    const screen = reportScreen({ texts: textsFor("en"), api, current: () => ({ handle: "1".repeat(32), name: "ws" }), openChanges: () => undefined });
    screen.choose(RUN);
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    await settle();
    const box = root.findAll((e) => e.getAttribute("id") === "report-final-message")[0];
    assert.ok(box !== undefined, "in the summary tab");
    assert.ok(box.textContent.startsWith(EN["report.finalMessage"]));
    assert.equal(box.findAll((e) => e.getAttribute("id") === "report-final-message-text")[0]?.textContent, "All done.\nKept\t[hidden] out of the notes.");
  } finally {
    restore();
  }
});
