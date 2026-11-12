/**
 * The user's config file and the environment variables `codaryn run` reads.
 * The config file is the one named by `--config`, else by CODARYN_CONFIG, else the file at the
 * default location (N-1, `DefaultConfigLocation`) when it exists. Nothing else is read: the
 * workspace is never searched (C-3 as amended by N-1).
 * It holds settings and defaults, never an API key. The key comes only from ANTHROPIC_API_KEY.
 */

import type { MessageLanguage } from "./human.js";
import type { Limits, PolicyConfig } from "./task.js";
import type { VerifierConfig } from "./verify.js";
import type { WorkflowDefinition } from "./workflow.js";

/** API key. Read from the process environment only, kept in memory, never written or printed. */
export const ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";
/** Model id. Used when the task does not name one. SP-D5: it applies to the chosen provider only. */
export const CODARYN_MODEL_ENV = "CODARYN_MODEL";
/** Path of the config file. Used when `--config` is not given. */
export const CODARYN_CONFIG_ENV = "CODARYN_CONFIG";
/**
 * API base URL. Overrides the config file's address of the chosen provider (SP-D5: that provider
 * only). A task file cannot change it.
 */
export const CODARYN_API_BASE_URL_ENV = "CODARYN_API_BASE_URL";

export const CONFIG_SCHEMA_VERSION = 1;

/**
 * Config file shape. Every field except `schemaVersion` is optional. Unknown fields are rejected.
 *
 * Precedence:
 * - model: task `model.model` → CODARYN_MODEL → `model`. None of them → nothing is sent.
 * - maxOutputTokens: task `model.maxOutputTokens` → `maxOutputTokens`. None → nothing is sent.
 * - apiBaseUrl: CODARYN_API_BASE_URL → `apiBaseUrl` → DEFAULT_ANTHROPIC_API_BASE_URL.
 * - requestTimeoutMs, maxRetries: this file → the DEFAULT_ constants.
 * - limits: each field from the task's `limits`, else from this file. A field set in neither is an error.
 *   This file's values are upper bounds: a task may lower them, never raise them or lift a token
 *   limit with null. An anthropic run needs a token limit. Absolute caps apply to both (S-7).
 * - policy, verifiers: used by the quick form only. A task file states its own.
 * - secretEnv: added to the task's `privacy.secretEnv` in both forms.
 * - integrity: this file only, in both forms. A task file cannot set it (U-1).
 * - language (N-4): CODARYN_LANG → `language` → the operating system's display language.
 * - profiles (N-8): `--profile <name>` overlays one entry on `policy`, `verifiers` and `limits`
 *   (see `ConfigProfile`). Without `--profile` the top-level fields are used as before.
 * - workflows (G-A): a workflow definition's `policy`, `verifiers` and `limits` lie under the
 *   profile's and the top level's for the quick form; its settings resolve as `ResolveWorkflow`
 *   says. No `workflowRef` anywhere: nothing changes.
 * - workflowRef (G-A, DR-2): the task file's `workflowRef`; in the quick form `--workflow <id>`;
 *   else the chosen profile's `workflowRef`; else none (legacy settings). `--workflow` is the quick
 *   form's only way to name a definition, in `run`, `plan`, `apply` and `review` alike.
 * - provider (SP-D3, SP-D10, DR-31): a task file's `model.provider`; in the quick form the chosen
 *   profile's `provider`, else this file's `provider`, else "anthropic". The provider's settings
 *   (`model`, `maxOutputTokens`, `apiBaseUrl`, `requestTimeoutMs`, `maxRetries`) come from
 *   `providers.<name>`; for "anthropic" the top-level fields are read as before (backward
 *   compatible). Giving top-level provider settings and `providers.anthropic` together is
 *   `invalid_config`. The environment variables CODARYN_MODEL and CODARYN_API_BASE_URL apply to the
 *   chosen provider only. The key comes from the provider's own variable (API_PROVIDERS).
 */
