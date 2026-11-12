/**
 * DR-38: the contract of detecting changes to Codaryn's own records during a run (state.ts): the
 * reason, the record, the guard the engine calls, the records-changed mark and how views show it.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  FIXED_MESSAGES,
  MAX_STATE_ENTRIES,
  MAX_STATE_HASH_BYTES,
  MESSAGE_IDS,
  RECORDS_CHANGED_FILE_NAME,
  RUN_REASONS,
  RUN_REASONS_BY_STATUS,
  STATE_CHECK_PHASES,
  STATE_TIERS,
} from "../../../src/contracts/index.js";
import type {
  EngineDeps,
  EngineResult,
  JournalEvent,
  MaskedText,
  RawText,
  RecordsChangedMark,
  ReportOutput,
  RevertOutput,
  RunListEntry,
  StateComparison,
  StateFingerprint,
  StateGuard,
} from "../../../src/contracts/index.js";

const masked = (text: string) => text as MaskedText;

describe("DR-38: changes to the run records during a run", () => {
  test("the reason is failed/state_changed (P-1), listed for message ids", () => {
    assert.ok((RUN_REASONS_BY_STATUS.failed as readonly string[]).includes("state_changed"));
    assert.equal((RUN_REASONS_BY_STATUS["needs-input"] as readonly string[]).includes("state_changed"), false);
    assert.ok((RUN_REASONS as readonly string[]).includes("state_changed"));
    for (const id of ["reason.state_changed", "advice.state_changed"]) assert.ok((MESSAGE_IDS as readonly string[]).includes(id), id);
  });

  test("phases, tiers and limits", () => {
    assert.deepEqual([...STATE_CHECK_PHASES], ["run_start", "before_command", "after_command", "before_verify", "after_verify", "run_end"]);
    assert.deepEqual([...STATE_TIERS], ["run", "state"]);
    assert.deepEqual([MAX_STATE_ENTRIES, MAX_STATE_HASH_BYTES], [20_000, 32 * 1024 * 1024]);
  });

  test("the guard the engine calls, its record and its result", async () => {
    const fingerprint = (tier: "run" | "state") => ({ tier }) as unknown as StateFingerprint;
    const marked: MaskedText[][] = [];
    const guard: StateGuard = {
      capture: async (tier) => fingerprint(tier),
      compare: (before): StateComparison => ({ changed: before.tier === "run" ? ["runs/r1/snapshots/shown-0.json" as RawText] : [], limited: before.tier === "state" }),
      markRecordsChanged: async (changed) => {
        marked.push([...changed]);
      },
    };
    const deps: Pick<EngineDeps, "stateGuard"> = { stateGuard: guard };
    const comparison = deps.stateGuard?.compare(await guard.capture("run"), await guard.capture("run"));
    await guard.markRecordsChanged((comparison?.changed ?? []).map((path) => masked(path)));
    assert.deepEqual(marked, [["runs/r1/snapshots/shown-0.json"]]);
    const record: Extract<JournalEvent, { type: "state_checked" }> = { type: "state_checked", phase: "after_command", callId: "c1", changed: [masked("runs/r1/snapshots/shown-0.json")], limited: false };
    const result: Pick<EngineResult, "status" | "reason" | "stateChanged"> = { status: "failed", reason: "state_changed", stateChanged: record.changed };
    assert.equal(result.stateChanged?.length, 1);
  });

  test("the mark and how views show it", () => {
    assert.equal(RECORDS_CHANGED_FILE_NAME, "records-changed.json");
    const mark: RecordsChangedMark = {
      schemaVersion: 1,
      kind: "records_changed",
      runId: "20261112T120000Z-0000abcd",
      detections: [{ detectedBy: "20261112T130000Z-0000bbbb", at: "2026-11-12T13:00:00Z", paths: [masked("runs/20261112T120000Z-0000abcd/result.json")] }],
    };
    const entry: Pick<Extract<RunListEntry, { state: "checked" }>, "recordsChanged"> = { recordsChanged: true };
    const report: Pick<ReportOutput, "recordsChanged"> = { recordsChanged: true };
    const revert: Pick<RevertOutput, "recordsChanged"> = { recordsChanged: true };
    assert.ok(mark && entry.recordsChanged && report.recordsChanged && revert.recordsChanged);
    for (const id of ["runs.records_changed", "report.records_changed", "changes.records_changed", "revert.records_changed", "progress.state_unchecked"] as const) {
      assert.deepEqual(FIXED_MESSAGES[id], {}, id);
    }
    assert.deepEqual(FIXED_MESSAGES["progress.state_changed"], { count: "count" });
  });
});
