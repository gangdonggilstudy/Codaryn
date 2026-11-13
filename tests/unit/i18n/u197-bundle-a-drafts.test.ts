/**
 * U-197 (P1 bundle A), drafts until nb-i18n reviews them (A-4): the words for the new denial code
 * `unreadable_path` and the tool error codes `too_many_groups` and `invalid_table`, in both
 * languages. They name the rule, never a path or a cell.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MESSAGE_TEXTS } from "../../../src/i18n/index.js";

const IDS = ["denial.unreadable_path", "denial.too_many_groups", "denial.invalid_table"] as const;

describe("U-197: draft words for bundle A's codes", () => {
  test("both languages have them, without placeholders", () => {
    assert.deepEqual(
      IDS.map((id) => MESSAGE_TEXTS.en[id]),
      ["a path this task may not read", "too many groups", "the table cannot be used"],
    );
    assert.deepEqual(
      IDS.map((id) => MESSAGE_TEXTS.ko[id]),
      ["읽기 제외 경로", "묶음이 너무 많음", "쓸 수 없는 표"],
    );
    for (const language of ["en", "ko"] as const) for (const id of IDS) assert.doesNotMatch(MESSAGE_TEXTS[language][id], /[{}]/, `${language} ${id}`);
  });

  test("the read denial is not the write denials' words", () => {
    for (const language of ["en", "ko"] as const) {
      const words = MESSAGE_TEXTS[language];
      assert.notEqual(words["denial.unreadable_path"], words["denial.protected_path"], language);
      assert.notEqual(words["denial.unreadable_path"], words["denial.path_not_writable"], language);
    }
  });
});
