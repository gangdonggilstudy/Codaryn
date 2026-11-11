/**
 * A8: limits end the run as budget-exhausted; `--cancel-file` ends it as cancelled, keeps
 * applied changes, and the command's child and grandchild processes stop. Workspace lock
 * behaviour (P-4) is checked here too.
 * On Windows, `child.kill()` from another process ends the CLI without running its handlers,
 * so cancellation is only exercised through the cancel file (P-2).
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { LOCK_FILE_NAME, STATE_DIR_NAME } from "../../src/contracts/index.js";
import { createSandbox, nodeCommand, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import { writeProgram } from "../fixtures/programs.js";
import {
  NODE,
  countRecords,
  expectCliError,
  expectRunResult,
  isProcessAlive,
  killQuietly,
  lockPath,
  readLiveRecords,
  readRunFiles,
  runTask,
  startTask,
  waitFor,
} from "../support/cli.js";

const README_RULE = { id: "readme", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] } as const;

test("A8 maxModelTurns -> budget-exhausted, no further model turns", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# a\n");
  const read = (id: string) => ({ toolCalls: [{ id, name: "read_file", args: { path: "README.md" } }] });
  const taskPath = writeTask(sb, { id: "a08-turns", limits: { maxModelTurns: 2 }, verifiers: [README_RULE] }, [
    read("r1"),
    read("r2"),
    read("r3"),
    read("r4"),
    { text: "끝" },
  ]);
  const run = await runTask(taskPath, { cwd: sb.base });
  const result = expectRunResult(run);
  const { records } = readRunFiles(sb.workspace, result);
  assert.equal(result.status, "budget-exhausted");
  assert.equal(result.reason, "max_model_turns");
  assert.equal(run.exitCode, 4);
  assert.ok(result.usage.modelTurns <= 2);
  assert.ok(countRecords(records, "model_response") <= 2);
});

test("A8 maxToolCalls -> budget-exhausted, extra calls not executed", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  writeProgram(sb, "ok-log.mjs");
  const call = (id: string) => ({ id, name: "run_command", args: { executable: NODE, args: ["ok-log.mjs"] } });
  const taskPath = writeTask(
    sb,
    { id: "a08-tools", limits: { maxToolCalls: 1 }, commands: [nodeCommand("ok-log.mjs")], verifiers: [README_RULE] },
    [{ toolCalls: [call("c1"), call("c2"), call("c3")] }, { toolCalls: [call("c4")] }, { text: "끝" }],
  );
  const run = await runTask(taskPath, { cwd: sb.base });
  const result = expectRunResult(run);
  readRunFiles(sb.workspace, result);
  assert.equal(result.status, "budget-exhausted");
  assert.equal(result.reason, "max_tool_calls");
  assert.ok(result.usage.toolCalls <= 1);
  const logPath = join(sb.workspace, "ok-log.txt");
  const executed = existsSync(logPath) ? readFileSync(logPath, "utf8").split("\n").filter(Boolean).length : 0;
  assert.ok(executed <= 1, `executed ${executed} commands with maxToolCalls 1`);
});

test("A8 maxTotalTokens exceeded and unknown usage -> budget-exhausted", { timeout: 60_000 }, async (t) => {
  await t.test("reported usage over the limit", async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "README.md", "# a\n");
    const taskPath = writeTask(sb, { id: "a08-tokens", limits: { maxTotalTokens: 1000 }, verifiers: [README_RULE] }, [
      {
        usage: { inputTokens: 700, outputTokens: 700 },
        toolCalls: [{ id: "r1", name: "read_file", args: { path: "README.md" } }],
      },
      { usage: { inputTokens: 10, outputTokens: 10 }, text: "끝" },
    ]);
    const result = expectRunResult(await runTask(taskPath, { cwd: sb.base }));
    assert.equal(result.status, "budget-exhausted");
    assert.equal(result.reason, "max_total_tokens");
    assert.equal(result.usage.modelTurns, 1);
  });

  await t.test("usage unknown with a token limit", async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "README.md", "# a\n");
    const taskPath = writeTask(sb, { id: "a08-unknown", limits: { maxTotalTokens: 1000 }, verifiers: [README_RULE] }, [
      { toolCalls: [{ id: "r1", name: "read_file", args: { path: "README.md" } }] },
      { text: "끝" },
    ]);
    const result = expectRunResult(await runTask(taskPath, { cwd: sb.base }));
    assert.equal(result.status, "budget-exhausted");
    assert.equal(result.reason, "usage_unknown");
    assert.equal(result.usage.modelTurns, 1, "no model call may follow a response without usage");
    assert.equal(result.usage.inputTokens, null);
  });
});

test("A8 maxDurationMs -> budget-exhausted", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# a\n");
  const taskPath = writeTask(sb, { id: "a08-duration", limits: { maxDurationMs: 1000 }, verifiers: [README_RULE] }, [
    { delayMs: 8000, text: "늦은 답" },
  ]);
  const run = await runTask(taskPath, { cwd: sb.base });
  const result = expectRunResult(run);
  assert.equal(result.status, "budget-exhausted");
  assert.equal(result.reason, "max_duration");
});

test("A8 cancel during a model wait keeps applied changes and releases the lock", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  const taskPath = writeTask(sb, { id: "a08-cancel-wait", verifiers: [README_RULE] }, [
    {
      toolCalls: [
        {
          id: "w1",
          name: "write_file",
          args: { path: "made.txt", expectedHash: null, change: { kind: "replace_all", content: "적용됨\n" } },
        },
      ],
    },
    { delayMs: 60_000, text: "오지 않는 답" },
  ]);
  const started = startTask(taskPath, { cwd: sb.base, cancelFile: sb.cancelFile });
  await waitFor(
    () => readLiveRecords(sb.workspace).some((record) => record.type === "file_changed"),
    15_000,
    "file_changed in journal",
  );
  writeFileSync(sb.cancelFile, "cancel");
  const cancelAt = Date.now();
  const run = await started.done;
  const result = expectRunResult(run);
  readRunFiles(sb.workspace, result);

  assert.equal(result.status, "cancelled");
  assert.equal(result.reason, "cancelled");
  assert.equal(run.exitCode, 5);
  assert.ok(Date.now() - cancelAt < 15_000, "the CLI must stop soon after the cancel file appears");
  assert.equal(result.changes.length, 1, "applied changes are listed, not rolled back");
  assert.equal(readFileSync(join(sb.workspace, "made.txt"), "utf8"), "적용됨\n");
  assert.equal(existsSync(lockPath(sb.workspace)), false, "the lock must be released");
});

test("A8 cancel while a command runs stops the child and the grandchild", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeProgram(sb, "spawn-tree.mjs");
  writeProgram(sb, "grandchild.mjs");
  const taskPath = writeTask(
    sb,
    { id: "a08-cancel-tree", commands: [nodeCommand("spawn-tree.mjs")], verifiers: [README_RULE] },
    [
      {
        toolCalls: [
          { id: "c1", name: "run_command", args: { executable: NODE, args: ["spawn-tree.mjs"], timeoutMs: 120_000 } },
        ],
      },
      { text: "끝" },
    ],
  );

  const started = startTask(taskPath, { cwd: sb.base, cancelFile: sb.cancelFile, timeoutMs: 60_000 });
  const pidFile = (name: string) => join(sb.workspace, name);
  await waitFor(
    () => existsSync(pidFile("child.pid")) && existsSync(pidFile("grandchild.pid")) && existsSync(pidFile("heartbeat.txt")),
    20_000,
    "child and grandchild started",
  );
  const childPid = Number(readFileSync(pidFile("child.pid"), "utf8"));
  const grandchildPid = Number(readFileSync(pidFile("grandchild.pid"), "utf8"));
  t.after(() => {
    killQuietly(childPid);
    killQuietly(grandchildPid);
  });

  writeFileSync(sb.cancelFile, "cancel");
  const run = await started.done;
  const result = expectRunResult(run);
  readRunFiles(sb.workspace, result);

  await t.test("run is cancelled", () => {
    assert.equal(result.status, "cancelled");
    assert.equal(run.exitCode, 5);
  });

  await t.test("direct child process stopped", async () => {
    await waitFor(() => !isProcessAlive(childPid), 10_000, `child ${childPid} stopped`);
  });

  await t.test("grandchild process stopped (process tree cleanup)", async () => {
    await waitFor(() => !isProcessAlive(grandchildPid), 10_000, `grandchild ${grandchildPid} stopped`);
    const before = readFileSync(pidFile("heartbeat.txt"), "utf8");
    await delay(1000);
    assert.equal(readFileSync(pidFile("heartbeat.txt"), "utf8"), before, "heartbeat must stop");
  });

  await t.test("lock released", () => {
    assert.equal(existsSync(lockPath(sb.workspace)), false);
  });
});

test("A8 workspace lock: a second run is refused; a dead lock is recovered", { timeout: 90_000 }, async (t) => {
  await t.test("live lock -> workspace_locked", async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "README.md", "# a\n");
    const taskPath = writeTask(sb, { id: "a08-lock", verifiers: [README_RULE] }, [{ delayMs: 60_000, text: "끝" }]);
    const first = startTask(taskPath, { cwd: sb.base, cancelFile: sb.cancelFile });
    await waitFor(() => existsSync(lockPath(sb.workspace)), 15_000, "lock.json created");

    const second = await runTask(taskPath, { cwd: sb.base });
    expectCliError(second, "workspace_locked");
    assert.equal(second.exitCode, 6);

    writeFileSync(sb.cancelFile, "cancel");
    const result = expectRunResult(await first.done);
    assert.equal(result.status, "cancelled");
  });

  await t.test("lock of a dead process is recovered", async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "README.md", "# a\n");
    const dead = spawn(NODE, ["-e", ""], { stdio: "ignore" });
    const deadPid = dead.pid;
    await new Promise<void>((resolve) => dead.once("exit", () => resolve()));
    assert.ok(deadPid !== undefined && !isProcessAlive(deadPid));
    mkdirSync(join(sb.workspace, STATE_DIR_NAME), { recursive: true });
    writeFileSync(
      join(sb.workspace, STATE_DIR_NAME, LOCK_FILE_NAME),
      JSON.stringify({ pid: deadPid, runId: "20000101T000000Z-deadbeef", startedAt: "2000-01-01T00:00:00Z" }),
    );
    const taskPath = writeTask(sb, { id: "a08-stale-lock", verifiers: [README_RULE] }, [{ text: "끝" }]);
    const result = expectRunResult(await runTask(taskPath, { cwd: sb.base }));
    assert.equal(result.status, "done");
    assert.equal(existsSync(lockPath(sb.workspace)), false);
  });
});
