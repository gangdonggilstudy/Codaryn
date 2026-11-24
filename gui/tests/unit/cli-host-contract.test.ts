/**
 * Contract-layer cases after CP53 (standalone-gui 8.3, 12): the same run through the real CLI and a
 * separate real engine host ends the same way, with the same stored result and journal.
 *
 * 이 시험이 다루지 않는 계약 분기 (adapter-contract 5.9; standalone-gui 12절의 남은 범위):
 * - 사람의 거부: `confirmation_answered {decision: "deny", by: "user"}` (의미 3). The CLI asks in a
 *   terminal only, and a CLI child without one dismisses (C-4 covers that default deny).
 * - 질문 중 취소: `by: "cancelled"`, the run `cancelled` (의미 7). C-3 cancels during a model request,
 *   not during a question; it is no stand-in for this branch.
 * - 질문 대기의 시간 한도: the question ends `by: "default"` and the run `budget-exhausted`/`max_duration`
 *   (의미 6).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { object, sha } from "./cli-host-parity-support.js";
import type { Obj, Stored } from "./cli-host-parity-support.js";
import { assertIPCView, compare, compareRequests, fakeKeyAbsent, mockApi, runContractPair, shownRequests, sidePlaces } from "./cli-host-contract-support.js";
import type { ContractCase, PairRun } from "./cli-host-contract-support.js";

const NODE = process.execPath;
const README = "# Readme\n";
const DRAFT = "# Note\n\nDraft.\n";
const FIXED = "# Note\n\nDraft.\n\n## Done\n";
const KEPT = "# Kept\n";
const NOTES = "# Weekly notes\n";
const LIMITS = { maxModelTurns: 6, maxToolCalls: 10, maxTotalTokens: 50_000, maxDurationMs: 90_000 };
const write = (id: string, file: string, content: string, expectedHash: string | null) =>
  ({ toolCalls: [{ id, name: "write_file", args: { path: file, expectedHash, change: { kind: "replace_all", content } } }] });

/** (a) A verifier fails, the engine asks for a repair, the second write passes. */
const REPAIR: ContractCase = {
  name: "contract-repair",
  files: { "README.md": README },
  steps: [write("w1", "NOTE.md", DRAFT, null), { text: "first draft" }, write("w2", "NOTE.md", FIXED, sha(DRAFT)), { text: "fixed" }],
  task: {
    workflow: "document",
    limits: { ...LIMITS, maxRepairAttempts: 2 },
    verifiers: [{ id: "done", kind: "file_rules", rules: [{ type: "contains", path: "NOTE.md", text: "## Done" }] }],
  },
};
/** (a) A limit ends the run: the second tool call is over maxToolCalls. */
const LIMIT: ContractCase = {
  name: "contract-limit",
  files: { "README.md": README },
  steps: [write("w1", "A.md", "a\n", null), write("w2", "B.md", "b\n", null), { text: "both written" }],
  task: { workflow: "document", limits: { ...LIMITS, maxToolCalls: 1 }, verifiers: [] },
};
/** (b) Cancelled during the second model request (a long scripted wait); the first write stays. */
const CANCEL: ContractCase = {
  name: "contract-cancel",
  files: { "README.md": README },
  steps: [write("w1", "NOTE.md", KEPT, null), { text: "waiting", delayMs: 60_000 }],
  task: { workflow: "document", limits: LIMITS, verifiers: [] },
  cancelAt: 2,
};

function ends(pair: PairRun, status: string, reason: string, exitCode: number): void {
  for (const [name, side] of [["cli", pair.cli], ["host", pair.host]] as const) {
    assert.deepEqual([side.result.status, side.result.reason, side.result.exitCode], [status, reason, exitCode], `${name}: status/reason/exitCode`);
  }
  assert.deepEqual([pair.cliExit.code, pair.cliExit.signal], [exitCode, null], "CLI close code is the result's exit code");
}
const count = (value: Stored, type: string): number => value.records.filter((r) => r.type === type).length;
const usageOf = (value: Stored): Obj => object(value.result.usage, "usage");

/** A copy as another run would store it: other run id, times and duration only. */
function renamed(value: Stored): Stored {
  const copy = structuredClone({ result: value.result, records: value.records }), id = "20991231T235959Z-0123abcd";
  copy.result.runId = id;
  copy.result.journalPath = `.codaryn/runs/${id}/journal.jsonl`;
  usageOf(copy).durationMs = 37;
  for (const row of copy.records) { row.runId = id; row.at = "2099-12-31T23:59:59.000Z"; }
  object(copy.records.at(-1)!.usage, "final usage").durationMs = 37;
  return copy;
}
const fieldsDiffer = (error: unknown): boolean =>
  error instanceof assert.AssertionError && error.message.startsWith("complete stored result/journal fields");

