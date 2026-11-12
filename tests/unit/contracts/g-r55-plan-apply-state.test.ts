/**
 * U-16 (R-55 M-1, L-1): what became of a plan run's apply, judged from the run list. applied.json
 * is written just before the moves start, so the plan run's appliedBy says only that an apply
 * claimed it; the apply run's own entry says how it ended. The runs table, the GUI and revert's
 * guidance use the one rule (planApplyStateOf).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FIXED_MESSAGES, PLAN_APPLY_STATES, PLAN_APPLY_STATES_TO_REVERT, planApplyStateOf, toRunId } from "../../../src/contracts/index.js";
import type { RunId, RunListEntry, RunReason, TerminalRunStatus } from "../../../src/contracts/index.js";

type Checked = Extract<RunListEntry, { state: "checked" }>;

const PLAN = toRunId("20261112T135722Z-79868fe5") as RunId;
const APPLY = toRunId("20261112T135733Z-194379b2") as RunId;

function entry(runId: RunId, status: TerminalRunStatus | null, reason: RunReason | null, more: Partial<Checked> = {}): Checked {
  return { state: "checked", runId, startedAt: "2026-11-12T13:57:22.000Z", taskId: "organize-demo", status, reason, changes: null, reverted: null, ...more };
}
const plan = entry(PLAN, "needs-input", "plan_pending", { appliedBy: { runId: APPLY, at: "2026-11-12T13:57:33.000Z" } });
const applyRun = (status: TerminalRunStatus | null, reason: RunReason | null, more: Partial<Checked> = {}) =>
  entry(APPLY, status, reason, { kind: "apply", planRunId: PLAN, ...more });
const stateIn = (entries: readonly RunListEntry[]) => planApplyStateOf(plan, entries);

describe("R-55 M-1: the plan line follows the apply run", () => {
  test("the states, and the ones revert's guidance points to the apply for", () => {
    assert.deepEqual([...PLAN_APPLY_STATES], ["applied", "unfinished", "applying", "reverted", "record_missing"]);
    assert.deepEqual([...PLAN_APPLY_STATES_TO_REVERT], ["applied", "unfinished"]);
  });

  test("R-55 2.3: each case of the table", () => {
    const cases: [string, readonly RunListEntry[], ReturnType<typeof planApplyStateOf>][] = [
      ["done", [applyRun("done", "verified"), plan], { state: "applied", applyRunId: APPLY }],
      ["middle failure", [applyRun("failed", "apply_incomplete"), plan], { state: "unfinished", applyRunId: APPLY, reason: "apply_incomplete" }],
      ["still running", [applyRun(null, null), plan], { state: "applying", applyRunId: APPLY }],
      ["cancelled during verification", [applyRun("cancelled", "cancelled"), plan], { state: "unfinished", applyRunId: APPLY, reason: "cancelled" }],
      ["reverted", [applyRun("done", "verified", { reverted: { at: "2026-11-12T14:00:00.000Z", status: "complete" } }), plan], { state: "reverted", applyRunId: APPLY }],
      ["its records removed", [plan], { state: "record_missing", applyRunId: APPLY }],
      ["its records damaged", [{ state: "damaged", runId: APPLY }, plan], { state: "record_missing", applyRunId: APPLY }],
    ];
    for (const [name, entries, expected] of cases) assert.deepEqual(stateIn(entries), expected, name);
  });

  test("a partial revert left changes: judged by how the apply ended, so revert's guidance still points to it", () => {
    const partly = applyRun("done", "verified", { reverted: { at: "2026-11-12T14:00:00.000Z", status: "partial" } });
    assert.deepEqual(stateIn([partly, plan]), { state: "applied", applyRunId: APPLY });
  });

  test("a revert record that cannot be read is ignored (revertRecordDamaged): judged by how the apply ended", () => {
    const unreadable = applyRun("done", "verified", { reverted: null, revertRecordDamaged: true });
    assert.deepEqual(stateIn([unreadable, plan]), { state: "applied", applyRunId: APPLY });
  });

  test("an entry of that id that is not an apply run, or an apply run of another plan: not this plan's apply records", () => {
    const OTHER_PLAN = toRunId("20261112T135700Z-0a1b2c3d") as RunId;
    const cases: [string, Checked][] = [
      ["a run (kind absent)", entry(APPLY, "done", "verified")],
      ["a run (kind run)", entry(APPLY, "done", "verified", { kind: "run" })],
      ["an apply run of another plan", applyRun("done", "verified", { planRunId: OTHER_PLAN })],
      ["an apply run naming no plan", entry(APPLY, "done", "verified", { kind: "apply" })],
      ["a reverted apply run of another plan", applyRun("done", "verified", { planRunId: OTHER_PLAN, reverted: { at: "2026-11-12T14:00:00.000Z", status: "complete" } })],
    ];
    for (const [name, other] of cases) assert.deepEqual(stateIn([other, plan]), { state: "record_missing", applyRunId: APPLY }, name);
  });

  test("not an applied plan run: no state", () => {
    assert.equal(planApplyStateOf(entry(PLAN, "needs-input", "plan_pending"), []), null);
    assert.equal(planApplyStateOf(applyRun("done", "verified"), []), null);
  });

  test("the text ids: the runs table and revert's guidance", () => {
    assert.deepEqual(FIXED_MESSAGES["runs.plan_applied"], { runId: "runId" });
    assert.deepEqual(FIXED_MESSAGES["runs.plan_apply_unfinished"], { runId: "runId", reason: "reason" });
    for (const id of ["runs.plan_applying", "runs.plan_apply_reverted", "runs.plan_apply_missing"] as const) {
      assert.deepEqual(FIXED_MESSAGES[id], { runId: "runId" }, id);
    }
    assert.deepEqual(FIXED_MESSAGES["revert.plan_only"], {});
    for (const id of ["revert.plan_revert_apply", "revert.plan_applying", "revert.plan_apply_reverted", "revert.plan_apply_missing"] as const) {
      assert.deepEqual(FIXED_MESSAGES[id], { runId: "runId" }, id);
    }
  });
});
