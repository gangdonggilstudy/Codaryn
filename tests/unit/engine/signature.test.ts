/**
 * V-1 (docs/work-orders/phase-3-self-development.md, L1 fix batch): the failure signature
 * normalizes only values that change from run to run (times with a unit, duration/elapsed/time
 * keys, dates and clock times, hex of 8 or more digits). Line and column numbers and the
 * actual/expected values stay, so a failure that moves to another assertion is a new failure.
 *
 * Input: the L1-1 review case (docs/reviews/2026-11-12-l1-final-review.md). The two evidences are
 * real `node --test` outputs (Node 26.13) of that cart test, wrapped the way the command verifier
 * wraps them; the workspace path is replaced by a fake one. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { failureSignature, normalizeVolatile, runTask } from "../../../src/engine/index.js";
import { FakeVerifiers, finalAnswer, harness } from "./fakes.js";

function nodeTestEvidence(runMs: string, durationMs: string, failure: { line: number; actual: string; expected: string }): string {
  return [
    "exit code 1, expected 0",
    "stdout:",
    `✖ cart totals (${runMs}ms)`,
    "ℹ tests 1",
    "ℹ suites 0",
    "ℹ pass 0",
    "ℹ fail 1",
    "ℹ cancelled 0",
    "ℹ skipped 0",
    "ℹ todo 0",
    `ℹ duration_ms ${durationMs}`,
    "",
    "✖ failing tests:",
    "",
    "test at test\\calc.test.js:5:1",
    `✖ cart totals (${runMs}ms)`,
    "  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
    "  ",
    `  ${failure.actual} !== ${failure.expected}`,
    "  ",
    `      at TestContext.<anonymous> (file:///D:/work/calc/test/calc.test.js:${failure.line}:10)`,
    "      at Test.runInAsyncScope (node:async_hooks:226:14)",
    "      at Test.run (node:internal/test_runner/test:1402:25)",
    "      at Test.start (node:internal/test_runner/test:1262:17)",
    "      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) {",
    "    generatedMessage: true,",
    "    code: 'ERR_ASSERTION',",
    `    actual: ${failure.actual},`,
    `    expected: ${failure.expected},`,
    "    operator: 'strictEqual',",
    "    diff: 'simple'",
    "  }",
  ].join("\n");
}

/** Round 1: the quantity bug (line 6). Round 2: the quantity fixed, the discount fails (line 7). */
const ROUND_1 = nodeTestEvidence("0.8988", "83.1597", { line: 6, actual: "300", expected: "600" });
const ROUND_2 = nodeTestEvidence("1.0495", "81.5706", { line: 7, actual: "999.9", expected: "900" });
/** Round 1 again, as a later run prints it: only the run times differ. */
const ROUND_1_AGAIN = nodeTestEvidence("1.4410", "97.0042", { line: 6, actual: "300", expected: "600" });

const sig = (evidence: string, id = "tests"): string =>
  failureSignature([{ id, outcome: "fail", evidence: evidence as never }]);

