/**
 * U-86 (C-18, UXM-10, UXM-1; PM: plan B; contract c0c9933), the store's part:
 * - planCleanup's plan carries each item's fate under CLEANUP_ITEM_FATES (CleanupItemFate): the fewest
 *   flags besides --confirm with which applyCleanup removes it (removedWith, in CLEANUP_CONFIRM_FLAGS
 *   order), or why no confirmation removes it in this selection (keptFor: used_by_kept_apply,
 *   discarded_left). People's preview is grouped by it. It must say what applyCleanup does: here each
 *   fate is checked against a real applyCleanup on the same workspace, for two workspaces, seven
 *   selections and the four confirmations (removals succeeding): an item is removed exactly when its
 *   removedWith is within the flags given, and a keptFor item is kept for that reason with both.
 * - summarizeState carries, under STATE_DISCARDED_WITHOUT_RECORDS, the discarded-files folders that
 *   hold files and whose run has no records left (UXM-1).
 * Both under symbol keys: the JSON (cleanup --json) and the digest do not change. Fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { CLEANUP_CONFIRM_FLAGS, CLEANUP_ITEM_FATES, STATE_DISCARDED_WITHOUT_RECORDS } from "../../../src/contracts/index.js";
import type {
  ApplyJournalEvent,
  CleanupConfirmFlag,
  CleanupItem,
  CleanupItemFate,
  CleanupPlan,
  CleanupSelection,
  ContentHash,
  EngineResult,
  JournalEvent,
  MaskedText,
} from "../../../src/contracts/index.js";
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

const ALL: CleanupSelection = { runs: { olderThanDays: 0 }, discarded: { olderThanDays: 0 } };
const SELECTIONS: readonly [string, CleanupSelection][] = [
  ["every run record and every discarded folder", ALL],
  ["every run record", { runs: { olderThanDays: 0 } }],
  ["the apply run and its plan run", { runs: { runIds: [APPLY, PLAN] } }],
  ["the apply run alone", { runs: { runIds: [APPLY] } }],
  ["the plan run alone (blocked while its apply stays)", { runs: { runIds: [PLAN] } }],
  ["the discarded folders alone", { discarded: { olderThanDays: 0 } }],
  ["the reverted runs", { runs: { reverted: true } }],
];
const CONFIRMATIONS: readonly (readonly CleanupConfirmFlag[])[] = [[], ["include_not_reverted"], ["delete_discarded"], ["include_not_reverted", "delete_discarded"]];

const idOf = (item: { target: string; runId?: string; leftoverId?: string }): string => item.runId ?? item.leftoverId ?? "?";
const nameOf = (item: CleanupItem): string => `${item.target} ${idOf(item)}`;
const fatesOf = (plan: CleanupPlan): readonly CleanupItemFate[] => plan[CLEANUP_ITEM_FATES] ?? [];
const goesWith = (fate: CleanupItemFate | undefined, flags: readonly CleanupConfirmFlag[]): boolean =>
  fate !== undefined && "removedWith" in fate && fate.removedWith.every((flag) => flags.includes(flag));
/** Each item's fate by name, for the readable cases. */
const byName = (plan: CleanupPlan): Record<string, CleanupItemFate | undefined> =>
  Object.fromEntries(plan.items.map((item, index) => [nameOf(item), fatesOf(plan)[index]]));

