/**
 * U-38 (DR-51, contract 736e6d0), the CLI's part: the end summaries' next-command hints said
 * `<workspace>` even when the person had typed the path. Now the CLI gives the summary the path it
 * was given with `--workspace`, as `toShownWorkspace` makes it after the command's own masking:
 * - run: RunSummaryContext.workspaceShown, with workspaceForm "given" only (the run's privacy gateway)
 * - apply: ApplySummaryContext.workspaceShown, with the quick form (the apply's privacy gateway)
 * - revert: RevertSummaryContext.workspaceShown (key shapes only: revert knows no registered value)
 * Absent when toShownWorkspace gives null (masked, a character that cannot stand in quotes, too
 * long), so the hint says `<workspace>` as before. Never in the JSON. Stand-in renderers record the
 * context; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { MAX_SHOWN_WORKSPACE_CHARS } from "../../../src/contracts/index.js";
import type { ApplySummaryContext, CatalogText, EngineResult, HumanOutput, MessageCatalog, RunSummaryContext } from "../../../src/contracts/index.js";
import type { Assemble } from "../../../src/cli/assemble.js";
import { assembleRun, createRevertCommand } from "../../../src/cli/assemble.js";
import { runApply } from "../../../src/cli/plan-commands.js";
import { runRevert } from "../../../src/cli/revert.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { lexicalLocate } from "./locate.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const idMessages = { language: "en", format: (id: string) => `<${id}>` as CatalogText } as unknown as MessageCatalog;
const SECRET = "fake-secret-0042";
/** Not a real key format; built from parts (G-10). */
const FAKE_KEY = ["fake", "api", "key", "not", "real", "0042"].join("-");

describe("U-38: run gives its end summary the typed --workspace", () => {
  const BASE = path.resolve("/tmp/codaryn-g-u38-run");
  const CONFIG = path.resolve("/tmp/codaryn-g-u38-config/c.json");
  const result: EngineResult = {
    schemaVersion: 1,
    kind: "run",
    runId: "x",
    taskId: "quick",
    status: "done",
    reason: "verified",
    exitCode: 0,
    provider: "anthropic",
    verifiers: [],
    changes: [],
    usage: { modelTurns: 1, toolCalls: 0, inputTokens: 1, outputTokens: 1, durationMs: 1000 },
    journalPath: ".codaryn/runs/x/journal.jsonl",
    notices: [],
  };

  async function contextOf(argv: readonly string[]): Promise<{ context: RunSummaryContext | undefined; stdout: string }> {
    const seen: { context?: RunSummaryContext } = {};
    const assemble: Assemble = async (input) => ({
      ok: true,
      deps: {
        task: input.task,
        // The run's gateway: one registered value.
        privacy: { mask: (text: string) => ({ ok: true, text: text.split(SECRET).join("[masked]") }) },
        journal: { append: async () => {}, close: async () => {} },
      } as never,
      finish: async () => {},
    });
    const human: HumanOutput = {
      error: () => "",
      progressLine: () => null,
      runSummary: (_result, context) => {
        seen.context = context;
        return "";
      },
      revertSummary: () => "",
      runsText: () => "",
      latestChosen: () => "",
    };
    const io: CliEnvironment = {
      argv,
      env: { ANTHROPIC_API_KEY: FAKE_KEY },
      cwd: BASE,
      readFile: async () => JSON.stringify({ schemaVersion: 1, model: "m", maxOutputTokens: 10, limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 100, maxDurationMs: 1000 } }),
      isDirectory: async () => true,
      loadEnvFile: () => {},
      locateInWorkspace: lexicalLocate,
      clock: { now: () => 0 },
      randomBytes: (size) => new Uint8Array(size),
      assemble,
      runTask: async () => result,
      createAnthropicProvider: () => ({ name: "anthropic", complete: async () => ({ ok: false, kind: "api_error", message: "stub" }) }),
      cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
      writeProgress: () => {},
      human: () => ({ output: human, messages: idMessages }),
    };
    const outcome = await runCli(io);
    assert.equal(outcome.exitCode, 0, JSON.stringify(outcome.output));
    return { context: seen.context, stdout: JSON.stringify(outcome.output) };
  }

  test("the quick form with --workspace: workspaceShown is the typed path in double quotes", async () => {
    for (const typed of ["work", "my work", "../other/work", "."]) {
      const { context, stdout } = await contextOf(["run", "--workspace", typed, "--goal", "g", "--config", CONFIG]);
      assert.equal(context?.workspaceForm, "given");
      assert.equal(context?.workspaceShown, `"${typed}"`, typed);
      assert.equal(stdout.includes("workspaceShown"), false, "never in the JSON");
    }
  });

  test("a path the run masks, one that cannot stand in quotes, or a too long one: absent, so <workspace> as before", async () => {
    for (const typed of [`${SECRET}-dir`, "a$b", "50%", 'a"b', "w\\", "x".repeat(MAX_SHOWN_WORKSPACE_CHARS + 1)]) {
      const { context } = await contextOf(["run", "--workspace", typed, "--goal", "g", "--config", CONFIG]);
      assert.equal(context?.workspaceForm, "given");
      assert.equal(Object.hasOwn(context ?? {}, "workspaceShown"), false, typed);
    }
  });

  test("the one-line run (the current directory) has none", async () => {
    const { context } = await contextOf(["run", "fix it", "--config", CONFIG]);
    assert.equal(context?.workspaceForm, "current");
    assert.equal(Object.hasOwn(context ?? {}, "workspaceShown"), false);
  });
});

