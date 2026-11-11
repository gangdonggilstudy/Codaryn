/**
 * Regression for cross review tools #4: text is masked field by field before JSON serialization,
 * so a JSON-escaped secret is not escaped a second time and missed. Uses the real privacy gateway.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { asRawText } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { FakeTools, FakeVerifiers, HASH_A, finalAnswer, harness, response } from "./fakes.js";

/** Fake secret from the review reproduction. Every form of it contains this marker. */
const SECRET = 'fake"q-review-0043';
const MARKER = "q-review-0043";
const ESCAPED = JSON.stringify(SECRET).slice(1, -1);

const privacy = () => createPrivacyGateway({ secrets: [SECRET] });

test("a command that prints JSON with the secret leaves no form of it in the journal or model requests", async () => {
  const tools = new FakeTools(() => ({
    ok: true,
    payload: { exitCode: 0, stdout: `{"token":${JSON.stringify(SECRET)}}\n`, stderr: "", timedOut: false, truncated: false },
  }));
  const command = { id: "c1", name: "run_command", args: { executable: "node", args: ["print.mjs"] } };
  const h = harness({ privacy: privacy(), tools, steps: [() => response([command]), () => finalAnswer()] });
  const result = await runTask(h.deps);
  assert.equal(result.status, "done");

  const recorded = h.journal.ofType("tool_result")[0]?.result;
  assert.ok(recorded?.ok);
  const stdout = (JSON.parse(recorded.content) as { stdout: string }).stdout;
  assert.equal(stdout.includes(ESCAPED), false);
  assert.ok(stdout.includes("[[CODARYN_SECRET:"));
  assert.equal(JSON.stringify(h.journal.events).includes(MARKER), false);
  assert.equal(JSON.stringify(h.model.requests).includes(MARKER), false);
});

test("a file whose text holds the JSON-escaped secret is masked in the tool result", async () => {
  const tools = new FakeTools(() => ({
    ok: true,
    payload: { path: "config.json", content: `{"key":"${ESCAPED}"}`, hash: HASH_A, hadBom: false },
  }));
  const read = { id: "r1", name: "read_file", args: { path: "config.json" } };
  const h = harness({ privacy: privacy(), tools, steps: [() => response([read]), () => finalAnswer()] });
  await runTask(h.deps);
  assert.equal(JSON.stringify(h.journal.events).includes(MARKER), false);
  assert.equal(JSON.stringify(h.model.requests).includes(MARKER), false);
});

test("echoed tool call arguments with a JSON-escaped secret are masked before recording", async () => {
  const write = {
    id: "w1",
    name: "write_file",
    args: { path: "notes.txt", expectedHash: null, change: { kind: "replace_all", content: `x ${ESCAPED} y` } },
  };
  const h = harness({ privacy: privacy(), steps: [() => response([write]), () => finalAnswer()] });
  await runTask(h.deps);
  const echoed = h.journal.ofType("model_response")[0]?.toolCalls[0]?.argsJson ?? "";
  assert.ok(echoed.includes("[[CODARYN_SECRET:"));
  assert.equal(JSON.stringify(h.journal.events).includes(MARKER), false);
  assert.equal(JSON.stringify(h.model.requests).includes(MARKER), false);
});

test("verifier evidence with the secret in raw or escaped form is masked", async () => {
  const verifiers = new FakeVerifiers();
  verifiers.run = async (config) => ({
    id: config.id,
    kind: config.kind,
    outcome: "pass",
    evidence: asRawText(`stdout: {"k":"${ESCAPED}"} and ${SECRET}`),
    checked: [`exit code of ${SECRET}`],
    limits: [],
  });
  const h = harness({ privacy: privacy(), verifiers, steps: [() => finalAnswer()] });
  const result = await runTask(h.deps);
  assert.equal(JSON.stringify(h.journal.events).includes(MARKER), false);
  assert.equal(JSON.stringify(result).includes(MARKER), false);
});
