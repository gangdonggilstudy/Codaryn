/**
 * SP-5, DR-31 (c): a provider's reasoning items stay in the adapter; the engine records only how
 * many there were, and only a plausible count. A response without the field records as before.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { runTask } from "../../../src/engine/index.js";
import { finalAnswer, harness, response } from "./fakes.js";

describe("SP-5: the engine records the count of reasoning items, never their content", () => {
  test("a count is recorded with the response", async () => {
    const run = harness({ steps: [() => response([], { text: "done", reasoningItems: 3 })] });
    await runTask(run.deps);
    const [recorded] = run.journal.ofType("model_response");
    assert.equal(recorded?.reasoningItems, 3);
  });

  test("no count: the record has no such field, as before", async () => {
    const run = harness({ steps: [() => finalAnswer()] });
    await runTask(run.deps);
    const [recorded] = run.journal.ofType("model_response");
    assert.equal(recorded !== undefined && Object.hasOwn(recorded, "reasoningItems"), false);
  });

  test("an implausible count is left out", async () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      const run = harness({ steps: [() => response([], { text: "done", reasoningItems: bad })] });
      await runTask(run.deps);
      const [recorded] = run.journal.ofType("model_response");
      assert.equal(recorded !== undefined && Object.hasOwn(recorded, "reasoningItems"), false, String(bad));
    }
  });
});
