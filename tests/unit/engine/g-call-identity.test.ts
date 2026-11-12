/**
 * AC-D15 (DR-13, R-1 L-1): tool names and call ids come from the model and were recorded and sent
 * back as given (engine/index.ts before the fix: tool_decision and tool_result for an unknown
 * tool, model_response.toolCalls, and the next model_request's messages). The engine now records
 * a name outside every tool list as UNKNOWN_TOOL_RECORD_NAME, and keeps a call id only when it is
 * 1-64 of [A-Za-z0-9_-] and holds no registered secret; any other id is replaced by
 * REPLACED_CALL_ID_PREFIX and a number, the same one for every use of that id in the run.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CALL_ID_PATTERN_SOURCE, REPLACED_CALL_ID_PREFIX, UNKNOWN_TOOL_RECORD_NAME } from "../../../src/contracts/index.js";
import type { ToolCall } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { FAKE_SECRET, FakeTools, finalAnswer, harness, readCall, response } from "./fakes.js";

const call = (id: string, name: string, args: ToolCall["args"] = { path: "a.txt" }): ToolCall => ({ id, name, args });
const ID_PATTERN = new RegExp(CALL_ID_PATTERN_SOURCE);

/** Every text the run produced: journal records, the result, and every request the model got. */
function everything(run: ReturnType<typeof harness>, result: unknown): string {
  return JSON.stringify([run.journal.events, result, run.model.requests]);
}

describe("AC-D15 reproduction: model-given names and ids", () => {
  test("a tool name holding a registered secret is not recorded, returned or sent back", async () => {
    const run = harness({ steps: [() => response([call("c1", `steal_${FAKE_SECRET}`)]), () => finalAnswer()] });
    const result = await runTask(run.deps);
    assert.equal(everything(run, result).includes(FAKE_SECRET), false);
  });

  test("a call id holding a registered secret is not recorded, returned or sent back", async () => {
    const run = harness({ steps: [() => response([call(`id-${FAKE_SECRET}`, "read_file")]), () => finalAnswer()] });
    const result = await runTask(run.deps);
    assert.equal(everything(run, result).includes(FAKE_SECRET), false);
  });

  test("an id with characters outside the id set, or too long, is not kept", async () => {
    const odd = "id with spaces/and\nnewline";
    const long = "x".repeat(65);
    const run = harness({ steps: [() => response([call(odd, "read_file"), call(long, "read_file")]), () => finalAnswer()] });
    const result = await runTask(run.deps);
    const text = everything(run, result);
    assert.equal(text.includes("id with spaces"), false);
    assert.equal(text.includes(long), false);
  });
});

