/**
 * GUI report F-2 (R21b-I-1): the app layer took injection points for Anthropic only
 * (`anthropicDeps`), so another provider's requests always used the global fetch. `providerDeps`
 * gives each API provider its own, as the CLI's runCli and runModels take them. Checked with a
 * counting fetch in front of the fake OpenAI server on 127.0.0.1. Fake values only, not key-shaped.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { CODARYN_OPENAI_API_BASE_URL_ENV, OPENAI_API_KEY_ENV } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import { FAKE_OPENAI_MODEL_CATALOG } from "../../fixtures/openai.js";
import { replyFinal, responsesRequests, startFakeOpenAI } from "../../support/fake-openai.js";
import { appEnvironment, tempDir } from "./support.js";

const OPENAI_VALUE = ["cdy-fake", "appdeps", "openai", "value", "0001"].join("-");
const LIMITS = { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 10_000, maxDurationMs: 60_000 };

/** A fetch that counts the requests it passes on to the global fetch. */
function countingFetch(): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetch: async (input, init) => {
      urls.push(String(input instanceof Request ? input.url : input));
      return fetch(input, init);
    },
  };
}

describe("providerDeps: each API provider's injection points (GUI F-2)", () => {
  test("an openai run and an openai model list go through providerDeps.openai", async (t) => {
    const api = await startFakeOpenAI(t, [replyFinal("done")], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
    const base = await tempDir("codaryn-unit-app-provider-deps-");
    const config = path.join(base, "config.json");
    await writeFile(config, JSON.stringify({ schemaVersion: 1, provider: "openai", providers: { openai: { model: "gpt-fake", maxOutputTokens: 64 } }, limits: LIMITS }), "utf8");
    const workspace = path.join(base, "ws");
    await mkdir(workspace);
    const counting = countingFetch();
    // A variable, not a literal: before the field existed this compiled and was ignored.
    const hooks = { providerDeps: { openai: { fetch: counting.fetch } } };
    const app = createCodarynApp(await appEnvironment(base, { env: { [OPENAI_API_KEY_ENV]: OPENAI_VALUE, [CODARYN_OPENAI_API_BASE_URL_ENV]: api.baseUrl } }), hooks);

    const started = await app.startRun({ input: { kind: "quick", workspace, goal: "say done" }, configPath: config, varsFile: null, profile: null, workflowRef: null, cancelFile: null });
    assert.ok(started.ok, JSON.stringify(started));
    const ended = await started.handle.done;
    assert.ok(ended.ok && ended.result.reason !== "model_error", JSON.stringify(ended));
    assert.equal(responsesRequests(api).length, 1);
    assert.equal(counting.urls.filter((url) => url.endsWith("/responses")).length, 1, "the run's request went through the hook");

    const listed = await app.listModels({ provider: "openai", configPath: config, varsFile: null });
    assert.ok(listed.ok, JSON.stringify(listed));
    assert.equal(counting.urls.filter((url) => url.endsWith("/models")).length, 1, "the listing went through the hook");
    assert.equal(counting.urls.length, api.requests.length, "every request went through the hook");
  });
});
