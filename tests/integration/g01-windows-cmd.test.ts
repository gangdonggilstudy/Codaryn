/**
 * G1: running `.cmd`/`.bat` files (npm.cmd and the like) as allowed commands on Windows.
 * Expected behavior, from docs/work-orders/phase-2-repair-loop.md: the executable is found
 * through PATH and PATHEXT, a batch file runs through `cmd.exe /d /s /c`, a path or argument
 * with a cmd metacharacter is not run, and a script that resolves inside the workspace is refused.
 * The refusal code is not fixed by the contract yet, so refusals are judged by `ok: false` and by
 * the shim never running. Windows only; skipped elsewhere.
 */

import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { CommandRule, JournalRecord, RunCommandPayload, ScriptStep, ToolResult } from "../../src/contracts/index.js";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import {
  NODE,
  cliEnv,
  expectRunResult,
  killQuietly,
  payloadOf,
  readRunFiles,
  runTask,
  toolResultFor,
} from "../support/cli.js";
import { callStep, finalStep } from "../support/repair-script.js";
import {
  CMD_INJECTION_MARKER,
  CMD_LOG_FILE,
  CMD_METACHAR_ARGS,
  CMD_PLAIN_ARGS,
  IS_WINDOWS,
  withPathPrefix,
  writeCmdShim,
} from "../support/win-cmd.js";

const SKIP = IS_WINDOWS ? false : "Windows only";
const SHADOW_MARKER = "shadow-ran.txt";

/*
 * Refusal reasons (src/tools/windows-launch.ts). The contract fixes only `spawn_failed`, so the
 * reason is read from the message: code in parentheses plus a phrase. Before T-1 every refusal
 * here came from ROOT_UNKNOWN, which proved nothing about the rule being tested.
 */
const ARGUMENT_REFUSED = "(script_refused): argument 2 has a character outside the set allowed for cmd.exe";
const SCRIPT_INSIDE_REFUSED = "(script_refused): .cmd and .bat files inside the workspace are not run";
const EXECUTABLE_INSIDE_REFUSED = "(executable_refused): executables inside the workspace are not run";
const ROOT_UNKNOWN = "the workspace root is not known";

function assertRefusedFor(result: ToolResult, reason: string): void {
  assert.equal(result.errorCode, "spawn_failed");
  assert.equal(result.content.includes(ROOT_UNKNOWN), false, "refused only because the workspace root was not passed (T-1)");
  assert.ok(result.content.includes(reason), `refused for another reason: ${result.content}`);
}

function allow(executable: string): CommandRule {
  return { executable, argsPrefix: [], allowExtraArgs: true };
}

function runStep(id: string, executable: string, args: readonly string[]): ScriptStep {
  return callStep(id, "run_command", { executable, args: [...args] });
}

function logLines(sb: Sandbox): string[] {
  const file = join(sb.workspace, CMD_LOG_FILE);
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((line) => line !== "") : [];
}

async function runWithPath(
  sb: Sandbox,
  id: string,
  pathDir: string,
  commands: readonly CommandRule[],
  steps: readonly ScriptStep[],
): Promise<readonly JournalRecord[]> {
  const taskPath = writeTask(
    sb,
    {
      id,
      commands,
      limits: { maxModelTurns: 20, maxToolCalls: 20 },
      verifiers: [{ id: "exists", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }],
    },
    [...steps, finalStep("끝")],
  );
  const run = await runTask(taskPath, { cwd: sb.base, env: withPathPrefix(cliEnv(), pathDir) });
  const result = expectRunResult(run);
  return readRunFiles(sb.workspace, result).records;
}

