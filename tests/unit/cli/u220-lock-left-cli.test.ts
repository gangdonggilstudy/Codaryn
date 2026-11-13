/**
 * U-220 (ne-verify's finding; U-176, U-201): when the workspace lock cannot be released at the end of
 * the CLI's run, apply or revert (the release throws after its retries, as when another program holds
 * the lock file without delete sharing), the command no longer ends as internal_error: it prints its
 * own result as before (the JSON is unchanged), keeps its exit code, and its end summary says
 * lock.release_failed. The lock stays, judged as any other (U-176). Here the release's removal of
 * lock.json fails (EBUSY, injected only there, as Codex's V-4 did); the run, the apply and the revert
 * are the CLI's own, in process, with the real store. Scripted model, temporary folders.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import type { ApplyResult, EngineResult, RevertOutput } from "../../../src/contracts/index.js";
import { assembleRun, createRevertCommand } from "../../../src/cli/assemble.js";
import { createHumanOutput } from "../../../src/cli/human/index.js";
import { runApply } from "../../../src/cli/plan-commands.js";
import { runRevert } from "../../../src/cli/revert.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { inspectRun, listRuns, loadPlan, readRevertRecord, releaseLock, revertRun, writeRevertRecord } from "../../../src/store/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 600_000;
const clock = { now: () => (now += 1000) };
let seed = 31;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);
const en = createMessageCatalog("en");
const LINE = en.format("lock.release_failed");

const TASK = {
  schemaVersion: 1,
  id: "u220",
  goal: "g",
  workflow: "label",
  workspaceRoot: "./ws",
  model: { provider: "scripted", scriptPath: "./script.json" },
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] },
  privacy: { secretEnv: [] },
  limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
  verifiers: [],
  workflowRef: "organize",
};

const io = (base: string, argv: readonly string[]) => ({
  argv,
  env: {},
  cwd: base,
  readFile: (file: string) => readFile(file, "utf8"),
  isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
  loadEnvFile: () => {},
  locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
  relatePaths: (target: string, root: string) => relateRealPaths(target, root),
  clock,
  randomBytes,
  cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
});

const require = createRequire(import.meta.url);
const promises: { rm: typeof import("node:fs/promises").rm } = require("node:fs/promises");

/** Runs `run` while removing <base>/ws/.codaryn/lock.json fails with EBUSY; every other removal is real. */
async function whileLockStays<T>(base: string, run: () => Promise<T>): Promise<T> {
  const lock = path.join(base, "ws", ".codaryn", "lock.json").toLowerCase();
  const original = promises.rm;
  promises.rm = async (target, options) => {
    if (path.resolve(String(target)).toLowerCase() === lock) throw Object.assign(new Error("U-220 injected EBUSY"), { code: "EBUSY" });
    return original(target, options);
  };
  syncBuiltinESMExports();
  try {
    return await run();
  } finally {
    promises.rm = original;
    syncBuiltinESMExports();
  }
}

/** The lock left behind, released by its own id (U-176: the same id's release still removes it). */
async function takeBack(base: string): Promise<void> {
  const lock = path.join(base, "ws", ".codaryn", "lock.json");
  if (!existsSync(lock)) return;
  const runId = (JSON.parse(readFileSync(lock, "utf8")) as { runId: string }).runId;
  assert.equal(await releaseLock({ workspaceRoot: path.join(base, "ws"), runId }), true);
}

async function workspace(): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-u220-"));
  temporaryDirs.push(base);
  await mkdir(path.join(base, "ws"));
  await writeFile(path.join(base, "ws", "a.txt"), "alpha\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(path.join(base, "task.json"), JSON.stringify(TASK), "utf8");
  return base;
}

/** The CLI's run with its end summary in English; `stderr` gets the summary. */
async function run(base: string, stderr: string[] = []) {
  return runCli({
    ...io(base, ["run", "--task", "task.json"]),
    assemble: assembleRun,
    writeProgress: (line: string) => stderr.push(line),
    human: () => ({ output: createHumanOutput(en), messages: en }),
  });
}