test("C-1 (a) verifier fail, repair, pass: the CLI and the separate host store the same run", { timeout: 120_000 }, async (t) => {
  const pair = await runContractPair(t, REPAIR);
  ends(pair, "done", "verified", 0);
  for (const side of [pair.cli, pair.host]) {
    const usage = usageOf(side);
    assert.deepEqual([usage.modelTurns, usage.toolCalls, usage.repairAttempts], [4, 2, 1], "usage: turns, tools, repairs");
    const repairs = side.records.filter((r) => r.type === "repair_started");
    assert.deepEqual(repairs.map((r) => [r.attempt, r.failedVerifiers]), [[1, ["done"]]], "one repair for the failed verifier");
    assert.deepEqual(side.workspace, { "NOTE.md": FIXED, "README.md": README }, "workspace after the repair");
  }
  compare(pair.cli, pair.host);
  assertIPCView(pair.ipc, pair.host);
  // Controls: the comparison maps only per-run fields (a copy with other ids, times and duration is
  // the same), and it does see a one-field difference the mapping leaves alone.
  const other = renamed(pair.host);
  assert.notEqual(other.result.runId, pair.host.result.runId, "the control copy has another run id");
  assert.notEqual(other.records[0]!.at, pair.host.records[0]!.at, "the control copy has other times");
  compare(pair.cli, other);
  const changed = renamed(pair.host);
  changed.records.find((r) => r.type === "repair_started")!.failedVerifiers = ["other"];
  assert.throws(() => compare(pair.cli, changed), fieldsDiffer, "a changed journal field is a difference");
  const result = renamed(pair.host);
  result.result.finalMessage = { text: "other words", truncated: false };
  assert.throws(() => compare(pair.cli, result), fieldsDiffer, "a changed result field is a difference");
  t.diagnostic("C-1 controls: renamed copy equal; changed journal field and changed result field differ");
});

test("C-2 (a) a limit stops the run: the same budget end, journal and workspace on both sides", { timeout: 120_000 }, async (t) => {
  const pair = await runContractPair(t, LIMIT);
  ends(pair, "budget-exhausted", "max_tool_calls", 4);
  // M1 (contract-review-codex-01): each side on its own, so a limit both sides miss alike still fails.
  // The engine refuses a call before it runs once toolCalls >= maxToolCalls (src/engine/index.ts:1474-1476).
  for (const [name, side] of [["cli", pair.cli], ["host", pair.host]] as const) {
    const usage = usageOf(side);
    assert.deepEqual([usage.modelTurns, usage.toolCalls], [2, 1], `${name}: two turns, one tool call carried out`);
    const asked = side.records.filter((r) => r.type === "model_response").map((r) => (r.toolCalls as Obj[]).map((call) => call.id));
    assert.deepEqual(asked, [["w1"], ["w2"]], `${name}: the model asked for both calls`);
    const ran = (id: string): string[] => side.records.filter((r) =>
      ((r.type === "tool_decision" || r.type === "file_changed") && r.callId === id)
      || (r.type === "tool_result" && object(r.result, "tool result").callId === id)).map((r) => String(r.type));
    assert.ok(ran("w1").includes("tool_result") && ran("w1").includes("file_changed"), `${name}: the first call ran, with its result and change`);
    assert.deepEqual(ran("w2"), [], `${name}: no decision, result or change for the second call`);
    assert.equal(count(side, "tool_result"), 1, `${name}: one tool result`);
    assert.deepEqual(side.workspace, { "A.md": "a\n", "README.md": README }, `${name}: only the first write, no B.md`);
  }
  compare(pair.cli, pair.host);
  assert.deepEqual(pair.host.workspace, pair.cli.workspace, "same workspace after the stop");
  assertIPCView(pair.ipc, pair.host);
});

test("C-3 (b) cancel during a model request: CLI cancel file and host cancelRun end the same way", { timeout: 120_000 }, async (t) => {
  const pair = await runContractPair(t, CANCEL);
  ends(pair, "cancelled", "cancelled", 5);
  for (const side of [pair.cli, pair.host]) {
    assert.equal(count(side, "model_request"), 2, "cancelled in the second request");
    assert.equal(count(side, "model_response"), 1, "the waiting request got no response");
    assert.deepEqual(side.workspace, { "NOTE.md": KEPT, "README.md": README }, "the applied change stays (adapter-contract 5.3)");
  }
  compare(pair.cli, pair.host);
  assertIPCView(pair.ipc, pair.host);
});

/**
 * (c) Only a settings or profile command rule asks (adapter-contract 5.9 meaning 1), so a quick run
 * with a fake API on 127.0.0.1 per side (as c01 U-295 and n20 do for the CLI). The CLI child has no
 * terminal and the host's question is answered `dismissed` (what the main process answers when it
 * cannot ask): both are `deny` recorded `by: "default"` (meaning 3).
 */