export interface CodarynConfig {
  readonly schemaVersion: 1;
  /**
   * Model id. A placeholder (blank, or `<...>`, see MODEL_PLACEHOLDER_PATTERN_SOURCE) is accepted
   * in the file but counts as not set: `run` and `doctor` treat it as no model (N-3).
   */
  readonly model?: string;
  /** Positive integer, at most MAX_OUTPUT_TOKENS_LIMIT. */
  readonly maxOutputTokens?: number;
  /** `https:` URL, or `http:` for a loopback host only (local test servers). */
  readonly apiBaseUrl?: string;
  /** Positive integer. Time limit for one HTTP request, retries not included. */
  readonly requestTimeoutMs?: number;
  /** Integer from 0 to MAX_RETRIES_LIMIT. Retries after the first attempt. */
  readonly maxRetries?: number;
  /** Default limits. Same rules as task limits: positive integers, `maxTotalTokens` may be null. */
  readonly limits?: Partial<Limits>;
  /** Quick form policy. Absent means DENY_ALL_POLICY. */
  readonly policy?: PolicyConfig;
  /** Quick form verifiers. Absent means none (the run ends as needs-input, `no_verifier`). */
  readonly verifiers?: readonly VerifierConfig[];
  /** Names of environment variables whose values are registered as secrets. */
  readonly secretEnv?: readonly string[];
  /** Protected material outside the workspace (U-1). Absent: only `policy.protectedPaths` is checked. */
  readonly integrity?: IntegrityConfig;
  /** N-4: language of the human-readable messages. CODARYN_LANG overrides it. Absent: the OS language. */
  readonly language?: MessageLanguage;
  /** SP-D3: the API provider of a run whose task names none (the quick form). Absent: "anthropic". */
  readonly provider?: ApiProviderName;
  /**
   * SP-D3: settings per API provider. `providers.anthropic` is the same as the top-level fields and
   * may not be given together with them. A provider not listed uses the DEFAULT_ constants and its
   * table entry (API_PROVIDERS); a model is never defaulted (C-3).
   */
  readonly providers?: { readonly [P in ApiProviderName]?: ProviderSettings };
  /**
   * N-8: named bundles of policy, verifiers and limits, chosen with `--profile <name>`. Names match
   * PROFILE_NAME_PATTERN_SOURCE; at most MAX_PROFILES entries. Profiles exist only in this file:
   * a task file cannot hold or select one.
   */
  readonly profiles?: { readonly [name: string]: ConfigProfile };
  /**
   * G-A (GT-D1): workflow definitions by id (WORKFLOW_ID_PATTERN_SOURCE, at most MAX_WORKFLOWS, none
   * equal to a BUILTIN_WORKFLOW_IDS entry). Definitions exist only here and as built-ins: a task
   * file cannot hold one, only name one with `workflowRef`.
   */
  readonly workflows?: { readonly [id: string]: WorkflowDefinition };
}

/**
 * N-8: one entry of `profiles`. Every field is optional; unknown fields are rejected.
 * Selecting it with `--profile <name>` gives the effective config:
 * - policy: the profile's `policy`, else the config's `policy` (quick form only, as before).
 * - verifiers: the profile's `verifiers`, else the config's `verifiers` (quick form only).
 * - limits: the config's `limits` with the profile's fields laid over them, field by field.
 *   S-7 applies unchanged: a profile field cannot exceed the config's top-level value for that
 *   field, nor be `null` where the top level has a number (`invalid_config`, checked for every
 *   profile when the file is read). The merged limits are then upper bounds for a task file, and
 *   the absolute caps and the anthropic token rule apply as for the config's own limits.
 * A task file run with `--profile` takes only the profile's limits (as upper bounds): a task file
 * states its own policy and verifiers.
 */
/** SP-D3: one API provider's settings in the config file. Same rules as the top-level fields. */
export interface ProviderSettings {
  readonly model?: string;
  /** Positive integer, at most the provider's `maxOutputTokensLimit` (API_PROVIDERS). */
  readonly maxOutputTokens?: number;
  /** `https:` URL, or `http:` for a loopback host only. Path rule: the provider's `baseUrlPath`. */
  readonly apiBaseUrl?: string;
  readonly requestTimeoutMs?: number;
  readonly maxRetries?: number;
}

