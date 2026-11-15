import assert from "node:assert/strict";
import type { ApplyReportOutput, EngineResult, RunReportOutput } from "../../../src/contracts/index.js";
import { asRawText } from "../../../src/contracts/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
const gateway = createPrivacyGateway({ secrets: [] });
export function masked(value: string) {
  const result = gateway.mask(asRawText(value)); assert.ok(result.ok); return result.text;
}
export function runFixture(): RunReportOutput {
  return {
    schemaVersion: 1, kind: "report", runId: "r", status: "incomplete", exitCode: 3, result: null,
    journal: { taskId: "task", workflow: masked("coding"), provider: "scripted", records: 1,
      limits: { maxModelTurns: 2, maxToolCalls: 3, maxTotalTokens: null, maxDurationMs: 10 },
      modelRequests: 0, deniedToolCalls: 0, repairs: 0, lastRound: [], changes: [], integrityChecks: [], finished: null },
  };
}
export function engineResult(text = "model words"): EngineResult {
  return { schemaVersion: 1, kind: "run", runId: "r", taskId: "task", provider: "scripted", status: "done", reason: "verified", exitCode: 0,
    verifiers: [], changes: [], notices: [], journalPath: "journal.jsonl",
    usage: { modelTurns: 1, toolCalls: 0, inputTokens: null, outputTokens: null, durationMs: 1 },
    finalMessage: { text: masked(text), truncated: false } };
}
export function applyFixture(): ApplyReportOutput {
  return { schemaVersion: 1, kind: "report", runKind: "apply", runId: "a", status: "incomplete", exitCode: 3, result: null,
    journal: { planRunId: "p", taskId: "task", digest: "abc", approval: "cli-flag", unsafeMoveConsent: null,
      actions: 0, maxDurationMs: 10, records: 1, checked: null, started: 0, moved: [], discarded: [], failed: [], lastRound: [], integrityChecks: [], finished: null } };
}
export function completedApply(): ApplyReportOutput {
  const report = applyFixture();
  return { ...report, status: "complete", exitCode: 0,
    result: { schemaVersion: 1, kind: "apply", runId: "a", planRunId: "p", taskId: "task", digest: "abc", status: "done", reason: "verified", exitCode: 0,
      applied: [], verifiers: [], notices: [masked("original notice")], journalPath: "journal.jsonl",
      usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 1 } },
    journal: { ...report.journal, checked: { problems: 1, inventoryLimitReached: true, unsafeMoves: 1 }, actions: 4, started: 4,
      moved: [{ index: 2, from: masked("src"), to: masked("dst"), unsafe: true }],
      discarded: [{ index: 0, path: masked("old"), stored: "saved" }], failed: [{ index: 1, problem: "source_missing" }],
      integrityChecks: [{ phase: "run_start", changed: [] }, { phase: "after_verify", changed: [] }] } };
}
