/**
 * The one place where `codaryn run` gets the anthropic provider implementation.
 *
 * Until `src/model/anthropic/index.ts` (E2) is merged this is `null`, and a run with resolved
 * settings stops as `provider_not_implemented` before anything is sent. To connect it when the
 * PM says so, replace the declaration below with:
 *
 *   import { createAnthropicProvider } from "../model/anthropic/index.js";
 *   export const anthropicProviderFactory: CreateAnthropicProvider | null = createAnthropicProvider;
 */

import type { CreateAnthropicProvider } from "../contracts/index.js";

export const anthropicProviderFactory: CreateAnthropicProvider | null = null;
