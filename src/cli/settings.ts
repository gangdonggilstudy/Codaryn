/**
 * Resolves the anthropic provider settings from the task, the environment and the config file.
 * Nothing is sent from here. Messages name settings, never their values.
 */

import {
  ANTHROPIC_API_KEY_ENV,
  CODARYN_API_BASE_URL_ENV,
  CODARYN_MODEL_ENV,
  DEFAULT_ANTHROPIC_API_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "../contracts/index.js";
import type { CliErrorCode, CodarynConfig, ModelConfig, ResolvedAnthropicSettings } from "../contracts/index.js";
import { API_BASE_URL_RULE, normalizeApiBaseUrl } from "./config.js";

export type SettingsEnvironment = Readonly<Record<string, string | undefined>>;

export type AnthropicModelConfig = Extract<ModelConfig, { readonly provider: "anthropic" }>;

export type ResolveSettingsOutcome =
  | { readonly ok: true; readonly settings: ResolvedAnthropicSettings }
  | { readonly ok: false; readonly code: CliErrorCode; readonly message: string };

/** The trimmed value, or `null` when unset or blank. */
export function envValue(env: SettingsEnvironment, name: string): string | null {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

/**
 * Precedence (C-4 to C-6):
 * - key: ANTHROPIC_API_KEY only
 * - model: task `model.model` → CODARYN_MODEL → config `model`
 * - maxOutputTokens: task `model.maxOutputTokens` → config `maxOutputTokens`
 * - apiBaseUrl: CODARYN_API_BASE_URL → config `apiBaseUrl` → the official address
 * - requestTimeoutMs, maxRetries: config → defaults
 * A missing key, model or output cap is `provider_not_configured`.
 */
export function resolveAnthropicSettings(
  model: AnthropicModelConfig,
  env: SettingsEnvironment,
  config: CodarynConfig | null,
): ResolveSettingsOutcome {
  const apiKey = envValue(env, ANTHROPIC_API_KEY_ENV);
  const modelId = model.model ?? envValue(env, CODARYN_MODEL_ENV) ?? config?.model ?? null;
  const maxOutputTokens = model.maxOutputTokens ?? config?.maxOutputTokens ?? null;

  const missing: string[] = [];
  if (apiKey === null) missing.push(ANTHROPIC_API_KEY_ENV);
  if (modelId === null) missing.push(`the model (task model.model, ${CODARYN_MODEL_ENV} or config model)`);
  if (maxOutputTokens === null) missing.push("maxOutputTokens (task model.maxOutputTokens or config maxOutputTokens)");
  if (apiKey === null || modelId === null || maxOutputTokens === null) {
    return { ok: false, code: "provider_not_configured", message: `not set: ${missing.join("; ")}. Nothing was sent` };
  }

  const fromEnv = envValue(env, CODARYN_API_BASE_URL_ENV);
  let apiBaseUrl: string;
  if (fromEnv !== null) {
    const normalized = normalizeApiBaseUrl(fromEnv);
    if (normalized === null) {
      return { ok: false, code: "invalid_config", message: `${CODARYN_API_BASE_URL_ENV} ${API_BASE_URL_RULE}` };
    }
    apiBaseUrl = normalized;
  } else {
    apiBaseUrl = config?.apiBaseUrl ?? DEFAULT_ANTHROPIC_API_BASE_URL;
  }

  return {
    ok: true,
    settings: {
      apiKey,
      model: modelId,
      maxOutputTokens,
      apiBaseUrl,
      requestTimeoutMs: config?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      maxRetries: config?.maxRetries ?? DEFAULT_MAX_RETRIES,
    },
  };
}