test("G1-a PATH의 .cmd·.bat을 허용 명령으로 실행하고 평범한 인자는 그대로 전달된다", { skip: SKIP, timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 안\n");
  const bin = join(sb.base, "bin");
  writeCmdShim(bin, "fake-npm", ".cmd");
  writeCmdShim(bin, "fake-tool", ".bat");
  const records = await runWithPath(
    sb,
    "g1-a",
    bin,
    [allow("fake-npm"), allow("fake-tool"), allow("fake-npm.cmd")],
    [
      runStep("c-bare", "fake-npm", CMD_PLAIN_ARGS),
      runStep("c-bat", "fake-tool", ["run"]),
      runStep("c-ext", "fake-npm.cmd", ["version"]),
    ],
  );

  for (const id of ["c-bare", "c-bat", "c-ext"]) {
    const payload = payloadOf<RunCommandPayload>(toolResultFor(records, id));
    assert.equal(payload.exitCode, 0, `${id} exit code`);
    assert.ok(payload.stdout.includes("cmd shim ran"), `${id} must reach the shim`);
  }
  assert.deepEqual(
    logLines(sb).map((line) => JSON.parse(line) as string[]),
    [[...CMD_PLAIN_ARGS], ["run"], ["version"]],
    "each call ran once with its arguments unchanged",
  );
});

test("G1-b cmd 메타문자가 든 인자는 실행하지 않는다", { skip: SKIP, timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 안\n");
  const bin = join(sb.base, "bin");
  writeCmdShim(bin, "fake-npm", ".cmd");
  const records = await runWithPath(
    sb,
    "g1-b",
    bin,
    [allow("fake-npm")],
    CMD_METACHAR_ARGS.map(({ label, arg }) => runStep(`c-${label}`, "fake-npm", ["test", arg])),
  );

  for (const { label } of CMD_METACHAR_ARGS) {
    await t.test(label, (st) => {
      const result = toolResultFor(records, `c-${label}`);
      assert.equal(result.ok, false, `an argument with a cmd metacharacter (${label}) must not run`);
      st.diagnostic(`${label}: errorCode ${String(result.errorCode)}`);
      // T-1: refused for the argument itself, not because the workspace root was unknown.
      assertRefusedFor(result, ARGUMENT_REFUSED);
    });
  }
  await t.test("셸도 주입 명령도 실행되지 않았다", () => {
    assert.deepEqual(logLines(sb), [], "the shim must never have run");
    assert.equal(existsSync(join(sb.workspace, CMD_INJECTION_MARKER)), false, "an injected command ran");
  });
});

test("G1-c 작업 공간에 같은 이름의 .cmd가 있어도 그것은 실행되지 않는다", { skip: SKIP, timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 안\n");
  // cmd.exe looks in the current directory before PATH. A model could write this file.
  writeWorkspaceFile(sb, "fake-npm.cmd", `@ECHO OFF\r\nECHO shadow> ${SHADOW_MARKER}\r\n`);
  const bin = join(sb.base, "bin");
  writeCmdShim(bin, "fake-npm", ".cmd");
  const records = await runWithPath(sb, "g1-c", bin, [allow("fake-npm")], [runStep("c-shadow", "fake-npm", ["test"])]);

  assert.equal(existsSync(join(sb.workspace, SHADOW_MARKER)), false, "the workspace copy must never run");
  const result = toolResultFor(records, "c-shadow");
  t.diagnostic(`c-shadow ok=${String(result.ok)} errorCode=${String(result.errorCode)}`);
  // T-1: with the workspace root known, the shim on PATH runs; the copy in the workspace does not.
  assert.equal(result.ok, true, `the shim on PATH must run: ${result.content}`);
  assert.deepEqual(logLines(sb), ['["test"]'], "it was the shim on PATH that ran");
});

test("G1-d PATH가 작업 공간 안을 가리켜 그 안의 스크립트로 풀리면 거부한다", { skip: SKIP, timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 안\n");
  const inside = join(sb.workspace, "tools");
  writeCmdShim(inside, "fake-npm", ".cmd");
  const records = await runWithPath(sb, "g1-d", inside, [allow("fake-npm")], [runStep("c-inside", "fake-npm", ["test"])]);

  const result = toolResultFor(records, "c-inside");
  assert.equal(result.ok, false, "a batch file inside the workspace must be refused");
  t.diagnostic(`c-inside errorCode=${String(result.errorCode)}`);
  assertRefusedFor(result, SCRIPT_INSIDE_REFUSED);
  assert.deepEqual(logLines(sb), [], "the script inside the workspace must never run");
});

