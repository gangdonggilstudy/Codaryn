/**
 * SP-6: `codaryn models [--provider <name>]` follows the chosen provider (`--provider`, else the
 * config's `provider`, else anthropic): its key, its address, its lister, its key hint, and `--use`
 * writes where that provider's model is kept (`providers.<name>.model`; anthropic's top level
 * unless the file keeps `providers.anthropic`). The OpenAI side runs only against the integration
 * owner's fake server on 127.0.0.1; the Anthropic side only against a counting stand-in for fetch.
 * The real APIs are never called.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  ANTHROPIC_API_KEY_ENV,
  CODARYN_API_BASE_URL_ENV,
  CODARYN_OPENAI_API_BASE_URL_ENV,
  CODARYN_OPENAI_MODEL_ENV,
  OPENAI_API_KEY_ENV,
} from "../../../src/contracts/index.js";
import type { ModelsOutput } from "../../../src/contracts/index.js";
import { parseConfig } from "../../../src/cli/config.js";
import { runModels } from "../../../src/cli/models.js";
import { API_MODEL_LISTERS, anthropicModelLister } from "../../../src/cli/provider.js";
import { FAKE_OPENAI_MODEL_CATALOG } from "../../fixtures/openai.js";
import { bearerKeysOf, openAIModelsRequests, startFakeOpenAI } from "../../support/fake-openai.js";
import type { FakeOpenAI } from "../../support/fake-openai.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const ANTHROPIC_VALUE = ["cdy-fake", "sp6m", "anthropic", "value", "0001"].join("-");
const OPENAI_VALUE = ["cdy-fake", "sp6m", "openai", "value", "0001"].join("-");
const KEYS = { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE, [OPENAI_API_KEY_ENV]: OPENAI_VALUE };
const FIRST_ID = FAKE_OPENAI_MODEL_CATALOG[0]?.id ?? "";
/** The one model the Anthropic stand-in lists. */
const ANTHROPIC_LISTED = "claude-listed-one";

interface Outcome {
  readonly output: (ModelsOutput & { kind: "models" }) | { kind: "error"; code: string; message: string };
  readonly anthropicRequests: string[];
  readonly configText: string;
}

