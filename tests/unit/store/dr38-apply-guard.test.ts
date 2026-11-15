/**
 * DR-38 for apply runs (PM: ApplyDeps.stateGuard). An apply writes into the state directory more
 * than a model run: it marks its plan run applied (applied.json in the plan run's directory, tier
 * "state") and its executor moves discarded files into discarded/<runId>/ (tier "run"). Those are
 * the apply's own writes, so createApplyRecorders notes them; anything else changing the same places
 * is still found. Fake values only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { discardedStoredName } from "../../../src/contracts/index.js";
import type { ApplyJournalEvent, ContentHash, JournalEvent, MaskedText } from "../../../src/contracts/index.js";
import { createApplyRecorders, createJournal, createRunRecorders, markPlanApplied, prepareDiscardedRoot } from "../../../src/store/index.js";

const roots: string[] = [];
const journals: { close(): Promise<void> }[] = [];
after(async () => {
  for (const journal of journals) await journal.close();
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const PLAN = "20260102T030405Z-0a1b2c3d";
const APPLY = "20260102T030500Z-11111111";
const AT = "2026-01-02T03:05:00.500Z";
const clock = { now: () => Date.parse(AT) };
const CONTENT = "a person's log\n";
const sha = (text: string): ContentHash => createHash("sha256").update(text, "utf8").digest("hex") as ContentHash;
const STARTED: ApplyJournalEvent = { type: "apply_started", schemaVersion: 1, planRunId: PLAN, taskId: "t", digest: "d".repeat(64) as ContentHash, approval: "cli-flag", actions: 1, maxDurationMs: 60_000 };
const DISCARDED: ApplyJournalEvent = { type: "file_discarded", index: 0, path: "c.log" as MaskedText, stored: discardedStoredName(0), sha256: sha(CONTENT) };
const state = (root: string, ...parts: string[]) => join(root, ".codaryn", ...parts);

async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-dr38-apply-")));
  roots.push(root);
  await writeFile(join(root, "c.log"), CONTENT, "utf8");
  const plan = createJournal({ workspaceRoot: root, runId: PLAN, clock: { now: () => Date.UTC(2026, 0, 2, 3, 4, 5, 500) } });
  await plan.append({ type: "run_started", schemaVersion: 1, taskId: "t", workflow: "organize", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 } } as unknown as JournalEvent);
  await plan.close();
  return root;
}

/** What the apply does between its start and its verification round: mark the plan, discard the file. */
async function applyActions(root: string, discardedRoot: string, mark: () => Promise<"marked" | "already_applied">, append: (event: ApplyJournalEvent) => Promise<unknown>): Promise<void> {
  assert.equal(await mark(), "marked");
  await rename(join(root, "c.log"), join(discardedRoot, discardedStoredName(0)));
  await append(DISCARDED);
}

describe("DR-38: an apply run's own writes are no change", () => {
  test("made with the model run's recorders, the plan mark and the discarded file would be changes", async () => {
    const root = await workspace();
    const records = createRunRecorders({ workspaceRoot: root, runId: APPLY, clock });
    journals.push(records.journal);
    const discardedRoot = await prepareDiscardedRoot(root, APPLY);
    await records.journal.append(STARTED as unknown as JournalEvent);
    const run = await records.stateGuard.capture("run");
    const base = await records.stateGuard.capture("state");
    await applyActions(root, discardedRoot, () => markPlanApplied({ workspaceRoot: root, planRunId: PLAN, applyRunId: APPLY, at: AT }), (event) => records.journal.append(event as unknown as JournalEvent));
    assert.deepEqual(records.stateGuard.compare(run, await records.stateGuard.capture("run")).changed, [`discarded/${APPLY}/0`]);
    assert.deepEqual(records.stateGuard.compare(base, await records.stateGuard.capture("state")).changed, [`runs/${PLAN}/applied.json`]);
  });

  test("createApplyRecorders notes the plan mark (markApplied) and each discarded file", async () => {
    const root = await workspace();
    const records = createApplyRecorders({ workspaceRoot: root, runId: APPLY, clock, planRunId: PLAN });
    journals.push(records.journal);
    const discardedRoot = await prepareDiscardedRoot(root, APPLY);
    await records.journal.append(STARTED);
    const run = await records.stateGuard.capture("run");
    const base = await records.stateGuard.capture("state");
    await applyActions(root, discardedRoot, () => records.markApplied(), (event) => records.journal.append(event));
    const run1 = await records.stateGuard.capture("run");
    assert.deepEqual(records.stateGuard.compare(run, run1), { changed: [], limited: false });
    assert.deepEqual(records.stateGuard.compare(base, await records.stateGuard.capture("state")), { changed: [], limited: false });
    assert.equal(await readFile(join(discardedRoot, "0"), "utf8"), CONTENT);
    assert.equal(JSON.parse(await readFile(state(root, "runs", PLAN, "applied.json"), "utf8")).applyRunId, APPLY);
  });

  test("a discarded-files folder the executor makes itself during the apply is noted too", async () => {
    const root = await workspace();
    const records = createApplyRecorders({ workspaceRoot: root, runId: APPLY, clock, planRunId: PLAN });
    journals.push(records.journal);
    await records.journal.append(STARTED);
    const run = await records.stateGuard.capture("run");
    const base = await records.stateGuard.capture("state");
    const discardedRoot = await prepareDiscardedRoot(root, APPLY); // as the executor's own mkdir would
    await applyActions(root, discardedRoot, () => records.markApplied(), (event) => records.journal.append(event));
    assert.deepEqual(records.stateGuard.compare(run, await records.stateGuard.capture("run")).changed, []);
    assert.deepEqual(records.stateGuard.compare(base, await records.stateGuard.capture("state")).changed, []);
  });
});

describe("DR-38: changes to what an apply wrote are still found", () => {
  test("a discarded file changed after the move, and another run's records, are changes", async () => {
    const root = await workspace();
    const records = createApplyRecorders({ workspaceRoot: root, runId: APPLY, clock, planRunId: PLAN });
    journals.push(records.journal);
    const discardedRoot = await prepareDiscardedRoot(root, APPLY);
    await records.journal.append(STARTED);
    const base = await records.stateGuard.capture("state");
    await applyActions(root, discardedRoot, () => records.markApplied(), (event) => records.journal.append(event));
    const run1 = await records.stateGuard.capture("run");
    await writeFile(join(discardedRoot, "0"), "replaced by a command\n", "utf8");
    await writeFile(state(root, "runs", PLAN, "review.json"), "{}\n", "utf8");
    assert.deepEqual(records.stateGuard.compare(run1, await records.stateGuard.capture("run")).changed, [`discarded/${APPLY}/0`]);
    assert.deepEqual(records.stateGuard.compare(base, await records.stateGuard.capture("state")).changed, [`runs/${PLAN}/review.json`]);
  });

  test("a file_discarded record naming a stored file that is not a plain index notes nothing", async () => {
    const root = await workspace();
    const records = createApplyRecorders({ workspaceRoot: root, runId: APPLY, clock, planRunId: PLAN });
    journals.push(records.journal);
    const discardedRoot = await prepareDiscardedRoot(root, APPLY);
    await records.journal.append(STARTED);
    const run = await records.stateGuard.capture("run");
    await writeFile(join(discardedRoot, "x"), "not the executor's\n", "utf8");
    await records.journal.append({ ...DISCARDED, stored: "x" });
    await records.journal.append({ ...DISCARDED, stored: "../x" });
    assert.deepEqual(records.stateGuard.compare(run, await records.stateGuard.capture("run")).changed, [`discarded/${APPLY}/x`]);
  });
});
