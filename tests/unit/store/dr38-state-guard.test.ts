/**
 * DR-38 (R-24 L-1, DR-37 (b)): the store's state guard. It is made together with the run's journal
 * and recorders (createRunRecorders), so the run's own writes between two fingerprints are not
 * changes, while anything else that changes the run's records (tier "run") or the rest of the state
 * directory (tier "state") is. markRecordsChanged marks the runs, and the views treat a marked run
 * as the contract says (listRuns: recordsChanged; readRunOriginals: no shown). Fake values only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { RECORDS_CHANGED_FILE_NAME, asRawText, maskedParts, maskedPartsEncoding } from "../../../src/contracts/index.js";
import type { ContentHash, EngineResult, JournalEvent, MaskedText, RecordsChangedMark } from "../../../src/contracts/index.js";
import {
  createChangeRecorder,
  createJournal,
  createRunRecorders,
  hasRecordsChangedMark,
  journalRelativePath,
  listRuns,
  readRunOriginals,
  writeResult,
} from "../../../src/store/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const roots: string[] = [];
const journals: { close(): Promise<void> }[] = [];
after(async () => {
  for (const journal of journals) await journal.close();
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const RUN = "20260102T030405Z-0a1b2c3d";
const OTHER = "20260102T020000Z-22222222";
const clock = { now: () => Date.UTC(2026, 0, 2, 3, 4, 5, 500) };
const otherClock = { now: () => Date.UTC(2026, 0, 2, 2, 0, 0, 500) };
const sha = (text: string): ContentHash => createHash("sha256").update(text, "utf8").digest("hex") as ContentHash;
const shownDigest = (text: string): ContentHash => sha(maskedPartsEncoding(maskedParts(text)));
const BEFORE = "# Notes\n";
const AFTER = "# Notes\n\nadded\n";
const STARTED = { type: "run_started", schemaVersion: 1, taskId: "doc", workflow: "document", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 } } as unknown as JournalEvent;
const step = (n: number) => ({ type: "tool_decision", callId: `c${n}`, tool: "read_file", decision: "allow" }) as unknown as JournalEvent;
const state = (root: string, ...parts: string[]) => join(root, ".codaryn", ...parts);

async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-dr38-")));
  roots.push(root);
  await writeFile(join(root, "README.md"), BEFORE, "utf8");
  return root;
}

/** An earlier finished run with one changed file, written by the store's own writers. */
async function earlierRun(root: string): Promise<void> {
  const journal = createJournal({ workspaceRoot: root, runId: OTHER, clock: otherClock });
  await journal.append(STARTED);
  const resolved = await (await createWorkspace({ root })).resolve("README.md", "write");
  assert.ok(resolved.ok);
  await createChangeRecorder({ workspaceRoot: root, runId: OTHER }).saveOriginal(resolved.path, asRawText(BEFORE), shownDigest(BEFORE));
  await journal.append({ type: "file_changed", callId: "c1", path: "README.md" as MaskedText, previousHash: sha(BEFORE), newHash: sha(BEFORE), created: false });
  const usage = { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 9 };
  await journal.append({ type: "run_finished", status: "done", reason: "verified", usage });
  await journal.close();
  const result: EngineResult = {
    schemaVersion: 1, kind: "run", runId: OTHER, taskId: "doc", status: "done", reason: "verified", exitCode: 0, provider: "scripted",
    verifiers: [], changes: [{ path: "README.md" as MaskedText, previousHash: sha(BEFORE), newHash: sha(BEFORE), created: false }],
    usage, journalPath: journalRelativePath(OTHER), notices: [],
  };
  await writeResult(root, result);
}

/** The current run with its guard, after run_started and the run_start fingerprints. */
async function currentRun(root: string) {
  const records = createRunRecorders({ workspaceRoot: root, runId: RUN, clock });
  journals.push(records.journal);
  await records.journal.append(STARTED);
  const run = await records.stateGuard.capture("run");
  const base = await records.stateGuard.capture("state");
  return { records, guard: records.stateGuard, run, base };
}

/** What a write tool does: the original, its shown digest, the new text and its digest. */
async function writeLikeATool(root: string, recorder: ReturnType<typeof createRunRecorders>["changeRecorder"]): Promise<void> {
  const resolved = await (await createWorkspace({ root })).resolve("README.md", "write");
  assert.ok(resolved.ok);
  await recorder.saveOriginal(resolved.path, asRawText(BEFORE), shownDigest(BEFORE));
  await writeFile(join(root, "README.md"), AFTER, "utf8");
  assert.ok(recorder.saveNext !== undefined, "test assumption: the recorder keeps the next digest");
  await recorder.saveNext(resolved.path, sha(AFTER), shownDigest(AFTER));
}

