/**
 * U-154 (PM): U-139's two draft texts (the runs table's local start header, an apply run's plan)
 * and U-131's three (changes of a plan run), checked in both languages. Kept as they are but one:
 * the Korean changes.plan_only says "직접" as revert.plan_only does (both English texts say
 * "changed no file itself").
 * U-154b (PM): runs.apply_of says "applies the plan of run X"; changes.plan_apply_other says where
 * the apply stands (it is shown for an apply that is not done, which may still be running), with
 * the English words of src/cli/changes.ts (used without a catalog) and docs/usage.md:1305 alike.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { createMessageCatalog, MESSAGE_TEXTS, PLACEHOLDER } from "../../../src/i18n/index.js";

const placeholders = (text: string): string[] => [...text.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
const IDS = ["runs.column.started_local", "runs.apply_of", "changes.plan_only", "changes.plan_applied", "changes.plan_apply_other"] as const;

describe("U-154: U-139's and U-131's texts", () => {
  test("a plan run that changed no file itself: the same words as revert's", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.equal(ko["changes.plan_only"], "이 실행은 계획만 만들었고 파일을 직접 바꾸지 않았습니다.");
    assert.ok(ko["revert.plan_only"].startsWith("이 실행은 계획만 만들었고 파일을 직접 바꾸지 않아"));
    assert.ok(en["changes.plan_only"].startsWith("This run only made a plan and changed no file itself"));
    assert.ok(en["revert.plan_only"].startsWith("This run only made a plan and changed no file itself"));
  });

  test("both languages take the same values; a run id is never followed by a particle that changes with its last sound", () => {
    for (const id of IDS) {
      assert.deepEqual(placeholders(MESSAGE_TEXTS.ko[id]), placeholders(MESSAGE_TEXTS.en[id]), id);
      assert.ok(!/\{runId\}(이|가|을|를|은|는|으로|로)/.test(MESSAGE_TEXTS.ko[id]), id);
    }
  });

  test("the runs headers say which clock, in both languages", () => {
    const ko = createMessageCatalog("ko");
    const en = createMessageCatalog("en");
    assert.equal(en.format("runs.column.run_id"), "run id (UTC)");
    assert.equal(en.format("runs.column.started_local"), "started (local)");
    assert.equal(ko.format("runs.column.run_id"), "실행 id (UTC)");
    assert.equal(ko.format("runs.column.started_local"), "시작 (지역 시간)");
  });

  test("U-154b: an apply run's plan, and where an apply that is not done stands", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.equal(en["runs.apply_of"], "applies the plan of run {runId}");
    assert.equal(ko["runs.apply_of"], "실행 {runId}의 계획 적용");
    assert.equal(en["changes.plan_apply_other"], "An apply run took up its plan: {runId}; codaryn runs shows where that apply stands.");
    assert.equal(ko["changes.plan_apply_other"], "그 계획을 맡은 적용 실행: {runId}. 그 적용이 어떤 상태인지는 codaryn runs가 보여 줍니다.");
    for (const text of [en["changes.plan_apply_other"], ko["changes.plan_apply_other"]]) assert.ok(!/ended|끝났는지/.test(text), text);
  });

  test("U-154b: changes.ts's English words (used without a catalog) say what the English catalog says", () => {
    const source = readFileSync(new URL("../../../../src/cli/changes.ts", import.meta.url), "utf8");
    const [before, after] = MESSAGE_TEXTS.en["changes.plan_apply_other"].split("{runId}");
    const expected = "`" + String(before) + "${cleanText(applyRunId)}" + String(after) + "`";
    assert.ok(source.includes(expected), `src/cli/changes.ts has no ${expected}`);
  });
});
