/**
 * Resolves an API provider's settings from the task, the environment and the config file (SP-4:
 * the chosen provider's entry, key variable and address rule, API_PROVIDERS). Nothing is sent from
 * here. Messages name settings, never their values.
 */

import {
  API_KEY_ENVS,
  API_PROVIDERS,
  CODARYN_MODEL_ENV,
  DEFAULT_MAX_RETRIES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MIN_OTHER_PROVIDER_KEY_LENGTH,
  MODEL_PLACEHOLDER_PATTERN_SOURCE,
} from "../contracts/index.js";
import type {
  ApiModelConfig,
  ApiProviderName,
  CliErrorCode,
  CodarynConfig,
  ListModelsSettings,
  ModelConfig,
  ModelProviderName,
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

/**
 * S-2, SP-2, DR-34 (b): the key values a run registers as secrets. The run's own provider's key as
 * it is set (any length, as before); every other known key (API_KEY_ENVS) only from
 * MIN_OTHER_PROVIDER_KEY_LENGTH characters (the contract's, DR-34 (b)), so a placeholder such as
 * EMPTY, ollama or x cannot break an unrelated run. A scripted run uses no key, so every key is
 * another's.
 */
export function runKeySecrets(env: SettingsEnvironment, provider: ModelProviderName): string[] {
  const own = provider === "scripted" ? null : API_PROVIDERS[provider].keyEnv;
  return API_KEY_ENVS.flatMap((name) => {
    const value = envValue(env, name);
    return value !== null && (name === own || value.length >= MIN_OTHER_PROVIDER_KEY_LENGTH) ? [value] : [];
  });
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
 * N-3: the model a run uses: task `model.model` → the provider's model variable (DR-34 (a):
 * CODARYN_MODEL for anthropic, CODARYN_OPENAI_MODEL for openai) → the provider's config `model`,
 * each skipped when it is absent or a placeholder. Null when none is left. The default provider is
 * anthropic.
 */
export function resolveModelId(
  taskModel: string | undefined,
  env: SettingsEnvironment,
  config: CodarynConfig | null,
  provider: ApiProviderName = "anthropic",
): string | null {
  return realModel(taskModel) ?? realModel(envValue(env, API_PROVIDERS[provider].modelEnv)) ?? realModel(providerSettingsOf(config, provider).model);
}

/** N-3: whether some level holds a placeholder (for the message when no model is left). */
export function modelPlaceholderSeen(
  taskModel: string | undefined,
  env: SettingsEnvironment,
  config: CodarynConfig | null,
  provider: ApiProviderName = "anthropic",
): boolean {
  const fromEnv = env[API_PROVIDERS[provider].modelEnv];
  return [taskModel, fromEnv === undefined || fromEnv.trim().length === 0 ? undefined : fromEnv, providerSettingsOf(config, provider).model].some(
    (value) => value !== undefined && isModelPlaceholder(value),
  );
}

/**
 * Message part for a missing model; mentions a placeholder when one was found (N-3). `configField`
 * is where the config holds it (configFieldOf; `model` for anthropic's top-level field), `modelEnv`
 * the provider's model variable (API_PROVIDERS modelEnv).
 */
export function missingModelText(placeholder: boolean, configField = "model", modelEnv: string = CODARYN_MODEL_ENV): string {
  const base = `the model (task model.model, ${modelEnv} or config ${configField})`;
  return placeholder ? `${base}: only a placeholder such as <model id> was found` : base;
}

/** Message part for a missing output cap. */
export function missingOutputCapText(configField = "maxOutputTokens"): string {
  return `maxOutputTokens (task model.maxOutputTokens or config ${configField})`;
}

/**
 * Precedence (C-4 to C-6, SP-4, DR-34 (a)), all for the task's provider (`model.provider`):
 * - key: the provider's own variable (API_PROVIDERS keyEnv) only
 * - model: task `model.model` → the provider's model variable → the provider's config `model`
 * - maxOutputTokens: task `model.maxOutputTokens` → the provider's config `maxOutputTokens`
 * - apiBaseUrl: the provider's address variable → the provider's config `apiBaseUrl` → its default
 *   address (API_PROVIDERS baseUrlEnv: CODARYN_API_BASE_URL is anthropic's only)
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
    missing.push(
      missingModelText(modelPlaceholderSeen(model.model, env, config, provider), configFieldOf(config, provider, "model"), API_PROVIDERS[provider].modelEnv),
    );
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
 * `codaryn models` (Y-2) share, for `provider` (default anthropic). apiBaseUrl: the provider's own
 * address variable (DR-34 (a), API_PROVIDERS baseUrlEnv; S-9 strict rule with the provider's path rule)
 * → the provider's config `apiBaseUrl` → its default address.
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
  const variable = API_PROVIDERS[provider].baseUrlEnv;
  const fromEnv = envValue(env, variable);
  let apiBaseUrl: string;
  if (fromEnv !== null) {
    // S-9: the same strict rule as the config file's address for this provider.
    const normalized = normalizeApiBaseUrlStrict(fromEnv, variable, spec.baseUrlPath);
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

/**
 * DR-34 (a): where `provider`'s key is sent, for doctor: the origin of its address and the setting
 * the address came from. Only the origin: a path may hold more than an address. Null when the
 * provider's address variable is set but not valid (a run stops then, nothing is sent).
 */
export function keyDestination(
  env: SettingsEnvironment,
  config: CodarynConfig | null,
  provider: ApiProviderName,
): { readonly origin: string; readonly source: string } | null {
  const spec = API_PROVIDERS[provider];
  const variable = API_PROVIDERS[provider].baseUrlEnv;
  const fromEnv = envValue(env, variable);
  if (fromEnv !== null) {
    const normalized = normalizeApiBaseUrlStrict(fromEnv, variable, spec.baseUrlPath);
    return normalized.ok ? { origin: new URL(normalized.url).origin, source: variable } : null;
  }
  const own = providerSettingsOf(config, provider).apiBaseUrl;
  if (own !== undefined) return { origin: new URL(own).origin, source: `config ${configFieldOf(config, provider, "apiBaseUrl")}` };
  return { origin: new URL(spec.defaultApiBaseUrl).origin, source: "the default address" };
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
