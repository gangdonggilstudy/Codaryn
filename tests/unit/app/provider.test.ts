/**
 * DR-22, SP-6 through the app layer: the provider a request names is the one the CLI uses, and a
 * run follows the config's provider as `codaryn run` does. The OpenAI lister and provider are the
 * real adapters, pointed at the integration owner's fake server on 127.0.0.1
 * (tests/support/fake-openai.ts); Anthropic's lister is the real one with a counting fetch. Nothing
 * leaves the machine. Fake values only, not key-shaped.
 */

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV, CODARYN_API_BASE_URL_ENV, CODARYN_OPENAI_API_BASE_URL_ENV, OPENAI_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { ModelsOutput } from "../../../src/contracts/index.js";
import { createCodarynApp, modelsArguments } from "../../../src/app/index.js";
import type { AppCallOutcome } from "../../../src/app/index.js";
import { FAKE_OPENAI_MODEL_CATALOG } from "../../fixtures/openai.js";
import { assertOpenAIProtocolClean, bearerKeysOf, openAIModelsRequests, replyFinal, responsesRequests, startFakeOpenAI } from "../../support/fake-openai.js";
import type { FakeOpenAI } from "../../support/fake-openai.js";
import { appEnvironment, tempDir } from "./support.js";

const ANTHROPIC_VALUE = ["cdy-fake", "app", "anthropic", "value", "0001"].join("-");
const OPENAI_VALUE = ["cdy-fake", "app", "openai", "value", "0001"].join("-");
const KEYS = { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE, [OPENAI_API_KEY_ENV]: OPENAI_VALUE };
const FIRST_OPENAI_ID = FAKE_OPENAI_MODEL_CATALOG[0]?.id ?? "";
/** The one model the Anthropic stand-in lists. */
const ANTHROPIC_LISTED = "claude-listed-one";
const LIMITS = { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 10_000, maxDurationMs: 60_000 };

function ok(outcome: AppCallOutcome<ModelsOutput>): ModelsOutput {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: ModelsOutput }).output;
}

/** An app over a config file, with both keys, the OpenAI address of `api`, and a counting fetch for Anthropic. */
async function setup(configValue: Record<string, unknown>, api: FakeOpenAI | null) {
  const base = await tempDir("codaryn-unit-app-provider-");
  const config = path.join(base, "config.json");
  await writeFile(config, `${JSON.stringify({ schemaVersion: 1, ...configValue }, null, 2)}\n`, "utf8");
  const anthropicRequests: string[] = [];
  const counting: typeof fetch = async (input) => {
    anthropicRequests.push(String(input));
    const data = [{ type: "model", id: ANTHROPIC_LISTED, display_name: "Listed", created_at: "2026-01-01T00:00:00Z" }];
    return new Response(JSON.stringify({ data, has_more: false, first_id: ANTHROPIC_LISTED, last_id: ANTHROPIC_LISTED }), { status: 200, headers: { "content-type": "application/json" } });
  };
  // Anthropic's address variable points at the fake OpenAI server too: it is not openai's.
  const env = api === null ? { ...KEYS } : { ...KEYS, [CODARYN_OPENAI_API_BASE_URL_ENV]: api.baseUrl, [CODARYN_API_BASE_URL_ENV]: api.url };
  const app = createCodarynApp(await appEnvironment(base, { env }), { anthropicDeps: { fetch: counting } });
  return { base, config, app, anthropicRequests };
}

