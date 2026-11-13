/**
 * U-86 (C-18, UXM-10, UXM-1; PM: plan B), the store's part: a cleanup preview tells, for each item,
 * what a confirmed cleanup does with it under each confirmation (--confirm alone, with
 * --include-not-reverted, with --delete-discarded, with both): removed, or kept and why
 * (not_reverted_not_confirmed, discarded_left, used_by_kept_apply with the apply run that keeps the
 * plan run, not_confirmed). People's preview is grouped by it. It must say what applyCleanup does:
 * each prediction here is checked against a real applyCleanup on the same workspace, for two
 * workspaces, seven selections and the four confirmations (removals succeeding).
 * And the summary's records-less discarded-files folders (UXM-1): folders holding files whose run
 * has no records any more.
 * Before the contract (p4g-general) names the symbol key the preview carries them under, the store
 * gives them through previewCleanup and recordlessDiscarded; planCleanup's plan is as before.
 * Fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import type { ApplyJournalEvent, CleanupItem, CleanupSelection, ContentHash, EngineResult, JournalEvent, MaskedText } from "../../../src/contracts/index.js";
import { previewCleanup, recordlessDiscarded } from "../../../src/store/cleanup.js";
import type { PredictedCleanupFate } from "../../../src/store/cleanup.js";
import {
  applyCleanup,
  createApplyJournal,
  createJournal,
  journalRelativePath,
  planCleanup,
  prepareDiscardedRoot,
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
const APPLY = "20260101T040000Z-0000000d"; // its discarded-files folder holds one file, unless reverted
const LONE = "20260101T050000Z-0000000e"; // one change, not reverted
const NOW = "2026-03-01T00:00:00.000Z";
const HASH = "a".repeat(64) as ContentHash;
const DRAFT = "a person's draft\n";
const at = (runId: string): number => Date.UTC(2026, 0, 1, Number(runId.slice(9, 11)), 0, 1);
const STARTED = { type: "run_started", schemaVersion: 1, taskId: "t", workflow: "document", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 } } as unknown as JournalEvent;
const usage = { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 9 };
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

/** A plain run partly reverted, one fully reverted, one not reverted, and an applied plan that discarded a file. */
async function workspace(applyReverted: boolean): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u86-")));
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
    applied: [{ index: 2, action: { kind: "discard", path: "inbox/old-draft.tmp", sha256: HASH }, stored: "2" }], verifiers: [],
    usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 5 }, journalPath: journalRelativePath(APPLY), notices: [],
  };
  await writeFile(state(root, "runs", APPLY, "result.json"), `${JSON.stringify(result)}\n`, "utf8");
  const discarded = await prepareDiscardedRoot(root, APPLY);
  // A complete revert puts the file back and leaves the folder empty.
  if (applyReverted) {
    await writeRevertRecord(root, { schemaVersion: 1, kind: "revert_record", runId: APPLY, at: "2026-01-01T04:10:00.000Z", status: "complete", reverted: 1, skipped: 0 });
  } else {
    await writeFile(join(discarded, "2"), DRAFT, "utf8");
  }
  await modelRun(root, LONE, 1);
  return root;
}

const SELECTIONS: readonly [string, CleanupSelection][] = [
  ["every run record and every discarded folder", { runs: { olderThanDays: 0 }, discarded: { olderThanDays: 0 } }],
  ["every run record", { runs: { olderThanDays: 0 } }],
  ["the apply run and its plan run", { runs: { runIds: [APPLY, PLAN] } }],
  ["the apply run alone", { runs: { runIds: [APPLY] } }],
  ["the plan run alone (blocked while its apply stays)", { runs: { runIds: [PLAN] } }],
  ["the discarded folders alone", { discarded: { olderThanDays: 0 } }],
  ["the reverted runs", { runs: { reverted: true } }],
];
const CONFIRMATIONS = [
  { name: "--confirm alone", includeNotReverted: false, discarded: false },
  { name: "with --include-not-reverted", includeNotReverted: true, discarded: false },
  { name: "with --delete-discarded", includeNotReverted: false, discarded: true },
  { name: "with both", includeNotReverted: true, discarded: true },
] as const;

const idOf = (item: { target: string; runId?: string; leftoverId?: string }): string => item.runId ?? item.leftoverId ?? "?";
const predictedRemoved = (items: readonly CleanupItem[], fates: readonly PredictedCleanupFate[]) =>
  items.flatMap((item, index) => (fates[index]?.removed === true ? [`${item.target} ${idOf(item)}`] : [])).sort();
const predictedKept = (items: readonly CleanupItem[], fates: readonly PredictedCleanupFate[]) =>
  items.flatMap((item, index) => {
    const fate = fates[index];
    return fate !== undefined && !fate.removed ? [`${item.target} ${idOf(item)} ${fate.reason}`] : [];
  }).sort();

