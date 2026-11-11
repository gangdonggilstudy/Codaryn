/**
 * Phase 2 repair loop (R-1 to R-4): EN-04, EN-08, limits over the whole run, inconclusive is not
 * repaired, maxRepairAttempts 0 keeps the phase 1 behaviour, and the state transitions.
 * Fake model, fake verifiers and a fake privacy gateway (FAKE_SECRET → FAKE_TOKEN). Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_FEEDBACK_BYTES } from "../../../src/contracts/index.js";
import type { JournalEvent, ModelMessage, ModelRequest, VerifierConfig } from "../../../src/contracts/index.js";
import { REPAIR_HEADER, cutMiddle, failureSignature, runTask } from "../../../src/engine/index.js";
import {
  FAKE_SECRET,
  FAKE_TOKEN,
  FakeVerifiers,
  fakePrivacy,
  finalAnswer,
  harness,
  readCall,
  response,
} from "./fakes.js";

const RULE = (id: string): VerifierConfig => ({ id, kind: "file_rules", rules: [{ type: "exists", path: "a.txt" }] });

/** The repair message the model received in request `index` (0-based), or "" when there is none. */
function repairMessage(requests: readonly ModelRequest[], index: number): string {
  const last = requests[index]?.messages.at(-1);
  return last?.role === "user" && last.content.startsWith(REPAIR_HEADER) ? last.content : "";
}

function types(events: readonly JournalEvent[]): string[] {
  return events.map((event) => event.type);
}

describe("R-1 a failed verification goes back to the model", () => {
  test("fail → repair → pass ends as done after one repair", async () => {
    const h = harness({
      steps: [() => finalAnswer("first try"), () => response([readCall("r1")]), () => finalAnswer("fixed")],
      task: { limits: { maxRepairAttempts: 2 } },
      verifiers: new FakeVerifiers({ v1: ["fail", "pass"] }, { v1: ["missing a.txt", "a.txt exists"] }),
    });
    const result = await runTask(h.deps);

    assert.equal(result.status, "done");
    assert.equal(result.reason, "verified");
    assert.equal(result.usage.repairAttempts, 1);
    assert.equal(result.usage.modelTurns, 3);
    assert.deepEqual(h.verifiers.runs, ["v1", "v1"]);
    // The result holds the latest verification round only.
    assert.deepEqual(result.verifiers.map((verifier) => verifier.outcome), ["pass"]);

    // The second request carries the model's own final reply, then the repair message.
    const second = h.model.requests[1]?.messages ?? [];
    const reply = second.at(-2) as ModelMessage | undefined;
    assert.equal(reply?.role === "assistant" ? reply.text : "", "first try");
    const message = repairMessage(h.model.requests, 1);
    assert.ok(message.includes('Verifier "v1" outcome: fail'));
    assert.ok(message.includes("missing a.txt"));
    assert.ok(message.includes("Repair attempt 1 of 2."));

    const started = h.journal.ofType("repair_started");
    assert.deepEqual(started, [{ type: "repair_started", attempt: 1, failedVerifiers: ["v1"], feedbackTruncated: false }]);
    // verifying → running → verifying: the repair is recorded between the two rounds,
    // before the request that carries it.
    assert.deepEqual(types(h.journal.events), [
      "run_started",
      "model_request",
      "model_response",
      "verifier_result",
      "repair_started",
      "model_request",
      "model_response",
      "tool_decision",
      "tool_result",
      "model_request",
      "model_response",
      "verifier_result",
      "run_finished",
    ]);
    const repairRequest = h.journal.ofType("model_request")[1];
    assert.deepEqual(repairRequest?.newMessages.map((item) => item.role), ["assistant", "user"]);
    assert.equal(h.journal.ofType("run_finished")[0]?.usage.repairAttempts, 1);
  });

  test("only the failed verifiers are sent, in task order", async () => {
    const h = harness({
      steps: [() => finalAnswer(), () => finalAnswer()],
      task: { verifiers: [RULE("first"), RULE("second"), RULE("third")], limits: { maxRepairAttempts: 1 } },
      verifiers: new FakeVerifiers({ first: "fail", second: "pass", third: ["fail", "pass"] }, { first: ["e1", "e1b"] }),
    });
    await runTask(h.deps);
    const message = repairMessage(h.model.requests, 1);
    assert.ok(message.includes('Verifier "first"'));
    assert.ok(message.includes('Verifier "third"'));
    assert.equal(message.includes('Verifier "second"'), false);
    assert.ok(message.indexOf('"first"') < message.indexOf('"third"'));
    assert.deepEqual(h.journal.ofType("repair_started")[0]?.failedVerifiers, ["first", "third"]);
  });
});

