/**
 * U-22 (DR-48 (b), review R-51 M-2): every command that takes `--run latest` answers with one rule,
 * the shared resolveRunReference (src/cli/run-ref.ts): when the newest run is still going (no result,
 * a live holder of the workspace lock) the answer is run_in_progress (exit 6), even with a finished
 * run before it. A run id given as it is names that run. One case per command.
 * Before R-51, `changes --run latest` (through the app layer's runIdOf and the run list's
 * resolveRunRef, src/cli/runs.ts) passed over the run still going and showed the run before it.
 * Real engine, store and app layer; the lock is held by this process; scripted model; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { CLI_ERROR_EXIT_CODES, RESULT_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { EngineResult } from "../../../src/contracts/index.js";
import { createCodarynApp, createNodeAppEnvironment } from "../../../src/app/index.js";
import { assembleRun, createRevertCommand } from "../../../src/cli/assemble.js";
import { runChanges } from "../../../src/cli/changes.js";
import { runApply, runPlan, runReview } from "../../../src/cli/plan-commands.js";
import { runReport } from "../../../src/cli/report.js";
import { runRevert } from "../../../src/cli/revert.js";
import { STORE_RUN_REFERENCE_DEPS, resolveRunReference } from "../../../src/cli/run-ref.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { acquireLock, inspectRun, listRuns, readRevertRecord, releaseLock, revertRun, writeRevertRecord } from "../../../src/store/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 900_000;
const clock = { now: () => (now += 1000) };
let seed = 91;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);
const isDirectory = async (dir: string): Promise<boolean> => (await stat(dir).catch(() => null))?.isDirectory() ?? false;

const io = (base: string, argv: readonly string[]) => ({
  argv,
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
});

/** A finished run, then a newer run without a result that holds the workspace lock (still going). */
async function workspace(): Promise<{ base: string; work: string; earlier: string; going: string; release: () => Promise<void> }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u22l-"));
  temporaryDirs.push(base);
  const work = path.join(base, "work");
  await mkdir(work);
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] }), "utf8");
  const task = {
    schemaVersion: 1,
    id: "t",
    goal: "g",
    workflow: "test",
    workspaceRoot: "./work",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
    privacy: { secretEnv: [] },
    limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 },
    verifiers: [],
  };
  await writeFile(path.join(base, "task.json"), JSON.stringify(task), "utf8");
  const run = async (): Promise<string> =>
    ((await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun })).output as EngineResult).runId;
  const earlier = await run();
  const going = await run();
  // As while it is going: its journal is there, its result is not, and it holds the lock.
  await rm(path.join(work, STATE_DIR_NAME, RUNS_DIR_NAME, going, RESULT_FILE_NAME));
  const lock = await acquireLock({ workspaceRoot: work, runId: going, clock });
  assert.ok(lock.ok, JSON.stringify(lock));
  return { base, work, earlier, going, release: async () => void (await releaseLock({ workspaceRoot: work, runId: going })) };
}

const codeOf = (outcome: object & { exitCode: number }): unknown[] => {
  const output = (outcome as { output?: { kind?: string; code?: string } }).output;
  return [output?.kind, output?.code, outcome.exitCode];
};
const IN_PROGRESS = ["error", "run_in_progress", CLI_ERROR_EXIT_CODES.run_in_progress];
const REVERT = { listRuns, inspect: inspectRun, readRecord: readRevertRecord, writeRecord: writeRevertRecord, dryRun: revertRun };
const revertOf = (base: string, run: string, more: readonly string[] = []) =>
  runRevert({ ...io(base, ["revert", "--workspace", "work", "--run", run, "--quiet", ...more]), revert: createRevertCommand(revertRun, REVERT) });

