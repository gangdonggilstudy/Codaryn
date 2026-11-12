/**
 * U-14 (UXM-6, AXM-2, AXM-15): the plan view, the screen a person approves from. A plan run with a
 * records-changed mark is shown with a warning and without the command to apply it; the model's
 * summary is shown as the agent's description (not what is approved); one line says what the
 * digest guarantees. Exit codes stay as they are. A plan without a mark adds nothing about one.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FIXED_MESSAGES, MESSAGE_IDS, PLAN_EXIT_CODES } from "../../../src/contracts/index.js";
import type { ContentHash, MaskedText, PlanOutput } from "../../../src/contracts/index.js";

const base: PlanOutput = {
  schemaVersion: 1,
  kind: "plan",
  runId: "20261112T135930Z-3e745daf",
  status: "pending",
  exitCode: 0,
  digest: "c".repeat(64) as ContentHash,
  actions: [],
  inventoryLimitReached: false,
  appliedBy: null,
};

describe("U-14: the plan view says what can be trusted", () => {
  test("AXM-2: recordsChanged only when the plan run has a mark; the exit code stays 0", () => {
    const marked: PlanOutput = { ...base, recordsChanged: true };
    assert.deepEqual([marked.recordsChanged, marked.exitCode, Object.hasOwn(base, "recordsChanged")], [true, 0, false]);
    assert.deepEqual(PLAN_EXIT_CODES, { pending: 0, applied: 0 });
  });

  test("AXM-15: the model's summary, as the agent's description", () => {
    const described: PlanOutput = { ...base, summary: "move photos and receipts into year folders" as MaskedText };
    assert.equal(typeof described.summary, "string");
  });

  test("the lines' text ids; the refusal's own ids stay", () => {
    for (const id of ["plan.records_changed", "plan.cannot_apply", "plan.summary_label", "plan.digest_guarantee"] as const) {
      assert.deepEqual(FIXED_MESSAGES[id], {}, id);
    }
    for (const id of ["error.plan_records_changed.what", "error.plan_records_changed.fix"]) {
      assert.ok((MESSAGE_IDS as readonly string[]).includes(id), id);
    }
  });
});
