/**
 * Usability wiring (N-5, N-20 to N-25): human output in run, the latest notice, doctor texts and
 * the lock check, and key hiding before control characters are replaced. Fake values only.
 */

import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { DOCTOR_CHECK_IDS, MESSAGE_IDS, messageParams, toRunId } from "../../../src/contracts/index.js";
import type {
  CatalogText,
  EngineResult,
  HumanOutput,
  ListRuns,
  MessageCatalog,
  RevertOutcome,
  RunSummaryContext,
} from "../../../src/contracts/index.js";
import type { Assemble } from "../../../src/cli/assemble.js";
import { createRevertCommand } from "../../../src/cli/assemble.js";
import { inspectLockFile, renderDoctor, runDoctor } from "../../../src/cli/doctor.js";
import { runRevert } from "../../../src/cli/revert.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment } from "../../../src/cli/run.js";
import { hideKeys } from "../../../src/cli/text-safety.js";
import { lexicalLocate } from "./locate.js";

/** Key-shaped, built at run time so the file never holds such a literal. */
const KEY_SHAPED_TAIL = "CDEFGHIJKLMNOPQRSTUVWXYZ012345";
const BROKEN_KEY = `${["sk", "ant", "AB"].join("-")}\u0007${KEY_SHAPED_TAIL}`;
/** Not a real key format. */
const FAKE_KEY = "fake-api-key-not-real-0042";
const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

/** A catalog that shows the id, so tests can see which messages were used. */
const idMessages = { language: "en", format: (id: string) => `<${id}>` as CatalogText } as unknown as MessageCatalog;

describe("N-23 (h) keys are hidden before control characters are replaced", () => {
  test("a key shape broken by a control character is still hidden (review R-2 L-5 input)", () => {
    const hidden = hideKeys(`created ${BROKEN_KEY} done`, null);
    assert.equal(hidden, "created [key] done");
    assert.equal(hidden.includes(KEY_SHAPED_TAIL), false);
    // The current key with a control character inside is hidden too.
    const current = "fake-current-key-value-0042";
    assert.equal(hideKeys(`x fake-current\u001b-key-value-0042 y`, current), "x [key] y");
    assert.equal(hideKeys("no key here", current), "no key here");
  });
});

describe("N-25 (a) the workspace lock in doctor", () => {
  test("inspectLockFile reads without changing: none, held, stale, unreadable", async () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    // lock.json only; the reclaim file (DR-27 b, n-reclaim.test.ts) is missing here.
    const lockOnly = (read: () => Promise<string>) => async (file: string) => (path.basename(file) === "lock.json" ? read() : Promise.reject(missing));
    assert.equal(await inspectLockFile("/w", lockOnly(async () => Promise.reject(missing))), "none");
    assert.equal(await inspectLockFile("/w", lockOnly(async () => JSON.stringify({ pid: 41, runId: "r", startedAt: "2026-11-12T05:00:00.000Z" })), () => true), "held");
    assert.equal(await inspectLockFile("/w", lockOnly(async () => JSON.stringify({ pid: 41, runId: "r", startedAt: "2026-11-12T05:00:00.000Z" })), () => false), "stale");
    assert.equal(await inspectLockFile("/w", lockOnly(async () => "{not json"), () => true), "unreadable");
    assert.equal(await inspectLockFile("/w", lockOnly(async () => Promise.reject(new Error("denied")))), "unreadable");
  });

  test("doctor gives every check a typed text, warns about a held lock and an ignored CODARYN_LANG", async () => {
    const base = path.resolve("/tmp/codaryn-n-wiring");
    const outcome = await runDoctor({
      argv: ["doctor", "--workspace", "work", "--json"],
      env: { CODARYN_LANG: "fr" },
      cwd: base,
      nodeVersion: "26.0.0",
      readFile: async () => Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" })),
      isDirectory: async () => true,
      isFile: async () => false,
      locateInWorkspace: lexicalLocate,
      relatePaths: async () => "separate",
      installDir: path.resolve("/opt/codaryn"),
      explainLanguage: () => ({ language: "en", source: "os", envIgnored: true }),
      inspectLock: async () => "held",
    });
    assert.ok("text" in outcome);
    const output = JSON.parse(outcome.text) as { checks: { id: string; status: string; text?: { id: string; params?: Record<string, unknown> } }[] };
    assert.deepEqual(output.checks.map((check) => check.id), [...DOCTOR_CHECK_IDS]);
    for (const check of output.checks) {
      assert.ok(check.text !== undefined && (MESSAGE_IDS as readonly string[]).includes(check.text.id), check.id);
      assert.equal(Object.keys(check.text.params ?? {}).sort().join(), Object.keys(messageParams(check.text.id as never)).sort().join(), check.id);
    }
    const lock = output.checks.find((check) => check.id === "lock");
    assert.deepEqual([lock?.status, lock?.text?.id], ["warn", "doctor.lock.held"]);
    const language = output.checks.find((check) => check.id === "language");
    assert.deepEqual([language?.status, language?.text?.id], ["warn", "doctor.language.env_ignored"]);
    // The CODARYN_LANG value itself is never printed.
    assert.equal(outcome.text.includes('"fr"'), false);
  });

  test("the text output uses the catalog: status words, check labels and texts", async () => {
    const outcome = await runDoctor({
      argv: ["doctor"],
      env: {},
      cwd: "/",
      nodeVersion: "26.0.0",
      readFile: async () => Promise.reject(new Error("x")),
      isDirectory: async () => false,
      isFile: async () => false,
      locateInWorkspace: lexicalLocate,
      relatePaths: async () => "separate",
      messages: idMessages,
    });
    assert.ok("text" in outcome);
    for (const part of ["<doctor.status.ok>", "<doctor.check.node_version>", "<doctor.node_version.ok>", "<doctor.footer>"]) {
      assert.ok(outcome.text.includes(part), part);
    }
    assert.equal(renderDoctor({ schemaVersion: 1, kind: "doctor", status: "ok", exitCode: 0, checks: [] }).includes("doctor: ok"), true);
  });
});