export interface ConfigProfile {
  /** SP-D10: the API provider for the quick form with this profile; it wins over the config's `provider`. */
  readonly provider?: ApiProviderName;
  readonly policy?: PolicyConfig;
  readonly verifiers?: readonly VerifierConfig[];
  readonly limits?: Partial<Limits>;
  /** G-A: the workflow definition this profile uses when the task names none (`ResolveWorkflow`). */
  readonly workflowRef?: string;
}

/** N-8: profile names. Letters, digits, `.`, `_`, `-`; starts with a letter or digit; 1-64 characters. */
export const PROFILE_NAME_PATTERN_SOURCE = "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$";
/** N-8: largest number of entries in `profiles`. More is `invalid_config`. */
export const MAX_PROFILES = 32;

/**
 * N-3: a model value that only holds a place. After trimming, an empty string or one that starts
 * with `<` and ends with `>` and has no other `<` or `>`. Example files and `codaryn init`
 * (without a key) write MODEL_PLACEHOLDER. A placeholder in the task (`model.model`), in
 * CODARYN_MODEL or in the config's `model` counts as not set at that level, so the next level in
 * the model order is used; when none is left, `run` stops as `provider_not_configured` and
 * `doctor`'s `model` check fails. Nothing is sent.
 */
export const MODEL_PLACEHOLDER_PATTERN_SOURCE = "^<[^<>]*>$";
/** Written by `codaryn init` when no model was chosen. */
export const MODEL_PLACEHOLDER = "<model id>";

/** N-4: overrides the config's `language`. Values other than `ko` and `en` (any case) are ignored. */
export const CODARYN_LANG_ENV = "CODARYN_LANG";

/**
 * N-1: where the config file was taken from. Precedence: `--config` ("argument") →
 * CODARYN_CONFIG ("environment") → the default location ("default"), used only when neither of
 * the others is given and a file exists there. A missing default file means no config file, as
 * before N-1; any other failure to read it is `invalid_config`.
 */
export const CONFIG_SOURCES = ["argument", "environment", "default"] as const;
export type ConfigSource = (typeof CONFIG_SOURCES)[number];

/**
 * N-1: the default location, one fixed file outside any workspace.
 * - Windows: `%APPDATA%\Codaryn\config.json`. APPDATA unset, blank or not fully absolute: none.
 * - Elsewhere: `$XDG_CONFIG_HOME/codaryn/config.json` when XDG_CONFIG_HOME is set and absolute
 *   (a relative value is ignored, as the XDG specification says), else
 *   `<home>/.config/codaryn/config.json`. No home directory: none.
 * The path must pass the S-5 local path check; a network or device path is not used (as if there
 * were none) and `doctor` warns. When used, the S-1 rule applies: a default file whose real path
 * lies inside the run's workspace stops the run as `invalid_config`.
 * Messages and outputs show `display`, never the expanded path, so no environment value is printed.
 */
export interface DefaultConfigLocation {
  /** Absolute path of the file. Used to read and write it; never printed. */
  readonly path: string;
  /** One of DEFAULT_CONFIG_DISPLAY's values (N-14: the type admits nothing else). */
  readonly display: DefaultConfigDisplay;
}

export const DEFAULT_CONFIG_DIR_WINDOWS = "Codaryn";
export const DEFAULT_CONFIG_DIR_POSIX = "codaryn";
export const DEFAULT_CONFIG_FILE_NAME = "config.json";
/** How the default location is shown, without expanding any variable. */
export const DEFAULT_CONFIG_DISPLAY = {
  windows: "%APPDATA%\\Codaryn\\config.json",
  xdg: "$XDG_CONFIG_HOME/codaryn/config.json",
  home: "~/.config/codaryn/config.json",
} as const;
/** N-14: one of DEFAULT_CONFIG_DISPLAY's values. */
export type DefaultConfigDisplay = (typeof DEFAULT_CONFIG_DISPLAY)[keyof typeof DEFAULT_CONFIG_DISPLAY];

