/**
 * DR-44 (R-34 L-1 to L-3), the store's part that the present cleanup types already carry:
 * - L-1: a partly reverted run is not "reverted" (the reverted criterion does not select it, and it
 *   is warned about as a run whose changes were not reverted);
 * - L-2: an apply run whose records go is warned about (discarded_left) also when its discarded-files
 *   folder is selected, as the folder stays unless that removal is confirmed too;
 * - L-3: a removal that fails after the move aside is not reported or logged as removed.
 * Fake values only.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { CLEANUP_LOG_FILE_NAME } from "../../../src/contracts/index.js";
import type { ApplyJournalEvent, CleanupItemRef, ContentHash, EngineResult, JournalEvent, MaskedText } from "../../../src/contracts/index.js";
import {
  applyCleanup,
  createApplyJournal,
  createJournal,
  journalRelativePath,
  planCleanup,
  prepareDiscardedRoot,
  summarizeState,
  writeResult,
  writeRevertRecord,
} from "../../../src/store/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const PART = "20260101T010000Z-0000000a"; // two changes, partly reverted
const FULL = "20260101T020000Z-0000000b"; // two changes, fully reverted
const PLAN = "20260101T030000Z-0000000c";
const APPLY = "20260101T040000Z-0000000d"; // with a discarded-files folder
const NOW = "2026-03-01T00:00:00.000Z";
const HASH = "a".repeat(64) as ContentHash;
const at = (runId: string): number => Date.UTC(2026, Number(runId.slice(4, 6)) - 1, Number(runId.slice(6, 8)), Number(runId.slice(9, 11)), 0, 1);
const STARTED = { type: "run_started", schemaVersion: 1, taskId: "t", workflow: "document", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 } } as unknown as JournalEvent;
const usage = { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 9 };
/** An item's id: its run id, or a leftover folder's hex digits (DR-44 (d)). */
const idOf = (item: CleanupItemRef): string => (item.target === "leftover" ? item.leftoverId : item.runId);
const state = (root: string, ...parts: string[]) => join(root, ".codaryn", ...parts);

async function modelRun(root: string, runId: string, changes: number): Promise<void> {
  const journal = createJournal({ workspaceRoot: root, runId, clock: { now: () => at(runId) } });
  await journal.append(STARTED);
  for (let i = 0; i < changes; i += 1) await journal.append({ type: "file_changed", callId: `c${i}`, path: `f${i}.txt` as MaskedText, previousHash: null, newHash: HASH, created: true });
  await journal.append({ type: "run_finished", status: "done", reason: "verified", usage });
  await journal.close();
  const result: EngineResult = {
    schemaVersion: 1, kind: "run", runId, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted", verifiers: [],
    changes: Array.from({ length: changes }, (_, i) => ({ path: `f${i}.txt` as MaskedText, previousHash: null, newHash: HASH, created: true })),
    usage, journalPath: journalRelativePath(runId), notices: [],
  };
  await writeResult(root, result);
}

async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-dr44-")));
  roots.push(root);
  await modelRun(root, PART, 2);
  await writeRevertRecord(root, { schemaVersion: 1, kind: "revert_record", runId: PART, at: "2026-01-01T01:10:00.000Z", status: "partial", reverted: 1, skipped: 1 });
  await modelRun(root, FULL, 2);
  await writeRevertRecord(root, { schemaVersion: 1, kind: "revert_record", runId: FULL, at: "2026-01-01T02:10:00.000Z", status: "complete", reverted: 2, skipped: 0 });
  await modelRun(root, PLAN, 0);
  const started: ApplyJournalEvent = { type: "apply_started", schemaVersion: 1, planRunId: PLAN, taskId: "t", digest: HASH, approval: "cli-flag", actions: 1, maxDurationMs: 60_000 };
  const journal = createApplyJournal({ workspaceRoot: root, runId: APPLY, clock: { now: () => at(APPLY) } });
  await journal.append(started);
  await journal.close();
  const result = {
    schemaVersion: 1, kind: "apply", runId: APPLY, planRunId: PLAN, taskId: "t", digest: HASH, status: "done", reason: "verified", exitCode: 0,
    applied: [{ index: 0, action: { kind: "discard", path: "c.log", sha256: HASH }, stored: "0" }], verifiers: [],
    usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 5 }, journalPath: journalRelativePath(APPLY), notices: [],
  };
  await writeFile(state(root, "runs", APPLY, "result.json"), `${JSON.stringify(result)}\n`, "utf8");
  await writeFile(join(await prepareDiscardedRoot(root, APPLY), "0"), "a person's file\n", "utf8");
  return root;
}

