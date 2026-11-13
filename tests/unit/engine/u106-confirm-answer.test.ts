/**
 * U-106 (security review R-79 L-3 and L-2), on U-74's permission question.
 * - L-3: the engine reads the answer once, right after it came, inside a try, and only an own
 *   `decision` counts. A read that throws, a prototype's `decision` (an IPC value copied with
 *   Object.assign can bring one through `__proto__`) or a wrong shape is `dismissed`: deny, by
 *   default; the run still records the answer and ends normally. A getter is read once, so it
 *   cannot pass the check with one value and decide with another.
 * - L-2: the question's `subject` is text a screen shows as it is, so the engine hides key shapes
 *   in it as it does for the final message (safeModelText: HIDDEN_KEY_MARKER), besides masking
 *   registered values. The question, `confirmation_requested` and the request handed to the asker
 *   carry the same text. A plain name stays as it was.
 * Key-shaped values are built at run time from parts; none is a real key.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { HIDDEN_KEY_MARKER } from "../../../src/contracts/index.js";
import type { ConfirmAnswer, ConfirmPermission, ConfirmRequest, PolicyDecision, ToolCall } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { FAKE_SECRET, FAKE_TOKEN, FakePolicy, finalAnswer, harness, response } from "./fakes.js";

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

describe("U-106 L-2: the question's subject hides key shapes, as the final message does", () => {
  const keyShape = (): string => ["sk", "ant", "api03", "U106fakeVALUEfakeVALUEfakeVALUE0123"].join("-");

  test("a key shape in the executable is hidden in the question, its record and the request asked", async () => {
    const shape = keyShape();
    const run = await asked(async () => ({ decision: "deny" }), `/opt/${shape}/bin/tool`);
    const subject = run.requested[0]?.subject ?? "";
    assert.equal(subject.includes(shape), false);
    assert.equal(subject, `/opt/${HIDDEN_KEY_MARKER}/bin/tool`);
    assert.equal(run.seen[0]?.subject, subject, "the asker gets the same text");
    assert.equal(JSON.stringify([run.requested, run.seen]).includes(shape), false);
  });

  test("a registered value is still masked, and a plain name stays as it was", async () => {
    const registered = await asked(async () => ({ decision: "deny" }), `/opt/${FAKE_SECRET}/tool`);
    assert.equal(registered.requested[0]?.subject, `/opt/${FAKE_TOKEN}/tool`);
    for (const plain of ["npm", "C:\\Program Files\\nodejs\\node.exe", "/usr/bin/python3", "도구 폴더/run.sh"]) {
      const run = await asked(async () => ({ decision: "deny" }), plain);
      assert.equal(run.requested[0]?.subject, plain);
      assert.equal(run.seen[0]?.subject, plain);
    }
  });
});