/**
 * Signature of the function that finds the default location (`src/cli/config-location.ts`).
 * `env` is the process environment, `homeDir` is `os.homedir()` or null when it is unknown.
 */
export type FindDefaultConfigLocation = (
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string | null,
) => DefaultConfigLocation | null;

/** Defaults `codaryn init` writes (N-2). The user edits the file to change them. */
export const INIT_DEFAULT_LIMITS = {
  maxModelTurns: 12,
  maxToolCalls: 24,
  maxTotalTokens: 150_000,
  maxDurationMs: 600_000,
} as const;
export const INIT_DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/**
 * U-1: material outside the workspace that a run must not change, such as baseline tests or
 * verifier settings. It is hashed with `policy.protectedPaths` at run start and before and after
 * each verification round (`IntegrityChecker`). Unknown fields are rejected.
 */
export interface IntegrityConfig {
  /**
   * Absolute local paths of files or directories, at most MAX_INTEGRITY_PATHS entries, each a
   * non-empty string without NUL. UNC and device paths are refused (S-5). These are format
   * errors, `invalid_config`, found when the file is read.
   * When the run starts, before the lock is taken, each must exist, and its real path must not be
   * the workspace root, lie inside it or contain it; otherwise the run stops as `invalid_config`.
   * Messages name the position (`integrity.paths[i]`), never the path. An empty list checks nothing.
   */
  readonly paths: readonly string[];
}

export const DEFAULT_ANTHROPIC_API_BASE_URL = "https://api.anthropic.com";
export const DEFAULT_REQUEST_TIMEOUT_MS = 600_000;
export const DEFAULT_MAX_RETRIES = 2;
export const MAX_RETRIES_LIMIT = 10;
/**
 * Absolute cap for `maxOutputTokens`, in the task (`model.maxOutputTokens`) and in the config
 * file (T-14). A larger value is `invalid_task` or `invalid_config`.
 */
export const MAX_OUTPUT_TOKENS_LIMIT = 200_000;

/** Policy for the quick form when the config file has none: no commands, nothing restored. */
export const DENY_ALL_POLICY: PolicyConfig = {
  commands: [],
  network: "deny",
  destructive: "deny",
  restorePathTokens: false,
};

/**
 * Task id and workflow label given to a quick form run. G-A: with `--workflow <id>` the label is
 * that id and the task's `workflowRef` is the id; without it the label stays QUICK_TASK_WORKFLOW
 * and the run has no definition (legacy settings), as before.
 */
export const QUICK_TASK_ID = "quick";
export const QUICK_TASK_WORKFLOW = "general";
/** G-A (DR-2): the quick form's argument that names a workflow definition (TaskSpec.workflowRef). */
export const QUICK_WORKFLOW_ARGUMENT = "--workflow";

/**
 * Field names that hold a key. A task or config file with such a field at any depth is
 * rejected as `key_in_file` before anything else. Compared after NFKC normalization (so
 * full-width forms fold to ASCII), lowercasing and removing every character other than a-z
 * and 0-9. Any name containing "apikey" also matches.
 */
export const KEY_FIELD_NAMES = [
  "apikey",
  "key",
  "secret",
  "secretkey",
  "token",
  "accesstoken",
  "authtoken",
  "authorization",
  "bearer",
  "password",
] as const;

/**
 * Shape of an Anthropic API key. A string value of this shape in a task or config file (in the
 * raw text and in the parsed value) or in `--goal` is rejected as `key_in_file`, as is the
 * current ANTHROPIC_API_KEY value when it has at least 16 characters.
 */
export const ANTHROPIC_KEY_PATTERN_SOURCE = "sk-ant-[A-Za-z0-9_-]{8,}";

// ---------------------------------------------------------------------------------------------
// SP-1 (docs/design/second-provider.md 4.1, DR-22, DR-31): one table of the API providers.

/**
 * DR-31 (g), facts C-3: the OpenAI key variable. Its provider joins API_PROVIDERS with its adapter
 * (SP-5); the key is known now so that S-2 and every key check cover it whatever provider runs.
 */
