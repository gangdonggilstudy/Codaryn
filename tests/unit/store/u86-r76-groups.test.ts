/**
 * U-86, review R-76 (PM: M-1, L-1), the store's part: the table of R-76 section 2, fixed. For each state
 * and selection the preview's groups come from the plan's CLEANUP_ITEM_FATES and its `blocked`:
 * - confirm (removedWith []), include (["include_not_reverted"]), delete (["delete_discarded"]),
 *   both (["include_not_reverted", "delete_discarded"]: M-1, its own group now), kept (keptFor), and
 *   blocked (CleanupPlan.blocked: L-1, its own group at the end).
 * Then the same state is cleaned up for real with each of the four confirmations, and the number
 * removed is the review's "actual" column. And the groups add up to it: with a confirmation, what goes
 * is the confirm group and every group whose flags it gives (both only with both), never a kept or a
 * blocked item. States as R-76 names them (W1 to W10); fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { CLEANUP_ITEM_FATES, CLEANUP_LEFTOVER_MARK_FILE_NAME } from "../../../src/contracts/index.js";
import type { ApplyJournalEvent, CleanupPlan, CleanupSelection, ContentHash, EngineResult, JournalEvent, MaskedText } from "../../../src/contracts/index.js";
import { applyCleanup, createApplyJournal, createJournal, journalRelativePath, planCleanup, prepareDiscardedRoot, writeResult, writeRevertRecord } from "../../../src/store/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const R1 = "20260101T010000Z-0000000a";
const R2 = "20260101T020000Z-0000000b";
const P1 = "20260101T030000Z-0000000c";
const A1 = "20260101T040000Z-0000000d";
const LEFTOVER_ID = "0123456789abcdef";
const NOW = "2026-03-01T00:00:00.000Z";
const HASH = "a".repeat(64) as ContentHash;
const at = (runId: string): number => Date.UTC(2026, 0, 1, Number(runId.slice(9, 11)), 0, 1);
const STARTED = { type: "run_started", schemaVersion: 1, taskId: "t", workflow: "document", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 } } as unknown as JournalEvent;
const usage = { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 9 };
const state = (root: string, ...parts: string[]) => join(root, ".codaryn", ...parts);

async function modelRun(root: string, runId: string, changes: number, finished = true): Promise<void> {
  const journal = createJournal({ workspaceRoot: root, runId, clock: { now: () => at(runId) } });
  await journal.append(STARTED);
  for (let i = 0; i < changes; i += 1) await journal.append({ type: "file_changed", callId: `c${i}`, path: `f${i}.txt` as MaskedText, previousHash: null, newHash: HASH, created: true });
  if (finished) await journal.append({ type: "run_finished", status: "done", reason: "verified", usage });
  await journal.close();
  // A run without a result may still be running (no_result).
  if (!finished) return;
  const result: EngineResult = {
    schemaVersion: 1, kind: "run", runId, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted", verifiers: [],
    changes: Array.from({ length: changes }, (_, i) => ({ path: `f${i}.txt` as MaskedText, previousHash: null, newHash: HASH, created: true })),
    usage, journalPath: journalRelativePath(runId), notices: [],
  };
  await writeResult(root, result);
}
const reverted = (root: string, runId: string) =>
  writeRevertRecord(root, { schemaVersion: 1, kind: "revert_record", runId, at: "2026-01-01T09:00:00.000Z", status: "complete", reverted: 1, skipped: 0 });

/** P1 and its apply A1, which discarded one file; `revertedApply`: the apply reverted, its folder empty. */
async function planAndApply(root: string, revertedApply: boolean): Promise<void> {
  await modelRun(root, P1, 0);
  const started: ApplyJournalEvent = { type: "apply_started", schemaVersion: 1, planRunId: P1, taskId: "t", digest: HASH, approval: "cli-flag", actions: 1, maxDurationMs: 60_000 };
  const journal = createApplyJournal({ workspaceRoot: root, runId: A1, clock: { now: () => at(A1) } });
  await journal.append(started);
  await journal.close();
  const result = {
    schemaVersion: 1, kind: "apply", runId: A1, planRunId: P1, taskId: "t", digest: HASH, status: "done", reason: "verified", exitCode: 0,
    applied: [{ index: 0, action: { kind: "discard", path: "inbox/old-draft.tmp", sha256: HASH }, stored: "0" }], verifiers: [],
    usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 5 }, journalPath: journalRelativePath(A1), notices: [],
  };
  await writeFile(state(root, "runs", A1, "result.json"), `${JSON.stringify(result)}\n`, "utf8");
  const discarded = await prepareDiscardedRoot(root, A1);
  if (revertedApply) await reverted(root, A1);
  else await writeFile(join(discarded, "0"), "a person's draft\n", "utf8");
}

