/**
 * Human-readable output (N-4, N-5, N-7): the message languages, the fixed message catalog and the
 * renderer that turns command outputs into text for people.
 *
 * Machine output does not change: stdout keeps its one JSON line (or the text of `report`,
 * `doctor`, `models`, `runs`, `init`), and error codes, JSON fields and exit codes stay English.
 * Human text goes to stderr: an error explained (what happened, how to fix it, the code), the
 * summary at the end of a run or a revert, and progress lines. `--quiet` turns all of it off.
 *
 * Modules:
 * - `src/i18n/index.ts` (N-B) exports `selectMessageLanguage` (SelectMessageLanguage) and
 *   `createMessageCatalog` (CreateMessageCatalog).
 * - `src/cli/human/index.ts` (N-C) exports `createHumanOutput` (CreateHumanOutput).
 *
 * N-14 (review H1): a message parameter has the type its id declares, and the only types are
 * numbers, closed code unions, schema field positions (`SchemaFieldPath`), run ids (`RunId`),
 * the fixed display strings below, and text the catalog itself produced (`CatalogText`). No
 * message takes free text, so nothing read from a file or the environment can reach a message
 * through a parameter. DR-51 (U-38): the one typed value a message takes is the workspace path of
 * a next-command hint, as a ShownWorkspace (`toShownWorkspace`: masked, checked, quoted). A verifier is shown by its number, never by its id; a profile by whether
 * one was applied, never by its name.
 */

import { REVERT_SKIP_REASONS } from "./changes.js";
import { CLEANUP_BLOCK_CODES, CLEANUP_KEPT_REASONS, CLEANUP_TARGETS, CLEANUP_WARNING_CODES } from "./cleanup.js";
import type { CleanupBlockCode, CleanupKeptReason, CleanupTarget, CleanupWarningCode } from "./cleanup.js";
import type { RevertSkipReason } from "./changes.js";
import type { RunListEntry, RunsOutput } from "./commands.js";
import type { ApiBaseUrlEnv, ApiKeyEnv, ApiModelEnv, DefaultConfigDisplay } from "./config.js";
import { API_KEY_MASK_PATTERN_SOURCES } from "./config.js";
import { DOCTOR_CHECK_IDS, DOCTOR_CHECK_STATUSES } from "./commands.js";
import type { DoctorCheckId, DoctorCheckStatus } from "./commands.js";
import { CLI_ERROR_EXIT_CODES, CLI_ERROR_HINTS, RUN_REASONS, TERMINAL_RUN_STATUSES } from "./engine.js";
import { INTEGRITY_PHASES } from "./integrity.js";
import { MODEL_ERROR_KINDS } from "./model.js";
import { CONFIRMATION_BY, PERMISSION_KINDS, POLICY_DENIAL_CODES } from "./policy.js";
import type { CliErrorCode, CliErrorHint, CliErrorOutput, EngineResult, RevertOutput, RunReason, TerminalRunStatus } from "./engine.js";
import type { IntegrityPhase } from "./integrity.js";
import type { JournalEvent } from "./journal.js";
import type { ModelErrorKind } from "./model.js";
import type { ConfirmationBy, PermissionKind, PolicyDenialCode } from "./policy.js";
import { APPLY_NOTICE_KINDS, APPROVAL_CHANNELS, PLAN_ITEM_PROBLEMS, PLAN_RECORDS_UNCHECKED_CAUSES } from "./plan.js";
import type { ApplyJournalEvent, ApplyNoticeKind, ApplyResult, ApprovalChannel, PlanItemProblem, PlanRecordsUncheckedCause } from "./plan.js";
import type { ModelProviderName } from "./task.js";
import { ALL_TOOL_NAMES, TOOL_ERROR_CODES } from "./tool.js";
import type { AnyToolName, ToolErrorCode } from "./tool.js";
// U-36: the lists whose words `plan`, `review` and `changes` show.
import { CHANGED_FILE_STATES, CHANGED_FILE_UNAVAILABLE_REASONS } from "./changes.js";
import type { ChangedFileState, ChangedFileUnavailableReason } from "./changes.js";
import { PLAN_ACTION_KINDS, PLAN_STATUSES } from "./plan.js";
import type { PlanActionKind, PlanStatus } from "./plan.js";
import { REVIEW_VERDICTS } from "./workflow.js";
import type { PolicyNarrowing, ReviewVerdict } from "./workflow.js";

export const MESSAGE_LANGUAGES = ["ko", "en"] as const;
export type MessageLanguage = (typeof MESSAGE_LANGUAGES)[number];

/**
 * N-4: what decides the language. First match wins:
 * 1. `env`: CODARYN_LANG, trimmed and lowercased; only `ko` or `en` counts, anything else is ignored.
 * 2. `config`: the config file's `language`, when a config file was read and is valid.
 * 3. `osLocale`: the display language (`Intl.DateTimeFormat().resolvedOptions().locale` in the
 *    real CLI). A tag whose primary subtag is `ko` gives `ko`.
 * 4. Otherwise `en`.
 */
export interface MessageLanguageInput {
  readonly env: string | null;
  readonly config: MessageLanguage | null;
  readonly osLocale: string | null;
}

/** Signature of `selectMessageLanguage`, exported by `src/i18n/index.ts`. Pure; reads nothing. */
export type SelectMessageLanguage = (input: MessageLanguageInput) => MessageLanguage;

/** N-20: which rule of MessageLanguageInput decided the language ("default": none did, so `en`). */
export const LANGUAGE_SOURCES = ["env", "config", "os", "default"] as const;
export type LanguageSource = (typeof LANGUAGE_SOURCES)[number];

/**
 * N-20: the language, where it came from, and whether CODARYN_LANG was set to something other
 * than `ko` or `en` and so ignored. Never carries the input values themselves.
 */
export interface MessageLanguageChoice {
  readonly language: MessageLanguage;
  readonly source: LanguageSource;
  readonly envIgnored: boolean;
}

/**
 * Signature of `explainMessageLanguage`, exported by `src/i18n/index.ts` (N-20). Same rules as
 * SelectMessageLanguage; `explainMessageLanguage(input).language === selectMessageLanguage(input)`.
 * `doctor` shows the result with `language.source.<source>` and `language.env_ignored`.
 */
export type ExplainMessageLanguage = (input: MessageLanguageInput) => MessageLanguageChoice;

declare const schemaFieldPathBrand: unique symbol;
declare const runIdBrand: unique symbol;
declare const catalogTextBrand: unique symbol;
declare const apiOriginBrand: unique symbol;
declare const shownWorkspaceBrand: unique symbol;

/** A field position made of schema field names and indices only. Obtain it from `toSchemaFieldPath`. */
export type SchemaFieldPath = string & { readonly [schemaFieldPathBrand]: "field" };
/** A run id that matches the run directory rule. Obtain it from `toRunId`. */
export type RunId = string & { readonly [runIdBrand]: "runId" };
/** Text a MessageCatalog produced. Only `MessageCatalog.format` makes it. */
export type CatalogText = string & { readonly [catalogTextBrand]: "catalog" };
/** DR-36 (b): where an API key is sent, as an origin only. Obtain it from `toApiOrigin`. */
export type ApiOrigin = string & { readonly [apiOriginBrand]: "apiOrigin" };

/**
 * DR-36 (b): the shape of an ApiOrigin: `https://` and a host of ASCII letters, digits, dots and
 * hyphens (an international name in its ASCII form) or a bracketed IPv6 address, or `http://` with a
 * loopback host (S-9); then an optional port. No user info, path, query or fragment.
 */
export const API_ORIGIN_PATTERN_SOURCE =
  "^(?:https://(?:[A-Za-z0-9.-]{1,253}|\\[[0-9A-Fa-f:.]{2,45}\\])|http://(?:localhost|127\\.0\\.0\\.1|\\[::1\\]))(?::[0-9]{1,5})?$";

/**
 * DR-36 (b): the origin of an API address for `doctor` (which provider's key goes where, DR-34 (a)):
 * the scheme, host and port the requests go to, nothing of the path. Null when the address does not
 * parse, carries user info, or its origin is not of API_ORIGIN_PATTERN_SOURCE. It is the person's own
 * setting (their environment or config file), shown back to them; never a key.
 */
/**
 * DR-51 (U-38): the workspace path a person typed with `--workspace`, in double quotes, fit to show
 * in a next-command hint of an end summary. Obtain it from `toShownWorkspace`.
 */
export type ShownWorkspace = string & { readonly [shownWorkspaceBrand]: "shownWorkspace" };

/** DR-51 (U-38): the longest typed workspace path a hint shows, in characters (code points). */
export const MAX_SHOWN_WORKSPACE_CHARS = 80;

/**
 * Review R-70 M-1 (PM): the characters a shown path may hold, an allow list, not characters refused
 * one by one (PowerShell also reads the curly quotes U+201C, U+201D and U+201E as double quotes,
 * which a deny list had missed). A letter, digit or combining mark of any script (\p{L}, \p{N},
 * \p{M}), the space U+0020, or one of `\ / : . _ - ( ) , + = @`. None of these ends, expands or
 * escapes a double-quoted string in PowerShell, cmd or a POSIX shell (a trailing backslash aside,
 * which toShownWorkspace refuses).
 */
const SHOWABLE_IN_QUOTES = /^[\p{L}\p{N}\p{M} \\/:._\-(),+=@]+$/u;
const PRIVACY_TOKEN_FRAGMENT = /codaryn_secret/i;

/**
 * DR-51 (U-38, PM): the hint form of a typed workspace path, or null, when the hint keeps saying
 * `<workspace>` as before. `masked` is the path after the command's own masking, the run's privacy
 * gateway (registered values and key shapes), for `run` and `apply`; null when masking failed.
 * `revert` knows no registered values, so its hint always says `<workspace>` (R-70 L-1, PM). Null
 * when:
 * - masking failed or changed the path (a registered value or a key shape was in it);
 * - it is empty or blank, or longer than MAX_SHOWN_WORKSPACE_CHARS;
 * - it holds a character outside SHOWABLE_IN_QUOTES (R-70 M-1), or ends with a backslash (which
 *   would escape the closing quote);
 * - it holds a key shape (API_KEY_MASK_PATTERN_SOURCES) or a privacy-token fragment, whoever masked.
 * Otherwise the path in double quotes, as typed: one form for every shell, nothing escaped.
 */
