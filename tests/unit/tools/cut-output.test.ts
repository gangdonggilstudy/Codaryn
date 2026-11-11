/**
 * V-2 (L1 final review, finding 2): output the runner did not read to its end is marked as cut,
 * and run_command then keeps no part of a registered secret that the cut split in two.
 * Cut means: the pipes were closed after the exit grace (T-2), the time limit ended the command,
 * or a cancel did. Output read to its end stays `truncated: false`.
 * Real processes with fake secrets; runs on every OS.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { MAX_COMMAND_OUTPUT_BYTES, PRIVACY_TOKEN_PATTERN_SOURCE } from "../../../src/contracts/index.js";
import type { RawToolOutcome, RunCommandPayload } from "../../../src/contracts/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { COMMAND_CAPTURE_SLACK_BYTES, createCommandRunner, createToolRunner } from "../../../src/tools/index.js";
import type { CommandRunRequest } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { createFakeCommandRunner } from "./doubles.js";

/** Fake secret, as in the review's repro. Not shaped like any real key. */
const SECRET = "l1fakeTq7Rz2Wm9KxP4v";
const HALF = SECRET.slice(0, 10);
const REST = SECRET.slice(10);
const TOKEN = new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE);

const dirs: string[] = [];
const pidFiles: string[] = [];
after(() => {
  for (const file of pidFiles) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const pid = Number(line.trim());
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid);
        } catch {
          // Already gone.
        }
      }
    }
  }
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function workspaceDir(): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-v2-")));
  dirs.push(dir);
  return dir;
}

const systemRoot = process.env["SystemRoot"] ?? "C:\\Windows";
const runner = (ws: string) =>
  createCommandRunner({ parentEnv: { PATH: path.dirname(process.execPath), SystemRoot: systemRoot }, workspaceRoot: ws });
const live = () => new AbortController().signal;

interface CutStreams {
  readonly stdout: boolean;
  readonly stderr: boolean;
}
const cutStreamsOf = (result: object): CutStreams | undefined => (result as { cutStreams?: CutStreams }).cutStreams;

/** No prefix of the secret of 4 characters or more may appear. */
function assertNoSecretPart(text: string): void {
  for (let length = 4; length <= SECRET.length; length += 1) {
    assert.ok(!text.includes(SECRET.slice(0, length)), `secret prefix of ${length} characters left; text ends ${JSON.stringify(text.slice(-60))}`);
  }
}

/** Waits until `file` exists: the script writes it once the first half is in the pipe. */
async function waitFor(file: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`test setup: ${file} was not written`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Review repro 1 (T-2 grace): the command exits at once. A detached background process that
 * inherited stdout writes `bg log: token=<first half>`, and the rest 1.4 s later, after the grace.
 * The command waits until the first half is in the pipe before it exits. Its own stderr is not
 * inherited by the background process, so stderr reaches its end.
 */
function writeSplitWriter(ws: string): string {
  const marker = path.join(ws, "half-written");
  const pids = path.join(ws, "bg.pids");
  pidFiles.push(pids);
  const body = [
    `process.stdout.write(${JSON.stringify(`bg log: token=${HALF}`)}, () => require("node:fs").writeFileSync(${JSON.stringify(marker)}, ""));`,
    `setTimeout(() => process.stdout.write(${JSON.stringify(`${REST}\n`)}), 1400);`,
    "setTimeout(() => {}, 3000);",
  ].join(" ");
  const script = path.join(ws, "bg-split.cjs");
  fs.writeFileSync(
    script,
    [
      'const { spawn } = require("node:child_process");',
      'const fs = require("node:fs");',
      `const child = spawn(process.execPath, ["-e", ${JSON.stringify(body)}], { detached: true, stdio: ["ignore", "inherit", "ignore"], cwd: require("node:os").tmpdir() });`,
      `fs.appendFileSync(${JSON.stringify(pids)}, String(child.pid) + "\\n");`,
      "child.unref();",
      'process.stdout.write("started background writer\\n");',
      'process.stderr.write("parent-stderr\\n");',
      "const deadline = Date.now() + 10000;",
      `while (!fs.existsSync(${JSON.stringify(marker)}) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);`,
      "process.exit(0);",
    ].join("\n"),
  );
  return script;
}

/** Review repro 2 (time limit): the command writes `log: token=<first half>` and stops there. */
function writeStall(ws: string): { script: string; marker: string } {
  const marker = path.join(ws, "half-written");
  const script = path.join(ws, "stall.cjs");
  fs.writeFileSync(
    script,
    [
      `process.stdout.write(${JSON.stringify(`log: token=${HALF}`)}, () => require("node:fs").writeFileSync(${JSON.stringify(marker)}, ""));`,
      'process.stderr.write("stall-stderr\\n");',
      "setInterval(() => {}, 1000);",
    ].join("\n"),
  );
  return { script, marker };
}

async function runTool(ws: string, args: readonly string[], timeoutMs: number, signal = live()): Promise<RawToolOutcome> {
  const workspace = await createWorkspace({ root: ws });
  const tools = createToolRunner({ workspace, privacy: createPrivacyGateway({ secrets: [SECRET] }) });
  return tools.execute(
    { id: "c", name: "run_command", args: { executable: process.execPath, args: [...args], timeoutMs } },
    signal,
  );
}

function payloadOf(outcome: RawToolOutcome): RunCommandPayload {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { payload: RunCommandPayload }).payload;
}

