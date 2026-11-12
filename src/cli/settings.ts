/**
 * Resolves an API provider's settings from the task, the environment and the config file (SP-4:
 * the chosen provider's entry, key variable and address rule, API_PROVIDERS). Nothing is sent from
 * here. Messages name settings, never their values.
 */

import {
  API_KEY_ENVS,
  API_PROVIDERS,
  CODARYN_API_BASE_URL_ENV,
  CODARYN_MODEL_ENV,
  DEFAULT_MAX_RETRIES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MODEL_PLACEHOLDER_PATTERN_SOURCE,
} from "../contracts/index.js";
import type {
  ApiModelConfig,
  ApiProviderName,
  CliErrorCode,
  CodarynConfig,
  ListModelsSettings,
  ModelConfig,
  ProviderSettings,
  ResolvedApiSettings,
} from "../contracts/index.js";
import { normalizeApiBaseUrlStrict } from "./security/index.js";

export type SettingsEnvironment = Readonly<Record<string, string | undefined>>;

export type AnthropicModelConfig = Extract<ModelConfig, { readonly provider: "anthropic" }>;

export type ResolveSettingsOutcome =
  | { readonly ok: true; readonly settings: ResolvedApiSettings }
  | { readonly ok: false; readonly code: CliErrorCode; readonly message: string };

/**
 * SP-2 (design 4.2): the values of every key variable Codaryn knows (API_KEY_ENVS) that are set, as
 * envValue reads them. They are secrets in every run and hidden in every output, whatever provider
 * runs.
 */
export function knownKeyValues(env: SettingsEnvironment): string[] {
  return API_KEY_ENVS.map((name) => envValue(env, name)).filter((value): value is string => value !== null);
}

/** The trimmed value, or `null` when unset or blank. */
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
 * SP-D3: the chosen provider's settings in the config file: its `providers.<name>` entry; for
 * anthropic the top-level fields when `providers.anthropic` is absent (the parser refuses both).
 * Another provider's entry is never read.
 */
export function providerSettingsOf(config: CodarynConfig | null, provider: ApiProviderName): ProviderSettings {
  if (config === null) return {};
  const listed = config.providers?.[provider];
  if (listed !== undefined) return listed;
  if (provider !== "anthropic") return {};
  return {
    ...(config.model === undefined ? {} : { model: config.model }),
    ...(config.maxOutputTokens === undefined ? {} : { maxOutputTokens: config.maxOutputTokens }),
    ...(config.apiBaseUrl === undefined ? {} : { apiBaseUrl: config.apiBaseUrl }),
    ...(config.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: config.requestTimeoutMs }),
    ...(config.maxRetries === undefined ? {} : { maxRetries: config.maxRetries }),
  };
}

/** For messages: where the provider's setting is written (`model`, `providers.openai.model`). */
export function configFieldOf(config: CodarynConfig | null, provider: ApiProviderName, field: keyof ProviderSettings): string {
  return provider === "anthropic" && config?.providers?.anthropic === undefined ? field : `providers.${provider}.${field}`;
}

/**
 * N-3: the model a run uses: task `model.model` → CODARYN_MODEL → the chosen provider's config
 * `model` (SP-D5: the variable applies to the chosen provider only), each skipped when it is
 * absent or a placeholder. Null when none is left. The default provider is anthropic.
 */
export function resolveModelId(
  taskModel: string | undefined,
  env: SettingsEnvironment,
  config: CodarynConfig | null,
  provider: ApiProviderName = "anthropic",
): string | null {
  return realModel(taskModel) ?? realModel(envValue(env, CODARYN_MODEL_ENV)) ?? realModel(providerSettingsOf(config, provider).model);
}

/** N-3: whether some level holds a placeholder (for the message when no model is left). */
export function modelPlaceholderSeen(
  taskModel: string | undefined,
  env: SettingsEnvironment,
  config: CodarynConfig | null,
  provider: ApiProviderName = "anthropic",
): boolean {
  const fromEnv = env[CODARYN_MODEL_ENV];
  return [taskModel, fromEnv === undefined || fromEnv.trim().length === 0 ? undefined : fromEnv, providerSettingsOf(config, provider).model].some(
    (value) => value !== undefined && isModelPlaceholder(value),
  );
}

/**
 * Message part for a missing model; mentions a placeholder when one was found (N-3). `configField`
 * is where the config holds it (configFieldOf; `model` for anthropic's top-level field).
 */
export function missingModelText(placeholder: boolean, configField = "model"): string {
  const base = `the model (task model.model, ${CODARYN_MODEL_ENV} or config ${configField})`;
  return placeholder ? `${base}: only a placeholder such as <model id> was found` : base;
}