describe("DR-38: the state guard counts the run's own writes as no change", () => {
  test("journal lines, the snapshot, its index and the shown records the run writes are not changes (both tiers)", async () => {
    const root = await workspace();
    await earlierRun(root);
    const { records, guard, run, base } = await currentRun(root);
    assert.deepEqual(guard.compare(base, base), { changed: [], limited: false });
    assert.deepEqual(guard.compare(run, run), { changed: [], limited: false });
    await records.journal.append(step(1));
    await writeLikeATool(root, records.changeRecorder);
    await records.journal.append(step(2));
    const run1 = await guard.capture("run");
    assert.deepEqual(guard.compare(run, run1), { changed: [], limited: false });
    assert.deepEqual(guard.compare(base, await guard.capture("state")), { changed: [], limited: false });
  });

  test("fingerprints of two tiers are not compared", async () => {
    const root = await workspace();
    const { guard, run, base } = await currentRun(root);
    assert.throws(() => guard.compare(run, base), TypeError);
  });

  test("a fingerprint holds no record text", async () => {
    const root = await workspace();
    await earlierRun(root);
    const canary = "cdyRecordTextCanary7Q2x";
    await writeFile(state(root, "runs", OTHER, "review.json"), JSON.stringify({ note: canary }), "utf8");
    const { base } = await currentRun(root);
    const seen = JSON.stringify(base, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value instanceof Map ? [...value] : value));
    assert.equal(seen.includes(canary), false);
  });
});

describe("DR-38: changes made by anything else are found", () => {
  test("R-24 L-1: a shown digest swapped while a command runs is a change of tier run", async () => {
    const root = await workspace();
    const { records, guard } = await currentRun(root);
    await writeLikeATool(root, records.changeRecorder);
    const before = await guard.capture("run");
    const file = state(root, "runs", RUN, "snapshots", "shown-0.json");
    const shown = JSON.parse(await readFile(file, "utf8")) as { next: { partsDigest: string } };
    shown.next.partsDigest = "e".repeat(64);
    await writeFile(file, `${JSON.stringify(shown)}\n`, "utf8");
    assert.deepEqual(guard.compare(before, await guard.capture("run")), { changed: [`runs/${RUN}/snapshots/shown-0.json`], limited: false });
  });

  test("lines added to the journal by another process are found even after the run's own next line", async () => {
    const root = await workspace();
    const { records, guard, run } = await currentRun(root);
    await appendFile(state(root, "runs", RUN, "journal.jsonl"), `${JSON.stringify({ seq: 2, type: "file_changed", path: "forged" })}\n`, "utf8");
    await records.journal.append(step(1));
    assert.deepEqual(guard.compare(run, await guard.capture("run")).changed, [`runs/${RUN}/journal.jsonl`]);
  });

  test("a record file that appears or a snapshot that goes away is a change", async () => {
    const root = await workspace();
    const { records, guard } = await currentRun(root);
    await writeLikeATool(root, records.changeRecorder);
    const before = await guard.capture("run");
    await writeFile(state(root, "runs", RUN, "plan.json"), "{}\n", "utf8");
    await rm(state(root, "runs", RUN, "snapshots", "1.orig"));
    assert.deepEqual(guard.compare(before, await guard.capture("run")).changed, [`runs/${RUN}/plan.json`, `runs/${RUN}/snapshots/1.orig`]);
  });

  test("tier state: another run's result, a parked file and a new top-level file are changes against run start", async () => {
    const root = await workspace();
    await earlierRun(root);
    const { guard, base } = await currentRun(root);
    const result = state(root, "runs", OTHER, "result.json");
    await writeFile(result, (await readFile(result, "utf8")).replace('"done"', '"failed"'), "utf8");
    await mkdir(state(root, "parked"), { recursive: true });
    await writeFile(state(root, "parked", "x.txt"), "x", "utf8");
    await writeFile(state(root, "extra.txt"), "x", "utf8");
    const now = await guard.capture("state");
    assert.deepEqual(guard.compare(base, now), { changed: ["extra.txt", "parked", "parked/x.txt", `runs/${OTHER}/result.json`], limited: false });
  });

  test("a link made in the run's records is a change", async () => {
    const root = await workspace();
    const { guard, run } = await currentRun(root);
    const target = await realpath(await mkdtemp(join(tmpdir(), "codaryn-dr38-target-")));
    roots.push(target);
    await symlink(target, state(root, "runs", RUN, "snapshots"), process.platform === "win32" ? "junction" : "dir");
    assert.deepEqual(guard.compare(run, await guard.capture("run")).changed, [`runs/${RUN}/snapshots`]);
  });

  test("tier state over its entry limit: limited, and the part not fingerprinted is not a change", async () => {
    const root = await workspace();
    await earlierRun(root);
    const records = createRunRecorders({ workspaceRoot: root, runId: RUN, clock, limits: { maxEntries: 3 } });
    journals.push(records.journal);
    await records.journal.append(STARTED);
    const base = await records.stateGuard.capture("state");
    assert.deepEqual(records.stateGuard.compare(base, base), { changed: [], limited: true });
    await writeFile(state(root, "runs", OTHER, "zz-late.txt"), "x", "utf8");
    assert.deepEqual(records.stateGuard.compare(base, await records.stateGuard.capture("state")), { changed: [], limited: true });
  });
});

