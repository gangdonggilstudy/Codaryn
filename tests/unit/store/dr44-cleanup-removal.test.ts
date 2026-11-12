/**
 * DR-44 (라), R-34 L-3: a removal that fails after the move aside is not reported or logged as removed,
 * and a removal that fails once is tried again. The fixture is the one of dr44-cleanup.test.ts. Fake values only.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { CLEANUP_LOG_FILE_NAME } from "../../../src/contracts/index.js";
import type { ApplyJournalEvent, ContentHash, EngineResult, JournalEvent, MaskedText } from "../../../src/contracts/index.js";
import {
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

describe("DR-44 (라), R-34 L-3: a removal that fails after the move aside", () => {
  const busy = (): Error => Object.assign(new Error("resource busy"), { code: "EBUSY" });

  test("is not reported or logged as removed", async () => {
    const root = await workspace();
    const selection = { runs: { runIds: [FULL, PART] } };
    const shown = await planCleanup({ workspaceRoot: root, selection, now: NOW });
    let calls = 0;
    const outcome = await applyCleanupWith({ workspaceRoot: root, selection, now: NOW, confirmation: { digest: shown.digest, discarded: false } }, {
      remove: async (dir: string) => {
        calls += 1;
        if ((await readdir(dir)).includes("result.json") && (await readFile(join(dir, "result.json"), "utf8")).includes(FULL)) throw busy();
        await rm(dir, { recursive: true, force: true });
      },
      retryDelayMs: 1,
    });
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.removed.map((item: { runId: string }) => item.runId), [PART]);
    assert.deepEqual(outcome.kept, [{ target: "run", runId: FULL, reason: "io_error" }]);
    assert.ok(calls > 2, "the failing removal was tried again");
    const log = (await readFile(state(root, CLEANUP_LOG_FILE_NAME), "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line) as { runs: { count: number } });
    assert.equal(log[0]?.runs.count, 1, "the log counts only what was removed");
  });

  test("a removal that fails once and then succeeds is removed", async () => {
    const root = await workspace();
    const selection = { runs: { runIds: [FULL] } };
    const shown = await planCleanup({ workspaceRoot: root, selection, now: NOW });
    let failed = false;
    const outcome = await applyCleanupWith({ workspaceRoot: root, selection, now: NOW, confirmation: { digest: shown.digest, discarded: false } }, {
      remove: async (dir: string) => {
        if (!failed) {
          failed = true;
          throw busy();
        }
        await rm(dir, { recursive: true, force: true });
      },
      retryDelayMs: 1,
    });
    assert.ok(outcome.ok);
    assert.deepEqual([outcome.removed.map((item: { runId: string }) => item.runId), outcome.kept], [[FULL], []]);
    assert.deepEqual((await readdir(state(root))).filter((name) => name.startsWith("cleanup-")), []);
  });
});
