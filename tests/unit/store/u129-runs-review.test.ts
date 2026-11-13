/**
 * U-129 (AXM-21, PM approved): after a person's verdict the run list still showed a run that waited
 * for review as only `needs-input`/`awaiting_review`, and `runs --json` had no verdict. listRuns now
 * gives such a run `review: { verdict, at }` from its review.json, read with the checks report uses
 * (store reviewRecordIn, as readReviewRecord). Absent for a run with no verdict, a record that cannot
 * be read or checked (the run stays checked, never damaged), a run that did not end awaiting_review,
 * and an apply run. The note is not listed. Fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { REVIEW_FILE_NAME } from "../../../src/contracts/index.js";
import type { ContentHash, EngineResult, JournalEvent, MaskedText, ReviewRecord, RunListEntry } from "../../../src/contracts/index.js";
import { createJournal, journalRelativePath, listRuns, writeResult, writeReviewRecord } from "../../../src/store/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const AWAITING = "20260101T030000Z-0000000a";
const DONE = "20260101T040000Z-0000000b";
const APPLY = "20260101T050000Z-0000000c";
const HASH = "a".repeat(64) as ContentHash;
const AT = "2026-01-01T06:00:00.000Z";
const at = (runId: string): number => Date.UTC(2026, 0, 1, Number(runId.slice(9, 11)), 0, 1);
const STARTED = { type: "run_started", schemaVersion: 1, taskId: "t", workflow: "analyze", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 } } as unknown as JournalEvent;
const usage = { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 9 };

async function modelRun(root: string, runId: string, awaiting: boolean): Promise<void> {
  const journal = createJournal({ workspaceRoot: root, runId, clock: { now: () => at(runId) } });
  await journal.append(STARTED);
  const [status, reason, exitCode] = awaiting ? (["needs-input", "awaiting_review", 3] as const) : (["done", "verified", 0] as const);
  await journal.append({ type: "run_finished", status, reason, usage });
  await journal.close();
  const result = {
    schemaVersion: 1, kind: "run", runId, taskId: "t", status, reason, exitCode, provider: "scripted", verifiers: [], changes: [],
    usage, journalPath: journalRelativePath(runId), notices: [], ...(awaiting ? { review: { checklist: ["the table matches"] } } : {}),
  } as unknown as EngineResult;
  await writeResult(root, result);
}

const verdict = (runId: string, value: "accepted" | "rejected", note: string | null = "checked by hand"): ReviewRecord => ({
  schemaVersion: 1, kind: "review_record", runId, at: AT, verdict: value, note: note as MaskedText | null,
});

/** A run that waited for review, a done run and an apply run. */
async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u129-")));
  roots.push(root);
  await modelRun(root, AWAITING, true);
  await modelRun(root, DONE, false);
  const apply = createJournal({ workspaceRoot: root, runId: APPLY, clock: { now: () => at(APPLY) } });
  await apply.append({ type: "apply_started", schemaVersion: 1, planRunId: DONE, taskId: "t", digest: HASH, approval: "cli-flag", actions: 1, maxDurationMs: 60_000 } as unknown as JournalEvent);
  await apply.close();
  return root;
}

const runDir = (root: string, runId: string): string => join(root, ".codaryn", "runs", runId);
const byId = async (root: string): Promise<Record<string, RunListEntry>> => Object.fromEntries((await listRuns({ workspaceRoot: root })).runs.map((entry) => [entry.runId, entry]));
/** The entry's review, "absent", or its state when it is not checked. */
const reviewOf = (entry: RunListEntry | undefined): unknown =>
  entry?.state === "checked" ? ((entry as { readonly review?: unknown }).review ?? "absent") : `state ${entry?.state}`;

describe("U-129 (AXM-21): the run list carries a person's verdict", () => {
  test("rejected and accepted: the verdict and its time, without the note; replaced by a later review", async () => {
    const root = await workspace();
    assert.equal(reviewOf((await byId(root))[AWAITING]), "absent", "no verdict yet");
    await writeReviewRecord(root, verdict(AWAITING, "rejected"));
    assert.deepEqual(reviewOf((await byId(root))[AWAITING]), { verdict: "rejected", at: AT });
    await writeReviewRecord(root, verdict(AWAITING, "accepted", null));
    const runs = await byId(root);
    assert.deepEqual(reviewOf(runs[AWAITING]), { verdict: "accepted", at: AT });
    assert.equal(JSON.stringify(runs[AWAITING]).includes("checked by hand"), false, "the note is not listed");
  });

  test("only a run that ended awaiting_review: a review.json beside a done run or an apply run is not read", async () => {
    const root = await workspace();
    for (const runId of [DONE, APPLY]) {
      await writeFile(join(runDir(root, runId), REVIEW_FILE_NAME), `${JSON.stringify(verdict(runId, "rejected"))}\n`, "utf8");
    }
    const runs = await byId(root);
    assert.deepEqual([reviewOf(runs[DONE]), reviewOf(runs[APPLY])], ["absent", "absent"]);
  });

  test("a review.json that cannot be read or checked: no review, and the run stays checked", async () => {
    const cases: [string, (file: string) => Promise<void>][] = [
      ["not JSON", (file) => writeFile(file, "{not json", "utf8")],
      ["another run's", (file) => writeFile(file, JSON.stringify(verdict(DONE, "rejected")), "utf8")],
      ["an unknown verdict", (file) => writeFile(file, JSON.stringify({ ...verdict(AWAITING, "rejected"), verdict: "maybe" }), "utf8")],
      ["a bad time", (file) => writeFile(file, JSON.stringify({ ...verdict(AWAITING, "rejected"), at: "yesterday" }), "utf8")],
      ["a control character in the note", (file) => writeFile(file, JSON.stringify(verdict(AWAITING, "rejected", "a\u001bb")), "utf8")],
      ["too large", (file) => writeFile(file, JSON.stringify(verdict(AWAITING, "rejected", "x".repeat(20_000))), "utf8")],
      ["a directory", (file) => mkdir(file)],
    ];
    for (const [name, make] of cases) {
      const root = await workspace();
      await make(join(runDir(root, AWAITING), REVIEW_FILE_NAME));
      const entry = (await byId(root))[AWAITING];
      assert.equal(entry?.state, "checked", name);
      assert.equal(reviewOf(entry), "absent", name);
    }
  });
});
