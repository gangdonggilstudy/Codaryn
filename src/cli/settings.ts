/**
 * Resolves the anthropic provider settings from the task, the environment and the config file.
 * Nothing is sent from here. Messages name settings, never their values.
 */

import {
  ANTHROPIC_API_KEY_ENV,
  API_KEY_ENVS,
  CODARYN_API_BASE_URL_ENV,
  CODARYN_MODEL_ENV,
  DEFAULT_ANTHROPIC_API_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MODEL_PLACEHOLDER_PATTERN_SOURCE,
} from "../contracts/index.js";
import type {
  AnthropicListSettings,
  CliErrorCode,
  CodarynConfig,
  ModelConfig,
  ResolvedAnthropicSettings,
} from "../contracts/index.js";
import { normalizeApiBaseUrlStrict } from "./security/index.js";

export type SettingsEnvironment = Readonly<Record<string, string | undefined>>;

export type AnthropicModelConfig = Extract<ModelConfig, { readonly provider: "anthropic" }>;

export type ResolveSettingsOutcome =
  | { readonly ok: true; readonly settings: ResolvedAnthropicSettings }
  | { readonly ok: false; readonly code: CliErrorCode; readonly message: string };

/** The trimmed value, or `null` when unset or blank. */
/**
 * SP-2 (design 4.2): the values of every key variable Codaryn knows (API_KEY_ENVS) that are set, as
 * envValue reads them. They are secrets in every run and hidden in every output, whatever provider
 * runs.
 */
export function knownKeyValues(env: SettingsEnvironment): string[] {
  return API_KEY_ENVS.map((name) => envValue(env, name)).filter((value): value is string => value !== null);
}

export function envValue(env: SettingsEnvironment, name: string): string | null {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

const MODEL_PLACEHOLDER = new RegExp(MODEL_PLACEHOLDER_PATTERN_SOURCE);

/** N-3: blank, or `<...>` once trimmed: a value that only holds a place. */
export function isModelPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || MODEL_PLACEHOLDER.test(trimmed);
}

/** N-3: the value, or null when it is absent or a placeholder. */
export function realModel(value: string | null | undefined): string | null {
  return value === null || value === undefined || isModelPlaceholder(value) ? null : value;
}

/**
 * N-3: the model a run uses: task `model.model` → CODARYN_MODEL → config `model`, each skipped
 * when it is absent or a placeholder. Null when none is left.
 */
export function resolveModelId(
  taskModel: string | undefined,
  env: SettingsEnvironment,
  config: CodarynConfig | null,
): string | null {
  return realModel(taskModel) ?? realModel(envValue(env, CODARYN_MODEL_ENV)) ?? realModel(config?.model);
}

/** N-3: whether some level holds a placeholder (for the message when no model is left). */
export function modelPlaceholderSeen(taskModel: string | undefined, env: SettingsEnvironment, config: CodarynConfig | null): boolean {
  const fromEnv = env[CODARYN_MODEL_ENV];
  return [taskModel, fromEnv === undefined || fromEnv.trim().length === 0 ? undefined : fromEnv, config?.model].some(
    (value) => value !== undefined && isModelPlaceholder(value),
  );
}

/** Message part for a missing model; mentions a placeholder when one was found (N-3). */
export function missingModelText(placeholder: boolean): string {
  const base = `the model (task model.model, ${CODARYN_MODEL_ENV} or config model)`;
  return placeholder ? `${base}: only a placeholder such as <model id> was found` : base;
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
  const modelId = resolveModelId(model.model, env, config);
  const maxOutputTokens = model.maxOutputTokens ?? config?.maxOutputTokens ?? null;

  const missing: string[] = [];
  if (apiKey === null) missing.push(ANTHROPIC_API_KEY_ENV);
  if (modelId === null) missing.push(missingModelText(modelPlaceholderSeen(model.model, env, config)));
  if (maxOutputTokens === null) missing.push("maxOutputTokens (task model.maxOutputTokens or config maxOutputTokens)");
  if (apiKey === null || modelId === null || maxOutputTokens === null) {
    return { ok: false, code: "provider_not_configured", message: `not set: ${missing.join("; ")}. Nothing was sent` };
  }

  const connection = resolveConnection(apiKey, env, config);
  if (!connection.ok) return connection;
  return { ok: true, settings: { ...connection.settings, model: modelId, maxOutputTokens } };
}

export type ResolveConnectionOutcome =
  | { readonly ok: true; readonly settings: AnthropicListSettings }
  | { readonly ok: false; readonly code: CliErrorCode; readonly message: string };

/**
 * The key, API address, request time limit and retries: the part of the settings `run` and
 * `codaryn models` (Y-2) share. apiBaseUrl: CODARYN_API_BASE_URL (S-9 strict rule) → config
 * `apiBaseUrl` → the official address. requestTimeoutMs, maxRetries: config → defaults.
 */
export function resolveConnection(apiKey: string, env: SettingsEnvironment, config: CodarynConfig | null): ResolveConnectionOutcome {
  const fromEnv = envValue(env, CODARYN_API_BASE_URL_ENV);
  let apiBaseUrl: string;
  if (fromEnv !== null) {
    // S-9: the same strict rule as the config file's apiBaseUrl.
    const normalized = normalizeApiBaseUrlStrict(fromEnv, CODARYN_API_BASE_URL_ENV);
    if (!normalized.ok) return { ok: false, code: "invalid_config", message: normalized.message };
    apiBaseUrl = normalized.url;
  } else {
    apiBaseUrl = config?.apiBaseUrl ?? DEFAULT_ANTHROPIC_API_BASE_URL;
  }
  return {
    ok: true,
    settings: {
      apiKey,
      apiBaseUrl,
      requestTimeoutMs: config?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      maxRetries: config?.maxRetries ?? DEFAULT_MAX_RETRIES,
    },
  };
}

/** Y-2: the key and connection for listing models. No model or output cap is needed. */
export function resolveListSettings(env: SettingsEnvironment, config: CodarynConfig | null): ResolveConnectionOutcome {
  const apiKey = envValue(env, ANTHROPIC_API_KEY_ENV);
  if (apiKey === null) {
    return { ok: false, code: "provider_not_configured", message: `not set: ${ANTHROPIC_API_KEY_ENV}. Nothing was sent` };
  }
  return resolveConnection(apiKey, env, config);
}
