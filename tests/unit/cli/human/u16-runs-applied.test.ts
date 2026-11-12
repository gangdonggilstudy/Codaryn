/**
 * U-16 (UXM-5, UXM-15), the human renderer's part:
 * - runsText: a plan run whose plan was applied (RunListEntry.appliedBy) says it was applied, and
 *   by which run (`runs.plan_applied`), in place of the needs-input words; its code stays.
 *   R-55b M-1b: by what became of that apply, the contract's planApplyStateOf over the list (as
 *   revert's guidance): applied, not finished (its reason), applying, reverted, records missing.
 * - applySummary: the notice kind plan_task_differs is drawn as `apply.notice.plan_task_differs`.
 * With the real catalog (the texts of unit/U-16-nb-i18n 9085b29).
 * Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PLAN_APPLY_STATES, planApplyStateOf, toRunId } from "../../../../src/contracts/index.js";
import type { ApplyResult, MessageLanguage, PlanApplyState, RunId, RunListEntry, RunsOutput } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const PLAN = toRunId("20261112T030405Z-0a1b2c3d") as RunId;
const APPLY = toRunId("20261112T030505Z-0a1b2c3e") as RunId;
const real = createMessageCatalog("en");

const planEntry = (extra: Record<string, unknown>): RunListEntry =>
  ({
    state: "checked", runId: PLAN, kind: "run", startedAt: "2026-11-12T03:04:05.000Z", profile: null, workflowRef: null, taskId: "t",
    status: "needs-input", reason: "plan_pending", changes: 0, reverted: null, revertRecordDamaged: false, ...extra,
  }) as unknown as RunListEntry;
const listing = (...runs: RunListEntry[]): RunsOutput => ({ schemaVersion: 1, kind: "runs", runs, omitted: 0 }) as unknown as RunsOutput;
/** The result column of the row of `runId` (the plan run by default). */
const statusOf = (text: string, runId: string = PLAN): string =>
  (text.trimEnd().split(String.fromCharCode(10)).find((row) => row.startsWith(runId)) ?? "").replace(/^\S+\s+\S+ \S+\s+\S+\s+/, "");
/** The apply run of the plan run, as the list gives it (newer, so listed first). */
const applyEntry = (extra: Record<string, unknown> = {}): RunListEntry =>
  ({
    state: "checked", runId: APPLY, kind: "apply", planRunId: PLAN, startedAt: "2026-11-12T03:05:05.000Z", profile: null, workflowRef: null, taskId: "t",
    status: "done", reason: "verified", changes: 1, reverted: null, revertRecordDamaged: false, ...extra,
  }) as unknown as RunListEntry;
const APPLIED = { appliedBy: { runId: APPLY, at: "2026-11-12T03:05:06.000Z" } };

describe("U-16 (UXM-5): the run list says a plan run was applied, and by which run", () => {
  const out = createHumanOutput(real);

  test("appliedBy: runs.plan_applied with the apply run in place of 'needs input'; the code stays", () => {
    const status = statusOf(out.runsText(listing(applyEntry(), planEntry(APPLIED))));
    assert.equal(status, `${real.format("runs.plan_applied", { runId: APPLY })} (needs-input/plan_pending)`);
    assert.equal(status.includes(real.format("status.needs-input")), false);
  });

  test("the other marks still follow it", () => {
    const status = statusOf(out.runsText(listing(applyEntry(), planEntry({ ...APPLIED, recordsChanged: true }))));
    assert.ok(status.endsWith(` · ${real.format("runs.records_changed")}`), status);
  });

  test("without appliedBy, or with one that is not a run id, or on a run that is not a plan run: as before", () => {
    const before = out.runsText(listing(planEntry({})));
    assert.equal(statusOf(before), `${real.format("status.needs-input")} (needs-input/plan_pending)`);
    for (const appliedBy of [null, "x", { runId: "../x", at: "2026-11-12T03:05:06.000Z" }, { at: "2026-11-12T03:05:06.000Z" }]) {
      assert.equal(out.runsText(listing(planEntry({ appliedBy }))), before, JSON.stringify(appliedBy));
    }
    const done = planEntry({ status: "done", reason: "verified" });
    assert.equal(out.runsText(listing({ ...done, appliedBy: { runId: APPLY, at: "2026-11-12T03:05:06.000Z" } } as unknown as RunListEntry)), out.runsText(listing(done)));
  });
});

