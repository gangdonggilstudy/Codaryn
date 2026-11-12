/**
 * U-20 (UXM-12, UXM-14, UXM-24): the window's words for the engine's error codes, the records-changed
 * mark in the run list, the plan screen and the report, and the CLI commands the window suggests.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { runsValue } from "../../src/engine-host/history.js";
import { reportValue } from "../../src/engine-host/report.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { errorText, textsFor } from "../../src/renderer/i18n/catalog.js";
import { planScreen } from "../../src/renderer/plan/plan-screen.js";
import { reportScreen } from "../../src/renderer/report/report-screen.js";
import { RunModel } from "../../src/renderer/run/run-model.js";
import { runsScreen } from "../../src/renderer/runs/runs-screen.js";
import { toReportReply, toRunsReply } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

/** UXM-12: the codes the CLI has words for that the window showed with the default text. */
const ENGINE_CODES = [
  "provider_not_configured",
  "key_in_file",
  "plan_records_changed",
  "plan_not_approved",
  "invalid_run_record",
  "invalid_task",
  "secret_env_missing",
  "workspace_is_install_dir",
  "workspace_not_found",
  "model_list_failed",
  "provider_not_implemented",
  "invalid_script",
  "invalid_arguments",
  "config_exists",
  "internal_error",
];

test("UXM-12: each engine error code the CLI has words for has the window's own words, in both languages", () => {
  for (const language of ["ko", "en"] as const) {
    const t = textsFor(language);
    const missing = ENGINE_CODES.filter((code) => !t.has(`error.${code}`) || errorText(t, code) === t.format("error.default"));
    assert.deepEqual(missing, [], `${language}: codes shown with the default text`);
    for (const code of ENGINE_CODES) assert.doesNotMatch(errorText(t, code), /codaryn (doctor|help|apply)\b/, `${language} ${code}: names a screen, not a CLI command`);
  }
});

const RUN = "20261112T010203Z-0000abcd";

test("UXM-14: a run's records-changed mark goes from the app layer through the engine host and the main process", () => {
  const entry = { state: "checked", runId: RUN, kind: "run", startedAt: "2026-11-12T01:02:03.000Z", taskId: "quick", status: "needs-input", reason: "plan_pending", changes: 0, reverted: null, revertRecordDamaged: false };
  const value = runsValue({ ok: true, output: { kind: "runs", runs: [{ ...entry, recordsChanged: true }, { ...entry, runId: "20261112T010203Z-0000abce" }], omitted: 0 } }, (text) => text);
  const reply = toRunsReply(value);
  assert.equal(reply.ok, true);
  if (!reply.ok) return;
  assert.deepEqual(reply.runs.map((run) => (run.state === "checked" ? run.recordsChanged : null)), [true, false], "absent is false");
  const report = toReportReply(
    reportValue(
      { ok: true, output: { schemaVersion: 1, kind: "report", runId: RUN, status: "complete", exitCode: 0, recordsChanged: true, result: null, journal: { taskId: "quick", workflow: "organize", provider: null, records: 1, lastRound: [], changes: [], integrityChecks: [], finished: null } } },
      (text) => text,
      (text) => text,
    ),
  );
  assert.equal(report.ok && report.view.recordsChanged, true);
});

test("UXM-14: the run list marks the run, its plan is shown without an apply button, and the report warns", async () => {
  const restore = installFakeDom();
  try {
    const row = { state: "checked", runId: RUN, kind: "run", startedAt: null, taskId: "quick", status: "needs-input", reason: "plan_pending", changes: 0, reverted: null, revertRecordDamaged: false, recordsChanged: true, form: { profile: null, workflow: "organize" } };
    const opened: unknown[][] = [];
    const runsApi = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "listRuns" ? { ok: true, runs: [row], omitted: 0 } : null) });
    const runs = runsScreen({ texts: textsFor("en"), api: runsApi, current: () => ({ handle: "1".repeat(32), name: "ws" }), open: () => undefined, announce: () => undefined, openPlan: (...args: unknown[]) => opened.push(args), openChanges: () => undefined, openReport: () => undefined });
    const list = new FakeElement("main");
    runs.show(list as unknown as HTMLElement);
    await settle();
    const marked = list.findAll((e) => e.getAttribute("data-records-changed") === "true");
    assert.equal(marked.length, 1);
    assert.ok(marked[0]?.textContent.includes("records changed"));
    list.findAll((e) => e.getAttribute("data-plan") === RUN)[0]?.click();
    assert.deepEqual(opened, [[RUN, null, "organize", true, true]], "the plan screen is told");

    const planApi = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async () => (name === "plan" ? { ok: true, view: { runId: RUN, status: "pending", digest: "d".repeat(64), actions: [{ kind: "move", from: "a", to: "b" }], inventoryLimitReached: false, appliedBy: null }, approval: "a".repeat(32) } : null),
    });
    const plan = planScreen({ texts: textsFor("en"), api: planApi, run: new RunModel(), current: () => ({ handle: "1".repeat(32), name: "ws" }), showRun: () => undefined });
    plan.choose(RUN, null, "organize", true, true);
    const planRoot = new FakeElement("main");
    plan.show(planRoot as unknown as HTMLElement);
    await settle();
    const byId = (root: FakeElement, id: string) => root.findAll((e) => e.getAttribute("id") === id)[0];
    assert.equal(byId(planRoot, "plan-apply"), undefined, "no apply button");
    // U-32: the warning first, and what to do in place of the apply button.
    assert.ok(byId(planRoot, "plan-records-changed")?.textContent.includes("may not be the one the run made"));
    assert.ok(byId(planRoot, "plan-cannot-apply")?.textContent.includes("Run the task again"));

    const reportApi = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async () =>
        name === "report"
          ? { ok: true, view: { runId: RUN, kind: "run", status: "complete", recordsChanged: true, finished: null, usage: null, verifiers: [], integrity: [], records: 1, taskId: "quick", run: null, apply: null }, labels: null }
          : null,
    });
    const report = reportScreen({ texts: textsFor("en"), api: reportApi, current: () => ({ handle: "1".repeat(32), name: "ws" }), openChanges: () => undefined });
    report.choose(RUN);
    const reportRoot = new FakeElement("main");
    report.show(reportRoot as unknown as HTMLElement);
    await settle();
    await settle();
    assert.ok(byId(reportRoot, "report-records-changed")?.textContent.includes("not to be trusted"));
  } finally {
    restore();
  }
});

test("UXM-24: the window suggests no CLI command in a form that cannot run", () => {
  for (const language of ["ko", "en"] as const) {
    const text = textsFor(language).format("plan.formUnknown", { runId: RUN });
    assert.doesNotMatch(text, /codaryn apply \S+$/, `${language}: not "codaryn apply <run id>" alone`);
    assert.match(text, /codaryn plan/, `${language}: codaryn plan tells the apply command`);
  }
});