describe("N-5, N-17, N-23 human output of run", () => {
  const BASE = path.resolve("/tmp/codaryn-n-run");
  /** S-1: the config file lies outside the one-line run's workspace (the current directory). */
  const OUTSIDE_CONFIG = path.resolve("/tmp/codaryn-n-run-config/c.json");
  function io(argv: readonly string[], lines: string[], seen: { context?: RunSummaryContext }): CliEnvironment {
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
      usage: { modelTurns: 1, toolCalls: 2, inputTokens: 1, outputTokens: 1, durationMs: 4200 },
      journalPath: ".codaryn/runs/x/journal.jsonl",
      notices: [],
    };
    const events = [
      { type: "tool_decision", callId: "c1", tool: "run_command", stage: "policy_requested", allowed: false, permission: "command", code: "command_not_allowed" },
      { type: "tool_decision", callId: "c2", tool: "write_file", stage: "policy_requested", allowed: false, permission: "path", code: "protected_path" },
    ] as const;
    const assemble: Assemble = async (input) => ({
      ok: true,
      deps: {
        task: input.task,
        privacy: { mask: (text: string) => ({ ok: true, text: text.split("fake-secret-0042").join("[masked]") }) },
        journal: { append: async () => {}, close: async () => {} },
      } as never,
      finish: async () => {},
    });
    const human: HumanOutput = {
      error: () => "",
      progressLine: (event) => `<progress ${event.type}> fake-secret-0042`,
      runSummary: (_result, context) => {
        seen.context = context;
        return "<summary>\n";
      },
      revertSummary: () => "",
      runsText: () => "",
      latestChosen: () => "",
    };
    return {
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
      runTask: async (deps) => {
        for (const event of events) await deps.journal.append(event as never);
        return result;
      },
      createAnthropicProvider: () => ({ name: "anthropic", complete: async () => ({ ok: false, kind: "api_error", message: "stub" }) }),
      cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
      writeProgress: (line) => {
        lines.push(line);
      },
      human: () => ({ output: human, messages: idMessages }),
    };
  }

  test("progress lines and the end summary come from the renderer, masked; the context counts command denials", async () => {
    const lines: string[] = [];
    const seen: { context?: RunSummaryContext } = {};
    const outcome = await runCli(io(["run", "fix it", "--config", OUTSIDE_CONFIG], lines, seen));
    assert.equal(outcome.exitCode, 0);
    assert.ok(lines.some((line) => line.startsWith("codaryn: <progress tool_decision>")));
    assert.equal(lines.join("").includes("fake-secret-0042"), false, "lines pass the run's privacy gateway");
    assert.equal(lines[lines.length - 1], "<summary>\n");
    assert.deepEqual(seen.context, {
      workspaceForm: "current",
      configDefault: null,
      profileApplied: false,
      deniedToolCalls: 2,
      deniedCommandCalls: 1,
      policySource: "config",
    });
  });

  test("--quiet writes nothing at all", async () => {
    const lines: string[] = [];
    const outcome = await runCli(io(["run", "fix it", "--config", OUTSIDE_CONFIG, "--quiet"], lines, {}));
    assert.equal(outcome.exitCode, 0);
    assert.deepEqual(lines, []);
  });
});

