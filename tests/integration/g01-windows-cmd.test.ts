/**
 * G1: running `.cmd`/`.bat` files (npm.cmd and the like) as allowed commands on Windows.
 * Expected behavior, from docs/work-orders/phase-2-repair-loop.md: the executable is found
 * through PATH and PATHEXT, a batch file runs through `cmd.exe /d /s /c`, a path or argument
 * with a cmd metacharacter is not run, and a script that resolves inside the workspace is refused.
 * The refusal code is not fixed by the contract yet, so refusals are judged by `ok: false` and by
 * the shim never running. Windows only; skipped elsewhere.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { CommandRule, JournalRecord, RunCommandPayload, ScriptStep } from "../../src/contracts/index.js";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { cliEnv, expectRunResult, payloadOf, readRunFiles, runTask, toolResultFor } from "../support/cli.js";
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
  if (result.ok) assert.deepEqual(logLines(sb), ['["test"]'], "if it ran, it was the shim on PATH");
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
  assert.deepEqual(logLines(sb), [], "the script inside the workspace must never run");
});
