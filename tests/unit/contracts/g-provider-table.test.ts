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
  MAX_OUTPUT_TOKENS_LIMIT,
  MODEL_PROVIDER_NAMES,
} from "../../../src/contracts/index.js";
import type {
  AnthropicListSettings,
  ApiProviderName,
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
const sameNames: Same<ModelProviderName, "scripted" | "anthropic"> = true;
const sameApiNames: Same<ApiProviderName, "anthropic"> = true;
const sameSettings: Same<ResolvedAnthropicSettings, ResolvedApiSettings> = true;
const sameFactory: Same<CreateAnthropicProvider, CreateApiProvider> = true;
const sameList: Same<ListAnthropicModels, ListModels> = true;
const sameListSettings: Same<AnthropicListSettings, ListModelsSettings> = true;
const apiModel: ModelConfig = { provider: "anthropic", model: "m", maxOutputTokens: 1024 };
const withStatus: ModelOutcome = { ok: false, kind: "api_error", message: "HTTP 404", httpStatus: 404 };
const withoutStatus: ModelOutcome = { ok: false, kind: "timeout", message: "late" };
void [sameNames, sameApiNames, sameSettings, sameFactory, sameList, sameListSettings, apiModel, withStatus, withoutStatus];

describe("SP-1: the provider table", () => {
  test("the anthropic entry holds the values the CLI used before", () => {
    assert.deepEqual(API_PROVIDERS.anthropic, {
      keyEnv: ANTHROPIC_API_KEY_ENV,
      keyPatternSources: [ANTHROPIC_KEY_PATTERN_SOURCE],
      defaultApiBaseUrl: DEFAULT_ANTHROPIC_API_BASE_URL,
      baseUrlPath: "without_version",
      maxOutputTokensLimit: MAX_OUTPUT_TOKENS_LIMIT,
    });
    assert.equal(ANTHROPIC_API_KEY_ENV, "ANTHROPIC_API_KEY");
    assert.equal(DEFAULT_ANTHROPIC_API_BASE_URL, "https://api.anthropic.com");
    assert.equal(MAX_OUTPUT_TOKENS_LIMIT, 200_000);
  });

  test("the name lists and the derived lists come from the table", () => {
    assert.deepEqual([...API_PROVIDER_NAMES], Object.keys(API_PROVIDERS));
    assert.deepEqual([...MODEL_PROVIDER_NAMES], ["scripted", "anthropic"]);
    assert.deepEqual([...API_KEY_ENVS], ["ANTHROPIC_API_KEY"]);
    assert.deepEqual([...API_KEY_PATTERN_SOURCES], [ANTHROPIC_KEY_PATTERN_SOURCE]);
    assert.equal(new Set(MODEL_PROVIDER_NAMES).size, MODEL_PROVIDER_NAMES.length);
  });
});
