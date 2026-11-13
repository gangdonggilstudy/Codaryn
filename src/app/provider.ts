/**
 * The one place where the CLI gets the API provider implementations (E2, Y-1, SP-6).
 * - The factories: `run.ts` calls one only after the key, the model, the output cap, the address
 *   and the limits of that provider are resolved, so a missing setting is still rejected before
 *   anything is sent.
 * - The listers: `codaryn models` calls one only after that provider's key and address are
 *   resolved with the same rules as `run` (`resolveListSettings`).
 */

import type { ApiProviderName, CreateAnthropicProvider, CreateApiProvider, ListAnthropicModels, ListModels } from "../contracts/index.js";
import { createAnthropicProvider, listAnthropicModels } from "../model/anthropic/index.js";
import { createOpenAIProvider, listOpenAIModels } from "../model/openai/index.js";

export const anthropicProviderFactory: CreateAnthropicProvider = createAnthropicProvider;

export const anthropicModelLister: ListAnthropicModels = listAnthropicModels;

/** SP-6: each API provider's factory (the OpenAI Responses API adapter for openai). */
export const API_PROVIDER_FACTORIES: { readonly [P in ApiProviderName]: CreateApiProvider } = {
  anthropic: anthropicProviderFactory,
  openai: createOpenAIProvider,
};

/** SP-6: each API provider's model lister. */
export const API_MODEL_LISTERS: { readonly [P in ApiProviderName]: ListModels } = {
  anthropic: anthropicModelLister,
  openai: listOpenAIModels,
};
