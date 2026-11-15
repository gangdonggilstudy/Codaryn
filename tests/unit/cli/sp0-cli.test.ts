/**
 * SP-0, CLI part (docs/design/second-provider.md 7): P-7 the settings resolution and P-8 the CLI's
 * outputs with an Anthropic config stay byte for byte as captured in sp0-expected.ts. Fake values,
 * a loopback fake server for run; nothing leaves the machine.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SP0_EXPECTED } from "./sp0-expected.js";
import { p7Outcomes, p8Outputs } from "./sp0-pins.js";

describe("SP-0 P-7: the settings resolution of an Anthropic run", () => {
  test("every case resolves as captured", () => {
    const outcomes = p7Outcomes();
    assert.deepEqual(Object.keys(outcomes), Object.keys(SP0_EXPECTED.p7));
    for (const [name, value] of Object.entries(outcomes)) assert.deepEqual(value, SP0_EXPECTED.p7[name], name);
  });
});

describe("SP-0 P-8: doctor, models, init and run with an Anthropic config", () => {
  test("every output is as captured", async (t) => {
    const outputs = await p8Outputs(t);
    assert.deepEqual(Object.keys(outputs), Object.keys(SP0_EXPECTED.p8));
    for (const [name, value] of Object.entries(outputs)) assert.equal(value, SP0_EXPECTED.p8[name], name);
  });
});
