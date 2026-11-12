/**
 * The CLI side of the line protocol (src/cli/protocol): the lines it writes, the answers it reads,
 * EOF and cancel (adapter-contract 6, R-1 L-2, DR-10), and the two options. No process is started.
 */

import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, test } from "node:test";
import type { ConfirmRequest, RunEvent } from "../../../../src/app/index.js";
import {
  AnswerBook,
  MAX_ANSWER_LINE_LENGTH,
  QuestionCancelledError,
  askOverProtocol,
  confirmLine,
  createProtocolObserver,
  eventLine,
  parseAnswerLine,
  readAnswers,
  startedLine,
  takeProtocolOptions,
} from "../../../../src/cli/protocol/index.js";

const RUN_ID = "20261112T010203Z-0a1b2c3d";
const QUESTION: ConfirmRequest = { kind: "permission", id: "q1", callId: "c1", tool: "run_command", permission: "command", subject: "node --test" as never };
const answer = (id: string, decision: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ schemaVersion: 1, kind: "answer", id, answer: { decision }, ...extra });

function never(): AbortSignal {
  return new AbortController().signal;
}

describe("lines", () => {
  test("each written line is one JSON object and a line feed, whatever the text holds", () => {
    const event: RunEvent = {
      kind: "record",
      record: { seq: 1, at: "2026-11-12T01:02:03.000Z", runId: RUN_ID, type: "model_error", turn: 1, kind: "api_error", message: "two\nlines\r\u0007\u001b[2J" as never },
    };
    for (const line of [startedLine(RUN_ID), eventLine(event), confirmLine(QUESTION)]) {
      assert.equal(line.endsWith("\n"), true);
      assert.equal(line.slice(0, -1).includes("\n"), false, "no raw line break inside");
      assert.equal(/[\u0000-\u001f]/.test(line.slice(0, -1)), false, "control characters are escaped");
      assert.equal((JSON.parse(line) as { schemaVersion: number }).schemaVersion, 1);
    }
    assert.deepEqual(JSON.parse(eventLine(event)), { schemaVersion: 1, kind: "event", event });
  });

  test("an answer line is accepted only in its exact form", () => {
    assert.deepEqual(parseAnswerLine(answer("q1", "allow_once")), { ok: true, id: "q1", answer: { decision: "allow_once" } });
    assert.deepEqual(parseAnswerLine(answer("q1", "dismissed")), { ok: true, id: "q1", answer: { decision: "dismissed" } });
    for (const bad of [
      "not json",
      answer("q1", "allow_always"),
      answer("", "deny"),
      JSON.stringify({ schemaVersion: 2, kind: "answer", id: "q1", answer: { decision: "deny" } }),
      JSON.stringify({ schemaVersion: 1, kind: "cancel" }),
      JSON.stringify({ schemaVersion: 1, kind: "answer", id: "q1", answer: { decision: "deny", scope: "always" } }),
      JSON.stringify({ schemaVersion: 1, kind: "answer", id: 1, answer: { decision: "deny" } }),
      " ".repeat(MAX_ANSWER_LINE_LENGTH + 1),
    ]) {
      assert.deepEqual(parseAnswerLine(bad), { ok: false }, bad.slice(0, 60));
    }
  });
});

describe("answers", () => {
  test("an answer settles its open question; malformed, unknown and repeated lines are ignored", async () => {
    const book = new AnswerBook();
    const waiting = book.wait("q1", never());
    assert.equal(book.line("garbage"), false);
    assert.equal(book.line(answer("q9", "allow_once")), false, "no question q9 is open");
    assert.equal(book.line(answer("q1", "deny")), true);
    assert.equal(book.line(answer("q1", "allow_once")), false, "already answered");
    assert.deepEqual(await waiting, { kind: "answered", answer: { decision: "deny" } });
    assert.deepEqual(await book.wait("q1", never()), { kind: "no_answer" }, "an id asked twice is not answerable");
  });

  test("EOF: open and later questions get no answer, unless a cancel was requested by then", async () => {
    let cancelRequested = false;
    const book = new AnswerBook(() => cancelRequested);
    const open = book.wait("q1", never());
    book.end();
    assert.deepEqual(await open, { kind: "no_answer" });
    assert.deepEqual(await book.wait("q2", never()), { kind: "no_answer" });
    cancelRequested = true;
    assert.deepEqual(await book.wait("q3", never()), { kind: "cancelled" }, "checked again for a later question");

    const shutdown = new AnswerBook(() => true);
    const pending = shutdown.wait("q1", never());
    shutdown.end();
    assert.deepEqual(await pending, { kind: "cancelled" }, "cancel file first, stdin closed after: a cancel (R-1 L-2)");
  });

  test("the run's cancel signal settles a waiting question as cancelled", async () => {
    const book = new AnswerBook();
    const controller = new AbortController();
    const waiting = book.wait("q1", controller.signal);
    controller.abort();
    assert.deepEqual(await waiting, { kind: "cancelled" });
    assert.equal(book.line(answer("q1", "allow_once")), false, "too late");
    assert.deepEqual(await book.wait("q2", controller.signal), { kind: "cancelled" });
  });

  test("readAnswers splits a stream into lines (CRLF, chunks), drops over-long lines and ends the book", async () => {
    const book = new AnswerBook();
    const input = new PassThrough();
    const stop = readAnswers(input, book);
    const first = book.wait("q1", never());
    const second = book.wait("q2", never());
    const third = book.wait("q3", never());
    input.write(answer("q1", "allow_once").slice(0, 10));
    input.write(`${answer("q1", "allow_once").slice(10)}\r\n`);
    input.write(`${"x".repeat(MAX_ANSWER_LINE_LENGTH + 10)}`);
    input.write(`tail of the long line\n${answer("q2", "deny")}`);
    input.end();
    assert.deepEqual(await first, { kind: "answered", answer: { decision: "allow_once" } });
    assert.deepEqual(await second, { kind: "answered", answer: { decision: "deny" } }, "the last line without LF still counts");
    assert.deepEqual(await third, { kind: "no_answer" }, "EOF");
    stop();
  });
});

