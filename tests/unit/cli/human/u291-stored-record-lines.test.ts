/**
 * U-291 (before the CLI migration's C-6a, nc-human's report-c6a-human T-1 and T-2): the renderer's
 * present behaviour, pinned for the inputs C-6a changes. Tests only.
 * - T-1: a stored record (the event with the journal's `seq`, `at` and `runId`, as C-2's append returns
 *   it and as a run event carries it) gives the same progress line as the bare event, for a sample of
 *   every JOURNAL_EVENT_TYPES type, and the same end summary afterwards: the renderer's own state (the
 *   folded protected material checks, the check numbers, the denied calls whose failed result is not
 *   told again) comes out the same.
 * - T-2: the end summary's count fields at 0 or empty give the same text as the fields left out, so a
 *   tally that fills them changes nothing.
 * Both languages with the real catalog. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { JOURNAL_EVENT_TYPES, MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { ContentHash, EngineResult, JournalEvent, MaskedText, RunId, RunSummaryContext } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const RUN = toRunId("20261114T010203Z-0a1b2c3d") as RunId;
const masked = (text: string): MaskedText => text as MaskedText;
const LIMITS = { maxModelTurns: 8, maxToolCalls: 24, maxTotalTokens: null, maxDurationMs: 60_000 };
const USAGE = { modelTurns: 4, toolCalls: 5, inputTokens: null, outputTokens: null, durationMs: 1200 };
const result = (tool: string, ok: boolean, extra: Record<string, unknown>) => ({ callId: "x", tool, ok, ...extra });

/** A run's records, a sample of every type and of the renderer's branches, in a run's order. */
const EVENTS = [
  {
    type: "run_started",
    schemaVersion: 1,
    taskId: "t",
    workflow: masked("general"),
    provider: "scripted",
    limits: LIMITS,
    policyNarrowings: [{ kind: "commands_left_out", count: 2 }],
  },
  { type: "integrity_checked", phase: "run_start", changed: [] },
  { type: "model_request", turn: 1, system: null, newMessages: [] },
  { type: "model_response", turn: 1, stop: "tool_use", text: masked(""), toolCalls: [], usage: null },
  { type: "tool_decision", callId: "c1", tool: "read_file", stage: "policy_effective", allowed: true, permission: null, code: null },
  { type: "tool_result", callId: "c1", result: result("read_file", true, { callId: "c1", content: masked("text") }) },
  { type: "tool_decision", callId: "c2", tool: "write_file", stage: "policy_effective", allowed: false, permission: "path", code: "path_not_writable" },
  { type: "tool_result", callId: "c2", result: result("write_file", false, { callId: "c2", errorCode: "policy_denied", message: masked("refused") }) },
  { type: "tool_decision", callId: "c3", tool: "write_file", stage: "validate", allowed: false, permission: null, code: "invalid_args" },
  { type: "tool_decision", callId: "c4", tool: "not_a_tool", stage: "validate", allowed: false, permission: null, code: "unknown_tool" },
  { type: "tool_decision", callId: "c5", tool: "run_command", stage: "policy_effective", allowed: true, permission: null, code: null },
  { type: "tool_result", callId: "c5", result: result("run_command", true, { callId: "c5", content: masked(JSON.stringify({ exitCode: 2, timedOut: false, stdout: "", stderr: "" })) }) },
  { type: "tool_decision", callId: "c6", tool: "search_files", stage: "policy_effective", allowed: true, permission: null, code: null },
  { type: "tool_result", callId: "c6", result: result("search_files", false, { callId: "c6", errorCode: "io_error", message: masked("cannot read") }) },
  { type: "confirmation_requested", id: "q1", kind: "permission", callId: "c7", tool: "run_command", permission: "command", subject: masked("node"), argumentCount: 1 },
  { type: "confirmation_answered", id: "q1", decision: "deny", by: "default" },
  { type: "tool_decision", callId: "c7", tool: "run_command", stage: "confirm", allowed: false, permission: "command", code: "command_not_allowed" },
  { type: "file_changed", callId: "c8", path: masked("summary.md"), previousHash: null, newHash: "c".repeat(64) as ContentHash, created: true },
  { type: "model_error", turn: 2, kind: "rate_limited", message: masked("slow down") },
  { type: "state_checked", phase: "before_verify", changed: [], limited: true },
  { type: "integrity_checked", phase: "before_verify", changed: [] },
  { type: "verifier_result", result: { id: "has-summary", kind: "file_rules", outcome: "pass", evidence: masked("ok"), checked: [], limits: [] } },
  { type: "verifier_result", result: { id: "says-done", kind: "file_rules", outcome: "fail", evidence: masked("no"), checked: [], limits: [] } },
  { type: "integrity_checked", phase: "after_verify", changed: [] },
  { type: "repair_started", attempt: 1, failedVerifiers: ["says-done"], feedbackTruncated: false },
  { type: "integrity_checked", phase: "before_verify", changed: [] },
  { type: "verifier_result", result: { id: "has-summary", kind: "file_rules", outcome: "pass", evidence: masked("ok"), checked: [], limits: [] } },
  { type: "verifier_result", result: { id: "says-done", kind: "file_rules", outcome: "pass", evidence: masked("ok"), checked: [], limits: [] } },
  { type: "integrity_checked", phase: "after_verify", changed: [] },
  { type: "state_checked", phase: "after_verify", changed: [masked("runs/x/journal.jsonl")], limited: false },
  { type: "run_finished", status: "done", reason: "verified", usage: USAGE },
] as unknown as readonly JournalEvent[];