export function toShownWorkspace(typed: string, masked: string | null): ShownWorkspace | null {
  if (masked !== typed) return null;
  if (typed.trim().length === 0 || Array.from(typed).length > MAX_SHOWN_WORKSPACE_CHARS) return null;
  if (!SHOWABLE_IN_QUOTES.test(typed) || typed.endsWith("\\")) return null;
  if (PRIVACY_TOKEN_FRAGMENT.test(typed)) return null;
  if (API_KEY_MASK_PATTERN_SOURCES.some((source) => new RegExp(source).test(typed))) return null;
  return `"${typed}"` as ShownWorkspace;
}

/** DR-51 (U-38): whether a value is exactly what toShownWorkspace makes (the catalog's check, N-24). */
export function isShownWorkspace(value: unknown): value is ShownWorkspace {
  if (typeof value !== "string" || value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return false;
  const typed = value.slice(1, -1);
  return toShownWorkspace(typed, typed) === value;
}

export function toApiOrigin(address: string): ApiOrigin | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  return new RegExp(API_ORIGIN_PATTERN_SOURCE).test(url.origin) ? (url.origin as ApiOrigin) : null;
}

/**
 * Every field name of the task file, the config file and the scripted model file, plus the roots
 * `task`, `config` and `script`. A SchemaFieldPath uses only these names.
 */
export const SCHEMA_FIELD_NAMES = [
  "task",
  "config",
  "script",
  "schemaVersion",
  "id",
  "goal",
  "workflow",
  "workspaceRoot",
  "model",
  "provider",
  "scriptPath",
  "maxOutputTokens",
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
  "apiBaseUrl",
  "requestTimeoutMs",
  "maxRetries",
  "integrity",
  "paths",
  "language",
  "profiles",
  // SP-D3: the config's providers map (`provider` is listed above), and its keys (DR-36 (b):
  // `providers.openai.apiBaseUrl` is a field position). Every API_PROVIDER_NAMES entry.
  "providers",
  "anthropic",
  "openai",
  "steps",
  "toolCalls",
  "name",
  "stop",
  "usage",
  "delayMs",
  // N-24 (review R-3 R3-4): the scripted model's usage fields.
  "inputTokens",
  "outputTokens",
] as const;

const SCHEMA_FIELD_SEGMENT = /^(?:[A-Za-z]+|\[(?:0|[1-9][0-9]{0,5})\])/;

/**
 * N-14: the position as a SchemaFieldPath, or null. Accepted: a known field name, followed by
 * `.name` and `[index]` parts, where every name is in SCHEMA_FIELD_NAMES and every index is a
 * plain decimal integer. A profile is addressed by its index (`profiles[3]`), never its name, and
 * an unknown key is addressed by the object that holds it, never by its own name.
 */
export function toSchemaFieldPath(text: string): SchemaFieldPath | null {
  if (text.length === 0 || text.length > 200) return null;
  let rest = text;
  let first = true;
  while (rest.length > 0) {
    if (!first && rest.startsWith(".")) rest = rest.slice(1);
    else if (!first && !rest.startsWith("[")) return null;
    const match = SCHEMA_FIELD_SEGMENT.exec(rest);
    if (match === null) return null;
    const segment = match[0];
    if (!segment.startsWith("[") && !(SCHEMA_FIELD_NAMES as readonly string[]).includes(segment)) return null;
    if (first && segment.startsWith("[")) return null;
    rest = rest.slice(segment.length);
    first = false;
  }
  return text as SchemaFieldPath;
}

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** N-14, N-16: the text as a RunId when it follows the run directory rule (no `..`), else null. */
export function toRunId(text: string): RunId | null {
  return RUN_ID.test(text) && !text.includes("..") ? (text as RunId) : null;
}

/** The commands `codaryn init` may offer from package.json scripts (N-2), as shown. */
export const INIT_SUGGESTED_COMMANDS = ["npm test", "npm run build", "npm run lint", "npm run typecheck"] as const;
export type InitSuggestedCommand = (typeof INIT_SUGGESTED_COMMANDS)[number];
/** The workspace entries `codaryn init` may offer as protected paths (N-2). */
export const INIT_SUGGESTED_PROTECTED_PATHS = ["tests", "test", "package.json", "package-lock.json", "tsconfig.json"] as const;
export type InitSuggestedProtectedPath = (typeof INIT_SUGGESTED_PROTECTED_PATHS)[number];

/** How a config location is shown: a fixed default location form, or the option that named it. */
export type ConfigLocationDisplay = DefaultConfigDisplay | "--config" | "CODARYN_CONFIG";

/**
 * N-20: the default answer of each `init` question (UX design section 7). A question that would
 * widen what a run may do defaults to "no" (nothing changes when Enter is pressed); creating the
 * file the user asked for and protecting a path default to "yes". The prompt shows the matching
 * `prompt.yes_no_default_yes` or `prompt.yes_no_default_no`. Input that is not a clear yes or
 * no gives the default; end of input gives "no".
 */
export const INIT_QUESTION_DEFAULTS = {
  confirm_create: "yes",
  commands_suggest: "no",
  protected_suggest: "yes",
} as const;

/**
 * N-21: commands with a help text. U-35 (UXM-7): plan, apply, review, changes and cleanup join, so
 * their help says what they do, their options and their exit codes in the chosen language, as the
 * others do (they were a usage line and one fixed English sentence before).
 */
export const HELP_COMMANDS = ["run", "revert", "report", "doctor", "models", "init", "runs", "plan", "apply", "review", "changes", "cleanup"] as const;
export type HelpCommand = (typeof HELP_COMMANDS)[number];

/** N-21: options described in the help texts (`--dry-run` is `dry_run`). */
export const HELP_OPTIONS = [
  "task",
  "workspace",
  "goal",
  "config",
  "vars_file",
  "cancel_file",
  "quiet",
  "profile",
  "run",
  "dry_run",
  "json",
  "use",
  "limit",
  // SP-6 (DR-31): `--provider <name>` of `codaryn models`.
  "provider",
  // DR-21, DR-25: `--allow-unsafe-move` of `apply` and `revert` (UNSAFE_MOVE_CONSENT_ARGUMENT).
  "allow_unsafe_move",
  // U-35 (UXM-7): the options of plan, apply, review, changes and cleanup that no help described.
  // The others they take (`--task`, `--workspace`, `--profile`, `--config`, `--vars-file`,
  // `--run`, `--json`, `--cancel-file`, `--quiet`, `--allow-unsafe-move`) keep their ids.
  // `apply --digest <first 12+ hex>`: the digest the person approved (MIN_PLAN_DIGEST_PREFIX).
  "digest",
  // `apply --run <runId>`: the plan run whose plan is applied. Not `run`, whose text offers
  // `latest`: apply never takes it.
  "plan_run",
  // `review --accept`, `review --reject` (one of the two), `review --note <text>`.
  "accept",
  "reject",
  "note",
  // cleanup's selection (DR-39, DR-44): `--older-than <days>`, `--run <id>[,<id>...]` (run ids
  // only, never `latest`: not `run`), `--reverted`, `--discarded-older-than <days>`,
  // `--discarded-run <id>[,<id>...]`.
  "older_than",
  "run_ids",
  "reverted",
  "discarded_older_than",
  "discarded_run",
  // cleanup's confirmations: `--confirm <first 12+ hex of the digest>`, and besides it
  // `--include-not-reverted` and `--delete-discarded`, which each ask for their own consent.
  "confirm",
  "include_not_reverted",
  "delete_discarded",
  // U-53 (review R-64 L1, I1 to I3; R-58 L2):
  // `--workflow <id>` of run, plan, apply and review (the task type of the quick form; a task file
  // names its own with workflowRef; changes takes none).
  "workflow",
  // `--json` of run, revert and apply: the result's JSON line on stdout at a terminal too (stdout and
  // stderr both); through a pipe or into a file, or with stderr redirected, it is printed without it.
  // `json` stays for the commands whose `--json` prints JSON in place of text.
  "json_line",
  // `--task <file>` of plan, apply, review and changes: the task file the run was made with, whose
  // settings, checks and secrets are read; nothing is run. `task` stays for run and doctor.
  "run_task",
  // `--workspace <dir>` of the reading commands report, runs, plan and changes: left out (with no
  // `--task`), the current directory (U-17). `workspace` stays for the commands that need it.
  "workspace_or_current",
] as const;
export type HelpOption = (typeof HELP_OPTIONS)[number];

/**
 * N-22: the error codes after which the human-readable error adds `error.doctor_hint`
 * ("check: codaryn doctor"): the ones `doctor` can explain further.
 */
export const DOCTOR_HINT_ERROR_CODES = [
  "invalid_config",
  "invalid_task",
  "key_in_file",
  "secret_env_missing",
  "workspace_is_install_dir",
  "provider_not_configured",
  "model_list_failed",
] as const satisfies readonly CliErrorCode[];

/**
 * The kinds of parameters and the type each one has:
 * - count: number (non-negative integer: counts, turns, attempts, line, column, durations, and a
 *   command's exit code, U-18)
 * - status, reason, permission, denial, modelError, phase, provider: closed code unions
 * - field: SchemaFieldPath. runId: RunId. text: CatalogText (another message of the same catalog)
 * - location: ConfigLocationDisplay
 * - suggestedCommand, suggestedPath: the fixed init suggestion lists
 * - seconds (N-20): a non-negative number of seconds with at most one decimal place (the
 *   renderer rounds milliseconds to tenths); the catalog writes it in decimal digits
 * - language (N-20): a MessageLanguage code
 * - keyEnv (SP-D12, DR-31): the name of an API key variable, one of API_KEY_ENVS (a fixed constant,
 *   never key material); the catalog writes it as it is
 * - settingEnv (DR-36 (b)): the name of a provider's model or address variable, one of
 *   API_MODEL_ENVS or API_BASE_URL_ENVS (a fixed constant, never its value); written as it is
 * - apiOrigin (DR-36 (b)): ApiOrigin, where a provider's requests (and its key) go; written as it is
 * - workspace (DR-51, U-38): ShownWorkspace, the typed workspace path in double quotes; written as
 *   it is
 */
