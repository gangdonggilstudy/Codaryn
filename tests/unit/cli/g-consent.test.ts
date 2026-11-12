/**
 * DR-21: the consent to unsafe moves comes only from the person, for one apply: the CLI's own
 * argument (`--allow-unsafe-move`, cli-flag) or a terminal answer after the apply stopped as
 * `consent_required` (cli-tty). No task field gives it. The plan run is real (engine, store, tools,
 * scripted model); the apply engine is a stand-in that records what it was given, since an unsafe
 * move needs a volume without hard links. Nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { UNSAFE_MOVE_CONSENT_ARGUMENT } from "../../../src/contracts/index.js";
import type { ApplyDeps, ApplyResult, EngineResult } from "../../../src/contracts/index.js";
import { parseApplyArgs } from "../../../src/cli/args.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runApply } from "../../../src/cli/plan-commands.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 600_000;
const clock = { now: () => (now += 1000) };
let seed = 61;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);

const TASK = {
  schemaVersion: 1,
  id: "g-consent",
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
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-consent-"));
  temporaryDirs.push(base);
  await mkdir(path.join(base, "ws"));
  await writeFile(path.join(base, "ws", "a.txt"), "alpha\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(path.join(base, "task.json"), JSON.stringify(TASK), "utf8");
  const outcome = await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun });
  assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
  const planned = outcome.output as EngineResult;
  return { base, planned, digest: planned.plan?.digest ?? "" };
}

/** A stand-in apply engine: one unsafe move; without a consent for this digest it stops as consent_required. */
function standIn(): { calls: ApplyDeps[]; applyPlan: (deps: ApplyDeps) => Promise<ApplyResult> } {
  const calls: ApplyDeps[] = [];
  const applyPlan = async (deps: ApplyDeps): Promise<ApplyResult> => {
    calls.push(deps);
    await deps.journal.append({
      type: "apply_started",
      schemaVersion: 1,
      planRunId: deps.planRunId,
      taskId: deps.taskId,
      digest: deps.digest,
      approval: deps.approval,
      actions: 1,
      maxDurationMs: deps.maxDurationMs,
      unsafeMoveConsent: deps.unsafeMoveConsent?.channel ?? null,
    });
    await deps.journal.append({ type: "plan_checked", problems: [], inventoryLimitReached: false, unsafeMoves: [0] });
    const consented = deps.unsafeMoveConsent?.digest === deps.digest;
    await deps.journal.close();
    return {
      schemaVersion: 1,
      kind: "apply",
      runId: deps.runId,
      planRunId: deps.planRunId,
      taskId: deps.taskId,
      digest: deps.digest,
      status: consented ? "done" : "needs-input",
      reason: consented ? "verified" : "consent_required",
      exitCode: consented ? 0 : 3,
      applied: [],
      verifiers: [],
      usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 },
      journalPath: `.codaryn/runs/${deps.runId}/journal.jsonl`,
      notices: [],
    };
  };
  return { calls, applyPlan };
}

describe("DR-21: the consent argument", () => {
  test("apply takes --allow-unsafe-move as a switch; it is off by default", () => {
    const base = ["apply", "--task", "t.json", "--run", "20261112T000000Z-00000000", "--digest", "0".repeat(12)];
    const off = parseApplyArgs(base);
    const on = parseApplyArgs([...base, UNSAFE_MOVE_CONSENT_ARGUMENT]);
    assert.ok(off.ok && on.ok);
    assert.deepEqual([off.args.allowUnsafeMove, on.args.allowUnsafeMove], [false, true]);
    assert.equal(parseApplyArgs([...base, `${UNSAFE_MOVE_CONSENT_ARGUMENT}=yes`]).ok, false);
  });

  test("with the argument the apply gets a cli-flag consent for this plan's digest", async () => {
    const { base, planned, digest } = await planRun();
    const engine = standIn();
    const outcome = await runApply({
      ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest.slice(0, 12), UNSAFE_MOVE_CONSENT_ARGUMENT, "--quiet"]),
      applyPlan: engine.applyPlan,
    });
    assert.ok("output" in outcome && outcome.output.kind === "apply" && outcome.exitCode === 0, JSON.stringify(outcome));
    assert.equal(engine.calls.length, 1);
    assert.deepEqual(engine.calls[0]?.unsafeMoveConsent, { channel: "cli-flag", digest });
  });

  test("without it and with no terminal, the apply stops as consent_required and gets no consent", async () => {
    const { base, planned, digest } = await planRun();
    const engine = standIn();
    const outcome = await runApply({ ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest.slice(0, 12), "--quiet"]), applyPlan: engine.applyPlan });
    assert.ok("output" in outcome && outcome.output.kind === "apply");
    assert.deepEqual([(outcome.output as ApplyResult).reason, outcome.exitCode], ["consent_required", 3]);
    assert.equal(engine.calls.length, 1);
    assert.equal(engine.calls[0]?.unsafeMoveConsent ?? null, null);
  });
});

