/**
 * A1: a small code fix in a temporary folder runs to the end with the scripted model.
 * Judged by exit code, stdout JSON, file bytes, journal and result.json only.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { RunCommandPayload } from "../../src/contracts/index.js";
import { createSandbox, nodeCommand, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import { writeProgram } from "../fixtures/programs.js";
import {
  NODE,
  countRecords,
  expectRunResult,
  payloadOf,
  readRunFiles,
  runTask,
  sha256Hex,
  toolResultFor,
} from "../support/cli.js";

const MATH_BUG = "export function add(a, b) {\n  return a - b;\n}\n";
const MATH_FIXED = "export function add(a, b) {\n  return a + b;\n}\n";

test("A1 code task: read, fix, run allowed command, verify -> done", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "src/math.mjs", MATH_BUG);
  writeProgram(sb, "check-add.mjs");

  const taskPath = writeTask(
    sb,
    {
      id: "a01-code",
      goal: "src/math.mjs의 add 버그를 고친다",
      workflow: "code",
      commands: [nodeCommand("check-add.mjs")],
      verifiers: [{ id: "check", kind: "command", executable: NODE, args: ["check-add.mjs"], expectExitCode: 0 }],
    },
    [
      { toolCalls: [{ id: "r1", name: "read_file", args: { path: "src/math.mjs" } }] },
      {
        toolCalls: [
          {
            id: "w1",
            name: "write_file",
            args: {
              path: "src/math.mjs",
              expectedHash: sha256Hex(MATH_BUG),
              change: { kind: "replace_text", oldText: "return a - b;", newText: "return a + b;" },
            },
          },
        ],
      },
      { toolCalls: [{ id: "c1", name: "run_command", args: { executable: NODE, args: ["check-add.mjs"] } }] },
      { text: "수정했고 확인 명령을 실행했다" },
    ],
  );

  const run = await runTask(taskPath, { cwd: sb.base });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);

  assert.equal(run.exitCode, 0);
  assert.equal(result.status, "done");
  assert.equal(result.reason, "verified");
  assert.equal(readFileSync(join(sb.workspace, "src", "math.mjs"), "utf8"), MATH_FIXED);

  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0]?.previousHash, sha256Hex(MATH_BUG));
  assert.equal(result.changes[0]?.newHash, sha256Hex(MATH_FIXED));
  assert.equal(result.changes[0]?.created, false);

  assert.equal(result.verifiers.length, 1);
  assert.equal(result.verifiers[0]?.outcome, "pass");
  assert.ok((result.verifiers[0]?.checked.length ?? 0) >= 1, "verifier must state what it checked");
  assert.ok(Array.isArray(result.verifiers[0]?.limits), "verifier must state its limits (may be empty)");

  const command = payloadOf<RunCommandPayload>(toolResultFor(files.records, "c1"));
  assert.equal(command.exitCode, 0);
  assert.equal(command.timedOut, false);

  assert.equal(countRecords(files.records, "file_changed"), 1);
  assert.equal(countRecords(files.records, "verifier_result"), 1);
  assert.equal(result.usage.modelTurns, 4);
  assert.equal(result.usage.toolCalls, 3);
});
