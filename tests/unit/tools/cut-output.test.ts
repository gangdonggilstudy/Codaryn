/**
 * V-2 (L1 final review, finding 2; revised by the PM): a stream the runner did not read to its end
 * (pipes closed after the exit grace, time limit, cancel) loses its unfinished last line before the
 * runner returns: the text after the last line break, the whole text without one, at most 4096
 * bytes. A secret split by the cut can only be in that line. Complete lines stay, and `truncated`
 * keeps meaning the capture cap only. Real processes and fake secrets; runs on every OS.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { MAX_COMMAND_OUTPUT_BYTES, PRIVACY_TOKEN_PATTERN_SOURCE } from "../../../src/contracts/index.js";
import type { RawToolOutcome, RunCommandPayload } from "../../../src/contracts/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import {
  MAX_UNFINISHED_LINE_DROP_BYTES,
  createCommandRunner,
  createToolRunner,
  dropUnfinishedLine,
  envValueFreeOfSecrets,
} from "../../../src/tools/index.js";
import type { CommandRunRequest } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

/** Fake secrets, as in the review's repro. Not shaped like any real key. */
const SECRET = "l1fakeTq7Rz2Wm9KxP4v";
const HALF = SECRET.slice(0, 10);
const REST = SECRET.slice(10);
/** A registered secret that spans two lines. */
const MULTI = "fakeML-first-part\nfakeML-second-part";

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

const privacy = () => createPrivacyGateway({ secrets: [SECRET, MULTI] });
const secretFree = envValueFreeOfSecrets(privacy());
const parentEnv = { PATH: path.dirname(process.execPath), SystemRoot: process.env["SystemRoot"] ?? "C:\\Windows" };
/** No value check: the cut is not moved around secrets. */
const bareRunner = (ws: string) => createCommandRunner({ parentEnv, workspaceRoot: ws });
/** As the CLI assembly builds it (src/cli/assemble.ts): with the value check of the run's gateway. */
const cliRunner = (ws: string) =>
  createCommandRunner({ parentEnv, workspaceRoot: ws, allowEnvValue: envValueFreeOfSecrets(privacy()) });
const live = () => new AbortController().signal;

/** No prefix of the secret of 4 characters or more may appear. */
function assertNoSecretPart(text: string, secret = SECRET): void {
  for (let length = 4; length <= secret.length; length += 1) {
    assert.ok(!text.includes(secret.slice(0, length)), `secret prefix of ${length} characters left; text ends ${JSON.stringify(text.slice(-60))}`);
  }
}

async function waitFor(file: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`test setup: ${file} was not written`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Review repro 1 (T-2 grace): the command prints a whole line and exits. A detached background
 * process that inherited stdout writes `bg log: token=<first half>`, and the rest 1.4 s later,
 * after the grace. The command waits until the first half is in the pipe before it exits.
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

/** A command that writes `stdout` (and a whole stderr line), then hangs until it is ended. */
function writeStall(ws: string, stdout: string): { script: string; marker: string } {
  const marker = path.join(ws, "written");
  const script = path.join(ws, "stall.cjs");
  fs.writeFileSync(
    script,
    [
      'process.stderr.write("stall-stderr\\n");',
      `process.stdout.write(${JSON.stringify(stdout)}, () => require("node:fs").writeFileSync(${JSON.stringify(marker)}, ""));`,
      "setInterval(() => {}, 1000);",
    ].join("\n"),
  );
  return { script, marker };
}

async function runTool(ws: string, args: readonly string[], timeoutMs: number, signal = live()): Promise<RawToolOutcome> {
  const workspace = await createWorkspace({ root: ws });
  const tools = createToolRunner({ workspace, privacy: privacy() });
  return tools.execute(
    { id: "c", name: "run_command", args: { executable: process.execPath, args: [...args], timeoutMs } },
    signal,
  );
}

function payloadOf(outcome: RawToolOutcome): RunCommandPayload {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { payload: RunCommandPayload }).payload;
}

function rawOf(result: RunCommandPayload | { spawnFailed: true; message: string }): RunCommandPayload {
  assert.ok(!("spawnFailed" in result), JSON.stringify(result));
  return result;
}

const request = (ws: string, args: readonly string[], timeoutMs: number): CommandRunRequest => ({
  executable: process.execPath,
  args,
  cwdAbsolute: ws,
  timeoutMs,
});

// ---- Review repro 1: pipes closed after the exit grace ----

