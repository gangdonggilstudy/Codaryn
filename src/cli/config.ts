/**
 * Config file validation. The file is read only when `--config` or CODARYN_CONFIG names it.
 * Error messages name fields only, never values from the file.
 * The base URL (S-9), timer values (S-7) and variable names (S-3) follow `./security`.
 */

import path from "node:path";
import { CONFIG_SCHEMA_VERSION, MAX_INTEGRITY_PATHS, MAX_RETRIES_LIMIT } from "../contracts/index.js";
import type { CodarynConfig, IntegrityConfig } from "../contracts/index.js";
import { checkLocalPathSyntax, checkTimerMs, normalizeApiBaseUrlStrict } from "./security/index.js";
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

/**
 * A fully qualified absolute path. On Windows a drive letter, a colon and a separator (`C:/x`);
 * a root-relative or drive-relative path does not qualify. Elsewhere a leading `/`.
 */
export function isFullyAbsolute(value: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "win32") return value.startsWith("/");
  const third = value.charAt(2);
  return /^[A-Za-z]:/.test(value) && (third === "/" || third === path.win32.sep);
}

/**
 * U-1: `integrity.paths`, absolute local paths outside the workspace. Only the format is checked
 * here; existence and the position relative to the workspace are checked before the run starts.
 * Messages name the position, never the path.
 */
export function parseIntegrity(value: unknown, platform: NodeJS.Platform = process.platform): IntegrityConfig {
  const rec = record(value, "integrity", ["paths"]);
  const list: unknown = rec["paths"];
  if (!Array.isArray(list)) return fail("integrity.paths must be an array of absolute paths");
  if (list.length > MAX_INTEGRITY_PATHS) fail(`integrity.paths may have at most ${MAX_INTEGRITY_PATHS} entries`);
  const paths: string[] = [];
  list.forEach((entry: unknown, index) => {
    const at = `integrity.paths[${index}]`;
    if (typeof entry !== "string" || entry.trim().length === 0) return fail(`${at} must be a non-empty string`);
    const syntax = checkLocalPathSyntax(entry, platform);
    if (!syntax.ok) fail(`${at} ${syntax.reason === "invalid" ? "is not a valid local path" : "is a network or device path"}`);
    if (!isFullyAbsolute(entry, platform)) fail(`${at} must be an absolute path`);
    paths.push(entry);
  });
  return { paths };
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
      "integrity",
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
    const integrity = rec["integrity"] === undefined ? undefined : parseIntegrity(rec["integrity"]);
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
      ...(integrity === undefined ? {} : { integrity }),
    };
    return { ok: true, config };
  } catch (error) {
    if (error instanceof InputError) return { ok: false, message: error.message };
    throw error;
  }
}
