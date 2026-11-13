/**
 * U-74 B-3 (DR-3, DR-10): the engine asks when the second policy check gives the confirm mark.
 * - It records `confirmation_requested` (fixed fields, the masked executable, the number of
 *   arguments; never the model's argument text), asks EngineDeps.confirm, records
 *   `confirmation_answered`, and only after `allow_once` judges the call again and runs it.
 * - Nobody to ask (no confirm), a dismissed, thrown or unknown answer: deny, by default. A cancel
 *   while waiting: deny, cancelled, and the run is cancelled. The time limit while waiting (the wait
 *   counts in maxDurationMs): deny, by default, and the run is budget-exhausted.
 * - Without the mark nothing of this happens.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ConfirmAnswer, ConfirmPermission, ConfirmRequest, PolicyDecision, ToolCall } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { FAKE_SECRET, FAKE_TOKEN, FakePolicy, finalAnswer, harness, response } from "./fakes.js";

const MARK: PolicyDecision = { allowed: false, permission: "command", code: "confirmation_required", confirm: true };
const command = (executable = "npm", args: string[] = ["test", "--grep", "secret words"]): ToolCall => ({ id: "c1", name: "run_command", args: { executable, args } });

/** A run with one run_command call; the second check gives the mark, then `again` after an answer. */
async function asked(options: { confirm?: ConfirmPermission; again?: PolicyDecision; call?: ToolCall; limits?: { maxDurationMs: number } } = {}) {
  let checks = 0;
  const policy = new FakePolicy({ effective: () => (checks++ === 0 ? MARK : (options.again ?? { allowed: true })) });
  const h = harness({ steps: [() => response([options.call ?? command()]), () => finalAnswer()], policy, ...(options.limits === undefined ? {} : { task: { limits: options.limits } }) });
  if (options.confirm !== undefined) h.deps = { ...h.deps, confirm: options.confirm };
  const result = await runTask(h.deps);
  return {
    result,
    requested: h.journal.ofType("confirmation_requested"),
    answered: h.journal.ofType("confirmation_answered"),
    decisions: h.journal.ofType("tool_decision").filter((event) => event.stage === "policy_effective"),
    results: h.journal.ofType("tool_result").map((event) => event.result),
    executed: h.tools.executed.length,
    checks: policy.effectiveCalls.length,
    h,
  };
}

describe("U-74 B-3: the engine asks, records and judges again", () => {
  test("nobody to ask: deny by default, recorded, and the call does not run", async () => {
    const run = await asked();
    assert.deepEqual(run.requested, [{ type: "confirmation_requested", id: "q1", kind: "permission", callId: "c1", tool: "run_command", permission: "command", subject: "npm", argumentCount: 3 }]);
    assert.deepEqual(run.answered, [{ type: "confirmation_answered", id: "q1", decision: "deny", by: "default" }]);
    assert.deepEqual(run.decisions.map((event) => [event.allowed, event.code]), [[false, "confirmation_required"]]);
    assert.equal(run.results[0]?.errorCode, "policy_denied");
    assert.ok(run.results[0]?.content.includes("command/confirmation_required"), run.results[0]?.content);
    assert.equal(run.executed, 0);
  });

  test("allow_once: judged again, then run once", async () => {
    const seen: ConfirmRequest[] = [];
    const run = await asked({ confirm: async (request) => (seen.push(request), { decision: "allow_once" }) });
    assert.deepEqual(seen, [{ kind: "permission", id: "q1", callId: "c1", tool: "run_command", permission: "command", subject: "npm", argumentCount: 3 }]);
    assert.deepEqual(run.answered.map((event) => [event.decision, event.by]), [["allow_once", "user"]]);
    assert.equal(run.checks, 2, "the second check ran again after the answer");
    assert.deepEqual(run.decisions.map((event) => event.allowed), [true]);
    assert.equal(run.executed, 1);
  });

  test("allow_once and the same mark again: it runs; another denial on the check again: denied with it", async () => {
    assert.equal((await asked({ confirm: async () => ({ decision: "allow_once" }), again: MARK })).executed, 1);
    const changed = await asked({ confirm: async () => ({ decision: "allow_once" }), again: { allowed: false, permission: "path", code: "outside_root" } });
    assert.equal(changed.executed, 0);
    assert.deepEqual(changed.decisions.map((event) => [event.allowed, event.permission, event.code]), [[false, "path", "outside_root"]]);
  });

  test("deny by the person, and dismissed, thrown or unknown answers by default", async () => {
    const answers: [ConfirmPermission, string][] = [
      [async () => ({ decision: "deny" }), "user"],
      [async () => ({ decision: "dismissed" }), "default"],
      [async () => { throw new Error("no window"); }, "default"],
      [async () => ({ decision: "always" }) as unknown as ConfirmAnswer, "default"],
    ];
    for (const [confirm, by] of answers) {
      const run = await asked({ confirm });
      assert.deepEqual(run.answered.map((event) => [event.decision, event.by]), [["deny", by]]);
      assert.equal(run.executed, 0);
      assert.equal(run.decisions[0]?.code, "confirmation_required");
    }
  });

  test("a cancel while waiting: deny, cancelled, and the run is cancelled", async () => {
    let abort: () => void = () => {};
    const confirm: ConfirmPermission = (_request, signal) => {
      abort();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    };
    let checks = 0;
    const policy = new FakePolicy({ effective: () => (checks++ === 0 ? MARK : { allowed: true }) });
    const h = harness({ steps: [() => response([command()]), () => finalAnswer()], policy });
    abort = () => h.controller.abort();
    h.deps = { ...h.deps, confirm };
    const result = await runTask(h.deps);
    assert.equal(result.status, "cancelled");
    assert.deepEqual(h.journal.ofType("confirmation_answered").map((event) => [event.decision, event.by]), [["deny", "cancelled"]]);
    assert.equal(h.tools.executed.length, 0);
  });

  test("the time limit while waiting: deny by default, and the run is budget-exhausted", async () => {
    const run = await asked({ confirm: () => new Promise(() => {}), limits: { maxDurationMs: 60 } });
    assert.deepEqual([run.result.status, run.result.reason], ["budget-exhausted", "max_duration"]);
    assert.deepEqual(run.answered.map((event) => [event.decision, event.by]), [["deny", "default"]]);
    assert.equal(run.executed, 0);
  });

  test("the subject is the masked executable; the model's arguments are only counted", async () => {
    const run = await asked({ call: command(`tools/${FAKE_SECRET}/run`, ["--token", FAKE_SECRET, "x"]) });
    assert.equal(run.requested[0]?.subject, `tools/${FAKE_TOKEN}/run`);
    assert.equal(run.requested[0]?.argumentCount, 3);
    const text = JSON.stringify([...run.requested, ...run.answered]);
    assert.equal(text.includes(FAKE_SECRET), false);
    assert.equal(text.includes("--token"), false);
  });

  test("without the mark: no question, no new record, the call runs as before", async () => {
    const h = harness({ steps: [() => response([command()]), () => finalAnswer()] });
    let asks = 0;
    h.deps = { ...h.deps, confirm: async () => (asks++, { decision: "allow_once" }) };
    await runTask(h.deps);
    assert.equal(asks, 0);
    assert.equal(h.journal.ofType("confirmation_requested").length + h.journal.ofType("confirmation_answered").length, 0);
    assert.equal(h.tools.executed.length, 1);
  });
});
