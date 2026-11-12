/**
 * G-G report (integration case n07): report refused a run whose verifiers included `data_checks`
 * ("a record has an unknown value"), since its own list of verifier kinds was hand-written. It now
 * takes the contract's lists (VERIFIER_KINDS), and checks its remaining local lists against the
 * contract's types at compile time.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { VERIFIER_KINDS } from "../../../src/contracts/index.js";
import { readResult, summarizeJournal } from "../../../src/cli/report.js";

const RUN = "20261112T060000Z-0000abcd";
const verifier = (kind: string) => ({ id: `v-${kind}`, kind, outcome: "pass", evidence: "", checked: [], limits: [] });

function result(verifiers: unknown[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "run",
    runId: RUN,
    taskId: "t",
    status: "done",
    reason: "verified",
    exitCode: 0,
    provider: "scripted",
    verifiers,
    changes: [],
    usage: { modelTurns: 1, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 1 },
    journalPath: `.codaryn/runs/${RUN}/journal.jsonl`,
    notices: [],
  });
}

describe("report reads every verifier kind of the contract", () => {
  test("result.json with data_checks and inventory results is read", () => {
    for (const kind of VERIFIER_KINDS) {
      const read = readResult(result([verifier(kind)]), RUN, "t");
      assert.equal(read.verifiers[0]?.kind, kind);
    }
  });

  test("the journal's verifier_result records of every kind are read", () => {
    const lines = [
      { type: "run_started", runId: RUN, seq: 1, at: "2026-11-12T06:00:00.000Z", schemaVersion: 1, taskId: "t", workflow: "label", provider: "scripted", limits: { maxModelTurns: 1, maxToolCalls: 1, maxTotalTokens: null, maxDurationMs: 1 } },
      ...VERIFIER_KINDS.map((kind, index) => ({ type: "verifier_result", runId: RUN, seq: index + 2, at: "2026-11-12T06:00:01.000Z", result: verifier(kind) })),
    ];
    const summary = summarizeJournal(`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, RUN, false);
    assert.deepEqual(summary.lastRound.map((item) => item.kind), [...VERIFIER_KINDS]);
  });

  test("an unknown kind is still refused", () => {
    assert.throws(() => readResult(result([verifier("shell")]), RUN, "t"), /unknown value/);
  });
});
