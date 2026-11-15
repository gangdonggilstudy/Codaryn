import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MAX_KEY_SCAN_DEPTH, findKeyInJson, goalHoldsKey, rawTextHoldsKey } from "../../../../src/cli/security/index.js";

/** Fake values only. The shape is built at run time so no key-shaped literal sits in the source. */
// DR-36 (c): the refusal shape needs 32 or more characters with a digit after sk-ant-.
const FAKE_SHAPED = ["sk", "ant", "fakefakefake0000fakefakefake0000"].join("-");
const CURRENT = "fake-current-key-0123456789-abcdefXYZ";

function nest(depth: number): unknown {
  let value: unknown = "leaf";
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}

describe("S-6 findKeyInJson", () => {
  test("does not overflow the stack on deep nesting and reports it as too deep", () => {
    assert.deepEqual(findKeyInJson(nest(20_000), CURRENT), { kind: "too_deep" });
    const deepObject = JSON.parse(`${'{"a":'.repeat(5000)}1${"}".repeat(5000)}`) as unknown;
    assert.deepEqual(findKeyInJson(deepObject, CURRENT), { kind: "too_deep" });
  });

  test("the depth limit is exactly MAX_KEY_SCAN_DEPTH containers", () => {
    assert.equal(MAX_KEY_SCAN_DEPTH, 64);
    assert.deepEqual(findKeyInJson(nest(64), CURRENT), { kind: "none" });
    assert.deepEqual(findKeyInJson(nest(65), CURRENT), { kind: "too_deep" });
  });

  test("finds key fields and key values and reports known field names only", () => {
    assert.deepEqual(findKeyInJson({ model: { provider: "anthropic", apiKey: "x" } }, null), { kind: "key", location: "model.apiKey" });
    assert.deepEqual(findKeyInJson({ model: { model: FAKE_SHAPED } }, null), { kind: "key", location: "model.model" });
    assert.deepEqual(findKeyInJson({ goal: `use ${CURRENT} please` }, CURRENT), { kind: "key", location: "goal" });
    assert.deepEqual(
      findKeyInJson({ verifiers: [{ id: "v", kind: "command", args: ["a", "b", FAKE_SHAPED] }] }, null),
      { kind: "key", location: "verifiers[0].args[2]" },
    );
    assert.deepEqual(findKeyInJson(FAKE_SHAPED, null), { kind: "key", location: "<root>" });
    assert.deepEqual(findKeyInJson({ model: "m", limits: { maxModelTurns: 3 } }, CURRENT), { kind: "none" });
  });

  test("H2-11: an unknown field name never appears in the location, even when it holds part of the key", () => {
    const fragment = CURRENT.slice(4, 29);
    const outcome = findKeyInJson({ limits: { [fragment]: { apiKey: "x" } } }, CURRENT);
    assert.deepEqual(outcome, { kind: "key", location: "limits.<field>.apiKey" });
    // A key field name in an unusual spelling is reported as <field> too.
    assert.deepEqual(findKeyInJson({ model: { "ａｐｉＫｅｙ": "x" } }, null), { kind: "key", location: "model.<field>" });
    assert.deepEqual(findKeyInJson({ "my-own-name": FAKE_SHAPED }, null), { kind: "key", location: "<field>" });
    // A field name that is itself key-shaped.
    assert.deepEqual(findKeyInJson({ [FAKE_SHAPED]: 1 }, null), { kind: "key", location: "<field>" });
  });

  test("a short current key is not searched for, to avoid matching ordinary text", () => {
    assert.deepEqual(findKeyInJson({ goal: "fix the tests" }, "tests"), { kind: "none" });
  });
});

describe("S-6 rawTextHoldsKey (before JSON.parse)", () => {
  test("H2-10: a duplicate field that JSON.parse would drop is still caught", () => {
    const text = `{"model":"${FAKE_SHAPED}","model":"some-model"}`;
    assert.deepEqual(findKeyInJson(JSON.parse(text) as unknown, null), { kind: "none" });
    assert.equal(rawTextHoldsKey(text, null), true);
  });

  test("finds the current key and key shapes anywhere in the text", () => {
    assert.equal(rawTextHoldsKey(`{"goal":"x ${CURRENT} y"}`, CURRENT), true);
    assert.equal(rawTextHoldsKey(`{"goal":"${FAKE_SHAPED}"}`, null), true);
    assert.equal(rawTextHoldsKey(`{"goal":"fix the tests"}`, CURRENT), false);
    assert.equal(rawTextHoldsKey(`{"goal":"fix the tests"}`, "tests"), false);
  });
});

describe("S-8 goalHoldsKey", () => {
  test("rejects a goal with a key shape or the current key", () => {
    assert.equal(goalHoldsKey(`summarize; key ${FAKE_SHAPED}`, null), true);
    assert.equal(goalHoldsKey(`call the API with ${CURRENT}`, CURRENT), true);
    assert.equal(goalHoldsKey("fix the failing tests in src/", CURRENT), false);
  });
});

describe("T-14 key checks (policy review L1, L2)", () => {
  test("L1: an escaped key in the first of two duplicate fields is caught on the raw text", () => {
    // Built from the character code so that no tool or editor turns the escape into the letter.
    const BS = String.fromCharCode(92);
    const escapedShape = `${BS}u0073${FAKE_SHAPED.slice(1)}`;
    const text = `{"goal":"${escapedShape}","goal":"g2"}`;
    assert.ok(text.includes(BS) && !text.includes(FAKE_SHAPED), "the raw text holds only the escaped form");
    assert.deepEqual(findKeyInJson(JSON.parse(text) as unknown, null), { kind: "none" });
    assert.equal(rawTextHoldsKey(text, null), true);
    const escapedCurrent = `${BS}u0066${CURRENT.slice(1)}`;
    assert.equal(rawTextHoldsKey(`{"model":"${escapedCurrent}","model":"m"}`, CURRENT), true);
    // Ordinary escapes that do not form a key stay fine, including an escaped backslash before "u".
    assert.equal(rawTextHoldsKey(`{"goal":"tab${BS}tand ${BS}u00e9 and ${BS}${BS}u0073k"}`, CURRENT), false);
  });

  test("L2: a key field name is printed only when it is exactly a key field name", () => {
    assert.deepEqual(findKeyInJson({ apikeyHunter2Secret: "x" }, null), { kind: "key", location: "<field>" });
    const withFragment = `apikey${CURRENT.slice(3, 23)}`;
    const outcome = findKeyInJson({ limits: { [withFragment]: "x" } }, CURRENT);
    assert.deepEqual(outcome, { kind: "key", location: "limits.<field>" });
    assert.ok(!JSON.stringify(outcome).includes(CURRENT.slice(3, 23)));
    for (const name of ["apiKey", "api_key", "API-KEY", "token", "Authorization", "secretKey"]) {
      assert.deepEqual(findKeyInJson({ model: { [name]: "x" } }, null), { kind: "key", location: `model.${name}` }, name);
    }
  });
});
