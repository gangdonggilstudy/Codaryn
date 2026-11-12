/** GU-1: the engine host message channel (src/shared/protocol.ts), without Electron. */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHANNEL_ERRORS,
  LineDecoder,
  MAX_LINE_CHARS,
  PendingCalls,
  encodeLine,
  nodeMajor,
  parseHostMessage,
  parseRequest,
} from "../../src/shared/protocol.js";

test("protocol: a request survives encoding and parsing; the line ends with LF", () => {
  const line = encodeLine({ v: 1, id: 7, call: "doctor", args: { workspace: null } });
  assert.ok(line.endsWith("\n"));
  assert.deepEqual(parseRequest(line.slice(0, -1)), { ok: true, request: { v: 1, id: 7, call: "doctor", args: { workspace: null } } });
});

test("protocol: a line break inside a string value stays escaped, so one message is one line", () => {
  const line = encodeLine({ v: 1, id: 1, ok: true, value: { text: "a\nb\r\nc d" } });
  assert.equal(line.indexOf("\n"), line.length - 1);
  assert.deepEqual(parseHostMessage(line.trimEnd()), { v: 1, id: 1, ok: true, value: { text: "a\nb\r\nc d" } });
});

test("protocol: requests that are not version 1, have no id or name an unknown call are refused", () => {
  assert.deepEqual(parseRequest("not json"), { ok: false, id: null, error: { code: CHANNEL_ERRORS.invalidMessage, message: "not a version 1 message" } });
  assert.equal(parseRequest(JSON.stringify({ v: 2, id: 1, call: "doctor" })).ok, false);
  assert.equal(parseRequest(JSON.stringify([1, 2])).ok, false);
  const noId = parseRequest(JSON.stringify({ v: 1, id: 0, call: "doctor" }));
  assert.equal(noId.ok, false);
  assert.equal(!noId.ok && noId.id, null);
  const unknown = parseRequest(JSON.stringify({ v: 1, id: 4, call: "startRun" }));
  assert.deepEqual(unknown, { ok: false, id: 4, error: { code: CHANNEL_ERRORS.unknownCall, message: "unknown call" } });
  assert.equal(parseRequest(JSON.stringify({ v: 1, id: 4, call: "__proto__" })).ok, false);
});

test("protocol: host messages are checked field by field", () => {
  assert.deepEqual(parseHostMessage(JSON.stringify({ v: 1, type: "ready", node: "26.13.1" })), { v: 1, type: "ready", node: "26.13.1" });
  assert.equal(parseHostMessage(JSON.stringify({ v: 1, type: "ready" })), null);
  assert.equal(parseHostMessage(JSON.stringify({ v: 1, type: "ready", node: "x".repeat(65) })), null);
  assert.deepEqual(parseHostMessage(JSON.stringify({ v: 1, id: 3, ok: false, error: { code: "c", message: "m" } })), {
    v: 1,
    id: 3,
    ok: false,
    error: { code: "c", message: "m" },
  });
  assert.equal(parseHostMessage(JSON.stringify({ v: 1, id: 3, ok: false, error: "text" })), null);
  assert.equal(parseHostMessage(JSON.stringify({ v: 1, id: 3, ok: "yes" })), null);
  assert.equal(parseHostMessage(JSON.stringify({ v: 1, id: -3, ok: true })), null);
  assert.equal(parseHostMessage("garbage"), null);
});

test("protocol: the line decoder splits chunks, drops CR and empty lines, and keeps an unfinished line", () => {
  const lines: string[] = [];
  const decoder = new LineDecoder((line) => lines.push(line), () => assert.fail("no overflow"));
  decoder.push('{"a":');
  decoder.push('1}\r\n\n{"b":2}\n{"c"');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  decoder.end();
  decoder.push(":3}\n");
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', ":3}"], "end() drops the unfinished line");
});

