/**
 * U-158 (p4g's draft ids, nb-i18n's texts): the apply summary's line for the folders its actions
 * left without files (GT-D14: they stay in place), and the runs table's words for a run without a
 * result by its phase (AXM-8: still running, or stopped without one). runs.incomplete stays for an
 * entry without a phase; the two say the same as its two cases ("진행 중이거나 중단됨").
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMessageCatalog, MESSAGE_TEXTS, PLACEHOLDER } from "../../../src/i18n/index.js";

const placeholders = (text: string): string[] => [...text.matchAll(PLACEHOLDER)].map((match) => match[1] as string);

describe("U-158: folders left without files, and a run's phase", () => {
  test("the apply summary's line counts the folders and says they stay", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.equal(en["summary.folders_left_empty"], "Folders the actions left without files (kept in place): {count}");
    assert.equal(ko["summary.folders_left_empty"], "동작 뒤 파일이 남지 않은 폴더(그대로 둠): {count}개");
    for (const language of ["en", "ko"] as const) assert.deepEqual(placeholders(MESSAGE_TEXTS[language]["summary.folders_left_empty"]), ["count"], language);
    // The same label: value form as the apply summary's other lines.
    assert.equal(createMessageCatalog("en").format("summary.folders_left_empty", { count: 2 }), "Folders the actions left without files (kept in place): 2");
    assert.equal(createMessageCatalog("ko").format("summary.folders_left_empty", { count: 2 }), "동작 뒤 파일이 남지 않은 폴더(그대로 둠): 2개");
    // A folder is not removed: the words say so, and never "removed" or "deleted".
    assert.ok(!/remov|delet/i.test(en["summary.folders_left_empty"]));
    assert.ok(!/지움|지웠|삭제/.test(ko["summary.folders_left_empty"]));
  });

  test("a run without a result: running, or stopped without one, in the words of runs.incomplete", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.equal(en["runs.running"], "running");
    assert.equal(ko["runs.running"], "진행 중");
    assert.equal(en["runs.no_result"], "stopped without a result");
    assert.equal(ko["runs.no_result"], "결과 없이 중단됨");
    for (const id of ["runs.running", "runs.no_result"] as const) {
      for (const language of ["en", "ko"] as const) assert.deepEqual(placeholders(MESSAGE_TEXTS[language][id]), [], `${language} ${id}`);
    }
    // runs.incomplete, for an entry without a phase, names both cases with the same words.
    assert.equal(ko["runs.incomplete"], "결과 없음(진행 중이거나 중단됨)");
    assert.ok(ko["runs.incomplete"].includes(ko["runs.running"]) && ko["runs.no_result"].endsWith("중단됨"));
    assert.ok(en["runs.incomplete"].includes(en["runs.running"]) && en["runs.no_result"].startsWith("stopped"));
  });
});
