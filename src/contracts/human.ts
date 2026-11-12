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
 * through a parameter. A verifier is shown by its number, never by its id; a profile by whether
 * one was applied, never by its name.
 */

import { REVERT_SKIP_REASONS } from "./changes.js";
import type { RevertSkipReason } from "./changes.js";
import type { RunListEntry, RunsOutput } from "./commands.js";
import type { DefaultConfigDisplay } from "./config.js";
import { DOCTOR_CHECK_IDS, DOCTOR_CHECK_STATUSES } from "./commands.js";
import type { DoctorCheckId, DoctorCheckStatus } from "./commands.js";
import { CLI_ERROR_EXIT_CODES, RUN_REASONS, TERMINAL_RUN_STATUSES } from "./engine.js";
import { INTEGRITY_PHASES } from "./integrity.js";
import { MODEL_ERROR_KINDS } from "./model.js";
import { PERMISSION_KINDS, POLICY_DENIAL_CODES } from "./policy.js";
import type { CliErrorCode, CliErrorOutput, EngineResult, RevertOutput, RunReason, TerminalRunStatus } from "./engine.js";
import type { IntegrityPhase } from "./integrity.js";
import type { JournalEvent } from "./journal.js";
import type { ModelErrorKind } from "./model.js";
import type { PermissionKind, PolicyDenialCode } from "./policy.js";
import { APPROVAL_CHANNELS, PLAN_ITEM_PROBLEMS } from "./plan.js";
import type { ApplyJournalEvent, ApplyResult, ApprovalChannel, PlanItemProblem } from "./plan.js";
import type { ModelProviderName } from "./task.js";
import { TOOL_ERROR_CODES, TOOL_NAMES } from "./tool.js";
import type { ToolErrorCode, ToolName } from "./tool.js";

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

/** A field position made of schema field names and indices only. Obtain it from `toSchemaFieldPath`. */
export type SchemaFieldPath = string & { readonly [schemaFieldPathBrand]: "field" };
/** A run id that matches the run directory rule. Obtain it from `toRunId`. */
export type RunId = string & { readonly [runIdBrand]: "runId" };
/** Text a MessageCatalog produced. Only `MessageCatalog.format` makes it. */
export type CatalogText = string & { readonly [catalogTextBrand]: "catalog" };

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

/** N-21: commands with a help text. */
export const HELP_COMMANDS = ["run", "revert", "report", "doctor", "models", "init", "runs"] as const;
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
 * - count: number (non-negative integer: counts, turns, attempts, line, column, durations)
 * - status, reason, permission, denial, modelError, phase, provider: closed code unions
 * - field: SchemaFieldPath. runId: RunId. text: CatalogText (another message of the same catalog)
 * - location: ConfigLocationDisplay
 * - suggestedCommand, suggestedPath: the fixed init suggestion lists
 * - seconds (N-20): a non-negative number of seconds with at most one decimal place (the
 *   renderer rounds milliseconds to tenths); the catalog writes it in decimal digits
 * - language (N-20): a MessageLanguage code
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
}
export type MessageParamKind = keyof MessageParamTypeByKind;

/**
 * Fixed messages and the parameters each one takes (name → kind). A template refers to a
 * parameter as `{name}`; it must use every listed parameter and no other. Words only: the layout
 * (prefixes, separators, line breaks, the code in parentheses) belongs to the renderer.
 * Commands shown in messages are fixed text in the template (for example
 * `codaryn report --workspace <workspace> --run {runId}`); no message takes a typed path.
 */