describe("DR-38: records-changed marks and how the views treat a marked run", () => {
  test("markRecordsChanged marks this run and the runs named, joins a later detection, and its own writes are not changes", async () => {
    const root = await workspace();
    await earlierRun(root);
    const { guard, run, base } = await currentRun(root);
    const paths = [`runs/${OTHER}/result.json` as MaskedText];
    await guard.markRecordsChanged(paths);
    const mine = JSON.parse(await readFile(state(root, "runs", RUN, RECORDS_CHANGED_FILE_NAME), "utf8")) as RecordsChangedMark;
    const theirs = JSON.parse(await readFile(state(root, "runs", OTHER, RECORDS_CHANGED_FILE_NAME), "utf8")) as RecordsChangedMark;
    assert.deepEqual(mine, { schemaVersion: 1, kind: "records_changed", runId: RUN, detections: [{ detectedBy: RUN, at: "2026-01-02T03:04:05.500Z", paths }] });
    assert.deepEqual(theirs, { schemaVersion: 1, kind: "records_changed", runId: OTHER, detections: [{ detectedBy: RUN, at: "2026-01-02T03:04:05.500Z", paths }] });
    await guard.markRecordsChanged([`runs/${RUN}/plan.json` as MaskedText]);
    const joined = JSON.parse(await readFile(state(root, "runs", RUN, RECORDS_CHANGED_FILE_NAME), "utf8")) as RecordsChangedMark;
    assert.equal(joined.detections.length, 2);
    assert.deepEqual(guard.compare(run, await guard.capture("run")).changed, []);
    assert.deepEqual(guard.compare(base, await guard.capture("state")).changed, []);
  });

  test("a marked run: listRuns says so, readRunOriginals gives no shown, hasRecordsChangedMark is true; others are as before", async () => {
    const root = await workspace();
    await earlierRun(root);
    const plain = (await readRunOriginals({ workspaceRoot: root, runId: OTHER }))[0];
    assert.ok(plain?.shown !== undefined, "test assumption: the earlier run has a shown record");
    assert.equal(Object.hasOwn((await listRuns({ workspaceRoot: root })).runs[0] ?? {}, "recordsChanged"), false, "no mark: the field is left out");
    assert.equal(await hasRecordsChangedMark(root, OTHER), false);
    const { guard } = await currentRun(root);
    await guard.markRecordsChanged([`runs/${OTHER}/snapshots/shown-0.json` as MaskedText]);
    const entry = (await listRuns({ workspaceRoot: root })).runs.find((item) => item.runId === OTHER);
    assert.equal(entry?.state === "checked" ? entry.recordsChanged : null, true);
    assert.equal(await hasRecordsChangedMark(root, OTHER), true);
    const marked = (await readRunOriginals({ workspaceRoot: root, runId: OTHER }))[0];
    assert.equal(marked?.shown, undefined);
    assert.deepEqual(marked?.original, plain?.original);
  });

  test("a mark that cannot be read counts as a mark (fail closed)", async () => {
    const root = await workspace();
    await earlierRun(root);
    await writeFile(state(root, "runs", OTHER, RECORDS_CHANGED_FILE_NAME), "{", "utf8");
    assert.equal(await hasRecordsChangedMark(root, OTHER), true);
    const entry = (await listRuns({ workspaceRoot: root })).runs.find((item) => item.runId === OTHER);
    assert.equal(entry?.state === "checked" ? entry.recordsChanged : null, true);
    assert.equal((await readRunOriginals({ workspaceRoot: root, runId: OTHER }))[0]?.shown, undefined);
  });
});
