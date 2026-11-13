/**
 * U-269 (the CLI migration's C-2, AC-D3; nc-human's test of U-262's store change): a journal's `append`
 * resolves with the record it stored, `{seq, at, runId, ...event}`.
 * - The record is the line, character for character (JSON.stringify of it, then LF), for a run journal,
 *   for an apply journal (the start record `plan_item_started` too, ApplyJournalEntryRecord) and for the
 *   recorders' journals.
 * - Appends made together resolve in the order they were made, each with its own line.
 * - A journal of the same run continued counts on from the file's lines (seq), as the store always did.
 * - An append that is refused writes nothing and does not stop the next one (the queue goes on); an
 *   append after close is refused, the one before it is stored.
 * - The recorders' journals resolve after the state guard noted the line (DR-38): right after `append`
 *   resolves, the run's records show no change that is not the run's.
 * Temporary folders only; fake values.
 */

import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import type { ApplyJournalEntry, ContentHash, JournalEvent, MaskedText } from "../../../src/contracts/index.js";
import { createApplyJournal, createApplyRecorders, createJournal, createRunRecorders, journalRelativePath } from "../../../src/store/index.js";

const roots: string[] = [];
const journals: { close(): Promise<void> }[] = [];
after(async () => {
  for (const journal of journals) await journal.close().catch(() => undefined);
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const RUN = "20260102T030405Z-0a1b2c3d";
const PLAN = "20260102T030300Z-22222222";
const APPLY = "20260102T030500Z-11111111";
/** A clock that moves 7 ms per call, so every record's `at` differs. */
function movingClock(): { now(): number } {
  let ms = Date.UTC(2026, 0, 2, 3, 4, 5, 0);
  return { now: () => (ms += 7) };
}
const step = (n: number): JournalEvent => ({ type: "tool_decision", callId: `c${n}`, tool: "read_file", decision: "allow" }) as unknown as JournalEvent;
const STARTED = {
  type: "apply_started",
  schemaVersion: 1,
  planRunId: PLAN,
  taskId: "t",
  digest: "d".repeat(64) as ContentHash,
  approval: "cli-flag",
  actions: 1,
  maxDurationMs: 60_000,
} as unknown as ApplyJournalEntry;
const ITEM_STARTED = { type: "plan_item_started", index: 0, action: { kind: "move", from: "a.txt" as MaskedText, to: "sorted/a.txt" as MaskedText } } as unknown as ApplyJournalEntry;
const MOVED = { type: "file_moved", index: 0, from: "a.txt" as MaskedText, to: "sorted/a.txt" as MaskedText, sha256: "a".repeat(64) as ContentHash } as unknown as ApplyJournalEntry;

async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u269-")));
  roots.push(root);
  return root;
}
const journalFile = (root: string, runId: string): string => join(root, ...journalRelativePath(runId).split("/"));
/** The journal's lines, each without its LF. */
async function linesOf(root: string, runId: string): Promise<string[]> {
  const text = await readFile(journalFile(root, runId), "utf8");
  assert.ok(text.endsWith("\n"), "every line ends with LF");
  return text.slice(0, -1).split("\n");
}

describe("U-269: append resolves with the record it stored", () => {
  test("a run journal: each record is its line, character for character; seq from 1, at from the clock, the run id", async () => {
    const root = await workspace();
    const clock = movingClock();
    const journal = createJournal({ workspaceRoot: root, runId: RUN, clock });
    journals.push(journal);
    const records = [];
    for (const n of [1, 2, 3]) records.push(await journal.append(step(n)));
    const lines = await linesOf(root, RUN);
    assert.equal(lines.length, 3);
    records.forEach((record, at) => {
      assert.equal(JSON.stringify(record), lines[at], `record ${at + 1}`);
      assert.equal(record.seq, at + 1);
      assert.equal(record.runId, RUN);
      assert.equal(record.type, "tool_decision");
    });
    assert.equal(new Set(records.map((record) => record.at)).size, 3, "each its own time");
    assert.deepEqual(
      records.map((record) => Date.parse(record.at)),
      [...records.map((record) => Date.parse(record.at))].sort((a, b) => a - b),
    );
  });

  test("appends made together resolve in the order they were made, each with its own line", async () => {
    const root = await workspace();
    const journal = createJournal({ workspaceRoot: root, runId: RUN, clock: movingClock() });
    journals.push(journal);
    const records = await Promise.all([1, 2, 3, 4].map((n) => journal.append(step(n))));
    const lines = await linesOf(root, RUN);
    assert.deepEqual(
      records.map((record) => record.seq),
      [1, 2, 3, 4],
    );
    assert.deepEqual(
      records.map((record) => JSON.stringify(record)),
      lines,
    );
    assert.deepEqual(
      records.map((record) => (record as unknown as { callId: string }).callId),
      ["c1", "c2", "c3", "c4"],
    );
  });

  test("a journal of the same run continued: seq goes on from the file's lines, and the record is the new line", async () => {
    const root = await workspace();
    const first = createJournal({ workspaceRoot: root, runId: RUN, clock: movingClock() });
    await first.append(step(1));
    await first.append(step(2));
    await first.close();
    const second = createJournal({ workspaceRoot: root, runId: RUN, clock: movingClock() });
    journals.push(second);
    const record = await second.append(step(3));
    const lines = await linesOf(root, RUN);
    assert.equal(record.seq, 3);
    assert.equal(lines.length, 3);
    assert.equal(JSON.stringify(record), lines[2]);
  });
});

describe("U-269: the queue after a refused append, and close", () => {
  test("an append refused for an incomplete last line writes nothing; the next one on the same journal is stored with the file's count", async () => {
    const root = await workspace();
    const file = journalFile(root, RUN);
    await mkdir(join(file, ".."), { recursive: true });
    const firstLine = JSON.stringify({ seq: 1, at: "2026-01-02T03:04:05.000Z", runId: RUN, ...step(1) });
    await writeFile(file, firstLine, "utf8");
    const journal = createJournal({ workspaceRoot: root, runId: RUN, clock: movingClock() });
    journals.push(journal);
    await assert.rejects(journal.append(step(2)), /incomplete line/);
    assert.equal(await readFile(file, "utf8"), firstLine, "nothing was written");
    // The line is completed by someone else; the same journal tries again on its next append.
    await appendFile(file, "\n", "utf8");
    const record = await journal.append(step(3));
    assert.equal(record.seq, 2);
    assert.deepEqual(await linesOf(root, RUN), [firstLine, JSON.stringify(record)]);
  });

  test("close between two appends: the one before is stored and resolves; the one after is refused and writes nothing", async () => {
    const root = await workspace();
    const journal = createJournal({ workspaceRoot: root, runId: RUN, clock: movingClock() });
    const before = journal.append(step(1));
    const closing = journal.close();
    const afterClose = journal.append(step(2));
    const record = await before;
    await closing;
    await assert.rejects(afterClose, /journal is closed/);
    assert.deepEqual(await linesOf(root, RUN), [JSON.stringify(record)]);
  });
});

describe("U-269: the recorders' journals resolve after the state guard noted the line (DR-38)", () => {
  test("run recorders: right after append resolves, the run's records show no change but the run's own", async () => {
    const root = await workspace();
    const { journal, stateGuard } = createRunRecorders({ workspaceRoot: root, runId: RUN, clock: movingClock() });
    journals.push(journal);
    const record = await journal.append(step(1));
    const before = await stateGuard.capture("run");
    const second = await journal.append(step(2));
    assert.deepEqual(stateGuard.compare(before, await stateGuard.capture("run")), { changed: [], limited: false });
    assert.deepEqual(await linesOf(root, RUN), [JSON.stringify(record), JSON.stringify(second)]);
  });

  test("apply recorders (with afterAppend): the record is its line, and the guard knows it when append resolves", async () => {
    const root = await workspace();
    const { journal, stateGuard } = createApplyRecorders({ workspaceRoot: root, runId: APPLY, planRunId: PLAN, clock: movingClock() });
    journals.push(journal);
    const started = await journal.append(STARTED);
    const before = await stateGuard.capture("run");
    const item = await journal.append(ITEM_STARTED);
    const moved = await journal.append(MOVED);
    assert.deepEqual(stateGuard.compare(before, await stateGuard.capture("run")), { changed: [], limited: false });
    assert.deepEqual(await linesOf(root, APPLY), [started, item, moved].map((record) => JSON.stringify(record)));
  });
});

describe("U-269: the apply journal's start record comes back as stored (ApplyJournalEntryRecord)", () => {
  test("plan_item_started has seq, at and runId like the others, between apply_started and file_moved", async () => {
    const root = await workspace();
    const journal = createApplyJournal({ workspaceRoot: root, runId: APPLY, clock: movingClock() });
    journals.push(journal);
    const records = [await journal.append(STARTED), await journal.append(ITEM_STARTED), await journal.append(MOVED)];
    const lines = await linesOf(root, APPLY);
    assert.deepEqual(
      records.map((record) => JSON.stringify(record)),
      lines,
    );
    const item = records[1];
    assert.ok(item !== undefined && item.type === "plan_item_started", JSON.stringify(item));
    assert.deepEqual([item.seq, item.runId, typeof item.at], [2, APPLY, "string"]);
    assert.deepEqual((item as unknown as { action: unknown }).action, { kind: "move", from: "a.txt", to: "sorted/a.txt" });
  });
});