describe("the provider a request names reaches the CLI (DR-22, SP-6)", () => {
  test("modelsArguments passes --provider; a name that is not an API provider is refused before anything is read", () => {
    assert.deepEqual(modelsArguments({ provider: "openai", configPath: "c.json", varsFile: null }), {
      ok: true,
      argv: ["models", "--provider", "openai", "--config", "c.json", "--json"],
    });
    assert.deepEqual(modelsArguments({ provider: "anthropic", configPath: null, varsFile: null, model: "m" }), {
      ok: true,
      argv: ["models", "--provider", "anthropic", "--json", "--use", "m"],
    });
    for (const provider of ["scripted", "gemini", "", "--json", "OpenAI"]) {
      const refused = modelsArguments({ provider, configPath: null, varsFile: null });
      assert.equal(refused.ok ? null : refused.error.code, "invalid_arguments", provider);
    }
  });

  test("listModels for openai: the OpenAI key to the OpenAI address, nothing to Anthropic, no key in the output", async (t) => {
    const api = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
    // The config is an Anthropic one: the request's provider decides.
    const { config, app, anthropicRequests } = await setup({ model: "claude-in-config" }, api);
    const output = ok(await app.listModels({ provider: "openai", configPath: config, varsFile: null }));
    assert.equal(output.provider, "openai");
    assert.deepEqual(output.models.map((model) => model.id), FAKE_OPENAI_MODEL_CATALOG.map((model) => model.id));
    assert.equal(openAIModelsRequests(api).length, 1);
    assert.deepEqual(bearerKeysOf(api), [OPENAI_VALUE]);
    assert.deepEqual(anthropicRequests, []);
    const text = JSON.stringify(output);
    assert.equal(text.includes(OPENAI_VALUE) || text.includes(ANTHROPIC_VALUE), false);
  });

  test("listModels for anthropic follows the request, not the config's provider openai", async (t) => {
    const api = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
    const { config, app, anthropicRequests } = await setup({ provider: "openai", providers: { openai: { model: FIRST_OPENAI_ID } } }, api);
    const output = ok(await app.listModels({ provider: "anthropic", configPath: config, varsFile: null }));
    // The CLI leaves `provider` out for anthropic, so its output stays as before SP-6.
    assert.equal(output.provider ?? "anthropic", "anthropic");
    assert.deepEqual(output.models.map((model) => model.id), [ANTHROPIC_LISTED]);
    assert.equal(anthropicRequests.length, 1);
    assert.deepEqual(api.requests, [], "nothing to the OpenAI address");
  });

  test("selectModel for openai writes providers.openai.model only", async (t) => {
    const api = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
    const { config, app, anthropicRequests } = await setup({ model: "claude-in-config" }, api);
    const output = ok(await app.selectModel({ provider: "openai", configPath: config, varsFile: null, model: FIRST_OPENAI_ID }));
    assert.deepEqual([output.provider, output.status, output.selected?.id], ["openai", "selected", FIRST_OPENAI_ID]);
    assert.deepEqual(JSON.parse(await readFile(config, "utf8")), { schemaVersion: 1, model: "claude-in-config", providers: { openai: { model: FIRST_OPENAI_ID } } });
    assert.deepEqual(bearerKeysOf(api), [OPENAI_VALUE]);
    assert.deepEqual(anthropicRequests, []);
  });

  test("a run follows the config's provider openai: the OpenAI key to the OpenAI address only", async (t) => {
    const api = await startFakeOpenAI(t, [replyFinal("done")]);
    const { base, config, app, anthropicRequests } = await setup({ provider: "openai", providers: { openai: { model: "gpt-fake", maxOutputTokens: 64 } }, limits: LIMITS }, api);
    const workspace = path.join(base, "ws");
    await mkdir(workspace);
    const started = await app.startRun({ input: { kind: "quick", workspace, goal: "say done" }, configPath: config, varsFile: null, profile: null, workflowRef: null, cancelFile: null });
    assert.ok(started.ok, JSON.stringify(started));
    const ended = await started.handle.done;
    assert.ok(ended.ok, JSON.stringify(ended));
    assert.equal(ended.result.reason === "model_error", false, JSON.stringify(ended.result));
    assert.equal(responsesRequests(api).length, 1);
    assert.deepEqual(bearerKeysOf(api), [OPENAI_VALUE]);
    assert.equal((responsesRequests(api)[0]?.body as { model?: string }).model, "gpt-fake");
    assertOpenAIProtocolClean(api);
    for (const request of api.requests) {
      assert.equal(JSON.stringify(request.headers).includes(ANTHROPIC_VALUE) || request.bodyText.includes(ANTHROPIC_VALUE), false);
    }
    assert.deepEqual(anthropicRequests, []);
  });
});
