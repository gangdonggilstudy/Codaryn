/**
 * DR-39 (DR-9, R-19 I-5): summarizeState, planCleanup and applyCleanup. A preview by default; run
 * records and discarded-files folders are confirmed apart; parked files and the lock are never
 * removed; the running run, a run with no result and a plan an unselected apply uses are blocked; a
 * marked run is only warned about; the log line holds counts and sizes only. Fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { CLEANUP_LOG_FILE_NAME, RECORDS_CHANGED_FILE_NAME } from "../../../src/contracts/index.js";
import type { ApplyJournalEvent, CleanupPlan, ContentHash, EngineResult, JournalEvent, MaskedText } from "../../../src/contracts/index.js";
import {
  acquireLock,
  applyCleanup,
  createApplyJournal,
  createJournal,
  journalRelativePath,
  listRuns,
  planCleanup,
  prepareDiscardedRoot,
  releaseLock,
  summarizeState,
  writeResult,
  writeRevertRecord,
} from "../../../src/store/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const OLD = "20260101T010000Z-0000000a"; // a model run, not reverted, one change
const REVERTED = "20260101T020000Z-0000000b"; // a model run, reverted
const PLAN = "20260101T030000Z-0000000c"; // the plan run the apply uses
const APPLY = "20260101T040000Z-0000000d"; // an apply run with a discarded-files folder
const RUNNING = "20260102T050000Z-0000000e"; // started, no result, holds the lock
const NOW = "2026-03-01T00:00:00.000Z";
const at = (runId: string): number => Date.UTC(Number(runId.slice(0, 4)), Number(runId.slice(4, 6)) - 1, Number(runId.slice(6, 8)), Number(runId.slice(9, 11)), 0, 1);
const HASH = "a".repeat(64) as ContentHash;
const STARTED = { type: "run_started", schemaVersion: 1, taskId: "t", workflow: "document", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 } } as unknown as JournalEvent;
const usage = { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 9 };
const state = (root: string, ...parts: string[]) => join(root, ".codaryn", ...parts);
const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);

async function modelRun(root: string, runId: string, changes: number, finished = true): Promise<void> {
  const journal = createJournal({ workspaceRoot: root, runId, clock: { now: () => at(runId) } });
  await journal.append(STARTED);
  for (let i = 0; i < changes; i += 1) await journal.append({ type: "file_changed", callId: `c${i}`, path: `f${i}.txt` as MaskedText, previousHash: null, newHash: HASH, created: true });
  if (finished) await journal.append({ type: "run_finished", status: "done", reason: "verified", usage });
  await journal.close();
  if (!finished) return;
  const result: EngineResult = {
    schemaVersion: 1, kind: "run", runId, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted", verifiers: [],
    changes: Array.from({ length: changes }, (_, i) => ({ path: `f${i}.txt` as MaskedText, previousHash: null, newHash: HASH, created: true })),
    usage, journalPath: journalRelativePath(runId), notices: [],
  };
  await writeResult(root, result);
}

async function applyRun(root: string): Promise<void> {
  const started: ApplyJournalEvent = { type: "apply_started", schemaVersion: 1, planRunId: PLAN, taskId: "t", digest: HASH, approval: "cli-flag", actions: 1, maxDurationMs: 60_000 };
  const journal = createApplyJournal({ workspaceRoot: root, runId: APPLY, clock: { now: () => at(APPLY) } });
  await journal.append(started);
  await journal.close();
  const result = {
    schemaVersion: 1, kind: "apply", runId: APPLY, planRunId: PLAN, taskId: "t", digest: HASH, status: "done", reason: "verified", exitCode: 0,
    applied: [{ index: 0, action: { kind: "discard", path: "c.log", sha256: HASH }, stored: "1" }], verifiers: [],
    usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 5 }, journalPath: journalRelativePath(APPLY), notices: [],
  };
  await writeFile(state(root, "runs", APPLY, "result.json"), `${JSON.stringify(result)}\n`, "utf8");
  const discarded = await prepareDiscardedRoot(root, APPLY);
  await writeFile(join(discarded, "1"), "a person's discarded file\n", "utf8");
  await writeFile(join(discarded, "2"), "another\n", "utf8");
}

async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-dr39-")));
  roots.push(root);
  await modelRun(root, OLD, 1);
  await modelRun(root, REVERTED, 1);
  await writeRevertRecord(root, { schemaVersion: 1, kind: "revert_record", runId: REVERTED, at: "2026-01-01T02:10:00.000Z", status: "complete", reverted: 1, skipped: 0 });
  await modelRun(root, PLAN, 0);
  await applyRun(root);
  await modelRun(root, RUNNING, 0, false);
  await mkdir(state(root, "parked", OLD), { recursive: true });
  await writeFile(state(root, "parked", OLD, "0-abc"), "parked\n", "utf8");
  return root;
}

const plan = (root: string, selection: Parameters<typeof planCleanup>[0]["selection"]): Promise<CleanupPlan> => planCleanup({ workspaceRoot: root, selection, now: NOW });

describe("DR-39 summarizeState", () => {
  test("counts runs, discarded-files folders and parked files with sizes, newest first, no file names", async () => {
    const root = await workspace();
    const summary = await summarizeState({ workspaceRoot: root });
    assert.equal(summary.runs.count, 5);
    assert.deepEqual(summary.entries.map((entry) => entry.runId), [RUNNING, APPLY, PLAN, REVERTED, OLD]);
    const byId = Object.fromEntries(summary.entries.map((entry) => [entry.runId, entry]));
    assert.deepEqual([byId[APPLY]?.kind, byId[APPLY]?.status, byId[APPLY]?.discarded?.files], ["apply", "done", 2]);
    assert.deepEqual([byId[REVERTED]?.reverted, byId[OLD]?.reverted, byId[RUNNING]?.status, byId[OLD]?.discarded], [true, false, null, null]);
    assert.ok((byId[OLD]?.records.files ?? 0) >= 2 && (byId[OLD]?.records.bytes ?? 0) > 0);
    assert.equal(summary.runs.bytes, summary.entries.reduce((sum, entry) => sum + entry.records.bytes, 0));
    assert.deepEqual([summary.runs.oldest, summary.runs.newest], ["2026-01-01T01:00:01.000Z", "2026-01-02T05:00:01.000Z"]);
    assert.deepEqual(summary.discarded, { runs: 1, files: 2, bytes: "a person's discarded file\n".length + "another\n".length });
    assert.deepEqual(summary.parked, { files: 1, bytes: "parked\n".length });
    assert.equal(JSON.stringify(summary).includes("0-abc") || JSON.stringify(summary).includes("c.log"), false);
  });
});

describe("DR-39 planCleanup", () => {
  test("selects by every criterion given; a part with none selects nothing", async () => {
    const root = await workspace();
    assert.deepEqual((await plan(root, {})).items, []);
    assert.deepEqual((await plan(root, { runs: {} })).items, []);
    assert.deepEqual((await plan(root, { runs: { reverted: true } })).items.map((item) => item.runId), [REVERTED]);
    assert.deepEqual((await plan(root, { runs: { olderThanDays: 58, runIds: [OLD, RUNNING] } })).items.map((item) => item.runId), [OLD]);
  });

  test("blocks the running run, a run with no result and a plan that an unselected apply uses; warns otherwise", async () => {
    const root = await workspace();
    const lock = await acquireLock({ workspaceRoot: root, runId: RUNNING, clock: { now: () => Date.parse(NOW) } });
    assert.ok(lock.ok);
    try {
      const shown = await plan(root, { runs: { runIds: [OLD, PLAN, RUNNING, REVERTED] } });
      assert.deepEqual(shown.items.map((item) => [item.target, item.runId, item.warnings]), [["run", REVERTED, []], ["run", OLD, ["not_reverted"]]]);
      assert.deepEqual(shown.blocked, [{ target: "run", runId: RUNNING, code: "lock_held" }, { target: "run", runId: PLAN, code: "plan_used_by_apply" }]);
    } finally {
      await releaseLock({ workspaceRoot: root, runId: RUNNING });
    }
    assert.deepEqual((await plan(root, { runs: { runIds: [RUNNING] } })).blocked, [{ target: "run", runId: RUNNING, code: "no_result" }]);
    const both = await plan(root, { runs: { runIds: [PLAN, APPLY] } });
    assert.deepEqual(both.items.map((item) => [item.runId, item.warnings]), [[APPLY, ["not_reverted", "discarded_left"]], [PLAN, []]]);
    assert.deepEqual(both.blocked, []);
    const people = await plan(root, { discarded: { runIds: [APPLY] } });
    assert.deepEqual(people.items.map((item) => [item.target, item.runId, item.warnings, item.size.files]), [["discarded", APPLY, ["people_files"], 2]]);
    assert.deepEqual(people.totals.discarded, { count: 1, files: 2, bytes: "a person's discarded file\n".length + "another\n".length });
  });

  test("a marked run is warned about, not blocked", async () => {
    const root = await workspace();
    await writeFile(state(root, "runs", OLD, RECORDS_CHANGED_FILE_NAME), "{", "utf8");
    assert.deepEqual((await plan(root, { runs: { runIds: [OLD] } })).items.map((item) => item.warnings), [["not_reverted", "records_changed"]]);
  });

  test("the digest is the same for the same state and changes when an item's files change", async () => {
    const root = await workspace();
    const first = await plan(root, { runs: { runIds: [OLD] } });
    assert.equal((await plan(root, { runs: { runIds: [OLD] } })).digest, first.digest);
    assert.match(first.digest, /^[0-9a-f]{64}$/);
    await writeFile(state(root, "runs", OLD, "review.json"), "{}\n", "utf8");
    assert.notEqual((await plan(root, { runs: { runIds: [OLD] } })).digest, first.digest);
  });
});

describe("DR-39 applyCleanup", () => {
  test("removes only what the confirmed plan holds; people's files need their own confirmation; parked and the lock stay", async () => {
    const root = await workspace();
    const selection = { runs: { runIds: [PLAN, APPLY, OLD] }, discarded: { runIds: [APPLY] } };
    const shown = await plan(root, selection);
    const outcome = await applyCleanup({ workspaceRoot: root, selection, now: NOW, confirmation: { digest: shown.digest, discarded: false } });
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.removed.map((item) => [item.target, item.runId]), [["run", APPLY], ["run", PLAN], ["run", OLD]]);
    assert.deepEqual(outcome.kept, [{ target: "discarded", runId: APPLY, reason: "not_confirmed" }]);
    assert.deepEqual((await listRuns({ workspaceRoot: root })).runs.map((entry) => entry.runId), [RUNNING, REVERTED]);
    assert.equal(await exists(state(root, "discarded", APPLY, "1")), true);
    assert.equal(await exists(state(root, "parked", OLD, "0-abc")), true);
    assert.deepEqual((await readdir(state(root))).filter((name) => name.startsWith("cleanup-")), [], "nothing half removed is left");
    const log = (await readFile(state(root, CLEANUP_LOG_FILE_NAME), "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(log.length, 1);
    assert.deepEqual(Object.keys(log[0] ?? {}).sort(), ["at", "discarded", "runs", "schemaVersion"]);
    assert.deepEqual([(log[0]?.["runs"] as { count: number }).count, (log[0]?.["discarded"] as { count: number }).count], [3, 0]);
    assert.equal(JSON.stringify(log).includes("2026010"), false, "no run id in the log");

    const people = await plan(root, { discarded: { runIds: [APPLY] } });
    const second = await applyCleanup({ workspaceRoot: root, selection: { discarded: { runIds: [APPLY] } }, now: NOW, confirmation: { digest: people.digest, discarded: true } });
    assert.ok(second.ok);
    assert.deepEqual(second.removed.map((item) => [item.target, item.runId, item.size.files]), [["discarded", APPLY, 2]]);
    assert.equal(await exists(state(root, "discarded", APPLY)), false);
  });

  test("another digest or a held lock removes nothing", async () => {
    const root = await workspace();
    const selection = { runs: { runIds: [OLD] } };
    const shown = await plan(root, selection);
    await writeFile(state(root, "runs", OLD, "review.json"), "{}\n", "utf8");
    assert.deepEqual(await applyCleanup({ workspaceRoot: root, selection, now: NOW, confirmation: { digest: shown.digest, discarded: false } }), { ok: false, code: "plan_changed" });
    const lock = await acquireLock({ workspaceRoot: root, runId: RUNNING, clock: { now: () => Date.parse(NOW) } });
    assert.ok(lock.ok);
    try {
      const again = await plan(root, selection);
      assert.deepEqual(await applyCleanup({ workspaceRoot: root, selection, now: NOW, confirmation: { digest: again.digest, discarded: false } }), { ok: false, code: "workspace_locked" });
    } finally {
      await releaseLock({ workspaceRoot: root, runId: RUNNING });
    }
    assert.equal(await exists(state(root, "runs", OLD)), true);
  });
});
