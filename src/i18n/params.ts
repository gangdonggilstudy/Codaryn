/**
 * Message parameters by kind (`MessageParamKind`, src/contracts/human.ts), with the N-14
 * direction applied: a parameter shows a number, a fixed code, a schema field position or a fixed
 * display string, and nothing read from a file or the environment. A value outside its kind's
 * closed form becomes REPLACEMENT, never the value itself. Pure: reads nothing.
 *
 * Interim rules for kinds the N-14 contract revision is expected to replace:
 * - path: only the fixed display strings of the config location (DEFAULT_CONFIG_DISPLAY, "--config").
 * - name: only tool names (verifier ids and profile names come from files; N-14 shows ordinals).
 * - command: `codaryn` or `npm` followed by words from COMMAND_WORDS, generated run ids,
 *   `<placeholder>`s and small numbers, joined by single spaces. A typed path cannot pass; the
 *   hint shows `<workspace>` instead.
 * - text, detail: only text this catalog produced (`ownText`).
 */

import {
  ANTHROPIC_KEY_PATTERN_SOURCE,
  CLI_ERROR_EXIT_CODES,
  CONFIG_SOURCES,
  DEFAULT_CONFIG_DISPLAY,
  DOCTOR_CHECK_IDS,
  DOCTOR_CHECK_STATUSES,
  INTEGRITY_PHASES,
  MESSAGE_LANGUAGES,
  MODEL_ERROR_KINDS,
  PERMISSION_KINDS,
  POLICY_DENIAL_CODES,
  REVERT_SKIP_REASONS,
  RUN_REASONS,
  TERMINAL_RUN_STATUSES,
  TOOL_ERROR_CODES,
  TOOL_NAMES,
} from "../contracts/index.js";
import type { MessageLanguage, MessageParamKind, ModelProviderName, VerifierOutcome } from "../contracts/index.js";

/** Shown in place of a value that does not fit its kind, and of a replaced character. */
export const REPLACEMENT = "?";
/** Shown in place of key-shaped text. */
export const HIDDEN_KEY = "[key]";

const KEY_PATTERN = new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE, "g");

const VERIFIER_OUTCOMES = ["pass", "fail", "inconclusive"] as const satisfies readonly VerifierOutcome[];
const PROVIDERS = ["scripted", "anthropic"] as const satisfies readonly ModelProviderName[];
type MissingOutcome = Exclude<VerifierOutcome, (typeof VERIFIER_OUTCOMES)[number]>;
type MissingProvider = Exclude<ModelProviderName, (typeof PROVIDERS)[number]>;
const listsComplete: [MissingOutcome | MissingProvider] extends [never] ? true : false = true;
void listsComplete;

/** Every code a `code` parameter may hold: the contracts' fixed lists. */
export const MESSAGE_CODES: ReadonlySet<string> = new Set<string>([
  ...Object.keys(CLI_ERROR_EXIT_CODES),
  ...TERMINAL_RUN_STATUSES,
  ...RUN_REASONS,
  ...PERMISSION_KINDS,
  ...POLICY_DENIAL_CODES,
  ...TOOL_ERROR_CODES,
  ...TOOL_NAMES,
  ...INTEGRITY_PHASES,
  ...MODEL_ERROR_KINDS,
  ...REVERT_SKIP_REASONS,
  ...DOCTOR_CHECK_IDS,
  ...DOCTOR_CHECK_STATUSES,
  ...CONFIG_SOURCES,
  ...MESSAGE_LANGUAGES,
  ...VERIFIER_OUTCOMES,
  ...PROVIDERS,
]);

/** Every string a `path` parameter may hold (interim, see above). */
export const DISPLAY_LOCATIONS: ReadonlySet<string> = new Set<string>([...Object.values(DEFAULT_CONFIG_DISPLAY), "--config"]);

/**
 * Field names the contracts define (task, config, profiles, verifiers, policy, limits, integrity,
 * scripted model files). A position shows only these names; any other name (an unknown field,
 * a profile name) is shown as "?".
 */
export const KNOWN_FIELD_NAMES: ReadonlySet<string> = new Set([
  "schemaVersion",
  "id",
  "goal",
  "workflow",
  "workspaceRoot",
  "model",
  "provider",
  "scriptPath",
  "maxOutputTokens",
  "apiBaseUrl",
  "requestTimeoutMs",
  "maxRetries",
  "language",
  "profiles",
  "policy",
  "commands",
  "executable",
  "argsPrefix",
  "allowExtraArgs",
  "network",
  "destructive",
  "restorePathTokens",
  "protectedPaths",
  "privacy",
  "secretEnv",
  "limits",
  "maxModelTurns",
  "maxToolCalls",
  "maxTotalTokens",
  "maxDurationMs",
  "maxRepairAttempts",
  "maxSameFailures",
  "verifiers",
  "kind",
  "args",
  "cwd",
  "timeoutMs",
  "expectExitCode",
  "rules",
  "type",
  "path",
  "text",
  "integrity",
  "paths",
  "steps",
  "toolCalls",
  "name",
  "stop",
  "usage",
  "inputTokens",
  "outputTokens",
  "delayMs",
]);

/** A run id as Codaryn creates it: `<UTC yyyymmddThhmmssZ>-<8 lowercase hex>` (P-3). */
export const GENERATED_RUN_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

