/**
 * Contract-layer cases after CP53 (standalone-gui 8.3, 12): the same run through the real CLI and a
 * separate real engine host ends the same way, with the same stored result and journal.
 *
 * The permission question's branches (adapter-contract 5.9): C-4 the default deny of a CLI without a
 * terminal (meaning 3, `by: "default"`); C-5 the person's deny (`by: "user"`); C-6 a cancel while the
 * question waits (meaning 7, `by: "cancelled"`, the run `cancelled`); C-7 no answer until the run's time
 * limit (meaning 6, `by: "default"`, `budget-exhausted`/`max_duration`). The CLI asks at a terminal only
 * (main.ts), so C-5 to C-7 give the real CLI child one with the tests' preload (`--import`, only `isTTY`
 * of stdin and stderr changes; product code does not); C-3 cancels during a model request instead.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
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

/** C-7's run time limit: long enough to reach the first question, short enough for the case (PM Q-3). */
const QUESTION_LIMIT_MS = 4_000;

/**
 * C-5 to C-7: C-4's quick run (its goal, replies, config and asking rule), with the CLI child at a
 * terminal so it asks (`cliTerminal`) and the host doing what its main process would (`answer`).
 */
async function askedPair(t: TestContext, name: string, cliTerminal: "deny" | "interrupt" | "none", answer: "deny" | "cancel" | "none", maxDurationMs: number): Promise<PairRun> {
  const mock = await mockApi();
  const asked = (word: string) => mock.toolUse(`toolu_${word}`, "run_command", { executable: NODE, args: ["-e", `require('fs').writeFileSync('ran-${word}.txt', '')`] });
  return runContractPair(t, {
    name,
    files: { "notes.md": NOTES },
    quick: {
      goal: "Run the two checks.",
      replies: [mock.replyTools([asked("one")]), mock.replyTools([asked("two")]), mock.replyText("Both checks are asked.")],
      config: (url) => mock.fakeApiConfig(url, {
        language: "en",
        model: "fake-model",
        maxRetries: 0,
        limits: { maxModelTurns: 6, maxToolCalls: 6, maxTotalTokens: 200_000, maxDurationMs },
        policy: { commands: [{ executable: NODE, argsPrefix: ["-e"], allowExtraArgs: true, confirm: true }], network: "deny", destructive: "deny", restorePathTokens: false },
      }),
    },
    answer,
    cliTerminal,
  });
}

/** A side's question records as C-4 shows them (the shape n20 pins for the CLI). */
function questionRecords(side: Stored): Obj[] {
  return side.records.filter((r) => ["confirmation_requested", "confirmation_answered", "tool_decision", "tool_result"].includes(String(r.type))).map((r) => {
    if (r.type === "confirmation_requested") return { type: r.type, kind: r.kind, id: r.id, callId: r.callId, tool: r.tool, permission: r.permission };
    if (r.type === "confirmation_answered") return { type: r.type, id: r.id, decision: r.decision, by: r.by };
    if (r.type === "tool_decision") return { type: r.type, callId: r.callId, stage: r.stage, allowed: r.allowed, permission: r.permission, code: r.code };
    const result = object(r.result, "tool result");
    return { type: r.type, callId: result.callId, ok: result.ok, errorCode: result.errorCode };
  });
}

/**
 * The records each question leaves: asked, answered `deny` with `by`, the call's denial; then its
 * tool_result only when the run goes on (an answer). A cancel or the time limit ends the run at the
 * question, so no result goes back to the model (engine askPermission, U-137).
 */
function expectedQuestions(words: readonly string[], by: "user" | "cancelled" | "default", goesOn: boolean): Obj[] {
  return words.flatMap((word, index) => [
    { type: "confirmation_requested", kind: "permission", id: `q${index + 1}`, callId: `toolu_${word}`, tool: "run_command", permission: "command" },
    { type: "confirmation_answered", id: `q${index + 1}`, decision: "deny", by },
    { type: "tool_decision", callId: `toolu_${word}`, stage: "policy_effective", allowed: false, permission: "command", code: "confirmation_required" },
    ...(goesOn ? [{ type: "tool_result", callId: `toolu_${word}`, ok: false, errorCode: "policy_denied" }] : []),
  ]);
}

