/**
 * U-180 (DR-69 B-3), drafts until nb-i18n reviews them: the words for the tool `propose_changes`
 * (`tool.propose_changes`, ALL_TOOL_NAMES), beside `tool.propose_plan`.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MESSAGE_TEXTS } from "../../../src/i18n/index.js";

describe("U-180: tool.propose_changes", () => {
  test("both languages have it, without placeholders, and not propose_plan's words", () => {
    assert.equal(MESSAGE_TEXTS.en["tool.propose_changes"], "propose the files to change");
    assert.equal(MESSAGE_TEXTS.ko["tool.propose_changes"], "바꿀 파일 제안");
    for (const language of ["en", "ko"] as const) {
      assert.doesNotMatch(MESSAGE_TEXTS[language]["tool.propose_changes"], /[{}]/, language);
      assert.notEqual(MESSAGE_TEXTS[language]["tool.propose_changes"], MESSAGE_TEXTS[language]["tool.propose_plan"], language);
    }
  });
});
