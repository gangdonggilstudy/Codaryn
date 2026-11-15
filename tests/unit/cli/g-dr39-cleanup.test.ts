/**
 * DR-39, the CLI's part: `codaryn cleanup` over the store's summarizeState, planCleanup and
 * applyCleanup (dab75e6). A preview is the default and removes nothing; run records go only with
 * `--confirm <the plan's digest, 12+ hex>`; people's discarded files need `--delete-discarded`
 * besides (a second, separate confirmation). Parked files, the lock and anything a revert still
 * needs (a plan run an unselected apply uses) are never removed: the store blocks them.
 * Real store and runs; scripted model; nothing is sent.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { DISCARDED_DIR_NAME, NOT_REVERTED_WARNINGS, PARKED_DIR_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { ApplyResult, EngineResult } from "../../../src/contracts/index.js";
import { assembleRun, createRevertCommand } from "../../../src/cli/assemble.js";
import { runApply } from "../../../src/cli/plan-commands.js";
import { runRevert } from "../../../src/cli/revert.js";
import { inspectRun, revertRun } from "../../../src/store/index.js";
import { itemName, runCleanup } from "../../../src/cli/cleanup.js";
import type { CleanupOutput } from "../../../src/cli/cleanup.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const exists = async (file: string): Promise<boolean> => (await stat(file).catch(() => null)) !== null;

/** A workspace with `count` finished runs (scripted, no change). */
async function workspaceWithRuns(count: number): Promise<{ base: string; work: string; runIds: string[] }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-dr39-"));
  temporaryDirs.push(base);
  const work = path.join(base, "work");
  await mkdir(work);
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] }), "utf8");
  await writeFile(
    path.join(base, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "dr39",
      goal: "g",
      workflow: "test",
      workspaceRoot: "./work",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
      privacy: { secretEnv: [] },
      limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [],
    }),
    "utf8",
  );
  for (let index = 0; index < count; index += 1) {
    const outcome = await runCli({
      argv: ["run", "--task", path.join(base, "task.json"), "--quiet"],
      env: {},
      cwd: base,
      readFile: (file) => readFile(file, "utf8"),
      isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
      loadEnvFile: () => {},
      locateInWorkspace: (file, root) => locateInWorkspace(file, root),
      clock: { now: () => Date.now() },
      randomBytes: (size) => randomBytes(size),
      assemble: assembleRun,
      cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    });
    assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
  }
  const runIds = (await readdir(path.join(work, STATE_DIR_NAME, RUNS_DIR_NAME))).sort();
  assert.equal(runIds.length, count);
  return { base, work, runIds };
}

async function cleanup(base: string, args: readonly string[], json = true): Promise<{ text: string; exitCode: number; output: CleanupOutput | null; error: unknown }> {
  const outcome = await runCleanup({
    argv: ["cleanup", "--workspace", "work", ...args, ...(json ? ["--json"] : [])],
    cwd: base,
    env: {},
    clock: { now: () => Date.now() },
    messages: createMessageCatalog("en"),
  });
  if ("output" in outcome) return { text: "", exitCode: outcome.exitCode, output: null, error: outcome.output };
  return { text: outcome.text, exitCode: outcome.exitCode, output: json ? (JSON.parse(outcome.text) as CleanupOutput) : null, error: null };
}

const runDir = (work: string, runId: string): string => path.join(work, STATE_DIR_NAME, RUNS_DIR_NAME, runId);

