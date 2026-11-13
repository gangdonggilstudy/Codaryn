/**
 * U-193 (draft id by p5a from nc-human's line after U-176's V-4; p4g and nb-i18n to confirm): what a
 * person is told when a run, a check or a cleanup finished but the workspace lock could not be
 * released. No path (the doctor's lock line names the file), no parameters; it says the next run
 * clears it once Codaryn has closed, and to run codaryn doctor if a run is refused before then.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMessageCatalog, MESSAGE_TEXTS, PLACEHOLDER } from "../../../src/i18n/index.js";

describe("U-193: lock.release_failed", () => {
  test("both languages, no parameter, no path; the next run and codaryn doctor", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.equal(en["lock.release_failed"], "The workspace lock could not be released. The next run clears it once Codaryn has closed; if a run is refused before then, run codaryn doctor.");
    assert.equal(ko["lock.release_failed"], "작업 공간 잠금을 풀지 못했습니다. Codaryn을 모두 닫으면 다음 실행이 정리합니다. 그 전에 실행이 막히면 codaryn doctor로 확인하세요.");
    for (const language of ["en", "ko"] as const) {
      const text = MESSAGE_TEXTS[language]["lock.release_failed"];
      assert.deepEqual([...text.matchAll(PLACEHOLDER)], [], `${language}: no parameter`);
      assert.equal(/lock\.json|\.codaryn/.test(text), false, `${language}: no path`);
      assert.ok(text.includes("codaryn doctor"), `${language}: where to look`);
      assert.equal(createMessageCatalog(language).format("lock.release_failed"), text);
    }
  });
});
