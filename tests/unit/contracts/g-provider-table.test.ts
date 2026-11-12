/**
 * SP-1 (docs/design/second-provider.md 4.1, 4.5, 4.7): the provider table holds exactly the values
 * the CLI used before it, the name lists come from it, the old Anthropic type names stay usable,
 * and a model error may carry its HTTP status. No behaviour changes (SP-0 pins the adapter).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_KEY_PATTERN_SOURCE,
  API_KEY_ENVS,
  API_KEY_PATTERN_SOURCES,
  API_PROVIDERS,
  API_PROVIDER_NAMES,
  DEFAULT_ANTHROPIC_API_BASE_URL,
  DEFAULT_OPENAI_API_BASE_URL,
  MAX_OUTPUT_TOKENS_LIMIT,
  MODEL_ERROR_KINDS,
  HELP_OPTIONS,
  MESSAGE_IDS,
  FIXED_MESSAGES,
  MODEL_PROVIDER_NAMES,
  OPENAI_API_KEY_ENV,
  OPENAI_KEY_PATTERN_SOURCE,
  SCHEMA_FIELD_NAMES,
} from "../../../src/contracts/index.js";
import type {
  AnthropicListSettings,
  ApiProviderName,
  CodarynConfig,
  InitOutput,
  ModelsOutput,
  CreateAnthropicProvider,
  CreateApiProvider,
  ListAnthropicModels,
  ListModels,
  ListModelsSettings,
  ModelConfig,
  ModelOutcome,
  ModelProviderName,
  ResolvedAnthropicSettings,
  ResolvedApiSettings,
} from "../../../src/contracts/index.js";

/** True only when A and B are the same type. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameNames: Same<ModelProviderName, "scripted" | "anthropic" | "openai"> = true;
const sameApiNames: Same<ApiProviderName, "anthropic" | "openai"> = true;
const sameSettings: Same<ResolvedAnthropicSettings, ResolvedApiSettings> = true;
const sameFactory: Same<CreateAnthropicProvider, CreateApiProvider> = true;
const sameList: Same<ListAnthropicModels, ListModels> = true;
const sameListSettings: Same<AnthropicListSettings, ListModelsSettings> = true;
const apiModel: ModelConfig = { provider: "anthropic", model: "m", maxOutputTokens: 1024 };
const openaiModel: ModelConfig = { provider: "openai", model: "a-model-the-user-picked", maxOutputTokens: 2048 };
/** The per-provider union keeps Extract working, as the CLI's settings code uses it. */
const anthropicOnly: Extract<ModelConfig, { provider: "anthropic" }> = { provider: "anthropic" };
const withStatus: ModelOutcome = { ok: false, kind: "api_error", message: "HTTP 404", httpStatus: 404 };
const withoutStatus: ModelOutcome = { ok: false, kind: "timeout", message: "late" };
/** SP-D3, SP-D10: the config's provider choice and per-provider settings, and a profile's provider. */
const config: CodarynConfig = {
  schemaVersion: 1,
  provider: "anthropic",
  providers: { anthropic: { model: "m", maxOutputTokens: 2048, apiBaseUrl: "https://api.anthropic.com", requestTimeoutMs: 60_000, maxRetries: 2 } },
  profiles: { quick: { provider: "anthropic" } },
};
const models: Pick<ModelsOutput, "provider"> = { provider: "anthropic" };
const init: Pick<InitOutput, "provider"> = {};
void [sameNames, sameApiNames, sameSettings, sameFactory, sameList, sameListSettings, apiModel, openaiModel, anthropicOnly, withStatus, withoutStatus, config, models, init];

