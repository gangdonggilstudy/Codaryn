/**
 * DR-44 (review R-34 of pm/bundle-6 05f3b7c), the CLI's part of cleanup:
 * - (가) the records of a run that was not reverted, or only partly, go only with a confirmation of
 *   their own (--include-not-reverted besides --confirm); the confirmation's head line says how
 *   many such runs the plan holds. They are not blocked.
 * - (나) L-1: a partly reverted run is not "reverted" (--reverted does not select it; it is warned
 *   about as a run not reverted). The store's.
 * - (다) L-2: an apply's records removed while its discarded-files folder stays is warned about
 *   (discarded_left), also when the folder was selected but its deletion may not be confirmed.
 * - (라) L-3: a removal that fails is not reported as removed; a hidden .codaryn/cleanup-… left
 *   behind is shown by the next preview and can be removed. The store's and the contract's; the CLI
 *   reports what the store gives.
 * - R-34 I-3: a preview with only discarded files to delete does not say "remove the run records".
 * Real CLI paths (run, apply, revert with its record, cleanup), scripted model; nothing is sent.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { DISCARDED_DIR_NAME, RUNS_DIR_NAME, STATE_DIR_NAME, needsNotRevertedConfirmation } from "../../../src/contracts/index.js";
import type { ApplyCleanup, ApplyResult, CleanupConfirmation, CleanupPlan, EngineResult, StateSummary } from "../../../src/contracts/index.js";
import { assembleRun, createRevertCommand } from "../../../src/cli/assemble.js";
import { itemName, notRevertedHeadLine, runCleanup } from "../../../src/cli/cleanup.js";
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
let seed = 91;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);
const sha = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
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

async function workspace(files: Record<string, string>): Promise<{ base: string; work: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-dr44-"));
  temporaryDirs.push(base);
  const work = path.join(base, "work");
  await mkdir(work);
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(work, name), text, "utf8");
  return { base, work };
}

/** A run that writes each file of `writes` (its whole text is `<old>
`; old text → new text) and ends. */
async function changingRun(base: string, name: string, writes: Record<string, [string, string]>): Promise<string> {
  const steps = [
    ...Object.entries(writes).map(([file, [from, to]]) => ({
      toolCalls: [{ name: "write_file", args: { path: file, expectedHash: sha(`${from}
`), change: { kind: "replace_text", oldText: from, newText: to } } }],
    })),
    { text: "done" },
  ];
  await writeFile(path.join(base, `${name}.script.json`), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  const task = { schemaVersion: 1, id: name, goal: "g", workflow: "test", workspaceRoot: "./work", model: { provider: "scripted", scriptPath: `./${name}.script.json` }, policy: POLICY, privacy: { secretEnv: [] }, limits: LIMITS, verifiers: [] };
  await writeFile(path.join(base, `${name}.task.json`), JSON.stringify(task), "utf8");
  const outcome = await runCli({ ...io(base, ["run", "--task", `${name}.task.json`, "--quiet"]), assemble: assembleRun });
  assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
  return (outcome.output as EngineResult).runId;
}

async function revert(base: string, runId: string): Promise<string> {
  const outcome = await runRevert({
    ...io(base, ["revert", "--workspace", "work", "--run", runId, "--quiet"]),
    revert: createRevertCommand(revertRun, { inspect: inspectRun, readRecord: readRevertRecord, writeRecord: writeRevertRecord }),
  });
  assert.equal(outcome.output.kind, "revert", JSON.stringify(outcome.output));
  return (outcome.output as { status: string }).status;
}

async function cleanup(base: string, args: readonly string[], json = true): Promise<{ text: string; exitCode: number; output: CleanupOutput | null; error: unknown }> {
  const outcome = await runCleanup({ argv: ["cleanup", "--workspace", "work", ...args, ...(json ? ["--json"] : [])], cwd: base, env: {}, clock, messages: createMessageCatalog("en") });
  if ("output" in outcome) return { text: "", exitCode: outcome.exitCode, output: null, error: outcome.output };
  return { text: outcome.text, exitCode: outcome.exitCode, output: json ? (JSON.parse(outcome.text) as CleanupOutput) : null, error: null };
}

async function preview(base: string, args: readonly string[]): Promise<Extract<CleanupOutput, { status: "preview" }>> {
  const shown = await cleanup(base, args);
  assert.ok(shown.output?.status === "preview", JSON.stringify(shown));
  return shown.output;
}

const runDir = (work: string, runId: string): string => path.join(work, STATE_DIR_NAME, RUNS_DIR_NAME, runId);

describe("DR-44 (가): the records of a run not reverted go only with --include-not-reverted", () => {
  async function twoRuns(): Promise<{ base: string; work: string; notReverted: string; reverted: string }> {
    const { base, work } = await workspace({ "a.txt": "one\n", "b.txt": "uno\n" });
    const notReverted = await changingRun(base, "a", { "a.txt": ["one", "two"] });
    const reverted = await changingRun(base, "b", { "b.txt": ["uno", "dos"] });
    assert.equal(await revert(base, reverted), "complete");
    return { base, work, notReverted, reverted };
  }

  test("the preview's head line says how many selected runs were not reverted", async () => {
    const { base, notReverted, reverted } = await twoRuns();
    const plan = (await preview(base, ["--older-than", "0"])).plan;
    assert.ok(plan.items.find((item) => itemName(item) === notReverted)?.warnings.includes("not_reverted"), JSON.stringify(plan.items));
    assert.deepEqual(plan.items.find((item) => itemName(item) === reverted)?.warnings, []);
    const text = (await cleanup(base, ["--older-than", "0"], false)).text;
    assert.ok(text.includes(notRevertedHeadLine(createMessageCatalog("en"), 1)), text);
    assert.ok(text.includes("--include-not-reverted"), text);
  });

  test("--confirm alone does not remove a run not reverted; kept by the person's choice, exit 0", async () => {
    const { base, work, notReverted } = await twoRuns();
    const digest = (await preview(base, ["--older-than", "0"])).plan.digest.slice(0, 12);
    const result = await cleanup(base, ["--older-than", "0", "--confirm", digest]);
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.ok(result.output !== null && result.output.status !== "preview", JSON.stringify(result.output));
    assert.deepEqual(result.output.outcome.kept, [{ target: "run", runId: notReverted, reason: "not_reverted_not_confirmed" }]);
    assert.ok(await exists(runDir(work, notReverted)), "its records stay: a revert still needs them");
  });

  test("--confirm alone still removes the reverted run of the same plan", async () => {
    const { base, work, reverted } = await twoRuns();
    const digest = (await preview(base, ["--older-than", "0"])).plan.digest.slice(0, 12);
    await cleanup(base, ["--older-than", "0", "--confirm", digest]);
    assert.equal(await exists(runDir(work, reverted)), false);
  });

  test("--confirm with --include-not-reverted removes both", async () => {
    const { base, work, notReverted, reverted } = await twoRuns();
    const digest = (await preview(base, ["--older-than", "0"])).plan.digest.slice(0, 12);
    const result = await cleanup(base, ["--older-than", "0", "--confirm", digest, "--include-not-reverted"]);
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(await exists(runDir(work, notReverted)), false);
    assert.equal(await exists(runDir(work, reverted)), false);
  });

  test("--include-not-reverted without --confirm is refused before anything is read", async () => {
    const { base } = await twoRuns();
    const result = await cleanup(base, ["--older-than", "0", "--include-not-reverted"]);
    assert.equal((result.error as { code?: string } | null)?.code, "invalid_arguments", JSON.stringify(result));
  });
});

describe("DR-44 (나), R-34 L-1: a partly reverted run is not a reverted run", () => {
  async function partlyReverted(): Promise<{ base: string; runId: string }> {
    const { base, work } = await workspace({ "c.txt": "c1\n", "d.txt": "d1\n" });
    const runId = await changingRun(base, "c", { "c.txt": ["c1", "c2"], "d.txt": ["d1", "d2"] });
    await writeFile(path.join(work, "d.txt"), "a person's edit\n", "utf8");
    assert.equal(await revert(base, runId), "partial");
    return { base, runId };
  }

  test("it is warned about as a run not reverted (store 0e8eab7: not_reverted; the contract: partly_reverted)", async () => {
    const { base, runId } = await partlyReverted();
    const plan = (await preview(base, ["--run", runId])).plan;
    assert.ok(needsNotRevertedConfirmation(plan.items[0]?.warnings ?? []), JSON.stringify(plan.items));
  });

  test("--reverted does not select it", async () => {
    const { base } = await partlyReverted();
    assert.deepEqual((await preview(base, ["--reverted"])).plan.items, []);
  });
});

describe("DR-44 (다), R-34 L-2: an apply's records without its discarded files are warned about", () => {
  async function discardingApply(): Promise<{ base: string; work: string; applyRunId: string }> {
    const { base, work } = await workspace({ "y.txt": "a person's file\n" });
    const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "tidy", actions: [{ kind: "discard", path: "y.txt" }] } }] }];
    await writeFile(path.join(base, "p.script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
    const task = { schemaVersion: 1, id: "p", goal: "g", workflow: "label", workspaceRoot: "./work", workflowRef: "organize", model: { provider: "scripted", scriptPath: "./p.script.json" }, policy: { ...POLICY, planActions: ["discard"] }, privacy: { secretEnv: [] }, limits: LIMITS, verifiers: [] };
    await writeFile(path.join(base, "p.task.json"), JSON.stringify(task), "utf8");
    const planned = (await runCli({ ...io(base, ["run", "--task", "p.task.json", "--quiet"]), assemble: assembleRun })).output as EngineResult;
    assert.equal(planned.reason, "plan_pending", JSON.stringify(planned));
    const applied = await runApply(io(base, ["apply", "--task", "p.task.json", "--run", planned.runId, "--digest", (planned.plan?.digest ?? "").slice(0, 12), "--quiet"]));
    assert.ok("output" in applied && applied.output.kind === "apply", JSON.stringify(applied));
    const applyRunId = (applied.output as unknown as ApplyResult).runId;
    assert.ok(await exists(path.join(work, STATE_DIR_NAME, DISCARDED_DIR_NAME, applyRunId)), "the apply set the file aside");
    return { base, work, applyRunId };
  }

  test("records selected without the folder: discarded_left (holds before DR-44)", async () => {
    const { base, applyRunId } = await discardingApply();
    const item = (await preview(base, ["--older-than", "0"])).plan.items.find((entry) => entry.target === "run" && itemName(entry) === applyRunId);
    assert.ok(item?.warnings.includes("discarded_left"), JSON.stringify(item));
  });

  test("records and folder selected: discarded_left too, as its deletion may not be confirmed", async () => {
    const { base, applyRunId } = await discardingApply();
    const item = (await preview(base, ["--older-than", "0", "--discarded-older-than", "0"])).plan.items.find((entry) => entry.target === "run" && itemName(entry) === applyRunId);
    assert.ok(item?.warnings.includes("discarded_left"), JSON.stringify(item));
  });
});

