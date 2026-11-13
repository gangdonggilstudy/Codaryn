/**
 * U-175 (DR-69 B-2), drafts until nb-i18n reviews them: the words for the denial `path_not_writable`
 * in both languages, beside `denial.protected_path`. They name the rule, never a path.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMessageCatalog, MESSAGE_TEXTS } from "../../../src/i18n/index.js";

describe("U-175: denial.path_not_writable", () => {
  test("both languages have it, without placeholders", () => {
    assert.equal(MESSAGE_TEXTS.en["denial.path_not_writable"], "not among the files this task may write");
    assert.equal(MESSAGE_TEXTS.ko["denial.path_not_writable"], "쓰기 허용 경로 밖");
    for (const language of ["en", "ko"] as const) {
      assert.doesNotMatch(MESSAGE_TEXTS[language]["denial.path_not_writable"], /[{}]/, language);
      assert.equal(createMessageCatalog(language).format("denial.path_not_writable", {}), MESSAGE_TEXTS[language]["denial.path_not_writable"]);
    }
  });

  test("it is not the protected path's words", () => {
    for (const language of ["en", "ko"] as const) {
      assert.notEqual(MESSAGE_TEXTS[language]["denial.path_not_writable"], MESSAGE_TEXTS[language]["denial.protected_path"], language);
    }
  });
});
