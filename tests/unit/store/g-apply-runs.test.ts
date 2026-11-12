/**
 * G-E: an apply run's records (ApplyJournal), its discarded directory (DR-9), and apply runs in the
 * run list next to model runs (DR-12: readers tell them apart by the first record). Fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import type { ApplyJournalEvent, ContentHash, MaskedText, RunListEntry } from "../../../src/contracts/index.js";
import { createApplyJournal, discardedRootPath, inspectRun, latestRunId, listRuns, prepareDiscardedRoot } from "../../../src/store/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-g-apply-")));
  roots.push(root);
  return root;
}

const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);
const PLAN_RUN = "20260102T030405Z-0a1b2c3d";
const APPLY_RUN = "20260102T030500Z-11111111";
const DIGEST = "d".repeat(64) as ContentHash;
const HASH_A = "a".repeat(64) as ContentHash;

const STARTED: ApplyJournalEvent = {
  type: "apply_started",
  schemaVersion: 1,
  planRunId: PLAN_RUN,
  taskId: "organize-task",
  digest: DIGEST,
  approval: "cli-flag",
  actions: 2,
  maxDurationMs: 60_000,
};

function applyResult(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "apply",
    runId: APPLY_RUN,
    planRunId: PLAN_RUN,
    taskId: "organize-task",
    digest: DIGEST,
    status: "done",
    reason: "verified",
    exitCode: 0,
    applied: [
      { index: 0, action: { kind: "move", from: "a.txt", to: "b/a.txt", sha256: HASH_A }, stored: null },
      { index: 1, action: { kind: "discard", path: "c.log", sha256: HASH_A }, stored: "1" },
    ],
    verifiers: [],
    usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 12 },
    journalPath: `.codaryn/runs/${APPLY_RUN}/journal.jsonl`,
    notices: [],
    ...extra,
  };
}

const clock = { now: () => Date.UTC(2026, 0, 2, 3, 5, 0, 120) };

async function applyRun(root: string, result: Record<string, unknown> | null = applyResult()): Promise<void> {
  const journal = createApplyJournal({ workspaceRoot: root, runId: APPLY_RUN, clock });
  await journal.append(STARTED);
  await journal.append({ type: "file_moved", index: 0, from: "a.txt" as MaskedText, to: "b/a.txt" as MaskedText, sha256: HASH_A });
  await journal.close();
  if (result !== null) await writeFile(join(root, ".codaryn", "runs", APPLY_RUN, "result.json"), `${JSON.stringify(result)}\n`, "utf8");
}

describe("createApplyJournal (G-E, DR-12)", () => {
  test("stores apply records with seq, at and runId, starting with apply_started; closed journals take no more", async () => {
    const root = await workspace();
    await applyRun(root, null);
    const lines = (await readFile(join(root, ".codaryn", "runs", APPLY_RUN, "journal.jsonl"), "utf8")).trimEnd().split("\n");
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(records[0], { seq: 1, at: "2026-01-02T03:05:00.120Z", runId: APPLY_RUN, ...STARTED });
    assert.equal(records[1]?.["type"], "file_moved");
    assert.equal(records[1]?.["seq"], 2);

    const journal = createApplyJournal({ workspaceRoot: root, runId: APPLY_RUN, clock });
    await journal.append({ type: "plan_item_failed", index: 1, problem: "io_error" });
    await journal.close();
    await assert.rejects(journal.append({ type: "plan_item_failed", index: 1, problem: "io_error" }));
    const again = (await readFile(join(root, ".codaryn", "runs", APPLY_RUN, "journal.jsonl"), "utf8")).trimEnd().split("\n");
    assert.equal(JSON.parse(again[2] as string).seq, 3, "an existing journal is continued");
  });
});

describe("discarded directory (G-E, DR-9)", () => {
  test("lies outside the run directories, is created once and reused", async () => {
    const root = await workspace();
    const expected = join(root, ".codaryn", "discarded", APPLY_RUN);
    assert.equal(discardedRootPath(root, APPLY_RUN), expected);
    assert.equal(await prepareDiscardedRoot(root, APPLY_RUN), expected);
    assert.equal(await prepareDiscardedRoot(root, APPLY_RUN), expected);
    assert.ok((await stat(expected)).isDirectory());
    assert.equal(await readFile(join(root, ".codaryn", ".gitignore"), "utf8"), "*\n");
    assert.equal(await exists(join(root, ".codaryn", "runs")), false, "no run directory is involved");
  });

  test("a link in place of the discarded directory is refused and nothing is written where it leads", async () => {
    const root = await workspace();
    const elsewhere = await workspace();
    await mkdir(join(root, ".codaryn"), { recursive: true });
    await symlink(elsewhere, join(root, ".codaryn", "discarded"), "junction");
    await assert.rejects(prepareDiscardedRoot(root, APPLY_RUN));
    assert.equal(await exists(join(elsewhere, APPLY_RUN)), false);
  });
});

describe("apply runs in the run list (G-E, DR-12)", () => {
  test("an apply run is checked from apply_started and its ApplyResult; its changes are the applied actions", async () => {
    const root = await workspace();
    await applyRun(root);
    const listing = await listRuns({ workspaceRoot: root });
    const entry = listing.runs[0] as Extract<RunListEntry, { state: "checked" }>;
    assert.deepEqual(entry, {
      state: "checked",
      runId: APPLY_RUN,
      startedAt: "2026-01-02T03:05:00.120Z",
      taskId: "organize-task",
      status: "done",
      reason: "verified",
      changes: 2,
      reverted: null,
      revertRecordDamaged: false,
    });
    assert.equal(await inspectRun(root, APPLY_RUN), "checked");
    assert.equal(await latestRunId(root), APPLY_RUN);
  });

  test("an apply run still in progress is listed without a status and is not latest", async () => {
    const root = await workspace();
    await applyRun(root, null);
    const listing = await listRuns({ workspaceRoot: root });
    assert.equal(listing.runs[0]?.state, "checked");
    assert.equal((listing.runs[0] as Extract<RunListEntry, { state: "checked" }>).status, null);
    assert.equal(await latestRunId(root), null);
  });

  test("an apply result that does not belong to its journal is damaged", async () => {
    const cases: Record<string, unknown>[] = [
      { planRunId: "20260102T000000Z-00000000" },
      { digest: "e".repeat(64) },
      { kind: "run" },
      { taskId: "other-task" },
      { applied: "two" },
      { reason: "model_error", status: "failed", exitCode: 1 },
    ];
    for (const extra of cases) {
      const root = await workspace();
      await applyRun(root, applyResult(extra));
      assert.deepEqual((await listRuns({ workspaceRoot: root })).runs, [{ state: "damaged", runId: APPLY_RUN }], JSON.stringify(extra));
    }
  });
});