test("V-2 runner: after the grace, the unfinished line is dropped and the whole line before it stays", async () => {
  const ws = workspaceDir();
  const result = rawOf(await bareRunner(ws).run(request(ws, [writeSplitWriter(ws)], 10_000), live()));
  assert.equal(result.stdout, "started background writer\n");
  assert.equal(result.stderr, "parent-stderr\n");
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.truncated, false, "truncated means the capture cap only");
});

test("V-2 run_command: a line split by a background writer leaves no part of the secret; whole lines stay", async () => {
  const ws = workspaceDir();
  const payload = payloadOf(await runTool(ws, [writeSplitWriter(ws)], 10_000));
  assertNoSecretPart(payload.stdout);
  assert.equal(payload.stdout, "started background writer\n");
  assert.equal(payload.stderr, "parent-stderr\n");
  assert.equal(payload.exitCode, 0);
  assert.equal(payload.timedOut, false);
  assert.equal(payload.truncated, false);
});

// ---- Review repro 2: the time limit ends a command that stopped in the middle of a line ----

test("V-2 runner: a timed-out command loses its unfinished line; short output without a line break is dropped", async () => {
  const ws = workspaceDir();
  const result = rawOf(await bareRunner(ws).run(request(ws, [writeStall(ws, `log: token=${HALF}`).script], 1_500), live()));
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "stall-stderr\n");
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.equal(result.truncated, false);
});

test("V-2 run_command: a timed-out command that stopped inside a secret leaves no part of it", async () => {
  const ws = workspaceDir();
  const payload = payloadOf(await runTool(ws, [writeStall(ws, `log: token=${HALF}`).script], 1_500));
  assertNoSecretPart(payload.stdout);
  assert.equal(payload.stdout, "");
  assert.equal(payload.stderr, "stall-stderr\n");
  assert.equal(payload.timedOut, true);
  assert.equal(payload.truncated, false);
});

test("V-2 run_command: complete lines before the unfinished one stay", async () => {
  const ws = workspaceDir();
  const payload = payloadOf(await runTool(ws, [writeStall(ws, `line1\nline2\nlog: token=${HALF}`).script], 1_500));
  assert.equal(payload.stdout, "line1\nline2\n");
  assert.equal(payload.timedOut, true);
});

test("V-2 runner: at most 4096 bytes of an unfinished line are dropped", async () => {
  const ws = workspaceDir();
  const result = rawOf(await bareRunner(ws).run(request(ws, [writeStall(ws, `head\n${"x".repeat(10_000)}`).script], 1_500), live()));
  assert.equal(result.stdout, `head\n${"x".repeat(10_000 - MAX_UNFINISHED_LINE_DROP_BYTES)}`);
  assert.equal(result.truncated, false);
});

test("V-2: a cut inside a long line never leaves the first part of a secret that is whole in the output", async () => {
  // 5000 + 20 + 4090 bytes without a line break: dropping 4096 bytes would cut the secret after
  // 14 of its 20 characters. Masking recognizes only a whole secret, so the cut moves to its start.
  const ws = workspaceDir();
  const { script } = writeStall(ws, `${"x".repeat(5000)}${SECRET}${"y".repeat(4090)}`);
  const bare = rawOf(await bareRunner(ws).run(request(ws, [script], 1_500), live()));
  assert.equal(bare.stdout, `${"x".repeat(5000)}${SECRET.slice(0, 14)}`, "without the value check the cut is not moved");

  const cli = rawOf(await cliRunner(ws).run(request(ws, [script], 1_500), live()));
  assert.equal(cli.stdout, "x".repeat(5000));
  const payload = payloadOf(await runTool(ws, [script], 1_500));
  assertNoSecretPart(payload.stdout);
  assert.equal(payload.stdout, "x".repeat(5000));
});

// ---- Cancel ----

test("V-2 runner: a cancelled command loses its unfinished line", async () => {
  const ws = workspaceDir();
  const { script, marker } = writeStall(ws, `log: token=${HALF}`);
  const controller = new AbortController();
  const running = bareRunner(ws).run(request(ws, [script], 30_000), controller.signal);
  await waitFor(marker);
  controller.abort();
  const result = rawOf(await running);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "stall-stderr\n");
  assert.equal(result.exitCode, null);
  assert.equal(result.truncated, false);
});

test("V-2 run_command: a cancelled command returns no output at all", async () => {
  const ws = workspaceDir();
  const { script, marker } = writeStall(ws, `log: token=${HALF}`);
  const controller = new AbortController();
  const running = runTool(ws, [script], 30_000, controller.signal);
  await waitFor(marker);
  controller.abort();
  const outcome = await running;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.code, "cancelled");
  assertNoSecretPart(JSON.stringify(outcome));
});

// ---- Output read to its end, and the capture cap ----

