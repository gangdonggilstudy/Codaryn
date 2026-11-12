/**
 * Config file validation. The file is the one `--config`, CODARYN_CONFIG or the default location
 * names (N-1, `./config-file.ts`).
 * Error messages name fields only, never values from the file.
 * The base URL (S-9), timer values (S-7) and variable names (S-3) follow `./security`.
 */

import path from "node:path";
import {
  CONFIG_SCHEMA_VERSION,
  MAX_INTEGRITY_PATHS,
  MAX_PROFILES,
  MAX_RETRIES_LIMIT,
  MESSAGE_LANGUAGES,
  PROFILE_NAME_PATTERN_SOURCE,
} from "../contracts/index.js";
import type { CodarynConfig, ConfigProfile, IntegrityConfig, Limits, MessageLanguage } from "../contracts/index.js";
import { checkLocalPathSyntax, checkTimerMs, normalizeApiBaseUrlStrict } from "./security/index.js";
import {
  InputError,
  fail,
  optionalOutputTokens,
  parsePartialLimits,
  parsePolicy,
  parseSecretEnv,
  parseVerifiers,
  record,
} from "./task.js";
import type { InputErrorPosition, Rec } from "./task.js";

export type ParseConfigOutcome =
  | { readonly ok: true; readonly config: CodarynConfig }
  | { readonly ok: false; readonly message: string; readonly position?: InputErrorPosition };

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

/** N-4: "ko" or "en". */
function parseLanguage(value: unknown): MessageLanguage | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(MESSAGE_LANGUAGES as readonly string[]).includes(value)) {
    fail(`language must be one of ${MESSAGE_LANGUAGES.join(", ")}`);
  }
  return value as MessageLanguage;
}

/** N-3: a model id, or a placeholder (blank or `<...>`) that counts as not set later. */
function parseModelText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail("model must be a string");
  return value;
}

const LIMIT_NAMES = [
  "maxModelTurns",
  "maxToolCalls",
  "maxTotalTokens",
  "maxDurationMs",
  "maxRepairAttempts",
  "maxSameFailures",
] as const satisfies readonly (keyof Limits)[];

/**
 * N-8 with S-7: a profile limit may not exceed the top-level value of the same field, nor be null
 * where the top level has a number. Messages name fields only, never the numbers.
 */
function checkProfileLimits(profileAt: string, own: Partial<Limits>, top: Partial<Limits> | undefined): void {
  for (const field of LIMIT_NAMES) {
    const value = own[field];
    const bound = top?.[field];
    if (value === undefined || bound === undefined || bound === null) continue;
    const at = `${profileAt}.limits.${field}`;
    if (value === null) fail(`${at} cannot be null when limits.${field} of the config file is a number`);
    if (value > bound) fail(`${at} must not exceed limits.${field} of the config file`);
  }
}

const PROFILE_NAME = new RegExp(PROFILE_NAME_PATTERN_SOURCE);

/** Runs a field parser and puts the profile's position in front of its message. */
function prefixed<T>(at: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof InputError) return fail(`${at}.${error.message}`, error.code);
    throw error;
  }
}

/** N-8: `profiles`, name → policy, verifiers, limits. Validated like the top-level fields. */
function parseProfiles(value: unknown, topLimits: Partial<Limits> | undefined): { [name: string]: ConfigProfile } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("profiles must be an object");
  const names = Object.keys(value as Rec);
  if (names.length > MAX_PROFILES) fail(`profiles may have at most ${MAX_PROFILES} entries`);
  const profiles: { [name: string]: ConfigProfile } = Object.create(null) as { [name: string]: ConfigProfile };
  names.forEach((name, index) => {
    // N-14: a profile is named by its position, never by its name.
    const at = `profiles[${index}]`;
    if (!PROFILE_NAME.test(name)) fail(`${at} has a name that is not a valid profile name`);
    const rec = record((value as Rec)[name], at, ["policy", "verifiers", "limits"]);
    const policy = rec["policy"] === undefined ? undefined : prefixed(at, () => parsePolicy(rec["policy"]));
    const verifiers = rec["verifiers"] === undefined ? undefined : prefixed(at, () => parseVerifiers(rec["verifiers"]));
    const limits = rec["limits"] === undefined ? undefined : prefixed(at, () => parsePartialLimits(rec["limits"]));
    if (limits !== undefined) checkProfileLimits(at, limits, topLimits);
    profiles[name] = {
      ...(policy === undefined ? {} : { policy }),
      ...(verifiers === undefined ? {} : { verifiers }),
      ...(limits === undefined ? {} : { limits }),
    };
  });
  return profiles;
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
      "language",
      "profiles",
    ]);
    if (rec["schemaVersion"] !== CONFIG_SCHEMA_VERSION) fail("config schemaVersion must be 1");
    const model = parseModelText(rec["model"]);
    const maxOutputTokens = optionalOutputTokens(rec["maxOutputTokens"], "maxOutputTokens");
    const apiBaseUrl = parseApiBaseUrl(rec["apiBaseUrl"]);
    const requestTimeoutMs = parseRequestTimeout(rec["requestTimeoutMs"]);
    const maxRetries = parseMaxRetries(rec["maxRetries"]);
    const limits = rec["limits"] === undefined ? undefined : parsePartialLimits(rec["limits"]);
    const policy = rec["policy"] === undefined ? undefined : parsePolicy(rec["policy"]);
    const verifiers = rec["verifiers"] === undefined ? undefined : parseVerifiers(rec["verifiers"]);
    const secretEnv = rec["secretEnv"] === undefined ? undefined : parseSecretEnv(rec["secretEnv"], "secretEnv");
    const integrity = rec["integrity"] === undefined ? undefined : parseIntegrity(rec["integrity"]);
    const language = parseLanguage(rec["language"]);
    const profiles = rec["profiles"] === undefined ? undefined : parseProfiles(rec["profiles"], limits);
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
      ...(language === undefined ? {} : { language }),
      ...(profiles === undefined ? {} : { profiles }),
    };
    return { ok: true, config };
  } catch (error) {
    if (error instanceof InputError) {
      return { ok: false, message: error.message, ...(error.position === undefined ? {} : { position: error.position }) };
    }
    throw error;
  }
}
