/**
 * Fix batch T, engine part (decisions T-3, T-5, T-6, T-8 in docs/work-orders/phase-2-repair-loop.md).
 * Inputs follow docs/reviews/2026-11-12-f6-review-*.md (engine findings 1, 2 and 4).
 * Fake model, fake verifiers and a fake privacy gateway (FAKE_SECRET → FAKE_TOKEN). Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_COMMAND_TIMEOUT_MS, MAX_EVIDENCE_BYTES, asRawText } from "../../../src/contracts/index.js";
import type { ModelRequest, RawVerifierResult, VerifierConfig, VerifierOutcome } from "../../../src/contracts/index.js";
import { EVIDENCE_SLACK_BYTES, REPAIR_HEADER, failureSignature, runTask, validateToolArgs } from "../../../src/engine/index.js";
import { COMMAND_CAPTURE_SLACK_BYTES } from "../../../src/tools/index.js";
import { FAKE_SECRET, FAKE_TOKEN, FakeClock, FakeVerifiers, finalAnswer, harness, response } from "./fakes.js";

const RULE = (id: string): VerifierConfig => ({ id, kind: "file_rules", rules: [{ type: "exists", path: "a.txt" }] });

function repairMessage(requests: readonly ModelRequest[], index: number): string {
  const last = requests[index]?.messages.at(-1);
  return last?.role === "user" && last.content.startsWith(REPAIR_HEADER) ? last.content : "";
}

/** Verifier stand-in that can report `evidenceTruncated` and run a hook while "running". */
class ScriptedVerifiers {
  readonly runs: string[] = [];
  constructor(
    private readonly answer: (config: VerifierConfig, round: number) => Omit<RawVerifierResult, "id" | "kind" | "checked" | "limits">,
  ) {}
  async run(config: VerifierConfig): Promise<RawVerifierResult> {
    const round = this.runs.filter((id) => id === config.id).length;
    this.runs.push(config.id);
    return { id: config.id, kind: config.kind, checked: ["the configured rule"], limits: [], ...this.answer(config, round) };
  }
}

/** Two `node --test` outputs from the review (E1): identical failure, different run times. */
const NODE_TEST_RUN_1 = [
  "exit code 1, expected 0",
  "stdout:",
  "✖ empty (0.7457ms)",
  "ℹ tests 1",
  "ℹ fail 1",
  "ℹ duration_ms 57.1315",
].join("\n");
const NODE_TEST_RUN_2 = NODE_TEST_RUN_1.replace("0.7457ms", "0.7406ms").replace("57.1315", "65.6448");

describe("T-3 run_command.timeoutMs has an upper bound", () => {
  const args = (timeoutMs: number) => ({ executable: "node", args: ["--test"], timeoutMs });

  test("the bound itself is accepted, one more millisecond is invalid", () => {
    assert.notEqual(validateToolArgs("run_command", args(MAX_COMMAND_TIMEOUT_MS)), null);
    assert.equal(validateToolArgs("run_command", args(MAX_COMMAND_TIMEOUT_MS + 1)), null);
    assert.equal(validateToolArgs("run_command", args(2 ** 31)), null);
  });

  test("a model call over the bound is invalid_args and is never executed", async () => {
    const h = harness({
      steps: [() => response([{ id: "c1", name: "run_command", args: args(MAX_COMMAND_TIMEOUT_MS + 1) }]), () => finalAnswer()],
    });
    await runTask(h.deps);
    assert.equal(h.tools.executed.length, 0);
    const result = h.journal.ofType("tool_result")[0]?.result;
    assert.equal(result?.ok, false);
    assert.equal(result?.errorCode, "invalid_args");
  });
});

