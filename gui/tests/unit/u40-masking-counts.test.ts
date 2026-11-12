/**
 * U-40 (DR-52, AXM-17): the masking counts (EngineResult.masking) in the window. The engine host
 * passes the two counts of a run's result and of a report on, the main process checks them, and the
 * run's end and the report's usage tab show one line with the CLI's `summary.masking` words. Counts
 * only: no line when there are none, and none when a field is not a count.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { reportValue } from "../../src/engine-host/report.js";
import { runResultValue } from "../../src/engine-host/runs.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { maskingLine, reportScreen } from "../../src/renderer/report/report-screen.js";
import { RunModel } from "../../src/renderer/run/run-model.js";
import { runScreen } from "../../src/renderer/run/run-screen.js";
import { toReportReply, toRunResultView } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const RUN = "20261113T010203Z-0000a040";
const shown = (text: string): string => text;

// This file runs as gui/build/tests/unit/u40-masking-counts.test.js.
const I18N = path.join(fileURLToPath(new URL("../../../", import.meta.url)), "..", "dist", "src", "i18n");

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
const COUNTS = { registeredValues: 2, maskedPlaces: 3 };

/** Fields that are not the two counts: none of them gives a line. */
const NOT_COUNTS: readonly unknown[] = [
  null,
  "2 3",
  [2, 3],
  { registeredValues: "2", maskedPlaces: 3 },
  { registeredValues: 2, maskedPlaces: -1 },
  { registeredValues: 1.5, maskedPlaces: 0 },
  { registeredValues: 2, maskedPlaces: Number.NaN },
  { registeredValues: 2, maskedPlaces: Number.POSITIVE_INFINITY },
  { registeredValues: 2 ** 53, maskedPlaces: 0 },
  { registeredValues: 2 },
  { maskedPlaces: 0 },
];

test("U-40: the window's line has the CLI's summary.masking words, in both languages", async () => {
  const en = (await import(pathToFileURL(path.join(I18N, "en.js")).href)) as { EN_MESSAGES: Record<string, string> };
  const ko = (await import(pathToFileURL(path.join(I18N, "ko.js")).href)) as { KO_MESSAGES: Record<string, string> };
  const window: Record<"en" | "ko", Readonly<Record<string, string>>> = { en: EN, ko: KO };
  assert.equal(window.en["run.masking"], en.EN_MESSAGES["summary.masking"]);
  assert.equal(window.ko["run.masking"], ko.KO_MESSAGES["summary.masking"]);
  assert.equal(maskingLine(textsFor("en"), COUNTS), "Masking: values registered 2 · places masked in what the model was sent 3");
  assert.equal(maskingLine(textsFor("ko"), { registeredValues: 1, maskedPlaces: 0 }), "가림: 등록된 가릴 값 1개 · 모델에 보낸 글에서 가린 곳 0개");
});

test("U-40: the engine host passes a run's two counts on, and nothing else the field holds", () => {
  const value = runResultValue({ ok: true, result: { ...RESULT, masking: { ...COUNTS, values: ["not", "carried"], length: 9 } } }, shown) as { result: Record<string, unknown> };
  assert.deepEqual(value.result["masking"], COUNTS);
  const none = runResultValue({ ok: true, result: RESULT }, shown) as { result: Record<string, unknown> };
  assert.equal(none.result["masking"], null, "nothing registered, or a result written before DR-52");
  for (const masking of NOT_COUNTS) {
    const bad = runResultValue({ ok: true, result: { ...RESULT, masking } }, shown) as { ok: boolean; result: Record<string, unknown> };
    assert.equal(bad.ok, true, "the rest of the result stays");
    assert.equal(bad.result["masking"], null, `not counts: ${JSON.stringify(masking)}`);
  }
});

test("U-40: the main process keeps the two counts of a run's result and drops a field that is not counts", () => {
  const checked = toRunResultView(runResultValue({ ok: true, result: { ...RESULT, masking: COUNTS } }, shown));
  assert.ok(checked.ok);
  if (!checked.ok) return;
  assert.deepEqual(checked.result.masking, COUNTS);
  // A host that sent more, or not counts: the counts alone, or no line; the result itself is shown.
  const base = runResultValue({ ok: true, result: RESULT }, shown) as { ok: true; result: Record<string, unknown> };
  const extra = toRunResultView({ ...base, result: { ...base.result, masking: { ...COUNTS, values: ["x"] } } });
  assert.ok(extra.ok);
  if (extra.ok) assert.deepEqual(Object.keys(extra.result.masking ?? {}), ["registeredValues", "maskedPlaces"]);
  for (const masking of NOT_COUNTS) {
    const reply = toRunResultView({ ...base, result: { ...base.result, masking } });
    assert.ok(reply.ok, `still shown: ${JSON.stringify(masking)}`);
    if (reply.ok) assert.equal(reply.result.masking, null, `not counts: ${JSON.stringify(masking)}`);
  }
});

const report = (masking: unknown): unknown => ({
  ok: true,
  output: {
    schemaVersion: 1,
    kind: "report",
    runId: RUN,
    status: "complete",
    exitCode: 0,
    result: masking === undefined ? RESULT : { ...RESULT, masking },
    journal: { taskId: "task", workflow: "edit", provider: "anthropic", limits: {}, records: 3, modelRequests: 2, deniedToolCalls: 0, repairs: 0, lastRound: [], changes: [], integrityChecks: [], finished: { status: "done", reason: "verified" } },
  },
});

