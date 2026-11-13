/**
 * U-34 (UXM-7 ①, AXM-22; the U-19 survey, section 3 A): the lines of `cleanup` that were fixed
 * English get message ids, so a Korean cleanup tells in Korean how to confirm and that removed
 * records can no longer be reverted. The size of an item, the outcome that removed nothing, the
 * next-step lines of a preview, and the names of the three kinds of item.
 *
 * G-A (0a9f9ec): no message takes a digest. The renderer puts the options to type, the plan
 * digest's first MIN_PLAN_DIGEST_PREFIX characters among them, after the text on the same line.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CLEANUP_TARGETS, FIXED_MESSAGES, MESSAGE_IDS, messageParams } from "../../../src/contracts/index.js";
import type { CleanupItemRef, CleanupTarget, MessageId, MessageParamKind } from "../../../src/contracts/index.js";

const SENTENCES: { readonly [id: string]: { readonly [param: string]: MessageParamKind } } = {
  "cleanup.size": { files: "count", bytes: "count" },
  "cleanup.nothing_removed": {},
};

describe("U-34: the cleanup lines that were English have message ids", () => {
  // U-86 retired the preview's six next steps (cleanup.next.*): the groups and two commands replace them.
  test("the size and the outcome that removed nothing, with counts only", () => {
    const ids = MESSAGE_IDS as readonly string[];
    for (const [id, params] of Object.entries(SENTENCES)) {
      assert.ok(ids.includes(id), id);
      assert.ok(Object.hasOwn(FIXED_MESSAGES, id), id);
      assert.deepEqual(messageParams(id as MessageId), params, id);
    }
  });

  test("no cleanup line takes a digest or any text: the renderer puts the options after it (G-A)", () => {
    for (const id of MESSAGE_IDS.filter((entry) => entry.startsWith("cleanup."))) {
      for (const kind of Object.values(messageParams(id))) assert.equal(kind, "count", `${id}: ${kind}`);
    }
  });

  test("the three kinds of item have a name each, the targets of CleanupItemRef", () => {
    assert.deepEqual([...CLEANUP_TARGETS], ["run", "discarded", "leftover"]);
    const ids = MESSAGE_IDS as readonly string[];
    for (const target of CLEANUP_TARGETS) {
      const id: MessageId = `cleanup.target.${target}`;
      assert.ok(ids.includes(id), id);
      assert.deepEqual(messageParams(id), {});
    }
    const refTarget: CleanupTarget = ({ target: "leftover", leftoverId: "0123456789abcdef" } satisfies CleanupItemRef).target;
    assert.ok(CLEANUP_TARGETS.includes(refTarget));
  });

  test("each id is listed once", () => {
    const wanted = [...Object.keys(SENTENCES), ...CLEANUP_TARGETS.map((target) => `cleanup.target.${target}`)];
    for (const id of wanted) assert.equal(MESSAGE_IDS.filter((entry) => entry === id).length, 1, id);
  });
});
