/**
 * DR-43 (c), review R-32 L-1: the CLI's output hiding compares letters and digits only for a
 * key-like registered value (the contract's keyLikeSkeleton, ca100c1), as the refusal check does.
 * A phrase kept in a key variable for a local server hid an ordinary sentence with the same words.
 * The value as written, and a key-like value split by any character, are still hidden.
 * Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { keyLikeSkeleton, keyLettersAndDigits } from "../../../src/contracts/index.js";
import { hideKeys } from "../../../src/cli/text-safety.js";

const PHRASE = ["your", "api", "key", "goes", "here"].join("-");
const KEY_LIKE = ["fakeKEY", "9x7Q", "m2Lp", "8zRt"].join("");
const LONG_HEX = ["0123456789abcdef", "0123456789abcdef"].join("");

describe("DR-43 (c): letters and digits are compared only for a key-like value", () => {
  test("the cases are as the contract judges them", () => {
    assert.equal(keyLikeSkeleton(keyLettersAndDigits(PHRASE)), false);
    assert.equal(keyLikeSkeleton(keyLettersAndDigits(KEY_LIKE)), true);
    assert.equal(keyLikeSkeleton(keyLettersAndDigits(LONG_HEX)), true);
  });

  test("R-32 L-1: a phrase-shaped key value no longer hides a sentence with the same words", () => {
    const sentence = "the guide says: put your api key goes here, then save";
    assert.equal(hideKeys(sentence, [PHRASE]), sentence);
  });

  test("the phrase as written is still hidden", () => {
    assert.equal(hideKeys(`value ${PHRASE} end`, [PHRASE]), "value [key] end");
  });

  test("a key-like value split by a variation selector or a middle dot is still hidden", () => {
    for (const splitter of ["️", "·"]) {
      const hidden = hideKeys(`a ${KEY_LIKE.slice(0, 9)}${splitter}${KEY_LIKE.slice(9)} b`, [KEY_LIKE]);
      assert.equal(hidden.includes(KEY_LIKE.slice(0, 9)) || hidden.includes(KEY_LIKE.slice(9)), false, JSON.stringify(hidden));
    }
  });

  test("a long single-case hex value split by a middle dot is still hidden", () => {
    const hidden = hideKeys(`a ${LONG_HEX.slice(0, 16)}·${LONG_HEX.slice(16)} b`, [LONG_HEX]);
    assert.equal(hidden.includes(LONG_HEX.slice(4, 14)), false, JSON.stringify(hidden));
  });
});
