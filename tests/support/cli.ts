/**
 * Process-level helpers for integration tests.
 * They use only the public CLI (`dist/src/cli/main.js`) and contract types and constants.
 * Nothing here imports product implementation modules.
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_KEY_PATTERN_SOURCE,
  CHILD_ENV_ALLOWLIST,
  JOURNAL_FILE_NAME,
  LOCK_FILE_NAME,
  RESULT_FILE_NAME,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
} from "../../src/contracts/index.js";
import type {
  CliErrorCode,
  CliErrorOutput,
  CliOutput,
  EngineResult,
  JournalRecord,
  ModelProviderName,
  ToolResult,
} from "../../src/contracts/index.js";
import { FAKE_API_KEYS } from "../fixtures/secrets.js";
import { NET_GUARD_LOG_ENV } from "./net-guard.js";

/** Compiled location is `dist/tests/support/cli.js`, so the repository root is three levels up. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const CLI_PATH = join(REPO_ROOT, "dist", "src", "cli", "main.js");
export const NODE = process.execPath;

export function assertCliBuilt(): void {
  if (!existsSync(CLI_PATH)) {
    assert.fail(`CLI build output is missing: ${CLI_PATH}. Integration tests run after G3b.`);
  }
}

export interface EnvOptions {
  readonly extra?: Readonly<Record<string, string>>;
  /** Drop PATH and PATHEXT so the CLI cannot find git, npm or other tools. */
  readonly omitPath?: boolean;
  /**
   * Sets ANTHROPIC_API_KEY for mock API tests. Only a value from FAKE_API_KEYS is accepted, and
   * it must not have the shape of a real key. Anything else throws.
   */
  readonly fakeApiKey?: string;
}

/**
 * Minimal environment for the CLI process. Only CHILD_ENV_ALLOWLIST names are inherited, so a
 * developer's ANTHROPIC_API_KEY or CODARYN_MODEL never reaches the CLI. An API key can never be
 * added through `extra`; mock API tests set one of the fake keys with `fakeApiKey`.
 */
export function cliEnv(options: EnvOptions = {}): NodeJS.ProcessEnv {
  const allow = new Set<string>(CHILD_ENV_ALLOWLIST);
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (!allow.has(upper)) continue;
    if (options.omitPath === true && (upper === "PATH" || upper === "PATHEXT")) continue;
    env[name] = value;
  }
  for (const [name, value] of Object.entries(options.extra ?? {})) {
    if (name.toUpperCase() === ANTHROPIC_API_KEY_ENV) {
      throw new Error("Integration tests never set an API key variable.");
    }
    env[name] = value;
  }
  if (options.fakeApiKey !== undefined) {
    const value = options.fakeApiKey;
    if (!FAKE_API_KEYS.includes(value) || new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE).test(value)) {
      throw new Error("Integration tests set only the fake API keys from tests/fixtures/secrets.ts.");
    }
    env[ANTHROPIC_API_KEY_ENV] = value;
  }
  return env;
}

export interface CliRun {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

export interface StartedCli {
  readonly child: ChildProcess;
  readonly done: Promise<CliRun>;
}

export interface StartOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Working directory of the CLI process. Use the sandbox base, never the repository. */
  readonly cwd: string;
  readonly cancelFile?: string;
  readonly timeoutMs?: number;
  /**
   * Preloads the network guard (`net-guard.js`) into the CLI process and names the file where it
   * logs blocked hosts. Mock API tests always set it, so the CLI can reach loopback hosts only.
   */
  readonly netGuardLog?: string;
  /** Another build of the CLI to run (for example a copy, see installCopy). Defaults to CLI_PATH. */
  readonly cliPath?: string;
  /**
   * The CLI's standard input. "ignore" (default) is the null device. "pipe" is a pipe the test
   * keeps open and never writes to: not a terminal, and a read on it would wait (Y-3 prompts).
   */
  readonly stdin?: "ignore" | "pipe";
}

