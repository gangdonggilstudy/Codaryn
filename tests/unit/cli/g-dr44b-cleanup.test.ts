/**
 * Review R-34b (pm/bundle-6b d6b735a), the PM's decisions, the CLI's part:
 * - P-3 (L-3): the command the preview offers does not carry --include-not-reverted; when the plan
 *   holds runs not reverted, a line of its own says what is lost and that the person must add the
 *   flag themselves.
 * - P-1 (L-1): a run whose records cannot be checked (damaged) may not have been reverted either; it
 *   is warned about and needs --include-not-reverted like a run not reverted. The store's.
 * - P-2 (L-2): a leftover is told by the mark a cleanup writes into the folder when it moves it
 *   aside, not by its name; a cleanup-<hex> folder without the mark is shown as unknown and never
 *   removed. The store's; the CLI shows what the store gives.
 * U-3 (R-34c L-1): the store follows the contract (records_unreadable, the contract's mark,
 * StateSummary.unknownFolders, unit/U-3-nc-human 26a10db), and the CLI draws the unknown folders
 * line and names unreadable records in its line about --include-not-reverted.
 * Real CLI paths (run, revert with its record, cleanup), scripted model; nothing is sent.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { RUNS_DIR_NAME, STATE_DIR_NAME, needsNotRevertedConfirmation } from "../../../src/contracts/index.js";
import type { CleanupPlan, EngineResult, StateSummary } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runCleanup } from "../../../src/cli/cleanup.js";
import type { CleanupOutput } from "../../../src/cli/cleanup.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { applyCleanupWith, planCleanup } from "../../../src/store/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 900_000;
const clock = { now: () => (now += 1000) };
let seed = 111;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);
const sha = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
const exists = async (file: string): Promise<boolean> => (await stat(file).catch(() => null)) !== null;

async function workspace(): Promise<{ base: string; work: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-dr44b-"));
  temporaryDirs.push(base);
  const work = path.join(base, "work");
  await mkdir(work);
  return { base, work };
}

/** A run that changes `file` (its text `<name>1\n` → `<name>2\n`). */
async function changingRun(base: string, work: string, name: string): Promise<string> {
  const file = `${name}.txt`;
  await writeFile(path.join(work, file), `${name}1\n`, "utf8");
  const steps = [{ toolCalls: [{ name: "write_file", args: { path: file, expectedHash: sha(`${name}1\n`), change: { kind: "replace_text", oldText: `${name}1`, newText: `${name}2` } } }] }, { text: "done" }];
  await writeFile(path.join(base, `${name}.s.json`), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  const task = {
    schemaVersion: 1,
    id: name,
    goal: "g",
    workflow: "test",
    workspaceRoot: "./work",
    model: { provider: "scripted", scriptPath: `./${name}.s.json` },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
    privacy: { secretEnv: [] },
    limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 },
    verifiers: [],
  };
  await writeFile(path.join(base, `${name}.t.json`), JSON.stringify(task), "utf8");
  const outcome = await runCli({
    argv: ["run", "--task", `${name}.t.json`, "--quiet"],
    env: {},
    cwd: base,
    readFile: (f) => readFile(f, "utf8"),
    isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    loadEnvFile: () => {},
    locateInWorkspace: (f, root) => locateInWorkspace(f, root),
    relatePaths: (target, root) => relateRealPaths(target, root),
    clock,
    randomBytes,
    assemble: assembleRun,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  });
  assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
  return (outcome.output as EngineResult).runId;
}

async function cleanup(base: string, args: readonly string[], json = true): Promise<{ text: string; exitCode: number; output: CleanupOutput | null }> {
  const outcome = await runCleanup({ argv: ["cleanup", "--workspace", "work", ...args, ...(json ? ["--json"] : [])], cwd: base, env: {}, clock, messages: createMessageCatalog("en") });
  assert.ok("text" in outcome, JSON.stringify(outcome));
  return { text: outcome.text, exitCode: outcome.exitCode, output: json ? (JSON.parse(outcome.text) as CleanupOutput) : null };
}

async function digestOf(base: string, args: readonly string[]): Promise<string> {
  const shown = await cleanup(base, args);
  assert.ok(shown.output?.status === "preview", JSON.stringify(shown));
  return shown.output.plan.digest.slice(0, 12);
}

const runDir = (work: string, runId: string): string => path.join(work, STATE_DIR_NAME, RUNS_DIR_NAME, runId);