export interface MessageParamTypeByKind {
  readonly count: number;
  readonly status: TerminalRunStatus;
  readonly reason: RunReason;
  readonly permission: PermissionKind;
  readonly denial: PolicyDenialCode | ToolErrorCode;
  readonly modelError: ModelErrorKind;
  readonly phase: IntegrityPhase;
  readonly provider: ModelProviderName;
  readonly field: SchemaFieldPath;
  readonly runId: RunId;
  readonly text: CatalogText;
  readonly location: ConfigLocationDisplay;
  readonly suggestedCommand: InitSuggestedCommand;
  readonly suggestedPath: InitSuggestedProtectedPath;
  readonly seconds: number;
  readonly language: MessageLanguage;
  readonly keyEnv: ApiKeyEnv;
  readonly settingEnv: ApiModelEnv | ApiBaseUrlEnv;
  readonly apiOrigin: ApiOrigin;
  readonly workspace: ShownWorkspace;
}
export type MessageParamKind = keyof MessageParamTypeByKind;

/**
 * Fixed messages and the parameters each one takes (name → kind). A template refers to a
 * parameter as `{name}`; it must use every listed parameter and no other. Words only: the layout
 * (prefixes, separators, line breaks, the code in parentheses) belongs to the renderer.
 * Commands shown in messages are fixed text in the template (for example
 * `codaryn report --workspace <workspace> --run {runId}`); no message takes a typed path, except
 * the `*_typed` hints below (DR-51), whose `{workspace}` is a ShownWorkspace.
 */
