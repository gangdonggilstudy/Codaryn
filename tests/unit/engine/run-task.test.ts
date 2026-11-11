import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { asRawText } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import {
  FAKE_SECRET,
  FAKE_TOKEN,
  FakeClock,
  FakePolicy,
  FakeTools,
  FakeVerifiers,
  HASH_A,
  HASH_B,
  finalAnswer,
  fakePrivacy,
  harness,
  readCall,
  response,
} from "./fakes.js";
import type { Log } from "./fakes.js";

describe("EN-02 only verifiers decide success", () => {
  test("a failing verifier ends as failed even after the model declares completion", async () => {
    const h = harness({ steps: [() => finalAnswer("all done")], verifiers: new FakeVerifiers({ v1: "fail" }) });
    const result = await runTask(h.deps);
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "verifier_failed");
    assert.equal(result.exitCode, 1);
    assert.equal(result.verifiers[0]?.outcome, "fail");
  });

  test("an inconclusive verifier ends as needs-input", async () => {
    const h = harness({ steps: [() => finalAnswer()], verifiers: new FakeVerifiers({ v1: "inconclusive" }) });
    const result = await runTask(h.deps);
    assert.equal(result.status, "needs-input");
    assert.equal(result.reason, "verifier_inconclusive");
  });

  test("no verifier ends as needs-input with a no-automatic-verification notice", async () => {
    const h = harness({ steps: [() => finalAnswer()], task: { verifiers: [] } });
    const result = await runTask(h.deps);
    assert.equal(result.status, "needs-input");
    assert.equal(result.reason, "no_verifier");
    assert.equal(result.exitCode, 3);
    assert.ok(result.notices.some((notice) => notice.includes("no automatic verification")));
  });

  test("all verifiers passing is the only way to done", async () => {
    const h = harness({ steps: [() => finalAnswer()] });
    const result = await runTask(h.deps);
    assert.equal(result.status, "done");
    assert.equal(result.reason, "verified");
    assert.equal(result.exitCode, 0);
    assert.equal(h.journal.closed, true);
    assert.equal(h.journal.ofType("run_finished")[0]?.status, "done");
  });
});