// U-86 (PM, plan B) replaces R-34b P-3: the preview ends with two commands, --confirm alone and the one
// with every flag some item needs, so the second carries --include-not-reverted. What it loses is
// told before it, in that group's own line, not one word weaker.
describe("U-86 (after R-34b P-3): the command with every flag carries --include-not-reverted; its group says what is lost", () => {
  test("a run not reverted: the --confirm alone line, if any, does not carry the flag; the group line tells what is lost", async () => {
    const { base, work } = await workspace();
    await changingRun(base, work, "a");
    const text = (await cleanup(base, ["--older-than", "0"], false)).text;
    const lines = text.split("\n");
    const offered = lines.filter((line) => /--confirm [0-9a-f]{12}/.test(line));
    assert.ok(offered.some((line) => line.endsWith(" --include-not-reverted")), text);
    for (const line of offered.filter((entry) => !entry.includes("--include-not-reverted"))) assert.equal(line.includes("--delete-discarded"), false, line);
    const apart = lines.filter((line) => line.includes("--include-not-reverted") && !/--confirm [0-9a-f]{12}/.test(line));
    assert.ok(apart.some((line) => /can no longer be reverted/.test(line)), text);
  });

  test("no run not reverted: no such line", async () => {
    const { base } = await workspace();
    const { work } = { work: path.join(base, "work") };
    await mkdir(path.join(work, STATE_DIR_NAME, RUNS_DIR_NAME), { recursive: true }).catch(() => undefined);
    const text = (await cleanup(base, ["--older-than", "0"], false)).text;
    assert.equal(text.includes("--include-not-reverted"), false, text);
  });
});

describe("R-34b P-1: a run whose records cannot be checked needs the not-reverted confirmation", () => {
  async function damaged(): Promise<{ base: string; work: string; runId: string }> {
    const { base, work } = await workspace();
    const runId = await changingRun(base, work, "d");
    await writeFile(path.join(runDir(work, runId), "result.json"), "{ not json", "utf8");
    return { base, work, runId };
  }

  test("it is warned about as records_unreadable, which needs --include-not-reverted; the person's line says so", async () => {
    const { base, runId } = await damaged();
    const shown = await cleanup(base, ["--older-than", "0"]);
    assert.ok(shown.output?.status === "preview", JSON.stringify(shown));
    const item = shown.output.plan.items.find((entry) => entry.target === "run" && entry.runId === runId);
    assert.ok(item !== undefined && needsNotRevertedConfirmation(item.warnings), JSON.stringify(shown.output.plan));
    // U-3 (R-34c L-1): the contract's code, not "not reverted" (whether it was is not known).
    assert.deepEqual(item.warnings, ["records_unreadable"]);
    const text = (await cleanup(base, ["--older-than", "0"], false)).text;
    assert.ok(text.includes(createMessageCatalog("en").format("cleanup.warning.records_unreadable")), text);
  });

  test("--confirm alone keeps its records; with --include-not-reverted they go", async () => {
    const { base, work, runId } = await damaged();
    const digest = await digestOf(base, ["--older-than", "0"]);
    await cleanup(base, ["--older-than", "0", "--confirm", digest]);
    assert.ok(await exists(runDir(work, runId)), "kept without the separate confirmation");
    await cleanup(base, ["--older-than", "0", "--confirm", await digestOf(base, ["--older-than", "0"]), "--include-not-reverted"]);
    assert.equal(await exists(runDir(work, runId)), false);
  });
});