export const FIXED_MESSAGES = {
  // Errors (N-5): "<error.label> — <what> (<code>)", the diagnostic line (N-15), the fix line.
  "error.label": {},
  "error.fix_label": {},
  "error.doctor_hint": {},
  // U-37: the hints whose line takes a value (DETAILED_CLI_ERROR_HINTS, from CliErrorOutput's
  // CLI_ERROR_HINT_DETAIL); the others are listed (`error.hint.<hint>`). unknown_option names the
  // argument by its position only (DR-57). provider_settings_missing is followed by one item line
  // per setting not set, `error.missing.*`:
  // the key variable; the model (none left, or only a placeholder), with the provider's model
  // variable and the config's field; the output limit, with the config's field.
  "error.hint.unknown_option": { position: "count" },
  "error.hint.key_field_in_task": { field: "field" },
  "error.hint.key_field_in_config": { field: "field" },
  "error.hint.provider_settings_missing": {},
  "error.missing.key": { keyEnv: "keyEnv" },
  "error.missing.model": { variable: "settingEnv", field: "field" },
  "error.missing.model_placeholder": { variable: "settingEnv", field: "field" },
  "error.missing.output_limit": { field: "field" },

  // Input diagnostics (N-15). The file is named by `diagnostic.file.<file>`.
  "diagnostic.json_syntax": { line: "count", column: "count" },
  "diagnostic.unknown_field": { field: "field" },
  "diagnostic.unknown_field_suggest": { field: "field", suggestion: "field" },
  "diagnostic.invalid_value": { field: "field" },
  "diagnostic.missing_field": { field: "field" },
  "diagnostic.too_deep": {},

  // End-of-run summary (N-5, N-17).
  "summary.result": { status: "text", reason: "text" },
  "summary.verifiers": { passed: "count", total: "count" },
  "summary.no_verifiers": {},
  // U-104 (U-99b: UXM-18, AXM-20; PM): after the verifiers line of a run's or an apply's summary, when
  // its protected material was checked and no check found a change: how many checks there were. The
  // progress lines show the first check that found nothing and fold the later ones; a check that
  // found a change is always its own line. The count is the renderer's, of the records it drew.
  "summary.integrity_unchanged": { count: "count" },
  "summary.changes": { count: "count" },
  "summary.denied": { count: "count" },
  // U-18 (AXM-4): RunSummaryContext.failedToolCalls when above 0, right after summary.denied (its
  // hint lines come after both).
  "summary.failed": { count: "count" },
  "summary.denied_hint": {},
  // N-23: the same hint for a task file run, whose policy is the task's own.
  "summary.denied_hint_task": {},
  // U-110 (review R-85 M1): RunSummaryContext.confirmationDenied, in place of the add-a-rule hint for
  // those calls (the rule is there; it asks before running): `{count}` calls denied by the person
  // (`user`), with no answer where this run could not ask (`unasked`: standard input or stderr not a
  // terminal, or --quiet) or where the question went unanswered (`unanswered`: the input ended, or
  // the time limit ended the wait), or because the run was cancelled while it waited (`cancelled`).
  "summary.confirm_denied.user": { count: "count" },
  "summary.confirm_denied.unasked": { count: "count" },
  "summary.confirm_denied.unanswered": { count: "count" },
  "summary.confirm_denied.cancelled": { count: "count" },
  "summary.usage": { turns: "count", toolCalls: "count", seconds: "seconds" },
  "summary.run_id": { runId: "runId" },
  // DR-52 (AXM-17): EngineResult.masking, counts only: `{registered}` values registered for masking,
  // `{masked}` places masked in what was sent to the model. Shown when the result has it.
  "summary.masking": { registered: "count", masked: "count" },
  "summary.next_report": { runId: "runId" },
  "summary.next_report_here": { runId: "runId" },
  "summary.next_revert": { runId: "runId" },
  "summary.next_revert_here": { runId: "runId" },
  // DR-51 (U-38): the same hints with the workspace path the person typed (`{workspace}`, a
  // ShownWorkspace, in place of `<workspace>`), when the summary's context has `workspaceShown`.
  // Without it, the hints above, as before. End summaries only (run and apply; revert passes none,
  // R-70 L-1): not the report, the plan view, cleanup, runs or the errors.
  "summary.next_report_typed": { runId: "runId", workspace: "workspace" },
  "summary.next_revert_typed": { runId: "runId", workspace: "workspace" },
  "summary.config_default": { location: "location" },
  "summary.profile_applied": {},
  // DR-47 (AXM-1): the agent's last message (EngineResult.finalMessage), shown as an item after this
  // label, which says it is the agent's own words and not a verified fact; the second line follows
  // it when the text was cut (`{count}`: MAX_FINAL_MESSAGE_CHARS). The report's section starts with
  // `report.final_message`, which says the same.
  "summary.final_message": {},
  "summary.final_message_truncated": { count: "count" },
  // G-A: plan runs, human review and apply runs. `{form}` is one of `summary.form.*`, chosen by
  // the context's workspaceForm, so a hint repeats the task form the user typed without its value.
  "summary.form.task": {},
  "summary.form.given": {},
  "summary.form.current": {},
  // DR-51 (U-38): `summary.form.given` with the typed workspace, when the context has `workspaceShown`.
  "summary.form.typed": { workspace: "workspace" },
  "summary.plan_ready": { actions: "count" },
  "summary.next_plan": { form: "text", runId: "runId" },
  "summary.next_apply": { form: "text", runId: "runId" },
  "summary.review_checklist": { count: "count" },
  "summary.next_review": { form: "text", runId: "runId" },
  "summary.apply_actions": { applied: "count", total: "count" },
  "summary.apply_plan_run": { runId: "runId" },
  // U-14 (UXM-6, AXM-2, AXM-15): lines of the plan view (`codaryn plan`, the approval screen).
  // records_changed: first, when PlanOutput.recordsChanged (the records were changed outside the run,
  // so this plan may not be the one the run made); cannot_apply: in place of the command to apply it
  // (make the plan again with a new run); summary_label: before the model's summary, shown as an
  // item (the agent's description, not what is approved); digest_guarantee: last (the digest names
  // exactly these actions and the files' contents when the plan was made; apply refuses if the plan,
  // a file or the run's records changed since).
  "plan.records_changed": {},
  "plan.cannot_apply": {},
  "plan.summary_label": {},
  "plan.digest_guarantee": {},
  // U-36 (UXM-7 ③ ④): the rest of `codaryn plan`'s text, which apply's terminal question shows too,
  // apply's two questions, and review's lines.
  // - plan.heading: `{status}` is `plan.status.<status>`. Then plan.digest_label, after which the
  //   renderer puts the digest (PlanOutput.digest, an item as G-A allows).
  // - Each action: `plan.action.<kind>` and its masked paths; a discard ends with plan.discard_kept
  //   (it stays in the discarded-files folder until removed).
  // - plan.inventory_limit when PlanOutput.inventoryLimitReached (an apply would stop as plan_stale).
  // - plan.applied_by ({runId}: the apply run) when the plan was applied. UXM-23: the renderer puts
  //   the apply's time (PlanOutput.appliedBy.at) after it in local wall time, as `runs` shows times;
  //   a time that is not a run timestamp is left out (N-24 (c)). No message takes a time.
  // - plan.next_apply ({runId}: the plan run) while pending and not marked: the command up to
  //   `--digest`, with `<the same task form>` as words; the renderer puts the digest's first
  //   MIN_PLAN_DIGEST_PREFIX characters after it, one space apart (G-A: no message takes a digest).
  // - apply.question before the answer; apply.unsafe_move_question after an apply stopped as
  //   consent_required at a terminal: {count} moves can only be made without the guarantee that
  //   nothing at the destination is replaced, nothing was moved, make them for this apply only
  //   (DR-21). The renderer adds `prompt.yes_no_default_no` after each.
  // - review.recorded, or review.recorded_replaced when an earlier review was replaced
  //   (ReviewOutput.replaced): `{verdict}` is `review.verdict.<verdict>`. The checklist follows as
  //   items, then review.unchanged (the run's result and records are unchanged; `codaryn report`
  //   shows the verdict).
  "plan.heading": { runId: "runId", count: "count", status: "text" },
  "plan.digest_label": {},
  "plan.discard_kept": {},
  "plan.inventory_limit": {},
  "plan.applied_by": { runId: "runId" },
  "plan.next_apply": { runId: "runId" },
  "apply.question": {},
  "apply.unsafe_move_question": { count: "count" },
  "review.recorded": { runId: "runId", verdict: "text" },
  "review.recorded_replaced": { runId: "runId", verdict: "text" },
  "review.unchanged": {},
  // DR-21: an apply that ended as consent_required: how many moves are unsafe, and the command that
  // gives consent for one apply (UNSAFE_MOVE_CONSENT_ARGUMENT is fixed text in the template).
  "summary.unsafe_moves": { count: "count" },
  "summary.next_apply_unsafe": { form: "text", runId: "runId" },

  // Progress lines (N-5, R-11): words first, the internal code in parentheses after them.
  "progress.run_started": { provider: "provider" },
  "progress.config_default": { location: "location" },
  "progress.turn": { turn: "count" },
  "progress.model_error": { turn: "count", kind: "modelError" },
  "progress.tool_allowed": { tool: "text" },
  "progress.tool_denied": { tool: "text", permission: "permission", code: "denial" },
  // N-22: a call stopped by a check before the policy (validate or restore stage), with no permission.
  "progress.tool_rejected": { tool: "text", code: "denial" },
  // U-18 (AXM-4, PM Q-1 (a), Q-2 (a)): what became of an allowed call (the failed-call rule at
  // RunSummaryContext.failedToolCalls). A result that succeeded has no line.
  // - progress.tool_failed: a failed call, `{code}` its ToolResult.errorCode (a tool error code, which
  //   the `denial` kind takes, as for progress.tool_rejected).
  // - progress.command_exited, progress.command_timed_out: a `run_command` result with `ok: true`
  //   whose content (the masked JSON of RunCommandPayload) has `timedOut: true`, or else an
  //   `exitCode` that is an integer other than 0. Not failed calls. Content that does not parse, or
  //   a null exit code without a timeout (a stopped command), gives no line.
  "progress.tool_failed": { tool: "text", code: "denial" },
  "progress.command_exited": { exitCode: "count" },
  "progress.command_timed_out": {},
  "progress.file_created": {},
  "progress.file_changed": {},
  "progress.verifier": { number: "count", outcome: "text" },
  "progress.repair": { attempt: "count", count: "count" },
  "progress.integrity_unchanged": { phase: "phase" },
  "progress.integrity_changed": { phase: "phase", count: "count" },
  "progress.finished": { status: "text", reason: "reason" },
  "progress.model_not_found": {},
  "progress.unknown_tool": {},
  // G-A: an apply run's records (ApplyJournalEvent). `{approval}` is `approval.<channel>`,
  // `{problem}` is `plan.problem.<problem>`; an action is shown by its number (index + 1).
  "progress.apply_started": { actions: "count", approval: "text" },
  // `{count}` is the number of problems the preflight found: the entries of `plan_checked.problems`
  // (unsafe moves and the inventory limit are not counted; they have their own lines). 0 means every
  // action can be applied. It is not the number of actions (that is `progress.apply_started`).
  "progress.plan_checked": { count: "count" },
  // DR-21: `{count}` moves could only be made unsafely (`plan_checked.unsafeMoves`), and the
  // consent line when `apply_started.unsafeMoveConsent` is set (`{approval}` is `approval.<channel>`).
  "progress.unsafe_moves": { count: "count" },
  "progress.unsafe_move_consent": { approval: "text" },
  "progress.plan_item_problem": { number: "count", problem: "text" },
  "progress.inventory_limit": {},
  "progress.file_moved": { number: "count" },
  "progress.file_discarded": { number: "count" },
  "progress.plan_item_failed": { number: "count", problem: "text" },
  "outcome.pass": {},
  "outcome.fail": {},
  "outcome.inconclusive": {},

  // `--run latest` (N-23): which run was chosen, before anything is done. The start time follows
  // as an item in local time, from the checked `startedAt`.
  "latest.chosen": { runId: "runId" },

  // Revert (N-7).
  "revert.dry_run_title": { count: "count" },
  "revert.done_title": { count: "count" },
  "revert.skipped_title": { count: "count" },
  "revert.action.restored": {},
  "revert.action.deleted": {},
  // G-A: one per RevertAction of an apply run.
  "revert.action.moved_back": {},
  "revert.action.restored_from_discard": {},
  "revert.dry_run_next": {},
  "revert.reverted_before": {},
  // DR-25: `{count}` files were moved back unsafely, with the person's consent (RevertedFile.unsafe).
  // Shown after the reverted list when the count is above 0 (never in a dry run).
  "revert.unsafe_moved": { count: "count" },
  // DR-25: a dry run did not check whether this drive can move the listed files back safely; the
  // real revert checks it and, without consent, skips the ones it cannot (RevertOutput.moveSafetyUnchecked).
  "revert.dry_run_move_unchecked": {},
  // R-16 L-1: `{count}` files the revert moved aside could not be put back and were left in
  // `.codaryn/parked/` (fixed text; SkippedFile.parkedAt). Shown after the skipped list when above 0.
  "revert.parked": { count: "count" },
  // DR-39 (cleanup.ts): the preview, the two confirmations (run records; then people's discarded
  // files), and the outcome. Sizes are byte counts. Parked files are never cleaned.
  // `cleanup.nothing`: a selection that matched nothing (U-86: with nothing selected,
  // cleanup.no_selection instead).
  "cleanup.summary.runs": { count: "count", bytes: "count" },
  "cleanup.summary.discarded": { files: "count", bytes: "count" },
  "cleanup.summary.parked": { files: "count", bytes: "count" },
  "cleanup.nothing": {},
  "cleanup.done": { runs: "count", folders: "count", bytes: "count" },
  // DR-44 (d): folders an earlier cleanup moved aside and could not remove entirely (StateSummary.
  // leftovers, CleanupPlan.totals.leftovers, the removed ones): the summary line (when above 0) and
  // the outcome's line. In a plan they are always in the --confirm alone group (U-86).
  "cleanup.summary.leftovers": { count: "count", bytes: "count" },
  "cleanup.done_leftovers": { count: "count", bytes: "count" },
  // U-13 (UXM-1): after cleanup.done when above 0: how many apply runs' records were kept because
  // their discarded files stay (CleanupOutcome.kept with reason discarded_left); they go once those
  // applies are reverted or their discarded files are deleted too.
  "cleanup.done_discarded_left": { count: "count" },
  // R-34b P-2: folders in the state directory named like a leftover but without a cleanup's mark
  // (StateSummary.unknownFolders): shown when there are any; Codaryn does not remove them.
  "cleanup.summary.unknown_folders": { count: "count", bytes: "count" },
  // U-34 (UXM-7, AXM-22): the lines that were fixed English.
  // - cleanup.size: an item's size after its name in a plan (CleanupItem.size).
  // - cleanup.nothing_removed: first line of a confirmed cleanup that removed nothing
  //   (CleanupStatus nothing_removed); what was kept follows, as after cleanup.done.
  "cleanup.size": { files: "count", bytes: "count" },
  "cleanup.nothing_removed": {},
  // U-86 (UXM-10, the rest of UXM-1; PM, plan B): the preview, grouped by what a person must give
  // for an item to go (CleanupPlan's CLEANUP_ITEM_FATES). The output after a confirmation and
  // `cleanup --json` do not change. It retires cleanup.confirm.runs, .discarded, .not_reverted and
  // .leftovers and the six cleanup.next.* (U-34).
  // - cleanup.summary.discarded_without_records: after cleanup.summary.discarded when above 0:
  //   discarded-files folders whose run has no records left (StateSummary's
  //   STATE_DISCARDED_WITHOUT_RECORDS); no revert can put those files back.
  // - The groups, in this order, each shown only when it has items: cleanup.group.confirm
  //   (removed with --confirm alone; leftovers among them), cleanup.group.include_not_reverted
  //   (only with --include-not-reverted besides), cleanup.group.delete_discarded (only with
  //   --delete-discarded besides), cleanup.group.both (R-76 M-1: only with both flags besides: an
  //   apply run not reverted whose discarded files go with it, its plan run), cleanup.group.kept (no
  //   confirmation removes them in this selection), and last cleanup.group.blocked (R-76 L-1: the
  //   plan's `blocked`, which cannot be removed in this cleanup, each with its
  //   `cleanup.blocked.<code>`). Each group's `{count}` is the number of its items, so with a
  //   confirmation the items that go are the confirm group's and those of each group whose flags it
  //   gives (cleanup.group.both only with both).
  //   PM: not one word weaker than before. cleanup.group.include_not_reverted says at least what
  //   cleanup.confirm.not_reverted said (once their records are removed, those runs can no longer be
  //   reverted or put back by hand); cleanup.group.delete_discarded what cleanup.confirm.discarded
  //   said (they are people's own files and cannot be put back); cleanup.group.both both of them.
  //   `{count}` items, `{files}` and `{bytes}` their sizes.
  // - Under each item (its name and cleanup.size, as before): one line per warning,
  //   `cleanup.warning.<code>`, in place of the "; " list; a kept item's `cleanup.kept.<keptFor>`.
  // - Then the commands (G-A: the renderer puts the options after the text on one line, one space
  //   apart): cleanup.command.confirm when the --confirm alone group has items
  //   (`--confirm <digest prefix>`), cleanup.command.all when an item needs a flag
  //   (`--confirm <digest prefix>` and every flag some item needs, in CLEANUP_CONFIRM_FLAGS order).
  //   Each says nothing was removed and leads into them.
  // - cleanup.no_selection, with nothing selected (no selection option given): then the two example
  //   commands cleanup.example.older_than and cleanup.example.reverted, fixed text with
  //   `<workspace>`. Leftovers still show their group above it.
  "cleanup.summary.discarded_without_records": { count: "count", bytes: "count" },
  "cleanup.group.confirm": { count: "count", bytes: "count" },
  "cleanup.group.include_not_reverted": { count: "count", bytes: "count" },
  "cleanup.group.delete_discarded": { count: "count", files: "count", bytes: "count" },
  "cleanup.group.both": { count: "count", files: "count", bytes: "count" },
  "cleanup.group.kept": { count: "count" },
  "cleanup.group.blocked": { count: "count" },
  "cleanup.command.confirm": {},
  "cleanup.command.all": {},
  "cleanup.no_selection": {},
  "cleanup.example.older_than": {},
  "cleanup.example.reverted": {},
  // DR-25: some files were skipped as `unsafe_move`: the command that reverts again with consent
  // (UNSAFE_MOVE_CONSENT_ARGUMENT is fixed text in the template).
  "summary.next_revert_unsafe": { runId: "runId" },
  // DR-51 (U-38): the same with a typed workspace (RevertSummaryContext). R-70 L-1 (PM): revert
  // knows no registered values and passes none, so its hint says `<workspace>`; the id stays unused.
  "summary.next_revert_unsafe_typed": { runId: "runId", workspace: "workspace" },

  // `codaryn runs` (N-7, N-16).
  "runs.column.run_id": {},
  "runs.column.started": {},
  // U-139 (UXM-23, PM): the runs table's started column header, which says the time is local (the run
  // id header says UTC). runs.column.started stays the word of latestChosen's "(started <time>)".
  "runs.column.started_local": {},
  "runs.column.status": {},
  "runs.column.changes": {},
  "runs.empty": {},
  "runs.incomplete": {},
  "runs.damaged": {},
  "runs.reverted": {},
  // N-23 (g): the run's own records are fine, only its revert record failed the checks.
  "runs.revert_record_damaged": {},
  // DR-38: a run whose records were changed by something other than the run (state.ts).
  "runs.records_changed": {},
  // U-157 (UXM-18, PM): under the runs table, once, when a listed run has a records-changed mark: what
  // the short mark at the end of its result column (runs.records_changed) means, so that row stays short.
  "runs.records_changed_note": {},
  // U-16 (UXM-5): a plan run whose plan was applied (RunListEntry.appliedBy), in place of the
  // needs-input words: applied by `{runId}`.
  "runs.plan_applied": { runId: "runId" },
  // R-55 M-1: the plan run's line by its apply run (planApplyStateOf): not finished (with the apply
  // run's reason), still applying, applied and reverted since, the apply run's records gone.
  "runs.plan_apply_unfinished": { runId: "runId", reason: "reason" },
  "runs.plan_applying": { runId: "runId" },
  "runs.plan_apply_reverted": { runId: "runId" },
  "runs.plan_apply_missing": { runId: "runId" },
  // U-129 (1), PM: an apply run's changes cell (RunListEntry.changes, its applied actions) says they
  // are actions, not files: `runs.apply_action_one` when there is one, else `runs.apply_actions`
  // (English "1 action", "{count} actions"; Korean "동작 {count}"). The JSON keeps the number.
  "runs.apply_actions": { count: "count" },
  "runs.apply_action_one": {},
  // U-129 (2), AXM-21: added to the result column of a run with RunListEntry.review: `{verdict}` is
  // `review.verdict.<verdict>`, as review.recorded writes it.
  "runs.review": { verdict: "text" },
  // U-139 (UXM-5, PM; a draft for p4g-general and nb-i18n): added to an apply run's result column
  // right after its status words: the plan run it applied (RunListEntry.planRunId), so the row says
  // which plan it is the apply of, as the plan run's row names its apply run (runs.plan_applied).
  "runs.apply_of": { runId: "runId" },
  "report.records_changed": {},
  "report.final_message": {},
  "changes.records_changed": {},
  // U-16 (UXM-4): `changes` of an apply run (ChangesApplyRun) in place of "no file changed": it
  // applied the plan of run `{runId}`, `{count}` actions, which its report lists.
  "changes.apply_run": { count: "count", runId: "runId" },
  // U-36 (UXM-7 ③): the rest of `codaryn changes`'s text.
  // - changes.heading ({runId}): masked with the secrets registered now, not the run's own masking.
  // - changes.no_text_note once when a file has no text for masking_unverified (DR-29).
  // - changes.none when the run changed no file (an apply run has changes.apply_run instead).
  // - Each file: its masked path, changes.file.created or changes.file.changed, and
  //   `changes.state.<state>`. Then `changes.unavailable.<reason>` (the renderer adds the code in
  //   parentheses), or the changed region, or changes.no_difference. A side cut after its first
  //   lines ends with changes.more_lines ({count}: the lines not shown).
  "changes.heading": { runId: "runId" },
  "changes.no_text_note": {},
  "changes.none": {},
  // U-131 (N4, UXM-4, 5): a plan run (plan_pending) in place of changes.none: changes.plan_only, then
  // what became of its plan by the run list's rule (planApplyStateOf): changes.plan_applied when the
  // apply run is done, changes.plan_apply_other otherwise (`{runId}`: that apply run). Text only.
  "changes.plan_only": {},
  "changes.plan_applied": { runId: "runId" },
  "changes.plan_apply_other": { runId: "runId" },
  "changes.file.created": {},
  "changes.file.changed": {},
  "changes.no_difference": {},
  "changes.more_lines": { count: "count" },
  "revert.records_changed": {},
  // U-16, R-55 L-1: `revert` of a plan run: it only made a plan and changed no file (nothing put
  // back, not marked as reverted); then by its apply run (PLAN_APPLY_STATES_TO_REVERT): revert that
  // run to undo its changes, or it is still applying, was reverted already, or its records are gone.
  "revert.plan_only": {},
  "revert.plan_revert_apply": { runId: "runId" },
  "revert.plan_applying": { runId: "runId" },
  "revert.plan_apply_reverted": { runId: "runId" },
  "revert.plan_apply_missing": { runId: "runId" },
  // DR-38: progress lines of the state checks: `{count}` paths changed (the run stops), and a part
  // of the state directory that was too large to check (the run goes on).
  "progress.state_changed": { count: "count" },
  "progress.state_unchecked": {},
  // U-74 (DR-3): the in-run permission question (ConfirmRequest). The question: `{count}` is
  // ConfirmRequest.argumentCount; the renderer puts the masked executable (`subject`) after it as an
  // item and then `prompt.yes_no_default_no` (Enter, end of input or no terminal: no). Then one
  // progress line: allowed for this call once, or `progress.confirmation_denied.<by>`.
  "confirm.question.command": { count: "count" },
  "progress.confirmation_allowed": {},
  // DR-41: lines at the run's start from run_started.policyNarrowings. Counts only. U-140 (UXM-18):
  // the end summary repeats them with the same texts (RunSummaryContext.policyNarrowings).
  "progress.workflow_policy.commands_dropped": { count: "count" },
  "progress.workflow_policy.commands_narrowed": { count: "count" },
  "progress.workflow_policy.plan_actions_dropped": { count: "count" },
  "progress.workflow_policy.restore_path_tokens_off": {},
  "progress.workflow_policy.verifiers_dropped": { count: "count" },
  "runs.omitted": { count: "count" },

  // U-156 (nb-i18n's E group, U-154's table): `codaryn models`' text. The renderer adds the marks and
  // the values the texts end before (G-A): `: `, `* `, the model id and name (outside values, never in
  // a text). `{variable}` is the provider's model variable, `{field}` where --use writes (`model` or
  // `providers.openai.model`). The table's `  #` column head is not a word and stays as it is. The
  // English is the text before U-156, character for character (SP-0 pins it).
  "models.table.id": {},
  "models.table.name": {},
  "models.table.input_tokens": {},
  "models.table.output_tokens": {},
  "models.none_listed": {},
  "models.listed": { count: "count" },
  "models.no_current": { variable: "settingEnv" },
  "models.current_from_config": {},
  "models.current_from_env": { variable: "settingEnv" },
  "models.not_listed": {},
  "models.written_label": {},
  "models.written_place": { field: "field" },
  "models.written_place_created": { field: "field" },
  "models.overridden": { variable: "settingEnv", field: "field" },
  "models.use_prompt": { field: "field" },

  // `codaryn init` (N-2). Questions go to stderr; the final text (src/cli/init.ts) to stdout.
  "init.location": { location: "location" },
  "init.confirm_create": {},
  "init.declined": {},
  "init.not_terminal": {},
  // U-26: after init.confirm_create, the provider question. `{provider}` is INIT_DEFAULT_PROVIDER,
  // which Enter gives; the CLI lists API_PROVIDER_NAMES numbered above it (names are codes, shown as
  // they are, as the model list). Then init.provider_chosen says which one the file is written for,
  // so an unknown answer that fell back to the default is seen before the model question.
  "init.provider_pick": { provider: "provider" },
  "init.provider_chosen": { provider: "provider" },
  "init.model_no_key": {},
  "init.model_pick": {},
  "init.model_list_failed": { kind: "modelError" },
  "init.model_placeholder": {},
  "init.limits_default": { turns: "count", toolCalls: "count", tokens: "count", minutes: "count" },
  "init.commands_suggest": { command: "suggestedCommand" },
  "init.protected_suggest": { path: "suggestedPath" },
  "init.language_pick": {},
  // SP-D12: `{keyEnv}` is the chosen provider's key variable (API_KEY_ENVS).
  "init.key_set": { keyEnv: "keyEnv" },
  "init.key_missing": { keyEnv: "keyEnv" },
  "init.key_hint_windows": { keyEnv: "keyEnv" },
  "init.key_hint_posix": { keyEnv: "keyEnv" },
  "init.saved": { location: "location" },
  "init.next": {},
  "init.overridden_by_env": {},

  // Yes/no prompts (N-20): the hint shows the default answer, as INIT_QUESTION_DEFAULTS says.
  "prompt.yes_no_default_yes": {},
  "prompt.yes_no_default_no": {},
  // U-110 (review R-88 M2): Ctrl+C at a question of apply, revert, models or init: the command stops
  // there (exit code 5) without changing anything more. A run's question is cancelled as the run.
  "prompt.interrupted": {},

  // Language (N-20): where it came from is `language.source.<source>`.
  "language.chosen": { language: "language", source: "text" },
  "language.env_ignored": {},

  // Help (N-21): one line each; usage lines stay English and are printed by the CLI.
  "help.intro": {},
  "help.commands_heading": {},
  "help.output": {},
  "help.key": {},
  "help.contract": {},
  "help.options_heading": {},
  "help.exit_heading": {},
  // U-115 (UXM-9): the short help at a terminal (`codaryn`, `codaryn --help`): help.intro, then
  // help.first_steps and first_use.try_without_key, help.commands_heading with one help.summary.<command>
  // per command in the first-use order, then help.more, help.key, help.output, help.contract. Not
  // at a terminal the full help is as before. U-132 (review R-91 L-2): each line within 100 columns:
  // help.first_steps is the heading and help.first_steps_commands the commands on the next line
  // (indented two); help.version follows help.more on its own line.
  "help.first_steps": {},
  "help.first_steps_commands": {},
  "help.more": {},
  "help.version": {},
  "help.summary.init": {},
  "help.summary.doctor": {},
  "help.summary.models": {},
  "help.summary.run": {},
  "help.summary.runs": {},
  "help.summary.report": {},
  "help.summary.changes": {},
  "help.summary.revert": {},
  "help.summary.plan": {},
  "help.summary.apply": {},
  "help.summary.review": {},
  "help.summary.cleanup": {},
  // U-115: the way to try the flow without a key (docs/usage.md section 3), at a terminal: after
  // the short help, doctor's next steps, init's text and a run's provider_not_configured error.
  "first_use.try_without_key": {},

  // doctor (N-21): one id per outcome; the check id and its status word come from listed ids.
  // A DoctorCheck's `text` is in the JSON, so doctor ids never take `text` (catalog output).
  "doctor.footer": { status: "text", exitCode: "count" },
  "doctor.task_unusable": {},
  "doctor.no_workspace": {},
  "doctor.config_file.unreadable": { location: "location" },
  "doctor.config_file.json_syntax": { location: "location", line: "count", column: "count" },
  "doctor.config_file.key": { location: "location" },
  "doctor.config_file.too_deep": { location: "location" },
  "doctor.config_file.invalid": { location: "location", field: "field" },
  "doctor.config_file.invalid_unlocated": { location: "location" },
  "doctor.task_file.unreadable": {},
  "doctor.task_file.json_syntax": { line: "count", column: "count" },
  "doctor.task_file.key": {},
  "doctor.task_file.too_deep": {},
  "doctor.task_file.invalid": { field: "field" },
  "doctor.task_file.invalid_unlocated": {},
  "doctor.task_file.valid": {},
  "doctor.model.script_unreadable": {},
  "doctor.model.script_json_syntax": { line: "count", column: "count" },
  "doctor.model.script_key": {},
  "doctor.model.script_too_deep": {},
  "doctor.model.script_invalid": { field: "field" },
  "doctor.model.script_invalid_unlocated": {},
  "doctor.node_version.ok": { major: "count", required: "count" },
  "doctor.node_version.fail": { required: "count" },
  "doctor.vars_file.skipped": {},
  "doctor.vars_file.unreadable": {},
  "doctor.vars_file.bom": {},
  "doctor.vars_file.ok": { count: "count" },
  "doctor.config_file.env_not_local": {},
  "doctor.config_file.none": {},
  "doctor.config_file.default_refused": {},
  "doctor.config_file.default_missing": { location: "location" },
  // `valid_at`: the config file at its default location. N-A 32.3: one given by `--config` or
  // CODARYN_CONFIG is `valid_given`, so it is not called the default location.
  "doctor.config_file.valid_at": { location: "location" },
  "doctor.config_file.valid_given": { location: "location" },
  "doctor.config_file.profile_missing": {},
  "doctor.task_file.skipped": {},
  "doctor.api_key.scripted": {},
  // SP-D12: the chosen provider and its key variable.
  "doctor.api_key.ok": { keyEnv: "keyEnv" },
  "doctor.api_key.missing": { keyEnv: "keyEnv", provider: "provider" },
  // U-87 (design gap C-12, architecture.md A-1; PM): the key is set but not of the form a request
  // can carry (S-11: printable ASCII 0x21-0x7E, no space); the check fails. Never the value, its
  // length or which character.
  "doctor.api_key.unusable": { keyEnv: "keyEnv" },
  // U-115 (UXM-9): at a terminal, after doctor's closing line: what is not set up yet and what to do
  // next, numbered in a fixed order (doctor.next.heading, then .init or .config_fix, .key or
  // .key_unusable, .model or .model_after_key, .other, .warnings, and .again), from the checks' texts;
  // with nothing to do, .ready (or .ready_task when doctor was given --task). The check lines and
  // doctor --json are as before; not at a terminal nothing is added.
  // U-132 (review R-91): .init_with_config in place of .init where there is no default config
  // location at all (L-1: init needs --config there); .model_after_key_fix after a key that cannot
  // be sent (L-4); .ready says the run works in the folder it starts in, and .ready_workspace is the
  // quick form for doctor given --workspace (L-3). Every line within 100 columns with its number (L-2).
  "doctor.next.heading": {},
  "doctor.next.init": {},
  "doctor.next.init_with_config": {},
  "doctor.next.config_fix": {},
  "doctor.next.key": { keyEnv: "keyEnv" },
  "doctor.next.key_unusable": { keyEnv: "keyEnv" },
  "doctor.next.model": {},
  "doctor.next.model_after_key": {},
  "doctor.next.model_after_key_fix": {},
  "doctor.next.other": { count: "count" },
  "doctor.next.warnings": { count: "count" },
  "doctor.next.again": {},
  "doctor.next.ready": {},
  "doctor.next.ready_workspace": {},
  "doctor.next.ready_task": {},
  // DR-36 (b), DR-34 (a): the key is set and where `{provider}` requests send it: `{origin}`, set by
  // the provider's address variable `{variable}`, by the config field `{field}`, or the default.
  "doctor.api_key.sends_to_env": { keyEnv: "keyEnv", provider: "provider", origin: "apiOrigin", variable: "settingEnv" },
  "doctor.api_key.sends_to_config": { keyEnv: "keyEnv", provider: "provider", origin: "apiOrigin", field: "field" },
  "doctor.api_key.sends_to_default": { keyEnv: "keyEnv", provider: "provider", origin: "apiOrigin" },
  // DR-36 (b): the key is set, but the address in `{variable}` breaks the address rule, so nothing is sent.
  "doctor.api_key.address_invalid": { keyEnv: "keyEnv", variable: "settingEnv" },
  "doctor.model.scripted_ok": {},
  "doctor.model.ok": {},
  // N-A 33.3: the chosen provider's model variable and the config place to set (`model`, or
  // `providers.<name>.model`), and the place of its output cap (`maxOutputTokens`, or
  // `providers.<name>.maxOutputTokens`).
  "doctor.model.missing": { variable: "settingEnv", field: "field" },
  "doctor.model.placeholder": {},
  "doctor.model.output_cap_missing": { field: "field" },
  "doctor.model.base_url_invalid": {},
  // DR-36 (b), R-19 I-4: a note of the model check (DoctorCheck.notes): `{variable}` is set but is
  // `{owner}`'s model or address variable, so a `{provider}` run does not read it.
  "doctor.model.other_provider_variable": { variable: "settingEnv", owner: "provider", provider: "provider" },
  "doctor.limits.ok": {},
  "doctor.limits.ok_quick": {},
  "doctor.limits.invalid": { field: "field" },
  "doctor.limits.invalid_unlocated": {},
  "doctor.workspace.skipped": {},
  "doctor.workspace.ok": {},
  "doctor.workspace.missing": {},
  "doctor.file_locations.no_input": {},
  "doctor.file_locations.inside": { count: "count" },
  "doctor.file_locations.ok": { count: "count" },
  "doctor.commands.none": {},
  "doctor.commands.ok": { count: "count" },
  "doctor.commands.ok_unchecked": { count: "count" },
  "doctor.commands.problems": { rejected: "count", notFound: "count", notFoundLocally: "count", remote: "count" },
  // G-F (general-tasks.md 7.1, PM answer Q5): `{count}` command rules take any further arguments
  // (`allowExtraArgs: true`) while plans may move or discard files (`policy.planActions`). Codaryn
  // does not check those arguments, so such a command can change files outside an approved plan.
  // A warning in the `commands` check (no new check id).
  "doctor.commands.extra_args_with_plan": { count: "count" },
  // DR-41: notes of the `commands` check (DoctorCheck.notes): what the task type's own rules left out
  // of the configured policy (workflowPolicyNarrowings). Counts only.
  "doctor.workflow_policy.commands_dropped": { count: "count" },
  "doctor.workflow_policy.commands_narrowed": { count: "count" },
  "doctor.workflow_policy.plan_actions_dropped": { count: "count" },
  "doctor.workflow_policy.restore_path_tokens_off": {},
  "doctor.workflow_policy.verifiers_dropped": { count: "count" },
  "doctor.install_dir.unknown_env": {},
  "doctor.install_dir.not_found": {},
  "doctor.install_dir.ok": {},
  "doctor.install_dir.overlap": {},
  "doctor.integrity_paths.skipped": {},
  "doctor.integrity_paths.problems": { missing: "count", inside: "count" },
  "doctor.integrity_paths.ok": { count: "count" },
  "doctor.language.from_env": { language: "language" },
  "doctor.language.from_config": { language: "language" },
  "doctor.language.from_os": { language: "language" },
  "doctor.language.from_default": { language: "language" },
  "doctor.language.env_ignored": { language: "language" },
  "doctor.language.unchecked": {},
  // N-25 (a): the workspace lock. When a lock is held but no Codaryn runs, the user removes it.
  "doctor.lock.none": {},
  "doctor.lock.held": {},
  "doctor.lock.stale": {},
  "doctor.lock.unreadable": {},
  // DR-27 (b), PM notice: `.codaryn/lock.json.reclaim` is left in a state the store never clears
  // (still being written, as an exclusive create on a volume without hard links leaves it when the
  // attempt ends in between; not understood; or its owner still runs). While it stays, a lock left
  // by an ended process is not reclaimed; the text says to remove it when no Codaryn runs here.
  "doctor.lock.reclaim_left": {},
  // R-16 L-1: a warning in the `lock` check (no new check id), which already looks into the state
  // directory: `{count}` files a revert left in `.codaryn/parked/` (ListParkedFiles). The person
  // moves them back or deletes them; nothing removes them on its own.
  "doctor.lock.parked_left": { count: "count" },
  // The hint after `workspace_locked`. Its text names `.codaryn/lock.json` and
  // `.codaryn/lock.json.reclaim` (DR-27 b): both may need removing when no Codaryn runs here.
  "lock.remove_hint": {},
} as const satisfies { readonly [id: string]: { readonly [param: string]: MessageParamKind } };

