/**
 * U-187 (DR-69 B-3 to B-7): the contract of a run that carries out an approved `run` plan.
 * - approvedPlanWritablePathSets: the task's lists, then the plan's files (source `plan`).
 * - ApprovedChangesPlan and ApprovedPlanRunDeps: the engine gets a gate factory, not a gate.
 * - Every write path is under the writable lists, a plan's proposal and apply included (PM on
 *   na-core U-182's question): the descriptors that judge them are writes.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PLANNED_FILE_DESCRIPTOR, PLAN_ACTION_DESCRIPTORS, approvedPlanWritablePathSets } from "../../../src/contracts/index.js";
import type { ApprovedChangesPlan, ApprovedPlanRunDeps, ContentHash, EngineDeps, StoredChangesPlan, WritablePathSet } from "../../../src/contracts/index.js";

const HASH = "d".repeat(64) as ContentHash;
const PLAN: StoredChangesPlan = {
  schemaVersion: 1,
  kind: "changes",
  runId: "20261113T080000Z-0000aaaa",
  summary: ["s"],
  files: [
    { path: "docs/a.md", change: "modify", sha256: HASH, shown: ["docs/a.md"] },
    { path: "docs/b.md", change: "create", sha256: null, shown: ["docs/b.md"] },
  ],
};

describe("U-187: approvedPlanWritablePathSets", () => {
  test("the task's lists first, then the plan's files as one list of source plan", () => {
    const task: readonly WritablePathSet[] = [
      { source: "config", entries: ["docs"] },
      { source: "task", entries: ["docs", "out"] },
    ];
    assert.deepEqual(approvedPlanWritablePathSets(task, PLAN), [...task, { source: "plan", entries: ["docs/a.md", "docs/b.md"] }]);
  });

  test("without task lists: the plan's files alone", () => {
    assert.deepEqual(approvedPlanWritablePathSets(undefined, PLAN), [{ source: "plan", entries: ["docs/a.md", "docs/b.md"] }]);
    assert.deepEqual(approvedPlanWritablePathSets([], PLAN), [{ source: "plan", entries: ["docs/a.md", "docs/b.md"] }]);
  });
});

describe("U-187: the deps of runApprovedPlan", () => {
  test("a gate factory in place of the gate, and the approved plan with its probe and claim", () => {
    const approved: ApprovedChangesPlan = {
      planRunId: PLAN.runId,
      digest: HASH,
      approval: "adapter",
      plan: PLAN,
      fileNow: async () => ({ kind: "missing" }),
      markApplied: async () => "marked",
    };
    type Shape = Pick<ApprovedPlanRunDeps, "approved" | "policyFor">;
    const shape: Shape = { approved, policyFor: () => ({}) as EngineDeps["policy"] };
    assert.equal(shape.approved.plan.files.length, 2);
    // @ts-expect-error the engine makes the gate itself (policyFor), so no gate is given
    const withGate: Pick<ApprovedPlanRunDeps, "policy"> = { policy: {} as EngineDeps["policy"] };
    assert.ok(withGate);
  });
});

describe("U-187: every write path is under the writable lists", () => {
  test("a planned file and every plan action are judged as writes", () => {
    assert.deepEqual(PLANNED_FILE_DESCRIPTOR.requires.paths.map((one) => one.access), ["write"]);
    for (const descriptor of Object.values(PLAN_ACTION_DESCRIPTORS)) {
      assert.ok(descriptor.requires.paths.length > 0 && descriptor.requires.paths.every((one) => one.access === "write"), descriptor.name);
    }
  });
});
