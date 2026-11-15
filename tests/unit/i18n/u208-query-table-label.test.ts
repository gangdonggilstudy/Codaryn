/**
 * U-208 (P1 bundle A, A-5), a draft until nb-i18n reviews it: the progress label of the new task
 * type tool `query_table`, in both languages, as every tool has one (`tool.<name>`).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MESSAGE_TEXTS } from "../../../src/i18n/index.js";

describe("U-208: the draft label of query_table", () => {
  test("both languages have it, without placeholders, apart from the other tools' labels", () => {
    assert.equal(MESSAGE_TEXTS.en["tool.query_table"], "aggregate a table");
    assert.equal(MESSAGE_TEXTS.ko["tool.query_table"], "표 집계");
    for (const language of ["en", "ko"] as const) {
      const words = MESSAGE_TEXTS[language];
      assert.doesNotMatch(words["tool.query_table"], /[{}]/, language);
      assert.notEqual(words["tool.query_table"], words["tool.read_file"], language);
      assert.notEqual(words["tool.query_table"], words["tool.inspect_files"], language);
    }
  });
});
