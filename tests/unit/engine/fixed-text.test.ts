/**
 * Regression: fixed model-bound text must not contain the privacy token marker. The real gateway
 * protects that fragment, so it would become a token, shift `{{secret_token:N}}` numbering in
 * scripts and garble the instructions the model sees.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, PRIVACY_TOKEN_PATTERN_SOURCE } from "../../../src/contracts/index.js";
import { FIXED_MODEL_TEXTS, SYSTEM_PROMPT, runTask } from "../../../src/engine/index.js";
import { createScriptedProvider } from "../../../src/model/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { FakeTools, harness } from "./fakes.js";

const FAKE_SECRET = "fake-secret-VALUE-0001";
const TOKEN = new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE);
const FRAGMENT = new RegExp(PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, "i");

test("masking every fixed engine text with the real gateway creates no token", () => {
  const privacy = createPrivacyGateway({ secrets: [FAKE_SECRET] });
  for (const text of FIXED_MODEL_TEXTS) {
    assert.equal(FRAGMENT.test(text), false, `fixed text spells the marker: ${text.slice(0, 40)}`);
    const masked = privacy.mask(text);
    assert.ok(masked.ok);
    assert.equal(masked.text, text);
    assert.equal(TOKEN.test(masked.text), false);
  }
});

test("the first secret token a script repeats is the file's secret, not a piece of the system prompt", async () => {
  const privacy = createPrivacyGateway({ secrets: [FAKE_SECRET] });
  const model = createScriptedProvider({
    schemaVersion: 1,
    steps: [
      { toolCalls: [{ id: "r1", name: "read_file", args: { path: "config.txt" } }] },
      { text: "saw {{secret_token:1}}" },
    ],
  });
  const tools = new FakeTools(() => ({
    ok: true,
    payload: { path: "config.txt", content: `key=${FAKE_SECRET}\n`, hash: "a".repeat(64), hadBom: false },
  }));
  const h = harness({ privacy, tools, steps: [] });
  await runTask({ ...h.deps, model });

  const firstRequest = h.journal.ofType("model_request")[0];
  assert.equal(firstRequest?.system, SYSTEM_PROMPT);

  const fileToken = h.journal.ofType("tool_result")[0]?.result.content.match(TOKEN)?.[0];
  assert.ok(fileToken !== undefined);
  const finalText = h.journal.ofType("model_response")[1]?.text;
  assert.equal(finalText, `saw ${fileToken}`);
});
