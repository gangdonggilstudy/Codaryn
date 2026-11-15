/**
 * U-29 (R-44 R44-L1): an apply also tells what a run before it could not check. A run between the
 * plan run and the apply (or the plan run itself) whose state check was limited may have changed
 * the plan run's records without a mark; a later cleanup makes the apply's own check complete, so
 * that alone does not tell. The store looks at those runs' journals; the engine tells the same kind.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ApplyDeps, StateUncheckedSince } from "../../../src/contracts/index.js";

describe("U-29: an earlier limited check is told by the apply", () => {
  test("the store's question and the apply's dependency", async () => {
    const asked: string[] = [];
    const since: StateUncheckedSince = async (request) => {
      asked.push(request.planRunId);
      return true;
    };
    const deps: Pick<ApplyDeps, "planRecordsUnchecked"> = {
      planRecordsUnchecked: () => since({ workspaceRoot: "/work", planRunId: "20261112T135722Z-79868fe5", applyRunId: "20261112T135733Z-194379b2" }),
    };
    assert.equal(await deps.planRecordsUnchecked?.(), true);
    assert.deepEqual(asked, ["20261112T135722Z-79868fe5"]);
  });
});