test("C-4 (c) permission question default deny and its by value: CLI and separate host", { timeout: 120_000 }, async (t) => {
  const mock = await mockApi();
  const asked = (word: string) => mock.toolUse(`toolu_${word}`, "run_command", { executable: NODE, args: ["-e", `require('fs').writeFileSync('ran-${word}.txt', '')`] });
  const QUESTION: ContractCase = {
    name: "contract-question",
    files: { "notes.md": NOTES },
    quick: {
      goal: "Run the two checks.",
      replies: [mock.replyTools([asked("one")]), mock.replyTools([asked("two")]), mock.replyText("Both checks are asked.")],
      config: (url) => mock.fakeApiConfig(url, {
        language: "en",
        model: "fake-model",
        maxRetries: 0,
        limits: { maxModelTurns: 6, maxToolCalls: 6, maxTotalTokens: 200_000, maxDurationMs: 60_000 },
        policy: { commands: [{ executable: NODE, argsPrefix: ["-e"], allowExtraArgs: true, confirm: true }], network: "deny", destructive: "deny", restorePathTokens: false },
      }),
    },
    answer: "dismissed",
  };
  const pair = await runContractPair(t, QUESTION);
  ends(pair, "needs-input", "no_verifier", 3);
  assert.deepEqual(pair.questions, ["q1", "q2"], "the host sent both questions and got them answered");
  // The records n20 pins for the CLI (tests/integration/n20-c6a-run-pins.test.ts), on both sides.
  const expected = ["one", "two"].flatMap((word, index) => [
    { type: "confirmation_requested", kind: "permission", id: `q${index + 1}`, callId: `toolu_${word}`, tool: "run_command", permission: "command" },
    { type: "confirmation_answered", id: `q${index + 1}`, decision: "deny", by: "default" },
    { type: "tool_decision", callId: `toolu_${word}`, stage: "policy_effective", allowed: false, permission: "command", code: "confirmation_required" },
    { type: "tool_result", callId: `toolu_${word}`, ok: false, errorCode: "policy_denied" },
  ]);
  for (const [name, side] of [["cli", pair.cli], ["host", pair.host]] as const) {
    const shown = side.records.filter((r) => ["confirmation_requested", "confirmation_answered", "tool_decision", "tool_result"].includes(String(r.type))).map((r) => {
      if (r.type === "confirmation_requested") return { type: r.type, kind: r.kind, id: r.id, callId: r.callId, tool: r.tool, permission: r.permission };
      if (r.type === "confirmation_answered") return { type: r.type, id: r.id, decision: r.decision, by: r.by };
      if (r.type === "tool_decision") return { type: r.type, callId: r.callId, stage: r.stage, allowed: r.allowed, permission: r.permission, code: r.code };
      const result = object(r.result, "tool result");
      return { type: r.type, callId: result.callId, ok: result.ok, errorCode: result.errorCode };
    });
    assert.deepEqual(shown, expected, `${name}: default deny by "default" for each question`);
    assert.equal(usageOf(side).toolCalls, 0, `${name}: no asked command was carried out`);
    assert.deepEqual(side.workspace, { "notes.md": NOTES }, `${name}: no asked command ran`);
  }
  // L1 (contract-review-codex-01): strict, with CP53's mapping only. The quick run takes its workspace
  // by path, so each side's folder must appear nowhere it would be compared (sidePlaces).
  compare(pair.cli, pair.host);
  assert.equal(compareRequests(pair), 3, "three model requests to each side's fake API");
  const places = {
    storedCli: sidePlaces({ result: pair.cli.result, records: pair.cli.records }, pair.bases.cli),
    storedHost: sidePlaces({ result: pair.host.result, records: pair.host.records }, pair.bases.host),
    requestsCli: sidePlaces(shownRequests(pair.requests!.cli), pair.bases.cli),
    requestsHost: sidePlaces(shownRequests(pair.requests!.host), pair.bases.host),
  };
  assert.deepEqual(places, { storedCli: 0, storedHost: 0, requestsCli: 0, requestsHost: 0 }, "no side folder in stored or sent text");
  assertIPCView(pair.ipc, pair.host);
  // I1: the fake key value is in no stored, written, shown or sent text (checked as booleans; never printed).
  const diagnostic = `C-4 side folder places: stored cli ${places.storedCli} host ${places.storedHost}; requests cli ${places.requestsCli} host ${places.requestsHost}`;
  const keyFree = {
    stored: fakeKeyAbsent([pair.cli.result, pair.cli.records, pair.host.result, pair.host.records]),
    workspace: fakeKeyAbsent([pair.cli.workspace, pair.host.workspace]),
    hostMessages: fakeKeyAbsent([pair.ipc, pair.messages]),
    requestBodies: fakeKeyAbsent([pair.requests!.cli.map((r) => r.bodyText), pair.requests!.host.map((r) => r.bodyText)]),
    diagnostic: fakeKeyAbsent(diagnostic),
  };
  assert.deepEqual(keyFree, { stored: true, workspace: true, hostMessages: true, requestBodies: true, diagnostic: true }, "the fake key value is absent");
  t.diagnostic(diagnostic);
});
