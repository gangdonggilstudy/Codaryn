/**
 * U-13 (UX midpoint review UXM-1, high; DR-44's complement): the records of an apply run whose
 * discarded-files folder still holds files are not removed unless the folder's removal is confirmed
 * too. Before, `cleanup --confirm <digest> --include-not-reverted` (without --delete-discarded)
 * removed the apply's and the plan run's records and left the person's file under a number name
 * (discarded/<apply run>/0): the record of its name and place was gone and revert could not put it
 * back. Now that apply run is kept (kept: discarded_left), the plan run it uses with it, the rest
 * is removed, and the outcome says why for each item.
 * UXM-1's procedure with the real engine, store and tools (run, apply, cleanup); scripted model;
 * nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { DISCARDED_DIR_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { ApplyCleanup, ApplyResult, EngineResult } from "../../../src/contracts/index.js";
import { assembleRun, createRevertCommand } from "../../../src/cli/assemble.js";
import { itemName, runCleanup } from "../../../src/cli/cleanup.js";
import type { CleanupOutput } from "../../../src/cli/cleanup.js";
import { runApply } from "../../../src/cli/plan-commands.js";
import { runRevert } from "../../../src/cli/revert.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { inspectRun, readRevertRecord, revertRun, writeRevertRecord } from "../../../src/store/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 900_000;
const clock = { now: () => (now += 1000) };
let seed = 151;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);
const exists = async (file: string): Promise<boolean> => (await stat(file).catch(() => null)) !== null;
const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
const LIMITS = { maxModelTurns: 6, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 };

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

/** UXM-1's workspace: an apply that discarded inbox/old-draft.tmp and was not reverted, and one plain run. */
async function appliedNotReverted(): Promise<{ base: string; work: string; planRunId: string; applyRunId: string; otherRunId: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u13-"));
  temporaryDirs.push(base);
  const work = path.join(base, "work");
  await mkdir(path.join(work, "inbox"), { recursive: true });
  await writeFile(path.join(work, "inbox", "old-draft.tmp"), "a person's draft\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "tidy", actions: [{ kind: "discard", path: "inbox/old-draft.tmp" }] } }] }];
  await writeFile(path.join(base, "p.script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  const task = { schemaVersion: 1, id: "p", goal: "g", workflow: "label", workspaceRoot: "./work", workflowRef: "organize", model: { provider: "scripted", scriptPath: "./p.script.json" }, policy: { ...POLICY, planActions: ["discard"] }, privacy: { secretEnv: [] }, limits: LIMITS, verifiers: [] };
  await writeFile(path.join(base, "p.task.json"), JSON.stringify(task), "utf8");
  const planned = (await runCli({ ...io(base, ["run", "--task", "p.task.json", "--quiet"]), assemble: assembleRun })).output as EngineResult;
  assert.equal(planned.reason, "plan_pending", JSON.stringify(planned));
  const applied = await runApply(io(base, ["apply", "--task", "p.task.json", "--run", planned.runId, "--digest", (planned.plan?.digest ?? "").slice(0, 12), "--quiet"]));
  assert.ok("output" in applied && applied.output.kind === "apply", JSON.stringify(applied));
  const applyRunId = (applied.output as unknown as ApplyResult).runId;

  await writeFile(path.join(base, "o.script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] }), "utf8");
  await writeFile(path.join(base, "o.task.json"), JSON.stringify({ ...task, id: "o", workflow: "test", workflowRef: undefined, model: { provider: "scripted", scriptPath: "./o.script.json" }, policy: POLICY }), "utf8");
  const other = (await runCli({ ...io(base, ["run", "--task", "o.task.json", "--quiet"]), assemble: assembleRun })).output as EngineResult;
  return { base, work, planRunId: planned.runId, applyRunId, otherRunId: other.runId };
}

async function cleanup(base: string, args: readonly string[], json = true): Promise<{ text: string; exitCode: number; output: CleanupOutput | null }> {
  const outcome = await runCleanup({ argv: ["cleanup", "--workspace", "work", ...args, ...(json ? ["--json"] : [])], cwd: base, env: {}, clock, messages: createMessageCatalog("en") });
  assert.ok("text" in outcome, JSON.stringify(outcome));
  return { text: outcome.text, exitCode: outcome.exitCode, output: json ? (JSON.parse(outcome.text) as CleanupOutput) : null };
}

const SELECT = ["--older-than", "0", "--discarded-older-than", "0"];
async function digestOf(base: string): Promise<string> {
  const shown = await cleanup(base, SELECT);
  assert.ok(shown.output?.mode === "preview", JSON.stringify(shown));
  return shown.output.plan.digest.slice(0, 12);
}
const runsOf = async (work: string): Promise<string[]> => (await readdir(path.join(work, STATE_DIR_NAME, RUNS_DIR_NAME))).sort();
const TODO = { todo: "contract and store (U-13): keep an apply run whose discarded files stay (kept: discarded_left)" };

describe("U-13 (UXM-1): an apply's records are not removed while its discarded files stay", () => {
  test("--confirm --include-not-reverted without --delete-discarded: the apply and its plan run stay, the rest goes, each kept item says why", TODO, async () => {
    const { base, work, planRunId, applyRunId, otherRunId } = await appliedNotReverted();
    const done = await cleanup(base, [...SELECT, "--confirm", await digestOf(base), "--include-not-reverted"]);
    assert.ok(done.output?.mode === "applied", JSON.stringify(done));
    assert.deepEqual(await runsOf(work), [planRunId, applyRunId].sort(), "the apply run and the plan run it uses stay");
    assert.deepEqual(done.output.outcome.removed.map((item) => itemName(item)), [otherRunId]);
    const reasons = Object.fromEntries(done.output.outcome.kept.map((item) => [`${item.target}:${itemName(item)}`, item.reason]));
    assert.equal(reasons[`run:${applyRunId}`], "discarded_left", JSON.stringify(reasons));
    assert.equal(reasons[`run:${planRunId}`], "used_by_kept_apply", JSON.stringify(reasons));
    assert.equal(reasons[`discarded:${applyRunId}`], "not_confirmed", JSON.stringify(reasons));
    assert.ok(await exists(path.join(work, STATE_DIR_NAME, DISCARDED_DIR_NAME, applyRunId)), "the discarded file stays");
  });

  test("after it the apply can still be reverted: the person's file is back under its own name", TODO, async () => {
    const { base, work, applyRunId } = await appliedNotReverted();
    await cleanup(base, [...SELECT, "--confirm", await digestOf(base), "--include-not-reverted"]);
    const reverted = await runRevert({
      ...io(base, ["revert", "--workspace", "work", "--run", applyRunId, "--quiet"]),
      revert: createRevertCommand(revertRun, { inspect: inspectRun, readRecord: readRevertRecord, writeRecord: writeRevertRecord }),
    });
    assert.equal(reverted.output.kind, "revert", JSON.stringify(reverted.output));
    assert.equal(await readFile(path.join(work, "inbox", "old-draft.tmp"), "utf8"), "a person's draft\n");
  });

  test("the person's outcome names the kept apply run and why", TODO, async () => {
    const { base, applyRunId } = await appliedNotReverted();
    const text = (await cleanup(base, [...SELECT, "--confirm", await digestOf(base), "--include-not-reverted"], false)).text;
    const line = text.split("\n").find((entry) => entry.includes(`run ${applyRunId}`));
    assert.ok(line !== undefined && /discarded/i.test(line), text);
  });

  test("with --delete-discarded too, everything selected goes (holds before U-13)", async () => {
    const { base, work, applyRunId } = await appliedNotReverted();
    const done = await cleanup(base, [...SELECT, "--confirm", await digestOf(base), "--include-not-reverted", "--delete-discarded"]);
    assert.equal(done.exitCode, 0, JSON.stringify(done));
    assert.deepEqual(await runsOf(work), []);
    assert.equal(await exists(path.join(work, STATE_DIR_NAME, DISCARDED_DIR_NAME, applyRunId)), false);
  });

  test("the preview warns that the apply's discarded files would be left (holds before U-13)", async () => {
    const { base, applyRunId } = await appliedNotReverted();
    const shown = await cleanup(base, SELECT);
    assert.ok(shown.output?.mode === "preview");
    const item = shown.output.plan.items.find((entry) => entry.target === "run" && itemName(entry) === applyRunId);
    assert.ok(item?.warnings.includes("discarded_left"), JSON.stringify(shown.output.plan.items));
  });
});

/**
 * The CLI's part, over the store's answer as the contract (96c6ca9) gives it for UXM-1's procedure:
 * the kept apply is the person's choice (the folder's removal was not confirmed), so the command
 * ends 0; the outcome counts the kept applies and each kept item says why; the preview tells
 * beforehand that such an apply's records stay without --delete-discarded.
 */
describe("U-13 (UXM-1), the CLI over the contract's answer", () => {
  const TOTALS = { runs: { count: 1, files: 1, bytes: 10 }, discarded: { count: 0, files: 0, bytes: 0 } };
  async function confirmed(json: boolean): Promise<{ text: string; exitCode: number; ids: { planRunId: string; applyRunId: string; otherRunId: string } }> {
    const { base, planRunId, applyRunId, otherRunId } = await appliedNotReverted();
    const digest = await digestOf(base);
    const applyCleanup = (async () => ({
      ok: true,
      removed: [{ target: "run", runId: otherRunId, size: { files: 1, bytes: 10 } }],
      kept: [
        { target: "run", runId: applyRunId, reason: "discarded_left" },
        { target: "run", runId: planRunId, reason: "used_by_kept_apply" },
        { target: "discarded", runId: applyRunId, reason: "not_confirmed" },
      ],
      totals: TOTALS,
    })) as unknown as ApplyCleanup;
    const outcome = await runCleanup({
      argv: ["cleanup", "--workspace", "work", ...SELECT, "--confirm", digest, "--include-not-reverted", ...(json ? ["--json"] : [])],
      cwd: base,
      env: {},
      clock,
      messages: createMessageCatalog("en"),
      applyCleanup,
    });
    assert.ok("text" in outcome, JSON.stringify(outcome));
    return { text: outcome.text, exitCode: outcome.exitCode, ids: { planRunId, applyRunId, otherRunId } };
  }

  test("an apply kept as discarded_left is the person's choice: exit 0, the reasons as the store gave them", async () => {
    const done = await confirmed(true);
    assert.equal(done.exitCode, 0, done.text);
    const output = JSON.parse(done.text) as CleanupOutput;
    assert.ok(output.mode === "applied");
    assert.deepEqual(output.outcome.kept.map((item) => item.reason), ["discarded_left", "used_by_kept_apply", "not_confirmed"]);
  });

  test("the person's outcome counts the applies kept for their discarded files and names the run", async () => {
    const done = await confirmed(false);
    const lines = done.text.split("\n");
    assert.ok(lines[0]?.startsWith("Removed: run records 1"), done.text);
    assert.ok(/1/.test(lines[1] ?? "") && /discarded/i.test(lines[1] ?? "") && !(lines[1] ?? "").startsWith("- "), done.text);
    assert.ok(lines.some((line) => line.startsWith(`- run ${done.ids.applyRunId}: `)), done.text);
  });

  test("the preview says beforehand that the apply's records stay without --delete-discarded", async () => {
    const { base } = await appliedNotReverted();
    const text = (await cleanup(base, SELECT, false)).text;
    assert.ok(text.includes("The records of 1 apply run(s) whose discarded files are still kept stay unless"), text);
  });

  test("a plan without such an apply has no such line (the preview is as before)", async () => {
    const { base, otherRunId } = await appliedNotReverted();
    const text = (await cleanup(base, ["--run", otherRunId], false)).text;
    assert.equal(text.includes("apply run(s)"), false, text);
  });
});
