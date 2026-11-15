/**
 * U-25 (DR-52, AXM-17): whether masking worked, in counts only: how many values were registered,
 * and how many places in what was sent to the model were masked. Never a value, a place or a
 * length. A run with no registered value adds nothing.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { countPrivacyTokens, FIXED_MESSAGES } from "../../../src/contracts/index.js";
import type { EngineResult, MaskedText, PrivacyGateway } from "../../../src/contracts/index.js";

const TOKEN_A = "[[CODARYN_SECRET:3d320f1fdbb6d281]]";
const TOKEN_B = "[[CODARYN_SECRET:00000000000000ff]]";

describe("U-25: masking counts", () => {
  test("the result's counts, present only when a value was registered", () => {
    const masked: Pick<EngineResult, "masking"> = { masking: { registeredValues: 1, maskedPlaces: 3 } };
    const none: Pick<EngineResult, "masking"> = {};
    assert.deepEqual([masked.masking, Object.hasOwn(none, "masking")], [{ registeredValues: 1, maskedPlaces: 3 }, false]);
    assert.deepEqual(Object.keys(masked.masking ?? {}).sort(), ["maskedPlaces", "registeredValues"], "counts only");
  });

  test("the gateway says how many values it holds; a fake may leave it out", () => {
    const counted: Pick<PrivacyGateway, "registeredValues"> = { registeredValues: 2 };
    const fake: Pick<PrivacyGateway, "registeredValues"> = {};
    assert.deepEqual([counted.registeredValues, fake.registeredValues], [2, undefined]);
  });

  test("AXM-17's run: password=<token> counts one place; well-formed tokens only", () => {
    assert.equal(countPrivacyTokens(`password=${TOKEN_A}` as MaskedText), 1);
    assert.equal(countPrivacyTokens(`${TOKEN_A} and ${TOKEN_B}, ${TOKEN_A}` as MaskedText), 3);
    assert.equal(countPrivacyTokens("[[CODARYN_SECRET:XYZ]] CODARYN_SECRET plain" as MaskedText), 0);
    assert.equal(countPrivacyTokens("" as MaskedText), 0);
  });

  test("the end summary's line", () => {
    assert.deepEqual(FIXED_MESSAGES["summary.masking"], { registered: "count", masked: "count" });
  });
});