describe("R-34 I-3: the preview's last line names what is to be confirmed", () => {
  test("only discarded files to delete: it does not say to remove run records", async () => {
    const { base, work } = await workspace({});
    const runId = await changingRun(base, "e", {});
    const folder = path.join(work, STATE_DIR_NAME, DISCARDED_DIR_NAME, runId);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "0"), "a person's file\n", "utf8");
    const text = (await cleanup(base, ["--discarded-run", runId], false)).text;
    assert.equal(text.includes("To remove the run records"), false, text);
    assert.ok(/--confirm [0-9a-f]{12} --delete-discarded/.test(text), text);
  });
});

describe("DR-44 (라), R-34 L-3: a removal that fails is not reported as removed", () => {
  test("an item the store kept for an I/O problem ends the command with 1 and is named", async () => {
    const { base } = await workspace({});
    const runId = await changingRun(base, "f", {});
    const digest = (await preview(base, ["--run", runId])).plan.digest.slice(0, 12);
    const outcome = await runCleanup({
      argv: ["cleanup", "--workspace", "work", "--run", runId, "--confirm", digest],
      cwd: base,
      env: {},
      clock,
      messages: createMessageCatalog("en"),
      applyCleanup: (async () => ({
        ok: true,
        removed: [],
        kept: [{ target: "run", runId, reason: "io_error" }],
        totals: { runs: { count: 0, files: 0, bytes: 0 }, discarded: { count: 0, files: 0, bytes: 0 } },
      })) as unknown as ApplyCleanup,
    });
    assert.ok("text" in outcome);
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.text.includes("Removed: run records 0"), outcome.text);
    assert.ok(outcome.text.includes(runId), outcome.text);
  });

  // R-34b P-2: a leftover is told by the cleanup's mark, not by its name; the cases (a folder a
  // failed cleanup really left, and a look-alike that is never removed) are in g-dr44b-cleanup.
});

