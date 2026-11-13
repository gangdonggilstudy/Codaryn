/**
 * U-106 (security review R-79 L-3), on U-74's permission question.
 * - L-3: the engine reads the answer once, right after it came, inside a try, and only an own
 *   `decision` counts. A read that throws, a prototype's `decision` (an IPC value copied with
 *   Object.assign can bring one through `__proto__`) or a wrong shape is `dismissed`: deny, by
 *   default; the run still records the answer and ends normally. A getter is read once, so it
 *   cannot pass the check with one value and decide with another.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ConfirmAnswer, ConfirmPermission, ConfirmRequest, PolicyDecision, ToolCall } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { FakePolicy, finalAnswer, harness, response } from "./fakes.js";

const MARK: PolicyDecision = { allowed: false, permission: "command", code: "confirmation_required", confirm: true };
const command = (executable = "npm"): ToolCall => ({ id: "c1", name: "run_command", args: { executable, args: ["test"] } });

/** A run whose one command gets the confirm mark, answered by `confirm`. */
async function asked(confirm: ConfirmPermission, executable?: string) {
  let checks = 0;
  const policy = new FakePolicy({ effective: () => (checks++ === 0 ? MARK : { allowed: true }) });
  const h = harness({ steps: [() => response([command(executable)]), () => finalAnswer()], policy });
  const seen: ConfirmRequest[] = [];
  h.deps = { ...h.deps, confirm: async (request, signal) => (seen.push(request), confirm(request, signal)) };
  const result = await runTask(h.deps);
  return {
    result,
    seen,
    requested: h.journal.ofType("confirmation_requested"),
    answered: h.journal.ofType("confirmation_answered").map((event) => [event.decision, event.by]),
    finished: h.journal.ofType("run_finished").length,
    executed: h.tools.executed.length,
  };
}

/** Every way an answer can only be made to look like allow_once: each is dismissed. */
function trickAnswers(): [string, () => unknown][] {
  return [
    [
      "a getter that throws",
      () =>
        Object.defineProperty({}, "decision", {
          enumerable: true,
          get() {
            throw new Error("no decision");
          },
        }),
    ],
    ["allow_once on the prototype only", () => Object.create({ decision: "allow_once" })],
    ["allow_once brought by __proto__ through Object.assign (an IPC copy)", () => Object.assign({}, JSON.parse('{"__proto__":{"decision":"allow_once"}}'))],
    [
      "a proxy whose own-property question throws",
      () =>
        new Proxy(
          {},
          {
            getOwnPropertyDescriptor() {
              throw new Error("trap");
            },
            has() {
              throw new Error("trap");
            },
            get() {
              throw new Error("trap");
            },
          },
        ),
    ],
    ["a decision that is not a string", () => ({ decision: ["allow_once"] })],
  ];
}

describe("U-106 L-3: the answer is read once, own property only", () => {
  for (const [name, make] of trickAnswers()) {
    test(`${name}: dismissed, deny by default, the run ends normally`, async () => {
      const run = await asked(async () => make() as ConfirmAnswer);
      assert.deepEqual(run.answered, [["deny", "default"]]);
      assert.equal(run.executed, 0, "the command does not run");
      assert.equal(run.finished, 1, "run_finished is recorded");
      assert.equal(run.result.runId, "20261112T000000Z-0000abcd", "runTask resolved with its result");
    });
  }

  test("a getter is read once: it cannot pass the check with one value and decide with another", async () => {
    let reads = 0;
    const answer = Object.defineProperty({}, "decision", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? "deny" : "allow_once";
      },
    });
    const run = await asked(async () => answer as ConfirmAnswer);
    assert.equal(reads, 1);
    assert.deepEqual(run.answered, [["deny", "user"]]);
    assert.equal(run.executed, 0);
  });

  test("an own allow_once still runs the command once; an own deny is the person's", async () => {
    const allowed = await asked(async () => ({ decision: "allow_once" }));
    assert.deepEqual(allowed.answered, [["allow_once", "user"]]);
    assert.equal(allowed.executed, 1);
    const denied = await asked(async () => ({ decision: "deny" }));
    assert.deepEqual(denied.answered, [["deny", "user"]]);
    assert.equal(denied.executed, 0);
    const parsed = await asked(async () => JSON.parse('{"decision":"allow_once"}') as ConfirmAnswer);
    assert.deepEqual(parsed.answered, [["allow_once", "user"]], "an IPC value with its own decision");
  });
});