export type FixedMessageId = keyof typeof FIXED_MESSAGES;

/** N-21: the fixed ids a DoctorCheck's `text` may use (not the footer, which is rendered only). */
export type DoctorMessageId = Exclude<Extract<FixedMessageId, `doctor.${string}`>, "doctor.footer">;

/** Files an input diagnostic can point into (N-15). */
export const INPUT_DIAGNOSTIC_FILES = ["config", "task", "script"] as const;
export type InputDiagnosticFile = (typeof INPUT_DIAGNOSTIC_FILES)[number];

/**
 * Message ids that follow a contract list, with no parameters:
 * - `error.<code>.what`, `error.<code>.fix`: one sentence each for every CliErrorCode.
 * - `status.<status>`: the status word (완료, 실패, 확인 필요, 한도 도달, 취소됨 in Korean).
 * - `reason.<reason>`: the reason as words, e.g. "지정한 검증 모두 통과".
 * - `advice.<reason>`: what the user can do next (UX design section 6).
 * - `tool.<name>`: a tool as words, e.g. "파일 읽기". G-A: for every name in ALL_TOOL_NAMES, the
 *   built-in tools and the task type tools (`inspect_files`, `propose_plan`), so a task type tool's
 *   progress line names it. Only a recorded UNKNOWN_TOOL_RECORD_NAME (AC-D15), a name in no tool
 *   list, is shown as `progress.unknown_tool`.
 * - `revert.skip.<reason>`: why a file was or would be skipped.
 * - `diagnostic.file.<file>`: the file a diagnostic points into.
 * - `denial.<code>` (N-20): a policy denial or tool error code as words ("허용 목록에 없음").
 * - `permission.<kind>`, `phase.<phase>`, `modelError.<kind>` (N-20): those codes as words.
 * - `language.source.<source>` (N-20): where the language came from.
 * - `help.command.<command>`, `help.option.<option>`, `help.exit.<command>` (N-21): one line each.
 * - `doctor.check.<id>`, `doctor.status.<status>` (N-21): a check's label and its status word.
 *   The check ids and statuses stay English in the JSON.
 * - `approval.<channel>` (G-A): how a plan was approved, e.g. "터미널에서 승인".
 * - `plan.problem.<problem>` (G-A): why an apply action cannot be or was not applied.
 * - `plan.status.<status>`, `plan.action.<kind>`, `review.verdict.<verdict>` (U-36): a plan's
 *   status, an action's kind and a review's verdict as words.
 * - `changes.state.<state>`, `changes.unavailable.<reason>` (U-36): a changed file's state now and
 *   why its text is not shown (CHANGED_FILE_STATES, CHANGED_FILE_UNAVAILABLE_REASONS).
 * - `error.hint.<hint>` (R-12 L-2): an error's extra advice line (CliErrorOutput.hint).
 * - `cleanup.blocked.<code>`, `cleanup.warning.<code>`, `cleanup.kept.<reason>` (DR-39): why an item
 *   is not removed, what a person is told before confirming, why a confirmed item was kept.
 * - `cleanup.target.<target>` (U-34): the kind of an item named in a cleanup's lines (a run's
 *   records, a discarded-files folder, a leftover folder), before its run id or folder name.
 * - `apply.notice.<kind>` (U-8): one line of the apply summary per ApplyResult.noticeKinds entry.
 *   U-33: `apply.notice.plan_records_unchecked.<cause>` takes the place of
 *   `apply.notice.plan_records_unchecked` when ApplyResult.planRecordsUncheckedCause is that cause.
 */
