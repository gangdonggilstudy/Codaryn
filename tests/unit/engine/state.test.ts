import assert from "node:assert/strict";
import { test } from "node:test";
import { RUN_STATUSES, RUN_TRANSITIONS } from "../../../src/contracts/index.js";
import { InvalidTransitionError, RunState, canTransition } from "../../../src/engine/index.js";

test("EN-01 transitions outside the table are rejected and leave the status unchanged", () => {
  for (const from of RUN_STATUSES) {
    for (const to of RUN_STATUSES) {
      assert.equal(canTransition(from, to), RUN_TRANSITIONS[from].includes(to), `${from} -> ${to}`);
    }
  }

  const state = new RunState();
  assert.throws(() => state.transition("done"), InvalidTransitionError);
  assert.equal(state.status, "created");

  state.transition("running");
  state.transition("verifying");
  state.transition("done");
  assert.throws(() => state.transition("running"), InvalidTransitionError);
  assert.equal(state.status, "done");
});

test("EN-01 terminal states have no outgoing transitions", () => {
  for (const status of ["done", "failed", "needs-input", "cancelled", "budget-exhausted"] as const) {
    assert.deepEqual(RUN_TRANSITIONS[status], []);
  }
});
