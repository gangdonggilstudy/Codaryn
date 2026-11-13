/**
 * Config file validation. The file is the one `--config`, CODARYN_CONFIG or the default location
 * names (N-1, `./config-file.ts`).
 * Error messages name fields only, never values from the file.
 * The base URL (S-9), timer values (S-7) and variable names (S-3) follow `./security`.
 */

import path from "node:path";
import {
  API_PROVIDERS,
  API_PROVIDER_NAMES,
  CONFIG_SCHEMA_VERSION,
  MAX_INTEGRITY_PATHS,
  MAX_PROFILES,
  MAX_RETRIES_LIMIT,
  MESSAGE_LANGUAGES,
  PROFILE_NAME_PATTERN_SOURCE,
  BUILTIN_WORKFLOW_IDS,
  MAX_WORKFLOWS,
  MAX_WORKFLOW_INSTRUCTIONS_CHARS,
  WORKFLOW_ID_PATTERN_SOURCE,
} from "../contracts/index.js";
import type {
  ApiProviderName,
  CliErrorHint,
  CodarynConfig,
  ConfigProfile,
  IntegrityConfig,
  Limits,
  MessageLanguage,
  ProviderSettings,
  WorkflowDefinition,
} from "../contracts/index.js";
import { checkLocalPathSyntax, checkTimerMs, normalizeApiBaseUrlStrict } from "./security/index.js";
import {
  InputError,
  fail,
  isApiProviderName,
  optionalOutputTokens,
  quotedChoices,
  parsePartialLimits,
  parsePolicy,
  parseSecretEnv,
  parseVerifiers,
  record,
} from "./task.js";
import { parseCompletion, parseHumanReview, parsePlanMode, parseToolList, parseWorkflowRef, text } from "./task.js";
import type { InputErrorPosition, Rec } from "./task.js";

export type ParseConfigOutcome =
  | { readonly ok: true; readonly config: CodarynConfig }
  | {
      readonly ok: false;
      readonly message: string;
      readonly position?: InputErrorPosition;
      /** U-177: the error's hint when the parser knows the cause (a definition's plan "run"). */
      readonly hint?: CliErrorHint;
    };

/** S-9: the strict form, without a trailing slash. */
function parseApiBaseUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeApiBaseUrlStrict(value, "apiBaseUrl");
  return normalized.ok ? normalized.url : fail(normalized.message);
}

/** S-7: a request time limit Node timers can honour. */
function parseRequestTimeout(value: unknown, field = "requestTimeoutMs"): number | undefined {
  if (value === undefined) return undefined;
  const checked = checkTimerMs(value, field);
  return checked.ok ? (value as number) : fail(checked.message);
}

/** SP-D3, SP-D10: an API provider name (API_PROVIDER_NAMES); the scripted model is for task files only. */
function parseProviderName(value: unknown, at: string): ApiProviderName {
  return isApiProviderName(value) ? value : fail(`${at} must be ${quotedChoices(API_PROVIDER_NAMES)}`);
}

/** The top-level fields that are anthropic's provider settings (SP-D3, backward compatible). */
const TOP_LEVEL_PROVIDER_SETTINGS = ["model", "maxOutputTokens", "apiBaseUrl", "requestTimeoutMs", "maxRetries"] as const;

/**
 * SP-D3: `providers`, API provider name → its settings, each checked with that provider's rules
 * (API_PROVIDERS: output token bounds, address path rule). A name that is not an API provider is
 * invalid and is not echoed.
 */