/** The states of R-76, made from nothing each time (the digest holds the files' change times). */
const STATES: { readonly [name: string]: (root: string) => Promise<void> } = {
  // W1: R1 reverted, R2 not.
  W1: async (root) => {
    await modelRun(root, R1, 2);
    await reverted(root, R1);
    await modelRun(root, R2, 1);
  },
  // W5: two runs not reverted; the second changed nothing.
  W5: async (root) => {
    await modelRun(root, R1, 1);
    await modelRun(root, R2, 0);
  },
  // W2: the plan run P1 and its apply A1, not reverted, a file in A1's discarded-files folder.
  W2: (root) => planAndApply(root, false),
  // W4: the same, the apply reverted: its folder is empty.
  W4: (root) => planAndApply(root, true),
  // W3: a leftover folder of an earlier cleanup (with its mark) and R2 not reverted.
  W3: async (root) => {
    await modelRun(root, R2, 1);
    await mkdir(state(root, `cleanup-${LEFTOVER_ID}`), { recursive: true });
    await writeFile(state(root, `cleanup-${LEFTOVER_ID}`, CLEANUP_LEFTOVER_MARK_FILE_NAME), `${JSON.stringify({ schemaVersion: 1, kind: "cleanup_leftover", leftoverId: LEFTOVER_ID })}\n`, "utf8");
    await writeFile(state(root, `cleanup-${LEFTOVER_ID}`, "rest"), "x", "utf8");
  },
  // W8: R1 reverted, R2 without a result.
  W8: async (root) => {
    await modelRun(root, R1, 2);
    await reverted(root, R1);
    await modelRun(root, R2, 1, false);
  },
  // W10: W2 with A1's records removed by hand: its folder has no records left.
  W10: async (root) => {
    await planAndApply(root, false);
    await rm(state(root, "runs", A1), { recursive: true });
  },
  // W6: W1 and a folder named like a leftover without the mark (shown only, never an item).
  W6: async (root) => {
    await modelRun(root, R1, 2);
    await reverted(root, R1);
    await modelRun(root, R2, 1);
    await mkdir(state(root, "cleanup-fedcba9876543210"), { recursive: true });
    await writeFile(state(root, "cleanup-fedcba9876543210", "x"), "x", "utf8");
  },
};

type Groups = { confirm?: number; include?: number; delete?: number; both?: number; kept?: number; blocked?: number };
/** The preview's groups of a plan: by each item's fate, then the blocked ones. Empty groups left out. */
function groupsOf(plan: CleanupPlan): Groups {
  const counts: Required<Groups> = { confirm: 0, include: 0, delete: 0, both: 0, kept: 0, blocked: plan.blocked.length };
  for (const fate of plan[CLEANUP_ITEM_FATES] ?? []) {
    if ("keptFor" in fate) counts.kept += 1;
    else if (fate.removedWith.length === 0) counts.confirm += 1;
    else if (fate.removedWith.length === 2) counts.both += 1;
    else if (fate.removedWith[0] === "include_not_reverted") counts.include += 1;
    else counts.delete += 1;
  }
  return Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0));
}

