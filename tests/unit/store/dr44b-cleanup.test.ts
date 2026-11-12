/**
 * DR-44 (R-34b, the last cleanup round), the store's part:
 * - P-1 (R-34b L-1): a run whose records cannot be checked (damaged) may have changed files that
 *   were never reverted, so it is warned about and confirmed apart like a run that was not reverted;
 * - P-2 (R-34b L-2): a leftover is a folder cleanup moved aside, known by the marker file cleanup
 *   writes into it, not by its name alone; a folder of that name without the marker is not removed,
 *   and a removal that fails keeps the marker so the folder stays a leftover.
 * The fixture is the one of dr44-cleanup.test.ts. Fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { CLEANUP_LOG_FILE_NAME } from "../../../src/contracts/index.js";
import type { ApplyJournalEvent, CleanupItemRef, ContentHash, EngineResult, JournalEvent, MaskedText } from "../../../src/contracts/index.js";
import {
  applyCleanup,
  applyCleanupWith,
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

const DAMAGED = "20260101T050000Z-0000000e"; // wrote a file, then its result.json was broken

async function damagedRun(root: string): Promise<void> {
  await modelRun(root, DAMAGED, 1);
  await writeFile(state(root, "runs", DAMAGED, "result.json"), "{", "utf8");
}

describe("DR-44 P-1, R-34b L-1: a run whose records cannot be checked is treated as not reverted", () => {
  test("it is warned about (not_reverted), counted, and goes only with includeNotReverted", async () => {
    const root = await workspace();
    await damagedRun(root);
    const selection = { runs: { runIds: [DAMAGED, FULL] } };
    const shown = await planCleanup({ workspaceRoot: root, selection, now: NOW });
    assert.deepEqual(shown.items.map((item) => [idOf(item), item.warnings]), [[FULL, []], [DAMAGED, ["not_reverted"]]]);
    assert.equal(shown.totals.runs.notReverted, 1);
    const without = await applyCleanup({ workspaceRoot: root, selection, now: NOW, confirmation: { digest: shown.digest, discarded: false, includeNotReverted: false } });
    assert.deepEqual(without.ok ? [without.removed.map(idOf), without.kept] : null, [[FULL], [{ target: "run", runId: DAMAGED, reason: "not_reverted_not_confirmed" }]]);
    const again = await planCleanup({ workspaceRoot: root, selection: { runs: { runIds: [DAMAGED] } }, now: NOW });
    const withIt = await applyCleanup({ workspaceRoot: root, selection: { runs: { runIds: [DAMAGED] } }, now: NOW, confirmation: { digest: again.digest, discarded: false, includeNotReverted: true } });
    assert.deepEqual(withIt.ok ? withIt.removed.map(idOf) : null, [DAMAGED]);
  });
});

describe("DR-44 P-2, R-34b L-2: a leftover is known by cleanup's marker, not by its name alone", () => {
  const busy = (): Error => Object.assign(new Error("resource busy"), { code: "EBUSY" });
  /** Fails for FULL's result.json, wherever it lies; removes everything else. */
  const failingForFullResult = async (path: string): Promise<void> => {
    if (path.endsWith("result.json") && (await readFile(path, "utf8")).includes(FULL)) throw busy();
    await rm(path, { recursive: true, force: true });
  };

  test("a folder named like a leftover that cleanup did not leave is not an item and is not removed", async () => {
    const root = await workspace();
    const stranger = state(root, "cleanup-0123456789abcdef");
    await mkdir(stranger, { recursive: true });
    await writeFile(join(stranger, "person.txt"), "a person's note\n", "utf8");
    const shown = await planCleanup({ workspaceRoot: root, selection: { runs: { runIds: [FULL] } }, now: NOW });
    assert.deepEqual(shown.items.map((item) => [item.target, idOf(item)]), [["run", FULL]]);
    assert.equal(shown.totals.leftovers.count, 0);
    assert.equal((await summarizeState({ workspaceRoot: root })).leftovers.count, 0);
    const outcome = await applyCleanup({ workspaceRoot: root, selection: { runs: { runIds: [FULL] } }, now: NOW, confirmation: { digest: shown.digest, discarded: false, includeNotReverted: false } });
    assert.deepEqual(outcome.ok ? outcome.removed.map(idOf) : null, [FULL]);
    assert.equal(await readFile(join(stranger, "person.txt"), "utf8"), "a person's note\n", "the folder cleanup did not leave stays");
  });

  test("what a partly failed removal leaves keeps the marker, so the next plan shows it and removes it", async () => {
    const root = await workspace();
    const selection = { runs: { runIds: [FULL] } };
    const shown = await planCleanup({ workspaceRoot: root, selection, now: NOW });
    const first = await applyCleanupWith({ workspaceRoot: root, selection, now: NOW, confirmation: { digest: shown.digest, discarded: false, includeNotReverted: false } }, { remove: failingForFullResult, retryDelayMs: 1 });
    assert.deepEqual(first.ok ? first.kept : null, [{ target: "run", runId: FULL, reason: "partly_removed" }]);
    const [left] = (await readdir(state(root))).filter((name) => /^cleanup-[0-9a-f]{16}$/.test(name));
    assert.ok(left !== undefined);
    assert.deepEqual((await readdir(state(root, left))).filter((name) => name !== "result.json").length, 1, "only the marker is left beside the file that could not go");
    const next = await planCleanup({ workspaceRoot: root, selection: {}, now: NOW });
    assert.deepEqual(next.items.map((item) => [item.target, idOf(item)]), [["leftover", left.slice("cleanup-".length)]]);
    const done = await applyCleanup({ workspaceRoot: root, selection: {}, now: NOW, confirmation: { digest: next.digest, discarded: false, includeNotReverted: false } });
    assert.deepEqual(done.ok ? done.removed.map(idOf) : null, [left.slice("cleanup-".length)]);
    assert.deepEqual((await readdir(state(root))).filter((name) => name.startsWith("cleanup-")), []);
  });
});
