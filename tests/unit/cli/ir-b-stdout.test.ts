/**
 * IR-B5 (improvement review B): the CLI's one stdout write (src/cli/main.ts, after the S-6 guard) when
 * the place it writes to fails. PM policy:
 * - The reader went away first (EPIPE): no raw error or stack; the run's stored result and journal stay,
 *   and the exit code is the run's own.
 * - Any other write error: one fixed line on stderr (no error text, which may hold a path) and exit code 1.
 * - An open stdout: the same one JSON line and the same exit code as before.
 * Each case runs the real CLI with a scripted task (no key, no network) and ends only its own child.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { closeSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { EngineResult } from "../../../src/contracts/index.js";
import { CLI_PATH, NODE, assertCliBuilt, cliEnv, readRunFiles } from "../../support/cli.js";
import { createSandbox, writeTask } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";

const TIMEOUT_MS = 60_000;
const NOTE = "# Note\n\nWritten by the scripted run.\n";
const STACK = /^\s+at /m;
/** The one fixed line for a stdout write that failed otherwise (no error text: it may hold a path). */
const STDOUT_WRITE_FAILED_LINE = "codaryn: stdout_write_failed: the output could not be written to standard output\n";

/** A task that ends done/verified (exit 0), so an exit code of 1 can only be the stdout failure's. */
function task(sb: Sandbox): string {
  return writeTask(
    sb,
    { id: "ir-b5-stdout", workflow: "document", verifiers: [{ id: "note", kind: "file_rules", rules: [{ type: "contains", path: "NOTE.md", text: "# Note" }] }] },
    [
      { toolCalls: [{ id: "w1", name: "write_file", args: { path: "NOTE.md", expectedHash: null, change: { kind: "replace_all", content: NOTE } } }] },
      { text: "wrote NOTE.md" },
    ],
  );
}

type Stdout = "pipe" | "closed-pipe" | number;

/** The real CLI on the task; its exit, stdout and stderr. Only this child is ended, by its handle. */
function runCli(t: TestContext, sb: Sandbox, stdout: Stdout): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  const child = spawn(NODE, [CLI_PATH, "run", "--task", sb.taskPath, "--json"], {
    cwd: sb.base,
    env: cliEnv(),
    stdio: ["ignore", stdout === "closed-pipe" ? "pipe" : stdout, "pipe"],
    shell: false,
    windowsHide: true,
  });
  let closed = false;
  t.after(() => {
    if (!closed) child.kill();
  });
  const out: Buffer[] = [], err: Buffer[] = [];
  // The reader goes away before the CLI has written anything (it is still starting).
  if (stdout === "closed-pipe") child.stdout?.destroy();
  else child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => err.push(chunk));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the CLI did not end in time")), TIMEOUT_MS);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      closed = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
  });
}

/** The run the CLI stored: one run directory, its result and its journal. */
function storedRun(sb: Sandbox): EngineResult {
  const runs = join(sb.workspace, ".codaryn", "runs");
  const ids = readdirSync(runs);
  assert.equal(ids.length, 1, "one run");
  const result = JSON.parse(readFileSync(join(runs, ids[0]!, "result.json"), "utf8")) as EngineResult;
  assert.ok(readRunFiles(sb.workspace, result).records.length > 0, "the journal is stored");
  return result;
}

test("IR-B5: an open stdout gets the one JSON line of the run, and the run's exit code", { timeout: TIMEOUT_MS * 2 }, async (t) => {
  assertCliBuilt();
  const sb = createSandbox(t);
  task(sb);
  const run = await runCli(t, sb, "pipe");
  const result = storedRun(sb);
  assert.deepEqual([result.status, result.reason, result.exitCode], ["done", "verified", 0]);
  assert.deepEqual([run.code, run.signal], [0, null]);
  assert.ok(run.stdout.endsWith("\n") && run.stdout.indexOf("\n") === run.stdout.length - 1, "exactly one line");
  assert.deepEqual(JSON.parse(run.stdout), JSON.parse(JSON.stringify(result)), "the line is the stored result");
  assert.doesNotMatch(run.stderr, STACK);
  assert.equal(run.stderr.includes(STDOUT_WRITE_FAILED_LINE.trim()), false);
});

test("IR-B5: a reader that went away (EPIPE): no raw error or stack, the stored run stays, the run's exit code", { timeout: TIMEOUT_MS * 2 }, async (t) => {
  assertCliBuilt();
  const sb = createSandbox(t);
  task(sb);
  const run = await runCli(t, sb, "closed-pipe");
  const result = storedRun(sb);
  assert.deepEqual([result.status, result.reason, result.exitCode], ["done", "verified", 0], "the run is stored as it ended");
  assert.doesNotMatch(run.stderr, STACK, "no stack on stderr");
  assert.doesNotMatch(run.stderr, /EPIPE|Error:/, "no raw error on stderr");
  assert.equal(run.stderr.includes(STDOUT_WRITE_FAILED_LINE.trim()), false, "a gone reader is not a write failure");
  assert.deepEqual([run.code, run.signal], [result.exitCode, null], "the run's exit code");
});

test("IR-B5: another stdout write error: one fixed line on stderr, no error text, exit code 1", { timeout: TIMEOUT_MS * 2 }, async (t) => {
  assertCliBuilt();
  const sb = createSandbox(t);
  task(sb);
  // A file opened for reading only: every write to it fails, and not with EPIPE.
  const target = join(sb.base, "read-only-stdout.txt");
  writeFileSync(target, "");
  const fd = openSync(target, "r");
  let run: Awaited<ReturnType<typeof runCli>>;
  try {
    run = await runCli(t, sb, fd);
  } finally {
    closeSync(fd);
  }
  const result = storedRun(sb);
  assert.deepEqual([result.status, result.reason, result.exitCode], ["done", "verified", 0], "the run is stored as it ended");
  assert.doesNotMatch(run.stderr, STACK, "no stack on stderr");
  assert.doesNotMatch(run.stderr, /EBADF|EPERM|EACCES|bad file descriptor|not permitted|Error:/i, "no raw error on stderr");
  assert.equal(run.stderr.split(STDOUT_WRITE_FAILED_LINE).length - 1, 1, "the fixed line, once");
  assert.deepEqual([run.code, run.signal], [1, null], "exit code 1");
});
