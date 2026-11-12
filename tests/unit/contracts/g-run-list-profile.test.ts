/**
 * DR-37 (d): a run list entry names the profile and the workflow definition the run was made with,
 * from what `run_started` records; the resolved task carries the profile to the engine.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PROFILE_NAME_PATTERN_SOURCE, WORKFLOW_ID_PATTERN_SOURCE, toRunId } from "../../../src/contracts/index.js";
import type { JournalEvent, ResolvedTaskSpec, RunId, RunListEntry } from "../../../src/contracts/index.js";

const runId = toRunId("20261112T120000Z-0000abcd") as RunId;

describe("DR-37 (d): the run list carries the run's profile and workflow definition", () => {
  test("a checked entry: names or null; absent in lists from before", () => {
    const named: RunListEntry = { state: "checked", runId, startedAt: "2026-11-12T12:00:00Z", taskId: "quick", status: "done", reason: "verified", changes: 1, reverted: null, profile: "safe", workflowRef: "code" };
    const none: RunListEntry = { state: "checked", runId, startedAt: "2026-11-12T12:00:00Z", taskId: "quick", status: null, reason: null, changes: null, reverted: null, profile: null, workflowRef: null };
    const before: RunListEntry = { state: "checked", runId, startedAt: "2026-11-12T12:00:00Z", taskId: "quick", status: null, reason: null, changes: null, reverted: null };
    assert.ok(named && none && before);
    for (const name of ["safe", "review-2", "a.b_c"]) {
      assert.match(name, new RegExp(PROFILE_NAME_PATTERN_SOURCE));
      assert.match(name, new RegExp(WORKFLOW_ID_PATTERN_SOURCE));
    }
    assert.equal(PROFILE_NAME_PATTERN_SOURCE, WORKFLOW_ID_PATTERN_SOURCE, "one rule for both names");
  });

  test("the resolved task carries the profile; run_started records it", () => {
    const task: Pick<ResolvedTaskSpec, "profile"> = { profile: "safe" };
    const started: Extract<JournalEvent, { type: "run_started" }>["profile"] = "safe";
    assert.equal(task.profile, started);
  });
});
