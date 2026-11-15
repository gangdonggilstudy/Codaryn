/**
 * U-18 (AXM-4, contract 8024a8a), the CLI's part: a call the policy allowed and that then failed was
 * told only as "allowed"; the end summary counted the denied calls only, and the report's tool-call
 * line said nothing of it. The one rule (RunSummaryContext.failedToolCalls): a `tool_result` with
 * `ok: false` whose `callId` has no `tool_decision` with `allowed: false` in the run. A denied call is
 * a denied call only.
 * - run: RunSummaryContext.failedToolCalls counts them (run.ts fills it from the journal).
 * - progress: without a human renderer, the English progress lines give one `failed` line per failed
 *   call (progress.ts); a successful result and a denied call's result give none.
 * - report: the text's tool-call line adds the failed calls when there are any, counted from the
 *   journal; `report --json` does not change (PM Q-3).
 * The real engine, store and tools in this process, scripted model; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { EngineResult } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runReport } from "../../../src/cli/report.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 600_000;
const clock = { now: () => (now += 1000) };
let seed = 18;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);

const WRONG_HASH = "0".repeat(64);

/** Four calls: two allowed that fail, one denied by the policy, one that succeeds. */
const FAILING_CALLS = [
  { name: "read_file", args: { path: "missing.txt" } },
  { name: "write_file", args: { path: "a.txt", expectedHash: WRONG_HASH, change: { kind: "replace_all", content: "x\n" } } },
  { name: "run_command", args: { executable: "node", args: ["--version"] } },
  { name: "read_file", args: { path: "a.txt" } },
];

async function ran(calls: readonly unknown[]): Promise<{ base: string; ws: string; run: Awaited<ReturnType<typeof runCli>>; progress: string[] }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u18-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(ws, "a.txt"), "alpha\n", "utf8");
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ toolCalls: calls }, { text: "done" }] }), "utf8");
  const task = {
    schemaVersion: 1,
    id: "g-u18",
    goal: "g",
    workflow: "test",
    workspaceRoot: "./ws",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
    privacy: { secretEnv: [] },
    limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
    verifiers: [],
  };
  await writeFile(path.join(base, "task.json"), JSON.stringify(task), "utf8");
  const progress: string[] = [];
  const run = await runCli({
    argv: ["run", "--task", "task.json"],
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
    assemble: assembleRun,
    // No human renderer: the English progress lines of progress.ts.
    writeProgress: (line: string) => progress.push(line),
  });
  assert.equal(run.output.kind, "run", JSON.stringify(run.output));
  return { base, ws, run, progress };
}

async function report(base: string, ws: string, runId: string, json: boolean): Promise<string> {
  const outcome = await runReport({ argv: ["report", "--workspace", ws, "--run", runId, ...(json ? ["--json"] : [])], cwd: base, env: {} });
  assert.ok("text" in outcome && outcome.exitCode === 0, JSON.stringify(outcome));
  return outcome.text;
}

describe("U-18 (AXM-4): a call that was allowed and then failed is told and counted", () => {
  test("the end summary's context counts the failed calls apart from the denied one", async () => {
    const { run } = await ran(FAILING_CALLS);
    assert.deepEqual([run.info?.summary.deniedToolCalls, run.info?.summary.failedToolCalls], [1, 2], JSON.stringify(run.info?.summary));
  });

  test("the English progress lines: one failed line per failed call, none for the denied call's result or a success", async () => {
    const { progress } = await ran(FAILING_CALLS);
    const failed = progress.filter((line) => line.includes(": failed ("));
    assert.deepEqual(failed, ["codaryn: tool read_file: failed (not_found)\n", "codaryn: tool write_file: failed (conflict)\n"], progress.join(""));
    assert.equal(progress.filter((line) => line.startsWith("codaryn: tool run_command: denied")).length, 1, progress.join(""));
  });

  test("the report's text adds the failed calls to its tool-call line; report --json is as before", async () => {
    const { base, ws, run } = await ran(FAILING_CALLS);
    const runId = (run.output as EngineResult).runId;
    const text = await report(base, ws, runId, false);
    // usage.toolCalls is the engine's count (the denied call is not among them); the line adds the failed ones.
    assert.match(text, /^- Tool calls: \d+ of 8 \(denied: 1, failed: 2\)$/m, text);
    const json = JSON.parse(await report(base, ws, runId, true)) as { journal: Record<string, unknown> };
    assert.equal(JSON.stringify(json).includes("failed"), false, "no failed count in the JSON");
    assert.equal(json.journal["deniedToolCalls"], 1);
  });

  test("a run without failed calls: no failed line, a count of 0, and the report's line as before", async () => {
    const { base, ws, run, progress } = await ran([{ name: "read_file", args: { path: "a.txt" } }]);
    assert.equal(run.info?.summary.failedToolCalls, 0);
    assert.equal(progress.some((line) => line.includes(": failed (")), false, progress.join(""));
    const text = await report(base, ws, (run.output as EngineResult).runId, false);
    assert.match(text, /^- Tool calls: 1 of 8 \(denied: 0\)$/m, text);
  });
});