function parseProviders(value: unknown): { [P in ApiProviderName]?: ProviderSettings } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("providers must be an object");
  const providers: { [P in ApiProviderName]?: ProviderSettings } = {};
  for (const name of Object.keys(value as Rec)) {
    if (!isApiProviderName(name)) fail(`providers has an entry that is not an API provider (${API_PROVIDER_NAMES.join(", ")})`);
    const at = `providers.${name}`;
    const rec = record((value as Rec)[name], at, [...TOP_LEVEL_PROVIDER_SETTINGS]);
    const model = prefixed(at, () => parseModelText(rec["model"]));
    const maxOutputTokens = optionalOutputTokens(rec["maxOutputTokens"], `${at}.maxOutputTokens`, name);
    let apiBaseUrl: string | undefined;
    if (rec["apiBaseUrl"] !== undefined) {
      const normalized = normalizeApiBaseUrlStrict(rec["apiBaseUrl"], `${at}.apiBaseUrl`, API_PROVIDERS[name].baseUrlPath);
      apiBaseUrl = normalized.ok ? normalized.url : fail(normalized.message);
    }
    const requestTimeoutMs = parseRequestTimeout(rec["requestTimeoutMs"], `${at}.requestTimeoutMs`);
    const maxRetries = prefixed(at, () => parseMaxRetries(rec["maxRetries"]));
    providers[name] = {
      ...(model === undefined ? {} : { model }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      ...(apiBaseUrl === undefined ? {} : { apiBaseUrl }),
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
      ...(maxRetries === undefined ? {} : { maxRetries }),
    };
  }
  return providers;
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
    // U-177: a hint stays with the error (the position is the prefixed message's, as before).
    if (error instanceof InputError) {
      if (error.hint === undefined) return fail(`${at}.${error.message}`, error.code);
      throw new InputError(`${at}.${error.message}`, error.code, undefined, error.hint);
    }
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
    const rec = record((value as Rec)[name], at, ["provider", "policy", "verifiers", "limits", "workflowRef"]);
    // SP-D10: the quick form's provider with this profile.
    const provider = rec["provider"] === undefined ? undefined : parseProviderName(rec["provider"], `${at}.provider`);
    // U-109: the user's settings, so its command rules may ask before running.
    const policy = rec["policy"] === undefined ? undefined : prefixed(at, () => parsePolicy(rec["policy"], "settings"));
    const verifiers = rec["verifiers"] === undefined ? undefined : prefixed(at, () => parseVerifiers(rec["verifiers"]));
    const limits = rec["limits"] === undefined ? undefined : prefixed(at, () => parsePartialLimits(rec["limits"]));
    // G-A: the definition this profile uses when the task names none.
    const workflowRef = rec["workflowRef"] === undefined ? undefined : parseWorkflowRef(rec["workflowRef"], `${at}.workflowRef`);
    if (limits !== undefined) checkProfileLimits(at, limits, topLimits);
    profiles[name] = {
      ...(provider === undefined ? {} : { provider }),
      ...(policy === undefined ? {} : { policy }),
      ...(verifiers === undefined ? {} : { verifiers }),
      ...(limits === undefined ? {} : { limits }),
      ...(workflowRef === undefined ? {} : { workflowRef }),
    };
  });
  return profiles;
}

const WORKFLOW_ID = new RegExp(WORKFLOW_ID_PATTERN_SOURCE);

/**
 * G-A (GT-D1): the config file's `workflows`, id → definition. Ids follow
 * WORKFLOW_ID_PATTERN_SOURCE, at most MAX_WORKFLOWS, none a built-in id. A definition is named by
 * its position (`workflows[2]`) in messages, never by its id (N-14). Ceilings between the
 * definition and a task are checked when the task is resolved (`resolveWorkflow`).
 */