test("U-40: a report's counts go from the app layer's result through the engine host and the main process", () => {
  const reply = toReportReply(reportValue(report(COUNTS), shown, shown));
  assert.ok(reply.ok);
  if (!reply.ok) return;
  assert.deepEqual(reply.view.masking, COUNTS);
  const none = toReportReply(reportValue(report(undefined), shown, shown));
  assert.ok(none.ok && none.view.masking === null, "a report without counts");
  const noResult = toReportReply(reportValue({ ok: true, output: { ...(report(undefined) as { output: Record<string, unknown> }).output, result: null } }, shown, shown));
  assert.ok(noResult.ok && noResult.view.masking === null, "a run without a result");
  for (const masking of NOT_COUNTS) {
    const bad = toReportReply(reportValue(report(masking), shown, shown));
    assert.ok(bad.ok && bad.view.masking === null, `not counts: ${JSON.stringify(masking)}`);
    // A host that sent a field that is not counts: the report is shown without the line.
    const host = reportValue(report(undefined), shown, shown) as Record<string, unknown>;
    const forged = toReportReply({ ...host, masking });
    assert.ok(forged.ok && forged.view.masking === null, `main drops it: ${JSON.stringify(masking)}`);
  }
});

const byId = (root: FakeElement, id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];
/** The rows of the element that holds `child` (the fake DOM has no parentElement). */
const rowsAround = (root: FakeElement, child: FakeElement): FakeElement[] => root.findAll((e) => e.children.includes(child))[0]?.children ?? [];

async function runEnd(language: "ko" | "en", masking: unknown): Promise<FakeElement> {
  const model = new RunModel();
  model.starting({ goal: "g", profile: null, workflow: null });
  model.started(RUN, Date.now());
  const checked = toRunResultView(runResultValue({ ok: true, result: masking === undefined ? RESULT : { ...RESULT, masking } }, shown));
  assert.ok(checked.ok);
  if (!checked.ok) throw new Error("not ok");
  model.finished({ runId: RUN, ok: true, result: checked.result, labels: { status: "S", reason: "R" } });
  const api = new Proxy({} as CodarynApi, { get: () => async () => null });
  const screen = runScreen({ texts: textsFor(language), api, run: model, newTask: () => undefined, announce: () => undefined, current: () => null, openPlan: () => undefined, openChanges: () => undefined, openReport: () => undefined });
  const root = new FakeElement("main");
  screen.show(root as unknown as HTMLElement);
  await settle();
  return root;
}

test("U-40: the run's end shows the masking line after the usage; none, no line", async () => {
  const restore = installFakeDom();
  try {
    // The screen's elapsed-time timer stops when the screen is gone: emptied even when a check fails.
    for (const language of ["ko", "en"] as const) {
      const root = await runEnd(language, COUNTS);
      try {
        const line = byId(root, "run-masking");
        assert.equal(line?.textContent, maskingLine(textsFor(language), COUNTS));
        const usage = byId(root, "run-usage");
        assert.ok(usage !== undefined && line !== undefined);
        const siblings = rowsAround(root, usage);
        assert.equal(siblings.indexOf(line), siblings.indexOf(usage) + 1, "right after the usage");
      } finally {
        root.replaceChildren();
      }
    }
    for (const masking of [undefined, ...NOT_COUNTS]) {
      const root = await runEnd("en", masking);
      try {
        assert.equal(byId(root, "run-masking"), undefined, `no line: ${JSON.stringify(masking)}`);
        assert.doesNotMatch(root.textContent, /Masking:/);
      } finally {
        root.replaceChildren();
      }
    }
  } finally {
    restore();
  }
});

async function reportUsage(language: "ko" | "en", masking: unknown): Promise<FakeElement> {
  const reply = toReportReply(reportValue(report(masking), shown, shown));
  assert.ok(reply.ok);
  const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => (name === "report" ? async () => ({ ...reply, labels: { status: "S", reason: "R" } }) : async () => null) });
  const screen = reportScreen({ texts: textsFor(language), api, current: () => ({ handle: "1".repeat(32), name: "ws" }), openChanges: () => undefined });
  screen.choose(RUN);
  const root = new FakeElement("main");
  screen.show(root as unknown as HTMLElement);
  await settle();
  await settle();
  root.findAll((e) => e.getAttribute("role") === "tab" && e.getAttribute("data-tab") === "usage")[0]?.click();
  await settle();
  return root;
}

test("U-40: the report's usage tab shows the masking line after the usage; none, no line", async () => {
  const restore = installFakeDom();
  try {
    for (const language of ["ko", "en"] as const) {
      const root = await reportUsage(language, COUNTS);
      const line = byId(root, "report-masking");
      assert.equal(line?.textContent, maskingLine(textsFor(language), COUNTS));
      assert.ok(line !== undefined);
      const rows = rowsAround(root, line);
      assert.equal(rows.indexOf(line), 1, "after the usage line, before the records");
      assert.equal(rows[0]?.textContent, textsFor(language).format("run.usage", { turns: "2", tools: "1", tokens: "15", time: "0:02" }));
      root.replaceChildren();
    }
    for (const masking of [undefined, ...NOT_COUNTS]) {
      const root = await reportUsage("en", masking);
      assert.equal(root.findAll((e) => e.getAttribute("role") === "tab" && e.getAttribute("data-tab") === "usage" && e.getAttribute("aria-selected") === "true").length, 1, "the usage tab is open");
      assert.equal(byId(root, "report-masking"), undefined, `no line: ${JSON.stringify(masking)}`);
      root.replaceChildren();
    }
  } finally {
    restore();
  }
});

test("U-40: the screens show no line for a view whose counts are not counts (the renderer checks too)", () => {
  const t = textsFor("en");
  for (const masking of [null, undefined, { registeredValues: -1, maskedPlaces: 0 }, { registeredValues: 1, maskedPlaces: "0" }, { registeredValues: 0.5, maskedPlaces: 0 }]) {
    assert.equal(maskingLine(t, masking as never), null, JSON.stringify(masking));
  }
});
