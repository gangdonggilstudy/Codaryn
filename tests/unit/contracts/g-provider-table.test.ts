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
  OPENAI_KEY_LOOSE_PATTERN_SOURCE,
  API_KEY_MASK_PATTERN_SOURCES,
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

  /** R-19 L-1: the reviewer's ordinary texts and key-like texts (key-shape.mjs), built at run time. */
  const p = (...parts: string[]) => parts.join("");
  const ORDINARY: Record<string, string> = {
    "python package": "pip install sk-learn",
    "inside a word (task-)": "run task-runner-for-long-names-and-more-words-here",
    "inside a word (risk-)": "see risk-assessment-for-the-quarter-and-the-next-one",
    "Slovak locale": "locales/sk-SK/messages.json",
    "kebab slug folder": p("rename the folder ", "sk", "-mobile-app-redesign-final-draft-v2"),
    "git branch": p("checkout ", "sk", "-1234-implement-provider-table-and-key-list"),
    "CSS class": p('<div class="', "sk", '-circle-fade-in-animation-delay-long">'),
    "after a slash": p("docs/", "sk", "-onboarding-guide-for-new-team-members.md"),
    "UUID with prefix": p("id ", "sk", "-550e8400-e29b-41d4-a716-446655440000"),
    "markdown anchor": p("[link](#", "sk", "-installation-and-configuration-guide)"),
    "Korean before": p("\uD3F4\uB354", "sk", "-mobile-app-redesign-final-draft-v2-ko"),
    "underscore key (Stripe style)": p("sk", "_live_", "a".repeat(40)),
  };
  const KEY_LIKE: Record<string, string> = {
    "legacy style": p("sk", "-", "Aa1".repeat(16)),
    "project style": p("sk", "-proj-", "Ab3_Cd4-".repeat(20)),
  };

  test("DR-32 (a): the refusal shape matches no ordinary text of the reviewer's set, and both key styles", () => {
    const refuse = new RegExp(OPENAI_KEY_PATTERN_SOURCE);
    for (const [name, text] of Object.entries(ORDINARY)) assert.equal(refuse.test(text), false, name);
    for (const [name, text] of Object.entries(KEY_LIKE)) assert.ok(refuse.test(text), name);
    const long = (prefix: string, tail: string) => prefix + tail;
    assert.equal(refuse.test(long(p("sk", "-"), "a1".repeat(16))), false, "digits but no upper-case letter");
    assert.equal(refuse.test(long(p("sk", "-"), "aB".repeat(16))), false, "upper-case but no digit");
    assert.ok(refuse.test(long(p("sk", "-"), "aB1".repeat(11))), "33 characters with both");
    assert.equal(refuse.test(long(p("sk", "-"), "aB1".repeat(10))), false, "30 characters: too short");
  });

  test("DR-32 (a): the loose shape is for hiding only; the refusal list does not hold it", () => {
    const loose = new RegExp(OPENAI_KEY_LOOSE_PATTERN_SOURCE);
    for (const [name, text] of Object.entries(KEY_LIKE)) assert.ok(loose.test(text), name);
    assert.ok(loose.test(ORDINARY["kebab slug folder"] as string), "it hides some ordinary names (accepted for output only)");
    assert.equal((API_KEY_PATTERN_SOURCES as readonly string[]).includes(OPENAI_KEY_LOOSE_PATTERN_SOURCE), false);
    assert.ok((API_KEY_MASK_PATTERN_SOURCES as readonly string[]).includes(OPENAI_KEY_LOOSE_PATTERN_SOURCE));
    for (const source of API_KEY_PATTERN_SOURCES) assert.ok((API_KEY_MASK_PATTERN_SOURCES as readonly string[]).includes(source), source);
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
