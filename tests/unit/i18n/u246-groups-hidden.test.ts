/**
 * U-246 (review R-110 L-2; draft for nb-i18n): the hidden-groups line of the end summary ended "the agent
 * got only how many groups were left out", which is not so for a value left out from fewer than k cells
 * (the agent got that group, with the value empty). Its last sentence now holds for both.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMessageCatalog } from "../../../src/i18n/index.js";

describe("U-246: summary.groups_hidden says what the agent got, for groups and for values", () => {
  test("English", () => {
    assert.equal(
      createMessageCatalog("en").format("summary.groups_hidden", { results: 3, k: 5 }),
      "Groups of fewer than 5 rows, or values from fewer cells than that, were left out of 3 table result(s); the agent got neither those groups nor those values, only how many groups were left out and which values were empty.",
    );
  });

  test("Korean", () => {
    assert.equal(
      createMessageCatalog("ko").format("summary.groups_hidden", { results: 3, k: 5 }),
      "5행 미만인 묶음이나 그보다 적은 칸으로 셈한 값을 표 결과 3건에서 뺐습니다. 에이전트는 그 묶음도 그 값도 받지 않았고, 뺀 묶음의 개수와 어느 값이 비었는지만 받았습니다.",
    );
  });
});