describe("EN-03 limits end the run and stop model calls", () => {
  const keepReading = (id: number) => () => response([readCall(`c${id}`)]);

  test("max model turns", async () => {
    const h = harness({
      steps: [keepReading(1), keepReading(2), keepReading(3)],
      task: { limits: { maxModelTurns: 2, maxToolCalls: 10, maxTotalTokens: null, maxDurationMs: 600_000 } },
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "budget-exhausted");
    assert.equal(result.reason, "max_model_turns");
    assert.equal(h.model.requests.length, 2);
    assert.equal(h.verifiers.runs.length, 0);
  });

  test("max tool calls", async () => {
    const h = harness({
      steps: [() => response([readCall("c1"), readCall("c2")]), () => finalAnswer()],
      task: { limits: { maxModelTurns: 10, maxToolCalls: 1, maxTotalTokens: null, maxDurationMs: 600_000 } },
    });
    const result = await runTask(h.deps);
    assert.equal(result.reason, "max_tool_calls");
    assert.equal(h.tools.executed.length, 1);
    assert.equal(h.model.requests.length, 1);
  });

  test("max total tokens", async () => {
    const h = harness({
      steps: [() => response([readCall("c1")], { usage: { inputTokens: 60, outputTokens: 50 } }), () => finalAnswer()],
      task: { limits: { maxModelTurns: 10, maxToolCalls: 10, maxTotalTokens: 100, maxDurationMs: 600_000 } },
    });
    const result = await runTask(h.deps);
    assert.equal(result.reason, "max_total_tokens");
    assert.equal(h.model.requests.length, 1);
    assert.equal(result.usage.inputTokens, 60);
  });

  test("unknown usage with a token limit stops before any tool runs", async () => {
    const h = harness({
      steps: [() => response([readCall("c1")], { usage: null }), () => finalAnswer()],
      task: { limits: { maxModelTurns: 10, maxToolCalls: 10, maxTotalTokens: 1000, maxDurationMs: 600_000 } },
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "budget-exhausted");
    assert.equal(result.reason, "usage_unknown");
    assert.equal(h.tools.executed.length, 0);
    assert.equal(h.model.requests.length, 1);
    assert.equal(result.usage.inputTokens, null);
  });

  test("unknown usage without a token limit is recorded as unknown, not zero", async () => {
    const h = harness({ steps: [() => response([], { usage: null })] });
    const result = await runTask(h.deps);
    assert.equal(result.status, "done");
    assert.equal(result.usage.inputTokens, null);
    assert.equal(result.usage.outputTokens, null);
  });

  test("max duration with an injected clock", async () => {
    const clock = new FakeClock();
    const tick = (id: number) => () => {
      clock.t += 1000;
      return response([readCall(`c${id}`)]);
    };
    const h = harness({
      clock,
      steps: [tick(1), tick(2), tick(3)],
      task: { limits: { maxModelTurns: 10, maxToolCalls: 10, maxTotalTokens: null, maxDurationMs: 1500 } },
    });
    const result = await runTask(h.deps);
    assert.equal(result.reason, "max_duration");
    assert.equal(h.model.requests.length, 2);
    assert.equal(h.tools.executed.length, 1);
  });
});

describe("EN-05 cancellation", () => {
  test("a cancel during a tool call stops further tools and keeps applied changes", async () => {
    let h: ReturnType<typeof harness> | undefined;
    const tools = new FakeTools((call) => {
      if (call.name === "write_file") {
        h?.controller.abort();
        return { ok: true, payload: { path: "a.txt", previousHash: HASH_A, newHash: HASH_B, created: false } };
      }
      return { ok: true, payload: { path: "a.txt", content: "x", hash: HASH_A, hadBom: false } };
    });
    const write = {
      id: "w1",
      name: "write_file",
      args: { path: "a.txt", expectedHash: HASH_A, change: { kind: "replace_all", content: "new" } },
    };
    h = harness({ tools, steps: [() => response([write, readCall("r1")]), () => finalAnswer()] });
    const result = await runTask(h.deps);
    assert.equal(result.status, "cancelled");
    assert.equal(result.exitCode, 5);
    assert.equal(h.tools.executed.length, 1);
    assert.equal(h.model.requests.length, 1);
    assert.equal(h.verifiers.runs.length, 0);
    assert.deepEqual(result.changes.map((change) => change.newHash), [HASH_B]);
  });

  test("a run cancelled before it starts makes no model call", async () => {
    const h = harness({ steps: [() => finalAnswer()] });
    h.controller.abort();
    const result = await runTask(h.deps);
    assert.equal(result.status, "cancelled");
    assert.equal(h.model.requests.length, 0);
  });
});

test("EN-06 a call id that was already answered is not executed again", async () => {
  const h = harness({
    steps: [() => response([readCall("c1")]), () => response([readCall("c1")]), () => finalAnswer()],
  });
  const result = await runTask(h.deps);
  assert.equal(result.status, "done");
  assert.equal(h.tools.executed.length, 1);
  const third = h.model.requests[2];
  const lastTool = third?.messages.at(-1);
  assert.equal(lastTool?.role, "tool");
  assert.equal(lastTool?.role === "tool" ? lastTool.results[0]?.callId : undefined, "c1");
});

describe("EN-07 unknown tool outcomes", () => {
  test("a read is executed again", async () => {
    let attempts = 0;
    const tools = new FakeTools(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("lost");
      return { ok: true, payload: { path: "a.txt", content: "x", hash: HASH_A, hadBom: false } };
    });
    const h = harness({ tools, steps: [() => response([readCall("c1")]), () => finalAnswer()] });
    const result = await runTask(h.deps);
    assert.equal(result.status, "done");
    assert.equal(h.tools.executed.length, 2);
  });

  test("a command is not executed again and the run needs input", async () => {
    const tools = new FakeTools(() => {
      throw new Error("lost");
    });
    const command = { id: "c1", name: "run_command", args: { executable: "node", args: ["-v"] } };
    const h = harness({ tools, steps: [() => response([command]), () => finalAnswer()] });
    const result = await runTask(h.deps);
    assert.equal(result.status, "needs-input");
    assert.equal(result.reason, "unknown_tool_outcome");
    assert.equal(h.tools.executed.length, 1);
    assert.equal(h.model.requests.length, 1);
  });

  const write = {
    id: "w1",
    name: "write_file",
    args: { path: "a.txt", expectedHash: HASH_A, change: { kind: "replace_all", content: "new" } },
  };

  test("a write is confirmed by hash: unchanged file means not applied", async () => {
    const tools = new FakeTools((call) => {
      if (call.name === "write_file") throw new Error("lost");
      return { ok: true, payload: { path: "a.txt", content: "old", hash: HASH_A, hadBom: false } };
    });
    const h = harness({ tools, steps: [() => response([write]), () => finalAnswer()] });
    const result = await runTask(h.deps);
    assert.equal(result.status, "done");
    assert.deepEqual(h.tools.executed.map((call) => call.name), ["write_file", "read_file"]);
    assert.equal(result.changes.length, 0);
    const toolMessage = h.model.requests[1]?.messages.at(-1);
    assert.equal(toolMessage?.role === "tool" ? toolMessage.results[0]?.errorCode : undefined, "io_error");
  });

  test("a write whose file changed has an unknown outcome and the run needs input", async () => {
    const tools = new FakeTools((call) => {
      if (call.name === "write_file") throw new Error("lost");
      return { ok: true, payload: { path: "a.txt", content: "?", hash: HASH_B, hadBom: false } };
    });
    const h = harness({ tools, steps: [() => response([write]), () => finalAnswer()] });
    const result = await runTask(h.deps);
    assert.equal(result.status, "needs-input");
    assert.equal(result.reason, "unknown_tool_outcome");
    assert.equal(h.model.requests.length, 1);
  });
});

test("tool calls follow checkRequested, restore, checkEffective, execute, then record", async () => {
  const log: Log = [];
  const h = harness({
    log,
    privacy: fakePrivacy({ log }),
    policy: new FakePolicy({ log }),
    tools: new FakeTools(undefined, log),
    steps: [() => response([readCall("c1")]), () => finalAnswer()],
  });
  await runTask(h.deps);
  assert.deepEqual(log, [
    "model.complete",
    "policy.checkRequested",
    "privacy.resolveToolArgs",
    "policy.checkEffective",
    "tools.execute",
    "journal.tool_result",
    "model.complete",
  ]);
});

describe("PR-09 effective arguments are checked again after restoration", () => {
  test("a denied effective path is not executed and the restored value is discarded", async () => {
    const policy = new FakePolicy({
      effective: (call) =>
        call.name === "read_file" && call.args.path.includes(FAKE_SECRET)
          ? { allowed: false, permission: "path", code: "outside_root" }
          : { allowed: true },
    });
    const h = harness({
      policy,
      steps: [() => response([readCall("c1", `../${FAKE_TOKEN}/key.txt`)]), () => finalAnswer()],
    });
    const result = await runTask(h.deps);
    assert.equal(h.tools.executed.length, 0);
    const decision = h.journal.ofType("tool_decision").find((event) => event.stage === "policy_effective");
    assert.equal(decision?.allowed, false);
    assert.equal(decision?.code, "outside_root");
    const recorded = JSON.stringify(h.journal.events) + JSON.stringify(h.model.requests) + JSON.stringify(result);
    assert.equal(recorded.includes(FAKE_SECRET), false);
    const toolMessage = h.model.requests[1]?.messages.at(-1);
    assert.equal(toolMessage?.role === "tool" ? toolMessage.results[0]?.errorCode : undefined, "policy_denied");
  });

  test("a token left in a field that is not restorable rejects the whole call", async () => {
    const command = { id: "c1", name: "run_command", args: { executable: FAKE_TOKEN, args: [] } };
    const h = harness({ steps: [() => response([command]), () => finalAnswer()] });
    await runTask(h.deps);
    assert.equal(h.tools.executed.length, 0);
    assert.equal(h.policy.effectiveCalls.length, 0);
    const decision = h.journal.ofType("tool_decision").find((event) => event.stage === "restore");
    assert.equal(decision?.code, "unresolved_token");
    assert.equal(JSON.stringify(h.journal.events).includes(FAKE_SECRET), false);
  });
});

test("PR-10 a tool result with a secret is masked before it is recorded or sent", async () => {
  const tools = new FakeTools(() => ({
    ok: true,
    payload: { path: "a.txt", content: `key=${FAKE_SECRET}`, hash: HASH_A, hadBom: false },
  }));
  const h = harness({ tools, steps: [() => response([readCall("c1")]), () => finalAnswer()] });
  const result = await runTask(h.deps);
  assert.equal(result.status, "done");
  const journal = JSON.stringify(h.journal.events);
  const sent = JSON.stringify(h.model.requests);
  assert.equal(journal.includes(FAKE_SECRET), false);
  assert.equal(sent.includes(FAKE_SECRET), false);
  assert.ok(journal.includes(FAKE_TOKEN));
  assert.ok(sent.includes(FAKE_TOKEN));
});

describe("PR-11 a masking failure prevents sending and recording", () => {
  test("failing to mask the goal makes no model call", async () => {
    const h = harness({
      privacy: fakePrivacy({ failWhen: (text) => text === "do the work" }),
      steps: [() => finalAnswer()],
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "failed");
    assert.equal(h.model.requests.length, 0);
    assert.equal(h.journal.ofType("model_request").length, 0);
  });

  test("failing to mask a tool result records nothing of it and makes no further model call", async () => {
    const tools = new FakeTools(() => ({
      ok: false,
      code: "io_error",
      message: asRawText("UNMASKABLE output"),
    }));
    const h = harness({
      tools,
      privacy: fakePrivacy({ failWhen: (text) => text.includes("UNMASKABLE") }),
      steps: [() => response([readCall("c1")]), () => finalAnswer()],
    });
    const result = await runTask(h.deps);
    assert.equal(result.status, "failed");
    assert.equal(h.model.requests.length, 1);
    assert.equal(h.journal.ofType("tool_result").length, 0);
    assert.equal(JSON.stringify(h.journal.events).includes("UNMASKABLE"), false);
  });
});

test("an invalid write without expectedHash is rejected before policy and execution", async () => {
  const write = { id: "w1", name: "write_file", args: { path: "a.txt", change: { kind: "replace_all", content: "x" } } };
  const h = harness({ steps: [() => response([write]), () => finalAnswer()] });
  await runTask(h.deps);
  assert.equal(h.tools.executed.length, 0);
  assert.equal(h.journal.ofType("tool_decision")[0]?.code, "invalid_args");
});