/** Message part for a missing output cap. */
export function missingOutputCapText(configField = "maxOutputTokens"): string {
  return `maxOutputTokens (task model.maxOutputTokens or config ${configField})`;
}

/**
 * Precedence (C-4 to C-6, SP-4), all for the task's provider (`model.provider`):
 * - key: the provider's own variable (API_PROVIDERS keyEnv) only
 * - model: task `model.model` → CODARYN_MODEL → the provider's config `model`
 * - maxOutputTokens: task `model.maxOutputTokens` → the provider's config `maxOutputTokens`
 * - apiBaseUrl: CODARYN_API_BASE_URL → the provider's config `apiBaseUrl` → its default address
 * - requestTimeoutMs, maxRetries: the provider's config → defaults
 * The provider's config is `providers.<name>`, for anthropic also the top-level fields
 * (providerSettingsOf). A missing key, model or output cap is `provider_not_configured`.
 */
export function resolveApiSettings(model: ApiModelConfig, env: SettingsEnvironment, config: CodarynConfig | null): ResolveSettingsOutcome {
  const provider = model.provider;
  const { keyEnv } = API_PROVIDERS[provider];
  const apiKey = envValue(env, keyEnv);
  const modelId = resolveModelId(model.model, env, config, provider);
  const maxOutputTokens = model.maxOutputTokens ?? providerSettingsOf(config, provider).maxOutputTokens ?? null;

  const missing: string[] = [];
  if (apiKey === null) missing.push(keyEnv);
  if (modelId === null) {
    missing.push(missingModelText(modelPlaceholderSeen(model.model, env, config, provider), configFieldOf(config, provider, "model")));
  }
  if (maxOutputTokens === null) missing.push(missingOutputCapText(configFieldOf(config, provider, "maxOutputTokens")));
  if (apiKey === null || modelId === null || maxOutputTokens === null) {
    return { ok: false, code: "provider_not_configured", message: `not set: ${missing.join("; ")}. Nothing was sent` };
  }

  const connection = resolveConnection(apiKey, env, config, provider);
  if (!connection.ok) return connection;
  return { ok: true, settings: { ...connection.settings, model: modelId, maxOutputTokens } };
}

/** The anthropic settings: resolveApiSettings under its first name. */
export function resolveAnthropicSettings(
  model: AnthropicModelConfig,
  env: SettingsEnvironment,
  config: CodarynConfig | null,
): ResolveSettingsOutcome {
  return resolveApiSettings(model, env, config);
}

export type ResolveConnectionOutcome =
  | { readonly ok: true; readonly settings: ListModelsSettings }
  | { readonly ok: false; readonly code: CliErrorCode; readonly message: string };

/**
 * The key, API address, request time limit and retries: the part of the settings `run` and
 * `codaryn models` (Y-2) share, for `provider` (default anthropic). apiBaseUrl:
 * CODARYN_API_BASE_URL (S-9 strict rule with the provider's path rule; SP-D5: it applies to the
 * chosen provider only) → the provider's config `apiBaseUrl` → its default address.
 * requestTimeoutMs, maxRetries: the provider's config → defaults.
 */
export function resolveConnection(
  apiKey: string,
  env: SettingsEnvironment,
  config: CodarynConfig | null,
  provider: ApiProviderName = "anthropic",
): ResolveConnectionOutcome {
  const spec = API_PROVIDERS[provider];
  const own = providerSettingsOf(config, provider);
  const fromEnv = envValue(env, CODARYN_API_BASE_URL_ENV);
  let apiBaseUrl: string;
  if (fromEnv !== null) {
    // S-9: the same strict rule as the config file's address for this provider.
    const normalized = normalizeApiBaseUrlStrict(fromEnv, CODARYN_API_BASE_URL_ENV, spec.baseUrlPath);
    if (!normalized.ok) return { ok: false, code: "invalid_config", message: normalized.message };
    apiBaseUrl = normalized.url;
  } else {
    apiBaseUrl = own.apiBaseUrl ?? spec.defaultApiBaseUrl;
  }
  return {
    ok: true,
    settings: {
      apiKey,
      apiBaseUrl,
      requestTimeoutMs: own.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      maxRetries: own.maxRetries ?? DEFAULT_MAX_RETRIES,
    },
  };
}

/** Y-2: the key and connection for listing `provider`'s models (default anthropic). No model or output cap is needed. */
export function resolveListSettings(
  env: SettingsEnvironment,
  config: CodarynConfig | null,
  provider: ApiProviderName = "anthropic",
): ResolveConnectionOutcome {
  const { keyEnv } = API_PROVIDERS[provider];
  const apiKey = envValue(env, keyEnv);
  if (apiKey === null) {
    return { ok: false, code: "provider_not_configured", message: `not set: ${keyEnv}. Nothing was sent` };
  }
  return resolveConnection(apiKey, env, config, provider);
}
