/**
 * U-271 (p5a's G-sec, U-274, low): the engine host read every plan status but "applied" as "pending", so an
 * output whose status the contract does not have (PLAN_STATUSES: pending, applied) was shown as a plan to
 * approve and got a token. Both plan kinds now close such an output as host_error (gsec-approvals.test.ts
 * checks a plan of moves; this one checks a run plan, and that the two statuses still pass).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { planValue } from "../../src/engine-host/plans.js";

const RUN_ID = "20261114T030000Z-0000c271";
const changesOutput = (status: unknown) => ({
  ok: true,
  output: {
    schemaVersion: 1,
    kind: "plan",
    planKind: "changes",
    runId: RUN_ID,
    status,
    exitCode: 0,
    digest: "ab".repeat(32),
    files: [{ path: "docs/new.md", change: "create", sha256: null }],
    summary: "Add the guide",
    appliedBy: null,
  },
});

test("U-271 (G-sec): a run plan whose status the contract does not have is host_error; pending and applied pass", () => {
  for (const status of ["stale", "gsec-unknown", 1, null, undefined]) {
    assert.deepEqual(planValue(changesOutput(status), (text) => text), { ok: false, code: "host_error" }, String(status));
  }
  for (const status of ["pending", "applied"]) {
    assert.equal((planValue(changesOutput(status), (text) => text) as { status?: unknown }).status, status);
  }
});
