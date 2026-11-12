/**
 * U-21 (DR-47, AXM-1): the engine writes EngineResult.finalMessage, the run's last model response
 * when it is a final reply: masked (registered values by the gateway, key shapes as `[key]`), line
 * breaks and tabs kept, other control and invisible characters left out, cut at
 * MAX_FINAL_MESSAGE_CHARS code points without splitting a token. A run whose model ended without a
 * reply (a limit, a model error, a cancel) has no field.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MAX_FINAL_MESSAGE_CHARS, PRIVACY_TOKEN_PATTERN_SOURCE } from "../../../src/contracts/index.js";
import type { Limits, ModelOutcome, ModelRequest } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { FAKE_SECRET, FAKE_TOKEN, FakeVerifiers, finalAnswer, harness, readCall, response } from "./fakes.js";

type Step = (request: ModelRequest) => ModelOutcome;

async function finalOf(steps: Step[], parts: { verifiers?: FakeVerifiers; limits?: Partial<Limits> } = {}) {
  const h = harness({
    steps,
    ...(parts.verifiers === undefined ? {} : { verifiers: parts.verifiers }),
    ...(parts.limits === undefined ? {} : { task: { limits: parts.limits } }),
  });
  const result = await runTask(h.deps);
  return { result, h };
}

/** A key of the Anthropic format, built at run time so no key shape is written in this file. */
const KEY = ["sk", "ant", "api03", `${"Ab3".repeat(14)}`].join("-");

describe("U-21: the agent's last message in the result", () => {
  test("scripted: a last reply that says what could not be done reaches the result as it was said", async () => {
    const said = "I could not change a.txt because it is protected. Please confirm.";
    const { result } = await finalOf([() => response([readCall("r1")]), () => finalAnswer(said)]);
    assert.deepEqual(result.finalMessage, { text: said, truncated: false });
  });

  test("scripted: a last reply holding a registered value and a key shows neither", async () => {
    const { result } = await finalOf([() => finalAnswer(`The password is ${FAKE_SECRET} and the key is ${KEY}.`)]);
    assert.deepEqual(result.finalMessage, { text: `The password is ${FAKE_TOKEN} and the key is [key].`, truncated: false });
  });

  test("line breaks and tabs stay; other control and invisible characters go, so a key split by one is still hidden", async () => {
    const broken = `${KEY.slice(0, 20)}\u0007${KEY.slice(20)}`;
    const { result } = await finalOf([() => finalAnswer(`line 1\r\nline\t2\u001b[31m red​‮ end ${broken}`)]);
    assert.deepEqual(result.finalMessage, { text: "line 1\nline\t2[31m red end [key]", truncated: false });
  });

  test("cut at the limit in code points, never inside a token", async () => {
    const emoji = await finalOf([() => finalAnswer("\u{1F600}".repeat(MAX_FINAL_MESSAGE_CHARS + 1))]);
    assert.deepEqual(emoji.result.finalMessage, { text: "\u{1F600}".repeat(MAX_FINAL_MESSAGE_CHARS), truncated: true });
    const token = await finalOf([() => finalAnswer(`${"a".repeat(MAX_FINAL_MESSAGE_CHARS - 10)}${FAKE_SECRET}`)]);
    assert.deepEqual(token.result.finalMessage, { text: "a".repeat(MAX_FINAL_MESSAGE_CHARS - 10), truncated: true });
  });

  test("after a repair round, the last reply counts", async () => {
    const verifiers = new FakeVerifiers({ v1: ["fail", "pass"] }, { v1: ["one failing", "ok"] });
    const limits = { maxRepairAttempts: 3, maxSameFailures: 3 };
    const { result } = await finalOf([() => finalAnswer("first try"), () => finalAnswer("fixed it")], { verifiers, limits });
    assert.deepEqual([result.status, result.finalMessage], ["done", { text: "fixed it", truncated: false }]);
  });

  test("no field when the model ended without a reply: a limit, a model error, a cancel, or an empty reply", async () => {
    const limit = await finalOf([() => response([readCall("r1")]), () => response([readCall("r2")])], { limits: { maxModelTurns: 2 } });
    assert.equal(limit.result.reason, "max_model_turns");
    const failed = await finalOf([() => response([readCall("r1")]), () => ({ ok: false, kind: "api_error", message: "fake failure" })]);
    assert.equal(failed.result.reason, "model_error");
    const blank = await finalOf([() => finalAnswer(" \n\t ")]);
    const cancelled = harness({ steps: [() => response([readCall("r1")]), () => finalAnswer("never seen")] });
    cancelled.controller.abort();
    const stopped = await runTask(cancelled.deps);
    for (const result of [limit.result, failed.result, blank.result, stopped]) {
      assert.equal(Object.hasOwn(result, "finalMessage"), false, `${result.status}/${result.reason}`);
    }
  });
});

describe("R-52: the last message is cleaned first, then masked, then its key shapes hidden", () => {
  const ZWSP = String.fromCodePoint(0x200b);

  test("R52-M1 (X11): a registered value shorter than 16 code points, split by an invisible character, is masked, not joined back", async () => {
    for (const value of ["R52pass", "R52pass-fifteen"]) {
      const h = harness({ steps: [() => finalAnswer(`the value is ${value.slice(0, 3)}${ZWSP}${value.slice(3)}.`)], privacy: createPrivacyGateway({ secrets: [value] }) });
      const result = await runTask(h.deps);
      const text = result.finalMessage?.text ?? "";
      assert.equal(text.includes(value), false, `${value.length} code points`);
      assert.match(text, new RegExp(`^the value is ${PRIVACY_TOKEN_PATTERN_SOURCE}[.]$`));
    }
  });

  test("R52-M2 (X14, X15, X18): a key split by LF, TAB or CRLF after 12 characters is [key], nothing of it left", async () => {
    for (const cut of ["\n", "\t", "\r\n"]) {
      const h = harness({ steps: [() => finalAnswer(`key ${KEY.slice(0, 12)}${cut}${KEY.slice(12)} end`)] });
      const result = await runTask(h.deps);
      assert.deepEqual(result.finalMessage, { text: "key [key] end", truncated: false }, JSON.stringify(cut));
    }
  });

  test("line breaks and tabs that do not split a key stay; a word after a key stays", async () => {
    const h = harness({ steps: [() => finalAnswer(`line 1\n\tline 2 ${KEY} and it works`)] });
    const result = await runTask(h.deps);
    assert.deepEqual(result.finalMessage, { text: "line 1\n\tline 2 [key] and it works", truncated: false });
  });
});
