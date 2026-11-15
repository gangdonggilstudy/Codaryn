/**
 * U-267 (p5a's U-250 for the app's run events): the CLI's English progress lines, used when no
 * renderer is given (englishProgressLines, progressLine), named a tool only when it was one of the
 * four built-in ones (TOOL_NAMES). The task type tools (inspect_files, propose_plan, propose_changes,
 * query_table) came out as "(unknown tool)", unlike the renderer's lines, which know every tool name.
 * Now the English lines name every tool a task may list (ALL_TOOL_NAMES); a name in no list, or one a
 * model wrote, is still "(unknown tool)". The renderer and its lines are as before.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ALL_TOOL_NAMES, WORKFLOW_TOOL_NAMES } from "../../../src/contracts/index.js";
import type { JournalEvent } from "../../../src/contracts/index.js";
import { englishProgressLines, progressLine } from "../../../src/cli/progress.js";

const decision = (tool: string, allowed: boolean): JournalEvent =>
  ({ type: "tool_decision", callId: "c1", tool, stage: "check", allowed, permission: allowed ? null : "path", code: allowed ? null : "path_outside" }) as unknown as JournalEvent;
const failed = (tool: string): JournalEvent =>
  ({ type: "tool_result", result: { callId: "c2", tool, ok: false, content: "error (not_found): x", errorCode: "not_found" } }) as unknown as JournalEvent;

describe("U-267: the English progress lines name the task type tools", () => {
  test("a decision on each task type tool names it, allowed or denied", () => {
    assert.ok(WORKFLOW_TOOL_NAMES.length > 0);
    for (const tool of WORKFLOW_TOOL_NAMES) {
      assert.equal(progressLine(decision(tool, true)), `tool ${tool}: allowed`);
      assert.equal(progressLine(decision(tool, false)), `tool ${tool}: denied (path/path_outside)`);
    }
  });

  test("without a renderer, a failed task type tool call names it too", () => {
    const lines = englishProgressLines();
    assert.deepEqual(lines(decision("query_table", true)), ["tool query_table: allowed"]);
    assert.deepEqual(lines(failed("query_table")), ["tool query_table: failed (not_found)"]);
  });

  test("every name a task may list is named; a name in no list stays unknown", () => {
    for (const tool of ALL_TOOL_NAMES) assert.equal(progressLine(decision(tool, true)), `tool ${tool}: allowed`);
    assert.equal(progressLine(decision("no_such_tool", true)), "tool (unknown tool): allowed");
  });
});
