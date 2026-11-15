/**
 * A4: effective paths outside the root (after `..`, absolute paths and junctions) are refused,
 * and the state directory is unreachable. Junction cases are skipped, not passed, when a
 * junction cannot be created.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ScriptStep } from "../../src/contracts/index.js";
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

const OUTSIDE_MARKER = "OUTSIDE-MARKER-7f3c";
const ESCAPE_CODES = ["outside_root", "invalid_path"];

test("A4 path escapes are refused without side effects", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  const outsideDir = join(sb.base, "outside");
  mkdirSync(outsideDir);
  const outsideFile = join(outsideDir, "secret.txt");
  writeFileSync(outsideFile, `${OUTSIDE_MARKER}\n`);
  writeWorkspaceFile(sb, "README.md", "# 안\n");
  writeProgram(sb, "ok-log.mjs");

  let junction = true;
  try {
    symlinkSync(outsideDir, join(sb.workspace, "link"), "junction");
  } catch (error) {
    junction = false;
    t.diagnostic(`junction could not be created: ${String(error)}`);
  }

  const steps: ScriptStep[] = [
    { toolCalls: [{ id: "r-up", name: "read_file", args: { path: "../outside/secret.txt" } }] },
    { toolCalls: [{ id: "r-abs", name: "read_file", args: { path: outsideFile } }] },
    {
      toolCalls: [
        {
          id: "w-up",
          name: "write_file",
          args: { path: "../escape.txt", expectedHash: null, change: { kind: "replace_all", content: "x" } },
        },
      ],
    },
    { toolCalls: [{ id: "r-state", name: "read_file", args: { path: ".codaryn/lock.json" } }] },
    {
      toolCalls: [
        {
          id: "w-state",
          name: "write_file",
          args: { path: ".codaryn/injected.txt", expectedHash: null, change: { kind: "replace_all", content: "x" } },
        },
      ],
    },
    { toolCalls: [{ id: "s-root", name: "search_files", args: { path: ".", text: OUTSIDE_MARKER } }] },
  ];
  if (junction) {
    steps.push(
      { toolCalls: [{ id: "r-link", name: "read_file", args: { path: "link/secret.txt" } }] },
      {
        toolCalls: [
          {
            id: "w-link",
            name: "write_file",
            args: { path: "link/new.txt", expectedHash: null, change: { kind: "replace_all", content: "x" } },
          },
        ],
      },
      { toolCalls: [{ id: "s-link", name: "search_files", args: { path: "link", text: OUTSIDE_MARKER } }] },
      {
        toolCalls: [
          { id: "c-link", name: "run_command", args: { executable: NODE, args: ["ok-log.mjs"], cwd: "link" } },
        ],
      },
    );
  }
  steps.push({ text: "끝" });

  const taskPath = writeTask(
    sb,
    {
      id: "a04-paths",
      commands: [nodeCommand("ok-log.mjs")],
      verifiers: [{ id: "readme", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }],
    },
    steps,
  );

  const run = await runTask(taskPath, { cwd: sb.base });
  const result = expectRunResult(run);
  const { records } = readRunFiles(sb.workspace, result);

  await t.test("refused calls do not end the run", () => {
    assert.equal(result.status, "done");
    assert.equal(result.changes.length, 0);
  });

  await t.test("parent traversal and absolute paths", () => {
    for (const id of ["r-up", "r-abs", "w-up"]) {
      assertRefused(records, id, ["policy_denied"]);
      const decision = deniedDecision(records, id);
      assert.equal(decision.permission, "path");
      assert.ok(ESCAPE_CODES.includes(String(decision.code)), `${id}: ${String(decision.code)}`);
    }
    assert.equal(existsSync(join(sb.base, "escape.txt")), false);
  });

  await t.test("state directory", () => {
    for (const id of ["r-state", "w-state"]) {
      assertRefused(records, id, ["policy_denied"]);
      assert.equal(deniedDecision(records, id).code, "state_dir");
    }
    assert.equal(existsSync(join(sb.workspace, ".codaryn", "injected.txt")), false);
  });

  await t.test("search does not reveal outside content", () => {
    const search = toolResultFor(records, "s-root");
    assert.equal(search.content.includes(OUTSIDE_MARKER), false);
  });

  await t.test("junction to a directory outside the root", (st) => {
    if (!junction) {
      st.skip("junction could not be created on this machine");
      return;
    }
    for (const id of ["r-link", "w-link"]) {
      assertRefused(records, id, ["policy_denied"]);
      assert.equal(deniedDecision(records, id).code, "outside_root");
    }
    const linkSearch = toolResultFor(records, "s-link");
    assert.equal(linkSearch.content.includes(OUTSIDE_MARKER), false, "search must not follow the junction");
    assertRefused(records, "c-link", ["policy_denied"]);
    assert.equal(existsSync(join(outsideDir, "new.txt")), false);
    assert.equal(existsSync(join(outsideDir, "ok-log.txt")), false);
  });

  await t.test("no tool result carries outside file content", () => {
    // The marker legitimately appears in the search arguments the model sent, so only
    // tool results are checked here.
    for (const record of records) {
      if (record.type !== "tool_result") continue;
      assert.equal(record.result.content.includes(OUTSIDE_MARKER), false, `call ${record.result.callId}`);
    }
  });
});