describe("DR-44 (contract 73ec895): what the CLI does with the store's new answers", () => {
  const SIZE = { files: 2, bytes: 300 };
  const TOTALS = { runs: { count: 0, notReverted: 0, files: 0, bytes: 0 }, discarded: { count: 0, files: 0, bytes: 0 }, leftovers: { count: 1, files: 2, bytes: 300 } };
  const LEFTOVER_PLAN = {
    items: [{ target: "leftover", leftoverId: "0123456789abcdef", size: SIZE, warnings: ["leftover"] }],
    blocked: [],
    totals: TOTALS,
    parked: { files: 0, bytes: 0 },
    digest: "a".repeat(64),
  } as unknown as CleanupPlan;
  const SUMMARY = {
    runs: { count: 0, bytes: 0, oldest: null, newest: null },
    entries: [],
    discarded: { runs: 0, files: 0, bytes: 0 },
    parked: { files: 0, bytes: 0 },
    leftovers: { count: 1, files: 2, bytes: 300 },
  } as unknown as StateSummary;

  async function withStore(args: readonly string[], applied: (confirmation: CleanupConfirmation) => unknown, json = false): Promise<{ text: string; exitCode: number }> {
    const { base } = await workspace({});
    const outcome = await runCleanup({
      argv: ["cleanup", "--workspace", "work", ...args, ...(json ? ["--json"] : [])],
      cwd: base,
      env: {},
      clock,
      messages: createMessageCatalog("en"),
      summarizeState: async () => SUMMARY,
      planCleanup: async () => LEFTOVER_PLAN,
      applyCleanup: (async (request: { confirmation: CleanupConfirmation }) => applied(request.confirmation)) as unknown as ApplyCleanup,
    });
    assert.ok("text" in outcome, JSON.stringify(outcome));
    return { text: outcome.text, exitCode: outcome.exitCode };
  }
  const done = (kept: readonly unknown[], removed: readonly unknown[] = []) => ({ ok: true, removed, kept, totals: TOTALS });

  test("the store gets includeNotReverted as given, apart from discarded", async () => {
    const seen: CleanupConfirmation[] = [];
    await withStore(["--confirm", "a".repeat(12), "--include-not-reverted"], (confirmation) => (seen.push(confirmation), done([])));
    await withStore(["--confirm", "a".repeat(12), "--delete-discarded"], (confirmation) => (seen.push(confirmation), done([])));
    assert.deepEqual(seen, [
      { digest: "a".repeat(64), discarded: false, includeNotReverted: true },
      { digest: "a".repeat(64), discarded: true, includeNotReverted: false },
    ]);
  });

  test("partly_removed ends the command with 1 and is not counted as removed", async () => {
    const result = await withStore(["--confirm", "a".repeat(12)], () => done([{ target: "run", runId: "20260102T030405Z-0a0b0c0d", reason: "partly_removed" }]));
    assert.equal(result.exitCode, 1, result.text);
    assert.ok(result.text.includes(createMessageCatalog("en").format("cleanup.done", { runs: 0, folders: 0, bytes: 0 })), result.text);
    assert.ok(result.text.includes("20260102T030405Z-0a0b0c0d"), result.text);
  });

  test("records kept by the person's choice are not a failure (1); with nothing removed the command ends 3 (U-22, DR-48)", async () => {
    const kept = [
      { target: "run", runId: "20260102T030405Z-0a0b0c0d", reason: "not_reverted_not_confirmed" },
      { target: "run", runId: "20260102T030405Z-0a0b0c0e", reason: "used_by_kept_apply" },
      { target: "discarded", runId: "20260102T030405Z-0a0b0c0f", reason: "not_confirmed" },
    ];
    const result = await withStore(["--confirm", "a".repeat(12)], () => done(kept));
    assert.equal(result.exitCode, 3, result.text);
  });

  test("leftover folders: the summary line, their items in the preview, and the done line", async () => {
    const preview = await withStore([], () => done([]));
    assert.ok(preview.text.includes("cleanup-0123456789abcdef"), preview.text);
    assert.ok(/Folders an earlier cleanup|cleanup could not remove|cleanup/i.test(preview.text), preview.text);
    assert.ok(preview.text.includes(`--confirm ${"a".repeat(12)}`), preview.text);
    const removed = await withStore(["--confirm", "a".repeat(12)], () => done([], [{ target: "leftover", leftoverId: "0123456789abcdef", size: SIZE }]));
    assert.equal(removed.exitCode, 0, removed.text);
    assert.ok(removed.text.includes("300 bytes") || removed.text.includes("300"), removed.text);
  });
});
