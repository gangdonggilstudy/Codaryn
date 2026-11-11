/**
 * Config file validation. The file is read only when `--config` or CODARYN_CONFIG names it.
 * Error messages name fields only, never values from the file.
 * The base URL (S-9), timer values (S-7) and variable names (S-3) follow `./security`.
 */

import { CONFIG_SCHEMA_VERSION, MAX_RETRIES_LIMIT } from "../contracts/index.js";
import type { CodarynConfig } from "../contracts/index.js";
import { checkTimerMs, normalizeApiBaseUrlStrict } from "./security/index.js";
import {
  InputError,
  fail,
  optionalOutputTokens,
  optionalText,
  parsePartialLimits,
  parsePolicy,
  parseSecretEnv,
  parseVerifiers,
  record,
} from "./task.js";

export type ParseConfigOutcome =
  | { readonly ok: true; readonly config: CodarynConfig }
  | { readonly ok: false; readonly message: string };

/** S-9: the strict form, without a trailing slash. */
function parseApiBaseUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeApiBaseUrlStrict(value, "apiBaseUrl");
  return normalized.ok ? normalized.url : fail(normalized.message);
}

/** S-7: a request time limit Node timers can honour. */
function parseRequestTimeout(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const checked = checkTimerMs(value, "requestTimeoutMs");
  return checked.ok ? (value as number) : fail(checked.message);
}

function parseMaxRetries(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_RETRIES_LIMIT) {
    fail(`maxRetries must be an integer from 0 to ${MAX_RETRIES_LIMIT}`);
  }
  return value;
}

/** Validates a parsed config file. Unknown fields are rejected. */
export function parseConfig(value: unknown): ParseConfigOutcome {
  try {
    const rec = record(value, "config", [
      "schemaVersion",
      "model",
      "maxOutputTokens",
      "apiBaseUrl",
      "requestTimeoutMs",
      "maxRetries",
      "limits",
      "policy",
      "verifiers",
      "secretEnv",
    ]);
    if (rec["schemaVersion"] !== CONFIG_SCHEMA_VERSION) fail("config schemaVersion must be 1");
    const model = optionalText(rec["model"], "model");
    const maxOutputTokens = optionalOutputTokens(rec["maxOutputTokens"], "maxOutputTokens");
    const apiBaseUrl = parseApiBaseUrl(rec["apiBaseUrl"]);
    const requestTimeoutMs = parseRequestTimeout(rec["requestTimeoutMs"]);
    const maxRetries = parseMaxRetries(rec["maxRetries"]);
    const limits = rec["limits"] === undefined ? undefined : parsePartialLimits(rec["limits"]);
    const policy = rec["policy"] === undefined ? undefined : parsePolicy(rec["policy"]);
    const verifiers = rec["verifiers"] === undefined ? undefined : parseVerifiers(rec["verifiers"]);
    const secretEnv = rec["secretEnv"] === undefined ? undefined : parseSecretEnv(rec["secretEnv"], "secretEnv");
    const config: CodarynConfig = {
      schemaVersion: 1,
      ...(model === undefined ? {} : { model }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      ...(apiBaseUrl === undefined ? {} : { apiBaseUrl }),
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
      ...(maxRetries === undefined ? {} : { maxRetries }),
      ...(limits === undefined ? {} : { limits }),
      ...(policy === undefined ? {} : { policy }),
      ...(verifiers === undefined ? {} : { verifiers }),
      ...(secretEnv === undefined ? {} : { secretEnv }),
    };
    return { ok: true, config };
  } catch (error) {
    if (error instanceof InputError) return { ok: false, message: error.message };
    throw error;
  }
}
