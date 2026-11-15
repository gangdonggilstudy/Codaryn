/**
 * U-13 (UXM-1, completing DR-44; contract 96c6ca9): an apply run's records are not removed while
 * its discarded-files folder still holds files, unless that folder is removed entirely in the same
 * cleanup. Such an apply is kept (discarded_left), its plan run with it (used_by_kept_apply), and
 * the rest goes. The folder is handled before the records. Fake values only.
 */

import assert from "node:assert/strict";
import { mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { after, describe, test } from "node:test";

import type { ApplyJournalEvent, CleanupItemRef, ContentHash, EngineResult, JournalEvent, MaskedText } from "../../../src/contracts/index.js";
import {
  applyCleanup,
  applyCleanupWith,
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
const APPLY = "20260101T040000Z-0000000d"; // with a discarded-files folder holding one file
const NOW = "2026-03-01T00:00:00.000Z";
const HASH = "a".repeat(64) as ContentHash;
const at = (runId: string): number => Date.UTC(2026, 0, 1, Number(runId.slice(9, 11)), 0, 1);
const STARTED = { type: "run_started", schemaVersion: 1, taskId: "t", workflow: "document", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 } } as unknown as JournalEvent;
const usage = { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 9 };
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

/** UXM-1's workspace: an applied plan that discarded a file and was not reverted, beside two other runs. */
async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u13-")));
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
  await writeFile(join(await prepareDiscardedRoot(root, APPLY), "2"), "a person's draft\n", "utf8");
  return root;
}

const ALL = { runs: { olderThanDays: 0 }, discarded: { olderThanDays: 0 } };
const confirm = (digest: string, discarded: boolean) => ({ digest, discarded, includeNotReverted: true });
type Outcome = Awaited<ReturnType<typeof applyCleanup>>;
const keptOf = (outcome: Outcome) => (outcome.ok ? outcome.kept.map((item) => [item.target, idOf(item), item.reason]) : outcome.code);
const removedOf = (outcome: Outcome) => (outcome.ok ? outcome.removed.map((item) => [item.target, idOf(item)]).sort() : outcome.code);

describe("U-13 (UXM-1): an apply run's records stay while its discarded files stay", () => {
  test("UXM-1's procedure (--include-not-reverted without --delete-discarded): the apply and its plan run stay, the rest goes", async () => {
    const root = await workspace();
    const shown = await planCleanup({ workspaceRoot: root, selection: ALL, now: NOW });
    const outcome = await applyCleanup({ workspaceRoot: root, selection: ALL, now: NOW, confirmation: confirm(shown.digest, false) });
    assert.deepEqual(keptOf(outcome), [["discarded", APPLY, "not_confirmed"], ["run", APPLY, "discarded_left"], ["run", PLAN, "used_by_kept_apply"]]);
    assert.deepEqual(removedOf(outcome), [["run", PART], ["run", FULL]]);
    assert.deepEqual((await readdir(state(root, "runs"))).sort(), [PLAN, APPLY]);
    assert.deepEqual(await readdir(state(root, "discarded", APPLY)), ["2"]);
  });

  test("the folder not selected at all: the same, whatever the discarded confirmation", async () => {
    const root = await workspace();
    const selection = { runs: { runIds: [APPLY, PLAN] } };
    const shown = await planCleanup({ workspaceRoot: root, selection, now: NOW });
    assert.deepEqual(shown.items.map((item) => [idOf(item), item.warnings]), [[APPLY, ["not_reverted", "discarded_left"]], [PLAN, []]]);
    const outcome = await applyCleanup({ workspaceRoot: root, selection, now: NOW, confirmation: confirm(shown.digest, true) });
    assert.deepEqual(keptOf(outcome), [["run", APPLY, "discarded_left"], ["run", PLAN, "used_by_kept_apply"]]);
    assert.deepEqual(removedOf(outcome), []);
  });

  test("the folder confirmed too: it goes, and then the apply's records and its plan run", async () => {
    const root = await workspace();
    const shown = await planCleanup({ workspaceRoot: root, selection: ALL, now: NOW });
    const outcome = await applyCleanup({ workspaceRoot: root, selection: ALL, now: NOW, confirmation: confirm(shown.digest, true) });
    assert.deepEqual(keptOf(outcome), []);
    assert.deepEqual(removedOf(outcome), [["discarded", APPLY], ["run", PART], ["run", FULL], ["run", PLAN], ["run", APPLY]]);
  });

  test("without includeNotReverted the apply's reason is not_reverted_not_confirmed", async () => {
    const root = await workspace();
    const selection = { runs: { runIds: [APPLY] } };
    const shown = await planCleanup({ workspaceRoot: root, selection, now: NOW });
    const outcome = await applyCleanup({ workspaceRoot: root, selection, now: NOW, confirmation: { digest: shown.digest, discarded: false, includeNotReverted: false } });
    assert.deepEqual(keptOf(outcome), [["run", APPLY, "not_reverted_not_confirmed"]]);
  });

  test("the folder's removal fails: the apply's records stay (discarded_left)", async () => {
    const root = await workspace();
    const shown = await planCleanup({ workspaceRoot: root, selection: ALL, now: NOW });
    const outcome = await applyCleanupWith(
      { workspaceRoot: root, selection: ALL, now: NOW, confirmation: confirm(shown.digest, true) },
      {
        remove: async (path: string) => {
          if (path.endsWith(`${sep}2`)) throw Object.assign(new Error("busy"), { code: "EBUSY" });
          await rm(path, { recursive: true, force: true });
        },
        retryDelayMs: 1,
      },
    );
    assert.deepEqual(keptOf(outcome), [["discarded", APPLY, "partly_removed"], ["run", APPLY, "discarded_left"], ["run", PLAN, "used_by_kept_apply"]]);
    assert.equal((await readdir(state(root, "runs", APPLY))).includes("result.json"), true);
  });

  test("an empty folder (as a complete revert leaves it) holds nothing to lose: no warning, the records go", async () => {
    const root = await workspace();
    await rm(state(root, "discarded", APPLY, "2"));
    const selection = { runs: { runIds: [APPLY, PLAN] } };
    const shown = await planCleanup({ workspaceRoot: root, selection, now: NOW });
    assert.deepEqual(shown.items.map((item) => [idOf(item), item.warnings]), [[APPLY, ["not_reverted"]], [PLAN, []]]);
    const outcome = await applyCleanup({ workspaceRoot: root, selection, now: NOW, confirmation: confirm(shown.digest, false) });
    assert.deepEqual([removedOf(outcome), keptOf(outcome)], [[["run", PLAN], ["run", APPLY]], []]);
  });
});

