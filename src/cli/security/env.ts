/**
 * Environment variable names and values that become secrets (S-3, S-4).
 * Messages name a position, never a variable name or a value.
 */

import { CODARYN_API_BASE_URL_ENV, CODARYN_CONFIG_ENV, CODARYN_MODEL_ENV } from "../../contracts/index.js";
import type { ApiProviderName } from "../../contracts/index.js";

export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Values shorter than this are not registered: they would mask ordinary text everywhere. */
export const MIN_ENV_SECRET_LENGTH = 8;

/**
 * DR-34 (a) (review R-20 M-1): each API provider's model and address variables, so a key goes only
 * to an address set for its own provider. CODARYN_MODEL and CODARYN_API_BASE_URL stay anthropic's,
 * as before SP-4. The OpenAI names are written here until the contract owner issues them as
 * constants.
 */
export const PROVIDER_SETTING_ENVS = {
  anthropic: { model: CODARYN_MODEL_ENV, apiBaseUrl: CODARYN_API_BASE_URL_ENV },
  openai: { model: "CODARYN_OPENAI_MODEL", apiBaseUrl: "CODARYN_OPENAI_API_BASE_URL" },
} as const satisfies { readonly [P in ApiProviderName]: { readonly model: string; readonly apiBaseUrl: string } };

/** Settings the env file may carry that are not secrets: the config location and every provider's model and address. */
export const ENV_FILE_NON_SECRETS: readonly string[] = [
  CODARYN_MODEL_ENV,
  CODARYN_CONFIG_ENV,
  CODARYN_API_BASE_URL_ENV,
  PROVIDER_SETTING_ENVS.openai.model,
  PROVIDER_SETTING_ENVS.openai.apiBaseUrl,
];

export type SecretEnvNamesOutcome =
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly message: string };

/** S-3: `field` is where the list came from, such as "privacy.secretEnv" or "secretEnv". */
export function validateSecretEnvNames(value: unknown, field: string): SecretEnvNamesOutcome {
  if (!Array.isArray(value)) return { ok: false, message: `${field} must be an array of environment variable names` };
  const names: string[] = [];
  for (const [index, name] of (value as unknown[]).entries()) {
    if (typeof name !== "string" || !ENV_NAME_PATTERN.test(name)) {
      return { ok: false, message: `${field}[${index}] is not a valid environment variable name` };
    }
    names.push(name);
  }
  return { ok: true, names };
}

/** S-3: the message for a listed variable that is unset or empty. */
export function secretEnvNotSetMessage(field: string, index: number): string {
  return `${field}[${index}] names an environment variable that is not set`;
}

export type EnvSnapshot = { readonly [name: string]: string | undefined };

/**
 * S-4: values of variables that the env file set and that were not set before it was loaded.
 * `before` and `after` are copies of the environment taken around `loadEnvFile`. Windows
 * compares names without case. The CODARYN settings and values shorter than
 * MIN_ENV_SECRET_LENGTH are skipped. When trimming changes a value, both forms are returned.
 */
export function selectEnvFileSecrets(
  before: EnvSnapshot,
  after: EnvSnapshot,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const fold = (name: string): string => (platform === "win32" ? name.toUpperCase() : name);
  const existing = new Set(Object.keys(before).filter((name) => before[name] !== undefined).map(fold));
  const skipped = new Set(ENV_FILE_NON_SECRETS.map(fold));
  const secrets: string[] = [];
  const add = (value: string): void => {
    if (value.length >= MIN_ENV_SECRET_LENGTH && !secrets.includes(value)) secrets.push(value);
  };
  for (const [name, value] of Object.entries(after)) {
    if (value === undefined || existing.has(fold(name)) || skipped.has(fold(name))) continue;
    add(value);
    add(value.trim());
  }
  return secrets;
}