describe("AC-D15: what the engine records instead", () => {
  test("an unknown tool name is recorded and echoed as the fixed name", async () => {
    const run = harness({ steps: [() => response([call("c1", "delete_everything")]), () => finalAnswer()] });
    await runTask(run.deps);
    const [decision] = run.journal.ofType("tool_decision");
    assert.deepEqual([decision?.tool, decision?.code], [UNKNOWN_TOOL_RECORD_NAME, "unknown_tool"]);
    const [toolResult] = run.journal.ofType("tool_result");
    assert.equal(toolResult?.result.tool, UNKNOWN_TOOL_RECORD_NAME);
    const [modelResponse] = run.journal.ofType("model_response");
    assert.equal(modelResponse?.toolCalls[0]?.name, UNKNOWN_TOOL_RECORD_NAME);
    const echoed = run.model.requests[1]?.messages.find((message) => message.role === "assistant");
    assert.ok(echoed?.role === "assistant");
    assert.equal(echoed.toolCalls[0]?.name, UNKNOWN_TOOL_RECORD_NAME);
  });

  test("the fixed name is itself a valid tool-name token and is never offered", async () => {
    assert.match(UNKNOWN_TOOL_RECORD_NAME, /^[A-Za-z0-9_-]{1,64}$/);
    const run = harness({ steps: [() => response([call("c1", UNKNOWN_TOOL_RECORD_NAME)]), () => finalAnswer()] });
    await runTask(run.deps);
    assert.equal(run.journal.ofType("tool_decision")[0]?.code, "unknown_tool");
  });

  test("a replaced id is used consistently: decision, result, echo and the paired result in the next request", async () => {
    const run = harness({ steps: [() => response([call(`id-${FAKE_SECRET}`, "read_file")]), () => finalAnswer()] });
    await runTask(run.deps);
    const [decision] = run.journal.ofType("tool_decision");
    const [toolResult] = run.journal.ofType("tool_result");
    const [modelResponse] = run.journal.ofType("model_response");
    const recorded = decision?.callId;
    assert.ok(recorded !== undefined && recorded.startsWith(REPLACED_CALL_ID_PREFIX), String(recorded));
    assert.match(recorded ?? "", ID_PATTERN);
    assert.equal(toolResult?.result.callId, recorded);
    assert.equal(modelResponse?.toolCalls[0]?.id, recorded);
    const messages = run.model.requests[1]?.messages ?? [];
    const assistant = messages.find((message) => message.role === "assistant");
    const tool = messages.find((message) => message.role === "tool");
    assert.ok(assistant?.role === "assistant" && tool?.role === "tool");
    assert.equal(assistant.toolCalls[0]?.id, recorded);
    assert.equal(tool.results[0]?.callId, recorded);
  });

  test("valid ids and known names are kept as the model gave them", async () => {
    const run = harness({
      steps: [() => response([readCall("toolu_01AbC-9_x"), call("call_1_2", "write_file", { path: "b.txt", expectedHash: null, change: { kind: "replace_all", content: "b" } })]), () => finalAnswer()],
    });
    await runTask(run.deps);
    const [modelResponse] = run.journal.ofType("model_response");
    assert.deepEqual(
      modelResponse?.toolCalls.map((echoed) => [echoed.id, echoed.name]),
      [["toolu_01AbC-9_x", "read_file"], ["call_1_2", "write_file"]],
    );
    const ids = run.journal.ofType("tool_result").map((record) => record.result.callId);
    assert.deepEqual(ids, ["toolu_01AbC-9_x", "call_1_2"]);
  });

  test("a known tool the run does not offer keeps its name and is unknown_tool, as before", async () => {
    const run = harness({
      steps: [() => response([call("c1", "run_command", { executable: "node", args: [] })]), () => finalAnswer()],
      task: { tools: ["read_file"] },
    });
    await runTask(run.deps);
    const [decision] = run.journal.ofType("tool_decision");
    assert.deepEqual([decision?.tool, decision?.code], ["run_command", "unknown_tool"]);
  });

  test("the same odd id keeps one replacement, so a repeated call is answered once", async () => {
    const tools = new FakeTools();
    const odd = "same id";
    const run = harness({
      steps: [() => response([call(odd, "read_file")]), () => response([call(odd, "read_file")]), () => finalAnswer()],
      tools,
    });
    await runTask(run.deps);
    assert.equal(tools.executed.length, 1, "the second call reuses the earlier result");
    const responses = run.journal.ofType("model_response");
    assert.equal(responses[0]?.toolCalls[0]?.id, responses[1]?.toolCalls[0]?.id);
  });

  test("different odd ids get different replacements, and none collides with a kept id", async () => {
    const run = harness({
      steps: [() => response([call("a b", "read_file"), call(`${REPLACED_CALL_ID_PREFIX}1`, "read_file"), call("c d", "read_file")]), () => finalAnswer()],
    });
    await runTask(run.deps);
    const ids = run.journal.ofType("model_response")[0]?.toolCalls.map((echoed) => echoed.id) ?? [];
    assert.equal(new Set(ids).size, 3, ids.join(","));
    for (const id of ids) assert.match(id, ID_PATTERN);
    assert.equal(ids[1], `${REPLACED_CALL_ID_PREFIX}1`, "a valid model id is kept");
  });

  test("file_changed carries the recorded id", async () => {
    const run = harness({
      steps: [
        () => response([call("w 1", "write_file", { path: "b.txt", expectedHash: null, change: { kind: "replace_all", content: "b" } })]),
        () => finalAnswer(),
      ],
      tools: new FakeTools(() => ({ ok: true, payload: { path: "b.txt", previousHash: null, newHash: "c".repeat(64), created: true } })),
    });
    await runTask(run.deps);
    const [changed] = run.journal.ofType("file_changed");
    const [toolResult] = run.journal.ofType("tool_result");
    assert.ok(changed !== undefined);
    assert.equal(changed.callId, toolResult?.result.callId);
    assert.match(changed.callId, ID_PATTERN);
  });
});