describe("U-220: the run's lock cannot be released at its end", () => {
  test("the run's own result and exit code, as with the lock released; the summary says the lock was left", async () => {
    const base = await workspace();
    const stderr: string[] = [];
    const left = await whileLockStays(base, () => run(base, stderr));
    assert.equal(left.output.kind, "run", JSON.stringify(left.output));
    const result = left.output as EngineResult;
    assert.deepEqual([result.status, result.reason, left.exitCode], ["needs-input", "plan_pending", result.exitCode]);
    assert.ok(stderr.join("\n").includes(LINE), stderr.join("\n"));
    // The result is the stored one, and the lock stays (U-176), taken back by its own id here.
    const stored = JSON.parse(readFileSync(path.join(base, "ws", ".codaryn", "runs", result.runId, "result.json"), "utf8")) as EngineResult;
    assert.deepEqual(stored, result);
    assert.ok(existsSync(path.join(base, "ws", ".codaryn", "lock.json")), "the lock is left");
    assert.equal(Object.hasOwn(result, "lockLeft"), false, "the JSON has no new field");
    await takeBack(base);

    // The same run with the lock released: the same kind of output, no such line.
    const plain: string[] = [];
    const released = await run(base, plain);
    assert.equal(released.output.kind, "run");
    assert.ok(!plain.join("\n").includes(LINE));
    assert.equal(existsSync(path.join(base, "ws", ".codaryn", "lock.json")), false);
  });

  test("assembleRun's finish: lockLeft instead of a throw, the result stored; released: nothing", async () => {
    const base = await workspace();
    const outcome = await run(base);
    const planned = outcome.output as EngineResult;
    await rm(path.join(base, "ws", ".codaryn", "runs", planned.runId, "result.json"));
    // A finish of a fresh assembly over the same task, the lock held by it.
    const { parseTask } = await import("../../../src/cli/task.js");
    const parsed = parseTask(JSON.parse(await readFile(path.join(base, "task.json"), "utf8")), base);
    assert.ok(parsed.ok);
    const assembled = await assembleRun({ task: parsed.task, runId: "20260101T000000Z-0000aaaa", model: {} as never, secrets: [], clock, signal: new AbortController().signal } as never);
    assert.ok(assembled.ok, JSON.stringify(assembled));
    const result = { ...planned, runId: "20260101T000000Z-0000aaaa", journalPath: ".codaryn/runs/20260101T000000Z-0000aaaa/journal.jsonl" } as EngineResult;
    const finished = await whileLockStays(base, () => assembled.finish(result));
    assert.deepEqual(finished, { lockLeft: true });
    assert.ok(existsSync(path.join(base, "ws", ".codaryn", "runs", result.runId, "result.json")), "stored all the same");
    await takeBack(base);
  });
});

describe("U-220: the apply's and the revert's lock cannot be released at their end", () => {
  test("apply: its own result and exit code; the summary says the lock was left", async () => {
    const base = await workspace();
    const planned = (await run(base)).output as EngineResult;
    const digest = planned.plan?.digest ?? "";
    const stderr: string[] = [];
    const outcome = await whileLockStays(base, () =>
      runApply({
        ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest.slice(0, 12)]),
        writeProgress: (line: string) => stderr.push(line),
        human: createHumanOutput(en),
      }),
    );
    assert.ok("output" in outcome && outcome.output.kind === "apply", JSON.stringify(outcome));
    const result = outcome.output as unknown as ApplyResult;
    assert.deepEqual([result.status, result.reason, outcome.exitCode], ["done", "verified", 0]);
    assert.equal(readFileSync(path.join(base, "ws", "sorted", "a.txt"), "utf8"), "alpha\n");
    assert.ok(stderr.join("\n").includes(LINE), stderr.join("\n"));
    assert.equal(Object.hasOwn(result, "lockLeft"), false);
    await takeBack(base);
  });

  test("revert: its own output and exit code; the outcome carries lockLeft for the summary, the JSON does not", async () => {
    const base = await workspace();
    const planned = (await run(base)).output as EngineResult;
    const digest = planned.plan?.digest ?? "";
    const applied = await runApply(io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest.slice(0, 12), "--quiet"]));
    assert.ok("output" in applied && applied.output.kind === "apply");
    const applyRunId = (applied.output as unknown as ApplyResult).runId;
    const revert = createRevertCommand(revertRun, { listRuns, readRecord: readRevertRecord, writeRecord: writeRevertRecord, inspect: inspectRun, loadPlan });
    const outcome = await whileLockStays(base, () =>
      runRevert({ argv: ["revert", "--workspace", "ws", "--run", applyRunId], cwd: base, isDirectory: io(base, []).isDirectory, clock, randomBytes, revert }),
    );
    assert.equal(outcome.output.kind, "revert", JSON.stringify(outcome.output));
    const output = outcome.output as RevertOutput;
    assert.deepEqual([output.status, outcome.exitCode], ["complete", 0]);
    assert.equal(outcome.lockLeft, true);
    assert.equal(Object.hasOwn(output, "lockLeft"), false, "the JSON line is as before");
    assert.equal(readFileSync(path.join(base, "ws", "a.txt"), "utf8"), "alpha\n", "the file went back");
    // What main.ts writes with it: U-201's line after the revert's lists.
    assert.ok(createHumanOutput(en).revertSummary(output, { lockLeft: outcome.lockLeft }).includes(LINE));
    await takeBack(base);
  });
});
