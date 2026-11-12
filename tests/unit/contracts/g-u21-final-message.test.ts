/**
 * U-21 (DR-47, AXM-1): the agent's last message reaches people. The result carries the masked text
 * of the run's last final reply, cut at MAX_FINAL_MESSAGE_CHARS, only when there is one; the end
 * summary and the report put a label first that says it is the agent's words, not a verified fact.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FIXED_MESSAGES, MAX_FINAL_MESSAGE_CHARS } from "../../../src/contracts/index.js";
import type { EngineResult, MaskedText, ReportOutput } from "../../../src/contracts/index.js";

describe("U-21: the agent's last message in the result and the report", () => {
  test("the field, present only when there is a message, and its limit", () => {
    const said: Pick<EngineResult, "status" | "finalMessage"> = {
      status: "needs-input",
      finalMessage: { text: "I could not change a.txt because it is protected. Please confirm." as MaskedText, truncated: false },
    };
    const silent: Pick<EngineResult, "status" | "finalMessage"> = { status: "done" };
    assert.deepEqual([said.finalMessage?.truncated, Object.hasOwn(silent, "finalMessage")], [false, false]);
    assert.equal(MAX_FINAL_MESSAGE_CHARS, 2000);
  });

  test("the report carries it with the result it already holds", () => {
    const report: Pick<ReportOutput, "result"> = { result: null };
    const message: NonNullable<EngineResult["finalMessage"]> | undefined = report.result?.finalMessage;
    assert.equal(message, undefined);
  });

  test("the labels: the agent's words, not a verified fact", () => {
    assert.deepEqual(FIXED_MESSAGES["summary.final_message"], {});
    assert.deepEqual(FIXED_MESSAGES["summary.final_message_truncated"], { count: "count" });
    assert.deepEqual(FIXED_MESSAGES["report.final_message"], {});
  });
});