function parseWorkflows(value: unknown): { [id: string]: WorkflowDefinition } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("workflows must be an object");
  const ids = Object.keys(value as Rec);
  if (ids.length > MAX_WORKFLOWS) fail(`workflows may have at most ${MAX_WORKFLOWS} entries`);
  const workflows: { [id: string]: WorkflowDefinition } = Object.create(null) as { [id: string]: WorkflowDefinition };
  ids.forEach((id, index) => {
    const at = `workflows[${index}]`;
    if (!WORKFLOW_ID.test(id)) fail(`${at} has an id that is not a valid workflow id`);
    if ((BUILTIN_WORKFLOW_IDS as readonly string[]).includes(id)) fail(`${at} uses the id of a built-in workflow; copy it under a new id`);
    const rec = record((value as Rec)[id], at, [
      "label",
      "tools",
      "instructions",
      "plan",
      "completion",
      "humanReview",
      "allowCommands",
      "policy",
      "verifiers",
      "limits",
    ]);
    const label = rec["label"] === undefined ? undefined : text(rec["label"], `${at}.label`);
    const instructions = rec["instructions"] === undefined ? undefined : text(rec["instructions"], `${at}.instructions`);
    if (instructions !== undefined && [...instructions].length > MAX_WORKFLOW_INSTRUCTIONS_CHARS) {
      fail(`${at}.instructions must be at most ${MAX_WORKFLOW_INSTRUCTIONS_CHARS} characters`);
    }
    const allowCommands = rec["allowCommands"];
    if (allowCommands !== undefined && typeof allowCommands !== "boolean") fail(`${at}.allowCommands must be a boolean`);
    const plan = rec["plan"] === undefined ? undefined : parsePlanMode(rec["plan"], `${at}.plan`);
    const completion = rec["completion"] === undefined ? undefined : parseCompletion(rec["completion"], `${at}.completion`);
    const humanReview = rec["humanReview"] === undefined ? undefined : parseHumanReview(rec["humanReview"], `${at}.humanReview`);
    if ((completion === "human_review") !== (humanReview !== undefined)) {
      fail(`${at}.humanReview is required with completion "human_review" and not allowed otherwise`);
    }
    // U-109: a definition's command rules never ask (confirm is an unknown field here).
    const policy = rec["policy"] === undefined ? undefined : prefixed(at, () => parsePolicy(rec["policy"], "definition"));
    if (allowCommands === false && (policy?.commands.length ?? 0) > 0) fail(`${at}.policy.commands must be empty with allowCommands false`);
    workflows[id] = {
      ...(label === undefined ? {} : { label }),
      tools: parseToolList(rec["tools"], `${at}.tools`),
      ...(instructions === undefined ? {} : { instructions }),
      ...(plan === undefined ? {} : { plan }),
      ...(completion === undefined ? {} : { completion }),
      ...(humanReview === undefined ? {} : { humanReview }),
      ...(allowCommands === undefined ? {} : { allowCommands }),
      ...(policy === undefined ? {} : { policy }),
      ...(rec["verifiers"] === undefined ? {} : { verifiers: prefixed(at, () => parseVerifiers(rec["verifiers"])) }),
      ...(rec["limits"] === undefined ? {} : { limits: prefixed(at, () => parsePartialLimits(rec["limits"])) }),
    };
  });
  return workflows;
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
      "workflows",
      "provider",
      "providers",
    ]);
    if (rec["schemaVersion"] !== CONFIG_SCHEMA_VERSION) fail("config schemaVersion must be 1");
    const model = parseModelText(rec["model"]);
    const maxOutputTokens = optionalOutputTokens(rec["maxOutputTokens"], "maxOutputTokens");
    const apiBaseUrl = parseApiBaseUrl(rec["apiBaseUrl"]);
    const requestTimeoutMs = parseRequestTimeout(rec["requestTimeoutMs"]);
    const maxRetries = parseMaxRetries(rec["maxRetries"]);
    const limits = rec["limits"] === undefined ? undefined : parsePartialLimits(rec["limits"]);
    // U-109: the user's settings, so its command rules may ask before running.
    const policy = rec["policy"] === undefined ? undefined : parsePolicy(rec["policy"], "settings");
    const verifiers = rec["verifiers"] === undefined ? undefined : parseVerifiers(rec["verifiers"]);
    const secretEnv = rec["secretEnv"] === undefined ? undefined : parseSecretEnv(rec["secretEnv"], "secretEnv");
    const integrity = rec["integrity"] === undefined ? undefined : parseIntegrity(rec["integrity"]);
    const language = parseLanguage(rec["language"]);
    const profiles = rec["profiles"] === undefined ? undefined : parseProfiles(rec["profiles"], limits);
    const workflows = rec["workflows"] === undefined ? undefined : parseWorkflows(rec["workflows"]);
    const provider = rec["provider"] === undefined ? undefined : parseProviderName(rec["provider"], "provider");
    const providers = rec["providers"] === undefined ? undefined : parseProviders(rec["providers"]);
    // SP-D3: providers.anthropic and the top-level settings are the same thing; both is ambiguous.
    if (providers?.anthropic !== undefined && TOP_LEVEL_PROVIDER_SETTINGS.some((field) => rec[field] !== undefined)) {
      fail(`providers.anthropic cannot be given together with the top-level ${TOP_LEVEL_PROVIDER_SETTINGS.join(", ")}: they are the same settings; keep one of them`);
    }
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
      ...(workflows === undefined ? {} : { workflows }),
      ...(provider === undefined ? {} : { provider }),
      ...(providers === undefined ? {} : { providers }),
    };
    return { ok: true, config };
  } catch (error) {
    if (error instanceof InputError) {
      return {
        ok: false,
        message: error.message,
        ...(error.position === undefined ? {} : { position: error.position }),
        ...(error.hint === undefined ? {} : { hint: error.hint }),
      };
    }
    throw error;
  }
}