describe("U-86: the plan carries each item's fate, as applyCleanup decides", () => {
  for (const applyReverted of [false, true]) {
    for (const [name, selection] of SELECTIONS) {
      test(`${applyReverted ? "the apply reverted" : "the apply not reverted"}, ${name}: removed exactly with its removedWith; keptFor kept for that reason`, async () => {
        for (const flags of CONFIRMATIONS) {
          const root = await workspace(applyReverted);
          const plan = await planCleanup({ workspaceRoot: root, selection, now: NOW });
          const fates = fatesOf(plan);
          assert.equal(fates.length, plan.items.length, flags.join(","));
          for (const fate of fates) {
            if ("removedWith" in fate) assert.deepEqual([...fate.removedWith], CLEANUP_CONFIRM_FLAGS.filter((flag) => fate.removedWith.includes(flag)), "in order, each once");
          }
          const outcome = await applyCleanup({
            workspaceRoot: root, selection, now: NOW,
            confirmation: { digest: plan.digest, includeNotReverted: flags.includes("include_not_reverted"), discarded: flags.includes("delete_discarded") },
          });
          assert.ok(outcome.ok, `${flags.join(",")}: ${JSON.stringify(outcome)}`);
          if (!outcome.ok) continue;
          const expected = plan.items.filter((_, index) => goesWith(fates[index], flags)).map(nameOf).sort();
          assert.deepEqual(outcome.removed.map((item) => `${item.target} ${idOf(item)}`).sort(), expected, `[${flags.join(",")}]: removed`);
          if (flags.length === CLEANUP_CONFIRM_FLAGS.length) {
            const keptFor = plan.items.flatMap((item, index) => {
              const fate = fates[index];
              return fate !== undefined && "keptFor" in fate ? [`${nameOf(item)} ${fate.keptFor}`] : [];
            });
            assert.deepEqual(outcome.kept.map((item) => `${item.target} ${idOf(item)} ${item.reason}`).sort(), keptFor.sort(), "with both: kept for its reason");
          }
        }
      });
    }
  }

  test("the readable case: every run record and every folder, the apply not reverted", async () => {
    const plan = await planCleanup({ workspaceRoot: await workspace(false), selection: ALL, now: NOW });
    assert.deepEqual(byName(plan), {
      [`run ${LONE}`]: { removedWith: ["include_not_reverted"] },
      [`run ${APPLY}`]: { removedWith: ["include_not_reverted", "delete_discarded"] },
      [`run ${PLAN}`]: { removedWith: ["include_not_reverted", "delete_discarded"] },
      [`run ${FULL}`]: { removedWith: [] },
      [`run ${PART}`]: { removedWith: ["include_not_reverted"] },
      [`discarded ${APPLY}`]: { removedWith: ["delete_discarded"] },
    });
  });

  test("the apply and its plan run without the folder: no confirmation removes them", async () => {
    const plan = await planCleanup({ workspaceRoot: await workspace(false), selection: { runs: { runIds: [APPLY, PLAN] } }, now: NOW });
    assert.deepEqual(byName(plan), { [`run ${APPLY}`]: { keptFor: "discarded_left" }, [`run ${PLAN}`]: { keptFor: "used_by_kept_apply" } });
  });

  test("the apply reverted: its folder is empty, so it and its plan run go with --confirm alone", async () => {
    const plan = await planCleanup({ workspaceRoot: await workspace(true), selection: { runs: { runIds: [APPLY, PLAN] } }, now: NOW });
    assert.deepEqual(byName(plan), { [`run ${APPLY}`]: { removedWith: [] }, [`run ${PLAN}`]: { removedWith: [] } });
  });

  test("the JSON and the digest do not carry the fates; a spread copy keeps them; a preview writes nothing", async () => {
    const root = await workspace(false);
    const before = (await readdir(state(root), { recursive: true })).sort();
    const plan = await planCleanup({ workspaceRoot: root, selection: ALL, now: NOW });
    assert.deepEqual(Object.keys(plan).sort(), ["blocked", "digest", "items", "parked", "totals"]);
    const json = JSON.stringify(plan);
    for (const word of ["removedWith", "keptFor", "include_not_reverted", "delete_discarded"]) assert.equal(json.includes(word), false, word);
    assert.deepEqual({ ...plan }[CLEANUP_ITEM_FATES], plan[CLEANUP_ITEM_FATES]);
    // The same digest as a second plan of the same state: the fates are outside it.
    assert.equal((await planCleanup({ workspaceRoot: root, selection: ALL, now: NOW })).digest, plan.digest);
    assert.deepEqual((await readdir(state(root), { recursive: true })).sort(), before);
  });
});

describe("U-86 (UXM-1): the summary's discarded-files folders whose run has no records", () => {
  const withoutRecords = async (root: string) => (await summarizeState({ workspaceRoot: root }))[STATE_DISCARDED_WITHOUT_RECORDS];

  test("none while every folder's run has its records; the summary's JSON is as before", async () => {
    const root = await workspace(false);
    const summary = await summarizeState({ workspaceRoot: root });
    assert.deepEqual(summary[STATE_DISCARDED_WITHOUT_RECORDS], { count: 0, files: 0, bytes: 0 });
    assert.equal(JSON.stringify(summary).includes("withoutRecords"), false);
    assert.deepEqual(Object.keys(summary).sort(), ["discarded", "entries", "leftovers", "parked", "runs"]);
  });

  test("an apply whose records were removed by hand: its folder, with its file, counts", async () => {
    const root = await workspace(false);
    await rm(state(root, "runs", APPLY), { recursive: true });
    await rm(state(root, "runs", PLAN), { recursive: true });
    assert.deepEqual(await withoutRecords(root), { count: 1, files: 1, bytes: Buffer.byteLength(DRAFT) });
  });

  test("an empty folder holds nothing to lose: not counted; a name that is no run id is not a folder of a run", async () => {
    const root = await workspace(true);
    await rm(state(root, "runs", APPLY), { recursive: true });
    await mkdir(state(root, "discarded", ".notes"), { recursive: true });
    await writeFile(state(root, "discarded", ".notes", "x"), "x", "utf8");
    assert.deepEqual(await withoutRecords(root), { count: 0, files: 0, bytes: 0 });
  });

  test("no state directory: none", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u86-empty-")));
    roots.push(root);
    assert.deepEqual(await withoutRecords(root), { count: 0, files: 0, bytes: 0 });
  });
});
