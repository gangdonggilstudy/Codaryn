/**
 * N-27 (a) wiring: the store's run judgment (`inspectRun`) decides what an explicit `--run` id
 * names in report, plan, apply and review. "missing" (no entry of exactly that name) is
 * run_not_found; a damaged run is not shown, applied or reviewed. Real engine, store and tools;
 * scripted model; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { EngineResult } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runApply, runPlan, runReview } from "../../../src/cli/plan-commands.js";
import { runReport } from "../../../src/cli/report.js";
import { resolveRunReference } from "../../../src/cli/run-ref.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import type { RunInspection } from "../../../src/store/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 600_000;
const clock = { now: () => (now += 1000) };
let seed = 41;
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

async function planRun(): Promise<{ base: string; ws: string; planned: EngineResult }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-n27a-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(ws, "a.txt"), "alpha\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(
    path.join(base, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "g-n27a",
      goal: "g",
      workflow: "label",
      workspaceRoot: "./ws",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] },
      privacy: { secretEnv: [] },
      limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [],
      workflowRef: "organize",
    }),
    "utf8",
  );
  const outcome = await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun });
  assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
  return { base, ws, planned: outcome.output as EngineResult };
}

const judged = (inspection: RunInspection) => async (): Promise<RunInspection> => inspection;

describe("resolveRunReference with the store's judgment", () => {
  test("an explicit id the store finds missing is run_not_found; latest does not ask", async () => {
    const asked: string[] = [];
    const inspect = async (_root: string, id: string): Promise<RunInspection> => {
      asked.push(id);
      return "missing";
    };
    const missing = await resolveRunReference("/w", "20261112T000000Z-00000000", { exists: async () => false, inspect });
    assert.deepEqual(missing.ok ? null : missing.code, "run_not_found");
    const damaged = await resolveRunReference("/w", "20261112T000000Z-00000001", { exists: async () => false, inspect: judged("damaged") });
    assert.ok(damaged.ok, "damaged is the caller's to refuse");
    assert.deepEqual(asked, ["20261112T000000Z-00000000"]);
  });
});

describe("N-27: report, plan, apply and review follow the store's judgment", () => {
  test("missing is run_not_found and damaged is invalid_run_record, before anything is read or moved", async () => {
    const { base, ws, planned } = await planRun();
    const digest = (planned.plan?.digest ?? "").slice(0, 12);
    const commands = [
      (inspection: RunInspection) => runReport({ argv: ["report", "--workspace", ws, "--run", planned.runId], cwd: base, env: {}, inspectRun: judged(inspection) }),
      (inspection: RunInspection) => runPlan({ ...io(base, ["plan", "--task", "task.json", "--run", planned.runId]), inspectRun: judged(inspection) }),
      (inspection: RunInspection) => runApply({ ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest, "--quiet"]), inspectRun: judged(inspection) }),
      (inspection: RunInspection) => runReview({ ...io(base, ["review", "--task", "task.json", "--run", planned.runId, "--accept"]), inspectRun: judged(inspection) }),
    ];
    for (const [index, command] of commands.entries()) {
      for (const [inspection, code] of [["missing", "run_not_found"], ["damaged", "invalid_run_record"]] as const) {
        const outcome = await command(inspection);
        assert.ok("output" in outcome && outcome.output.kind === "error" && outcome.output.code === code, `${index} ${inspection}: ${JSON.stringify(outcome)}`);
      }
    }
    assert.equal(await readFile(path.join(ws, "a.txt"), "utf8"), "alpha\n", "nothing moved");
    // The real judgment: the plan run is checked, so plan shows it.
    const shown = await runPlan(io(base, ["plan", "--task", "task.json", "--run", planned.runId]));
    assert.ok("text" in shown, JSON.stringify(shown));
  });
});