describe("R-55b M-1b: the plan row says what became of its apply, in both languages", () => {
  const REVERTED = { at: "2026-11-12T04:00:00.000Z", status: "complete" };
  // [case, the list's other entries, the state, the reason the words name]
  const cases: [string, RunListEntry[], PlanApplyState, string?][] = [
    ["done", [applyEntry()], "applied"],
    ["done, then partly reverted (some changes are left: by how it ended)", [applyEntry({ reverted: { ...REVERTED, status: "partial" } })], "applied"],
    ["failed part way (apply_incomplete, 1 of 3 moved)", [applyEntry({ status: "failed", reason: "apply_incomplete" })], "unfinished", "apply_incomplete"],
    ["cancelled while checking", [applyEntry({ status: "cancelled", reason: "cancelled" })], "unfinished", "cancelled"],
    ["out of time while checking", [applyEntry({ status: "budget-exhausted", reason: "max_duration" })], "unfinished", "max_duration"],
    ["still going, or stopped without a result", [applyEntry({ status: null, reason: null, changes: null })], "applying"],
    ["reverted", [applyEntry({ reverted: REVERTED })], "reverted"],
    ["failed part way, then reverted", [applyEntry({ status: "failed", reason: "apply_incomplete", reverted: REVERTED })], "reverted"],
    ["its records removed (not in the list)", [], "record_missing"],
    ["its records cannot be checked (damaged)", [{ state: "damaged", runId: APPLY } as unknown as RunListEntry], "record_missing"],
  ];
  const wordsOf = (catalog: ReturnType<typeof createMessageCatalog>, state: PlanApplyState, reason?: string): string => {
    switch (state) {
      case "applied":
        return catalog.format("runs.plan_applied", { runId: APPLY });
      case "unfinished":
        return catalog.format("runs.plan_apply_unfinished", { runId: APPLY, reason: reason as never });
      case "applying":
        return catalog.format("runs.plan_applying", { runId: APPLY });
      case "reverted":
        return catalog.format("runs.plan_apply_reverted", { runId: APPLY });
      case "record_missing":
        return catalog.format("runs.plan_apply_missing", { runId: APPLY });
    }
  };

  test("the table has all five states", () => {
    assert.deepEqual([...new Set(cases.map(([, , state]) => state))].sort(), [...PLAN_APPLY_STATES].sort());
  });

  for (const language of ["en", "ko"] as const satisfies readonly MessageLanguage[]) {
    const catalog = createMessageCatalog(language);
    const out = createHumanOutput(catalog);
    for (const [name, others, state, reason] of cases) {
      test(`${language}, ${name}: ${state}; the code stays; the apply run's own row is as before`, () => {
        const text = out.runsText(listing(...others, planEntry(APPLIED)));
        const status = statusOf(text);
        assert.equal(status, `${wordsOf(catalog, state, reason)} (needs-input/plan_pending)`, status);
        assert.ok(status.includes(APPLY), status);
        if (reason !== undefined) assert.ok(status.includes(reason), status);
        assert.equal(status.includes(catalog.format("status.needs-input")), false, status);
        // The apply run's row does not depend on the plan run's.
        const applyRow = (rows: string): string => (rows.split(String.fromCharCode(10)).find((row) => row.startsWith(APPLY)) ?? "").replace(/\s+/g, " ");
        if (others.length > 0) assert.equal(applyRow(text), applyRow(out.runsText(listing(...others))));
      });
    }
  }

  test("the two languages say it in their own words", () => {
    const en = createHumanOutput(createMessageCatalog("en"));
    const ko = createHumanOutput(createMessageCatalog("ko"));
    for (const [name, others] of cases) {
      const words = [en, ko].map((out) => statusOf(out.runsText(listing(...others, planEntry(APPLIED)))));
      assert.notEqual(words[0], words[1], name);
      assert.match(words[1] ?? "", /\p{Script=Hangul}/u, name);
    }
  });

  test("the same rule as revert's guidance: the row follows planApplyStateOf, whatever the list holds", () => {
    const out = createHumanOutput(real);
    const extra: RunListEntry[][] = [
      [applyEntry({ planRunId: "20261112T020000Z-00000000" })],
      [applyEntry({ kind: "run", planRunId: undefined })],
      [applyEntry({ revertRecordDamaged: true })],
      [applyEntry({ status: "needs-input", reason: "consent_required" })],
    ];
    for (const others of [...cases.map(([, list]) => list), ...extra]) {
      const plan = planEntry(APPLIED) as Extract<RunListEntry, { readonly state: "checked" }>;
      const judged = planApplyStateOf(plan, [...others, plan]);
      assert.notEqual(judged, null);
      const expected = `${wordsOf(real, judged?.state ?? "applied", judged?.reason)} (needs-input/plan_pending)`;
      assert.equal(statusOf(out.runsText(listing(...others, plan))), expected, JSON.stringify(others));
    }
  });

  test("a run that is not a plan run, and a plan run no apply claimed: as before", () => {
    const out = createHumanOutput(real);
    for (const others of cases.map(([, list]) => list)) {
      assert.equal(statusOf(out.runsText(listing(...others, planEntry({})))), `${real.format("status.needs-input")} (needs-input/plan_pending)`);
      const done = planEntry({ status: "done", reason: "verified", changes: 2, ...APPLIED });
      assert.equal(statusOf(out.runsText(listing(...others, done))), `${real.format("status.done")} (done/verified)`);
    }
  });
});

describe("U-16 (UXM-15): the apply summary tells that the plan was made by another task", () => {
  const result = (extra: Record<string, unknown>): ApplyResult =>
    ({
      schemaVersion: 1, kind: "apply", runId: APPLY, planRunId: PLAN, taskId: "quick", digest: "d".repeat(64),
      status: "done", reason: "verified", exitCode: 0, applied: [], verifiers: [],
      usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 5 }, journalPath: "x", notices: [], ...extra,
    }) as unknown as ApplyResult;

  test("noticeKinds plan_task_differs: one line apply.notice.plan_task_differs; both kinds in the contract's order", () => {
    const out = createHumanOutput(real);
    const one = out.applySummary?.(result({ noticeKinds: ["plan_task_differs"] }), { workspaceForm: "given" }) ?? "";
    assert.equal(one.split("\n").filter((line) => line === real.format("apply.notice.plan_task_differs")).length, 1, one);
    const both = (out.applySummary?.(result({ noticeKinds: ["plan_task_differs", "plan_records_unchecked"] }), { workspaceForm: "given" }) ?? "").split("\n");
    assert.ok(both.indexOf(real.format("apply.notice.plan_records_unchecked")) < both.indexOf(real.format("apply.notice.plan_task_differs")), both.join("\n"));
  });
});
