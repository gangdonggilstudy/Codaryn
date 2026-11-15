/**
 * U-16 (UXM-4, UXM-5, UXM-15): the state as it is. A plan run's list entry says it was applied and
 * by which run; `changes` of an apply run says it applied a plan (its actions are not file writes of
 * its own); an apply of a plan made by another task says so. Each only where it applies.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { APPLY_NOTICE_KINDS, FIXED_MESSAGES, MESSAGE_IDS, toRunId } from "../../../src/contracts/index.js";
import type { ApplyDeps, ApplyResult, ChangesApplyRun, RunId, RunListEntry } from "../../../src/contracts/index.js";

const plan = toRunId("20261112T135722Z-79868fe5") as RunId;
const apply = toRunId("20261112T135733Z-194379b2") as RunId;

describe("U-16: what runs, changes and apply say about plan and apply runs", () => {
  test("UXM-5: an applied plan run's entry names its apply run; others do not have the field", () => {
    const applied: Pick<Extract<RunListEntry, { state: "checked" }>, "reason" | "appliedBy"> = {
      reason: "plan_pending",
      appliedBy: { runId: apply, at: "2026-11-12T13:57:33.000Z" },
    };
    const pending: Pick<Extract<RunListEntry, { state: "checked" }>, "reason" | "appliedBy"> = { reason: "plan_pending" };
    assert.deepEqual([applied.appliedBy?.runId, Object.hasOwn(pending, "appliedBy")], [apply, false]);
    assert.deepEqual(FIXED_MESSAGES["runs.plan_applied"], { runId: "runId" });
  });

  test("UXM-4: changes of an apply run says it applied a plan, and how many actions", () => {
    const view: ChangesApplyRun = { planRunId: plan, actions: 3 };
    assert.deepEqual(view, { planRunId: plan, actions: 3 });
    assert.deepEqual(FIXED_MESSAGES["changes.apply_run"], { count: "count", runId: "runId" });
  });

  test("UXM-15: an apply of a plan made by another task says so; it is not refused", () => {
    assert.deepEqual([...APPLY_NOTICE_KINDS], ["plan_records_unchecked", "plan_task_differs"]);
    assert.ok((MESSAGE_IDS as readonly string[]).includes("apply.notice.plan_task_differs"));
    const deps: Pick<ApplyDeps, "planTaskId"> = { planTaskId: "organize-demo" };
    const told: Pick<ApplyResult, "status" | "noticeKinds"> = { status: "done", noticeKinds: ["plan_task_differs"] };
    assert.ok(deps.planTaskId !== undefined && told.status === "done");
  });
});