export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

/**
 * DR-33 (1): an OpenAI key with a distinct prefix: `sk-proj-`, `sk-svcacct-` or `sk-admin-` at a word
 * start, then 20 or more of `A-Z a-z 0-9 _ -`.
 */
export const OPENAI_PREFIXED_KEY_PATTERN_SOURCE = "\\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}";

/**
 * DR-33 (2): the older OpenAI key without such a prefix: `sk-` at a word start, then a run of 40 or
 * more letters and digits only (no `-`, no `_`) holding a digit, an upper-case and a lower-case
 * letter, and ending there (not followed by a letter, digit, `-` or `_`). A name with a hyphen or an
 * underscore after `sk-` is never this shape.
 */
export const OPENAI_LEGACY_KEY_PATTERN_SOURCE =
  "\\bsk-(?=[A-Za-z0-9]*[0-9])(?=[A-Za-z0-9]*[A-Z])(?=[A-Za-z0-9]*[a-z])[A-Za-z0-9]{40,}(?![A-Za-z0-9_-])";

/**
 * DR-31 (g), DR-32 (a), DR-33: the OpenAI key shapes for refusing a key in files and arguments (S-6,
 * S-8): OPENAI_PREFIXED_KEY_PATTERN_SOURCE or OPENAI_LEGACY_KEY_PATTERN_SOURCE, nothing else.
 *
 * - Not a key check. OpenAI documents no key prefix, length or character set (facts C-3); these
 *   prefixes and lengths are observed practice. They are never used to accept or reject a key, only
 *   as a second check when refusing. The main defence is matching the key values registered from the
 *   environment (S-2 registers every API_KEY_ENVS value), which finds a key whatever its shape.
 * - Still refused although not a key (false positives left): a name starting `sk-proj-`,
 *   `sk-svcacct-` or `sk-admin-` with 20 or more characters after it (`sk-proj-` and a long kebab
 *   name); a single unbroken run of 40 or more letters and digits after `sk-` mixing digits, upper
 *   and lower case (a mixed-case hash or id written as one word).
 * - Not refused by shape (misses left; the registered value still finds them): a key with any other
 *   prefix; an older key shorter than 40, holding `-` or `_`, lacking one of the three character
 *   kinds, or directly followed by `-` or `_`; a prefixed key with fewer than 20 characters after the
 *   prefix; any key glued to a letter, digit or `_` before `sk` (no word start).
 * - Word start: in these JavaScript patterns only `A-Z a-z 0-9 _` are word characters, so `sk` right
 *   after Hangul or other non-ASCII text starts a word and is checked.
 * - Not refused any more (Codex review, R-19): ordinary names with upper case and digits such as
 *   branches, an id with an upper-case UUID, folders with a version, because each holds a hyphen.
 */
export const OPENAI_KEY_PATTERN_SOURCE = `(?:${OPENAI_PREFIXED_KEY_PATTERN_SOURCE})|(?:${OPENAI_LEGACY_KEY_PATTERN_SOURCE})` as const;

/**
 * DR-32 (a): the loose OpenAI key shape, for hiding key-like text in output only (never for
 * refusing): `sk-` at a word start and 32 or more of `A-Z a-z 0-9 _ -`. It also hides some ordinary
 * names; that costs readability, not a refused run. With the refusal shapes (API_KEY_MASK_PATTERN_SOURCES)
 * it also hides the key-like text the refusal shapes leave out because of a hyphen or an underscore.
 */
export const OPENAI_KEY_LOOSE_PATTERN_SOURCE = "\\bsk-[A-Za-z0-9_-]{32,}";

/**
 * The API providers, in the order help and lists show them: Anthropic first (the first provider),
 * then OpenAI (DR-22, DR-31, SP-5). Readers take provider facts from API_PROVIDERS, never from a list
 * of their own.
 */
export const API_PROVIDER_NAMES = ["anthropic", "openai"] as const;
export type ApiProviderName = (typeof API_PROVIDER_NAMES)[number];

