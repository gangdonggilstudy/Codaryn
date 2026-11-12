/**
 * U-8 (review R-39 L-1, contract 07f8f8d, engine 7785186): an apply whose state checks were limited
 * (the state directory is too large to check entirely) is not refused, but says that the plan run's
 * records could not be checked: ApplyResult.noticeKinds ["plan_records_unchecked"] and one fixed
 * notice. The CLI's part: `apply` prints and stores it, and `report` keeps it (it rebuilds the
 * result field by field). An apply whose checks were complete prints exactly what it did before:
 * no noticeKinds and no notice.
 * The real CLI under the net guard; scripted model for the plan run; nothing is sent. The state
 * directory is made too large with one top-level file above the store's per-file hashing limit.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, test } from "node:test";
import { RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { ApplyReportOutput, ApplyResult, EngineResult } from "../../../src/contracts/index.js";

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

const TASK = {
  schemaVersion: 1,
  id: "u8",
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

/** A plan run, then its apply and the apply's report, on the real CLI. `large`: the state directory is too large to check. */
async function applied(large: boolean): Promise<{ apply: ApplyResult; applyText: string; stored: string; report: ApplyReportOutput; reportText: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u8-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(ws, "a.txt"), "alpha\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(path.join(base, "task.json"), JSON.stringify(TASK), "utf8");
  const cli = (args: readonly string[]) => spawnSync(process.execPath, ["--import", guard, main, ...args], { cwd: base, env, encoding: "utf8" });

  const planned = JSON.parse(cli(["run", "--task", "task.json", "--quiet"]).stdout) as EngineResult;
  assert.equal(planned.reason, "plan_pending", JSON.stringify(planned));
  // Above the store's per-file hashing limit for the rest of the state directory (1 MiB).
  if (large) await writeFile(path.join(ws, STATE_DIR_NAME, "large.bin"), Buffer.alloc(1024 * 1024 + 1, 0x61));

  const run = cli(["apply", "--task", "task.json", "--run", planned.runId, "--digest", (planned.plan?.digest ?? "").slice(0, 12), "--quiet"]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const apply = JSON.parse(run.stdout) as ApplyResult;
  assert.deepEqual([apply.status, apply.reason], ["done", "verified"], run.stdout);
  assert.equal(await readFile(path.join(ws, "sorted", "a.txt"), "utf8"), "alpha\n");
  const stored = await readFile(path.join(ws, STATE_DIR_NAME, RUNS_DIR_NAME, apply.runId, "result.json"), "utf8");
  const reportJson = cli(["report", "--workspace", "ws", "--run", apply.runId, "--json"]);
  const reportText = cli(["report", "--workspace", "ws", "--run", apply.runId]).stdout;
  return { apply, applyText: run.stdout, stored, report: JSON.parse(reportJson.stdout) as ApplyReportOutput, reportText };
}

describe("U-8: an apply whose state checks were limited says the plan's records were not checked", () => {
  test("a state directory too large to check: the apply goes on, with the notice kind and its notice; report keeps both", async () => {
    const { apply, stored, report, reportText } = await applied(true);
    assert.deepEqual(apply.noticeKinds, ["plan_records_unchecked"]);
    assert.equal(apply.notices.filter((notice) => notice.includes("(plan_records_unchecked)")).length, 1, JSON.stringify(apply.notices));
    assert.deepEqual((JSON.parse(stored) as ApplyResult).noticeKinds, ["plan_records_unchecked"]);
    assert.deepEqual(report.result?.noticeKinds, ["plan_records_unchecked"], "report --json keeps the kind");
    assert.deepEqual(report.result?.notices, apply.notices);
    assert.ok(reportText.includes("plan_records_unchecked"), reportText);
  });

  test("a checked apply prints what it did before: no noticeKinds, no notice, in apply, result.json and report", async () => {
    const { apply, applyText, stored, report } = await applied(false);
    assert.deepEqual(apply.notices, []);
    for (const text of [applyText, stored, JSON.stringify(report)]) assert.equal(text.includes("noticeKinds") || text.includes("plan_records_unchecked"), false, text);
    // The keys of the apply output, in order, as before U-8.
    assert.deepEqual(Object.keys(apply), ["schemaVersion", "kind", "runId", "planRunId", "taskId", "digest", "status", "reason", "exitCode", "applied", "verifiers", "usage", "journalPath", "notices"]);
  });
});