export type ListedMessageId =
  | `error.${CliErrorCode}.what`
  | `error.${CliErrorCode}.fix`
  | `status.${TerminalRunStatus}`
  | `reason.${RunReason}`
  | `advice.${RunReason}`
  | `tool.${AnyToolName}`
  | `revert.skip.${RevertSkipReason}`
  | `diagnostic.file.${InputDiagnosticFile}`
  | `denial.${PolicyDenialCode | ToolErrorCode}`
  | `permission.${PermissionKind}`
  | `phase.${IntegrityPhase}`
  | `modelError.${ModelErrorKind}`
  | `progress.confirmation_denied.${ConfirmationBy}`
  | `language.source.${LanguageSource}`
  | `help.command.${HelpCommand}`
  | `help.option.${HelpOption}`
  | `help.exit.${HelpCommand}`
  | `doctor.check.${DoctorCheckId}`
  | `doctor.status.${DoctorCheckStatus}`
  | `approval.${ApprovalChannel}`
  | `plan.problem.${PlanItemProblem}`
  | `plan.status.${PlanStatus}`
  | `plan.action.${PlanActionKind}`
  | `review.verdict.${ReviewVerdict}`
  | `changes.state.${ChangedFileState}`
  | `changes.unavailable.${ChangedFileUnavailableReason}`
  | `error.hint.${CliErrorHint}`
  | `cleanup.blocked.${CleanupBlockCode}`
  | `cleanup.warning.${CleanupWarningCode}`
  | `cleanup.target.${CleanupTarget}`
  | `cleanup.kept.${CleanupKeptReason}`
  | `apply.notice.${ApplyNoticeKind}`
  | `apply.notice.plan_records_unchecked.${PlanRecordsUncheckedCause}`;