describe("U-22 (R-51 M-2): --run latest while the newest run is going, after a finished one, in every command", () => {
  test("report", async () => {
    const { base, release } = await workspace();
    try {
      assert.deepEqual(codeOf(await runReport({ argv: ["report", "--workspace", "work", "--run", "latest", "--json"], cwd: base, env: {}, listRuns })), IN_PROGRESS);
    } finally {
      await release();
    }
  });

  test("revert, and revert --dry-run: nothing is changed", async () => {
    const { base, release } = await workspace();
    try {
      assert.deepEqual(codeOf(await revertOf(base, "latest")), IN_PROGRESS);
      assert.deepEqual(codeOf(await revertOf(base, "latest", ["--dry-run"])), IN_PROGRESS);
    } finally {
      await release();
    }
  });

  test("plan", async () => {
    const { base, release } = await workspace();
    try {
      assert.deepEqual(codeOf(await runPlan(io(base, ["plan", "--task", "task.json", "--run", "latest", "--json"]))), IN_PROGRESS);
    } finally {
      await release();
    }
  });

  test("review: nothing is written", async () => {
    const { base, release } = await workspace();
    try {
      assert.deepEqual(codeOf(await runReview(io(base, ["review", "--task", "task.json", "--run", "latest", "--accept", "--json"]))), IN_PROGRESS);
    } finally {
      await release();
    }
  });

  test(
    "changes (through the app layer)",
    { todo: "R-51 M-2: the app layer's runIdOf (src/app/runs.ts, app layer) or the run list's resolveRunRef (src/cli/runs.ts, output owner N-C) still has the old rule; either calls resolveRunReference with STORE_RUN_REFERENCE_DEPS" },
    async () => {
      const { base, release } = await workspace();
      try {
        const outcome = await runChanges({ argv: ["changes", "--task", path.join(base, "task.json"), "--run", "latest", "--json"], env: {}, app: createCodarynApp(await createNodeAppEnvironment()) });
        assert.deepEqual(codeOf(outcome), IN_PROGRESS);
      } finally {
        await release();
      }
    },
  );

  test("apply takes run ids only, as before: latest is invalid_arguments", async () => {
    const { base, release } = await workspace();
    try {
      const outcome = await runApply(io(base, ["apply", "--task", "task.json", "--run", "latest", "--digest", "0123456789ab", "--quiet"]));
      assert.deepEqual(codeOf(outcome).slice(0, 2), ["error", "invalid_arguments"]);
    } finally {
      await release();
    }
  });

  test("the shared function with the store's defaults gives the same answer", async () => {
    const { work, release } = await workspace();
    try {
      const outcome = await resolveRunReference(work, "latest", STORE_RUN_REFERENCE_DEPS);
      assert.deepEqual([outcome.ok, outcome.ok ? null : outcome.code], [false, "run_in_progress"]);
    } finally {
      await release();
    }
  });
});

describe("U-22 (DR-48 (b)): a run id given as it is names that run while the newest one is going", () => {
  test("report, revert --dry-run and changes show the finished run; plan judges that run", async () => {
    const { base, earlier, release } = await workspace();
    try {
      const report = await runReport({ argv: ["report", "--workspace", "work", "--run", earlier, "--json"], cwd: base, env: {}, listRuns });
      assert.equal(report.exitCode, 0, JSON.stringify(report));
      const dry = await revertOf(base, earlier, ["--dry-run"]);
      assert.deepEqual([dry.output.kind, dry.output.kind === "revert" ? dry.output.runId : null], ["revert", earlier]);
      const changes = await runChanges({ argv: ["changes", "--task", path.join(base, "task.json"), "--run", earlier, "--json"], env: {}, app: createCodarynApp(await createNodeAppEnvironment()) });
      assert.equal(changes.exitCode, 0, JSON.stringify(changes));
      // Not a plan run: plan says so about that run, not that a run is going.
      assert.deepEqual(codeOf(await runPlan(io(base, ["plan", "--task", "task.json", "--run", earlier, "--json"]))).slice(0, 2), ["error", "run_not_plan"]);
    } finally {
      await release();
    }
  });
});