/**
 * Words a `command` parameter may use (interim, see above): codaryn's commands and options, and
 * npm with the script names `codaryn init` may suggest.
 */
export const COMMAND_WORDS: ReadonlySet<string> = new Set([
  "codaryn",
  "run",
  "revert",
  "report",
  "doctor",
  "models",
  "init",
  "runs",
  "help",
  "latest",
  "--task",
  "--workspace",
  "--goal",
  "--config",
  "--vars-file",
  "--cancel-file",
  "--quiet",
  "--json",
  "--use",
  "--run",
  "--dry-run",
  "--profile",
  "--limit",
  "--help",
  "--version",
  "npm",
  "test",
  "build",
  "lint",
  "typecheck",
  "check",
]);
const COMMAND_PROGRAMS: ReadonlySet<string> = new Set(["codaryn", "npm"]);
const COMMAND_PLACEHOLDER = /^<[a-z][a-z0-9_-]{0,30}>$/;
const COMMAND_NUMBER = /^\d{1,6}$/;
const MAX_COMMAND = 300;

function isCommandWord(word: string): boolean {
  return COMMAND_WORDS.has(word) || GENERATED_RUN_ID.test(word) || COMMAND_PLACEHOLDER.test(word) || COMMAND_NUMBER.test(word);
}

/** A command line in the closed form above, or REPLACEMENT. */
export function formatCommand(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_COMMAND) return REPLACEMENT;
  const words = value.split(" ");
  const [program] = words;
  if (program === undefined || !COMMAND_PROGRAMS.has(program)) return REPLACEMENT;
  return words.every(isCommandWord) ? value : REPLACEMENT;
}

const TOP_LEVEL: { readonly [L in MessageLanguage]: string } = { ko: "최상위", en: "top level" };
const MAX_FIELD_POSITION = 200;
const FIELD_NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const FIELD_INDEX = /\[(\d{1,6})\]/y;

/** C0 and C1 controls, line and paragraph separators, and bidirectional controls. */
function isUnsafeCodePoint(cp: number): boolean {
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return true;
  if (cp === 0x2028 || cp === 0x2029 || cp === 0x061c || cp === 0x200e || cp === 0x200f) return true;
  return (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}

/**
 * One line for a terminal: every unsafe character (line breaks included) becomes REPLACEMENT and
 * key-shaped text becomes HIDDEN_KEY. The same character rules as `src/cli/text-safety.ts`.
 */
export function cleanLine(text: string): string {
  let out = "";
  for (const char of text) out += isUnsafeCodePoint(char.codePointAt(0) as number) ? REPLACEMENT : char;
  return out.replace(KEY_PATTERN, HIDDEN_KEY);
}

export function formatCount(value: unknown): string {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : REPLACEMENT;
}

/**
 * A field position: known names joined by "." with `[n]` indexes, such as
 * `policy.commands[2].argsPrefix`. "" is the top level, shown as a word. An unknown name is shown
 * as "?"; anything that is not a position is REPLACEMENT as a whole.
 */
export function formatField(value: unknown, language: MessageLanguage): string {
  if (value === "") return TOP_LEVEL[language];
  if (typeof value !== "string" || value.length > MAX_FIELD_POSITION) return REPLACEMENT;
  let out = "";
  let pos = 0;
  while (pos < value.length) {
    FIELD_INDEX.lastIndex = pos;
    const index = pos > 0 ? FIELD_INDEX.exec(value) : null;
    if (index !== null) {
      out += `[${String(Number(index[1]))}]`;
      pos = FIELD_INDEX.lastIndex;
      continue;
    }
    if (pos > 0) {
      if (value[pos] !== ".") return REPLACEMENT;
      pos += 1;
      out += ".";
    }
    FIELD_NAME.lastIndex = pos;
    const name = FIELD_NAME.exec(value);
    if (name === null) return REPLACEMENT;
    out += KNOWN_FIELD_NAMES.has(name[0]) ? name[0] : REPLACEMENT;
    pos = FIELD_NAME.lastIndex;
  }
  return out;
}

function fromSet(value: unknown, allowed: ReadonlySet<string>): string {
  return typeof value === "string" && allowed.has(value) ? value : REPLACEMENT;
}

const TOOL_NAME_SET: ReadonlySet<string> = new Set(TOOL_NAMES);

/**
 * One parameter by its kind. `ownText` says whether a string is a message this catalog produced
 * (for `text` and `detail`).
 */
export function formatParam(
  kind: MessageParamKind,
  value: unknown,
  language: MessageLanguage,
  ownText: (text: string) => boolean,
): string {
  switch (kind) {
    case "count":
      return formatCount(value);
    case "code":
      return fromSet(value, MESSAGE_CODES);
    case "field":
      return formatField(value, language);
    case "runId":
      return typeof value === "string" && GENERATED_RUN_ID.test(value) ? value : REPLACEMENT;
    case "path":
      return fromSet(value, DISPLAY_LOCATIONS);
    case "name":
      return fromSet(value, TOOL_NAME_SET);
    case "command":
      return formatCommand(value);
    case "text":
    case "detail":
      return typeof value === "string" && ownText(value) ? value : REPLACEMENT;
  }
}
