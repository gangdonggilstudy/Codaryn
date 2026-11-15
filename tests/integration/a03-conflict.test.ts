/**
 * A3: a write to a file that changed after it was read is refused, and the user's bytes stay.
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import {
  assertRefused,
  countRecords,
  expectRunResult,
  hasToolResult,
  readLiveRecords,
  readRunFiles,
  sha256Hex,
  startTask,
  runTask,
  waitFor,
} from "../support/cli.js";

const ORIGINAL = "원본 줄\n";
const USER_EDIT = "원본 줄\n사용자가 덧붙인 줄\n";

test("A3 file changed by the user between read and write -> conflict, user bytes kept", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  const note = writeWorkspaceFile(sb, "note.txt", ORIGINAL);

  const taskPath = writeTask(
    sb,
    {
      id: "a03-race",
      verifiers: [{ id: "agent-wrote", kind: "file_rules", rules: [{ type: "contains", path: "note.txt", text: "에이전트" }] }],
    },
    [
      { toolCalls: [{ id: "r1", name: "read_file", args: { path: "note.txt" } }] },
      {
        delayMs: 4000,
        toolCalls: [
          {
            id: "w1",
            name: "write_file",
            args: {
              path: "note.txt",
              expectedHash: sha256Hex(ORIGINAL),
              change: { kind: "replace_all", content: "에이전트 덮어쓰기\n" },
            },
          },
        ],
      },
      { text: "끝" },
    ],
  );

  const started = startTask(taskPath, { cwd: sb.base });
  await waitFor(() => hasToolResult(readLiveRecords(sb.workspace), "r1"), 15_000, "read_file result in journal");
  writeFileSync(note, USER_EDIT);

  const run = await started.done;
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);

  assertRefused(files.records, "w1", ["conflict"]);
  assert.deepEqual(readFileSync(join(sb.workspace, "note.txt")), Buffer.from(USER_EDIT, "utf8"));
  assert.equal(result.changes.length, 0);
  assert.equal(countRecords(files.records, "file_changed"), 0);
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "verifier_failed");
});

test("A3 stale expectedHash (file edited before the run) -> conflict for both change kinds", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "note.txt", USER_EDIT);

  const taskPath = writeTask(
    sb,
    {
      id: "a03-stale",
      verifiers: [{ id: "unchanged", kind: "file_rules", rules: [{ type: "not_contains", path: "note.txt", text: "에이전트" }] }],
    },
    [
      {
        toolCalls: [
          {
            id: "w-all",
            name: "write_file",
            args: { path: "note.txt", expectedHash: sha256Hex(ORIGINAL), change: { kind: "replace_all", content: "에이전트\n" } },
          },
          {
            id: "w-text",
            name: "write_file",
            args: {
              path: "note.txt",
              expectedHash: sha256Hex(ORIGINAL),
              change: { kind: "replace_text", oldText: "원본 줄", newText: "에이전트 줄" },
            },
          },
        ],
      },
      { text: "끝" },
    ],
  );

  const run = await runTask(taskPath, { cwd: sb.base });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);

  assertRefused(files.records, "w-all", ["conflict"]);
  assertRefused(files.records, "w-text", ["conflict"]);
  assert.deepEqual(readFileSync(join(sb.workspace, "note.txt")), Buffer.from(USER_EDIT, "utf8"));
  assert.equal(result.changes.length, 0);
  assert.equal(result.status, "done");
});