export type MessageId = FixedMessageId | ListedMessageId;

/** No parameters. */
export type NoMessageParams = { readonly [name: string]: never };

/** The parameter object of one message id, typed from FIXED_MESSAGES. */
export type MessageParamsOf<I extends MessageId> = I extends FixedMessageId
  ? { readonly [P in keyof (typeof FIXED_MESSAGES)[I]]: MessageParamTypeByKind[(typeof FIXED_MESSAGES)[I][P] & MessageParamKind] }
  : NoMessageParams;

/** `format`'s parameter list: none for a message without parameters, else exactly its object. */
export type MessageFormatArgs<I extends MessageId> = I extends FixedMessageId
  ? keyof (typeof FIXED_MESSAGES)[I] extends never
    ? [params?: NoMessageParams]
    : [params: MessageParamsOf<I>]
  : [params?: NoMessageParams];

/** Every MessageId, fixed and listed, in a stable order. Both catalogs must have each one. */
export const MESSAGE_IDS: readonly MessageId[] = [
  ...(Object.keys(FIXED_MESSAGES) as FixedMessageId[]),
  ...(Object.keys(CLI_ERROR_EXIT_CODES) as CliErrorCode[]).flatMap(
    (code) => [`error.${code}.what`, `error.${code}.fix`] as const,
  ),
  ...TERMINAL_RUN_STATUSES.map((status) => `status.${status}` as const),
  ...RUN_REASONS.map((reason) => `reason.${reason}` as const),
  ...RUN_REASONS.map((reason) => `advice.${reason}` as const),
  ...ALL_TOOL_NAMES.map((name) => `tool.${name}` as const),
  ...REVERT_SKIP_REASONS.map((reason) => `revert.skip.${reason}` as const),
  ...INPUT_DIAGNOSTIC_FILES.map((file) => `diagnostic.file.${file}` as const),
  ...[...POLICY_DENIAL_CODES, ...TOOL_ERROR_CODES]
    .filter((code, index, all) => all.indexOf(code) === index)
    .map((code) => `denial.${code}` as const),
  ...PERMISSION_KINDS.map((kind) => `permission.${kind}` as const),
  ...INTEGRITY_PHASES.map((phase) => `phase.${phase}` as const),
  ...MODEL_ERROR_KINDS.map((kind) => `modelError.${kind}` as const),
  ...CONFIRMATION_BY.map((by) => `progress.confirmation_denied.${by}` as const),
  ...LANGUAGE_SOURCES.map((source) => `language.source.${source}` as const),
  ...HELP_COMMANDS.map((command) => `help.command.${command}` as const),
  ...HELP_OPTIONS.map((option) => `help.option.${option}` as const),
  ...HELP_COMMANDS.map((command) => `help.exit.${command}` as const),
  ...DOCTOR_CHECK_IDS.map((id) => `doctor.check.${id}` as const),
  ...DOCTOR_CHECK_STATUSES.map((status) => `doctor.status.${status}` as const),
  ...APPROVAL_CHANNELS.map((channel) => `approval.${channel}` as const),
  ...PLAN_ITEM_PROBLEMS.map((problem) => `plan.problem.${problem}` as const),
  ...PLAN_STATUSES.map((status) => `plan.status.${status}` as const),
  ...PLAN_ACTION_KINDS.map((kind) => `plan.action.${kind}` as const),
  ...REVIEW_VERDICTS.map((verdict) => `review.verdict.${verdict}` as const),
  ...CHANGED_FILE_STATES.map((state) => `changes.state.${state}` as const),
  ...CHANGED_FILE_UNAVAILABLE_REASONS.map((reason) => `changes.unavailable.${reason}` as const),
  ...CLI_ERROR_HINTS.map((hint) => `error.hint.${hint}` as const),
  ...CLEANUP_BLOCK_CODES.map((code) => `cleanup.blocked.${code}` as const),
  ...CLEANUP_WARNING_CODES.map((code) => `cleanup.warning.${code}` as const),
  ...CLEANUP_KEPT_REASONS.map((reason) => `cleanup.kept.${reason}` as const),
  ...CLEANUP_TARGETS.map((target) => `cleanup.target.${target}` as const),
  ...APPLY_NOTICE_KINDS.map((kind) => `apply.notice.${kind}` as const),
  ...PLAN_RECORDS_UNCHECKED_CAUSES.map((cause) => `apply.notice.plan_records_unchecked.${cause}` as const),
];

/** The parameters a message takes, name → kind (none for listed ids). For catalog tests. */
export function messageParams(id: MessageId): { readonly [param: string]: MessageParamKind } {
  return Object.hasOwn(FIXED_MESSAGES, id) ? FIXED_MESSAGES[id as FixedMessageId] : {};
}

/**
 * One language's fixed texts. `format` substitutes `{name}` with the parameter's value (a number
 * in decimal digits, anything else as given); the types above limit what can be given. It never
 * reads a file or the environment. A missing or extra parameter at run time is a programming
 * error and throws.
 *
 * N-24 (review R-3 GAP-1 to GAP-6): the types can be bypassed (casts, `any`, JSON), so `format`
 * checks every value's kind again at run time: a count is a non-negative safe integer, seconds a
 * non-negative number with at most one decimal place, a code one of its contract list, a field a
 * `toSchemaFieldPath` result, a run id a `toRunId` result, a location or suggestion one of the
 * fixed strings, text one this catalog produced. A value that fails is not shown (a fixed
 * replacement such as "?" stands in its place). Run ids and task ids are shown with key shapes
 * hidden, as every printed text is.
 */
export interface MessageCatalog {
  readonly language: MessageLanguage;
  format<I extends MessageId>(id: I, ...params: MessageFormatArgs<I>): CatalogText;
}

/** Signature of `createMessageCatalog`, exported by `src/i18n/index.ts`. */
export type CreateMessageCatalog = (language: MessageLanguage) => MessageCatalog;

/**
 * N-21: a doctor check's text as a message id and its parameters, for the human output in the
 * chosen language. `DoctorCheck.message` stays the English line in the JSON.
 */
