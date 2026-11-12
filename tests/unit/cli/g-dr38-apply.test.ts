/**
 * DR-38 for apply runs, the CLI's part (store 156f6f5, contract b085cfa, engine c56b9ae): the apply
 * run's journal, its plan mark and its discarded-files folder come from createApplyRecorders, and
 * its stateGuard is ApplyDeps.stateGuard. A plain apply still ends done; one whose records change
 * during its verification ends failed/state_changed, and its moves stay for revert.
 * Real engine, store and tools; scripted model for the plan run; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { ApplyDeps, ApplyResult, EngineResult } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runApply } from "../../../src/cli/plan-commands.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { applyPlan as engineApplyPlan } from "../../../src/engine/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 600_000;
const clock = { now: () => (now += 1000) };
let seed = 71;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);

const TASK = {
  schemaVersion: 1,
  id: "g-dr38-apply",
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

async function planRun(): Promise<{ base: string; planned: EngineResult; digest: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-dr38-apply-"));
  temporaryDirs.push(base);
  await mkdir(path.join(base, "ws"));
  await writeFile(path.join(base, "ws", "a.txt"), "alpha\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(path.join(base, "task.json"), JSON.stringify(TASK), "utf8");
  const outcome = await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun });
  assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
  const planned = outcome.output as EngineResult;
  assert.equal(planned.reason, "plan_pending", JSON.stringify(planned));
  return { base, planned, digest: planned.plan?.digest ?? "" };
}

async function apply(base: string, planned: EngineResult, digest: string, taskFile: string, applyPlan?: (deps: ApplyDeps) => Promise<ApplyResult>): Promise<ApplyResult> {
  const outcome = await runApply({
    ...io(base, ["apply", "--task", taskFile, "--run", planned.runId, "--digest", digest.slice(0, 12), "--quiet"]),
    ...(applyPlan === undefined ? {} : { applyPlan }),
  });
  assert.ok("output" in outcome && outcome.output.kind === "apply", JSON.stringify(outcome));
  return outcome.output as unknown as ApplyResult;
}

describe("DR-38: the apply run's state guard is the engine's", () => {
  test("ApplyDeps.stateGuard is passed", async () => {
    const { base, planned, digest } = await planRun();
    let deps: ApplyDeps | null = null;
    await apply(base, planned, digest, "task.json", async (given) => {
      deps = given;
      return engineApplyPlan(given);
    });
    assert.ok(deps !== null);
    assert.ok((deps as ApplyDeps).stateGuard !== undefined, "the CLI passes no stateGuard to the apply engine");
  });

  test("a plain apply still ends done and moves the file", async () => {
    const { base, planned, digest } = await planRun();
    const result = await apply(base, planned, digest, "task.json");
    assert.deepEqual([result.status, result.reason], ["done", "verified"], JSON.stringify(result));
    assert.equal(await readFile(path.join(base, "ws", "sorted", "a.txt"), "utf8"), "alpha\n");
    assert.deepEqual(result.stateChanged, []);
  });

  test("a verifier that adds a file to the apply run's records ends it failed/state_changed; the move stays", async () => {
    const { base, planned, digest } = await planRun();
    const tamper = "const fs=require('fs');const d='.codaryn/runs';for(const r of fs.readdirSync(d))fs.writeFileSync(d+'/'+r+'/extra.txt','x')";
    await writeFile(
      path.join(base, "task2.json"),
      JSON.stringify({ ...TASK, verifiers: [{ id: "tamper", kind: "command", executable: process.execPath, args: ["-e", tamper] }] }),
      "utf8",
    );
    const result = await apply(base, planned, digest, "task2.json");
    assert.deepEqual([result.status, result.reason], ["failed", "state_changed"], JSON.stringify(result));
    assert.ok((result.stateChanged ?? []).map(String).includes(`${RUNS_DIR_NAME}/${result.runId}/extra.txt`), JSON.stringify(result.stateChanged));
    assert.equal(await readFile(path.join(base, "ws", "sorted", "a.txt"), "utf8"), "alpha\n", "the move stays for revert");
    const marks = await readdir(path.join(base, "ws", STATE_DIR_NAME, RUNS_DIR_NAME, result.runId));
    assert.ok(marks.includes("records-changed.json"), JSON.stringify(marks));
  });
});
