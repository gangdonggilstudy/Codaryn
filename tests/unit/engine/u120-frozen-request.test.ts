/**
 * U-120 (security review R-86 L-1): the engine hands the asker (EngineDeps.confirm, the app
 * layer's confirmThrough, an adapter) a frozen copy of its permission question, and writes the
 * answer record from its own question only. An asker that changes the object it got (its `id`, its
 * `subject`) can neither change `confirmation_answered` nor put an unmasked value in the journal.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ConfirmPermission, ConfirmRequest, PolicyDecision, ToolCall } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { FAKE_SECRET, FakePolicy, finalAnswer, harness, response } from "./fakes.js";

const MARK: PolicyDecision = { allowed: false, permission: "command", code: "confirmation_required", confirm: true };
const command: ToolCall = { id: "c1", name: "run_command", args: { executable: "npm", args: ["test"] } };

async function asked(confirm: ConfirmPermission) {
  let checks = 0;
  const policy = new FakePolicy({ effective: () => (checks++ === 0 ? MARK : { allowed: true }) });
  const h = harness({ steps: [() => response([command]), () => finalAnswer()], policy });
  h.deps = { ...h.deps, confirm };
  await runTask(h.deps);
  return {
    requested: h.journal.ofType("confirmation_requested"),
    answered: h.journal.ofType("confirmation_answered").map((event) => [event.id, event.decision, event.by]),
    journal: JSON.stringify(h.journal.events),
    executed: h.tools.executed.length,
  };
}

/** Tries to change the question in place, as a careless adapter might; keeps any error. */
function change(request: ConfirmRequest, values: Partial<Record<keyof ConfirmRequest, unknown>>): unknown[] {
  const errors: unknown[] = [];
  for (const [field, value] of Object.entries(values)) {
    try {
      (request as unknown as Record<string, unknown>)[field] = value;
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

describe("U-120: the asker gets a frozen copy; the records come from the engine's own question", () => {
  test("changing the id and the subject it got changes neither the answer record nor the answer", async () => {
    const errors: unknown[][] = [];
    const run = await asked(async (request) => {
      errors.push(change(request, { id: "u120-altered-id", subject: "u120-altered-subject" }));
      return { decision: "allow_once" };
    });
    assert.deepEqual(run.answered, [["q1", "allow_once", "user"]]);
    assert.equal(run.requested[0]?.id, "q1");
    assert.equal(run.requested[0]?.subject, "npm");
    assert.equal(run.executed, 1);
    assert.equal(run.journal.includes("u120-altered"), false);
    assert.equal(errors[0]?.length, 2, "both changes were refused");
  });

  test("the question it gets is frozen: a change in place throws (strict mode) and leaves it as it was", async () => {
    let frozen = false;
    let thrown = 0;
    let after: ConfirmRequest | undefined;
    await asked(async (request) => {
      frozen = Object.isFrozen(request);
      thrown = change(request, { id: "q9", argumentCount: 7 }).filter((error) => error instanceof TypeError).length;
      after = { ...request };
      return { decision: "deny" };
    });
    assert.equal(frozen, true);
    assert.equal(thrown, 2);
    assert.deepEqual(after, { kind: "permission", id: "q1", callId: "c1", tool: "run_command", permission: "command", subject: "npm", argumentCount: 1 });
  });

  test("a registered value written into the id it got never reaches the journal", async () => {
    const run = await asked(async (request) => {
      change(request, { id: FAKE_SECRET });
      return { decision: "deny" };
    });
    assert.deepEqual(run.answered, [["q1", "deny", "user"]]);
    assert.equal(run.journal.includes(FAKE_SECRET), false);
  });

  test("the copy holds what was recorded: the asker sees the same question as confirmation_requested", async () => {
    let seen: ConfirmRequest | undefined;
    const run = await asked(async (request) => {
      seen = { ...request };
      return { decision: "deny" };
    });
    const { type, ...recorded } = run.requested[0] ?? { type: "confirmation_requested" };
    assert.equal(type, "confirmation_requested");
    assert.deepEqual(seen, recorded);
  });

  test("each question gets its own copy: q1 and q2 of one turn", async () => {
    const seen: ConfirmRequest[] = [];
    let checks = 0;
    const policy = new FakePolicy({ effective: () => (checks++ % 2 === 0 ? MARK : { allowed: true }) });
    const two: ToolCall[] = [command, { ...command, id: "c2" }];
    const h = harness({ steps: [() => response(two), () => finalAnswer()], policy });
    h.deps = {
      ...h.deps,
      confirm: async (request) => {
        seen.push(request);
        change(request, { id: "same" });
        return { decision: "allow_once" };
      },
    };
    await runTask(h.deps);
    assert.deepEqual(
      seen.map((request) => request.id),
      ["q1", "q2"],
    );
    assert.notEqual(seen[0], seen[1]);
    assert.deepEqual(
      h.journal.ofType("confirmation_answered").map((event) => event.id),
      ["q1", "q2"],
    );
  });
});