describe("R-34b P-2: leftovers are told by the cleanup's mark, not by their name", () => {
  test("a cleanup-<hex> folder a cleanup did not leave is not an item, is shown as unknown and is never removed", async () => {
    const { base, work } = await workspace();
    const runId = await changingRun(base, work, "e");
    const lookalike = path.join(work, STATE_DIR_NAME, "cleanup-0123456789abcdef");
    await mkdir(lookalike);
    await writeFile(path.join(lookalike, "person.txt"), "a person's note\n", "utf8");
    const shown = await cleanup(base, ["--run", runId]);
    assert.ok(shown.output?.status === "preview", JSON.stringify(shown));
    assert.equal(shown.output.plan.items.some((item) => item.target === "leftover"), false, JSON.stringify(shown.output.plan.items));
    assert.deepEqual(shown.output.summary.unknownFolders, { count: 1, files: 1, bytes: 16 });
    const text = (await cleanup(base, ["--run", runId], false)).text;
    assert.ok(text.includes(createMessageCatalog("en").format("cleanup.summary.unknown_folders", { count: 1, bytes: 16 })), text);
    await cleanup(base, ["--run", runId, "--confirm", shown.output.plan.digest.slice(0, 12), "--include-not-reverted"]);
    assert.ok(await exists(path.join(lookalike, "person.txt")), "never removed");
  });

  test("a folder a failed cleanup really left is shown by the next preview and removed when confirmed", async () => {
    const { base, work } = await workspace();
    const runId = await changingRun(base, work, "f");
    // The store's own cleanup, with a removal that fails after the move aside (its test hook).
    const plan = await planCleanup({ workspaceRoot: work, selection: { runs: { runIds: [runId] } }, now: new Date(clock.now()).toISOString() });
    const failed = await applyCleanupWith(
      { workspaceRoot: work, selection: { runs: { runIds: [runId] } }, now: new Date(clock.now()).toISOString(), confirmation: { digest: plan.digest, discarded: false, includeNotReverted: true } },
      { remove: async () => { throw new Error("denied by the test"); }, retryDelayMs: 0 },
    );
    assert.ok(failed.ok && failed.kept.some((item) => item.reason === "partly_removed"), JSON.stringify(failed));
    const left = (await readdir(path.join(work, STATE_DIR_NAME))).filter((entry) => entry.startsWith("cleanup-"));
    assert.equal(left.length, 1, JSON.stringify(left));
    const text = (await cleanup(base, [], false)).text;
    assert.ok(text.includes(left[0] as string), text);
    const done = await cleanup(base, ["--confirm", await digestOf(base, [])]);
    assert.equal(done.exitCode, 0, JSON.stringify(done));
    assert.equal(await exists(path.join(work, STATE_DIR_NAME, left[0] as string)), false);
  });
});

describe("U-3 (R-34c L-1): what the CLI shows of the contract's unknown folders and unreadable records", () => {
  const PLAN = {
    items: [],
    blocked: [],
    totals: { runs: { count: 0, notReverted: 0, files: 0, bytes: 0 }, discarded: { count: 0, files: 0, bytes: 0 }, leftovers: { count: 0, files: 0, bytes: 0 } },
    parked: { files: 0, bytes: 0 },
    digest: "b".repeat(64),
  } as unknown as CleanupPlan;
  const summaryWith = (unknownFolders: unknown): StateSummary =>
    ({
      runs: { count: 0, bytes: 0, oldest: null, newest: null },
      entries: [],
      discarded: { runs: 0, files: 0, bytes: 0 },
      parked: { files: 0, bytes: 0 },
      leftovers: { count: 0, files: 0, bytes: 0 },
      ...(unknownFolders === undefined ? {} : { unknownFolders }),
    }) as unknown as StateSummary;

  async function previewText(summary: StateSummary): Promise<string> {
    const { base } = await workspace();
    const outcome = await runCleanup({
      argv: ["cleanup", "--workspace", "work"],
      cwd: base,
      env: {},
      clock,
      messages: createMessageCatalog("en"),
      summarizeState: async () => summary,
      planCleanup: async () => PLAN,
    });
    assert.ok("text" in outcome, JSON.stringify(outcome));
    return outcome.text;
  }

  test("unknown folders are shown with the catalog's line (cleanup.summary.unknown_folders), never as items", async () => {
    const text = await previewText(summaryWith({ count: 2, files: 3, bytes: 48 }));
    assert.ok(text.includes(createMessageCatalog("en").format("cleanup.summary.unknown_folders", { count: 2, bytes: 48 })), text);
    assert.equal(/--confirm/.test(text), false, "nothing is offered to remove them");
  });

  test("no unknown folder (the field absent, or 0): no such line", async () => {
    for (const summary of [summaryWith(undefined), summaryWith({ count: 0, files: 0, bytes: 0 })]) {
      assert.equal(/unknown/i.test(await previewText(summary)), false);
    }
  });

  // U-86: that line is the --include-not-reverted group's.
  test("the line apart about --include-not-reverted also names runs whose records cannot be checked", async () => {
    const { base, work } = await workspace();
    const runId = await changingRun(base, work, "u");
    await writeFile(path.join(runDir(work, runId), "result.json"), "{ not json", "utf8");
    const text = (await cleanup(base, ["--older-than", "0"], false)).text;
    const apart = text.split("\n").filter((line) => line.includes("--include-not-reverted") && !/--confirm [0-9a-f]{12}/.test(line));
    assert.ok(apart.some((line) => /records cannot be checked/.test(line) && /can no longer be reverted/.test(line)), text);
  });
});