describe("U-13: the folder changes between the preview and the removal", () => {
  test("files appear in a folder that was empty at the preview: plan_changed, nothing removed", async () => {
    const root = await workspace();
    await rm(state(root, "discarded", APPLY, "2"));
    const selection = { runs: { runIds: [APPLY, PLAN] } };
    const shown = await planCleanup({ workspaceRoot: root, selection, now: NOW });
    await writeFile(state(root, "discarded", APPLY, "1"), "late\n", "utf8");
    const outcome = await applyCleanup({ workspaceRoot: root, selection, now: NOW, confirmation: confirm(shown.digest, false) });
    assert.equal(keptOf(outcome), "plan_changed");
    assert.equal((await readdir(state(root, "runs"))).includes(APPLY), true);
  });

  test("a confirmed folder that got another file since the preview: plan_changed, nothing removed", async () => {
    const root = await workspace();
    const shown = await planCleanup({ workspaceRoot: root, selection: ALL, now: NOW });
    await writeFile(state(root, "discarded", APPLY, "9"), "late\n", "utf8");
    const outcome = await applyCleanup({ workspaceRoot: root, selection: ALL, now: NOW, confirmation: confirm(shown.digest, true) });
    assert.equal(keptOf(outcome), "plan_changed");
    assert.deepEqual((await readdir(state(root, "discarded", APPLY))).sort(), ["2", "9"]);
  });

  test("a file put into the folder while the removal runs (after the plan was checked): the apply's records stay", async () => {
    const root = await workspace();
    await rm(state(root, "discarded", APPLY, "2"));
    // Another run's discarded folder is removed first; the file arrives while that goes on.
    await writeFile(join(await prepareDiscardedRoot(root, FULL), "0"), "another\n", "utf8");
    const selection = { runs: { runIds: [APPLY] }, discarded: { runIds: [FULL] } };
    const shown = await planCleanup({ workspaceRoot: root, selection, now: NOW });
    let put = false;
    const outcome = await applyCleanupWith(
      { workspaceRoot: root, selection, now: NOW, confirmation: confirm(shown.digest, true) },
      {
        remove: async (path: string) => {
          if (!put) {
            put = true;
            await writeFile(state(root, "discarded", APPLY, "3"), "late\n", "utf8");
          }
          await rm(path, { recursive: true, force: true });
        },
        retryDelayMs: 1,
      },
    );
    assert.equal(put, true);
    assert.deepEqual(keptOf(outcome), [["run", APPLY, "discarded_left"]]);
    assert.equal((await readdir(state(root, "runs"))).includes(APPLY), true);
  });
});

