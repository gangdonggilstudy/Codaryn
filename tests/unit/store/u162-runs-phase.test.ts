/**
 * U-162 (AXM-8, PM; the rule is U-158's runPhaseOf): listRuns gives each checked run its phase.
 * - finished: the run has result.json (whatever the lock says);
 * - running: no result.json, and the workspace lock names this run with a holder that still runs;
 * - no_result: anything else - no lock, a lock of another run, a stale lock, a lock that cannot be
 *   read, or a reclaim file left behind (PM: no ground to say it runs).
 * A damaged entry has no phase. Only phase is added: the other fields are as before. Fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import type { EngineResult, JournalEvent, RunListEntry } from "../../../src/contracts/index.js";
import { acquireLock, createJournal, journalRelativePath, listRuns, releaseLock, writeResult } from "../../../src/store/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const DONE = "20260101T030000Z-0000000a";
const OPEN = "20260101T040000Z-0000000b";
const at = (runId: string): number => Date.UTC(2026, 0, 1, Number(runId.slice(9, 11)), 0, 1);
const STARTED = { type: "run_started", schemaVersion: 1, taskId: "t", workflow: "document", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 } } as unknown as JournalEvent;
const usage = { modelTurns: 1, toolCalls: 0, inputTokens: null, outputTokens: null, durationMs: 9 };

async function run(root: string, runId: string, finished: boolean): Promise<void> {
  const journal = createJournal({ workspaceRoot: root, runId, clock: { now: () => at(runId) } });
  await journal.append(STARTED);
  if (finished) await journal.append({ type: "run_finished", status: "done", reason: "verified", usage });
  await journal.close();
  if (finished) {
    await writeResult(root, {
      schemaVersion: 1, kind: "run", runId, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted",
      verifiers: [], changes: [], usage, journalPath: journalRelativePath(runId), notices: [],
    } as unknown as EngineResult);
  }
}

/** A finished run and a run without result.json. */
async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u162-")));
  roots.push(root);
  await run(root, DONE, true);
  await run(root, OPEN, false);
  return root;
}
const phases = async (root: string): Promise<Record<string, unknown>> =>
  Object.fromEntries((await listRuns({ workspaceRoot: root })).runs.map((entry: RunListEntry) => [entry.runId, entry.state === "checked" ? (entry.phase ?? "absent") : `state ${entry.state}`]));
const lockFile = (root: string): string => join(root, ".codaryn", "lock.json");

describe("U-162 (AXM-8): listRuns gives each checked run its phase", () => {
  test("no lock: the finished run is finished, the run without a result has no result", async () => {
    assert.deepEqual(await phases(await workspace()), { [DONE]: "finished", [OPEN]: "no_result" });
  });

  test("the lock names the open run with a live holder (this process): running; released: no result again", async () => {
    const root = await workspace();
    const outcome = await acquireLock({ workspaceRoot: root, runId: OPEN, clock: { now: () => Date.now() } });
    assert.ok(outcome.ok, JSON.stringify(outcome));
    try {
      assert.deepEqual(await phases(root), { [DONE]: "finished", [OPEN]: "running" });
    } finally {
      await releaseLock({ workspaceRoot: root, runId: OPEN });
    }
    assert.deepEqual(await phases(root), { [DONE]: "finished", [OPEN]: "no_result" });
  });

  test("a live lock of another run, or of the finished run: the open run has no result; a result comes first", async () => {
    for (const holder of ["20260101T050000Z-0000000c", DONE]) {
      const root = await workspace();
      const outcome = await acquireLock({ workspaceRoot: root, runId: holder, clock: { now: () => Date.now() } });
      assert.ok(outcome.ok);
      try {
        assert.deepEqual(await phases(root), { [DONE]: "finished", [OPEN]: "no_result" }, holder);
      } finally {
        await releaseLock({ workspaceRoot: root, runId: holder });
      }
    }
  });

  test("a stale lock, a lock that cannot be read, or a reclaim file left behind: no result", async () => {
    const stale = { pid: 999_999_999, runId: OPEN, startedAt: "2026-01-01T04:00:01.000Z", processStartedAt: "2026-01-01T04:00:00.000Z" };
    const cases: [string, (root: string) => Promise<void>][] = [
      ["stale", (root) => writeFile(lockFile(root), `${JSON.stringify(stale)}\n`, "utf8")],
      ["unreadable", (root) => writeFile(lockFile(root), "{not json", "utf8")],
      ["reclaim left", (root) => writeFile(`${lockFile(root)}.reclaim`, "", "utf8")],
    ];
    for (const [name, make] of cases) {
      const root = await workspace();
      await mkdir(join(root, ".codaryn"), { recursive: true });
      await make(root);
      assert.deepEqual(await phases(root), { [DONE]: "finished", [OPEN]: "no_result" }, name);
    }
  });

  test("a damaged entry has no phase; the other fields of a checked entry are as before", async () => {
    const root = await workspace();
    await mkdir(join(root, ".codaryn", "runs", "20260101T060000Z-0000000d"));
    const listing = await listRuns({ workspaceRoot: root });
    const damaged = listing.runs.find((entry) => entry.runId === "20260101T060000Z-0000000d");
    assert.deepEqual(damaged, { state: "damaged", runId: "20260101T060000Z-0000000d" });
    const done = listing.runs.find((entry) => entry.runId === DONE);
    assert.deepEqual(Object.keys(done ?? {}).sort(), ["changes", "kind", "phase", "profile", "reason", "revertRecordDamaged", "reverted", "runId", "startedAt", "state", "status", "taskId", "workflowRef"]);
  });
});
