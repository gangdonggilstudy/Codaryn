/**
 * IR-E1 (review E): the human texts of state_dir_not_plain in both languages (the PM-approved
 * drafts): what is wrong and that nothing was written, then how to fix it. Read through string keys
 * so the test is the same before and after the texts exist.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { MESSAGE_TEXTS } from "../../../src/i18n/index.js";

const en = MESSAGE_TEXTS.en as Readonly<Record<string, string | undefined>>;
const ko = MESSAGE_TEXTS.ko as Readonly<Record<string, string | undefined>>;

test("IR-E1: state_dir_not_plain says what is wrong and that nothing was written (en, ko)", () => {
  assert.match(en["error.state_dir_not_plain.what"] ?? "", /\.codaryn.*runs.*link, a junction or not a plain directory; nothing was written/);
  assert.match(ko["error.state_dir_not_plain.what"] ?? "", /\.codaryn.*runs.*링크·junction이거나 일반 폴더가 아닙니다\. 아무것도 쓰지 않았습니다/);
});

test("IR-E1: state_dir_not_plain tells how to fix it (en, ko)", () => {
  assert.match(en["error.state_dir_not_plain.fix"] ?? "", /Remove the link or make it a plain directory, then run again/);
  assert.match(ko["error.state_dir_not_plain.fix"] ?? "", /링크를 지우거나 일반 폴더로 바꾼 뒤 다시 실행하세요/);
});
