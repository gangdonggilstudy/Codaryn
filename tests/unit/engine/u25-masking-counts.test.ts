/**
 * U-25 (DR-52, AXM-17): the engine's part of the masking counts. EngineResult.masking holds the
 * gateway's registered values and the protected tokens in what the engine sent to the model; tokens
 * the model sent back are not counted. No registered value, or a gateway that does not say: no field.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { PrivacyGateway, ToolCall } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { FAKE_SECRET, FAKE_TOKEN, FakeTools, HASH_A, fakePrivacy, finalAnswer, harness, readCall, response } from "./fakes.js";

const reads = new FakeTools(() => ({ ok: true, payload: { path: "a.txt", content: `password=${FAKE_SECRET}`, hash: HASH_A, hadBom: false } }));

function run(privacy: PrivacyGateway, steps = [() => response([readCall("c1")]), () => finalAnswer()]) {
  const h = harness({ steps, privacy, tools: reads });
  return runTask(h.deps);
}

describe("U-25: masking counts in the result", () => {
  test("AXM-17's run: one registered value masked once in a file the model read", async () => {
    const result = await run({ ...fakePrivacy(), registeredValues: 2 });
    assert.deepEqual(result.masking, { registeredValues: 2, maskedPlaces: 1 });
  });

  test("tokens the model sends back are not counted; each text the engine sends is", async () => {
    const echo: ToolCall = { id: "c2", name: "read_file", args: { path: `${FAKE_TOKEN}.txt` } };
    const result = await run({ ...fakePrivacy(), registeredValues: 1 }, [
      () => response([readCall("c1")]),
      () => response([echo], { text: `I saw ${FAKE_TOKEN} and ${FAKE_TOKEN}` }),
      () => finalAnswer(),
    ]);
    assert.deepEqual(result.masking, { registeredValues: 1, maskedPlaces: 2 }, "two tool results, not the four echoed tokens");
  });

  test("no registered value, or a gateway that does not say: no field", async () => {
    for (const privacy of [{ ...fakePrivacy(), registeredValues: 0 }, fakePrivacy()]) {
      const result = await run(privacy);
      assert.equal(Object.hasOwn(result, "masking"), false);
    }
  });
});