describe("U-86: a cleanup preview says what a confirmed cleanup does with each item", () => {
  for (const applyReverted of [false, true]) {
    for (const [name, selection] of SELECTIONS) {
      test(`${applyReverted ? "the apply reverted" : "the apply not reverted"}, ${name}: each confirmation's prediction is what applyCleanup does`, async () => {
        for (const confirmation of CONFIRMATIONS) {
          const root = await workspace(applyReverted);
          const preview = await previewCleanup({ workspaceRoot: root, selection, now: NOW }, [confirmation]);
          const fates = preview.fates[0] ?? [];
          assert.equal(fates.length, preview.plan.items.length, confirmation.name);
          const outcome = await applyCleanup({
            workspaceRoot: root, selection, now: NOW,
            confirmation: { digest: preview.plan.digest, includeNotReverted: confirmation.includeNotReverted, discarded: confirmation.discarded },
          });
          assert.ok(outcome.ok, `${confirmation.name}: ${JSON.stringify(outcome)}`);
          if (!outcome.ok) continue;
          assert.deepEqual(outcome.removed.map((item) => `${item.target} ${idOf(item)}`).sort(), predictedRemoved(preview.plan.items, fates), `${confirmation.name}: removed`);
          assert.deepEqual(outcome.kept.map((item) => `${item.target} ${idOf(item)} ${item.reason}`).sort(), predictedKept(preview.plan.items, fates), `${confirmation.name}: kept`);
        }
      });
    }
  }

  test("a plan run kept with its apply names that apply run", async () => {
    const root = await workspace(false);
    const preview = await previewCleanup({ workspaceRoot: root, selection: { runs: { runIds: [APPLY, PLAN] } }, now: NOW }, [CONFIRMATIONS[0], CONFIRMATIONS[3]]);
    const plan = preview.plan.items.findIndex((item) => item.target === "run" && item.runId === PLAN);
    assert.deepEqual(preview.fates[0]?.[plan], { removed: false, reason: "used_by_kept_apply", keptWith: APPLY });
    // With both confirmations the folder is not selected, so the apply and its plan run still stay.
    assert.deepEqual(preview.fates[1]?.[plan], { removed: false, reason: "used_by_kept_apply", keptWith: APPLY });
  });

  test("several confirmations at once give one list each, in order; the plan is planCleanup's, unchanged", async () => {
    const root = await workspace(false);
    const selection = { runs: { olderThanDays: 0 }, discarded: { olderThanDays: 0 } };
    const preview = await previewCleanup({ workspaceRoot: root, selection, now: NOW }, CONFIRMATIONS);
    assert.equal(preview.fates.length, 4);
    assert.deepEqual(preview.plan, await planCleanup({ workspaceRoot: root, selection, now: NOW }));
    assert.deepEqual(Object.keys(preview.plan).sort(), ["blocked", "digest", "items", "parked", "totals"]);
    // --confirm alone removes only the fully reverted run here; with both, everything selected.
    assert.deepEqual(predictedRemoved(preview.plan.items, preview.fates[0] ?? []), [`run ${FULL}`]);
    assert.equal(predictedKept(preview.plan.items, preview.fates[3] ?? []).length, 0);
  });

  test("no confirmation asked: no list; nothing is removed or written by a preview", async () => {
    const root = await workspace(false);
    const before = (await readdir(state(root), { recursive: true })).sort();
    const preview = await previewCleanup({ workspaceRoot: root, selection: { runs: { olderThanDays: 0 } }, now: NOW }, []);
    assert.deepEqual(preview.fates, []);
    assert.deepEqual((await readdir(state(root), { recursive: true })).sort(), before);
  });
});

describe("U-86 (UXM-1): discarded-files folders whose run has no records", () => {
  test("none while every folder's run has its records", async () => {
    assert.deepEqual(await recordlessDiscarded({ workspaceRoot: await workspace(false) }), { count: 0, files: 0, bytes: 0 });
  });

  test("an apply whose records were removed by hand: its folder, with its file, counts", async () => {
    const root = await workspace(false);
    await rm(state(root, "runs", APPLY), { recursive: true });
    await rm(state(root, "runs", PLAN), { recursive: true });
    assert.deepEqual(await recordlessDiscarded({ workspaceRoot: root }), { count: 1, files: 1, bytes: Buffer.byteLength(DRAFT) });
  });

  test("an empty folder holds nothing to lose: not counted; a name that is no run id is not a folder of a run", async () => {
    const root = await workspace(true);
    await rm(state(root, "runs", APPLY), { recursive: true });
    await mkdir(state(root, "discarded", ".notes"), { recursive: true });
    await writeFile(state(root, "discarded", ".notes", "x"), "x", "utf8");
    assert.deepEqual(await recordlessDiscarded({ workspaceRoot: root }), { count: 0, files: 0, bytes: 0 });
  });

  test("no state directory: none", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u86-empty-")));
    roots.push(root);
    assert.deepEqual(await recordlessDiscarded({ workspaceRoot: root }), { count: 0, files: 0, bytes: 0 });
  });
});
