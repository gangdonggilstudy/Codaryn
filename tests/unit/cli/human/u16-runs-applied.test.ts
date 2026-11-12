/**
 * U-16 (UXM-5, UXM-15), the human renderer's part:
 * - runsText: a plan run whose plan was applied (RunListEntry.appliedBy) says it was applied, and
 *   by which run (`runs.plan_applied`), in place of the needs-input words; its code stays.
 *   R-55 M-1: only when that apply run is in the list, ended done and was not reverted.
 * - applySummary: the notice kind plan_task_differs is drawn as `apply.notice.plan_task_differs`.
 * With the real catalog (the texts of unit/U-16-nb-i18n 9085b29).
 * Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toRunId } from "../../../../src/contracts/index.js";
import type { ApplyResult, RunId, RunListEntry, RunsOutput } from "../../../../src/contracts/index.js";
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

describe("R-55 M-1: 'applied' only when the apply run ended done and was not reverted", () => {
  const out = createHumanOutput(real);
  const needsInput = `${real.format("status.needs-input")} (needs-input/plan_pending)`;
  const cases: [string, RunListEntry[]][] = [
    ["failed part way (apply_incomplete, 1 of 3 moved)", [applyEntry({ status: "failed", reason: "apply_incomplete" })]],
    ["cancelled while checking", [applyEntry({ status: "cancelled", reason: "cancelled" })]],
    ["still going (no result yet)", [applyEntry({ status: null, reason: null, changes: null })]],
    ["reverted", [applyEntry({ reverted: { at: "2026-11-12T04:00:00.000Z", status: "complete" } })]],
    ["partly reverted", [applyEntry({ reverted: { at: "2026-11-12T04:00:00.000Z", status: "partial" } })]],
    ["its records removed (not in the list)", []],
    ["its records cannot be checked (damaged)", [{ state: "damaged", runId: APPLY } as unknown as RunListEntry]],
    ["an entry of that id that names another plan run", [applyEntry({ planRunId: "20261112T020000Z-00000000" })]],
    ["an entry of that id that is not an apply run", [applyEntry({ kind: "run", planRunId: undefined })]],
  ];
  for (const [name, others] of cases) {
    test(`${name}: the plan row does not say applied`, () => {
      const status = statusOf(out.runsText(listing(...others, planEntry(APPLIED))));
      assert.equal(status, needsInput, status);
    });
  }

  test("done and not reverted: applied, as before", () => {
    assert.equal(statusOf(out.runsText(listing(applyEntry(), planEntry(APPLIED)))), `${real.format("runs.plan_applied", { runId: APPLY })} (needs-input/plan_pending)`);
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
