import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MaskedText, ModelRequest } from "../../../src/contracts/index.js";
import { createScriptedProvider, parseScript } from "../../../src/model/index.js";

const TOKEN = "[[CODARYN_SECRET:0123456789abcdef]]";

function request(content = "goal"): ModelRequest {
  return { system: "system" as MaskedText, messages: [{ role: "user", content: content as MaskedText }], tools: [] };
}

describe("parseScript", () => {
  test("accepts a minimal script", () => {
    assert.equal(parseScript({ schemaVersion: 1, steps: [{ text: "hi" }] }).ok, true);
  });

  test("rejects wrong versions, shapes and unknown fields", () => {
    for (const bad of [
      null,
      { schemaVersion: 2, steps: [] },
      { schemaVersion: 1 },
      { schemaVersion: 1, steps: [{ toolCalls: [{ name: "read_file" }] }] },
      { schemaVersion: 1, steps: [{ stop: "maybe" }] },
      { schemaVersion: 1, steps: [{ delayMs: -1 }] },
      { schemaVersion: 1, steps: [{ bypassPolicy: true }] },
    ]) {
      assert.equal(parseScript(bad).ok, false, JSON.stringify(bad));
    }
  });
});

describe("createScriptedProvider", () => {
  test("answers steps in order with default ids and stop reasons", async () => {
    const model = createScriptedProvider({
      schemaVersion: 1,
      steps: [{ toolCalls: [{ name: "read_file", args: { path: "a.txt" } }] }, { text: "done" }],
    });
    const signal = new AbortController().signal;
    const first = await model.complete(request(), signal);
    assert.ok(first.ok);
    assert.equal(first.response.stop, "tool_calls");
    assert.equal(first.response.toolCalls[0]?.id, "call_1_1");
    assert.equal(first.response.usage, null);
    const second = await model.complete(request(), signal);
    assert.ok(second.ok);
    assert.equal(second.response.stop, "final");
    const third = await model.complete(request(), signal);
    assert.equal(third.ok ? "ok" : third.kind, "script_exhausted");
  });

  test("a secret token placeholder repeats only a token the model was shown", async () => {
    const script = {
      schemaVersion: 1 as const,
      steps: [{ toolCalls: [{ name: "read_file", args: { path: "dir/{{secret_token:1}}.txt" } }] }],
    };
    const shown = await createScriptedProvider(script).complete(request(`see ${TOKEN}`), new AbortController().signal);
    assert.ok(shown.ok);
    assert.equal(shown.response.toolCalls[0]?.args["path"], `dir/${TOKEN}.txt`);

    const unseen = await createScriptedProvider(script).complete(request("no token"), new AbortController().signal);
    assert.equal(unseen.ok ? "ok" : unseen.kind, "script_exhausted");
  });

  test("a delayed step ends early when the run is cancelled", async () => {
    const model = createScriptedProvider({ schemaVersion: 1, steps: [{ text: "late", delayMs: 60_000 }] });
    const controller = new AbortController();
    const started = Date.now();
    const pending = model.complete(request(), controller.signal);
    setTimeout(() => controller.abort(), 10);
    const outcome = await pending;
    assert.equal(outcome.ok ? "ok" : outcome.kind, "aborted");
    assert.ok(Date.now() - started < 5_000);
  });
});