describe("SP-1: the provider table", () => {
  test("the anthropic entry holds the values the CLI used before", () => {
    assert.deepEqual(API_PROVIDERS.anthropic, {
      keyEnv: ANTHROPIC_API_KEY_ENV,
      keyPatternSources: [ANTHROPIC_KEY_PATTERN_SOURCE],
      defaultApiBaseUrl: DEFAULT_ANTHROPIC_API_BASE_URL,
      baseUrlPath: "without_version",
      maxOutputTokensLimit: MAX_OUTPUT_TOKENS_LIMIT,
      minOutputTokens: 1,
    });
    assert.equal(ANTHROPIC_API_KEY_ENV, "ANTHROPIC_API_KEY");
    assert.equal(DEFAULT_ANTHROPIC_API_BASE_URL, "https://api.anthropic.com");
    assert.equal(MAX_OUTPUT_TOKENS_LIMIT, 200_000);
  });

  test("the name lists and the derived lists come from the table", () => {
    assert.deepEqual([...API_PROVIDER_NAMES], Object.keys(API_PROVIDERS));
    assert.deepEqual([...MODEL_PROVIDER_NAMES], ["scripted", "anthropic", "openai"]);
    assert.equal(new Set(MODEL_PROVIDER_NAMES).size, MODEL_PROVIDER_NAMES.length);
  });

  test("every key Codaryn knows is listed, the providers still being added included; the table's are among them", () => {
    assert.deepEqual([...API_KEY_ENVS], ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
    assert.equal(OPENAI_API_KEY_ENV, "OPENAI_API_KEY");
    assert.deepEqual([...API_KEY_PATTERN_SOURCES], [ANTHROPIC_KEY_PATTERN_SOURCE, OPENAI_KEY_PATTERN_SOURCE]);
    for (const name of API_PROVIDER_NAMES) {
      assert.ok((API_KEY_ENVS as readonly string[]).includes(API_PROVIDERS[name].keyEnv), name);
      for (const source of API_PROVIDERS[name].keyPatternSources) assert.ok((API_KEY_PATTERN_SOURCES as readonly string[]).includes(source), name);
    }
  });

  test("the loose OpenAI key shape finds long sk- text at a word start only (built at run time: no key shape in this file)", () => {
    const shape = new RegExp(OPENAI_KEY_PATTERN_SOURCE);
    const long = (prefix: string, length: number) => prefix + "Ab3_-".repeat(Math.ceil(length / 5)).slice(0, length);
    assert.ok(shape.test(long(["sk", "proj", ""].join("-"), 40)), "a project-style key");
    assert.ok(shape.test(`key=${long(["sk", ""].join("-"), 32)}`), "32 characters after the prefix");
    assert.equal(shape.test(long(["sk", ""].join("-"), 31)), false, "31 characters: too short");
    assert.equal(shape.test(["sk", "learn"].join("-")), false, "a short word");
    assert.equal(shape.test(long(["task", ""].join("-"), 40)), false, "sk- inside a word");
  });

  test("the openai entry holds the confirmed facts (DR-31)", () => {
    assert.deepEqual(API_PROVIDERS.openai, {
      keyEnv: OPENAI_API_KEY_ENV,
      keyPatternSources: [OPENAI_KEY_PATTERN_SOURCE],
      defaultApiBaseUrl: DEFAULT_OPENAI_API_BASE_URL,
      baseUrlPath: "with_version",
      maxOutputTokensLimit: MAX_OUTPUT_TOKENS_LIMIT,
      minOutputTokens: 16,
    });
    assert.equal(DEFAULT_OPENAI_API_BASE_URL, "https://api.openai.com/v1");
  });

  test("the bundle's message and help additions", () => {
    assert.ok((MODEL_ERROR_KINDS as readonly string[]).includes("quota_exhausted"));
    assert.ok((MESSAGE_IDS as readonly string[]).includes("modelError.quota_exhausted"));
    assert.ok((HELP_OPTIONS as readonly string[]).includes("provider"));
    for (const id of ["init.key_set", "init.key_missing", "init.key_hint_windows", "init.key_hint_posix", "doctor.api_key.ok"] as const) {
      assert.deepEqual(FIXED_MESSAGES[id], { keyEnv: "keyEnv" }, id);
    }
    assert.deepEqual(FIXED_MESSAGES["doctor.api_key.missing"], { keyEnv: "keyEnv", provider: "provider" });
  });

  test("the config's providers map is a schema field name", () => {
    assert.ok((SCHEMA_FIELD_NAMES as readonly string[]).includes("provider"));
    assert.ok((SCHEMA_FIELD_NAMES as readonly string[]).includes("providers"));
  });
});