const OLDER = { olderThanDays: 0 };
// R-76 section 2: [state, selection's name, selection, the preview's groups (after M-1 and L-1),
// the number removed with none, --include-not-reverted, --delete-discarded, both].
const TABLE: readonly [string, string, CleanupSelection, Groups, readonly [number, number, number, number]][] = [
  ["W1", "--older-than 0", { runs: OLDER }, { confirm: 1, include: 1 }, [1, 2, 1, 2]],
  ["W1", "--run R2", { runs: { runIds: [R2] } }, { include: 1 }, [0, 1, 0, 1]],
  ["W1", "--reverted", { runs: { reverted: true } }, { confirm: 1 }, [1, 1, 1, 1]],
  ["W5", "--older-than 0", { runs: OLDER }, { confirm: 1, include: 1 }, [1, 2, 1, 2]],
  ["W2", "--older-than 0", { runs: OLDER }, { kept: 2 }, [0, 0, 0, 0]],
  ["W2", "--discarded-older-than 0", { discarded: OLDER }, { delete: 1 }, [0, 0, 1, 1]],
  ["W2", "--older-than 0 --discarded-older-than 0", { runs: OLDER, discarded: OLDER }, { delete: 1, both: 2 }, [0, 0, 1, 3]],
  ["W2", "--run P1", { runs: { runIds: [P1] } }, { blocked: 1 }, [0, 0, 0, 0]],
  ["W2", "--run A1", { runs: { runIds: [A1] } }, { kept: 1 }, [0, 0, 0, 0]],
  ["W2", "--run A1 --discarded-run A1", { runs: { runIds: [A1] }, discarded: { runIds: [A1] } }, { delete: 1, both: 1 }, [0, 0, 1, 2]],
  ["W2", "--run P1 --discarded-run A1", { runs: { runIds: [P1] }, discarded: { runIds: [A1] } }, { delete: 1, blocked: 1 }, [0, 0, 1, 1]],
  ["W4", "--older-than 0", { runs: OLDER }, { confirm: 2 }, [2, 2, 2, 2]],
  ["W4", "--older-than 0 --discarded-older-than 0", { runs: OLDER, discarded: OLDER }, { confirm: 2, delete: 1 }, [2, 2, 3, 3]],
  ["W3", "no selection", {}, { confirm: 1 }, [1, 1, 1, 1]],
  ["W3", "--older-than 0", { runs: OLDER }, { confirm: 1, include: 1 }, [1, 2, 1, 2]],
  ["W8", "--older-than 0", { runs: OLDER }, { confirm: 1, blocked: 1 }, [1, 1, 1, 1]],
  ["W10", "--older-than 0 --discarded-older-than 0", { runs: OLDER, discarded: OLDER }, { confirm: 1, delete: 1 }, [1, 1, 2, 2]],
  ["W6", "--older-than 0", { runs: OLDER }, { confirm: 1, include: 1 }, [1, 2, 1, 2]],
];
const CONFIRMATIONS = [
  { includeNotReverted: false, discarded: false },
  { includeNotReverted: true, discarded: false },
  { includeNotReverted: false, discarded: true },
  { includeNotReverted: true, discarded: true },
] as const;

async function made(name: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), `codaryn-r76-${name}-`)));
  roots.push(root);
  await (STATES[name] as (root: string) => Promise<void>)(root);
  return root;
}

describe("U-86, R-76 section 2: the preview's groups and what each confirmation removes", () => {
  for (const [name, selectionName, selection, groups, removed] of TABLE) {
    test(`${name}, ${selectionName}: groups ${JSON.stringify(groups)}; removed ${removed.join(", ")}`, async () => {
      assert.deepEqual(groupsOf(await planCleanup({ workspaceRoot: await made(name), selection, now: NOW })), groups, "the groups");
      for (const [index, confirmation] of CONFIRMATIONS.entries()) {
        const root = await made(name);
        const plan = await planCleanup({ workspaceRoot: root, selection, now: NOW });
        const outcome = await applyCleanup({ workspaceRoot: root, selection, now: NOW, confirmation: { digest: plan.digest, ...confirmation } });
        assert.ok(outcome.ok, JSON.stringify(outcome));
        if (!outcome.ok) continue;
        assert.equal(outcome.removed.length, removed[index], `removed with ${JSON.stringify(confirmation)}`);
        // The groups add up: the confirm group, each flag's group it gives, both only with both.
        const g = groupsOf(plan);
        const expected =
          (g.confirm ?? 0) + (confirmation.includeNotReverted ? (g.include ?? 0) : 0) + (confirmation.discarded ? (g.delete ?? 0) : 0) + (confirmation.includeNotReverted && confirmation.discarded ? (g.both ?? 0) : 0);
        assert.equal(outcome.removed.length, expected, `the groups add up with ${JSON.stringify(confirmation)}`);
      }
    });
  }
});