describe("observer", () => {
  test("a question is written as a confirm line, then answered; EOF gives dismissed; a cancel rejects", async () => {
    const lines: string[] = [];
    const book = new AnswerBook();
    const asked = askOverProtocol((line) => lines.push(line), book, QUESTION, never());
    assert.deepEqual(JSON.parse(lines[0] ?? ""), { schemaVersion: 1, kind: "confirm", request: QUESTION });
    book.line(answer("q1", "allow_once"));
    assert.deepEqual(await asked, { decision: "allow_once" });

    const ended = new AnswerBook();
    ended.end();
    assert.deepEqual(await askOverProtocol(() => {}, ended, { ...QUESTION, id: "q2" }, never()), { decision: "dismissed" }, "DR-10: the default, not a person's deny");

    const controller = new AbortController();
    const cancelled = askOverProtocol(() => {}, new AnswerBook(), { ...QUESTION, id: "q3" }, controller.signal);
    controller.abort();
    await assert.rejects(cancelled, QuestionCancelledError);
  });

  test("events become lines; a failing write never reaches the caller; no confirm without answers", () => {
    const lines: string[] = [];
    const observer = createProtocolObserver({ write: (line) => lines.push(line), answers: null });
    observer.onEvent?.({ kind: "notice", text: "hint" as never });
    assert.deepEqual(lines, [`${JSON.stringify({ schemaVersion: 1, kind: "event", event: { kind: "notice", text: "hint" } })}\n`]);
    assert.equal("confirm" in observer, false, "the app layer records the default denial itself (DR-10)");
    const broken = createProtocolObserver({ write: () => { throw new Error("EPIPE"); }, answers: new AnswerBook() });
    assert.doesNotThrow(() => broken.onEvent?.({ kind: "notice", text: "x" as never }));
    assert.equal(typeof broken.confirm, "function");
  });
});

describe("takeProtocolOptions", () => {
  test("takes the two options out and leaves the rest for the command's own parser", () => {
    assert.deepEqual(takeProtocolOptions(["run", "--task", "t.json", "--events", "jsonl", "--confirm", "stdio", "--quiet"]), {
      ok: true,
      options: { events: "jsonl", confirm: "stdio" },
      rest: ["run", "--task", "t.json", "--quiet"],
    });
    assert.deepEqual(takeProtocolOptions(["apply", "--task", "t.json", "--events", "jsonl"]), {
      ok: true,
      options: { events: "jsonl", confirm: null },
      rest: ["apply", "--task", "t.json"],
    });
    assert.deepEqual(takeProtocolOptions(["run", "--task", "t.json"]), { ok: true, options: { events: null, confirm: null }, rest: ["run", "--task", "t.json"] });
  });

  test("refuses other values, repeats, the wrong command and --confirm without --events", () => {
    const refused = (argv: readonly string[]) => {
      const outcome = takeProtocolOptions(argv);
      assert.equal(outcome.ok, false, argv.join(" "));
      return (outcome as { message: string }).message;
    };
    assert.match(refused(["run", "--events", "json"]), /takes jsonl/);
    assert.match(refused(["run", "--events"]), /takes jsonl/);
    assert.match(refused(["run", "--events", "jsonl", "--events", "jsonl"]), /twice/);
    assert.match(refused(["run", "--confirm", "tty", "--events", "jsonl"]), /takes stdio/);
    assert.match(refused(["run", "--confirm", "stdio"]), /needs --events jsonl/);
    assert.match(refused(["apply", "--events", "jsonl", "--confirm", "stdio"]), /run only/);
    assert.match(refused(["report", "--events", "jsonl"]), /run and apply only/);
  });
});
