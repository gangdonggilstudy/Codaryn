/**
 * T-2 (review F6-3): a command is settled when it exits, even when a background descendant keeps
 * the output pipes open. Also the exported way to build a runner with the env value check and the
 * workspace root (T-1 wiring). Real processes; runs on every OS.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { createCommandRunner, createWorkspaceCommandRunner } from "../../../src/tools/index.js";
import type { CommandRunRequest } from "../../../src/tools/index.js";

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function workspaceDir(): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-t2-")));
  dirs.push(dir);
  return dir;
}

const systemRoot = process.env["SystemRoot"] ?? "C:\\Windows";
const parentEnv = (extra: Record<string, string> = {}) => ({
  PATH: path.dirname(process.execPath),
  SystemRoot: systemRoot,
  ...extra,
});
const live = () => new AbortController().signal;

/**
 * Node prints "started;" and, once that line is written, starts a detached background node that
 * inherits the output pipes, then exits with 3 once that process runs (it writes a file first). The
 * background process writes "early;" after 100 ms and "late;" after 1500 ms, and ends by itself after
 * 4 s. Every write is a whole line: a stream that is not read to its end loses its unfinished last
 * line (V-2).
 *
 * U-271: the command waits for the background process to run, so "early;" comes about 100 ms after
 * the exit however long that process took to start; before, a start slower than the 500 ms grace on
 * a busy machine left it out.
 *
 * N-28: the test ends no process by its pid. The background process has no handle here, so it is
 * short-lived instead: 4 s from its start, which comes before the command's exit, still outlasts
 * every time limit below (at most 3.5 s) and the 500 ms grace, so it holds the pipes for as long as
 * each test needs. Starting it only after the command's own line is written keeps "started;" first
 * under any load.
 */
function backgroundRequest(cwdAbsolute: string, timeoutMs: number, exitMarker?: string, exitSignal?: string): CommandRunRequest {
  // The file the background process writes as it starts (inside the workspace, which exists until the run ends).
  const running = path.join(cwdAbsolute, "background-running");
  const body = `require('node:fs').writeFileSync(${JSON.stringify(running)}, ''); setTimeout(() => process.stdout.write('early;\\n'), 100); setTimeout(() => process.stdout.write('late;\\n'), 1500); setTimeout(() => {}, 4000);`;
  const script = [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    "process.stdout.write('started;\\n', () => {",
    // Its working directory is outside the workspace, which the after hook removes while it may still run.
    `  spawn(process.execPath, ['-e', ${JSON.stringify(body)}], { stdio: ['ignore', 'inherit', 'inherit'], detached: true, cwd: require('node:os').tmpdir() }).unref();`,
    "  const exit = () => {",
    // Optional: tells the test that the command is about to exit.
    ...(exitMarker === undefined ? [] : [`    fs.writeFileSync(${JSON.stringify(exitMarker)}, '');`]),
    // Optional: exits only once the test's signal file is there, so the test chooses when the exit comes.
    ...(exitSignal === undefined
      ? ["    process.exit(3);"]
      : [`    const exitWhenSignalled = () => (fs.existsSync(${JSON.stringify(exitSignal)}) ? process.exit(3) : setTimeout(exitWhenSignalled, 10));`, "    exitWhenSignalled();"]),
    "  };",
    // U-271: the exit comes once the background process runs.
    `  const whenRunning = () => (fs.existsSync(${JSON.stringify(running)}) ? exit() : setTimeout(whenRunning, 10));`,
    "  whenRunning();",
    "});",
  ].join("\n");
  return { executable: process.execPath, args: ["-e", script], cwdAbsolute, timeoutMs };
}

test("T-2: a command that exits while a background descendant holds the pipes is settled at its exit, not as a timeout", async () => {
  const ws = workspaceDir();
  const runner = createCommandRunner({ parentEnv: parentEnv(), workspaceRoot: ws });
  // U-271: timed from the command's exit (its marker), not from the run's start: a bound from the start
  // (1,900 ms) had to fit two Node starts, which a busy machine does not promise.
  const marker = path.join(ws, "exiting");
  const exit: { at: number | null } = { at: null };
  const watch = setInterval(() => {
    if (exit.at === null && fs.existsSync(marker)) exit.at = Date.now();
  }, 10);
  try {
    const result = await runner.run(backgroundRequest(ws, 3_500, marker), live());
    const settledAt = Date.now();
    assert.ok(!("spawnFailed" in result), JSON.stringify(result));
    assert.equal(result.exitCode, 3);
    assert.equal(result.timedOut, false);
    // The background process holds the pipes 4 s from its start, which came before the exit: the run
    // settled with the 500 ms grace after the exit, not when the pipes closed.
    const exitAt = exit.at ?? settledAt;
    assert.ok(exit.at !== null, "the command reached its exit");
    assert.ok(settledAt - exitAt < 2_500, `settled ${settledAt - exitAt} ms after the exit`);
  } finally {
    clearInterval(watch);
  }
});

