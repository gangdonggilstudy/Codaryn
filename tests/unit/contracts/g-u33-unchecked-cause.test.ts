/**
 * U-33 (R-56, PM Q-1 (a), Q-2, Q-3): one notice kind, plan_records_unchecked, whose text follows
 * its cause. The apply's own limited check comes first and keeps U-8's texts (as on main a191a50,
 * nothing added); only when every own check was complete and a run since the plan could not check
 * the state directory does the result carry the cause, and the human line has its own text (no
 * cleanup advice: the state directory may be small now). The store's question names the asking
 * apply, which it leaves out of the runs whose journal has no run_finished.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MESSAGE_IDS, PLAN_RECORDS_UNCHECKED_CAUSES, messageParams } from "../../../src/contracts/index.js";
import type { ApplyResult, MessageId, PlanRecordsUncheckedCause, StateUncheckedSince } from "../../../src/contracts/index.js";

describe("U-33: the cause of plan_records_unchecked travels with the result", () => {
  test("one cause besides the apply's own check, which needs no field", () => {
    assert.deepEqual([...PLAN_RECORDS_UNCHECKED_CAUSES], ["run_since_plan"]);
    const cause: PlanRecordsUncheckedCause = "run_since_plan";
    const field: Pick<ApplyResult, "planRecordsUncheckedCause"> = { planRecordsUncheckedCause: cause };
    assert.equal(field.planRecordsUncheckedCause, "run_since_plan");
  });

  test("the human line of each cause: U-8's id stays, the new cause has its own, without parameters", () => {
    const ids = MESSAGE_IDS as readonly string[];
    assert.ok(ids.includes("apply.notice.plan_records_unchecked"));
    const id: MessageId = "apply.notice.plan_records_unchecked.run_since_plan";
    assert.ok(ids.includes(id));
    assert.deepEqual(messageParams(id), {});
  });

  test("the store's question names the plan run and the asking apply", async () => {
    const asked: unknown[] = [];
    const since: StateUncheckedSince = async (request) => {
      asked.push(request);
      return false;
    };
    await since({ workspaceRoot: "/work", planRunId: "20261112T135722Z-79868fe5", applyRunId: "20261112T135733Z-194379b2" });
    assert.deepEqual(asked, [{ workspaceRoot: "/work", planRunId: "20261112T135722Z-79868fe5", applyRunId: "20261112T135733Z-194379b2" }]);
  });
});
