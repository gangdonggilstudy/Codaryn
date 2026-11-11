/**
 * The one place where `codaryn run` gets the anthropic provider implementation (E2).
 * `run.ts` calls it only after the key, the model, the output cap and the limits are resolved,
 * so a missing setting is still rejected before anything is sent.
 */

import type { CreateAnthropicProvider } from "../contracts/index.js";
import { createAnthropicProvider } from "../model/anthropic/index.js";

export const anthropicProviderFactory: CreateAnthropicProvider = createAnthropicProvider;
