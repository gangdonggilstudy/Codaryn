/**
 * U-1 (review R-33 R33-L3, contract 3ac7c4f): `codaryn apply` does not apply a plan run with a
 * records-changed mark (DR-38; a mark that cannot be read counts too). Its plan may differ from what
 * the person saw. The CLI refuses it as plan_records_changed (exit 2) right after loading the plan,
 * before anything is asked: nothing is recorded or moved and no apply run is made. It also passes
 * ApplyDeps.planRecordsChanged, the engine's check of the same under the lock.
 * Real engine, store and tools; scripted model; the process case runs the real CLI under the net
 * guard. Nothing is sent.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, test } from "node:test";
import { RECORDS_CHANGED_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
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
let seed = 131;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);

const TASK = {
  schemaVersion: 1,
  id: "u1",
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

async function planRun(): Promise<{ base: string; ws: string; planned: EngineResult; digest: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u1-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(ws, "a.txt"), "alpha\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(path.join(base, "task.json"), JSON.stringify(TASK), "utf8");
  const outcome = await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun });
  const planned = outcome.output as EngineResult;
  assert.equal(planned.reason, "plan_pending", JSON.stringify(planned));
  return { base, ws, planned, digest: planned.plan?.digest ?? "" };
}

const markOf = (ws: string, runId: string): string => path.join(ws, STATE_DIR_NAME, RUNS_DIR_NAME, runId, RECORDS_CHANGED_FILE_NAME);
const runsIn = async (ws: string): Promise<string[]> => readdir(path.join(ws, STATE_DIR_NAME, RUNS_DIR_NAME));

describe("U-1: apply refuses a plan run whose records were changed", () => {
  test("--digest: plan_records_changed, exit 2; nothing moved, no apply run made", async () => {
    const { base, ws, planned, digest } = await planRun();
    await writeFile(markOf(ws, planned.runId), "{}", "utf8");
    let applied = false;
    const outcome = await runApply({
      ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest.slice(0, 12), "--quiet"]),
      applyPlan: async (deps: ApplyDeps) => ((applied = true), engineApplyPlan(deps)),
    });
    assert.ok("output" in outcome, JSON.stringify(outcome));
    const output = outcome.output as { kind: string; code?: string; exitCode?: number };
    assert.deepEqual([output.kind, output.code, outcome.exitCode], ["error", "plan_records_changed", 2], JSON.stringify(output));
    assert.equal(applied, false, "the engine is not called");
    assert.equal(await readFile(path.join(ws, "a.txt"), "utf8"), "alpha\n", "nothing moved");
    assert.deepEqual(await runsIn(ws), [planned.runId], "no apply run made");
  });

  test("at a terminal: refused before the plan is shown or asked about", async () => {
    const { base, ws, planned } = await planRun();
    await writeFile(markOf(ws, planned.runId), "{}", "utf8");
    let asked = false;
    const outcome = await runApply({
      ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--quiet"]),
      ask: async () => ((asked = true), "y"),
    });
    assert.ok("output" in outcome && (outcome.output as { code?: string }).code === "plan_records_changed", JSON.stringify(outcome));
    assert.equal(asked, false, "nothing is asked");
  });

  test("a mark that cannot be read counts (a directory in its place)", async () => {
    const { base, ws, planned, digest } = await planRun();
    await mkdir(markOf(ws, planned.runId));
    const outcome = await runApply(io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest.slice(0, 12), "--quiet"]));
    assert.ok("output" in outcome && (outcome.output as { code?: string }).code === "plan_records_changed", JSON.stringify(outcome));
  });

  test("an unmarked plan run is applied as before, and the engine gets the check under the lock", async () => {
    const { base, ws, planned, digest } = await planRun();
    let check: (() => Promise<boolean>) | undefined;
    const outcome = await runApply({
      ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest.slice(0, 12), "--quiet"]),
      applyPlan: async (deps: ApplyDeps) => {
        check = deps.planRecordsChanged;
        return engineApplyPlan(deps);
      },
    });
    assert.ok("output" in outcome && outcome.output.kind === "apply", JSON.stringify(outcome));
    assert.deepEqual([(outcome.output as unknown as ApplyResult).status, (outcome.output as unknown as ApplyResult).reason], ["done", "verified"]);
    assert.equal(await readFile(path.join(ws, "sorted", "a.txt"), "utf8"), "alpha\n");
    assert.ok(check !== undefined, "ApplyDeps.planRecordsChanged is passed");
    assert.equal(await check(), false);
    await writeFile(markOf(ws, planned.runId), "{}", "utf8");
    assert.equal(await check(), true, "it reads the plan run's mark when called");
  });

  test(
    "a mark written after the CLI's check: the engine's check under the lock ends the apply failed/plan_stale; nothing moved",
    { todo: "engine (U-1): ApplyDeps.planRecordsChanged right after apply_started" },
    async () => {
      const { base, ws, planned, digest } = await planRun();
      let calls = 0;
      const outcome = await runApply({
        ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest.slice(0, 12), "--quiet"]),
        // The CLI's own check sees no mark; the next one (the engine's, under the lock) does.
        hasRecordsChangedMark: async () => (calls += 1) > 1,
      });
      assert.ok("output" in outcome && outcome.output.kind === "apply", JSON.stringify(outcome));
      const result = outcome.output as unknown as ApplyResult;
      assert.deepEqual([result.status, result.reason], ["failed", "plan_stale"], JSON.stringify(result));
      assert.equal(await readFile(path.join(ws, "a.txt"), "utf8"), "alpha\n", "nothing moved");
    },
  );
});

describe("U-1 on the real CLI: R-33's procedure A", () => {
  test("a later run's command marks the plan run; apply --digest is then refused and moves nothing", async () => {
    const { base, ws, planned, digest } = await planRun();
    // A second run in the same workspace whose verifier (task configuration) adds a file to every
    // run's records, as the allowed command of R-33's procedure did: it ends failed/state_changed
    // and the engine marks the runs named, the plan run among them.
    const tamper = "const fs=require('fs');const d='.codaryn/runs';for(const r of fs.readdirSync(d))fs.writeFileSync(d+'/'+r+'/extra.txt','x')";
    await writeFile(path.join(base, "doc-script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] }), "utf8");
    await writeFile(
      path.join(base, "doc.json"),
      JSON.stringify({
        ...TASK,
        id: "doc",
        workflow: "test",
        workflowRef: undefined,
        model: { provider: "scripted", scriptPath: "./doc-script.json" },
        policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
        verifiers: [{ id: "tamper", kind: "command", executable: process.execPath, args: ["-e", tamper] }],
      }),
      "utf8",
    );
    const main = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "cli", "main.js");
    const guard = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "support", "net-guard.js")).href;
    const env: Record<string, string> = { CODARYN_LANG: "en" };
    for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "HOME"]) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
    const cli = (args: readonly string[]) => spawnSync(process.execPath, ["--import", guard, main, ...args], { cwd: base, env, encoding: "utf8" });

    const doc = cli(["run", "--task", "doc.json", "--quiet"]);
    const docResult = JSON.parse(doc.stdout) as EngineResult;
    assert.deepEqual([docResult.status, docResult.reason], ["failed", "state_changed"], doc.stdout);
    const marks = await readdir(path.join(ws, STATE_DIR_NAME, RUNS_DIR_NAME, planned.runId));
    assert.ok(marks.includes(RECORDS_CHANGED_FILE_NAME), JSON.stringify(marks));

    const apply = cli(["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest.slice(0, 12)]);
    assert.equal(apply.status, 2, apply.stdout + apply.stderr);
    const refused = JSON.parse(apply.stdout) as { kind: string; code: string };
    assert.deepEqual([refused.kind, refused.code], ["error", "plan_records_changed"]);
    assert.equal(await readFile(path.join(ws, "a.txt"), "utf8"), "alpha\n", "nothing moved");
    assert.equal((await runsIn(ws)).length, 2, "no apply run made (the plan run and the doc run only)");
    refusedStderr = apply.stderr;
  });

  test(
    "the person's error lines name the refusal (error.plan_records_changed.what/.fix)",
    { todo: "N-B (U-1): the texts of error.plan_records_changed.what and .fix; without them the error lines are not written" },
    () => {
      assert.ok(refusedStderr.includes("(plan_records_changed)"), refusedStderr);
    },
  );
});

/** The stderr of the refused apply above, for the case that checks the person's lines. */
let refusedStderr = "";