describe("N-23 --run latest names the chosen run before it acts", () => {
  test("revert announces the first checked run with a result, then reverts it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "codaryn-unit-latest-"));
    temporaryDirs.push(dir);
    const running = toRunId("20261112T040000Z-11111111");
    const finished = toRunId("20261112T030000Z-22222222");
    assert.ok(running !== null && finished !== null);
    for (const id of [running, finished]) {
      await mkdir(path.join(dir, ".codaryn", "runs", id), { recursive: true });
      await writeFile(path.join(dir, ".codaryn", "runs", id, "journal.jsonl"), "", "utf8");
    }
    const listRuns: ListRuns = async () => ({
      runs: [
        { state: "checked", runId: running, startedAt: "2026-11-12T04:00:00.000Z", taskId: "t", status: null, reason: null, changes: null, reverted: null, revertRecordDamaged: false },
        { state: "checked", runId: finished, startedAt: "2026-11-12T03:00:00.000Z", taskId: "t", status: "done", reason: "verified", changes: 1, reverted: null, revertRecordDamaged: false },
      ],
    });
    const order: string[] = [];
    const complete: RevertOutcome = { reverted: [], skipped: [] };
    const command = createRevertCommand(
      async (request) => {
        order.push(`revert ${request.runId}`);
        return complete;
      },
      { listRuns, announceLatest: (entry) => order.push(`announce ${entry.runId} ${entry.startedAt}`) },
    );
    const outcome = await runRevert({
      argv: ["revert", "--workspace", dir, "--run", "latest"],
      cwd: dir,
      isDirectory: async () => true,
      clock: { now: () => 0 },
      randomBytes: (size) => new Uint8Array(size).fill(7),
      revert: command,
    });
    assert.ok(outcome.output.kind === "revert" && outcome.output.runId === finished);
    assert.deepEqual(order, [`announce ${finished} 2026-11-12T03:00:00.000Z`, `revert ${finished}`]);
  });

  test("already_reverted alone keeps the revert complete (N-22)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "codaryn-unit-already-"));
    temporaryDirs.push(dir);
    const run = "20261112T020000Z-0a0b0c0d";
    await mkdir(path.join(dir, ".codaryn", "runs", run), { recursive: true });
    await writeFile(path.join(dir, ".codaryn", "runs", run, "journal.jsonl"), "", "utf8");
    const command = createRevertCommand(async () => ({ reverted: [], skipped: [{ path: "a.txt", reason: "already_reverted" }] }));
    const outcome = await runRevert({ argv: ["revert", "--workspace", dir, "--run", run], cwd: dir, isDirectory: async () => true, clock: { now: () => 0 }, randomBytes: (size) => new Uint8Array(size), revert: command });
    assert.ok(outcome.output.kind === "revert");
    assert.deepEqual([outcome.output.status, outcome.exitCode], ["complete", 0]);
  });
});

describe("N-26 a damaged run is refused even by its id", () => {
  test("revert stops with invalid_run_record and calls nothing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "codaryn-unit-damaged-"));
    temporaryDirs.push(dir);
    const run = toRunId("20261112T020000Z-0a0b0c0d");
    assert.ok(run !== null);
    await mkdir(path.join(dir, ".codaryn", "runs", run), { recursive: true });
    await writeFile(path.join(dir, ".codaryn", "runs", run, "journal.jsonl"), "", "utf8");
    const calls: string[] = [];
    const env = (revert: ReturnType<typeof createRevertCommand>, extra: string[] = []) => ({
      argv: ["revert", "--workspace", dir, "--run", run, ...extra],
      cwd: dir,
      isDirectory: async () => true,
      clock: { now: () => 0 },
      randomBytes: (size: number) => new Uint8Array(size),
      revert,
    });
    const reverting = async () => {
      calls.push("revert");
      return { reverted: [], skipped: [] };
    };
    const viaListing = createRevertCommand(reverting, { listRuns: async () => ({ runs: [{ state: "damaged", runId: run }] }) });
    const viaStore = createRevertCommand(reverting, { isDamaged: async () => true, dryRun: reverting });
    for (const outcome of [await runRevert(env(viaListing)), await runRevert(env(viaStore, ["--dry-run"]))]) {
      assert.ok(outcome.output.kind === "error" && outcome.output.code === "invalid_run_record");
    }
    assert.deepEqual(calls, []);
    // A check that fails is treated as damage (fail closed).
    const failing = createRevertCommand(reverting, { isDamaged: async () => Promise.reject(new Error("x")) });
    const outcome = await runRevert(env(failing));
    assert.ok(outcome.output.kind === "error" && outcome.output.code === "invalid_run_record");
    assert.equal(await lstat(path.join(dir, ".codaryn", "lock.json")).then(() => true, () => false), false);
  });
});

describe("a catalog without some texts never stops a command (integration found doctor ending as internal_error)", () => {
  /** Knows no doctor or help id at all, as an older catalog would. */
  const partial = {
    language: "en",
    format: (id: string) => {
      if (id.startsWith("doctor.") || id.startsWith("help.")) throw new Error("unknown message id");
      return id as CatalogText;
    },
  } as unknown as MessageCatalog;

  test("doctor falls back to the English lines", async () => {
    const outcome = await runDoctor({
      argv: ["doctor"],
      env: {},
      cwd: "/",
      nodeVersion: "26.0.0",
      readFile: async () => Promise.reject(new Error("x")),
      isDirectory: async () => false,
      isFile: async () => false,
      locateInWorkspace: lexicalLocate,
      relatePaths: async () => "separate",
      messages: partial,
    });
    assert.ok("text" in outcome, "text, not an internal_error object");
    assert.notEqual(outcome.exitCode, 70);
    assert.ok(outcome.text.includes("meets the requirement"));
    assert.ok(outcome.text.includes("No network access was made"));
  });

  test("help falls back to English, then to the id", async () => {
    const { helpText } = await import("../../../src/cli/help.js");
    const text = helpText("doctor", partial);
    assert.ok(text.startsWith("usage: codaryn doctor"));
    assert.ok(text.length > 40);
  });
});