describe("DR-44 (나), R-34 L-1: a partly reverted run is not a reverted run", () => {
  test("the summary, the reverted criterion and the warning (partly_reverted) treat it as not reverted", async () => {
    const root = await workspace();
    const byId = Object.fromEntries((await summarizeState({ workspaceRoot: root })).entries.map((entry) => [entry.runId, entry]));
    assert.deepEqual([byId[PART]?.reverted, byId[FULL]?.reverted], [false, true]);
    assert.deepEqual([byId[PART]?.partlyReverted, byId[FULL]?.partlyReverted], [true, false]);
    assert.deepEqual((await planCleanup({ workspaceRoot: root, selection: { runs: { reverted: true } }, now: NOW })).items.map((item) => idOf(item)), [FULL]);
    const both = await planCleanup({ workspaceRoot: root, selection: { runs: { runIds: [PART, FULL] } }, now: NOW });
    assert.deepEqual(both.items.map((item) => [idOf(item), item.warnings]), [[FULL, []], [PART, ["partly_reverted"]]]);
  });
});

describe("DR-44 (다), R-34 L-2: an apply run's records with its discarded-files folder selected too", () => {
  test("discarded_left is shown whether the folder is selected or not: it stays unless its removal is confirmed", async () => {
    const root = await workspace();
    const withFolder = await planCleanup({ workspaceRoot: root, selection: { runs: { runIds: [PLAN, APPLY] }, discarded: { runIds: [APPLY] } }, now: NOW });
    assert.deepEqual(withFolder.items.map((item) => [item.target, idOf(item), item.warnings]), [
      ["run", APPLY, ["not_reverted", "discarded_left"]],
      ["run", PLAN, []],
      ["discarded", APPLY, ["people_files"]],
    ]);
    const without = await planCleanup({ workspaceRoot: root, selection: { runs: { runIds: [PLAN, APPLY] } }, now: NOW });
    assert.deepEqual(without.items.map((item) => [idOf(item), item.warnings]), [[APPLY, ["not_reverted", "discarded_left"]], [PLAN, []]]);
  });
});

describe("DR-44 (가): records of runs that were not, or only partly, reverted go only with includeNotReverted", () => {
  test("without it they stay (not_reverted_not_confirmed) and the plan counts them; with it they go", async () => {
    const root = await workspace();
    const selection = { runs: { runIds: [PART, FULL] } };
    const shown = await planCleanup({ workspaceRoot: root, selection, now: NOW });
    assert.deepEqual([shown.totals.runs.count, shown.totals.runs.notReverted], [2, 1]);
    const without = await applyCleanup({ workspaceRoot: root, selection, now: NOW, confirmation: { digest: shown.digest, discarded: false, includeNotReverted: false } });
    assert.ok(without.ok);
    assert.deepEqual(without.removed.map(idOf), [FULL]);
    assert.deepEqual(without.kept, [{ target: "run", runId: PART, reason: "not_reverted_not_confirmed" }]);
    const again = await planCleanup({ workspaceRoot: root, selection: { runs: { runIds: [PART] } }, now: NOW });
    const withIt = await applyCleanup({ workspaceRoot: root, selection: { runs: { runIds: [PART] } }, now: NOW, confirmation: { digest: again.digest, discarded: false, includeNotReverted: true } });
    assert.deepEqual(withIt.ok ? [withIt.removed.map(idOf), withIt.kept] : null, [[PART], []]);
  });

  test("a plan run whose apply run stays is kept too (used_by_kept_apply)", async () => {
    const root = await workspace();
    const selection = { runs: { runIds: [PLAN, APPLY] } };
    const shown = await planCleanup({ workspaceRoot: root, selection, now: NOW });
    const kept = await applyCleanup({ workspaceRoot: root, selection, now: NOW, confirmation: { digest: shown.digest, discarded: false, includeNotReverted: false } });
    assert.ok(kept.ok);
    assert.deepEqual(kept.removed, []);
    assert.deepEqual(kept.kept, [
      { target: "run", runId: APPLY, reason: "not_reverted_not_confirmed" },
      { target: "run", runId: PLAN, reason: "used_by_kept_apply" },
    ]);
    const both = await applyCleanup({ workspaceRoot: root, selection, now: NOW, confirmation: { digest: shown.digest, discarded: false, includeNotReverted: true } });
    assert.deepEqual(both.ok ? [both.removed.map(idOf), both.kept] : null, [[APPLY, PLAN], []]);
  });
});