export type DoctorText = {
  readonly [I in DoctorMessageId]: keyof MessageParamsOf<I> extends never
    ? { readonly id: I }
    : { readonly id: I; readonly params: MessageParamsOf<I> };
}[DoctorMessageId];

/**
 * What a run summary needs besides the result (N-5, N-17). Nothing in it is a typed or file value.
 * - workspaceForm: how the workspace was given, for the "next command" hints: "current" (one-line
 *   run: `--workspace .`), "given" (`--workspace <dir>`: the hint says `<workspace>`, or the typed
 *   path when workspaceShown is there), "task" (a task file: the hint says `<workspace>`, as before).
 * - workspaceShown (DR-51, U-38): with "given" only, the typed `--workspace` path as
 *   `toShownWorkspace` gives it after the run's masking; absent when it gives null. The hints then
 *   use the `*_typed` ids and `summary.form.typed`. Never in the JSON or the records (UXM-8).
 * - configDefault (N-1): the fixed display form when the config came from the default location.
 * - profileApplied (N-8): whether `--profile` was used. The name is not shown.
 * - deniedToolCalls (N-17): `tool_decision` records with `allowed: false` in this run, the same
 *   count as ReportJournalSummary.deniedToolCalls.
 * - deniedCommandCalls (N-23): the denied calls whose permission is `command`. The hint to allow a
 *   command is shown only when it is above 0.
 * - policySource (N-23): where the run's policy came from, so the denied-call hint points there:
 *   "task" (a task file states its own policy: `summary.denied_hint_task`) or "config" (the quick
 *   form and the one-line run: the config file or its profile, `summary.denied_hint`).
 * - confirmationDenied (U-110, review R-85 M1): the calls denied after a permission question
 *   (`confirmation_answered` with `deny`), by ConfirmationBy, and `couldAsk`: whether this run had a
 *   way to ask (the CLI gave the engine its terminal question). Absent when there was none. They are
 *   among deniedCommandCalls; the add-a-rule hint is for the other denied command calls only, and
 *   each count above 0 has its line: `summary.confirm_denied.user`, `.cancelled`, and for `default`
 *   `.unanswered` when couldAsk, else `.unasked`. U-137 (R88b-L1): "among deniedCommandCalls" holds also
 *   for a call whose run ended at its question (cancelled, or the time limit): the engine records its
 *   denied `tool_decision` after the answer (journal.ts), so the hint still counts the other calls.
 * - policyNarrowings (U-140, UXM-18): what the task type's own rules left out of the given policy
 *   and checks (ResolvedTaskSpec.policyNarrowings, as `run_started.policyNarrowings` records them),
 *   so the end summary tells it once more: the start line's notice is easy to pass over. One line
 *   per narrowing, in the record's order, with the start line's text (`progress.workflow_policy.<kind>`,
 *   with `{count}` where the kind has one). Kinds and counts only, never a rule. Optional: absent or
 *   empty says nothing was left out (or a caller that does not pass it), and no line is written.
 *   `--quiet` writes no summary, as before.
 * - failedToolCalls (U-18, AXM-4): the failed calls of this run, `summary.failed` when above 0.
 *   Optional (PM, after e94decc): absent counts as 0, so no line; `run` gives it.
 *   The failed-call rule, shared by the progress line (`progress.tool_failed`), this count and the
 *   report's text: a `tool_result` record with `ok: false` whose `callId` has no `tool_decision`
 *   with `allowed: false` in the run. A call the policy denied or a check rejected is a denied call
 *   only (its decision is its line), never counted twice. A command that ran and exited with a code
 *   other than 0, or timed out, is not a failed call: its result is `ok` (PM Q-2 (a)); it has its
 *   progress line. `report --json` does not carry the count (PM Q-3).
 */
export interface RunSummaryContext {
  readonly workspaceForm: "current" | "given" | "task";
  readonly configDefault: DefaultConfigDisplay | null;
  readonly profileApplied: boolean;
  readonly deniedToolCalls: number;
  readonly deniedCommandCalls: number;
  readonly failedToolCalls?: number;
  readonly confirmationDenied?: { readonly user: number; readonly default: number; readonly cancelled: number; readonly couldAsk: boolean };
  readonly policyNarrowings?: readonly PolicyNarrowing[];
  readonly policySource: "task" | "config";
  readonly workspaceShown?: ShownWorkspace;
}

/**
 * Renders outputs as text for people, in the catalog's language. Every method returns complete
 * lines ending with LF (or null where noted) and never reads anything.
 *
 * Paths: messages never take a path, except a ShownWorkspace in the `*_typed` next-command hints
 * (DR-51). A renderer may print the masked paths that the outputs and
 * records already carry (`changes[].path`, `reverted[].path`, `skipped[].path`, `file_changed.path`,
 * and G-A's `file_moved.from`/`to`, `file_discarded.path`, `ApplyResult.applied[].action` paths) as
 * items after a message, with control characters replaced, key shapes hidden and the length cut, as
 * `report` prints them. G-A: the same holds for `EngineResult.review.checklist` entries (masked text
 * from the user's own config) and for `EngineResult.plan.digest` / `ApplyResult.digest` (64
 * lowercase hex characters), which follows `summary.next_apply` or `summary.next_apply_unsafe` as an
 * item so the user can copy it into `--digest`. No other
 * value from an output or a record is printed as text.
 * The CLI masks the rendered text again with the run's privacy gateway where it has one, and
 * writes it best effort.
 */
export interface HumanOutput {
  /**
   * N-5, N-15: stderr after any command that printed a CliErrorOutput: what (`error.<code>.what`),
   * the diagnostic when there is one, how to fix it (`error.<code>.fix`), the code. The English
   * `message` is not shown: it stays in the JSON line.
   */
  error(output: CliErrorOutput): string;
  /**
   * N-5: stderr at the end of `run`: status and reason as words, verifier result, number of
   * changed files, denied calls (with the hint once, N-17), failed calls (U-18), usage (seconds,
   * N-20), run id, next commands. The result's `notices` are not shown (N-22): the model-not-found hint is a progress
   * line (`progress.model_not_found`), and every notice stays in the JSON and the report.
   */
  runSummary(result: EngineResult, context: RunSummaryContext): string;
  /**
   * N-5: one progress line body for a journal record, without PROGRESS_PREFIX, or null for records
   * that are not shown. Codes go in parentheses after the words. A verifier is shown by its number
   * (1-based), the order in which its id first appeared in this run's `verifier_result` records,
   * which the renderer counts itself; the id is never shown. DR-38, U-8: a `state_checked` record is
   * shown when something changed (`progress.state_changed` with the count) or when it is `limited`
   * (`progress.state_unchecked`), and not otherwise. U-18: a `tool_result` record is shown only as
   * `progress.tool_failed` (a failed call, by the rule at RunSummaryContext: the renderer remembers
   * the calls whose decision was not allowed) or `progress.command_exited` /
   * `progress.command_timed_out`; a result that succeeded is not shown.
   */
  progressLine(event: JournalEvent): string | null;
  /**
   * N-7: stderr after `revert` and `revert --dry-run`. DR-25: `revert.unsafe_moved` when files were
   * moved back unsafely, `summary.next_revert_unsafe` when files were skipped as `unsafe_move`, and
   * `revert.dry_run_move_unchecked` when `moveSafetyUnchecked` is present. R-16 L-1:
   * `revert.parked` when skipped files carry `parkedAt`. DR-51 (U-38): with
   * `context.workspaceShown`, `summary.next_revert_unsafe_typed` in place of
   * `summary.next_revert_unsafe`; R-70 L-1 (PM): `revert` passes none, so it never does.
   */
  revertSummary(output: RevertOutput, context?: RevertSummaryContext): string;
  /** N-7, N-16: stdout text of `codaryn runs` without `--json`. Damaged runs show only their id and the damaged mark. */
  runsText(output: RunsOutput): string;
  /**
   * N-23: stderr before `revert --run latest` and `report --run latest` act: the chosen run id
   * (`latest.chosen`) and its start time in local time.
   */
  latestChosen(entry: Extract<RunListEntry, { readonly state: "checked" }>): string;
  /**
   * G-A: one progress line body for an apply run's record, or null for records not shown. The
   * shared records (`verifier_result`, `integrity_checked`, `run_finished`) render as in
   * `progressLine`. Optional only until the renderer (N-C) has it; then it becomes required.
   */
  applyProgressLine?(event: ApplyJournalEvent): string | null;
  /**
   * G-A: stderr at the end of `apply`: status and reason as words, actions applied of the plan's
   * total (`summary.apply_actions`), the plan run (`summary.apply_plan_run`), verifier result, run id,
   * and the next commands (report, revert). For `consent_required` (DR-21): `summary.unsafe_moves`
   * and `summary.next_apply_unsafe` with the digest as an item. U-8: `apply.notice.<kind>` for each
   * of `noticeKinds`, whatever the status; U-33: for `plan_records_unchecked` with a
   * `planRecordsUncheckedCause`, `apply.notice.plan_records_unchecked.<cause>` instead. Optional only until the renderer (N-C) has it.
   * `runSummary` covers the plan run (`plan_pending`: `summary.plan_ready`, `summary.next_plan`,
   * `summary.next_apply` with the digest as an item) and human review (`awaiting_review`:
   * `summary.review_checklist` with the checklist entries as items, `summary.next_review`).
   */
  applySummary?(result: ApplyResult, context: ApplySummaryContext): string;
}

/**
 * G-A: what an apply summary needs besides the result. As RunSummaryContext's workspaceForm and,
 * DR-51 (U-38), its workspaceShown (after the apply's masking).
 */
export interface ApplySummaryContext {
  readonly workspaceForm: "current" | "given" | "task";
  readonly workspaceShown?: ShownWorkspace;
}

/**
 * DR-51 (U-38): what a revert summary needs besides the output. R-70 L-1 (PM): `revert` knows no
 * registered values, so it cannot tell whether the typed path holds one; it passes no
 * workspaceShown and its hint always says `<workspace>`. The field stays for the renderer's type.
 */
export interface RevertSummaryContext {
  readonly workspaceShown?: ShownWorkspace;
}

/** Signature of `createHumanOutput`, exported by `src/cli/human/index.ts`. One renderer per command. */
export type CreateHumanOutput = (messages: MessageCatalog) => HumanOutput;