describe("DR-39: codaryn cleanup previews first and removes only what was confirmed", () => {
  test("without --confirm it is a preview: the plan and the summary, nothing removed", async () => {
    const { base, work, runIds } = await workspaceWithRuns(2);
    const target = runIds[0] as string;
    const preview = await cleanup(base, ["--run", target]);
    assert.equal(preview.exitCode, 0, JSON.stringify(preview));
    const output = preview.output;
    assert.ok(output !== null && output.status === "preview", JSON.stringify(output));
    assert.deepEqual(output.plan.items.map((item) => [item.target, itemName(item)]), [["run", target]]);
    assert.deepEqual(output.plan.items[0]?.warnings, [], "a run that changed nothing has nothing to revert");
    assert.equal(output.summary.runs.count, 2);
    assert.match(output.plan.digest, /^[0-9a-f]{64}$/);
    assert.ok(await exists(runDir(work, target)), "a preview removes nothing");
  });

  test("--confirm with the plan's digest removes the selected run records only", async () => {
    const { base, work, runIds } = await workspaceWithRuns(2);
    const [target, other] = runIds as [string, string];
    const preview = await cleanup(base, ["--run", target]);
    assert.ok(preview.output?.status === "preview");
    const digest = preview.output.plan.digest.slice(0, 12);
    const done = await cleanup(base, ["--run", target, "--confirm", digest]);
    assert.equal(done.exitCode, 0, JSON.stringify(done));
    assert.ok(done.output !== null && done.output.status !== "preview", JSON.stringify(done.output));
    assert.deepEqual(done.output.outcome.removed.map((item) => itemName(item)), [target]);
    assert.equal(await exists(runDir(work, target)), false);
    assert.ok(await exists(runDir(work, other)), "a run not selected stays");
    const log = await readFile(path.join(work, STATE_DIR_NAME, "cleanup.jsonl"), "utf8");
    assert.equal(log.includes(target), false, "the cleanup log holds counts and sizes only");
  });

  // U-22 (DR-48): a digest that is not the plan's is now the error cleanup_plan_changed (exit 2);
  // the case is in g-u22-cleanup-output.test.ts.

  test("people's discarded files need --delete-discarded besides --confirm", async () => {
    const { base, work, runIds } = await workspaceWithRuns(1);
    const target = runIds[0] as string;
    const folder = path.join(work, STATE_DIR_NAME, DISCARDED_DIR_NAME, target);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "0"), "a person's file\n", "utf8");
    const preview = await cleanup(base, ["--discarded-run", target]);
    assert.ok(preview.output?.status === "preview", JSON.stringify(preview));
    assert.deepEqual(preview.output.plan.items.map((item) => [item.target, itemName(item)]), [["discarded", target]]);
    assert.ok(preview.output.plan.items[0]?.warnings.includes("people_files"));
    const digest = preview.output.plan.digest.slice(0, 12);

    const runsOnly = await cleanup(base, ["--discarded-run", target, "--confirm", digest]);
    assert.ok(runsOnly.output !== null && runsOnly.output.status !== "preview", JSON.stringify(runsOnly.output));
    assert.deepEqual(runsOnly.output.outcome.kept, [{ target: "discarded", runId: target, reason: "not_confirmed" }]);
    assert.ok(await exists(path.join(folder, "0")), "not confirmed: the files stay");

    const both = await cleanup(base, ["--discarded-run", target, "--confirm", digest, "--delete-discarded"]);
    assert.ok(both.output !== null && both.output.status !== "preview", JSON.stringify(both.output));
    assert.deepEqual(both.output.outcome.removed.map((item) => [item.target, itemName(item)]), [["discarded", target]]);
    assert.equal(await exists(folder), false);
  });

  test("parked files are never items; the summary shows them", async () => {
    const { base, work, runIds } = await workspaceWithRuns(1);
    const parked = path.join(work, STATE_DIR_NAME, PARKED_DIR_NAME, runIds[0] as string);
    await mkdir(parked, { recursive: true });
    await writeFile(path.join(parked, "kept.txt"), "x", "utf8");
    const preview = await cleanup(base, ["--older-than", "0"]);
    assert.ok(preview.output?.status === "preview", JSON.stringify(preview));
    assert.equal(preview.output.summary.parked.files, 1);
    assert.ok(preview.output.plan.items.every((item) => item.target === "run" || item.target === "discarded"));
    const done = await cleanup(base, ["--older-than", "0", "--confirm", preview.output.plan.digest.slice(0, 12)]);
    assert.ok(done.output !== null && done.output.status !== "preview", JSON.stringify(done.output));
    assert.ok(await exists(path.join(parked, "kept.txt")), "parked files stay");
  });

  test("the human preview names the totals, the warnings and how to confirm; nothing removed", async () => {
    const { base, work, runIds } = await workspaceWithRuns(1);
    const target = runIds[0] as string;
    const shown = await cleanup(base, ["--run", target]);
    assert.ok(shown.output?.status === "preview", JSON.stringify(shown));
    const { summary, plan } = shown.output;
    const preview = await cleanup(base, ["--run", target], false);
    assert.equal(preview.exitCode, 0);
    // The catalog's lines (their words are N-B's), with the numbers of the JSON preview.
    const en = createMessageCatalog("en");
    assert.ok(preview.text.includes(en.format("cleanup.summary.runs", { count: summary.runs.count, bytes: summary.runs.bytes })), preview.text);
    // U-86: the run's group, by what it needs (a run not reverted needs --include-not-reverted).
    const item = plan.items[0];
    assert.ok(item !== undefined, JSON.stringify(plan));
    const group = item.warnings.some((code) => (NOT_REVERTED_WARNINGS as readonly string[]).includes(code)) ? "cleanup.group.include_not_reverted" : "cleanup.group.confirm";
    assert.ok(preview.text.includes(en.format(group, { count: 1, bytes: item.size.bytes })), preview.text);
    assert.ok(preview.text.includes(target), preview.text);
    assert.ok(preview.text.includes("--confirm "), preview.text);
    assert.ok(await exists(runDir(work, target)));
  });

  // U-86 (UXM-10): with no selection option the preview offers two example commands.
  test("no selection offers example commands", async () => {
    const { base } = await workspaceWithRuns(1);
    const preview = await cleanup(base, [], false);
    assert.equal(preview.exitCode, 0);
    const en = createMessageCatalog("en");
    for (const id of ["cleanup.no_selection", "cleanup.example.older_than", "cleanup.example.reverted"] as const) assert.ok(preview.text.includes(en.format(id)), preview.text);
    assert.equal(preview.text.includes(en.format("cleanup.nothing")), false, preview.text);
  });

  test("bad arguments are refused before anything is read", async () => {
    const { base } = await workspaceWithRuns(1);
    for (const args of [["--older-than", "soon"], ["--older-than", "-1"], ["--delete-discarded"], ["--confirm", "abc"], ["--run", "latest"], ["--run", "a,,b"]]) {
      const result = await cleanup(base, args);
      assert.equal((result.error as { code?: string } | null)?.code, "invalid_arguments", JSON.stringify([args, result]));
    }
  });
});