/** RevertCliOutcome.summary (U-38): the context for the revert summary. */
const summaryOf = (outcome: object): unknown => (outcome as { summary?: unknown }).summary;

describe("U-38: revert gives its summary the typed --workspace, key shapes masked", () => {
  async function reverted(typed: string): Promise<Awaited<ReturnType<typeof runRevert>>> {
    const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u38-revert-"));
    temporaryDirs.push(base);
    const run = "20261112T020000Z-0a0b0c0d";
    await mkdir(path.join(base, typed, ".codaryn", "runs", run), { recursive: true });
    await writeFile(path.join(base, typed, ".codaryn", "runs", run, "journal.jsonl"), "", "utf8");
    const command = createRevertCommand(async () => ({ reverted: [], skipped: [{ path: "a.txt", reason: "already_reverted" }] }));
    const outcome = await runRevert({ argv: ["revert", "--workspace", typed, "--run", run], cwd: base, isDirectory: async () => true, clock: { now: () => 0 }, randomBytes: (size) => new Uint8Array(size), revert: command });
    assert.equal(outcome.output.kind, "revert", JSON.stringify(outcome.output));
    return outcome;
  }

  test("the typed path in double quotes; not in the JSON", async () => {
    const outcome = await reverted("work");
    assert.deepEqual(summaryOf(outcome), { workspaceShown: '"work"' });
    assert.equal(JSON.stringify(outcome.output).includes("workspaceShown"), false);
  });

  test("a path that cannot stand in quotes: no context, so <workspace> as before", async () => {
    const outcome = await reverted("a$b");
    assert.equal(summaryOf(outcome), undefined);
  });
});

describe("U-38: apply gives its summary the typed --workspace in the quick form", () => {
  const TASK = {
    schemaVersion: 1,
    id: "g-u38",
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

  async function applied(form: "task" | "quick"): Promise<ApplySummaryContext | undefined> {
    const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u38-apply-"));
    temporaryDirs.push(base);
    await mkdir(path.join(base, "ws"));
    await writeFile(path.join(base, "ws", "a.txt"), "alpha\n", "utf8");
    const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
    await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
    await writeFile(path.join(base, "task.json"), JSON.stringify(TASK), "utf8");
    await writeFile(path.join(base, "config.json"), JSON.stringify({ schemaVersion: 1, limits: { ...TASK.limits, maxTotalTokens: 100_000 }, policy: TASK.policy }), "utf8");
    let now = Date.now() - 600_000;
    let seed = 38;
    const io = (argv: readonly string[]) => ({
      argv,
      env: {},
      cwd: base,
      readFile: (file: string) => readFile(file, "utf8"),
      isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
      loadEnvFile: () => {},
      locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
      relatePaths: (target: string, root: string) => relateRealPaths(target, root),
      clock: { now: () => (now += 1000) },
      randomBytes: (size: number) => new Uint8Array(size).fill(seed++ % 250),
      cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    });
    const ran = await runCli({ ...io(["run", "--task", "task.json", "--quiet"]), assemble: assembleRun });
    const planned = ran.output as EngineResult;
    assert.equal(planned.reason, "plan_pending", JSON.stringify(planned));
    const seen: { context?: ApplySummaryContext } = {};
    const human = {
      applySummary: (_result: unknown, context: ApplySummaryContext) => {
        seen.context = context;
        return "";
      },
    } as unknown as HumanOutput;
    const formArgs = form === "task" ? ["--task", "task.json"] : ["--workspace", "ws", "--config", "config.json", "--workflow", "organize"];
    const outcome = await runApply({
      ...io(["apply", ...formArgs, "--run", planned.runId, "--digest", (planned.plan?.digest ?? "").slice(0, 12)]),
      writeProgress: () => {},
      human,
    });
    assert.ok("output" in outcome && outcome.output.kind === "apply", JSON.stringify(outcome));
    assert.equal(JSON.stringify(outcome.output).includes("workspaceShown"), false);
    return seen.context;
  }

  test("the quick form: workspaceShown is the typed path; the task form has none", async () => {
    assert.deepEqual(await applied("quick"), { workspaceForm: "given", workspaceShown: '"ws"' });
    assert.deepEqual(await applied("task"), { workspaceForm: "task" });
  });
});