test("T-2: output in flight right after the exit is kept for a short grace; later output is not waited for", async () => {
  const ws = workspaceDir();
  const runner = createCommandRunner({ parentEnv: parentEnv(), workspaceRoot: ws });
  const result = await runner.run(backgroundRequest(ws, 10_000), live());
  assert.ok(!("spawnFailed" in result), JSON.stringify(result));
  assert.equal(result.stdout, "started;\nearly;\n");
  assert.equal(result.exitCode, 3);
});

test("T-2: a command still running at its time limit is ended and reported as timed out", async () => {
  const ws = workspaceDir();
  const runner = createCommandRunner({ parentEnv: parentEnv(), workspaceRoot: ws });
  const started = Date.now();
  const result = await runner.run(
    { executable: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], cwdAbsolute: ws, timeoutMs: 800 },
    live(),
  );
  assert.ok(!("spawnFailed" in result), JSON.stringify(result));
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.ok(Date.now() - started < 5_000);
});

test("T-2: cancelling after the command exited returns at once with its exit code", async () => {
  const ws = workspaceDir();
  const runner = createCommandRunner({ parentEnv: parentEnv(), workspaceRoot: ws });
  const controller = new AbortController();
  const marker = path.join(ws, "exiting");
  const running = runner.run(backgroundRequest(ws, 10_000, marker), controller.signal);
  // The command writes the marker right before it exits. A fixed wait from the start was not
  // enough under the load of the full unit run. 150 ms after the marker the exit has been seen,
  // well inside the 500 ms grace.
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(marker)) {
    if (Date.now() > deadline) throw new Error("test setup: the command did not reach its exit");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
  const abortedAt = Date.now();
  controller.abort();
  const result = await running;
  assert.ok(!("spawnFailed" in result), JSON.stringify(result));
  assert.ok(Date.now() - abortedAt < 400, "no kill and no close wait after the exit");
  assert.equal(result.exitCode, 3, "the exit code stays final: nothing was stopped");
  assert.equal(result.timedOut, false);
  // V-2 (revised): closing the pipes early drops only an unfinished last line; whole lines stay
  // and `truncated` keeps meaning the capture cap.
  assert.equal(result.truncated, false);
  assert.match(result.stdout, /^started;\n/);
});

test("T-2: a time limit that falls in the grace after the exit does not turn the run into a timeout", async () => {
  const ws = workspaceDir();
  const runner = createCommandRunner({ parentEnv: parentEnv(), workspaceRoot: ws });
  // The command exits once the test's signal file is there, which the test makes about 250 ms before the
  // 3000 ms limit, so the limit comes during the 500 ms grace that follows. A 450 ms limit that the
  // command's own start and its background child had to fit in failed once under the load of the full
  // unit run (U-270): the start alone takes 114-365 ms on an idle machine.
  const limitMs = 3_000;
  const exitSignal = path.join(ws, "exit-now");
  const started = Date.now();
  const signalled = setTimeout(() => fs.writeFileSync(exitSignal, ""), limitMs - 250);
  try {
    const result = await runner.run(backgroundRequest(ws, limitMs, undefined, exitSignal), live());
    assert.ok(!("spawnFailed" in result), JSON.stringify(result));
    assert.equal(result.timedOut, false);
    assert.equal(result.exitCode, 3);
    // The background child holds the pipes, so the run ends with the grace: after the limit's time.
    assert.ok(Date.now() - started >= limitMs, "the limit fell in the grace after the exit");
  } finally {
    clearTimeout(signalled);
  }
});

// ---- The exported way to build the runner for a run (used by the CLI assembly, T-1) ----

const SECRET = "fakeT1-runner-0099";
const PRINT_ENV = "process.stdout.write(JSON.stringify({ tmp: process.env.TMP ?? null, temp: process.env.TEMP ?? null }))";

test("T-1/T-2: createWorkspaceCommandRunner drops allow-listed variables that hold a registered secret", async () => {
  const ws = workspaceDir();
  const privacy = createPrivacyGateway({ secrets: [SECRET] });
  const env = parentEnv({ TMP: path.join(ws, SECRET), TEMP: path.join(ws, "plain") });
  const request: CommandRunRequest = { executable: process.execPath, args: ["-e", PRINT_ENV], cwdAbsolute: ws, timeoutMs: 10_000 };

  const guarded = await createWorkspaceCommandRunner({ workspace: { root: ws }, privacy, parentEnv: env }).run(request, live());
  assert.ok(!("spawnFailed" in guarded), JSON.stringify(guarded));
  assert.deepEqual(JSON.parse(guarded.stdout), { tmp: null, temp: path.join(ws, "plain") });

  // Why the factory matters: a runner built without options passes the value on.
  const bare = await createCommandRunner({ parentEnv: env }).run(request, live());
  assert.ok(!("spawnFailed" in bare), JSON.stringify(bare));
  assert.equal(JSON.parse(bare.stdout).tmp, path.join(ws, SECRET));
});