describe("R-2 the repair limit", () => {
  test("maxRepairAttempts 0 keeps the phase 1 behaviour: failed at the first failure, no repair", async () => {
    const h = harness({ steps: [() => finalAnswer(), () => finalAnswer()], verifiers: new FakeVerifiers({ v1: "fail" }) });
    const result = await runTask(h.deps);
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "verifier_failed");
    assert.equal(result.exitCode, 1);
    assert.equal(result.usage.repairAttempts, 0);
    assert.equal(h.model.requests.length, 1);
    assert.equal(h.journal.ofType("repair_started").length, 0);
  });

  test("when every repair is used and it still fails, the run is failed/verifier_failed", async () => {
    const h = harness({
      steps: [() => finalAnswer(), () => finalAnswer(), () => finalAnswer(), () => finalAnswer()],
      task: { limits: { maxRepairAttempts: 2, maxSameFailures: 5 } },
      // Different evidence each round, so this is not a repeated failure.
      verifiers: new FakeVerifiers({ v1: "fail" }, { v1: ["one", "two", "three"] }),
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "verifier_failed");
    assert.equal(result.usage.repairAttempts, 2);
    assert.equal(h.model.requests.length, 3);
    assert.deepEqual(h.journal.ofType("repair_started").map((event) => event.attempt), [1, 2]);
    assert.equal(h.verifiers.runs.length, 3);
  });

  test("the budget limits cover the whole run: no repair starts when no model turn is left", async () => {
    const h = harness({
      steps: [() => finalAnswer(), () => finalAnswer(), () => finalAnswer()],
      task: { limits: { maxModelTurns: 2, maxRepairAttempts: 5, maxSameFailures: 5 } },
      verifiers: new FakeVerifiers({ v1: "fail" }, { v1: ["one", "two", "three"] }),
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "budget-exhausted");
    assert.equal(result.reason, "max_model_turns");
    assert.equal(result.usage.repairAttempts, 1);
    assert.equal(h.model.requests.length, 2);
    assert.equal(h.journal.ofType("repair_started").length, 1);
    // The latest completed round is kept in the result.
    assert.deepEqual(result.verifiers.map((verifier) => verifier.outcome), ["fail"]);
  });

  test("tool calls made before and after a repair count toward one maxToolCalls", async () => {
    const h = harness({
      steps: [() => response([readCall("r1")]), () => finalAnswer(), () => response([readCall("r2")]), () => finalAnswer()],
      task: { limits: { maxToolCalls: 1, maxRepairAttempts: 1 } },
      verifiers: new FakeVerifiers({ v1: ["fail", "pass"] }),
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "budget-exhausted");
    assert.equal(result.reason, "max_tool_calls");
    assert.equal(result.usage.toolCalls, 1);
  });
});

describe("R-1 a verifier that cannot decide is not repaired", () => {
  test("inconclusive alone ends as needs-input without a repair", async () => {
    const h = harness({
      steps: [() => finalAnswer(), () => finalAnswer()],
      task: { limits: { maxRepairAttempts: 3 } },
      verifiers: new FakeVerifiers({ v1: "inconclusive" }),
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "needs-input");
    assert.equal(result.reason, "verifier_inconclusive");
    assert.equal(h.model.requests.length, 1);
    assert.equal(h.journal.ofType("repair_started").length, 0);
  });

  test("a failure next to an inconclusive verifier ends as failed without a repair", async () => {
    const h = harness({
      steps: [() => finalAnswer(), () => finalAnswer()],
      task: { verifiers: [RULE("v1"), RULE("v2")], limits: { maxRepairAttempts: 3 } },
      verifiers: new FakeVerifiers({ v1: "fail", v2: "inconclusive" }),
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "verifier_failed");
    assert.equal(h.model.requests.length, 1);
    assert.equal(result.usage.repairAttempts, 0);
  });
});

describe("EN-04 the same failure in a row stops the loop (R-3)", () => {
  test("with maxSameFailures 2 the same failure is repaired once, then failed/repeated_failure", async () => {
    const h = harness({
      steps: [() => finalAnswer(), () => finalAnswer(), () => finalAnswer()],
      task: { limits: { maxRepairAttempts: 5 } },
      verifiers: new FakeVerifiers({ v1: "fail" }, { v1: "expected 3, got 2" }),
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "repeated_failure");
    assert.equal(result.exitCode, 1);
    assert.equal(result.usage.repairAttempts, 1);
    assert.equal(h.model.requests.length, 2);
    // The failure evidence is reported in the result.
    assert.equal(result.verifiers[0]?.evidence, "expected 3, got 2");
  });

  test("a failure that changes is not a repeat", async () => {
    const h = harness({
      steps: [() => finalAnswer(), () => finalAnswer(), () => finalAnswer()],
      task: { limits: { maxRepairAttempts: 5 } },
      verifiers: new FakeVerifiers({ v1: ["fail", "fail", "pass"] }, { v1: ["3 failing", "1 failing", "ok"] }),
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "done");
    assert.equal(result.usage.repairAttempts, 2);
  });

  test("a repeat after a different failure starts a new count", async () => {
    const h = harness({
      steps: Array.from({ length: 6 }, () => () => finalAnswer()),
      task: { limits: { maxRepairAttempts: 5 } },
      verifiers: new FakeVerifiers({ v1: "fail" }, { v1: ["A", "B", "A", "A"] }),
    });
    const result = await runTask(h.deps);
    assert.equal(result.reason, "repeated_failure");
    // A, B, A are all new in a row; the second A in a row stops it.
    assert.equal(result.usage.repairAttempts, 3);
  });

  test("maxSameFailures 3 repairs the same failure twice", async () => {
    const h = harness({
      steps: Array.from({ length: 5 }, () => () => finalAnswer()),
      task: { limits: { maxRepairAttempts: 5, maxSameFailures: 3 } },
      verifiers: new FakeVerifiers({ v1: "fail" }, { v1: "same" }),
    });
    const result = await runTask(h.deps);
    assert.equal(result.reason, "repeated_failure");
    assert.equal(result.usage.repairAttempts, 2);
  });

  test("an exhausted repair limit wins over a repeat", async () => {
    const h = harness({
      steps: [() => finalAnswer(), () => finalAnswer()],
      task: { limits: { maxRepairAttempts: 1 } },
      verifiers: new FakeVerifiers({ v1: "fail" }, { v1: "same" }),
    });
    const result = await runTask(h.deps);
    assert.equal(result.reason, "verifier_failed");
    assert.equal(result.usage.repairAttempts, 1);
  });

  test("the signature covers the verifier id and its masked evidence", () => {
    const base = failureSignature([{ id: "v1", evidence: "x" as never }]);
    assert.match(base, /^[0-9a-f]{64}$/);
    assert.equal(failureSignature([{ id: "v1", evidence: "x" as never }]), base);
    assert.notEqual(failureSignature([{ id: "v2", evidence: "x" as never }]), base);
    assert.notEqual(failureSignature([{ id: "v1", evidence: "y" as never }]), base);
  });
});

describe("EN-08 failure evidence is masked, then cut (R-4)", () => {
  test("a long evidence with a secret reaches the model masked, cut and marked", async () => {
    const head = `head ${FAKE_SECRET} start\n`;
    const tail = `\nsummary: 1 failed ${FAKE_SECRET}`;
    const evidence = `${head}${"x".repeat(20_000)}${tail}`;
    const h = harness({
      steps: [() => finalAnswer(), () => finalAnswer()],
      task: { limits: { maxRepairAttempts: 1 } },
      verifiers: new FakeVerifiers({ v1: ["fail", "pass"] }, { v1: evidence }),
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "done");

    const message = repairMessage(h.model.requests, 1);
    assert.ok(message.length > 0);
    assert.equal(message.includes(FAKE_SECRET), false);
    assert.equal(JSON.stringify(h.model.requests).includes(FAKE_SECRET), false);
    assert.equal(JSON.stringify(h.journal.events).includes(FAKE_SECRET), false);
    assert.ok(message.includes(`head ${FAKE_TOKEN} start`), "the head is kept");
    assert.ok(message.includes(`summary: 1 failed ${FAKE_TOKEN}`), "the tail is kept");
    assert.match(message, /\[\.\.\. \d+ bytes omitted \.\.\.\]/);
    const evidencePart = message.slice(message.indexOf("Evidence:\n") + "Evidence:\n".length);
    assert.ok(Buffer.byteLength(evidencePart, "utf8") <= MAX_FEEDBACK_BYTES);
    assert.equal(h.journal.ofType("repair_started")[0]?.feedbackTruncated, true);
  });

  test("failed verifiers share the bound equally", async () => {
    const h = harness({
      steps: [() => finalAnswer(), () => finalAnswer()],
      task: { verifiers: [RULE("v1"), RULE("v2")], limits: { maxRepairAttempts: 1 } },
      verifiers: new FakeVerifiers({ v1: ["fail", "pass"], v2: ["fail", "pass"] }, { v1: "a".repeat(5000), v2: "b".repeat(3000) }),
    });
    await runTask(h.deps);
    const message = repairMessage(h.model.requests, 1);
    const parts = message.split("Evidence:\n").slice(1).map((part) => part.split("\n\nVerifier ")[0] ?? "");
    assert.equal(parts.length, 2);
    // 5000 bytes is over the 4096-byte share and is cut; 3000 bytes fits.
    assert.ok(Buffer.byteLength(parts[0] ?? "", "utf8") <= MAX_FEEDBACK_BYTES / 2);
    assert.ok(parts[0]?.includes("bytes omitted"));
    assert.equal(parts[1], "b".repeat(3000));
  });

  test("a masking failure of the repair message sends and records nothing more", async () => {
    const h = harness({
      privacy: fakePrivacy({ failWhen: (text) => text.startsWith(REPAIR_HEADER) }),
      steps: [() => finalAnswer(), () => finalAnswer()],
      task: { limits: { maxRepairAttempts: 1 } },
      verifiers: new FakeVerifiers({ v1: "fail" }),
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "model_error");
    assert.equal(h.model.requests.length, 1);
    assert.equal(h.journal.ofType("repair_started").length, 0);
  });
});

describe("cutMiddle", () => {
  const TOKEN = "[[CODARYN_SECRET:0123456789abcdef]]";

  test("text within the bound is unchanged", () => {
    assert.deepEqual(cutMiddle("short", 5), { text: "short", truncated: false });
  });

  test("keeps the head and the tail, reports the omitted bytes and fits the bound", () => {
    const text = `${"h".repeat(500)}${"m".repeat(2000)}${"t".repeat(500)}`;
    const cut = cutMiddle(text, 400);
    assert.equal(cut.truncated, true);
    assert.ok(Buffer.byteLength(cut.text, "utf8") <= 400);
    const match = /\n\[\.\.\. (\d+) bytes omitted \.\.\.\]\n/.exec(cut.text);
    assert.ok(match !== null);
    const [head, tail] = cut.text.split(match[0]);
    assert.ok(text.startsWith(head ?? "!"));
    assert.ok(text.endsWith(tail ?? "!"));
    assert.equal(Number(match[1]), 3000 - (head?.length ?? 0) - (tail?.length ?? 0));
  });

  test("never cuts inside a privacy token", () => {
    const NOTE = /\n\[\.\.\. \d+ bytes omitted \.\.\.\]\n/;
    const WHOLE = /\[\[CODARYN_SECRET:[0-9a-f]{16}\]\]/g;
    for (let offset = 0; offset < 60; offset += 1) {
      const text = `${"a".repeat(offset)}${TOKEN}${"b".repeat(300)}${TOKEN}${"c".repeat(offset)}`;
      const cut = cutMiddle(text, 120);
      assert.equal(cut.truncated, true);
      // Outside whole tokens and the note, nothing of a token may be left.
      for (const side of cut.text.split(NOTE)) {
        const rest = side.replace(WHOLE, "");
        assert.equal(/[[\]:]|CODARYN|SECRET|0123|cdef/.test(rest), false, `offset ${offset}: a token was cut in ${JSON.stringify(side)}`);
      }
    }
  });

  test("never splits a character", () => {
    const text = `${"가".repeat(400)}${"😀".repeat(400)}`;
    for (const bound of [101, 102, 103, 250, 257]) {
      const cut = cutMiddle(text, bound);
      assert.ok(Buffer.byteLength(cut.text, "utf8") <= bound, `bound ${bound}`);
      assert.equal(Buffer.from(cut.text, "utf8").toString("utf8"), cut.text, `bound ${bound}: lone surrogate`);
      assert.equal(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(cut.text), false);
    }
  });
});
