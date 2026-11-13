/**
 * U-105 (app layer U-90 and U-91, "담당에게 알릴 것"): the contract gives out at run time the record
 * types of the two journals, and the plan executor may tell how many hard link probes it left.
 * - JOURNAL_EVENT_TYPES: every JournalEventType, in JournalEvent's order.
 * - APPLY_JOURNAL_EVENT_TYPES: every ApplyJournalEventType; APPLY_JOURNAL_ENTRY_TYPES adds
 *   `plan_item_started`, which a stored apply line may have but readers do not show.
 * A type added to a union without its table line fails to compile (`satisfies`); these tests pin
 * the lists so a change to them is seen. Only additions: no type and no record changed.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { APPLY_JOURNAL_ENTRY_TYPES, APPLY_JOURNAL_EVENT_TYPES, JOURNAL_EVENT_TYPES } from "../../../src/contracts/index.js";
import type {
  ApplyJournalEntryType,
  ApplyJournalEventType,
  JournalEventType,
  PlanExecutor,
  PlanPreflightDeps,
  PlanPreflightOutcome,
  PolicyDecision,
  PolicyGate,
  PreflightPlan,
} from "../../../src/contracts/index.js";

describe("U-105: the journals' record types at run time", () => {
  test("a run journal: the twelve JournalEvent types, in the union's order", () => {
    const expected: readonly JournalEventType[] = [
      "run_started",
      "model_request",
      "model_response",
      "model_error",
      "tool_decision",
      "tool_result",
      "file_changed",
      "verifier_result",
      "repair_started",
      "integrity_checked",
      "state_checked",
      "run_finished",
    ];
    assert.deepEqual(JOURNAL_EVENT_TYPES, expected);
  });

  test("an apply journal: the nine shown types, then plan_item_started for a stored line", () => {
    const shown: readonly ApplyJournalEventType[] = [
      "apply_started",
      "plan_checked",
      "file_moved",
      "file_discarded",
      "plan_item_failed",
      "verifier_result",
      "integrity_checked",
      "state_checked",
      "run_finished",
    ];
    assert.deepEqual(APPLY_JOURNAL_EVENT_TYPES, shown);
    const entries: readonly ApplyJournalEntryType[] = [...shown, "plan_item_started"];
    assert.deepEqual(APPLY_JOURNAL_ENTRY_TYPES, entries);
  });

  test("each list names a type once; the records both journals share have the same names", () => {
    for (const list of [JOURNAL_EVENT_TYPES, APPLY_JOURNAL_EVENT_TYPES, APPLY_JOURNAL_ENTRY_TYPES]) {
      assert.equal(new Set(list).size, list.length);
      for (const type of list) assert.match(type, /^[a-z]+(_[a-z]+)*$/);
    }
    const runTypes: readonly string[] = JOURNAL_EVENT_TYPES;
    const sharedWithRuns = APPLY_JOURNAL_EVENT_TYPES.filter((type) => runTypes.includes(type));
    assert.deepEqual(sharedWithRuns, ["verifier_result", "integrity_checked", "state_checked", "run_finished"]);
  });
});

describe("U-105: the executor's probe count and the preflight's types", () => {
  test("probesLeft is optional: an executor with check and apply only is still a PlanExecutor", async () => {
    const plain: PlanExecutor = {
      check: async () => null,
      apply: async () => ({ ok: false, problem: "io_error" }),
    };
    assert.equal(plain.probesLeft, undefined);
    const counting: PlanExecutor = { ...plain, probesLeft: () => 0 };
    assert.equal(counting.probesLeft?.(), 0);
  });

  test("a preflight outcome is the judged parts of plan_checked, or a stop", async () => {
    const judged: PlanPreflightOutcome = { stopped: false, problems: [{ index: 1, problem: "denied" }], unsafeMoves: [0] };
    const stopped: PlanPreflightOutcome = { stopped: true };
    const fake: PreflightPlan = async (deps) => (deps.stop?.() === true ? stopped : judged);
    const allow: PolicyDecision = { allowed: true };
    const policy: PolicyGate = { checkRequested: () => allow, restorableFields: () => [], checkEffective: async () => allow };
    const deps: PlanPreflightDeps = { actions: [], planActions: [], policy, executor: { check: async () => null } };
    assert.deepEqual(await fake(deps), judged);
    assert.deepEqual(await fake({ ...deps, stop: () => true }), stopped);
  });
});
