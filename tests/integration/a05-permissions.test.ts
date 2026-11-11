/**
 * A5: permissions are judged independently. Commands off the allow list, extra or different
 * args, a disallowed cwd, overwriting without a version and unknown tools are refused.
 * Each refused call is shown to have had no effect.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createSandbox, nodeCommand, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import { writeProgram } from "../fixtures/programs.js";
import {
  NODE,
  assertRefused,
  deniedDecision,
  expectRunResult,
  readRunFiles,
  runTask,
  toolResultFor,
} from "../support/cli.js";

const KEEP = "지우면 안 되는 내용\r\n";

test("A5 independent permission checks and no destructive actions", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "keep.txt", KEEP);
  writeProgram(sb, "ok-log.mjs");
  writeProgram(sb, "evil.mjs");

  const taskPath = writeTask(
    sb,
    {
      id: "a05-permissions",
      commands: [nodeCommand("ok-log.mjs")],
      verifiers: [{ id: "keep", kind: "file_rules", rules: [{ type: "exists", path: "keep.txt" }] }],
    },
    [
      {
        toolCalls: [
          { id: "c-cmd", name: "run_command", args: { executable: "cmd.exe", args: ["/c", "echo x> marker-cmd.txt"] } },
        ],
      },
      { toolCalls: [{ id: "c-evil", name: "run_command", args: { executable: NODE, args: ["evil.mjs"] } }] },
      { toolCalls: [{ id: "c-extra", name: "run_command", args: { executable: NODE, args: ["ok-log.mjs", "extra"] } }] },
      {
        toolCalls: [
          {
            id: "c-eval",
            name: "run_command",
            args: { executable: NODE, args: ["-e", "require('fs').rmSync('keep.txt')"] },
          },
        ],
      },
      { toolCalls: [{ id: "c-cwd", name: "run_command", args: { executable: NODE, args: ["ok-log.mjs"], cwd: ".." } }] },
      {
        toolCalls: [
          {
            id: "c-lower",
            name: "run_command",
            args: { executable: "cmd.exe", args: ["/c", "echo x> marker-lower.txt"], requires: { command: false } },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "w-over",
            name: "write_file",
            args: { path: "keep.txt", expectedHash: null, change: { kind: "replace_all", content: "덮어쓰기\n" } },
          },
        ],
      },
      { toolCalls: [{ id: "d-del", name: "delete_file", args: { path: "keep.txt" } }] },
      { toolCalls: [{ id: "c-ok", name: "run_command", args: { executable: NODE, args: ["ok-log.mjs"] } }] },
      { text: "끝" },
    ],
  );

  const run = await runTask(taskPath, { cwd: sb.base });
  const result = expectRunResult(run);
  const { records } = readRunFiles(sb.workspace, result);

  await t.test("allowed path, denied command", () => {
    assertRefused(records, "c-cmd", ["policy_denied"]);
    const decision = deniedDecision(records, "c-cmd");
    assert.equal(decision.permission, "command");
    assert.equal(decision.code, "command_not_allowed");
    assert.equal(existsSync(join(sb.workspace, "marker-cmd.txt")), false);
  });

  await t.test("allowed executable, args off the rule", () => {
    for (const id of ["c-evil", "c-extra", "c-eval"]) {
      assertRefused(records, id, ["policy_denied"]);
      const decision = deniedDecision(records, id);
      assert.equal(decision.permission, "command");
      assert.equal(decision.code, "args_not_allowed");
    }
    assert.equal(existsSync(join(sb.workspace, "marker-evil.txt")), false);
  });

  await t.test("allowed command, denied path (cwd outside the root)", () => {
    assertRefused(records, "c-cwd", ["policy_denied"]);
    assert.equal(deniedDecision(records, "c-cwd").permission, "path");
    assert.equal(existsSync(join(sb.base, "ok-log.txt")), false);
  });

  await t.test("extra fields cannot lower fixed requirements", () => {
    assertRefused(records, "c-lower", ["policy_denied", "invalid_args"]);
    assert.equal(existsSync(join(sb.workspace, "marker-lower.txt")), false);
  });

  await t.test("no overwrite without version and no delete tool", () => {
    assertRefused(records, "w-over", ["conflict"]);
    assertRefused(records, "d-del", ["unknown_tool"]);
    assert.deepEqual(readFileSync(join(sb.workspace, "keep.txt")), Buffer.from(KEEP, "utf8"));
  });

  await t.test("the allowed command ran exactly once with exact args", () => {
    assert.equal(toolResultFor(records, "c-ok").ok, true);
    const log = readFileSync(join(sb.workspace, "ok-log.txt"), "utf8");
    assert.equal(log, "[]\n");
  });

  await t.test("refusals do not end the run", () => {
    assert.equal(result.status, "done");
    assert.equal(result.changes.length, 0);
  });
});
