/**
 * Config file validation. The file is read only when `--config` or CODARYN_CONFIG names it.
 * Error messages name fields only, never values from the file.
 */

import { CONFIG_SCHEMA_VERSION, MAX_RETRIES_LIMIT } from "../contracts/index.js";
import type { CodarynConfig } from "../contracts/index.js";
import {
  InputError,
  fail,
  optionalPositive,
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

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Returns the base URL without a trailing slash, or `null` when it is not allowed:
 * it must be `https:`, or `http:` on a loopback host, with no user info, query or fragment.
 */
export function normalizeApiBaseUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const secure = url.protocol === "https:";
  const loopback = url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname);
  if (!secure && !loopback) return null;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return null;
  return url.href.replace(/\/+$/, "");
}

export const API_BASE_URL_RULE = "must be an https URL (http only on a loopback host) without user info, query or fragment";

function parseApiBaseUrl(value: unknown): string | undefined {
  const raw = optionalText(value, "apiBaseUrl");
  if (raw === undefined) return undefined;
  return normalizeApiBaseUrl(raw) ?? fail(`apiBaseUrl ${API_BASE_URL_RULE}`);
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
    const maxOutputTokens = optionalPositive(rec["maxOutputTokens"], "maxOutputTokens");
    const apiBaseUrl = parseApiBaseUrl(rec["apiBaseUrl"]);
    const requestTimeoutMs = optionalPositive(rec["requestTimeoutMs"], "requestTimeoutMs");
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