async function models(api: FakeOpenAI | null, configValue: Record<string, unknown> | null, argv: readonly string[], env: Record<string, string> = KEYS): Promise<Outcome> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-sp6-models-"));
  temporaryDirs.push(base);
  const configPath = path.join(base, "config.json");
  if (configValue !== null) await writeFile(configPath, `${JSON.stringify({ schemaVersion: 1, ...configValue }, null, 2)}\n`, "utf8");
  const anthropicRequests: string[] = [];
  const counting: typeof fetch = async (input) => {
    anthropicRequests.push(String(input));
    const data = [{ type: "model", id: ANTHROPIC_LISTED, display_name: "Listed", created_at: "2026-01-01T00:00:00Z" }];
    return new Response(JSON.stringify({ data, has_more: false, first_id: ANTHROPIC_LISTED, last_id: ANTHROPIC_LISTED }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const outcome = await runModels({
    argv: ["models", "--config", configPath, "--json", ...argv],
    env: api === null ? env : { ...env, [CODARYN_OPENAI_API_BASE_URL_ENV]: api.baseUrl },
    cwd: base,
    readFile: (file) => readFile(file, "utf8"),
    loadEnvFile: () => {},
    listModels: anthropicModelLister,
    anthropicDeps: { fetch: counting },
    // The OpenAI lister is the real adapter; its address is the fake server's.
    listers: { openai: API_MODEL_LISTERS.openai },
  });
  const text = "text" in outcome ? outcome.text : JSON.stringify(outcome.output);
  const configText = await readFile(configPath, "utf8").catch(() => "");
  return { output: JSON.parse(text) as Outcome["output"], anthropicRequests, configText };
}

describe("SP-6: models lists the chosen provider's models", () => {
  test("--provider openai: the OpenAI key to the OpenAI address, nothing to Anthropic", async (t) => {
    const api = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
    // Anthropic's address variable is set too; it is not openai's.
    const { output, anthropicRequests } = await models(api, {}, ["--provider", "openai"], { ...KEYS, [CODARYN_API_BASE_URL_ENV]: api.url });
    assert.equal(output.kind, "models", JSON.stringify(output));
    if (output.kind !== "models") return;
    assert.equal(output.provider, "openai");
    assert.deepEqual(output.models.map((model) => model.id), FAKE_OPENAI_MODEL_CATALOG.map((model) => model.id));
    assert.equal(openAIModelsRequests(api).length, 1);
    assert.deepEqual(bearerKeysOf(api), [OPENAI_VALUE]);
    assert.deepEqual(anthropicRequests, []);
  });

  test("R-20 D2 after SP-6: the config's provider openai is followed; the Anthropic key goes nowhere", async (t) => {
    const api = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
    const { output, anthropicRequests } = await models(api, { provider: "openai" }, [], { ...KEYS, [CODARYN_API_BASE_URL_ENV]: api.url });
    assert.equal(output.kind, "models", JSON.stringify(output));
    assert.deepEqual(bearerKeysOf(api), [OPENAI_VALUE]);
    assert.deepEqual(anthropicRequests, []);
  });

  test("--provider anthropic overrides the config's openai", async () => {
    const { output, anthropicRequests } = await models(null, { provider: "openai" }, ["--provider", "anthropic"]);
    assert.equal(output.kind, "models", JSON.stringify(output));
    assert.equal(anthropicRequests.length, 1);
    if (output.kind === "models") assert.deepEqual(output.models.map((model) => model.id), [ANTHROPIC_LISTED]);
  });

  test("an unknown --provider, a missing OpenAI key, a refused key: nothing sent, the OpenAI variable named", async (t) => {
    const unknown = await models(null, {}, ["--provider", "scripted"]);
    assert.ok(unknown.output.kind === "error" && unknown.output.code === "invalid_arguments", JSON.stringify(unknown.output));
    const api = await startFakeOpenAI(t, [], { models: { models: [], failWith: { status: 401, type: "invalid_request_error", code: "invalid_api_key" } } });
    const missing = await models(api, {}, ["--provider", "openai"], { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE });
    assert.ok(missing.output.kind === "error" && missing.output.code === "provider_not_configured" && missing.output.message.includes(OPENAI_API_KEY_ENV), JSON.stringify(missing.output));
    assert.equal(api.requests.length, 0);
    const refused = await models(api, {}, ["--provider", "openai"]);
    assert.ok(refused.output.kind === "error" && refused.output.code === "model_list_failed", JSON.stringify(refused.output));
    assert.ok(refused.output.message.includes(`check ${OPENAI_API_KEY_ENV}`), refused.output.message);
  });
});

describe("SP-6: --use writes where the provider's model is kept", () => {
  test("openai: providers.openai.model, nothing else changed", async (t) => {
    const api = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
    const { output, configText } = await models(api, { model: "claude-kept", providers: { openai: { maxOutputTokens: 64 } } }, ["--provider", "openai", "--use", "1"]);
    assert.equal(output.kind, "models", JSON.stringify(output));
    if (output.kind !== "models") return;
    assert.deepEqual(output.selected, { id: FIRST_ID, created: false, overriddenBy: null });
    const written = JSON.parse(configText) as Record<string, unknown>;
    assert.deepEqual(written, { schemaVersion: 1, model: "claude-kept", providers: { openai: { maxOutputTokens: 64, model: FIRST_ID } } });
    assert.ok(parseConfig(written).ok);
  });

  test("openai with no providers yet: the entry is added", async (t) => {
    const api = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
    const { configText } = await models(api, { provider: "openai" }, ["--use", FIRST_ID]);
    assert.deepEqual(JSON.parse(configText), { schemaVersion: 1, provider: "openai", providers: { openai: { model: FIRST_ID } } });
  });

  test("anthropic kept in providers.anthropic is written there (before: config_write_failed)", async () => {
    const { configText, output } = await models(null, { providers: { anthropic: { model: "old", maxOutputTokens: 100 } } }, ["--use", "1"]);
    assert.equal(output.kind, "models", JSON.stringify(output));
    assert.deepEqual(JSON.parse(configText), { schemaVersion: 1, providers: { anthropic: { model: ANTHROPIC_LISTED, maxOutputTokens: 100 } } });
  });

  test("anthropic at the top level stays at the top level", async () => {
    const { configText } = await models(null, { model: "old" }, ["--use", "1"]);
    assert.deepEqual(JSON.parse(configText), { schemaVersion: 1, model: ANTHROPIC_LISTED });
  });
});

describe("SP-6: the current model of the chosen provider", () => {
  test("openai's current model comes from providers.openai", async (t) => {
    const api = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
    const { output } = await models(api, { model: "claude-x", providers: { openai: { model: FIRST_ID } } }, ["--provider", "openai"]);
    assert.ok(output.kind === "models");
    if (output.kind !== "models") return;
    assert.deepEqual(output.current, { id: FIRST_ID, source: "config", listed: true });
  });

  test(
    "CODARYN_OPENAI_MODEL as the current model's source",
    { todo: "contract: ModelsOutput.current.source and selected.overriddenBy name only CODARYN_MODEL; asked to take the provider's model variable" },
    async (t) => {
      const api = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
      const { output } = await models(api, {}, ["--provider", "openai"], { ...KEYS, [CODARYN_OPENAI_MODEL_ENV]: FIRST_ID });
      assert.ok(output.kind === "models");
      if (output.kind !== "models") return;
      assert.deepEqual(output.current, { id: FIRST_ID, source: CODARYN_OPENAI_MODEL_ENV, listed: true });
    },
  );
});

void stat;
