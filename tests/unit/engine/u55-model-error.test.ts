/**
 * U-55 (AXM-9): reproduced on main 4010905 with a scripted run whose script runs out: the result said
 * `"status":"failed","reason":"model_error"` with empty notices, and the kind (`script_exhausted`) was
 * only in the journal. Now a run that a model error ended carries `modelError {kind, turn,
 * retryable?}`, by modelErrorRetryable. A run that ended as model_error because masking failed had no
 * model error and carries none; neither does any other run.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ModelOutcome } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { fakePrivacy, finalAnswer, harness, response } from "./fakes.js";

const failure = (kind: Extract<ModelOutcome, { ok: false }>["kind"], httpStatus?: number): ModelOutcome => ({
  ok: false,
  kind,
  message: "the provider said no",
  ...(httpStatus === undefined ? {} : { httpStatus }),
});
const read = () => response([{ id: "r1", name: "read_file", args: { path: "a.txt" } }]);

describe("U-55: a run that a model error ended says what kind, at which turn, and whether trying again may help", () => {
  test("a provider failure at the second turn: kind, turn and retryable by the classification", async () => {
    for (const [kind, status, retryable] of [
      ["rate_limited", 429, true],
      ["overloaded", 529, true],
      ["timeout", undefined, true],
      ["auth_failed", 401, false],
      ["quota_exhausted", 429, false],
      ["api_error", 500, true],
      ["api_error", 400, false],
      ["script_exhausted", undefined, false],
    ] as const) {
      const h = harness({ steps: [read, () => failure(kind, status)] });
      const result = await runTask(h.deps);
      assert.deepEqual([result.status, result.reason], ["failed", "model_error"], kind);
      assert.deepEqual(result.modelError, { kind, turn: 2, retryable }, `${kind} ${status}`);
    }
  });

  test("an api_error without an HTTP status: no retryable (unknown), never false", async () => {
    const h = harness({ steps: [() => failure("api_error")] });
    const result = await runTask(h.deps);
    assert.deepEqual(result.modelError, { kind: "api_error", turn: 1 });
    assert.equal(Object.hasOwn(result.modelError as object, "retryable"), false);
  });

  test("a malformed response and a plan run without a plan are malformed_response, not retryable", async () => {
    const malformed = harness({ steps: [() => response([], { stop: "length" })] });
    assert.deepEqual((await runTask(malformed.deps)).modelError, { kind: "malformed_response", turn: 1, retryable: false });
    const noPlan = harness({
      steps: [read, () => finalAnswer()],
      task: { tools: ["read_file", "search_files", "write_file", "run_command", "inspect_files", "propose_plan"], plan: "apply" },
    });
    const result = await runTask(noPlan.deps);
    assert.deepEqual([result.status, result.reason], ["failed", "model_error"]);
    assert.deepEqual(result.modelError, { kind: "malformed_response", turn: 2, retryable: false });
  });

  test("masking failed: model_error with no model error, so no modelError; other ends have none", async () => {
    const masked = harness({ steps: [() => finalAnswer()], privacy: fakePrivacy({ failWhen: () => true }) });
    const failed = await runTask(masked.deps);
    assert.deepEqual([failed.status, failed.reason], ["failed", "model_error"]);
    assert.equal(Object.hasOwn(failed, "modelError"), false);
    const done = await runTask(harness({ steps: [() => finalAnswer()] }).deps);
    assert.notEqual(done.reason, "model_error");
    assert.equal(Object.hasOwn(done, "modelError"), false);
  });

  test("the kind and the turn only: no message, no status, nothing from the provider", async () => {
    const h = harness({ steps: [() => failure("api_error", 503)] });
    const result = await runTask(h.deps);
    assert.deepEqual(Object.keys(result.modelError ?? {}).sort(), ["kind", "retryable", "turn"]);
    assert.equal(JSON.stringify(result).includes("the provider said no"), false);
  });
});