describe("DR-39: cleanup keeps what a revert needs", () => {
  /** Real time (DR-19 judges future times damaged), moving one second per call. */
  let now = Date.now() - 600_000;
  const clock = { now: () => (now += 1000) };
  let seed = 81;
  const bytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);
  const TASK = {
    schemaVersion: 1,
    id: "dr39-apply",
    goal: "g",
    workflow: "label",
    workspaceRoot: "./work",
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
    randomBytes: bytes,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  });

  async function cleanupAt(base: string, args: readonly string[]): Promise<CleanupOutput> {
    const outcome = await runCleanup({ argv: ["cleanup", "--workspace", "work", ...args, "--json"], cwd: base, env: {}, clock });
    assert.ok("text" in outcome, JSON.stringify(outcome));
    return JSON.parse(outcome.text) as CleanupOutput;
  }

  test("a plan run that an unselected apply uses is blocked; the apply can still be reverted", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-dr39-apply-"));
    temporaryDirs.push(base);
    await mkdir(path.join(base, "work"));
    await writeFile(path.join(base, "work", "a.txt"), "alpha\n", "utf8");
    const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
    await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
    await writeFile(path.join(base, "task.json"), JSON.stringify(TASK), "utf8");
    const planned = (await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun })).output as EngineResult;
    assert.equal(planned.reason, "plan_pending", JSON.stringify(planned));
    const applied = await runApply(io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", (planned.plan?.digest ?? "").slice(0, 12), "--quiet"]));
    assert.ok("output" in applied && applied.output.kind === "apply", JSON.stringify(applied));
    const applyRunId = (applied.output as unknown as ApplyResult).runId;

    const preview = await cleanupAt(base, ["--run", planned.runId]);
    assert.ok(preview.status === "preview", JSON.stringify(preview));
    assert.deepEqual(preview.plan.items, []);
    assert.deepEqual(preview.plan.blocked, [{ target: "run", runId: planned.runId, code: "plan_used_by_apply" }]);
    const done = await cleanupAt(base, ["--run", planned.runId, "--confirm", preview.plan.digest.slice(0, 12)]);
    assert.ok(done.status !== "preview", JSON.stringify(done));
    assert.deepEqual(done.outcome.removed, []);
    assert.ok(await exists(runDir(path.join(base, "work"), planned.runId)), "the plan run stays");

    const reverted = await runRevert({ ...io(base, ["revert", "--workspace", "work", "--run", applyRunId, "--quiet"]), revert: createRevertCommand(revertRun, { inspect: inspectRun }) });
    assert.equal(reverted.output.kind, "revert", JSON.stringify(reverted.output));
    assert.equal(await readFile(path.join(base, "work", "a.txt"), "utf8"), "alpha\n", "the apply was reverted with its plan run");
  });

  test("an apply run not reverted is warned about (its records are what a revert needs)", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-dr39-apply-"));
    temporaryDirs.push(base);
    await mkdir(path.join(base, "work"));
    await writeFile(path.join(base, "work", "a.txt"), "alpha\n", "utf8");
    const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
    await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
    await writeFile(path.join(base, "task.json"), JSON.stringify(TASK), "utf8");
    const planned = (await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun })).output as EngineResult;
    const applied = await runApply(io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", (planned.plan?.digest ?? "").slice(0, 12), "--quiet"]));
    assert.ok("output" in applied);
    const applyRunId = (applied.output as unknown as ApplyResult).runId;
    const preview = await cleanupAt(base, ["--run", `${planned.runId},${applyRunId}`]);
    assert.ok(preview.status === "preview", JSON.stringify(preview));
    const applyItem = preview.plan.items.find((item) => itemName(item) === applyRunId);
    assert.ok(applyItem?.warnings.includes("not_reverted"), JSON.stringify(preview.plan.items));
  });
});