/** Every model provider a task may name: the scripted one (tests, offline runs) and the API providers. */
export const MODEL_PROVIDER_NAMES = ["scripted", ...API_PROVIDER_NAMES] as const;

/** What the CLI needs to know about one API provider. */
export interface ApiProviderSpec {
  /** The environment variable the key is read from (the only place a key comes from). */
  readonly keyEnv: string;
  /** Key shapes to find in files, arguments and output (regular expression sources). */
  readonly keyPatternSources: readonly string[];
  /** Used when neither CODARYN_API_BASE_URL nor the config gives an address. */
  readonly defaultApiBaseUrl: string;
  /**
   * How the address relates to the API path: `without_version` (the adapter adds `/v1/...`, so an
   * address ending in `/v1` is refused, S-9) or `with_version` (the address includes the version).
   */
  readonly baseUrlPath: "without_version" | "with_version";
  /** Largest `maxOutputTokens` accepted. */
  readonly maxOutputTokensLimit: number;
  /** Smallest `maxOutputTokens` accepted (openai: 16, facts C-10). */
  readonly minOutputTokens: number;
}

/** DR-31, facts C-4: the OpenAI API address; it includes the version (`/v1`). */
export const DEFAULT_OPENAI_API_BASE_URL = "https://api.openai.com/v1";

/**
 * The provider table. The Anthropic entry holds exactly the values the CLI used before it.
 * OpenAI (DR-31): key OPENAI_API_KEY, the refusal key shapes (DR-33), the address with `/v1`, at least 16
 * output tokens (facts C-10). Its largest output cap is not documented (facts); Codaryn's own bound
 * MAX_OUTPUT_TOKENS_LIMIT applies, as for Anthropic, until the PM sets another.
 */
export const API_PROVIDERS = {
  anthropic: {
    keyEnv: ANTHROPIC_API_KEY_ENV,
    keyPatternSources: [ANTHROPIC_KEY_PATTERN_SOURCE],
    defaultApiBaseUrl: DEFAULT_ANTHROPIC_API_BASE_URL,
    baseUrlPath: "without_version",
    maxOutputTokensLimit: MAX_OUTPUT_TOKENS_LIMIT,
    minOutputTokens: 1,
  },
  openai: {
    keyEnv: OPENAI_API_KEY_ENV,
    keyPatternSources: [OPENAI_KEY_PATTERN_SOURCE],
    defaultApiBaseUrl: DEFAULT_OPENAI_API_BASE_URL,
    baseUrlPath: "with_version",
    maxOutputTokensLimit: MAX_OUTPUT_TOKENS_LIMIT,
    minOutputTokens: 16,
  },
} as const satisfies { readonly [P in ApiProviderName]: ApiProviderSpec };


/**
 * Every API key variable Codaryn knows, the providers still being added included. S-2 (SP-2)
 * registers all of their values as secrets, whatever provider runs; output cleaning removes all of
 * them. Each API_PROVIDERS entry's `keyEnv` is one of them.
 */
export const API_KEY_ENVS = [ANTHROPIC_API_KEY_ENV, OPENAI_API_KEY_ENV] as const;
export type ApiKeyEnv = (typeof API_KEY_ENVS)[number];

/**
 * Every key shape Codaryn knows (regular expression sources) for refusing keys in files and
 * arguments (S-6, S-8), after the match against registered key values. Each API_PROVIDERS entry's
 * shapes are among them. DR-32 (a): narrow shapes only.
 */
export const API_KEY_PATTERN_SOURCES = [ANTHROPIC_KEY_PATTERN_SOURCE, OPENAI_KEY_PATTERN_SOURCE] as const;

/**
 * DR-32 (a): the key shapes for hiding key-like text in output (human output, message parameters,
 * provider error messages): the refusal shapes and the loose OpenAI shape. Never used to refuse.
 */
export const API_KEY_MASK_PATTERN_SOURCES = [ANTHROPIC_KEY_PATTERN_SOURCE, OPENAI_KEY_PATTERN_SOURCE, OPENAI_KEY_LOOSE_PATTERN_SOURCE] as const;
