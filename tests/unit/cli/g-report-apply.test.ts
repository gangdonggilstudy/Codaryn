/**
 * DR-12 (G-G report): report reads an apply run (its journal starts with `apply_started`) and its
 * result.json (ApplyResult), checked against each other, as it reads a run. Real engine, store and
 * tools on a temporary workspace; scripted model. Nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { ApplyResult, EngineResult } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runApply } from "../../../src/cli/plan-commands.js";
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
let seed = 141;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);

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

/** A plan run that moves a.txt and discards b.txt, then its apply. */
async function appliedRun(): Promise<{ base: string; ws: string; planned: EngineResult; result: ApplyResult }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-report-apply-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(ws, "a.txt"), "alpha\n", "utf8");
  await writeFile(path.join(ws, "b.txt"), "beta\n", "utf8");
  const actions = [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }, { kind: "discard", path: "b.txt" }];
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions } }] }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(
    path.join(base, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "g-report-apply",
      goal: "sort",
      workflow: "label",
      workspaceRoot: "./ws",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move", "discard"] },
      privacy: { secretEnv: [] },
      limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [],
      workflowRef: "organize",
    }),
    "utf8",
  );
  const run = await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun });
  assert.equal(run.output.kind, "run", JSON.stringify(run.output));
  const planned = run.output as EngineResult;
  const digest = (planned.plan?.digest ?? "").slice(0, 12);
  const applied = await runApply(io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest, "--quiet"]));
  assert.ok("output" in applied && applied.output.kind === "apply", JSON.stringify(applied));
  return { base, ws, planned, result: applied.output as ApplyResult };
}

interface ApplyReportJson {
  kind: string;
  runKind: string;
  runId: string;
  status: string;
  exitCode: number;
  result: ApplyResult | null;
  journal: { planRunId: string; digest: string; approval: string; actions: number; moved: unknown[]; discarded: unknown[]; lastRound: { kind: string }[]; finished: { status: string } | null };
}

describe("DR-12: report reads an apply run", () => {
  test("--json: the apply's result and its journal, checked against each other", async () => {
    const { base, ws, planned, result } = await appliedRun();
    const report = await runReport({ argv: ["report", "--workspace", ws, "--run", result.runId, "--json"], cwd: base, env: {} });
    assert.ok("text" in report && report.exitCode === 0, JSON.stringify(report));
    const json = JSON.parse(report.text) as ApplyReportJson;
    assert.deepEqual([json.kind, json.runKind, json.runId, json.status], ["report", "apply", result.runId, "complete"]);
    assert.equal(json.result?.kind, "apply");
    assert.deepEqual([json.journal.planRunId, json.journal.digest, json.journal.approval, json.journal.actions], [planned.runId, planned.plan?.digest, "cli-flag", 2]);
    assert.deepEqual([json.journal.moved.length, json.journal.discarded.length], [1, 1]);
    assert.equal(json.journal.lastRound[0]?.kind, "inventory");
    assert.equal(json.journal.finished?.status, "done");
  });

  test("the Markdown names the plan run, each applied action, the inventory check and how to revert", async () => {
    const { base, ws, planned, result } = await appliedRun();
    const report = await runReport({ argv: ["report", "--workspace", ws, "--run", result.runId], cwd: base, env: {} });
    assert.ok("text" in report, JSON.stringify(report));
    for (const part of ["apply run", planned.runId, "sorted/a.txt", "b.txt", "inventory", "done", "codaryn revert --workspace", `--run ${result.runId}`]) {
      assert.ok(report.text.includes(part), part);
    }
  });

  test("without result.json the report is incomplete (exit 3) and shows what the journal holds", async () => {
    const { base, ws, result } = await appliedRun();
    await rm(path.join(ws, ".codaryn", "runs", result.runId, "result.json"));
    const report = await runReport({ argv: ["report", "--workspace", ws, "--run", result.runId, "--json"], cwd: base, env: {}, isDamaged: async () => false });
    assert.ok("text" in report && report.exitCode === 3, JSON.stringify(report));
    const json = JSON.parse(report.text) as ApplyReportJson;
    assert.deepEqual([json.status, json.result, json.journal.moved.length], ["incomplete", null, 1]);
  });

  test("a result.json for another plan than the journal's is invalid_run_record", async () => {
    const { base, ws, result } = await appliedRun();
    const file = path.join(ws, ".codaryn", "runs", result.runId, "result.json");
    const stored = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    await writeFile(file, JSON.stringify({ ...stored, planRunId: "20261112T000000Z-00000000" }), "utf8");
    const report = await runReport({ argv: ["report", "--workspace", ws, "--run", result.runId], cwd: base, env: {}, isDamaged: async () => false });
    assert.ok("output" in report && report.output.kind === "error" && report.output.code === "invalid_run_record", JSON.stringify(report));
  });
});
