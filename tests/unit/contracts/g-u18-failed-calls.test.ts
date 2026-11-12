/**
 * U-18 (AXM-4): a call the policy allowed and that then failed said only "allowed", and the end
 * summary counted only the denied calls. PM: Q-1 (a) a result that succeeded has no line, only a
 * failure is told; Q-2 (a) a command that exited with a code other than 0 or timed out is one progress
 * line and not a failed call; Q-3 the report changes its text only, `report --json` stays.
 *
 * The contract's part: the message ids, RunSummaryContext.failedToolCalls and the one definition of
 * a failed call that the progress line, the summary count and the report share. The renderer's
 * cases are nc-human's (tests/unit/cli/human/u18-tool-failed.test.ts).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FIXED_MESSAGES, MESSAGE_IDS, messageParams, TOOL_ERROR_CODES } from "../../../src/contracts/index.js";
import type { MessageParamTypeByKind, ReportJournalSummary, RunSummaryContext, ToolErrorCode } from "../../../src/contracts/index.js";

describe("U-18: a failed call and a command that did not end well are told", () => {
  test("the four ids and their parameters", () => {
    const wanted = {
      "progress.tool_failed": { tool: "text", code: "denial" },
      "progress.command_exited": { exitCode: "count" },
      "progress.command_timed_out": {},
      "summary.failed": { count: "count" },
    } as const;
    const ids = MESSAGE_IDS as readonly string[];
    for (const [id, params] of Object.entries(wanted)) {
      assert.equal(ids.filter((entry) => entry === id).length, 1, id);
      assert.ok(Object.hasOwn(FIXED_MESSAGES, id), id);
      assert.deepEqual(messageParams(id as keyof typeof FIXED_MESSAGES), params, id);
    }
  });

  test("the failure's code is a tool error code, which the denial kind takes, as for a rejected call", () => {
    assert.deepEqual(messageParams("progress.tool_failed"), { tool: messageParams("progress.tool_rejected")["tool"], code: messageParams("progress.tool_rejected")["code"] });
    for (const code of TOOL_ERROR_CODES) {
      const taken: MessageParamTypeByKind["denial"] = code satisfies ToolErrorCode;
      assert.equal(taken, code);
    }
  });

  test("the summary context carries the failed calls, as it carries the denied ones", () => {
    const context: RunSummaryContext = {
      workspaceForm: "given",
      configDefault: null,
      profileApplied: false,
      deniedToolCalls: 1,
      deniedCommandCalls: 0,
      failedToolCalls: 4,
      policySource: "config",
    };
    assert.equal(context.failedToolCalls, 4);
    // @ts-expect-error every caller says how many calls failed (0 when none)
    const missing: RunSummaryContext = { workspaceForm: "given", configDefault: null, profileApplied: false, deniedToolCalls: 0, deniedCommandCalls: 0, policySource: "config" };
    assert.equal(missing.deniedToolCalls, 0);
  });

  test("Q-3: report --json does not change, so the report's journal summary has no new field", () => {
    const added: "failedToolCalls" extends keyof ReportJournalSummary ? true : false = false;
    assert.equal(added, false);
  });
});
