/**
 * U-25 (DR-52, AXM-17): the gateway says how many values it was made with, as a count only. The
 * engine puts it in EngineResult.masking.registeredValues. A value's variants (the forms the gateway
 * looks for: line endings, base64, URL, JSON, hex, split) do not count apart; nothing else of a
 * value (its length, its forms, where it is) can be read from the gateway.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createPrivacyGateway } from "../../../src/privacy/index.js";

// Fake values only. None of them follows a real key format.
const ONE = "fake-value-한글-0001";
const TWO = "fake value two 0002";

const count = (secrets: readonly string[]): unknown => createPrivacyGateway({ secrets }).registeredValues;

describe("U-25: registeredValues", () => {
  test("AXM-17: one value registered is one, two are two, none is zero", () => {
    assert.equal(count([ONE]), 1);
    assert.equal(count([ONE, TWO]), 2);
    assert.equal(count([]), 0);
  });

  test("the same value given twice (the key also in secretEnv, say) counts once", () => {
    assert.equal(count([ONE, ONE]), 1);
    assert.equal(count([ONE, TWO, ONE]), 2);
  });

  test("a value written with other line endings is the same value", () => {
    assert.equal(count(["fake\r\nmulti-line 0003", "fake\nmulti-line 0003"]), 1);
    assert.equal(count(["fake\r\nmulti-line 0003", "fake\nmulti-line 0004"]), 2);
  });

  test("a count only: the same for values of any length, and nothing else is added to the gateway", () => {
    assert.equal(count(["fake-short-1"]), count(["fake-" + "long-".repeat(400) + "1"]));
    const gateway = createPrivacyGateway({ secrets: [ONE, TWO] });
    assert.ok(Number.isSafeInteger(gateway.registeredValues));
    // The gateway's own members are its three functions and this number.
    assert.deepEqual(Object.keys(gateway).sort(), ["mask", "rebuildDocument", "registeredValues", "resolveToolArgs"]);
    assert.equal(JSON.stringify({ registeredValues: gateway.registeredValues }), '{"registeredValues":2}');
  });

  test("it cannot be changed after the gateway is made", () => {
    const gateway = createPrivacyGateway({ secrets: [ONE] });
    assert.throws(() => {
      (gateway as { registeredValues?: number }).registeredValues = 9;
    }, TypeError);
    assert.equal(gateway.registeredValues, 1);
  });

  test("masking is unchanged by it", () => {
    const outcome = createPrivacyGateway({ secrets: [ONE] }).mask(`a ${ONE} b`);
    assert.ok(outcome.ok);
    assert.ok(outcome.ok && !outcome.text.includes(ONE));
  });
});