/** Compiled next to this file as `dist/tests/support/net-guard.js`. */
const NET_GUARD_URL = new URL("./net-guard.js", import.meta.url).href;

export function startCli(args: readonly string[], options: StartOptions): StartedCli {
  const cli = options.cliPath ?? CLI_PATH;
  if (options.cliPath === undefined) assertCliBuilt();
  else assert.ok(existsSync(cli), `CLI copy is missing: ${cli}`);
  const started = Date.now();
  const guard = options.netGuardLog;
  const baseEnv = options.env ?? cliEnv();
  const nodeArgs = guard === undefined ? [cli, ...args] : ["--import", NET_GUARD_URL, cli, ...args];
  const child = spawn(NODE, nodeArgs, {
    cwd: options.cwd,
    env: guard === undefined ? baseEnv : { ...baseEnv, [NET_GUARD_LOG_ENV]: guard },
    stdio: [options.stdin ?? "ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => err.push(chunk));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, options.timeoutMs ?? 60_000);
  const done = new Promise<CliRun>((resolve, reject) => {
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        signal,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
  return { child, done };
}

/** `node dist/src/cli/main.js run --task <task.json> [--cancel-file <path>]` */
export function startTask(taskPath: string, options: StartOptions): StartedCli {
  const args = ["run", "--task", taskPath];
  if (options.cancelFile !== undefined) args.push("--cancel-file", options.cancelFile);
  return startCli(args, options);
}

export function runTask(taskPath: string, options: StartOptions): Promise<CliRun> {
  return startTask(taskPath, options).done;
}

/** stdout must be exactly one JSON line whose exitCode equals the process exit code. */
export function parseCliOutput(run: CliRun): CliOutput {
  assert.equal(run.timedOut, false, `CLI did not finish in time. stderr: ${run.stderr.slice(0, 2000)}`);
  const lines = run.stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  assert.equal(lines.length, 1, `stdout must be one JSON line, got: ${JSON.stringify(run.stdout.slice(0, 2000))}`);
  const parsed = JSON.parse(lines[0] ?? "") as CliOutput;
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.exitCode, run.exitCode, "exitCode in stdout must equal the process exit code");
  return parsed;
}

/**
 * A run result produced by `provider`. Offline tests use the default, "scripted". Mock API tests
 * pass "anthropic" (a local fake server, never the real API).
 */
export function expectRunResult(run: CliRun, provider: ModelProviderName = "scripted"): EngineResult {
  const output = parseCliOutput(run);
  if (output.kind !== "run") {
    assert.fail(`expected a run result, got ${JSON.stringify(output)}; stderr: ${run.stderr.slice(0, 2000)}`);
  }
  assert.equal(output.provider, provider, `the run must report the ${provider} provider`);
  return output;
}

export function expectCliError(run: CliRun, code: CliErrorCode): CliErrorOutput {
  const output = parseCliOutput(run);
  if (output.kind !== "error") {
    assert.fail(`expected a CLI error, got ${JSON.stringify(output)}`);
  }
  assert.equal(output.code, code);
  return output;
}

export interface RunFiles {
  readonly runDir: string;
  readonly journalText: string;
  readonly records: readonly JournalRecord[];
  readonly resultText: string;
}

export function runDirOf(workspace: string, runId: string): string {
  return join(workspace, STATE_DIR_NAME, RUNS_DIR_NAME, runId);
}

/** Reads journal.jsonl and result.json of a finished run and checks their basic shape. */
export function readRunFiles(workspace: string, result: EngineResult): RunFiles {
  const journalFile = join(workspace, ...result.journalPath.split("/"));
  const runDir = runDirOf(workspace, result.runId);
  assert.equal(journalFile, join(runDir, JOURNAL_FILE_NAME), "journalPath must point into runs/<runId>/");
  const journalText = readFileSync(journalFile, "utf8");
  const records = parseJournal(journalText, false);
  const resultText = readFileSync(join(dirname(journalFile), RESULT_FILE_NAME), "utf8");
  assert.deepEqual(JSON.parse(resultText), result, "result.json must equal the stdout object");
  assertJournalWellFormed(records, result.runId);
  return { runDir, journalText, records, resultText };
}

export function parseJournal(text: string, allowPartialTail: boolean): JournalRecord[] {
  const records: JournalRecord[] = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    try {
      records.push(JSON.parse(line) as JournalRecord);
    } catch (error) {
      if (allowPartialTail && index === lines.length - 1) return;
      throw error;
    }
  });
  return records;
}

export function assertJournalWellFormed(records: readonly JournalRecord[], runId: string): void {
  assert.ok(records.length >= 2, "journal needs at least run_started and run_finished");
  records.forEach((record, index) => {
    assert.equal(record.seq, index + 1, "seq starts at 1 and increases by one");
    assert.equal(record.runId, runId);
    assert.ok(!Number.isNaN(Date.parse(record.at)), "at must be a timestamp");
  });
  assert.equal(records[0]?.type, "run_started");
  assert.equal(records[records.length - 1]?.type, "run_finished");
}

/** Records of any run in this workspace, tolerating a partially written last line. */
export function readLiveRecords(workspace: string): JournalRecord[] {
  const runsDir = join(workspace, STATE_DIR_NAME, RUNS_DIR_NAME);
  if (!existsSync(runsDir)) return [];
  const records: JournalRecord[] = [];
  for (const entry of readdirSync(runsDir)) {
    const file = join(runsDir, entry, JOURNAL_FILE_NAME);
    if (!existsSync(file)) continue;
    records.push(...parseJournal(readFileSync(file, "utf8"), true));
  }
  return records;
}

export function lockPath(workspace: string): string {
  return join(workspace, STATE_DIR_NAME, LOCK_FILE_NAME);
}

export type ToolDecisionRecord = Extract<JournalRecord, { type: "tool_decision" }>;

export function toolResultFor(records: readonly JournalRecord[], callId: string): ToolResult {
  for (const record of records) {
    if (record.type === "tool_result" && record.result.callId === callId) return record.result;
  }
  assert.fail(`no tool_result for call ${callId}`);
}

export function hasToolResult(records: readonly JournalRecord[], callId: string): boolean {
  return records.some((record) => record.type === "tool_result" && record.result.callId === callId);
}

export function deniedDecision(records: readonly JournalRecord[], callId: string): ToolDecisionRecord {
  for (const record of records) {
    if (record.type === "tool_decision" && record.callId === callId && !record.allowed) return record;
  }
  assert.fail(`no denying tool_decision for call ${callId}`);
}

/** The call was refused with one of `codes` and was therefore not executed. */
export function assertRefused(records: readonly JournalRecord[], callId: string, codes: readonly string[]): ToolResult {
  const result = toolResultFor(records, callId);
  assert.equal(result.ok, false, `call ${callId} must be refused`);
  assert.ok(
    result.errorCode !== null && codes.includes(result.errorCode),
    `call ${callId}: errorCode ${String(result.errorCode)} not in ${codes.join(", ")}`,
  );
  return result;
}

export function payloadOf<T>(result: ToolResult): T {
  assert.equal(result.ok, true, `call ${result.callId} failed: ${result.errorCode ?? ""} ${result.content}`);
  return JSON.parse(result.content) as T;
}

export function countRecords(records: readonly JournalRecord[], type: JournalRecord["type"]): number {
  return records.filter((record) => record.type === type).length;
}

export async function waitFor(check: () => boolean, timeoutMs: number, what: string, intervalMs = 50): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (check()) return;
    await delay(intervalMs);
  }
  assert.fail(`${what}: did not happen within ${timeoutMs} ms`);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function killQuietly(pid: number): void {
  try {
    process.kill(pid);
  } catch {
    // already gone
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
