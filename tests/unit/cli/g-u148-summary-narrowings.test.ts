/**
 * U-148 (U-140, UXM-18): RunSummaryContext.policyNarrowings, so the end summary can tell once more
 * what the task type's own rules left out (the start line's notice is easy to pass over). `run` now
 * fills it with exactly what its run_started record holds; absent when that has none (no task type,
 * or one that left nothing out). The renderer's lines are nc-human's (U-146); the JSON and the
 * journal are as before.
 * `codaryn run` in process with the real assembly, a task file and the scripted model; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { EngineResult, JournalRecord, RunSummaryContext } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";

const dirs: string[] = [];
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

const LIMITS = { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: null, maxDurationMs: 60_000 };
let seed = 148;

/** A task file run; what run tells the summary, and the run_started record. */
async function run(extra: Record<string, unknown>, policy: Record<string, unknown> = {}): Promise<{ summary: RunSummaryContext; started: Extract<JournalRecord, { type: "run_started" }> }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u148-"));
  dirs.push(base);
  await mkdir(path.join(base, "work"));
  await writeFile(path.join(base, "s.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] }), "utf8");
  const task = {
    schemaVersion: 1,
    id: "u148",
    goal: "g",
    workflow: "test",
    workspaceRoot: "./work",
    model: { provider: "scripted", scriptPath: "./s.json" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, ...policy },
    privacy: { secretEnv: [] },
    limits: LIMITS,
    verifiers: [],
    ...extra,
  };
  await writeFile(path.join(base, "task.json"), JSON.stringify(task), "utf8");
  const io = {
    argv: ["run", "--task", path.join(base, "task.json"), "--quiet"],
    env: {},
    cwd: base,
    readFile: (file: string) => readFile(file, "utf8"),
    isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    loadEnvFile: () => {},
    locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
    relatePaths: (target: string, root: string) => relateRealPaths(target, root),
    clock: { now: () => Date.now() },
    randomBytes: (size: number) => new Uint8Array(size).fill(seed++ % 250),
    assemble: assembleRun,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  } as CliEnvironment;
  const outcome = await runCli(io);
  const result = outcome.output as EngineResult;
  assert.equal(result.kind, "run", JSON.stringify(outcome.output));
  assert.ok(outcome.info !== undefined);
  const journal = (await readFile(path.join(base, "work", ".codaryn", "runs", result.runId, "journal.jsonl"), "utf8"))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as JournalRecord);
  const started = journal.find((record): record is Extract<JournalRecord, { type: "run_started" }> => record.type === "run_started");
  assert.ok(started !== undefined);
  return { summary: outcome.info.summary, started };
}

describe("U-148: the end summary is told what the task type left out, as run_started records it", () => {
  test("a task type that turns off the given path token restoring: the same list as run_started", async () => {
    const { summary, started } = await run({ workflowRef: "organize" }, { restorePathTokens: true, planActions: ["move"] });
    assert.ok((started.policyNarrowings?.length ?? 0) > 0, JSON.stringify(started));
    assert.deepEqual(summary.policyNarrowings, started.policyNarrowings);
  });

  test("no task type: none recorded, none told", async () => {
    const { summary, started } = await run({});
    assert.equal(started.policyNarrowings, undefined);
    assert.equal("policyNarrowings" in summary, false);
  });

  test("a task type that leaves nothing out: none told", async () => {
    const { summary, started } = await run({ workflowRef: "organize" }, { planActions: ["move"] });
    assert.equal(started.policyNarrowings, undefined, JSON.stringify(started));
    assert.equal("policyNarrowings" in summary, false);
  });
});
