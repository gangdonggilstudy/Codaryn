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

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cleanup(pid: number | null): void {
  if (pid !== null && alive(pid)) process.kill(pid);
}

/**
 * Node starts a detached background node that inherits the output pipes, prints its pid and
 * exits with 3 right away. The background process writes "early;" after 100 ms and "late;"
 * after 1500 ms, then waits 20 s. Every write is a whole line: a stream that is not read to its
 * end loses its unfinished last line (V-2).
 */
function backgroundRequest(cwdAbsolute: string, timeoutMs: number, exitMarker?: string): CommandRunRequest {
  const body = "setTimeout(() => process.stdout.write('early;\\n'), 100); setTimeout(() => process.stdout.write('late;\\n'), 1500); setTimeout(() => {}, 20000);";
  const script = [
    "const { spawn } = require('node:child_process');",
    `const c = spawn(process.execPath, ['-e', ${JSON.stringify(body)}], { stdio: ['ignore', 'inherit', 'inherit'], detached: true });`,
    "c.unref();",
    "process.stdout.write('bg ' + c.pid + ';\\n');",
    // Optional: tells the test that the command is about to exit.
    ...(exitMarker === undefined ? [] : [`require('node:fs').writeFileSync(${JSON.stringify(exitMarker)}, '');`]),
    "process.exit(3);",
  ].join("\n");
  return { executable: process.execPath, args: ["-e", script], cwdAbsolute, timeoutMs };
}

function backgroundPid(stdout: string): number | null {
  const match = /bg (\d+);/.exec(stdout);
  return match === null ? null : Number(match[1]);
}

test("T-2: a command that exits while a background descendant holds the pipes is settled at its exit, not as a timeout", async () => {
  const ws = workspaceDir();
  const runner = createCommandRunner({ parentEnv: parentEnv(), workspaceRoot: ws });
  const started = Date.now();
  const result = await runner.run(backgroundRequest(ws, 2_000), live());
  const elapsed = Date.now() - started;
  assert.ok(!("spawnFailed" in result), JSON.stringify(result));
  const pid = backgroundPid(result.stdout);
  try {
    assert.equal(result.exitCode, 3);
    assert.equal(result.timedOut, false);
    assert.ok(elapsed < 1_900, `settled after ${elapsed} ms, before the 2000 ms limit`);
  } finally {
    cleanup(pid);
  }
});

test("T-2: output in flight right after the exit is kept for a short grace; later output is not waited for", async () => {
  const ws = workspaceDir();
  const runner = createCommandRunner({ parentEnv: parentEnv(), workspaceRoot: ws });
  const result = await runner.run(backgroundRequest(ws, 10_000), live());
  assert.ok(!("spawnFailed" in result), JSON.stringify(result));
  const pid = backgroundPid(result.stdout);
  try {
    assert.match(result.stdout, /^bg \d+;\nearly;\n$/);
    assert.equal(result.exitCode, 3);
  } finally {
    cleanup(pid);
  }
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
  const pid = backgroundPid(result.stdout);
  try {
    assert.ok(Date.now() - abortedAt < 400, "no kill and no close wait after the exit");
    assert.equal(result.exitCode, 3, "the exit code stays final: nothing was stopped");
    assert.equal(result.timedOut, false);
    // V-2 (revised): closing the pipes early drops only an unfinished last line; whole lines stay
    // and `truncated` keeps meaning the capture cap.
    assert.equal(result.truncated, false);
    assert.match(result.stdout, /^bg \d+;\n/);
  } finally {
    cleanup(pid);
  }
});

test("T-2: a time limit that falls in the grace after the exit does not turn the run into a timeout", async () => {
  const ws = workspaceDir();
  const runner = createCommandRunner({ parentEnv: parentEnv(), workspaceRoot: ws });
  // The command exits within about 100 ms; the limit comes during the 500 ms grace that follows.
  const result = await runner.run(backgroundRequest(ws, 450), live());
  assert.ok(!("spawnFailed" in result), JSON.stringify(result));
  const pid = backgroundPid(result.stdout);
  try {
    assert.equal(result.timedOut, false);
    assert.equal(result.exitCode, 3);
  } finally {
    cleanup(pid);
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