export const FIXED_MESSAGES = {
  // Errors (N-5): "<error.label> — <what> (<code>)", the diagnostic line (N-15), the fix line.
  "error.label": {},
  "error.fix_label": {},
  "error.doctor_hint": {},

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
  "summary.changes": { count: "count" },
  "summary.denied": { count: "count" },
  "summary.denied_hint": {},
  // N-23: the same hint for a task file run, whose policy is the task's own.
  "summary.denied_hint_task": {},
  "summary.usage": { turns: "count", toolCalls: "count", seconds: "seconds" },
  "summary.run_id": { runId: "runId" },
  "summary.next_report": { runId: "runId" },
  "summary.next_report_here": { runId: "runId" },
  "summary.next_revert": { runId: "runId" },
  "summary.next_revert_here": { runId: "runId" },
  "summary.config_default": { location: "location" },
  "summary.profile_applied": {},
  // G-A: plan runs, human review and apply runs. `{form}` is one of `summary.form.*`, chosen by
  // the context's workspaceForm, so a hint repeats the task form the user typed without its value.
  "summary.form.task": {},
  "summary.form.given": {},
  "summary.form.current": {},
  "summary.plan_ready": { actions: "count" },
  "summary.next_plan": { form: "text", runId: "runId" },
  "summary.next_apply": { form: "text", runId: "runId" },
  "summary.review_checklist": { count: "count" },
  "summary.next_review": { form: "text", runId: "runId" },
  "summary.apply_actions": { applied: "count", total: "count" },
  "summary.apply_plan_run": { runId: "runId" },
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

  // `codaryn runs` (N-7, N-16).
  "runs.column.run_id": {},
  "runs.column.started": {},
  "runs.column.status": {},
  "runs.column.changes": {},
  "runs.empty": {},
  "runs.incomplete": {},
  "runs.damaged": {},
  "runs.reverted": {},
  // N-23 (g): the run's own records are fine, only its revert record failed the checks.
  "runs.revert_record_damaged": {},
  "runs.omitted": { count: "count" },

  // `codaryn init` (N-2). Questions go to stderr; the final text (src/cli/init.ts) to stdout.
  "init.location": { location: "location" },
  "init.confirm_create": {},
  "init.declined": {},
  "init.not_terminal": {},
  "init.model_no_key": {},
  "init.model_pick": {},
  "init.model_list_failed": { kind: "modelError" },
  "init.model_placeholder": {},
  "init.limits_default": { turns: "count", toolCalls: "count", tokens: "count", minutes: "count" },
  "init.commands_suggest": { command: "suggestedCommand" },
  "init.protected_suggest": { path: "suggestedPath" },
  "init.language_pick": {},
  "init.key_set": {},
  "init.key_missing": {},
  "init.key_hint_windows": {},
  "init.key_hint_posix": {},
  "init.saved": { location: "location" },
  "init.next": {},
  "init.overridden_by_env": {},

  // Yes/no prompts (N-20): the hint shows the default answer, as INIT_QUESTION_DEFAULTS says.
  "prompt.yes_no_default_yes": {},
  "prompt.yes_no_default_no": {},

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
  "doctor.config_file.valid_at": { location: "location" },
  "doctor.config_file.profile_missing": {},
  "doctor.task_file.skipped": {},
  "doctor.api_key.scripted": {},
  "doctor.api_key.ok": {},
  "doctor.api_key.missing": {},
  "doctor.model.scripted_ok": {},
  "doctor.model.ok": {},
  "doctor.model.missing": {},
  "doctor.model.placeholder": {},
  "doctor.model.output_cap_missing": {},
  "doctor.model.base_url_invalid": {},
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
 * - `tool.<name>`: a tool as words, e.g. "파일 읽기".
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
 */
export type ListedMessageId =
  | `error.${CliErrorCode}.what`
  | `error.${CliErrorCode}.fix`
  | `status.${TerminalRunStatus}`
  | `reason.${RunReason}`
  | `advice.${RunReason}`
  | `tool.${ToolName}`
  | `revert.skip.${RevertSkipReason}`
  | `diagnostic.file.${InputDiagnosticFile}`
  | `denial.${PolicyDenialCode | ToolErrorCode}`
  | `permission.${PermissionKind}`
  | `phase.${IntegrityPhase}`
  | `modelError.${ModelErrorKind}`
  | `language.source.${LanguageSource}`
  | `help.command.${HelpCommand}`
  | `help.option.${HelpOption}`
  | `help.exit.${HelpCommand}`
  | `doctor.check.${DoctorCheckId}`
  | `doctor.status.${DoctorCheckStatus}`
  | `approval.${ApprovalChannel}`
  | `plan.problem.${PlanItemProblem}`;

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
  ...TOOL_NAMES.map((name) => `tool.${name}` as const),
  ...REVERT_SKIP_REASONS.map((reason) => `revert.skip.${reason}` as const),
  ...INPUT_DIAGNOSTIC_FILES.map((file) => `diagnostic.file.${file}` as const),
  ...[...POLICY_DENIAL_CODES, ...TOOL_ERROR_CODES]
    .filter((code, index, all) => all.indexOf(code) === index)
    .map((code) => `denial.${code}` as const),
  ...PERMISSION_KINDS.map((kind) => `permission.${kind}` as const),
  ...INTEGRITY_PHASES.map((phase) => `phase.${phase}` as const),
  ...MODEL_ERROR_KINDS.map((kind) => `modelError.${kind}` as const),
  ...LANGUAGE_SOURCES.map((source) => `language.source.${source}` as const),
  ...HELP_COMMANDS.map((command) => `help.command.${command}` as const),
  ...HELP_OPTIONS.map((option) => `help.option.${option}` as const),
  ...HELP_COMMANDS.map((command) => `help.exit.${command}` as const),
  ...DOCTOR_CHECK_IDS.map((id) => `doctor.check.${id}` as const),
  ...DOCTOR_CHECK_STATUSES.map((status) => `doctor.status.${status}` as const),
  ...APPROVAL_CHANNELS.map((channel) => `approval.${channel}` as const),
  ...PLAN_ITEM_PROBLEMS.map((problem) => `plan.problem.${problem}` as const),
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
 *   run: `--workspace .`), "given" (`--workspace <dir>`: the hint says `<workspace>`, the typed
 *   path is never repeated), "task" (a task file: the hint says `<workspace>` too).
 * - configDefault (N-1): the fixed display form when the config came from the default location.
 * - profileApplied (N-8): whether `--profile` was used. The name is not shown.
 * - deniedToolCalls (N-17): `tool_decision` records with `allowed: false` in this run, the same
 *   count as ReportJournalSummary.deniedToolCalls.
 * - deniedCommandCalls (N-23): the denied calls whose permission is `command`. The hint to allow a
 *   command is shown only when it is above 0.
 * - policySource (N-23): where the run's policy came from, so the denied-call hint points there:
 *   "task" (a task file states its own policy: `summary.denied_hint_task`) or "config" (the quick
 *   form and the one-line run: the config file or its profile, `summary.denied_hint`).
 */
