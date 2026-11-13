/**
 * U-104 (U-99b: UXM-18, AXM-20; PM): the progress lines show the first protected material check
 * that found nothing and fold the later ones; the end summary then says how many checks there were.
 * The renderer shows that line only when no check found a change. The text says how many checks
 * found no change and nothing more: it does not read as if a check that found a change were folded
 * (such a check is always its own progress line).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMessageCatalog, MESSAGE_TEXTS, PLACEHOLDER } from "../../../src/i18n/index.js";

const placeholders = (text: string): string[] => [...text.matchAll(PLACEHOLDER)].map((match) => match[1] as string);

describe("U-104: the summary line of the protected material checks that found no change", () => {
  test("it counts the checks that found no change, in the words of the progress lines", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.equal(en["summary.integrity_unchanged"], "Protected material checks that found no change: {count}");
    assert.equal(ko["summary.integrity_unchanged"], "바뀐 것이 없었던 보호 대상 확인: {count}번");
    // The same name as the progress lines (progress.integrity_unchanged, progress.integrity_changed).
    assert.ok(en["progress.integrity_unchanged"].startsWith("protected material check"));
    assert.ok(ko["progress.integrity_unchanged"].startsWith("보호 대상 확인"));
    for (const language of ["en", "ko"] as const) assert.deepEqual(placeholders(MESSAGE_TEXTS[language]["summary.integrity_unchanged"]), ["count"], language);
    assert.equal(createMessageCatalog("en").format("summary.integrity_unchanged", { count: 3 }), "Protected material checks that found no change: 3");
    assert.equal(createMessageCatalog("ko").format("summary.integrity_unchanged", { count: 3 }), "바뀐 것이 없었던 보호 대상 확인: 3번");
  });

  test("it says nothing of folding, hiding or changes found", () => {
    assert.ok(!/fold|hid|not shown|omit|changed or|not checkable/i.test(MESSAGE_TEXTS.en["summary.integrity_unchanged"]));
    assert.ok(!/접|숨|생략|바뀌었거나|확인할 수 없/.test(MESSAGE_TEXTS.ko["summary.integrity_unchanged"]));
  });
});