const request = (ws: string, args: readonly string[], timeoutMs: number): CommandRunRequest => ({
  executable: process.execPath,
  args,
  cwdAbsolute: ws,
  timeoutMs,
});

// ---- Review repro 1: pipes closed after the exit grace ----

test("V-2 runner: pipes closed after the grace mark the held stream cut; a stream that ended is not", async () => {
  const ws = workspaceDir();
  const result = await runner(ws).run(request(ws, [writeSplitWriter(ws)], 10_000), live());
  assert.ok(!("spawnFailed" in result), JSON.stringify(result));
  assert.ok(result.stdout.includes(`bg log: token=${HALF}`), "test setup: the first half reached the capture");
  assert.ok(!result.stdout.includes(REST), "test setup: the rest came after the grace");
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.truncated, true);
  assert.deepEqual(cutStreamsOf(result), { stdout: true, stderr: false });
  assert.equal(result.stderr, "parent-stderr\n");
});

test("V-2 run_command: a line split by a background writer leaves no part of the secret", async () => {
  const ws = workspaceDir();
  const payload = payloadOf(await runTool(ws, [writeSplitWriter(ws)], 10_000));
  assertNoSecretPart(payload.stdout);
  assert.equal(payload.exitCode, 0);
  assert.equal(payload.timedOut, false);
  assert.equal(payload.truncated, true);
  assert.equal(payload.stderr, "parent-stderr\n", "a stream read to its end is kept whole");
});

// ---- Review repro 2: the time limit ends a command that stopped in the middle of a line ----

test("V-2 runner: a command ended at its time limit has both streams marked cut", async () => {
  const ws = workspaceDir();
  const result = await runner(ws).run(request(ws, [writeStall(ws).script], 1_500), live());
  assert.ok(!("spawnFailed" in result), JSON.stringify(result));
  assert.ok(result.stdout.includes(`log: token=${HALF}`), "test setup: the first half reached the capture");
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.equal(result.truncated, true);
  assert.deepEqual(cutStreamsOf(result), { stdout: true, stderr: true });
});

test("V-2 run_command: a timed-out command that stopped inside a secret leaves no part of it", async () => {
  const ws = workspaceDir();
  const payload = payloadOf(await runTool(ws, [writeStall(ws).script], 1_500));
  assertNoSecretPart(payload.stdout);
  assert.equal(payload.timedOut, true);
  assert.equal(payload.truncated, true);
});

// ---- Cancel ----

test("V-2 runner: a command ended by a cancel has both streams marked cut", async () => {
  const ws = workspaceDir();
  const { script, marker } = writeStall(ws);
  const controller = new AbortController();
  const running = runner(ws).run(request(ws, [script], 30_000), controller.signal);
  await waitFor(marker);
  controller.abort();
  const result = await running;
  assert.ok(!("spawnFailed" in result), JSON.stringify(result));
  assert.ok(result.stdout.includes(`log: token=${HALF}`), "test setup: the first half reached the capture");
  assert.equal(result.exitCode, null);
  assert.equal(result.timedOut, false);
  assert.equal(result.truncated, true);
  assert.deepEqual(cutStreamsOf(result), { stdout: true, stderr: true });
});