export interface RunSummaryContext {
  readonly workspaceForm: "current" | "given" | "task";
  readonly configDefault: DefaultConfigDisplay | null;
  readonly profileApplied: boolean;
  readonly deniedToolCalls: number;
  readonly deniedCommandCalls: number;
  readonly policySource: "task" | "config";
}

/**
 * Renders outputs as text for people, in the catalog's language. Every method returns complete
 * lines ending with LF (or null where noted) and never reads anything.
 *
 * Paths: messages never take a path. A renderer may print the masked paths that the outputs and
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
   * changed files, denied calls (with the hint once, N-17), usage (seconds, N-20), run id, next
   * commands. The result's `notices` are not shown (N-22): the model-not-found hint is a progress
   * line (`progress.model_not_found`), and every notice stays in the JSON and the report.
   */
  runSummary(result: EngineResult, context: RunSummaryContext): string;
  /**
   * N-5: one progress line body for a journal record, without PROGRESS_PREFIX, or null for records
   * that are not shown. Codes go in parentheses after the words. A verifier is shown by its number
   * (1-based), the order in which its id first appeared in this run's `verifier_result` records,
   * which the renderer counts itself; the id is never shown.
   */
  progressLine(event: JournalEvent): string | null;
  /** N-7: stderr after `revert` and `revert --dry-run`. */
  revertSummary(output: RevertOutput): string;
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
   * and `summary.next_apply_unsafe` with the digest as an item. Optional only until the renderer
   * (N-C) has it.
   * `runSummary` covers the plan run (`plan_pending`: `summary.plan_ready`, `summary.next_plan`,
   * `summary.next_apply` with the digest as an item) and human review (`awaiting_review`:
   * `summary.review_checklist` with the checklist entries as items, `summary.next_review`).
   */
  applySummary?(result: ApplyResult, context: ApplySummaryContext): string;
}

/** G-A: what an apply summary needs besides the result. As RunSummaryContext's workspaceForm. */
export interface ApplySummaryContext {
  readonly workspaceForm: "current" | "given" | "task";
}

/** Signature of `createHumanOutput`, exported by `src/cli/human/index.ts`. One renderer per command. */
export type CreateHumanOutput = (messages: MessageCatalog) => HumanOutput;
