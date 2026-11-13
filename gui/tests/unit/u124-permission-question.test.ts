/**
 * U-124 (docs/design/standalone-gui.md 3.6, DR-3, DR-10; adapter-contract 5.9; cli-contract 18.17):
 * the in-run permission question in the GUI. The engine host relays the engine's question (the
 * masked executable and the number of arguments, the command permission only) to the main process,
 * whose OS dialog asks (deny the default and the Esc answer); the window cannot answer. No window, a
 * failed asking or no answer is dismissed (deny by default); the run's signal ends the question.
 * The run's result counts how its questions ended, with the CLI's end summary's meaning. A settings
 * proposal with a widening the dialog cannot name is not written; confirm_removed is named.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import { createRunRegistry, questionOf } from "../../src/engine-host/runs.js";
import { DIALOG_TEXTS, KNOWN_WIDENING_KINDS, permissionDialogOptions, unnamedWidening, widenText } from "../../src/main/dialog-texts.js";
import { RunManager } from "../../src/main/runs.js";
import type { QuestionAnswer } from "../../src/main/runs.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { confirmationsOf } from "../../src/shared/ipc.js";
import { parseHostMessage, parseQuestion } from "../../src/shared/protocol.js";
import type { HostMessage, PermissionQuestion } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";

const TOKEN = "a".repeat(32);
const QUESTION = { id: "q1", callId: "toolu_1", tool: "run_command", permission: "command", subject: "C:\\tools\\node.exe", argumentCount: 2 } as const;

test("U-124: a question is the command permission, a plain masked executable and a count; anything else is not asked", () => {
  assert.deepEqual(parseQuestion(QUESTION), QUESTION);
  for (const bad of [
    { ...QUESTION, permission: "path" },
    { ...QUESTION, id: "1" },
    { ...QUESTION, subject: "" },
    { ...QUESTION, subject: "node\u202e.exe" },
    { ...QUESTION, subject: "a\nb" },
    { ...QUESTION, subject: "x".repeat(1001) },
    { ...QUESTION, argumentCount: -1 },
    { ...QUESTION, callId: "bad id" },
  ]) {
    assert.equal(parseQuestion(bad), null, JSON.stringify(bad).slice(0, 80));
  }
  const message = parseHostMessage(JSON.stringify({ v: 1, type: "question", run: TOKEN, question: QUESTION }));
  assert.deepEqual(message, { v: 1, type: "question", run: TOKEN, question: QUESTION });
  assert.deepEqual(parseHostMessage(JSON.stringify({ v: 1, type: "questionEnded", run: TOKEN, id: "q1" })), { v: 1, type: "questionEnded", run: TOKEN, id: "q1" });
  assert.equal((parseHostMessage(JSON.stringify({ v: 1, type: "question", run: TOKEN, question: { ...QUESTION, argv: ["secret"] } })) as { type?: string } | null)?.type, "question", "extra fields are not passed on");
  const key = ["sk", "ant", "FAKE".repeat(10)].join("-");
  const hidden = questionOf({ kind: "permission", ...QUESTION, subject: `C:\\${key}\\node.exe` }, (text) => text.replace(key, "[key]"));
  assert.equal(hidden?.subject, "C:\\[key]\\node.exe", "the host hides the subject again");
  assert.equal(questionOf({ kind: "plan", ...QUESTION }, (t) => t), null);
});

function harness() {
  const written: HostMessage[] = [];
  let observer: { onEvent(event: unknown): void; confirm?(request: unknown, signal: AbortSignal): Promise<{ decision: string }> } | null = null;
  let finish: (value: unknown) => void = () => undefined;
  const registry = createRunRegistry({
    startRun: async (_request, given) => {
      observer = given;
      return { ok: true, handle: { runId: "20261113T140000Z-0000a124", cancel: () => undefined, done: new Promise((resolve) => (finish = resolve)) } };
    },
    applyPlan: async (_request, given) => {
      observer = given;
      return { ok: true, handle: { runId: "20261113T140000Z-0000b124", cancel: () => undefined, done: new Promise(() => undefined) } };
    },
    itemOf: () => null,
    shown: (text) => text,
    token: () => TOKEN,
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
    flushMs: 1,
  });
  return { registry, written, observer: () => observer, finish: (value: unknown) => finish(value) };
}

test("U-124: the engine host sends the question, takes the main process's answer once, and ends it with the run's signal", async () => {
  const h = harness();
  await h.registry.start({ workspace: "C:\\ws", goal: "g", profile: null, workflowRef: null });
  const confirm = h.observer()?.confirm;
  assert.ok(confirm, "a run's observer asks");
  const signal = new AbortController();
  const asked = confirm({ kind: "permission", ...QUESTION }, signal.signal);
  assert.deepEqual(h.written.at(-1), { v: 1, type: "question", run: TOKEN, question: QUESTION });
  assert.equal(h.registry.answer(TOKEN, "q1", "allow_once"), true);
  assert.deepEqual(await asked, { decision: "allow_once" });
  assert.equal(h.registry.answer(TOKEN, "q1", "allow_once"), false, "an answer is taken once");
  const ended = new AbortController();
  const second = confirm({ kind: "permission", ...QUESTION, id: "q2" }, ended.signal);
  ended.abort();
  assert.deepEqual(await second, { decision: "dismissed" });
  assert.deepEqual(h.written.at(-1), { v: 1, type: "questionEnded", run: TOKEN, id: "q2" });
  assert.equal(h.registry.answer(TOKEN, "q2", "allow_once"), false, "a late answer does nothing");
  const before = h.written.length;
  assert.deepEqual(await confirm({ kind: "permission", ...QUESTION, id: "q3", permission: "path" }, new AbortController().signal), { decision: "dismissed" });
  assert.equal(h.written.length, before, "another permission is not asked");
  // The result counts how the questions ended, from the run's own records.
  for (const [decision, by] of [["allow_once", "user"], ["deny", "user"], ["deny", "default"], ["deny", "cancelled"]]) {
    h.observer()?.onEvent({ kind: "record", record: { seq: 1, type: "confirmation_answered", decision, by } });
  }
  h.finish({ ok: true, result: { status: "done", reason: "verified", exitCode: 0, runId: "20261113T140000Z-0000a124", changes: [], verifiers: [], usage: {}, notices: [] } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const done = h.written.find((m) => "type" in m && m.type === "done") as { outcome: { result?: { confirmations?: unknown } } } | undefined;
  assert.deepEqual(done?.outcome.result?.confirmations, { allowed: 1, user: 1, default: 1, cancelled: 1 });
  assert.deepEqual(confirmationsOf({ allowed: 1, user: 1, default: 1, cancelled: 1 }), { allowed: 1, user: 1, default: 1, cancelled: 1 });
  assert.equal(confirmationsOf({ allowed: 1, user: 1, default: 1, cancelled: 1, note: "x" }), null);
  const apply = harness();
  await apply.registry.startApply({ workspace: "C:\\ws", profile: null, workflowRef: null, planRunId: "20261113T130000Z-0000a119", digest: "ab".repeat(32), consent: false });
  assert.equal(apply.observer()?.confirm, undefined, "an apply asks nothing");
});

test("U-124: the host checks the answer call", async () => {
  const written: HostMessage[] = [];
  const handler = createHostHandler({
    app: fakeApp(),
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => text,
    providers: [],
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
  });
  await handler.handleLine(JSON.stringify({ v: 1, id: 1, call: "answerQuestion", args: { run: TOKEN, id: "q1", decision: "allow_once" } }));
  for (const [id, args] of [
    [2, { run: TOKEN, id: "q1", decision: "always" }],
    [3, { run: TOKEN, id: "1", decision: "deny" }],
    [4, { run: "x", id: "q1", decision: "deny" }],
    [5, { run: TOKEN, id: "q1", decision: "deny", more: 1 }],
  ] as const) {
    await handler.handleLine(JSON.stringify({ v: 1, id, call: "answerQuestion", args }));
  }
  assert.deepEqual((written[0] as { value: unknown }).value, { ok: false }, "no such run: nothing is answered");
  assert.deepEqual(written.slice(1).map((m) => (m as { error?: { code: string } }).error?.code), ["invalid_args", "invalid_args", "invalid_args", "invalid_args"]);
});

test("U-124: the main process asks by its dialog and answers; an ended question or run closes the dialog and answers nothing", async () => {
  const asked: PermissionQuestion[] = [];
  const answered: [string, string, QuestionAnswer][] = [];
  const signals: AbortSignal[] = [];
  let reply: (value: QuestionAnswer) => void = () => undefined;
  const manager = new RunManager({
    send: () => undefined,
    labels: async (status, reason) => ({ status, reason }),
    ask: (question, signal) => {
      asked.push(question);
      signals.push(signal);
      return new Promise((resolve) => (reply = resolve));
    },
    answer: async (token, id, decision) => {
      answered.push([token, id, decision]);
    },
  });
  manager.begin(TOKEN, "20261113T140000Z-0000a124");
  await manager.receive({ v: 1, type: "question", run: TOKEN, question: QUESTION });
  reply("deny");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(answered, [[TOKEN, "q1", "deny"]]);
  await manager.receive({ v: 1, type: "question", run: TOKEN, question: { ...QUESTION, id: "q2" } });
  await manager.receive({ v: 1, type: "questionEnded", run: TOKEN, id: "q2" });
  assert.equal(signals[1]?.aborted, true, "the engine ended it: the dialog closes");
  reply("allow_once");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(answered.length, 1, "nothing is answered for an ended question");
  await manager.receive({ v: 1, type: "question", run: "b".repeat(32), question: { ...QUESTION, id: "q3" } });
  assert.equal(asked.length, 2, "another run's question is not asked");
  await manager.receive({ v: 1, type: "question", run: TOKEN, question: { ...QUESTION, id: "q4" } });
  manager.hostExited();
  assert.equal(signals[2]?.aborted, true, "the run ended: the dialog closes");

  const failing = new RunManager({
    send: () => undefined,
    labels: async (status, reason) => ({ status, reason }),
    ask: async () => {
      throw new Error("no dialog");
    },
    answer: async (token, id, decision) => void answered.push([token, id, decision]),
  });
  failing.begin(TOKEN, "20261113T140000Z-0000c124");
  await failing.receive({ v: 1, type: "question", run: TOKEN, question: QUESTION });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(answered.at(-1), [TOKEN, "q1", "dismissed"], "a failed asking is no answer (deny by default)");
});

test("U-124: the dialog says what the CLI says, defaults to deny, and a widening it cannot name is not written", () => {
  for (const language of ["ko", "en"] as const) {
    const options = permissionDialogOptions(language, { subject: "C:\\tools\\node.exe", argumentCount: 2 });
    assert.equal(options.defaultId, 1);
    assert.equal(options.cancelId, 1, "Esc denies");
    assert.equal(options.buttons[1], DIALOG_TEXTS[language]["permission.deny"]);
    assert.match(options.detail, /C:\\tools\\node\.exe/);
    assert.match(options.detail, /2/);
    assert.match(options.message, language === "ko" ? /이번 호출에만.*답하지 않으면 거부/ : /this one call\? With no answer it is denied/);
    const t = textsFor(language);
    for (const id of ["run.confirm.allowed", "run.confirm.user", "run.confirm.unanswered", "run.confirm.cancelled", "widen.confirm_removed"]) assert.ok(t.has(id), `${language} ${id}`);
  }
  assert.ok(KNOWN_WIDENING_KINDS.includes("confirm_removed"));
  assert.equal(KNOWN_WIDENING_KINDS.includes("other"), false);
  assert.match(widenText("en", "confirm_removed", "policy.commands[0]"), /asked about runs without asking/);
  assert.equal(unnamedWidening([{ kind: "command_added" }, { kind: "confirm_removed" }]), false);
  assert.equal(unnamedWidening([{ kind: "command_added" }, { kind: "something_new" }]), true, "an unknown kind: not written");
});