describe("DR-21: the terminal answer", () => {
  test("after consent_required the person is asked once; yes applies again with a cli-tty consent, the default is no", async () => {
    for (const [answer, calls, reason] of [["y", 2, "verified"], ["", 1, "consent_required"], ["no", 1, "consent_required"]] as const) {
      const { base, planned, digest } = await planRun();
      const engine = standIn();
      const questions: string[] = [];
      const outcome = await runApply({
        ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest.slice(0, 12), "--quiet"]),
        applyPlan: engine.applyPlan,
        ask: async (question: string) => {
          questions.push(question);
          return answer;
        },
      });
      assert.ok("output" in outcome && outcome.output.kind === "apply", JSON.stringify(outcome));
      assert.equal((outcome.output as ApplyResult).reason, reason, answer);
      assert.equal(engine.calls.length, calls, answer);
      assert.equal(questions.length, 1, "asked once, about the unsafe moves");
      assert.ok(questions[0]?.includes("1 move") && questions[0].includes("[y/N]"), String(questions[0]));
      assert.equal(engine.calls[0]?.unsafeMoveConsent ?? null, null);
      if (calls === 2) {
        assert.deepEqual(engine.calls[1]?.unsafeMoveConsent, { channel: "cli-tty", digest });
        assert.notEqual(engine.calls[1]?.runId, engine.calls[0]?.runId, "a second apply run");
      }
    }
  });

  test("with the argument given, the person is not asked again", async () => {
    const { base, planned, digest } = await planRun();
    const engine = standIn();
    let asked = 0;
    await runApply({
      ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest.slice(0, 12), UNSAFE_MOVE_CONSENT_ARGUMENT, "--quiet"]),
      applyPlan: engine.applyPlan,
      ask: async () => {
        asked += 1;
        return "y";
      },
    });
    assert.equal(asked, 0);
  });
});

describe("DR-21: no file gives the consent", () => {
  test("a task with a consent field is refused before anything is applied", async () => {
    const { base, planned, digest } = await planRun();
    for (const extra of [{ unsafeMoveConsent: { channel: "cli-flag", digest } }, { policy: { ...TASK.policy, allowUnsafeMove: true } }]) {
      await writeFile(path.join(base, "task2.json"), JSON.stringify({ ...TASK, ...extra }), "utf8");
      const engine = standIn();
      const outcome = await runApply({ ...io(base, ["apply", "--task", "task2.json", "--run", planned.runId, "--digest", digest.slice(0, 12), "--quiet"]), applyPlan: engine.applyPlan });
      assert.ok("output" in outcome && outcome.output.kind === "error" && outcome.output.code === "invalid_task", JSON.stringify(outcome));
      assert.equal(engine.calls.length, 0);
    }
  });
});

describe("DR-21: the real engine records the consent", () => {
  test("apply_started names cli-flag; on a volume with hard links the move is made safely", async () => {
    const { base, planned, digest } = await planRun();
    const outcome = await runApply(io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest.slice(0, 12), UNSAFE_MOVE_CONSENT_ARGUMENT, "--quiet"]));
    assert.ok("output" in outcome && outcome.output.kind === "apply", JSON.stringify(outcome));
    const result = outcome.output as ApplyResult;
    const first = JSON.parse((await readFile(path.join(base, "ws", result.journalPath), "utf8")).split("\n")[0] ?? "{}") as Record<string, unknown>;
    assert.deepEqual([first["type"], first["unsafeMoveConsent"]], ["apply_started", "cli-flag"]);
    if (result.reason === "verified") assert.equal(result.applied.some((item) => item.unsafe === true), false);
  });
});