describe("U-13 (R-47 R47-M1): an apply run whose records cannot be checked is kept the same way", () => {
  /** R-47's B10: the apply run's journal no longer reads (its first line is not JSON). */
  const damage = async (root: string): Promise<void> => {
    await writeFile(state(root, "runs", APPLY, "journal.jsonl"), "not a record\n", "utf8");
  };
  /** The plan run's own record of which apply claimed it, as an apply writes it. */
  const claim = async (root: string): Promise<void> => {
    await writeFile(state(root, "runs", PLAN, "applied.json"), `${JSON.stringify({ schemaVersion: 1, kind: "plan_applied", planRunId: PLAN, applyRunId: APPLY, at: "2026-01-01T04:00:01.000Z" })}\n`, "utf8");
  };

  test("B10 (--include-not-reverted without --delete-discarded): the damaged apply and the plan run that names it stay; the preview warns", async () => {
    const root = await workspace();
    await claim(root);
    await damage(root);
    const shown = await planCleanup({ workspaceRoot: root, selection: ALL, now: NOW });
    assert.deepEqual(shown.items.find((item) => item.target === "run" && idOf(item) === APPLY)?.warnings, ["records_unreadable", "discarded_left"]);
    const outcome = await applyCleanup({ workspaceRoot: root, selection: ALL, now: NOW, confirmation: confirm(shown.digest, false) });
    assert.deepEqual(keptOf(outcome), [["discarded", APPLY, "not_confirmed"], ["run", APPLY, "discarded_left"], ["run", PLAN, "used_by_kept_apply"]]);
    assert.deepEqual(removedOf(outcome), [["run", PART], ["run", FULL]]);
    assert.deepEqual((await readdir(state(root, "runs"))).sort(), [PLAN, APPLY]);
    assert.deepEqual(await readdir(state(root, "discarded", APPLY)), ["2"]);
  });

  test("the folder confirmed too: everything goes", async () => {
    const root = await workspace();
    await claim(root);
    await damage(root);
    const shown = await planCleanup({ workspaceRoot: root, selection: ALL, now: NOW });
    const outcome = await applyCleanup({ workspaceRoot: root, selection: ALL, now: NOW, confirmation: confirm(shown.digest, true) });
    assert.deepEqual(keptOf(outcome), []);
    assert.deepEqual(await readdir(state(root, "runs")), []);
  });

  test("the plan run alone is not removed while the damaged apply that used it stays with its discarded files", async () => {
    const root = await workspace();
    await claim(root);
    await damage(root);
    const shown = await planCleanup({ workspaceRoot: root, selection: { runs: { runIds: [PLAN] } }, now: NOW });
    assert.deepEqual([shown.items, shown.blocked], [[], [{ target: "run", runId: PLAN, code: "plan_used_by_apply" }]]);
  });

  test("no record of which plan it used: the damaged apply still stays (its plan run cannot be told)", async () => {
    const root = await workspace();
    await damage(root);
    const selection = { runs: { runIds: [APPLY] } };
    const shown = await planCleanup({ workspaceRoot: root, selection, now: NOW });
    const outcome = await applyCleanup({ workspaceRoot: root, selection, now: NOW, confirmation: confirm(shown.digest, false) });
    assert.deepEqual(keptOf(outcome), [["run", APPLY, "discarded_left"]]);
  });

  test("a damaged run without discarded files is as before: records_unreadable only, removed with includeNotReverted", async () => {
    const root = await workspace();
    await damage(root);
    await rm(state(root, "discarded", APPLY, "2"));
    const selection = { runs: { runIds: [APPLY] } };
    const shown = await planCleanup({ workspaceRoot: root, selection, now: NOW });
    assert.deepEqual(shown.items.map((item) => item.warnings), [["records_unreadable"]]);
    const outcome = await applyCleanup({ workspaceRoot: root, selection, now: NOW, confirmation: confirm(shown.digest, false) });
    assert.deepEqual([removedOf(outcome), keptOf(outcome)], [[["run", APPLY]], []]);
  });
});
