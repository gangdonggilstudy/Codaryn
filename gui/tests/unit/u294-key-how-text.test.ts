/**
 * U-294 (ne-verify's R-113 I-3): the Korean Windows key steps read two ways ("…을 열거나(…) 사용자 변수를
 * 더한 뒤": open it, or add the variable). The English says open the window and add the variable; the
 * Korean now says the same in one order: open the window (by the Start menu or the command) and add the
 * user variable, then start Codaryn again.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";

test("U-294 (R-113 I-3): the Windows key steps say open, then add, in one order", () => {
  const ko = KO["key.how.windows"];
  assert.equal(ko.includes("열거나"), false, "no 'or' between opening the window and adding the variable");
  const open = ko.indexOf("열어");
  const add = ko.indexOf("{env}를 더한 뒤");
  assert.ok(open > 0 && add > open, "the window opened first, then the variable added");
  assert.ok(ko.includes("rundll32 sysdm.cpl,EditEnvironmentVariables") && EN["key.how.windows"].includes("rundll32 sysdm.cpl,EditEnvironmentVariables"));
  assert.ok(/\band add\b/.test(EN["key.how.windows"]));
});