/** The same records as stored: `{seq, at, runId, ...event}` (C-2's append, a run event's record). */
const RECORDS = EVENTS.map((event, index) => ({ seq: index + 1, at: new Date(Date.UTC(2026, 10, 14, 1, 2, 3, index)).toISOString(), runId: RUN, ...event }));

const ENDED = {
  schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted",
  verifiers: [
    { id: "has-summary", kind: "file_rules", outcome: "pass", evidence: "ok", checked: [], limits: [] },
    { id: "says-done", kind: "file_rules", outcome: "pass", evidence: "ok", checked: [], limits: [] },
  ],
  changes: [{ path: "summary.md", previousHash: null, newHash: "c".repeat(64), created: true }],
  usage: { ...USAGE, repairAttempts: 1 }, journalPath: "x", notices: [], protectedChanged: [],
} as unknown as EngineResult;
const CONTEXT = {
  workspaceForm: "task", configDefault: null, profileApplied: false, deniedToolCalls: 3, deniedCommandCalls: 1, failedToolCalls: 1,
  deniedNotWritable: 1, confirmationDenied: { user: 0, default: 1, cancelled: 0, couldAsk: false }, policySource: "task",
} as unknown as RunSummaryContext;

describe("U-291 T-1: the samples cover every journal record type", () => {
  test("each JOURNAL_EVENT_TYPES type at least once", () => {
    assert.deepEqual([...new Set(EVENTS.map((event) => event.type))].sort(), [...JOURNAL_EVENT_TYPES].sort());
  });
});

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);

  describe(`U-291 T-1 (${language}): a stored record draws as the bare event`, () => {
    test("line by line the same, and the same end summary after them (the renderer's own counts)", () => {
      const bare = createHumanOutput(catalog);
      const stored = createHumanOutput(catalog);
      const bareLines = EVENTS.map((event) => bare.progressLine(event));
      const storedLines = RECORDS.map((record) => stored.progressLine(record as unknown as JournalEvent));
      assert.deepEqual(storedLines, bareLines);
      // The stream draws lines (not only nulls), the folded checks among them.
      assert.ok(bareLines.filter((line) => line !== null).length >= 15, bareLines.join("\n"));
      assert.deepEqual(stored.runSummary(ENDED, CONTEXT), bare.runSummary(ENDED, CONTEXT));
      // The fold: one drawn unchanged check, five counted.
      assert.ok(bare.runSummary(ENDED, CONTEXT).includes(catalog.format("summary.integrity_unchanged", { count: 5 })));
    });
  });

  describe(`U-291 T-2 (${language}): count fields at 0 or empty are as the fields left out`, () => {
    const base = {
      workspaceForm: "task", configDefault: null, profileApplied: false, deniedToolCalls: 2, deniedCommandCalls: 1, failedToolCalls: 0, policySource: "config",
    };
    const zeros: Record<string, unknown>[] = [
      { deniedNotWritable: 0 },
      { deniedNotPlanned: 0 },
      { deniedUnreadable: 0 },
      { failedToolCalls: 0 },
      { confirmationDenied: { user: 0, default: 0, cancelled: 0, couldAsk: true } },
      { confirmationDenied: { user: 0, default: 0, cancelled: 0, couldAsk: false } },
      { policyNarrowings: [] },
      { hiddenGroups: { results: 0, minGroupSize: 5 } },
      {
        deniedNotWritable: 0, deniedNotPlanned: 0, deniedUnreadable: 0, failedToolCalls: 0,
        confirmationDenied: { user: 0, default: 0, cancelled: 0, couldAsk: true }, policyNarrowings: [], hiddenGroups: { results: 0, minGroupSize: 5 },
      },
    ];
    test("each alone and all together: the summary without them", () => {
      const without = createHumanOutput(catalog).runSummary(ENDED, base as unknown as RunSummaryContext);
      for (const extra of zeros) {
        const text = createHumanOutput(catalog).runSummary(ENDED, { ...base, ...extra } as unknown as RunSummaryContext);
        assert.equal(text, without, JSON.stringify(extra));
      }
    });
  });
}