/** Both sides' question records, then what C-4 checks after them: strict comparison, fake APIs, no side folder, IPC, no fake key. */
function sameAsked(t: TestContext, label: string, pair: PairRun, expected: readonly Obj[], modelRequests: number): void {
  for (const [name, side] of [["cli", pair.cli], ["host", pair.host]] as const) {
    assert.deepEqual(questionRecords(side), expected, `${name}: the question records`);
    assert.equal(count(side, "model_request"), modelRequests, `${name}: model requests`);
    assert.equal(usageOf(side).toolCalls, 0, `${name}: no asked command was carried out`);
    assert.deepEqual(side.workspace, { "notes.md": NOTES }, `${name}: no asked command ran`);
  }
  assert.ok(pair.cliQuestions >= expected.filter((r) => r.type === "confirmation_requested").length, "the CLI asked at its terminal (stderr)");
  compare(pair.cli, pair.host);
  assert.equal(compareRequests(pair), modelRequests, "the same requests to each side's fake API");
  const places = {
    storedCli: sidePlaces({ result: pair.cli.result, records: pair.cli.records }, pair.bases.cli),
    storedHost: sidePlaces({ result: pair.host.result, records: pair.host.records }, pair.bases.host),
    requestsCli: sidePlaces(shownRequests(pair.requests!.cli), pair.bases.cli),
    requestsHost: sidePlaces(shownRequests(pair.requests!.host), pair.bases.host),
  };
  assert.deepEqual(places, { storedCli: 0, storedHost: 0, requestsCli: 0, requestsHost: 0 }, "no side folder in stored or sent text");
  assertIPCView(pair.ipc, pair.host);
  const diagnostic = `${label}: CLI questions on stderr ${pair.cliQuestions}; host questions ${pair.questions.join(",")}, ended by the run's signal ${pair.questionsEnded.join(",") || "none"}`;
  const keyFree = {
    stored: fakeKeyAbsent([pair.cli.result, pair.cli.records, pair.host.result, pair.host.records]),
    workspace: fakeKeyAbsent([pair.cli.workspace, pair.host.workspace]),
    hostMessages: fakeKeyAbsent([pair.ipc, pair.messages]),
    requestBodies: fakeKeyAbsent([pair.requests!.cli.map((r) => r.bodyText), pair.requests!.host.map((r) => r.bodyText)]),
    diagnostic: fakeKeyAbsent(diagnostic),
  };
  assert.deepEqual(keyFree, { stored: true, workspace: true, hostMessages: true, requestBodies: true, diagnostic: true }, "the fake key value is absent");
  t.diagnostic(diagnostic);
}

test("C-5 (c) the person's deny: the CLI's terminal answers n, the host's main process deny; both by user", { timeout: 120_000 }, async (t) => {
  const pair = await askedPair(t, "contract-deny", "deny", "deny", 60_000);
  ends(pair, "needs-input", "no_verifier", 3);
  assert.deepEqual([pair.questions, pair.questionsEnded], [["q1", "q2"], []], "the host answered both questions; none ended by a signal");
  sameAsked(t, "C-5", pair, expectedQuestions(["one", "two"], "user", true), 3);
});

test("C-6 (c) cancel while the question waits: the CLI's Ctrl+C and the host's cancelRun; both by cancelled", { timeout: 120_000 }, async (t) => {
  const pair = await askedPair(t, "contract-question-cancel", "interrupt", "cancel", 60_000);
  ends(pair, "cancelled", "cancelled", 5);
  assert.deepEqual([pair.questions, pair.questionsEnded], [["q1"], ["q1"]], "the run's signal ended the host's open question");
  sameAsked(t, "C-6", pair, expectedQuestions(["one"], "cancelled", false), 1);
});

test("C-7 (c) no answer until the run's time limit: both budget-exhausted/max_duration, by default", { timeout: 120_000 }, async (t) => {
  const started = Date.now();
  const pair = await askedPair(t, "contract-question-limit", "none", "none", QUESTION_LIMIT_MS);
  ends(pair, "budget-exhausted", "max_duration", 4);
  assert.deepEqual([pair.questions, pair.questionsEnded], [["q1"], ["q1"]], "the run's time limit ended the host's open question");
  sameAsked(t, "C-7", pair, expectedQuestions(["one"], "default", false), 1);
  // The engine's deadline is a timer and durationMs its clock's difference: a few ms either way.
  for (const [name, side] of [["cli", pair.cli], ["host", pair.host]] as const) {
    assert.ok(Number(usageOf(side).durationMs) >= QUESTION_LIMIT_MS - 50, `${name}: the run lasted about its limit`);
  }
  t.diagnostic(`C-7: ${Date.now() - started} ms for both sides (each run's limit ${QUESTION_LIMIT_MS} ms; the case's own limit 120000 ms)`);
});
