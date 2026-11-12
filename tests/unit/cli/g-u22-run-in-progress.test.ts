/**
 * U-22 (DR-48, AXM-8), the CLI's part: `--run latest` while the only run is still going.
 * Before, `report --run latest` answered run_not_found ("no finished run"), the same as for a
 * workspace with nothing in it, so a caller could not tell "wait" from "there is none". Now a run
 * without a result that holds the workspace lock with a live holder is run_in_progress (exit 6, the
 * try-again family). With no such run it stays run_not_found.
 * PM decision (DR-48): `latest` is the newest run. When it is still going the answer is
 * run_in_progress even if a finished run comes before it; a run id given as it is shows that run.
 * Real engine and store; the lock is held by this process; scripted model; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { CLI_ERROR_EXIT_CODES, RESULT_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { EngineResult, RunListEntry } from "../../../src/contracts/index.js";
import { assembleRun, createRevertCommand } from "../../../src/cli/assemble.js";
import { runReport } from "../../../src/cli/report.js";
import { runRevert } from "../../../src/cli/revert.js";
import { runCli } from "../../../src/cli/run.js";
import { resolveRunReference } from "../../../src/cli/run-ref.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { acquireLock, inspectRun, listRuns, readRevertRecord, releaseLock, revertRun, writeRevertRecord } from "../../../src/store/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 900_000;
const clock = { now: () => (now += 1000) };
let seed = 111;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);
const isDirectory = async (dir: string): Promise<boolean> => (await stat(dir).catch(() => null))?.isDirectory() ?? false;

async function finishedRun(base: string, id: string): Promise<string> {
  await writeFile(path.join(base, `${id}.script.json`), JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] }), "utf8");
  const task = {
    schemaVersion: 1,
    id,
    goal: "g",
    workflow: "test",
    workspaceRoot: "./work",
    model: { provider: "scripted", scriptPath: `./${id}.script.json` },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
    privacy: { secretEnv: [] },
    limits: { maxModelTurns: 6, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
    verifiers: [],
  };
  await writeFile(path.join(base, `${id}.task.json`), JSON.stringify(task), "utf8");
  const outcome = await runCli({
    argv: ["run", "--task", `${id}.task.json`, "--quiet"],
    env: {},
    cwd: base,
    readFile: (file: string) => readFile(file, "utf8"),
    isDirectory,
    loadEnvFile: () => {},
    locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
    relatePaths: (target: string, root: string) => relateRealPaths(target, root),
    clock,
    randomBytes,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    assemble: assembleRun,
  });
  return (outcome.output as EngineResult).runId;
}

/** A workspace whose newest run has no result yet; `going` says whether it holds the lock. */
async function workspace(options: { earlier: boolean; going: boolean }): Promise<{ base: string; runId: string; earlier: string | null; release: () => Promise<void> }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u22p-"));
  temporaryDirs.push(base);
  const work = path.join(base, "work");
  await mkdir(work);
  const earlier = options.earlier ? await finishedRun(base, "e") : null;
  const runId = await finishedRun(base, "r");
  // As while the run is going: its journal is there, its result is not.
  await rm(path.join(work, STATE_DIR_NAME, RUNS_DIR_NAME, runId, RESULT_FILE_NAME));
  if (options.going) {
    const lock = await acquireLock({ workspaceRoot: work, runId, clock });
    assert.ok(lock.ok, JSON.stringify(lock));
  }
  return { base, runId, earlier, release: async () => void (await releaseLock({ workspaceRoot: work, runId })) };
}

const report = (base: string) => runReport({ argv: ["report", "--workspace", "work", "--run", "latest", "--json"], cwd: base, env: {}, listRuns });
const codeOf = (outcome: object & { exitCode: number }): unknown[] => {
  const output = (outcome as { output?: { kind?: string; code?: string } }).output;
  return [output?.kind, output?.code, outcome.exitCode];
};

