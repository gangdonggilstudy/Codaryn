/**
 * U-74 (DR-3, DR-10; contract 08cfafd), the CLI's part: the journal gains the in-run permission
 * question, `confirmation_requested` (the masked executable and the number of arguments, never the
 * arguments) and `confirmation_answered` (allow_once, or deny by user, default or cancelled). Without
 * a renderer the English progress lines (src/cli/progress.ts) gave no line for them. Now each has
 * one. In this unit the CLI asks nothing: with no way to ask, the engine denies by default.
 * Made-up records; nothing runs.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { JournalEvent } from "../../../src/contracts/index.js";
import { englishProgressLines, progressLine } from "../../../src/cli/progress.js";

const requested = (extra: Record<string, unknown> = {}): JournalEvent =>
  ({ type: "confirmation_requested", id: "q1", kind: "permission", callId: "c1", tool: "run_command", permission: "command", subject: "npm", argumentCount: 2, ...extra }) as unknown as JournalEvent;
const answered = (decision: string, by: string): JournalEvent => ({ type: "confirmation_answered", id: "q1", decision, by }) as unknown as JournalEvent;

describe("U-74: the English progress lines tell the permission question and its answer", () => {
  test("the question: the tool, the masked executable and the number of arguments, never the arguments", () => {
    assert.equal(progressLine(requested()), "tool run_command: permission question q1 for npm (2 arguments)");
    assert.equal(progressLine(requested({ argumentCount: 1 })), "tool run_command: permission question q1 for npm (1 argument)");
    assert.equal(progressLine(requested({ tool: "no_such_tool" })), "tool (unknown tool): permission question q1 for npm (2 arguments)");
  });

  test("the answer: allowed for this call once, or denied and by whom", () => {
    assert.equal(progressLine(answered("allow_once", "user")), "permission question q1: allowed for this call once");
    assert.equal(progressLine(answered("deny", "user")), "permission question q1: denied (user)");
    assert.equal(progressLine(answered("deny", "default")), "permission question q1: denied (default)");
    assert.equal(progressLine(answered("deny", "cancelled")), "permission question q1: denied (cancelled)");
  });

  test("control characters in the masked executable are cleaned; englishProgressLines gives the same lines", () => {
    const line = progressLine(requested({ subject: "np\u001bm" })) ?? "";
    assert.equal(/[\u0000-\u001f\u007f]/.test(line), false, JSON.stringify(line));
    const lines = englishProgressLines();
    assert.deepEqual(lines(requested()), [progressLine(requested())]);
    assert.deepEqual(lines(answered("deny", "default")), [progressLine(answered("deny", "default"))]);
  });
});
