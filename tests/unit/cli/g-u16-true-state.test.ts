/**
 * U-16 (UX midpoint review UXM-4, UXM-5, UXM-15): what the commands say about plan and apply runs
 * is to match what happened. Reproductions on the real engine, store and tools; the cases that
 * need another owner's part first are todo and say whose.
 * - UXM-5: a plan run that was applied still reads needs-input/plan_pending in `runs`, with nothing
 *   saying it was applied or by which run; reverting the plan run (which changed nothing) answers
 *   complete and marks it reverted, though the apply's changes are still there.
 * - UXM-4: `changes` of an apply run says the run changed no file while `runs` counts its actions.
 * - UXM-15: a plan made from a task file and applied in the quick form loses the task's verifiers
 *   without a word (not refused; to be told in the result's notices and the person's output).
 * Scripted model; fake key value; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { ApplyResult, EngineResult, RunsOutput } from "../../../src/contracts/index.js";
import { createCodarynApp, createNodeAppEnvironment } from "../../../src/app/index.js";
import { assembleRun, createRevertCommand } from "../../../src/cli/assemble.js";
import { renderChanges, runChanges } from "../../../src/cli/changes.js";
import { createHumanOutput } from "../../../src/cli/human/index.js";
import { runApply } from "../../../src/cli/plan-commands.js";
import { appliedPlanHint, runRevert } from "../../../src/cli/revert.js";
import { runCli } from "../../../src/cli/run.js";
import { runRuns } from "../../../src/cli/runs.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { inspectRun, loadPlan, readRevertRecord, revertRun, writeRevertRecord } from "../../../src/store/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 900_000;
const clock = { now: () => (now += 1000) };
let seed = 171;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);
const FAKE_KEY = ["fake", "u16", "anthropic", "value", "0001"].join("-");
const LIMITS = { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 };

const TASK = {
  schemaVersion: 1,
  id: "organize-demo",
  goal: "g",
  workflow: "label",
  workspaceRoot: "./ws",
  model: { provider: "scripted", scriptPath: "./script.json" },
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] },
  privacy: { secretEnv: [] },
  limits: LIMITS,
  verifiers: [{ id: "moved", kind: "file_rules", rules: [{ type: "exists", path: "sorted/a.txt" }] }],
  workflowRef: "organize",
};

const io = (base: string, argv: readonly string[], env: Record<string, string> = {}) => ({
  argv,
  env,
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
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u16-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(ws, "a.txt"), "alpha\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(path.join(base, "task.json"), JSON.stringify(TASK), "utf8");
  const planned = (await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun })).output as EngineResult;
  assert.equal(planned.reason, "plan_pending", JSON.stringify(planned));
  return { base, ws, planned, digest: (planned.plan?.digest ?? "").slice(0, 12) };
}

async function applyWithTask(base: string, planned: EngineResult, digest: string): Promise<ApplyResult> {
  const outcome = await runApply(io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest, "--quiet"]));
  assert.ok("output" in outcome && outcome.output.kind === "apply", JSON.stringify(outcome));
  return outcome.output as unknown as ApplyResult;
}

async function runsOf(base: string, json: boolean): Promise<string> {
  const outcome = await runRuns({ argv: ["runs", "--workspace", "ws", ...(json ? ["--json"] : [])], cwd: base, env: {}, human: createHumanOutput(createMessageCatalog("en")) });
  return "text" in outcome ? outcome.text : JSON.stringify(outcome.output);
}

type Entry = { runId: string; kind?: string; planRunId?: string; reason?: string | null; reverted?: unknown; appliedBy?: { runId: string } | null };
const entriesOf = async (base: string): Promise<Entry[]> => (JSON.parse(await runsOf(base, true)) as RunsOutput).runs as unknown as Entry[];

describe("U-16 (UXM-5): the run list says a plan run was applied, and by which run", () => {
  test("the apply run's entry names its plan run (holds today)", async () => {
    const { base, planned, digest } = await planRun();
    const applied = await applyWithTask(base, planned, digest);
    const entry = (await entriesOf(base)).find((run) => run.runId === applied.runId);
    assert.deepEqual([entry?.kind, entry?.planRunId], ["apply", planned.runId]);
  });

  test(
    "the applied plan run's entry names the apply run",
    async () => {
      const { base, planned, digest } = await planRun();
      const applied = await applyWithTask(base, planned, digest);
      const entry = (await entriesOf(base)).find((run) => run.runId === planned.runId);
      assert.equal(entry?.appliedBy?.runId, applied.runId, JSON.stringify(entry));
    },
  );

  const REVERT = { dryRun: revertRun, inspect: inspectRun, readRecord: readRevertRecord, writeRecord: writeRevertRecord, loadPlan };
  const revertOf = (base: string, runId: string, more: readonly string[] = []) =>
    runRevert({ ...io(base, ["revert", "--workspace", "ws", "--run", runId, "--quiet", ...more]), revert: createRevertCommand(revertRun, REVERT) });

  test("reverting the applied plan run changes nothing, leaves no 'reverted' on it and names the apply run", async () => {
    const { base, ws, planned, digest } = await planRun();
    const applied = await applyWithTask(base, planned, digest);
    const outcome = await revertOf(base, planned.runId);
    assert.equal(await readFile(path.join(ws, "sorted", "a.txt"), "utf8"), "alpha\n", "the apply's move is still there");
    const entry = (await entriesOf(base)).find((run) => run.runId === planned.runId);
    assert.equal(entry?.reverted ?? null, null, JSON.stringify([outcome.output, entry]));
    assert.equal(outcome.hint, appliedPlanHint(planned.runId, applied.runId, false));
    assert.ok(outcome.hint?.includes(`--run ${applied.runId}`), outcome.hint);
    // The JSON line is as before: complete, nothing reverted, no new field.
    assert.deepEqual(Object.keys(outcome.output).sort(), ["exitCode", "kind", "reverted", "runId", "schemaVersion", "skipped", "status"]);
    assert.deepEqual([outcome.output.kind === "revert" && outcome.output.status, outcome.exitCode], ["complete", 0]);
  });

  test("a dry run of it tells the same and writes nothing", async () => {
    const { base, planned, digest } = await planRun();
    const applied = await applyWithTask(base, planned, digest);
    const outcome = await revertOf(base, planned.runId, ["--dry-run"]);
    assert.equal(outcome.hint, appliedPlanHint(planned.runId, applied.runId, true));
  });

  test("a plan run not applied, and the apply run itself, revert as before: no hint, a record", async () => {
    const pending = await planRun();
    const first = await revertOf(pending.base, pending.planned.runId);
    assert.equal(first.hint, undefined);
    assert.notEqual((await entriesOf(pending.base)).find((run) => run.runId === pending.planned.runId)?.reverted ?? null, null);

    const { base, ws, planned, digest } = await planRun();
    const applied = await applyWithTask(base, planned, digest);
    const second = await revertOf(base, applied.runId);
    assert.equal(second.hint, undefined);
    assert.equal(await readFile(path.join(ws, "a.txt"), "utf8"), "alpha\n", "the apply's move is undone");
    assert.notEqual((await entriesOf(base)).find((run) => run.runId === applied.runId)?.reverted ?? null, null);
  });
});

describe("U-16 (UXM-4): changes of an apply run does not say the run changed no file", () => {
  test("the text names the apply's actions and its plan run, through the real app layer", async () => {
    const { base, planned, digest } = await planRun();
    const applied = await applyWithTask(base, planned, digest);
    assert.equal(applied.applied.length, 1);
    const outcome = await runChanges({ argv: ["changes", "--task", path.join(base, "task.json"), "--run", applied.runId], env: {}, app: createCodarynApp(await createNodeAppEnvironment()) });
    assert.ok("text" in outcome, JSON.stringify(outcome));
    assert.equal(outcome.text.includes("the run changed no file"), false, outcome.text);
    assert.ok(outcome.text.includes(`it applied 1 action(s) of the plan of run ${planned.runId}`), outcome.text);
  });
});

describe("U-16 (UXM-4): the CLI's text over the app layer's applyRun (contract ChangesApplyRun)", () => {
  const VIEW = { schemaVersion: 1, kind: "changes", runId: "20261112T010203Z-0a1b2c3d", exitCode: 0, masking: "current_secrets", files: [] } as const;

  test("an apply run: the text names the plan run and the count of applied actions, not 'changed no file'", () => {
    const text = renderChanges({ ...VIEW, applyRun: { planRunId: "20261112T010100Z-0a1b2c3c", actions: 2 } } as never);
    assert.equal(text.includes("the run changed no file"), false, text);
    assert.ok(text.includes("20261112T010100Z-0a1b2c3c") && text.includes("2 action(s)") && text.includes("codaryn report"), text);
  });

  test("a run without applyRun and without files: as before", () => {
    assert.equal(renderChanges(VIEW as never), `changes of run ${VIEW.runId}, masked with the secrets registered now (not the run's own masking)\nthe run changed no file\n`);
  });
});

describe("U-16 (UXM-15): a plan made from a task file and applied in the quick form", () => {
  async function quickApply(): Promise<{ withTask: ApplyResult; quick: ApplyResult }> {
    const first = await planRun();
    const withTask = await applyWithTask(first.base, first.planned, first.digest);
    const { base, planned, digest } = await planRun();
    await writeFile(path.join(base, "config.json"), JSON.stringify({ schemaVersion: 1, model: "claude-x", maxOutputTokens: 100, limits: { ...LIMITS, maxTotalTokens: 1000 } }), "utf8");
    const outcome = await runApply(
      io(base, ["apply", "--workspace", "ws", "--workflow", "organize", "--config", "config.json", "--run", planned.runId, "--digest", digest, "--quiet"], { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY }),
    );
    assert.ok("output" in outcome && outcome.output.kind === "apply", JSON.stringify(outcome));
    return { withTask, quick: outcome.output as unknown as ApplyResult };
  }

  test("the task's verifier runs with the task file and not in the quick form; both end done (as UXM-15 saw)", async () => {
    const { withTask, quick } = await quickApply();
    // 2 of 2 with the task file (the apply's own inventory check and the task's), 1 of 1 in the quick form.
    assert.deepEqual([withTask.status, withTask.verifiers.map((verifier) => verifier.id)], ["done", ["inventory", "moved"]]);
    assert.deepEqual([quick.status, quick.verifiers.map((verifier) => verifier.id)], ["done", ["inventory"]]);
    assert.notEqual(quick.taskId, withTask.taskId);
  });

  test("the quick apply's result tells that the plan was made by another task (plan_task_differs); the task-file apply does not", async () => {
    const { withTask, quick } = await quickApply();
    assert.deepEqual(quick.noticeKinds, ["plan_task_differs"], JSON.stringify(quick));
    assert.ok(quick.notices.some((notice) => notice.includes("another task")), JSON.stringify(quick.notices));
    assert.equal(quick.status, "done", "told, not refused");
    assert.equal(withTask.noticeKinds, undefined, JSON.stringify(withTask));
  });
});
