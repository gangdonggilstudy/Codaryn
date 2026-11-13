/**
 * U-241 (U-239 row 5, PM): the Korean name of writablePaths is "쓰기 허용 경로", as the GUI says it
 * (plan check, the widening names), so the CLI's denial word says "쓰기 허용 경로 밖". The English
 * ("not among the files this task may write") already says the same.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MESSAGE_TEXTS } from "../../../src/i18n/index.js";

describe("U-241: writablePaths in Korean", () => {
  test("the denial word names the writable paths", () => {
    assert.equal(MESSAGE_TEXTS.ko["denial.path_not_writable"], "쓰기 허용 경로 밖");
    assert.equal(MESSAGE_TEXTS.en["denial.path_not_writable"], "not among the files this task may write");
  });

  test("no Korean text keeps the old name", () => {
    for (const [id, text] of Object.entries(MESSAGE_TEXTS.ko)) assert.ok(!text.includes("쓰기를 허용한 파일"), id);
  });
});
