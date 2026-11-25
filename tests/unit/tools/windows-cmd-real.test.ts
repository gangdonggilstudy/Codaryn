/**
 * Real `.cmd` runs through `createCommandRunner` (task G1). Windows only; other systems skip.
 * Scripts live in a temporary directory outside the workspace; nothing is installed.
 * Running the real `npm` is left to integration checks.
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

import { createCommandRunner } from "../../../src/tools/index.js";
import type { CommandRunner, CommandRunRequest } from "../../../src/tools/index.js";

const IS_WINDOWS = process.platform === "win32";
/** Same narrow form the runner accepts for a script path. */
const SAFE_PATH = /^[A-Za-z]:\\[A-Za-z0-9 _\-.\\=+@~#]*$/;

interface Sandbox {
  readonly bin: string;
  readonly ws: string;
  readonly runner: CommandRunner;
  request(executable: string, args: readonly string[], timeoutMs?: number): CommandRunRequest;
}

function sandbox(t: { skip(reason: string): void }, options: { workspaceRoot?: boolean } = {}): Sandbox | null {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-g1-")));
  if (!SAFE_PATH.test(base)) {
    fs.rmSync(base, { recursive: true, force: true });
    t.skip("the temporary directory path has characters the runner does not pass to cmd.exe");
    return null;
  }
  const bin = path.join(base, "bin");
  const ws = path.join(base, "ws");
  fs.mkdirSync(bin);
  fs.mkdirSync(ws);
  const systemRoot = process.env["SystemRoot"] ?? "C:\\Windows";
  const runner = createCommandRunner({
    parentEnv: { Path: `${bin};${path.join(systemRoot, "System32")}`, PATHEXT: ".COM;.EXE;.BAT;.CMD", SystemRoot: systemRoot },
    ...(options.workspaceRoot === false ? {} : { workspaceRoot: ws }),
  });
  cleanups.push(base);
  return {
    bin,
    ws,
    runner,
    request: (executable, args, timeoutMs = 30_000) => ({ executable, args, cwdAbsolute: ws, timeoutMs }),
  };
}

const cleanups: string[] = [];
after(() => {
  for (const dir of cleanups) fs.rmSync(dir, { recursive: true, force: true });
});

function writeScript(file: string, body: string): void {
  fs.writeFileSync(file, `@echo off\r\n${body}\r\n`);
}

/** A .cmd that hands `%*` to node, which prints its argv as JSON (what npm-style shims do). */
function writeEchoArgs(bin: string): void {
  fs.writeFileSync(path.join(bin, "dump.mjs"), "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
  writeScript(path.join(bin, "echoargs.cmd"), `"${process.execPath}" "%~dp0dump.mjs" %*`);
}

const live = () => new AbortController().signal;

// Only runner timers are controlled; real setup has an independent 15 s safety bound.
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

/** Observe the actual cmd child, not a file written before it exits. Cleanup uses its own handle. */
function observeCommand(t: TestContext) {
  const spawn = cp.spawn, exited = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>();
  let child: ChildProcess | undefined, directKill: ChildProcess["kill"] | undefined;
  t.mock.method(cp, "spawn", ((...args: Parameters<typeof cp.spawn>) => {
    const owned = spawn(...args);
    if (child === undefined) {
      child = owned; directKill = owned.kill.bind(owned);
      owned.once("exit", (code, signal) => exited.resolve({ code, signal }));
      owned.once("error", error => exited.reject(error));
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
  return { exit: () => within(exited.promise), child: () => { assert.ok(child); return child; } };
}

async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("G1 real: a .cmd found on PATH receives every argument unchanged", { skip: !IS_WINDOWS }, async (t) => {
  const box = sandbox(t);
  if (box === null) return;
  writeEchoArgs(box.bin);
  const args = ["test", "--", "--x=1", "C:\\p\\q", "./t/x.js", "@scope/pkg@1.0.0", "~y", "#z", "+w", "a:b", "-"];
  const result = await box.runner.run(box.request("echoargs", args), live());
  assert.ok(!("spawnFailed" in result), JSON.stringify(result));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), args);
});

test("G1 real: an argument with a cmd metacharacter is refused before anything starts", { skip: !IS_WINDOWS }, async (t) => {
  const box = sandbox(t);
  if (box === null) return;
  writeEchoArgs(box.bin);
  const marker = path.join(box.ws, "injected.txt");
  for (const bad of ["x&echo injected>injected.txt", "x|echo injected>injected.txt", "%COMSPEC%", "a\r\necho injected>injected.txt"]) {
    const result = await box.runner.run(box.request("echoargs", ["ok", bad]), live());
    assert.ok("spawnFailed" in result, JSON.stringify(bad));
    assert.match(result.message, /\(script_refused\): argument 2 /);
  }
  assert.equal(fs.existsSync(marker), false);
});

test("G1 real: a .cmd inside the workspace is not run, by path or through PATH", { skip: !IS_WINDOWS }, async (t) => {
  const box = sandbox(t);
  if (box === null) return;
  writeScript(path.join(box.ws, "build.cmd"), 'echo x> "%~dp0marker.txt"');
  const byPath = await box.runner.run(box.request(".\\build.cmd", []), live());
  assert.ok("spawnFailed" in byPath);
  assert.match(byPath.message, /inside the workspace are not run/);

  const systemRoot = process.env["SystemRoot"] ?? "C:\\Windows";
  const viaPath = createCommandRunner({
    parentEnv: { Path: `${box.ws};${path.join(systemRoot, "System32")}`, PATHEXT: ".CMD", SystemRoot: systemRoot },
    workspaceRoot: box.ws,
  });
  const found = await viaPath.run(box.request("build", []), live());
  assert.ok("spawnFailed" in found);
  assert.match(found.message, /inside the workspace are not run/);
  assert.equal(fs.existsSync(path.join(box.ws, "marker.txt")), false);
});

test("G1 real: without a workspace root the runner refuses scripts", { skip: !IS_WINDOWS }, async (t) => {
  const box = sandbox(t, { workspaceRoot: false });
  if (box === null) return;
  writeEchoArgs(box.bin);
  const result = await box.runner.run(box.request("echoargs", ["a"]), live());
  assert.ok("spawnFailed" in result);
  assert.match(result.message, /workspace root is not known/);
});

test("G1 real: commands inside the script are not looked up in the workspace directory", { skip: !IS_WINDOWS }, async (t) => {
  const box = sandbox(t);
  if (box === null) return;
  writeScript(path.join(box.bin, "outer.cmd"), "call inner");
  writeScript(path.join(box.ws, "inner.cmd"), "echo WORKSPACE-INNER");
  const result = await box.runner.run(box.request("outer", []), live());
  assert.ok(!("spawnFailed" in result), JSON.stringify(result));
  assert.ok(!result.stdout.includes("WORKSPACE-INNER"), result.stdout);
  assert.notEqual(result.exitCode, 0);
});

test("G1 real: .exe by name still starts without a shell; an unknown name is ENOENT", { skip: !IS_WINDOWS }, async (t) => {
  const box = sandbox(t);
  if (box === null) return;
  const systemRoot = process.env["SystemRoot"] ?? "C:\\Windows";
  const runner = createCommandRunner({
    parentEnv: { Path: path.dirname(process.execPath), PATHEXT: ".COM;.EXE;.BAT;.CMD", SystemRoot: systemRoot },
    workspaceRoot: box.ws,
  });
  const ran = await runner.run(box.request("node", ["-e", "process.stdout.write(process.argv[1])", "a&b|c"]), live());
  assert.ok(!("spawnFailed" in ran), JSON.stringify(ran));
  assert.equal(ran.stdout, "a&b|c");
  const missing = await runner.run(box.request("codaryn-no-such-tool", []), live());
  assert.deepEqual(missing, { spawnFailed: true, message: "could not start process (ENOENT)" });
});

/**
 * How long the node under tree.cmd lives when nothing ends it. N-28: the test has no handle to it
 * and never ends it by its pid (a freed pid may belong to another test's process by then), so it
 * ends by itself. The tests check it is gone well before this, so its own end cannot pass for the
 * runner's.
 */
const TREE_SLEEPER_MS = 15_000;

/**
 * A sleeper leaves the sandbox as its working directory first: Windows does not remove a directory
 * that a running process works in, and the sandbox is removed while a sleeper may still run.
 */
const LEAVE_SANDBOX = "import os from 'node:os'; process.chdir(os.tmpdir()); ";

/** tree.cmd starts node, which writes its pid and start time, then waits TREE_SLEEPER_MS. */
function writeTree(bin: string, pidFile: string): void {
  fs.writeFileSync(
    path.join(bin, "sleeper.mjs"),
    LEAVE_SANDBOX +
      "import fs from 'node:fs'; fs.writeFileSync(process.argv[2], JSON.stringify({ pid: process.pid, startedAt: Date.now() })); " +
      `setTimeout(() => {}, ${TREE_SLEEPER_MS});\n`,
  );
  writeScript(path.join(bin, "tree.cmd"), `"${process.execPath}" "%~dp0sleeper.mjs" "${pidFile}"`);
}

/** The pid and start time the sleeper wrote, or null before it wrote them. */
function readSleeper(pidFile: string): { readonly pid: number; readonly startedAt: number } | null {
  if (!fs.existsSync(pidFile)) return null;
  const text = fs.readFileSync(pidFile, "utf8");
  return text.length === 0 ? null : (JSON.parse(text) as { pid: number; startedAt: number });
}

/** The sleeper is gone, and the time shows the runner ended it, not its own end. */
async function assertTreeEnded(sleeper: { readonly pid: number; readonly startedAt: number }): Promise<void> {
  assert.ok(await waitFor(() => !alive(sleeper.pid), 5_000), "the grandchild node process is gone");
  const age = Date.now() - sleeper.startedAt;
  assert.ok(age < TREE_SLEEPER_MS - 3_000, `gone ${age} ms after it started, well before its own end`);
}

test("G1 real: cancelling a .cmd run also ends the process started under cmd.exe", { skip: !IS_WINDOWS }, async (t) => {
  const box = sandbox(t);
  if (box === null) return;
  const pidFile = path.join(box.bin, "pid.txt");
  writeTree(box.bin, pidFile);
  const controller = new AbortController();
  const running = box.runner.run(box.request("tree", []), controller.signal);
  assert.ok(await waitFor(() => readSleeper(pidFile) !== null, 15_000));
  const sleeper = readSleeper(pidFile);
  assert.ok(sleeper !== null);
  controller.abort();
  const result = await running;
  assert.ok(!("spawnFailed" in result));
  assert.equal(result.exitCode, null);
  await assertTreeEnded(sleeper);
});

test("G1 real: a timeout on a .cmd run also ends the process started under cmd.exe", { skip: !IS_WINDOWS }, async (t) => {
  const box = sandbox(t);
  if (box === null) return;
  const pidFile = path.join(box.bin, "pid.txt");
  writeTree(box.bin, pidFile);
  const result = await box.runner.run(box.request("tree", [], 3_000), live());
  const sleeper = readSleeper(pidFile);
  assert.ok(!("spawnFailed" in result));
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.ok(sleeper !== null, "the grandchild started before the timeout");
  await assertTreeEnded(sleeper);
});

test("T-2 real: a .cmd that starts a background process with start /b and exits is not a timeout (review F6-3)", { skip: !IS_WINDOWS }, async (t) => {
  const box = sandbox(t);
  if (box === null) return;
  const pidFile = path.join(box.bin, "bg-pid.txt");
  const exitSignal = path.join(box.bin, "exit-now");
  // N-28: no PID is signalled; the background process expires after 4 s. Check that its pipe is
  // still open at the actual cmd exit, then verify the separate 500 ms grace with a controlled clock.
  fs.writeFileSync(
    path.join(box.bin, "sleeper.mjs"),
    LEAVE_SANDBOX + "import fs from 'node:fs'; fs.writeFileSync(process.argv[2], String(process.pid)); setTimeout(() => {}, 4000);\n",
  );
  writeScript(path.join(box.bin, "bgstart.cmd"),
    `start "" /b "${process.execPath}" "%~dp0sleeper.mjs" "${pidFile}"\r\n:wait_for_exit\r\nif not exist "${exitSignal}" goto wait_for_exit\r\nexit /b 0`);
  const command = observeCommand(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // 15 s protects setup only: starting cmd and Node no longer consumes the post-exit budget.
  let settled = false;
  const running = box.runner.run(box.request("bgstart", [], 15_000), live()).then(result => { settled = true; return result; });
  await within((async () => {
    const deadline = Date.now() + 15_000;
    while (!fs.existsSync(pidFile) || fs.readFileSync(pidFile, "utf8").length === 0) {
      if (Date.now() >= deadline) throw new Error("test setup: background child did not become ready");
      await new Promise(resolve => realSetTimeout(resolve, 10));
    }
  })());
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  assert.ok(pid > 0, "the background process started before cmd is allowed to exit");
  fs.writeFileSync(exitSignal, "");
  assert.deepEqual(await command.exit(), { code: 0, signal: null });
  assert.equal(command.child().stdout?.readableEnded, false, "the background child still holds the pipe");
  t.mock.timers.tick(499); await Promise.resolve();
  assert.equal(settled, false, "the inherited pipe stays open for the grace");
  t.mock.timers.tick(1);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, true, "500 ms settles while the background child still holds the pipe");
  const result = await within(running);
  assert.ok(!("spawnFailed" in result), JSON.stringify(result));
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(command.child().stdout?.destroyed, true, "500 ms settles without waiting for the background child");
});

test("T-4 real: an .exe inside the workspace is not started, by path or through PATH", { skip: !IS_WINDOWS }, async (t) => {
  const box = sandbox(t);
  if (box === null) return;
  const tools = path.join(box.ws, "tools");
  fs.mkdirSync(tools);
  const systemRoot = process.env["SystemRoot"] ?? "C:\\Windows";
  // A small harmless system program under the name node.exe (it only prints usage if it ever ran).
  try {
    fs.copyFileSync(path.join(systemRoot, "System32", "where.exe"), path.join(tools, "node.exe"));
  } catch {
    t.skip("cannot copy a system program into the temporary workspace");
    return;
  }
  const runner = createCommandRunner({
    parentEnv: { Path: `${tools};${path.join(systemRoot, "System32")}`, PATHEXT: ".COM;.EXE", SystemRoot: systemRoot },
    workspaceRoot: box.ws,
  });
  for (const executable of ["node", ".\\tools\\node.exe", "tools/node"]) {
    const result = await runner.run(box.request(executable, ["-e", "process.stdout.write('ran')"]), live());
    assert.deepEqual(
      result,
      { spawnFailed: true, message: "could not start process (executable_refused): executables inside the workspace are not run" },
      executable,
    );
  }
  // The same file name outside the workspace still starts.
  const outside = createCommandRunner({
    parentEnv: { Path: path.dirname(process.execPath), PATHEXT: ".COM;.EXE", SystemRoot: systemRoot },
    workspaceRoot: box.ws,
  });
  const ran = await outside.run(box.request("node", ["-e", "process.stdout.write('ran')"]), live());
  assert.ok(!("spawnFailed" in ran), JSON.stringify(ran));
  assert.equal(ran.stdout, "ran");
});