describe("T-5 the failure signature ignores numbers that change from run to run", () => {
  test("two node --test outputs that differ only in run times have one signature", () => {
    assert.equal(
      failureSignature([{ id: "tests", outcome: "fail", evidence: NODE_TEST_RUN_1 as never }]),
      failureSignature([{ id: "tests", outcome: "fail", evidence: NODE_TEST_RUN_2 as never }]),
    );
  });

  test("the review case: the same failing test stops as repeated_failure after one repair", async () => {
    const h = harness({
      steps: Array.from({ length: 8 }, () => () => finalAnswer("done")),
      task: { limits: { maxRepairAttempts: 4, maxSameFailures: 2 } },
      verifiers: new FakeVerifiers({ v1: "fail" }, { v1: [NODE_TEST_RUN_1, NODE_TEST_RUN_2, NODE_TEST_RUN_1] }),
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "repeated_failure");
    assert.equal(result.usage.repairAttempts, 1);
    // The evidence itself is recorded unchanged; only the signature normalizes numbers.
    assert.equal(result.verifiers[0]?.evidence, NODE_TEST_RUN_2);
  });

  test("the verifier id, its outcome and the words of the evidence still tell failures apart", () => {
    const base = failureSignature([{ id: "tests", outcome: "fail", evidence: "✖ empty (1ms)" as never }]);
    assert.notEqual(failureSignature([{ id: "other", outcome: "fail", evidence: "✖ empty (1ms)" as never }]), base);
    assert.notEqual(failureSignature([{ id: "tests", outcome: "inconclusive", evidence: "✖ empty (1ms)" as never }]), base);
    assert.notEqual(failureSignature([{ id: "tests", outcome: "fail", evidence: "✖ full (1ms)" as never }]), base);
  });

  test("numbers inside a privacy token are not normalized: different secrets stay different", () => {
    const one = failureSignature([{ id: "v", outcome: "fail", evidence: "got [[CODARYN_SECRET:0000000000000001]]" as never }]);
    const two = failureSignature([{ id: "v", outcome: "fail", evidence: "got [[CODARYN_SECRET:0000000000000002]]" as never }]);
    assert.notEqual(one, two);
  });

  test("V-1 narrows T-5: a change in counts is a new failure, and its repeat still stops", async () => {
    // T-5 normalized every number, so "3 failing" then "1 failing" stopped after one repair.
    // V-1 keeps counts: round 2 is a new failure (repaired), round 3 repeats it (stops).
    const h = harness({
      steps: Array.from({ length: 5 }, () => () => finalAnswer()),
      task: { limits: { maxRepairAttempts: 5 } },
      verifiers: new FakeVerifiers({ v1: "fail" }, { v1: ["3 failing", "1 failing"] }),
    });
    const result = await runTask(h.deps);
    assert.equal(result.reason, "repeated_failure");
    assert.equal(result.usage.repairAttempts, 2);
  });
});

describe("T-6 evidence is masked, then cut; a runner cut drops the trailing slack first", () => {
  const STDOUT = "exit code 1, expected 0\nstdout:\n";

  test("the engine's slack equals the command runner's capture slack", () => {
    // Guards the two values against drifting apart (the engine may not import src/tools).
    assert.equal(EVIDENCE_SLACK_BYTES, COMMAND_CAPTURE_SLACK_BYTES);
  });

  test("a secret cut at the end of a truncated capture leaves no part in the record or the repair message", async () => {
    const partial = FAKE_SECRET.slice(0, FAKE_SECRET.length - 4);
    const evidence = `${STDOUT}${"x".repeat(70_000)}${partial}`;
    const h = harness({
      steps: [() => finalAnswer(), () => finalAnswer()],
      task: { limits: { maxRepairAttempts: 1 } },
      verifiers: new ScriptedVerifiers((_config, round) => ({
        outcome: round === 0 ? "fail" : "pass",
        evidence: asRawText(evidence),
        evidenceTruncated: true,
      })) as unknown as FakeVerifiers,
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "done");
    for (const [label, text] of [
      ["journal", JSON.stringify(h.journal.events)],
      ["model requests", JSON.stringify(h.model.requests)],
      ["result", JSON.stringify(result)],
    ] as const) {
      assert.equal(text.includes(partial.slice(0, 8)), false, `${label} holds a part of the cut secret`);
    }
    const recorded = h.journal.ofType("verifier_result")[0]?.result.evidence ?? "";
    assert.ok(Buffer.byteLength(recorded, "utf8") <= MAX_EVIDENCE_BYTES, `recorded ${Buffer.byteLength(recorded)} bytes`);
    assert.ok(recorded.startsWith(STDOUT), "the head is kept");
  });

  test("recorded evidence is masked first and then cut to MAX_EVIDENCE_BYTES, head and tail kept", async () => {
    const evidence = `head ${FAKE_SECRET} start\n${"y".repeat(50_000)}\nsummary ${FAKE_SECRET} end`;
    const h = harness({
      steps: [() => finalAnswer()],
      verifiers: new FakeVerifiers({ v1: "pass" }, { v1: evidence }),
    });
    const result = await runTask(h.deps);
    const recorded = result.verifiers[0]?.evidence ?? "";
    assert.ok(Buffer.byteLength(recorded, "utf8") <= MAX_EVIDENCE_BYTES);
    assert.ok(recorded.includes(`head ${FAKE_TOKEN} start`));
    assert.ok(recorded.includes(`summary ${FAKE_TOKEN} end`));
    assert.match(recorded, /\[\.\.\. \d+ bytes omitted \.\.\.\]/);
    assert.equal(JSON.stringify(h.journal.events).includes(FAKE_SECRET), false);
    assert.equal(h.journal.ofType("verifier_result")[0]?.result.evidence, recorded);
  });

  test("the repair message is built from the same masked, cut evidence as the record", async () => {
    const evidence = `head ${FAKE_SECRET}\n${"z".repeat(30_000)}\ntail ${FAKE_SECRET}`;
    const h = harness({
      steps: [() => finalAnswer(), () => finalAnswer()],
      task: { limits: { maxRepairAttempts: 1 } },
      verifiers: new FakeVerifiers({ v1: ["fail", "pass"] }, { v1: evidence }),
    });
    await runTask(h.deps);
    const recorded = h.journal.ofType("verifier_result")[0]?.result.evidence ?? "";
    const message = repairMessage(h.model.requests, 1);
    assert.ok(message.endsWith(`Evidence:\n${recorded}`), "the message carries the recorded evidence as is");
    assert.equal(h.journal.ofType("repair_started")[0]?.feedbackTruncated, true);
  });
});

describe("T-8 a duration limit that ends during verification is budget-exhausted/max_duration", () => {
  const slowLast = (clock: FakeClock, outcomes: Record<string, VerifierOutcome>) =>
    new ScriptedVerifiers((config) => {
      if (config.id === "slow") {
        // The deadline passes while this verifier runs; the runner reports the abort as inconclusive.
        clock.t = 10_000;
        return { outcome: "inconclusive", evidence: asRawText("cancelled while the command was running") };
      }
      return { outcome: outcomes[config.id] ?? "pass", evidence: asRawText("evidence") };
    });

  test("the review case: the last verifier is cut by the deadline", async () => {
    const clock = new FakeClock();
    const h = harness({
      steps: [() => finalAnswer()],
      clock,
      task: { verifiers: [RULE("slow")], limits: { maxDurationMs: 3_000, maxRepairAttempts: 2 } },
      verifiers: slowLast(clock, {}) as unknown as FakeVerifiers,
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "budget-exhausted");
    assert.equal(result.reason, "max_duration");
    assert.equal(result.exitCode, 4);
    assert.equal(h.journal.ofType("repair_started").length, 0);
  });

  test("a failure before the cut verifier does not turn into failed or a repair", async () => {
    const clock = new FakeClock();
    const h = harness({
      steps: [() => finalAnswer(), () => finalAnswer()],
      clock,
      task: { verifiers: [RULE("first"), RULE("slow")], limits: { maxDurationMs: 3_000, maxRepairAttempts: 2 } },
      verifiers: slowLast(clock, { first: "fail" }) as unknown as FakeVerifiers,
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "budget-exhausted");
    assert.equal(result.reason, "max_duration");
    assert.equal(h.model.requests.length, 1);
  });

  test("a user cancel during the last verifier stays cancelled", async () => {
    let controller: AbortController | undefined;
    const h = harness({
      steps: [() => finalAnswer()],
      task: { verifiers: [RULE("slow")] },
      verifiers: new ScriptedVerifiers(() => {
        controller?.abort();
        return { outcome: "inconclusive", evidence: asRawText("cancelled while the command was running") };
      }) as unknown as FakeVerifiers,
    });
    controller = h.controller;
    const result = await runTask(h.deps);
    assert.equal(result.status, "cancelled");
  });
});