describe("V-1 a failure that moves to another assertion is a new failure", () => {
  test("the same test failing at another assertion line has another signature (L1-1 input)", () => {
    assert.notEqual(sig(ROUND_1), sig(ROUND_2));
  });

  test("the review run: with maxSameFailures 2 the run keeps repairing and ends done", async () => {
    // Before V-1: failed/repeated_failure after one repair, with two repairs left.
    const h = harness({
      steps: Array.from({ length: 4 }, () => () => finalAnswer()),
      task: { limits: { maxRepairAttempts: 3 } },
      verifiers: new FakeVerifiers({ v1: ["fail", "fail", "pass"] }, { v1: [ROUND_1, ROUND_2, "ok"] }),
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "done");
    assert.equal(result.reason, "verified");
    assert.equal(result.usage.repairAttempts, 2);
  });

  test("only the line number differs: different failures", () => {
    assert.notEqual(sig("at f (file:///D:/w/a.test.js:6:10)"), sig("at f (file:///D:/w/a.test.js:7:10)"));
  });

  test("only the actual value differs: different failures", () => {
    assert.notEqual(sig("actual: 300,\nexpected: 600,"), sig("actual: 450,\nexpected: 600,"));
  });

  test("test names that differ in a number are different failures", () => {
    assert.notEqual(sig("✖ case 1 (0.51ms)\ntest at t.test.js:3:1"), sig("✖ case 2 (0.62ms)\ntest at t.test.js:3:1"));
  });

  test("counts are kept: 3 failing and 1 failing are different failures", () => {
    assert.notEqual(sig("3 failing"), sig("1 failing"));
  });
});

describe("V-1 values that change from run to run are still normalized (T-5 kept)", () => {
  test("two node --test outputs that differ only in run times have one signature", () => {
    assert.equal(sig(ROUND_1), sig(ROUND_1_AGAIN));
  });

  test("the same failure repeated with other run times stops as repeated_failure", async () => {
    const h = harness({
      steps: Array.from({ length: 4 }, () => () => finalAnswer()),
      task: { limits: { maxRepairAttempts: 3 } },
      verifiers: new FakeVerifiers({ v1: "fail" }, { v1: [ROUND_1, ROUND_1_AGAIN] }),
    });
    const result = await runTask(h.deps);
    assert.equal(result.reason, "repeated_failure");
    assert.equal(result.usage.repairAttempts, 1);
  });

  const normalized: readonly (readonly [string, string])[] = [
    ["✖ empty (0.7457ms)", "✖ empty (#ms)"],
    ["took 1.5s", "took #s"],
    ["took 1.5 s.", "took # s."],
    ["waited 250µs", "waited #µs"],
    ["waited 250μs", "waited #μs"],
    ["spent 12ns", "spent #ns"],
    ["ℹ duration_ms 83.1597", "ℹ duration_ms #"],
    ["  duration_ms: 0.8988", "  duration_ms: #"],
    ['{"duration":12,"durationMs":3.5}', '{"duration":#,"durationMs":#}'],
    ["elapsed=34", "elapsed=#"],
    ["elapsedTime: 5.5", "elapsedTime: #"],
    ["time: 17", "time: #"],
    ['"startTime": 1731398400000', '"startTime": #'],
    ["timestamp=1731398400", "timestamp=#"],
    ["at 2026-11-12T07:37:48.123Z done", "at # done"],
    ["at 2026-11-12 07:37:48 done", "at # done"],
    ["on 2026-11-12 only", "on # only"],
    ["[07:37:48] started", "[#] started"],
    ["[07:37:48.123] started", "[#] started"],
    ["run 20261112T031500Z-9f2c41ab", "run #-#"],
    ["object at 0x7ff6a1b2c3d4", "object at #"],
    ["address 000001F2A3B4C5D6", "address #"],
    ["id deadbeef01", "id #"],
  ];
  for (const [input, expected] of normalized) {
    test(`normalizes ${JSON.stringify(input)}`, () => {
      assert.equal(normalizeVolatile(input), expected);
    });
  }

  const kept: readonly string[] = [
    "calc.test.js:6:10",
    "test at test\\calc.test.js:5:1",
    "at Test.run (node:internal/test_runner/test:1402:25)",
    "300 !== 600",
    "999.9 !== 900",
    "actual: 300,\nexpected: 600,",
    "3 failing",
    "ℹ tests 1\nℹ pass 0\nℹ fail 1",
    "✖ case 2",
    "expected 12345678 to equal 12345679",
    "timeoutMs: 5000",
    "called 3 times",
    "abcdef1",
    "1:23",
    "token [[CODARYN_SECRET:00000000000000aa]] stays",
  ];
  for (const input of kept) {
    test(`keeps ${JSON.stringify(input)}`, () => {
      assert.equal(normalizeVolatile(input), input);
    });
  }

  test("a privacy token next to a time value stays whole", () => {
    assert.equal(
      normalizeVolatile("[[CODARYN_SECRET:00000000000000aa]] 12ms 0x1234abcd99"),
      "[[CODARYN_SECRET:00000000000000aa]] #ms #",
    );
  });
});
