/**
 * U-29 (review R-44 R44-L1, contract and store), the CLI's part: a run between the plan and its
 * apply that could not check the state directory entirely (it was too large) may have changed the
 * plan run's records without a records-changed mark. Before, an apply whose own checks were complete
 * said nothing of it. Now the CLI passes the store's stateUncheckedSince as
 * ApplyDeps.planRecordsUnchecked, and the apply goes on with noticeKinds ["plan_records_unchecked"]
 * and one notice that names the earlier run's check. A run before the plan run does not count.
 * The real CLI under the net guard; scripted model; nothing is sent. The state directory is made too
 * large with one top-level file above the store's per-file hashing limit, as in g-u8.
 * Run ids start with their second; the store orders runs by id, so two runs started in the same
 * second are ordered by their random part. The cases wait for the next second between the runs so
 * "before" and "after" are what the ids say (the same-second case is the store's, reported apart).
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, test } from "node:test";
import { STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { ApplyResult, EngineResult } from "../../../src/contracts/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const main = path.resolve(here, "..", "..", "..", "src", "cli", "main.js");
const guard = pathToFileURL(path.resolve(here, "..", "..", "support", "net-guard.js")).href;
const env: Record<string, string> = { CODARYN_LANG: "en" };
for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "HOME"]) {
  const value = process.env[name];
  if (value !== undefined) env[name] = value;
}

const LIMITS = { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 };
const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
const PLAN_TASK = {
  schemaVersion: 1,
  id: "u29",
  goal: "g",
  workflow: "label",
  workspaceRoot: "./ws",
  model: { provider: "scripted", scriptPath: "./plan.script.json" },
  policy: { ...POLICY, planActions: ["move"] },
  privacy: { secretEnv: [] },
  limits: LIMITS,
  verifiers: [],
  workflowRef: "organize",
};
const OTHER_TASK = { ...PLAN_TASK, id: "other", workflow: "test", workflowRef: undefined, model: { provider: "scripted", scriptPath: "./other.script.json" }, policy: POLICY };

/**
 * A plan run and its apply on the real CLI, with one other run made while the state directory was
 * too large to check: `when` says whether that run came after the plan run or before it.
 */
async function applied(when: "after_plan" | "before_plan"): Promise<ApplyResult> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u29-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(path.join(ws, STATE_DIR_NAME), { recursive: true });
  await writeFile(path.join(ws, "a.txt"), "alpha\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(base, "plan.script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(path.join(base, "other.script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] }), "utf8");
  await writeFile(path.join(base, "plan.task.json"), JSON.stringify(PLAN_TASK), "utf8");
  await writeFile(path.join(base, "other.task.json"), JSON.stringify(OTHER_TASK), "utf8");
  const cli = (args: readonly string[]) => spawnSync(process.execPath, ["--import", guard, main, ...args], { cwd: base, env, encoding: "utf8" });
  const large = path.join(ws, STATE_DIR_NAME, "large.bin");
  /** Waits until the clock is in a later second than when it was called (run ids name their second). */
  const nextSecond = async (): Promise<void> => {
    const second = Math.floor(Date.now() / 1000);
    while (Math.floor(Date.now() / 1000) === second) await new Promise((resolve) => setTimeout(resolve, 50));
  };
  const otherRun = async (): Promise<void> => {
    // Above the store's per-file hashing limit for the rest of the state directory (1 MiB): the run's state checks are limited.
    await writeFile(large, Buffer.alloc(1024 * 1024 + 1, 0x61));
    const other = cli(["run", "--task", "other.task.json", "--quiet"]);
    assert.ok(other.stdout.includes('"kind":"run"'), other.stdout + other.stderr);
    await rm(large);
  };

  if (when === "before_plan") {
    await otherRun();
    await nextSecond();
  }
  const planned = JSON.parse(cli(["run", "--task", "plan.task.json", "--quiet"]).stdout) as EngineResult;
  assert.equal(planned.reason, "plan_pending", JSON.stringify(planned));
  if (when === "after_plan") {
    await nextSecond();
    await otherRun();
  }

  // The apply's own checks are complete: the large file is gone again.
  const run = cli(["apply", "--task", "plan.task.json", "--run", planned.runId, "--digest", (planned.plan?.digest ?? "").slice(0, 12), "--quiet"]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const apply = JSON.parse(run.stdout) as ApplyResult;
  assert.deepEqual([apply.status, apply.reason], ["done", "verified"], run.stdout);
  assert.equal(await readFile(path.join(ws, "sorted", "a.txt"), "utf8"), "alpha\n");
  return apply;
}

describe("U-29 (R-44 R44-L1): an apply tells when a run since the plan could not check the state directory", () => {
  test("a run after the plan run with a limited state check: the apply goes on, with the notice kind and one notice", async () => {
    const apply = await applied("after_plan");
    assert.deepEqual(apply.noticeKinds, ["plan_records_unchecked"], JSON.stringify(apply));
    const told = apply.notices.filter((notice) => notice.includes("(plan_records_unchecked)"));
    assert.equal(told.length, 1, JSON.stringify(apply.notices));
    assert.ok(told[0]?.includes("a run since the plan was made"), JSON.stringify(told));
  });

  test("a run before the plan run does not count: no notice kind, no notice", async () => {
    const apply = await applied("before_plan");
    assert.equal(Object.hasOwn(apply, "noticeKinds"), false, JSON.stringify(apply));
    assert.deepEqual(apply.notices, []);
  });
});
