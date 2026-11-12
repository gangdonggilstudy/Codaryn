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

/** API key. Read from the process environment only, kept in memory, never written or printed. */
export const ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";
/** Model id. Used when the task does not name one. */
export const CODARYN_MODEL_ENV = "CODARYN_MODEL";
/** Path of the config file. Used when `--config` is not given. */
export const CODARYN_CONFIG_ENV = "CODARYN_CONFIG";
/** API base URL. Overrides the config file's `apiBaseUrl`. A task file cannot change it. */
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
  /**
   * N-8: named bundles of policy, verifiers and limits, chosen with `--profile <name>`. Names match
   * PROFILE_NAME_PATTERN_SOURCE; at most MAX_PROFILES entries. Profiles exist only in this file:
   * a task file cannot hold or select one.
   */
  readonly profiles?: { readonly [name: string]: ConfigProfile };
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
export interface ConfigProfile {
  readonly policy?: PolicyConfig;
  readonly verifiers?: readonly VerifierConfig[];
  readonly limits?: Partial<Limits>;
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
  /** One of DEFAULT_CONFIG_DISPLAY's values. */
  readonly display: string;
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

/** Task id and workflow label given to a quick form run. */
export const QUICK_TASK_ID = "quick";
export const QUICK_TASK_WORKFLOW = "general";

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