describe("U-22 (AXM-8): --run latest while the run is still going", () => {
  test("report: run_in_progress (exit 6) while the run holds the lock; run_not_found once it does not", async () => {
    const { base, release } = await workspace({ earlier: false, going: true });
    try {
      assert.deepEqual(codeOf(await report(base)), ["error", "run_in_progress", CLI_ERROR_EXIT_CODES.run_in_progress]);
      assert.equal(CLI_ERROR_EXIT_CODES.run_in_progress, 6);
    } finally {
      await release();
    }
    assert.deepEqual(codeOf(await report(base)), ["error", "run_not_found", 2]);
  });

  test("revert: the same code, and nothing is changed", async () => {
    const { base, release } = await workspace({ earlier: false, going: true });
    try {
      const outcome = await runRevert({
        argv: ["revert", "--workspace", "work", "--run", "latest", "--quiet"],
        cwd: base,
        isDirectory,
        clock,
        randomBytes,
        revert: createRevertCommand(revertRun, { listRuns, inspect: inspectRun, readRecord: readRevertRecord, writeRecord: writeRevertRecord }),
      });
      assert.deepEqual(codeOf(outcome), ["error", "run_in_progress", 6]);
    } finally {
      await release();
    }
  });

  test("a run without a result that does not hold the lock (stopped without one): run_not_found, as before", async () => {
    const { base } = await workspace({ earlier: false, going: false });
    assert.deepEqual(codeOf(await report(base)), ["error", "run_not_found", 2]);
  });

  test("an empty workspace: run_not_found, as before", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u22p-"));
    temporaryDirs.push(base);
    await mkdir(path.join(base, "work"));
    assert.deepEqual(codeOf(await report(base)), ["error", "run_not_found", 2]);
  });

  test("a finished run before the one still going: latest is the newest run, so run_in_progress (PM, DR-48)", async () => {
    const { base, release } = await workspace({ earlier: true, going: true });
    try {
      assert.deepEqual(codeOf(await report(base)), ["error", "run_in_progress", 6]);
    } finally {
      await release();
    }
  });

  test("the finished run's id given as it is shows that run while the newer one is going", async () => {
    const { base, earlier, release } = await workspace({ earlier: true, going: true });
    try {
      const outcome = await runReport({ argv: ["report", "--workspace", "work", "--run", earlier as string, "--json"], cwd: base, env: {}, listRuns });
      assert.equal(outcome.exitCode, 0, JSON.stringify(outcome));
      const output = ("text" in outcome ? JSON.parse(outcome.text) : outcome.output) as { runId: string };
      assert.equal(output.runId, earlier);
    } finally {
      await release();
    }
  });

  test("a finished run before a newer one that stopped without a result (not going): the finished one, as before", async () => {
    const { base, earlier } = await workspace({ earlier: true, going: false });
    const outcome = await report(base);
    assert.equal(outcome.exitCode, 0, JSON.stringify(outcome));
    const output = ("text" in outcome ? JSON.parse(outcome.text) : outcome.output) as { runId: string };
    assert.equal(output.runId, earlier);
  });

  test("the lock is asked for runs without a result newer than the latest finished one only; another run holding it is not this run going", async () => {
    const runId = "20260102T030405Z-0a0b0c0d";
    const entry = { state: "checked", runId, status: null } as unknown as RunListEntry;
    const finished = { state: "checked", runId: "20260102T030400Z-0a0b0c0c", status: "done" } as unknown as RunListEntry;
    const older = { state: "checked", runId: "20260102T030300Z-0a0b0c0b", status: null } as unknown as RunListEntry;
    const deps = (holder: string, asked: string[]) => ({
      exists: async () => false,
      listRuns: (async () => ({ runs: [entry, finished, older] })) as never,
      runInProgress: async (root: string, id: string) => {
        asked.push(`${root}:${id}`);
        return holder === id;
      },
    });
    const asked: string[] = [];
    const going = await resolveRunReference("root", "latest", deps(runId, asked));
    assert.deepEqual([going.ok, going.ok ? null : going.code, asked], [false, "run_in_progress", [`root:${runId}`]]);
    const askedOther: string[] = [];
    const other = await resolveRunReference("root", "latest", deps("20260102T030405Z-ffffffff", askedOther));
    assert.deepEqual([other.ok, other.ok ? other.runId : null, askedOther], [true, "20260102T030400Z-0a0b0c0c", [`root:${runId}`]]);
  });
});
