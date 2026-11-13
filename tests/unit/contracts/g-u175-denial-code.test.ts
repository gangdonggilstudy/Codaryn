/**
 * U-175 (DR-69 B-2): the policy denial code for a write outside the run's writable lists,
 * `path_not_writable` (permission `path`), with its model hint and its words. It comes last in
 * POLICY_DENIAL_CODES, so the order of the codes before it is unchanged.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MESSAGE_IDS, POLICY_DENIAL_CODES, REFUSAL_HINTS, messageParams } from "../../../src/contracts/index.js";
import type { MessageId } from "../../../src/contracts/index.js";

describe("U-175: path_not_writable", () => {
  test("a denial code, added last", () => {
    assert.equal(POLICY_DENIAL_CODES.at(-1), "path_not_writable");
    assert.equal(POLICY_DENIAL_CODES.indexOf("protected_path"), 8, "the codes before it keep their places");
    assert.equal(new Set(POLICY_DENIAL_CODES).size, POLICY_DENIAL_CODES.length);
  });

  test("its hint tells the model what to do and holds no value", () => {
    const hint = REFUSAL_HINTS.path_not_writable;
    assert.ok(hint.length > 0 && hint.length <= 200);
    assert.match(hint, /do not write/);
    assert.doesNotMatch(hint, /[{}[\]`]/, "a fixed sentence, no placeholder");
    assert.notEqual(hint, REFUSAL_HINTS.protected_path);
  });

  test("its words are a message id without parameters", () => {
    assert.ok((MESSAGE_IDS as readonly string[]).includes("denial.path_not_writable"));
    assert.deepEqual(messageParams("denial.path_not_writable" as MessageId), {});
  });
});
