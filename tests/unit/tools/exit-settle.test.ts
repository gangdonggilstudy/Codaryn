/**
 * T-2 (review F6-3): a command is settled when it exits, even when a background descendant keeps
 * the output pipes open. Also the exported way to build a runner with the env value check and the
 * workspace root (T-1 wiring). Real processes; runs on every OS.
 */

import assert from "node:assert/strict";
import cp from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { TestContext } from "node:test";

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

// Setup has a real safety bound; only the runner's timers use the controlled clock.
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
async function within<T>(pending: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = realSetTimeout(() => reject(new Error("test setup: owned command did not respond")), 15_000);
    })]);
  } finally { realClearTimeout(timer); }
}

/** Observe the real direct child, before the runner attaches its exit listener. Never signal a PID. */
function observeCommand(t: TestContext, onExit: () => void = () => {}) {
  const spawn = cp.spawn;
  const exited = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>();
  let child: ChildProcess | undefined, directKill: ChildProcess["kill"] | undefined, kills = 0;
  const spawned = t.mock.method(cp, "spawn", ((...args: Parameters<typeof cp.spawn>) => {
    const owned = spawn(...args);
    if (child === undefined) {
      child = owned; directKill = owned.kill.bind(owned);
      owned.once("exit", (code, signal) => { onExit(); exited.resolve({ code, signal }); });
      owned.once("error", error => exited.reject(error));
      t.mock.method(owned, "kill", (...signals: Parameters<ChildProcess["kill"]>) => {
        kills++; return directKill!(...signals);
      });
    }
    return owned;
  }) as typeof cp.spawn);
  syncBuiltinESMExports();
  t.after(async () => {
    t.mock.restoreAll(); syncBuiltinESMExports();
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      directKill!(); await within(exited.promise);
    }
    child?.stdout?.destroy(); child?.stderr?.destroy();
  });
  return { exit: () => within(exited.promise), child: () => { assert.ok(child); return child; },
    kills: () => kills, spawns: () => spawned.mock.callCount() };
}

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
 * N-28: the background process has no handle here and is never ended by PID; it expires after 4 s.
 * Controlled-clock tests check the inherited pipe is still open at the real command exit. Their
 * 15 s bound is setup protection, separate from the 500 ms post-exit grace. Starting the background
 * process only after the command's own line is written keeps "started;" first under any load.
 */
function backgroundRequest(cwdAbsolute: string, timeoutMs: number): CommandRunRequest {
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
    "    process.exit(3);",
    "  };",
    // U-271: the exit comes once the background process runs.
    `  const whenRunning = () => (fs.existsSync(${JSON.stringify(running)}) ? exit() : setTimeout(whenRunning, 10));`,
    "  whenRunning();",
    "});",
  ].join("\n");
  return { executable: process.execPath, args: ["-e", script], cwdAbsolute, timeoutMs };
}

test("T-2: a command that exits while a background descendant holds the pipes is settled at its exit, not as a timeout", async (t) => {
  const ws = workspaceDir();
  const runner = createCommandRunner({ parentEnv: parentEnv(), workspaceRoot: ws });
  const command = observeCommand(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let settled = false;
  const running = runner.run(backgroundRequest(ws, 15_000), live()).then(result => { settled = true; return result; });
  assert.deepEqual(await command.exit(), { code: 3, signal: null });
  assert.equal(command.child().stdout?.readableEnded, false, "the descendant still holds the output pipe");
  t.mock.timers.tick(499); await Promise.resolve();
  assert.equal(settled, false, "the runner keeps the pipe through the grace");
  t.mock.timers.tick(1);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, true, "500 ms settles without waiting for the descendant to close the pipe");
  const result = await within(running);
  assert.ok(!("spawnFailed" in result), JSON.stringify(result));
  assert.equal(result.exitCode, 3);
  assert.equal(result.timedOut, false);
  assert.match(result.stdout, /^started;\n/);
  assert.equal(result.truncated, false);
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

test("T-2: cancelling after the command exited returns at once with its exit code", async (t) => {
  const ws = workspaceDir();
  const runner = createCommandRunner({ parentEnv: parentEnv(), workspaceRoot: ws });
  const controller = new AbortController();
  const command = observeCommand(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let settled = false;
  const running = runner.run(backgroundRequest(ws, 15_000), controller.signal).then(result => { settled = true; return result; });
  // A marker before process.exit does not prove the child has ended. Await its actual exit;
  // the controlled clock leaves all 500 ms of grace available even if this parent was delayed.
  assert.deepEqual(await command.exit(), { code: 3, signal: null });
  assert.equal(command.child().stdout?.readableEnded, false);
  controller.abort();
  // No clock advance: waiting for a kill/close/grace timer would leave this promise pending.
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, true, "abort settles now, without advancing the grace or kill/close timers");
  const result = await within(running);
  assert.ok(!("spawnFailed" in result), JSON.stringify(result));
  assert.equal(command.kills(), 0, "an exited child must never be signalled");
  assert.equal(command.spawns(), 1, "no tree killer is started after the exit");
  assert.equal(result.exitCode, 3, "the exit code stays final: nothing was stopped");
  assert.equal(result.timedOut, false);
  // V-2 (revised): closing the pipes early drops only an unfinished last line; whole lines stay
  // and `truncated` keeps meaning the capture cap.
  assert.equal(result.truncated, false);
  assert.match(result.stdout, /^started;\n/);
});

test("T-2: a time limit that falls in the grace after the exit does not turn the run into a timeout", async (t) => {
  const ws = workspaceDir();
  const runner = createCommandRunner({ parentEnv: parentEnv(), workspaceRoot: ws });
  // Place the observed real exit at logical 2750 ms, before the runner handles that event.
  // Startup takes no logical time; the original 3000 ms deadline lies inside the 500 ms grace.
  const limitMs = 3_000;
  const command = observeCommand(t, () => t.mock.timers.tick(limitMs - 250));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let settled = false;
  const running = runner.run(backgroundRequest(ws, limitMs), live()).then(result => { settled = true; return result; });
  assert.deepEqual(await command.exit(), { code: 3, signal: null });
  assert.equal(command.child().stdout?.readableEnded, false);
  t.mock.timers.tick(250); await Promise.resolve();
  assert.equal(settled, false, "crossing the original deadline neither times out nor skips the grace");
  t.mock.timers.tick(250);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, true, "the grace settles at logical 3250 ms despite the earlier deadline");
  const result = await within(running);
  assert.ok(!("spawnFailed" in result), JSON.stringify(result));
  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, 3);
  assert.match(result.stdout, /^started;\n/);
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
