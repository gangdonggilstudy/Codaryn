/**
 * The user's config file and the environment variables `codaryn run` reads.
 * The config file is read only when named by `--config` or CODARYN_CONFIG. It is never searched for.
 * It holds settings and defaults, never an API key. The key comes only from ANTHROPIC_API_KEY.
 */

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
 */
export interface CodarynConfig {
  readonly schemaVersion: 1;
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
}

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