test("protocol: a line over the limit is reported once and skipped to its end, never delivered in part", () => {
  const lines: string[] = [];
  let overflows = 0;
  const decoder = new LineDecoder((line) => lines.push(line), () => (overflows += 1), 10);
  decoder.push("0123456789AB");
  decoder.push("CDEF");
  decoder.push("GH\nok\n");
  assert.equal(overflows, 1);
  assert.deepEqual(lines, ["ok"]);
  decoder.push("0123456789ABC\n");
  assert.equal(overflows, 2);
  assert.ok(MAX_LINE_CHARS >= 1024 * 1024);
});

test("protocol: encodeLine refuses a message longer than the limit", () => {
  assert.throws(() => encodeLine({ v: 1, id: 1, ok: true, value: "x".repeat(MAX_LINE_CHARS) }), RangeError);
});

test("protocol: pending calls settle by id, time out, and all fail together", async () => {
  const pending = new PendingCalls();
  const first = pending.next();
  const second = pending.next();
  assert.notEqual(first, second);
  const a = pending.wait(first, 5_000);
  const b = pending.wait(second, 5_000);
  assert.equal(pending.settle({ v: 1, id: first, ok: true, value: 1 }), "delivered");
  assert.equal(pending.settle({ v: 1, id: first, ok: true, value: 2 }), "late", "a second answer is dropped, not delivered");
  assert.deepEqual(await a, { v: 1, id: first, ok: true, value: 1 });
  pending.failAll({ code: CHANNEL_ERRORS.hostExited, message: "gone" });
  assert.deepEqual(await b, { v: 1, id: second, ok: false, error: { code: CHANNEL_ERRORS.hostExited, message: "gone" } });
  assert.equal(pending.size, 0);
  const late = pending.next();
  const timed = await pending.wait(late, 5);
  assert.equal(!timed.ok && timed.error.code, CHANNEL_ERRORS.timeout);
});

test("protocol: node major versions", () => {
  assert.equal(nodeMajor("26.13.1"), 26);
  assert.equal(nodeMajor("v24.22.2"), 24);
  assert.equal(nodeMajor("26"), null);
  assert.equal(nodeMajor("abc"), null);
});

test("protocol (R-10 M-1): an answer after the time limit is late, not unknown, and is not delivered", async () => {
  const pending = new PendingCalls();
  const id = pending.next();
  const timed = await pending.wait(id, 5);
  assert.equal(!timed.ok && timed.error.code, CHANNEL_ERRORS.timeout);
  assert.equal(pending.settle({ v: 1, id, ok: true, value: "late" }), "late");
  assert.equal(pending.settle({ v: 1, id, ok: true, value: "again" }), "late", "another answer to a settled id is dropped too");
  assert.equal(pending.settle({ v: 1, id: 999, ok: true, value: 1 }), "unknown", "an id never issued");
  const next = pending.next();
  const answer = pending.wait(next, 5_000);
  assert.equal(pending.settle({ v: 1, id: next, ok: true, value: 2 }), "delivered");
  assert.deepEqual(await answer, { v: 1, id: next, ok: true, value: 2 });
});

test("protocol (R10b-L-1): every issued id with no waiting request is late, however many timed out", async () => {
  const pending = new PendingCalls();
  const ids: number[] = [];
  const answers: Promise<unknown>[] = [];
  for (let i = 0; i < 1001; i += 1) {
    const id = pending.next();
    ids.push(id);
    answers.push(pending.wait(id, 1));
  }
  await Promise.all(answers);
  assert.equal(pending.size, 0);
  // The oldest is the one the earlier memory of 1000 ids forgot.
  for (const id of [ids[0]!, ids[500]!, ids[1000]!]) {
    assert.equal(pending.settle({ v: 1, id, ok: true, value: "late" }), "late", `id ${id}`);
  }
  const issued = ids[1000]!;
  for (const id of [0, -1, issued + 1, issued + 1000, 1.5, Number.MAX_SAFE_INTEGER]) {
    assert.equal(pending.settle({ v: 1, id, ok: true, value: 1 }), "unknown", `never issued: ${id}`);
  }
  const next = pending.next();
  const answer = pending.wait(next, 5_000);
  assert.equal(pending.settle({ v: 1, id: next, ok: true, value: "now" }), "delivered");
  assert.deepEqual(await answer, { v: 1, id: next, ok: true, value: "now" });
});