test("G1-e T-4 작업 공간 안으로 풀리는 실행 파일(.exe)은 확장자와 관계없이 실행하지 않는다", { skip: SKIP, timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 안\n");
  // A real program the model could have placed: a copy of node.exe inside the workspace.
  const toolsDir = join(sb.workspace, "tools");
  mkdirSync(toolsDir, { recursive: true });
  copyFileSync(NODE, join(toolsDir, "fake-tool.exe"));
  const marker = "exe-ran.txt";
  const probe = ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran")`];
  const records = await runWithPath(
    sb,
    "g1-e",
    toolsDir,
    [allow("fake-tool"), allow("tools/fake-tool.exe"), allow(join(toolsDir, "fake-tool.exe"))],
    [
      runStep("c-path", "fake-tool", probe),
      runStep("c-relative", "tools/fake-tool.exe", probe),
      runStep("c-absolute", join(toolsDir, "fake-tool.exe"), probe),
    ],
  );
  for (const id of ["c-path", "c-relative", "c-absolute"]) {
    const result = toolResultFor(records, id);
    assert.equal(result.ok, false, `${id}: a program inside the workspace must not run`);
    assertRefusedFor(result, EXECUTABLE_INSIDE_REFUSED);
  }
  assert.equal(existsSync(join(sb.workspace, marker)), false, "the program inside the workspace ran");
});

test("T-2 배경 프로세스를 남기고 끝나는 명령은 시간 초과로 보고되지 않는다", { timeout: 120_000 }, async (t) => {
  // Added before createSandbox on purpose: after hooks run in the order they are added, and the
  // sandbox removal ran first, deleted bg.pids and left the detached processes running (and the
  // sandbox, which is their cwd). The processes exit by themselves after 30 s; past 25 s their
  // pids are not killed, since a freed pid may by then belong to another test's process (Z-1).
  let pidsFile: string | undefined;
  const startedAt = Date.now();
  t.after(() => {
    if (pidsFile === undefined || !existsSync(pidsFile) || Date.now() - startedAt > 25_000) return;
    for (const line of readFileSync(pidsFile, "utf8").split("\n")) if (line.trim() !== "") killQuietly(Number(line));
  });
  const sb = createSandbox(t);
  pidsFile = join(sb.workspace, "bg.pids");
  writeWorkspaceFile(sb, "README.md", "# 안\n");
  // Leaves a detached process that holds the inherited stdout and stderr for 30 s, then exits.
  writeWorkspaceFile(
    sb,
    "bg-exit.mjs",
    [
      'import { spawn } from "node:child_process";',
      'import { appendFileSync } from "node:fs";',
      'const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { detached: true, stdio: ["ignore", "inherit", "inherit"] });',
      'appendFileSync("bg.pids", String(child.pid) + "\\n");',
      "child.unref();",
      'console.log("started a background process");',
      "",
    ].join("\n"),
  );
  const taskPath = writeTask(
    sb,
    {
      id: "t2-background",
      commands: [{ executable: NODE, argsPrefix: ["bg-exit.mjs"], allowExtraArgs: false }],
      verifiers: [{ id: "bg", kind: "command", executable: NODE, args: ["bg-exit.mjs"], timeoutMs: 20_000 }],
    },
    [callStep("c-bg", "run_command", { executable: NODE, args: ["bg-exit.mjs"], timeoutMs: 20_000 }), finalStep("끝")],
  );
  const run = await runTask(taskPath, { cwd: sb.base, timeoutMs: 100_000 });
  const result = expectRunResult(run);
  const { records } = readRunFiles(sb.workspace, result);

  const payload = payloadOf<RunCommandPayload>(toolResultFor(records, "c-bg"));
  assert.equal(payload.timedOut, false, "the command itself ended; a background process holding the pipes is not a timeout");
  assert.equal(payload.exitCode, 0);
  assert.ok(payload.stdout.includes("started a background process"));
  assert.equal(result.verifiers.at(-1)?.outcome, "pass", "the same holds for a command verifier");
  assert.equal(result.status, "done");
  assert.ok(run.durationMs < 18_000, `the run took ${run.durationMs} ms; it waited for the background process`);
});
