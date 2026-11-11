/**
 * The one place where the CLI gets the anthropic implementations (E2, Y-1).
 * - `anthropicProviderFactory`: `run.ts` calls it only after the key, the model, the output cap and
 *   the limits are resolved, so a missing setting is still rejected before anything is sent.
 * - `anthropicModelLister`: `codaryn models` calls it only after the key and the address are
 *   resolved with the same rules as `run` (`resolveListSettings`).
 */

import type { CreateAnthropicProvider, ListAnthropicModels } from "../contracts/index.js";
import { createAnthropicProvider, listAnthropicModels } from "../model/anthropic/index.js";

export const anthropicProviderFactory: CreateAnthropicProvider = createAnthropicProvider;

export const anthropicModelLister: ListAnthropicModels = listAnthropicModels;