test("V-2 run_command: a cancelled command returns no output at all", async () => {
  const ws = workspaceDir();
  const { script, marker } = writeStall(ws);
  const controller = new AbortController();
  const running = runTool(ws, [script], 30_000, controller.signal);
  await waitFor(marker);
  controller.abort();
  const outcome = await running;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.code, "cancelled");
  assertNoSecretPart(JSON.stringify(outcome));
});

// ---- Output read to its end ----

test("V-2: output read to its end stays truncated: false and keeps every byte", async () => {
  const ws = workspaceDir();
  const script = path.join(ws, "done.cjs");
  fs.writeFileSync(script, `process.stdout.write(${JSON.stringify(`done ${SECRET}\n`)}); process.stderr.write("warn\\n");`);

  const raw = await runner(ws).run(request(ws, [script], 10_000), live());
  assert.ok(!("spawnFailed" in raw), JSON.stringify(raw));
  assert.equal(raw.truncated, false);
  assert.deepEqual(cutStreamsOf(raw), { stdout: false, stderr: false });

  const payload = payloadOf(await runTool(ws, [script], 10_000));
  assert.match(payload.stdout, new RegExp(`^done ${PRIVACY_TOKEN_PATTERN_SOURCE}\\n$`));
  assert.equal(payload.stderr, "warn\n");
  assert.equal(payload.truncated, false);
  assert.equal(payload.exitCode, 0);
});

test("V-2: a capture cap on stdout marks only stdout cut; stderr is kept whole", async () => {
  const ws = workspaceDir();
  const script = path.join(ws, "flood.cjs");
  fs.writeFileSync(script, 'process.stdout.write("y".repeat(70000)); process.stderr.write("err-tail\\n");');

  const raw = await runner(ws).run(request(ws, [script], 10_000), live());
  assert.ok(!("spawnFailed" in raw), JSON.stringify(raw));
  assert.equal(raw.truncated, true);
  assert.deepEqual(cutStreamsOf(raw), { stdout: true, stderr: false });

  const payload = payloadOf(await runTool(ws, [script], 10_000));
  assert.equal(payload.stderr, "err-tail\n");
  assert.equal(payload.stdout, "y".repeat(MAX_COMMAND_OUTPUT_BYTES));
  assert.equal(payload.truncated, true);
});

// ---- The masking rule for a cut stream (fake runner) ----

test("V-2 run_command: the last slack bytes of a cut stream are dropped, the rest is kept", async () => {
  const ws = workspaceDir();
  const stdout = `${"a".repeat(10_000)}\nlog: token=${HALF}`;
  const workspace = await createWorkspace({ root: ws });
  const tools = createToolRunner({
    workspace,
    privacy: createPrivacyGateway({ secrets: [SECRET] }),
    commandRunner: createFakeCommandRunner(async () => ({ exitCode: null, stdout, stderr: "", timedOut: true, truncated: true })),
  });
  const payload = payloadOf(
    await tools.execute({ id: "c", name: "run_command", args: { executable: "node", args: [] } }, live()),
  );
  assertNoSecretPart(payload.stdout);
  assert.equal(payload.stdout, "a".repeat(Buffer.byteLength(stdout) - COMMAND_CAPTURE_SLACK_BYTES));
  assert.equal(payload.truncated, true);
});

test("V-2 run_command: per-stream marks from the runner leave a stream that was not cut whole", async () => {
  const ws = workspaceDir();
  const workspace = await createWorkspace({ root: ws });
  const tools = createToolRunner({
    workspace,
    privacy: createPrivacyGateway({ secrets: [SECRET] }),
    commandRunner: createFakeCommandRunner(
      async () =>
        ({
          exitCode: 0,
          stdout: `bg log: token=${HALF}`,
          stderr: `kept ${SECRET}\n`,
          timedOut: false,
          truncated: true,
          cutStreams: { stdout: true, stderr: false },
        }) as RunCommandPayload,
    ),
  });
  const payload = payloadOf(
    await tools.execute({ id: "c", name: "run_command", args: { executable: "node", args: [] } }, live()),
  );
  assert.equal(payload.stdout, "");
  assert.match(payload.stderr, new RegExp(`^kept ${TOKEN.source}\\n$`));
  assert.equal(payload.truncated, true);
  assert.equal(Object.hasOwn(payload, "cutStreams"), false, "the tool payload keeps the contract shape");
});
