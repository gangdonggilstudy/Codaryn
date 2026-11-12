/**
 * CLI security checks (S-1, S-3 to S-9). Pure functions or read-only real path lookups.
 * The CLI calls them; they never print, exit or read file contents. No message they return
 * contains a value from a file, an environment variable or a key.
 */

export { checkLocalPathSyntax, locateInWorkspace, relateRealPaths } from "./paths.js";
export type { PathRelation, PathSyntaxOutcome, RealpathFs, WorkspaceLocation } from "./paths.js";
export {
  KEY_MASK_SHAPE_SOURCE,
  KNOWN_FIELD_NAMES,
  MAX_INPUT_FILE_BYTES,
  inputFileTooLarge,
  inputFileTooLargeMessage,
  MAX_KEY_SCAN_DEPTH,
  MIN_CURRENT_KEY_LENGTH,
  findKeyInJson,
  goalHoldsKey,
  isKeyFieldName,
  keyValuesOf,
  rawTextHoldsKey,
} from "./keys.js";
export type { KeyScanOutcome, KnownKeys } from "./keys.js";
export {
  ENV_FILE_NON_SECRETS,
  ENV_NAME_PATTERN,
  MIN_ENV_SECRET_LENGTH,
  secretEnvNotSetMessage,
  selectEnvFileSecrets,
  validateSecretEnvNames,
} from "./env.js";
export type { EnvSnapshot, SecretEnvNamesOutcome } from "./env.js";
export { ABSOLUTE_LIMITS, MAX_TIMER_MS, checkTimerMs, resolveBoundedLimits } from "./limits.js";
export type { BoundedLimitsInput, BoundedLimitsOutcome } from "./limits.js";
export { API_BASE_URL_STRICT_RULE, API_BASE_URL_WITH_VERSION_RULE, normalizeApiBaseUrlStrict } from "./url.js";
export type { ApiBaseUrlPath } from "./url.js";
export type { ApiBaseUrlOutcome } from "./url.js";
