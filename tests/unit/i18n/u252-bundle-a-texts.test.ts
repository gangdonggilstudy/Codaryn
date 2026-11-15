/**
 * U-252 (PM): bundle A's texts (U-207's, U-210's and U-208's drafts) made final in both languages.
 * - The summary's refused calls say "denied", as the other summary lines do, at the paths of the
 *   denial word (denial.unreadable_path: "a path this task may not read" / "읽기 제외 경로").
 * - The hint promises aggregation only where the task type has the query_table tool (R-110 L-1:
 *   a task type without it still read as if it had it).
 * - A table query's progress line has the progress lines' form, "<tool word> — what": the tool word
 *   is tool.query_table's ("aggregate a table" / "표 집계"); the renderer adds the operation codes.
 * - analyze-private's checklist item ends in "-습니다" (PM); its English equals PRIVATE_REVIEW_ITEM.
 * - doctor's refusal reads "실행은 이를 거부합니다"; its English (the JSON message) stays.
 * The three error hints the GUI copies (error.hint.unreadable_paths_required, _with_commands,
 * min_group_size_range) are not changed here: a GUI test holds the window's copies equal to them.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { messageParams, PRIVATE_REVIEW_ITEM } from "../../../src/contracts/index.js";
import type { MessageId } from "../../../src/contracts/index.js";
import { MESSAGE_TEXTS } from "../../../src/i18n/index.js";

const IDS = [
  "summary.denied_unreadable",
  "summary.denied_unreadable_hint",
  "summary.groups_hidden",
  "review.item.no_identifying_values",
  "progress.query_table",
  "progress.query_table_whole",
  "progress.query_table_describe",
  "doctor.commands.unreadable_with_commands",
] as const satisfies readonly MessageId[];

describe("U-252: bundle A's texts, final", () => {
  test("the summary's refused calls: denied, at paths this task may not read", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.equal(en["summary.denied_unreadable"], "Calls denied at paths this task may not read: {count}");
    assert.equal(ko["summary.denied_unreadable"], "읽기 제외 경로라 거부된 호출: {count}건");
    assert.ok(ko["summary.denied_unreadable"].startsWith(ko["denial.unreadable_path"]));
  });

  test("the hint promises query_table only where the task type has the tool (R-110 L-1)", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.match(en["summary.denied_unreadable_hint"], /a task type with the query_table tool can still aggregate their tables/);
    assert.match(ko["summary.denied_unreadable_hint"], /query_table 도구가 있는 작업 종류라면 그 아래의 표를 집계할 수 있습니다/);
    assert.ok(!/it can still aggregate|에이전트는 query_table로/.test(en["summary.denied_unreadable_hint"] + ko["summary.denied_unreadable_hint"]));
  });

  test("a table query's progress line: the tool word, a dash, what was asked", () => {
    const { en, ko } = MESSAGE_TEXTS;
    for (const id of ["progress.query_table", "progress.query_table_whole", "progress.query_table_describe"] as const) {
      assert.ok(en[id].startsWith(`${en["tool.query_table"]} — `), `${id}: ${en[id]}`);
      assert.ok(ko[id].startsWith(`${ko["tool.query_table"]} — `), `${id}: ${ko[id]}`);
    }
  });

  test("the hidden groups: what was left out first, in Korean", () => {
    assert.ok(MESSAGE_TEXTS.ko["summary.groups_hidden"].startsWith("{k}행 미만인 묶음이나 그보다 적은 칸으로 셈한 값을 표 결과 {results}건에서 뺐습니다."));
  });

  test("analyze-private's item ends in -습니다; its English is the definition's constant", () => {
    assert.equal(MESSAGE_TEXTS.ko["review.item.no_identifying_values"], "결과 표와 보고서에 한 사람을 알아볼 수 있는 값이 없습니다.");
    assert.equal(MESSAGE_TEXTS.en["review.item.no_identifying_values"], PRIVATE_REVIEW_ITEM);
  });

  test("doctor's refusal reads 실행은 이를 거부합니다; counts only in every text", () => {
    assert.ok(MESSAGE_TEXTS.ko["doctor.commands.unreadable_with_commands"].endsWith("실행은 이를 거부합니다"));
    for (const id of IDS) for (const kind of Object.values(messageParams(id))) assert.equal(kind, "count", id);
  });
});
