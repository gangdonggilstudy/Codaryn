/**
 * Placeholder for the Anthropic provider. Phase 1a never sends a request.
 * It only reports whether the required settings are present. Values are never read out.
 */

import { ANTHROPIC_API_KEY_ENV, CODARYN_MODEL_ENV } from "../contracts/index.js";
import type { ModelOutcome, ModelProvider } from "../contracts/index.js";

export type ProviderEnvironment = Readonly<Record<string, string | undefined>>;

export type AnthropicAvailability = "not_configured" | "not_implemented";

function isSet(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

/** `not_configured` when the key or the model setting is missing, otherwise `not_implemented`. */
export function anthropicAvailability(env: ProviderEnvironment): AnthropicAvailability {
  return isSet(env[ANTHROPIC_API_KEY_ENV]) && isSet(env[CODARYN_MODEL_ENV])
    ? "not_implemented"
    : "not_configured";
}

export function createAnthropicProvider(env: ProviderEnvironment): ModelProvider {
  return {
    name: "anthropic",
    async complete(): Promise<ModelOutcome> {
      const kind = anthropicAvailability(env);
      const message =
        kind === "not_configured"
          ? `${ANTHROPIC_API_KEY_ENV} and ${CODARYN_MODEL_ENV} must both be set; nothing was sent`
          : "the anthropic provider is not implemented in phase 1a; nothing was sent";
      return { ok: false, kind, message };
    },
  };
}
