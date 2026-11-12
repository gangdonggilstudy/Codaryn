/**
 * U-15 (AXM-5, AXM-6, AXM-7): what the model is told when a call fails. One form for every failed
 * result, the same for every provider: `error (<errorCode>): <message>`. An argument problem names
 * the schema field and its rule (never a value the model gave); an unknown tool names the tools
 * offered in this run; a denial says what to do next, with no value. The system prompt lines
 * (AXM-16) change pinned request bodies and wait for approval.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TOOL_FAILURE_HINTS } from "../../../src/contracts/index.js";
import type { ModelRequest, ToolCall, ToolResult } from "../../../src/contracts/index.js";
import { SYSTEM_PROMPT, runTask } from "../../../src/engine/index.js";
import { FakePolicy, FakeTools, finalAnswer, harness, response } from "./fakes.js";

/** Runs one call, then a final answer; returns the recorded result and what the model got back. */
async function oneCall(call: ToolCall, parts: { policy?: FakePolicy; tools?: FakeTools } = {}) {
  let seen: ModelRequest | undefined;
  const h = harness({
    steps: [
      () => response([call]),
      (request) => {
        // A copy: the engine adds the final reply to the same message list afterwards.
        seen = { ...request, messages: [...request.messages] };
        return finalAnswer();
      },
    ],
    ...parts,
  });
  await runTask(h.deps);
  const recorded = h.journal.ofType("tool_result").map((event) => event.result);
  const last = seen?.messages.at(-1);
  const sent: readonly ToolResult[] = last?.role === "tool" ? last.results : [];
  return { recorded, sent, offered: h.model.requests[0]?.tools ?? [] };
}

const write = (args: Record<string, unknown>): ToolCall => ({ id: "w1", name: "write_file", args: args as ToolCall["args"] });

describe("U-15: one form for a failed result, which both providers get as it is", () => {
  test("AXM-7: an executed failure is error (<code>): <message>, recorded and sent alike", async () => {
    const tools = new FakeTools(() => ({ ok: false, code: "not_found", message: "the file does not exist" as never }));
    const { recorded, sent } = await oneCall({ id: "r1", name: "read_file", args: { path: "missing.txt" } }, { tools });
    // U-50 (AXM-6): a runner's failure ends with its code's hint (u50-failure-hints).
    assert.equal(recorded[0]?.content, `error (not_found): the file does not exist. ${TOOL_FAILURE_HINTS.not_found}`);
    assert.deepEqual(sent, recorded, "the model gets the recorded result");
  });

  test("AXM-5: a missing argument names its field and rule", async () => {
    const { recorded } = await oneCall(write({ path: "a.txt", change: { kind: "replace_all", content: "x" } }));
    assert.equal(recorded[0]?.content, "error (invalid_args): invalid arguments: expectedHash: required: 64 lowercase hex characters, or null for a new file");
    assert.equal(recorded[0]?.errorCode, "invalid_args");
  });

  test("AXM-5: a wrong nested value names the nested field", async () => {
    const { recorded } = await oneCall(write({ path: "a.txt", expectedHash: null, change: { kind: "append", content: "x" } }));
    assert.equal(recorded[0]?.content, 'error (invalid_args): invalid arguments: change.kind: must be "replace_all" or "replace_text"');
  });

  test("AXM-5: an unknown field is not echoed; the allowed names are listed", async () => {
    const { recorded } = await oneCall(write({ path: "a.txt", expectedHash: null, change: { kind: "replace_all", content: "x" }, mode_SECRETISH: 1 }));
    assert.equal(recorded[0]?.content, "error (invalid_args): invalid arguments: unknown field; allowed: path, expectedHash, change");
    assert.equal(recorded[0]?.content.includes("mode_SECRETISH"), false);
  });

  test("AXM-5: an unknown tool names the tools offered in this run, not the name given", async () => {
    const { recorded, offered } = await oneCall({ id: "u1", name: "delete_everything", args: {} } as unknown as ToolCall);
    assert.equal(recorded[0]?.content, `error (unknown_tool): unknown tool; the tools offered in this run: ${offered.join(", ")}`);
    assert.equal(recorded[0]?.content.includes("delete_everything"), false);
  });

  test("AXM-6: a denial says what to do next, with no value", async () => {
    const policy = new FakePolicy({ requested: () => ({ allowed: false, permission: "path", code: "protected_path" }) });
    const { recorded } = await oneCall(write({ path: "a.txt", expectedHash: null, change: { kind: "replace_all", content: "x" } }), { policy });
    assert.equal(recorded[0]?.content, "error (policy_denied): denied by policy: path/protected_path. This path is protected in this task; do not write to it.");
  });
});

describe("U-15 (AXM-16, approved): what the system prompt tells the model about the run", () => {
  const LINES = [
    "Only the tools offered in this run exist.",
    "You cannot ask the person anything during the run. If something is unclear, take the most careful reading of the goal and say which one you took.",
    "When the work is finished, reply without tool calls: what you changed, what you could not do and why, and what the person should check. Verifiers decide whether the task succeeded.",
  ];

  test("the three approved lines, the last one ending the prompt", () => {
    const lines = SYSTEM_PROMPT.split("\n");
    for (const line of LINES) assert.ok(lines.includes(line), line);
    assert.equal(lines.at(-1), LINES[2]);
    assert.equal(lines.includes("When the work is finished, reply without tool calls. Verifiers decide whether the task succeeded."), false, "the old last line is replaced");
  });

  test("the model gets them in the first request's system text", async () => {
    const h = harness({ steps: [() => finalAnswer()] });
    await runTask(h.deps);
    assert.ok(h.model.requests[0]?.system.startsWith(SYSTEM_PROMPT));
  });
});