test("V-2: output read to its end keeps every byte, also a last line without a line break", async () => {
  const ws = workspaceDir();
  const script = path.join(ws, "done.cjs");
  fs.writeFileSync(script, `process.stdout.write(${JSON.stringify(`done ${SECRET}`)}); process.stderr.write("warn");`);

  const raw = rawOf(await cliRunner(ws).run(request(ws, [script], 10_000), live()));
  assert.equal(raw.stdout, `done ${SECRET}`);
  assert.equal(raw.stderr, "warn");
  assert.equal(raw.truncated, false);

  const payload = payloadOf(await runTool(ws, [script], 10_000));
  assert.match(payload.stdout, new RegExp(`^done ${PRIVACY_TOKEN_PATTERN_SOURCE}$`));
  assert.equal(payload.stderr, "warn");
  assert.equal(payload.truncated, false);
});

test("V-2: the capture cap still sets truncated and keeps the slack rule; the other stream stays whole", async () => {
  const ws = workspaceDir();
  const script = path.join(ws, "flood.cjs");
  fs.writeFileSync(script, 'process.stdout.write("y".repeat(70000)); process.stderr.write("err-tail\\n");');
  const raw = rawOf(await bareRunner(ws).run(request(ws, [script], 10_000), live()));
  assert.equal(raw.truncated, true);
  const payload = payloadOf(await runTool(ws, [script], 10_000));
  assert.equal(payload.stdout, "y".repeat(MAX_COMMAND_OUTPUT_BYTES));
  assert.equal(payload.stderr, "err-tail\n");
  assert.equal(payload.truncated, true);
});

// ---- dropUnfinishedLine ----

test("dropUnfinishedLine: drops the text after the last line break, or all of it without one", () => {
  assert.equal(dropUnfinishedLine(""), "");
  assert.equal(dropUnfinishedLine("partial"), "");
  assert.equal(dropUnfinishedLine("a\nb\npartial"), "a\nb\n");
  assert.equal(dropUnfinishedLine("a\nb\n"), "a\nb\n");
  assert.equal(dropUnfinishedLine("a\r\nb"), "a\r\n");
});

test("dropUnfinishedLine: drops at most 4096 bytes, counted in UTF-8, never half a character", () => {
  assert.equal(MAX_UNFINISHED_LINE_DROP_BYTES, 4096);
  assert.equal(dropUnfinishedLine("x".repeat(4096)), "");
  assert.equal(dropUnfinishedLine("x".repeat(4097)), "x");
  assert.equal(dropUnfinishedLine(`l\n${"x".repeat(4097)}`), "l\nx");
  // 3-byte characters: 1365 of them are 4095 bytes; one more would be 4098.
  assert.equal(dropUnfinishedLine("가".repeat(2000)), "가".repeat(635));
  // 4-byte characters (surrogate pairs): exactly 1024 of them are dropped.
  const emoji = dropUnfinishedLine("😀".repeat(1500));
  assert.equal(emoji, "😀".repeat(476));
  assert.ok(!/[\ud800-\udbff]$/.test(emoji), "no lone high surrogate at the end");
});

test("dropUnfinishedLine: with the value check, a cut inside a whole secret moves to its start", () => {
  const long = `${"x".repeat(5000)}${SECRET}${"y".repeat(4090)}`;
  assert.equal(dropUnfinishedLine(long), `${"x".repeat(5000)}${SECRET.slice(0, 14)}`);
  assert.equal(dropUnfinishedLine(long, secretFree), "x".repeat(5000));

  // A whole secret earlier in the same line stays (masking hides it); only the crossing one moves the cut.
  const two = `a${SECRET}${"x".repeat(5000)}${SECRET}${"y".repeat(4090)}`;
  assert.equal(dropUnfinishedLine(two, secretFree), `a${SECRET}${"x".repeat(5000)}`);
});

test("dropUnfinishedLine: with the value check, a whole multi-line secret around the last line break is dropped from its start", () => {
  const text = `ok\n${MULTI}-tail`;
  assert.equal(dropUnfinishedLine(text), "ok\nfakeML-first-part\n", "without the check its first line would stay");
  assert.equal(dropUnfinishedLine(text, secretFree), "ok\n");
});

test("dropUnfinishedLine: the value check does not move the cut for secrets before it or wholly after it", () => {
  const text = `${SECRET}\nmid\nlast ${SECRET} tail`;
  assert.equal(dropUnfinishedLine(text, secretFree), `${SECRET}\nmid\n`);
  assert.equal(dropUnfinishedLine("plain\npartial", secretFree), "plain\n");
});
