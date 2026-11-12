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
 * Rule (S-6, S-12, unchanged by language): no message carries a value read from a file or the
 * environment. Parameters are limited to the kinds of MessageParamKind, and the CLI masks and
 * cleans every rendered line before writing it.
 */

import { REVERT_SKIP_REASONS } from "./changes.js";
import type { RevertSkipReason } from "./changes.js";
import type { RunsOutput } from "./commands.js";
import { CLI_ERROR_EXIT_CODES, RUN_REASONS, TERMINAL_RUN_STATUSES } from "./engine.js";
import type { CliErrorCode, CliErrorOutput, EngineResult, RevertOutput, RunReason, TerminalRunStatus } from "./engine.js";
import type { JournalEvent } from "./journal.js";
import { TOOL_NAMES } from "./tool.js";
import type { ToolName } from "./tool.js";

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

/**
 * What a parameter may hold. Nothing else is ever passed:
 * - count: a non-negative integer.
 * - code: a fixed token: an error code, status, reason, permission, policy code, phase, outcome.
 * - field: a field position from a validator, such as `policy.commands[2].executable`.
 * - runId: a run id (RUN_ID pattern).
 * - command: a codaryn command line the CLI built from fixed words, a run id and a path the user
 *   typed on the command line (cleaned of control characters).
 * - path: a path as the run's journal recorded it (masked), or a symbolic location such as
 *   DEFAULT_CONFIG_DISPLAY's values. Never an expanded environment value.
 * - name: a verifier id or a profile name (both restricted by their patterns), or a tool name.
 * - detail: a CliErrorOutput message. Those messages are fixed text, field positions and counts.
 * - text: another message of this catalog, already formatted.
 */
export type MessageParamKind = "count" | "code" | "field" | "runId" | "command" | "path" | "name" | "detail" | "text";

/**
 * Fixed messages and the parameters each one takes (name → kind). A template refers to a
 * parameter as `{name}`; it must use every listed parameter and no other. Words only: the layout
 * (prefixes, separators, line breaks, the code in parentheses) belongs to the renderer.
 */
export const FIXED_MESSAGES = {
  // Errors (N-5): "<error.label> — <what> (<code>)", then detail and fix lines.
  "error.label": {},
  "error.detail": { detail: "detail" },
  "error.fix_label": {},
  "error.doctor_hint": { command: "command" },

  // End-of-run summary (N-5).
  "summary.result": { text: "text" },
  "summary.verifiers": { passed: "count", total: "count" },
  "summary.no_verifiers": {},
  "summary.changes": { count: "count" },
  "summary.denied": { count: "count" },
  "summary.denied_hint": {},
  "summary.usage": { turns: "count", toolCalls: "count", durationMs: "count" },
  "summary.run_id": { runId: "runId" },
  "summary.next_report": { command: "command" },
  "summary.next_revert": { command: "command" },
  "summary.config_default": { path: "path" },
  "summary.profile": { name: "name" },

  // Progress lines (N-5, R-11): words first, the internal code in parentheses after them.
  "progress.run_started": { task: "name", provider: "code" },
  "progress.turn": { turn: "count" },
  "progress.model_error": { turn: "count", kind: "code" },
  "progress.tool_allowed": { tool: "text" },
  "progress.tool_denied": { tool: "text", permission: "code", code: "code" },
  "progress.file_created": { path: "path" },
  "progress.file_changed": { path: "path" },
  "progress.verifier": { id: "name", outcome: "text" },
  "progress.repair": { attempt: "count", count: "count" },
  "progress.integrity_unchanged": { phase: "code" },
  "progress.integrity_changed": { phase: "code", count: "count" },
  "progress.finished": { status: "text", reason: "code" },
  "progress.model_not_found": {},
  "progress.unknown_tool": {},
  "outcome.pass": {},
  "outcome.fail": {},
  "outcome.inconclusive": {},

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

  // `codaryn runs` (N-7).
  "runs.column.run_id": {},
  "runs.column.started": {},
  "runs.column.status": {},
  "runs.column.changes": {},
  "runs.column.task": {},
  "runs.empty": {},
  "runs.incomplete": {},
  "runs.reverted": {},
  "runs.unreadable": { count: "count" },
  "runs.truncated": { count: "count" },

  // `codaryn init` (N-2). Questions go to stderr; the final text (rendered by src/cli/init.ts) to stdout.
  "init.location": { path: "path" },
  "init.confirm_create": {},
  "init.declined": {},
  "init.not_terminal": {},
  "init.model_no_key": { command: "command" },
  "init.model_pick": {},
  "init.model_list_failed": { kind: "code", command: "command" },
  "init.model_placeholder": { command: "command" },
  "init.limits_default": { turns: "count", toolCalls: "count", tokens: "count", minutes: "count" },
  "init.commands_suggest": { command: "command" },
  "init.protected_suggest": { path: "path" },
  "init.language_pick": {},
  "init.key_set": {},
  "init.key_missing": {},
  "init.key_hint_windows": {},
  "init.key_hint_posix": {},
  "init.saved": { path: "path" },
  "init.next": { command: "command" },
  "init.overridden_by_env": {},
  "init.yes_no": {},
} as const satisfies { readonly [id: string]: { readonly [param: string]: MessageParamKind } };

export type FixedMessageId = keyof typeof FIXED_MESSAGES;

/**
 * Message ids that follow a contract list, with no parameters:
 * - `error.<code>.what`, `error.<code>.fix`: one sentence each for every CliErrorCode.
 * - `status.<status>`: the status word (완료, 실패, 확인 필요, 한도 도달, 취소됨 in Korean).
 * - `reason.<reason>`: the reason as words, e.g. "지정한 검증 모두 통과".
 * - `advice.<reason>`: what the user can do next (UX design section 6).
 * - `tool.<name>`: a tool as words, e.g. "파일 읽기".
 * - `revert.skip.<reason>`: why a file was or would be skipped.
 */
export type ListedMessageId =
  | `error.${CliErrorCode}.what`
  | `error.${CliErrorCode}.fix`
  | `status.${TerminalRunStatus}`
  | `reason.${RunReason}`
  | `advice.${RunReason}`
  | `tool.${ToolName}`
  | `revert.skip.${RevertSkipReason}`;

export type MessageId = FixedMessageId | ListedMessageId;

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
];

/** The parameters a message takes (none for listed ids). */
export function messageParams(id: MessageId): { readonly [param: string]: MessageParamKind } {
  return Object.hasOwn(FIXED_MESSAGES, id) ? FIXED_MESSAGES[id as FixedMessageId] : {};
}

/** Parameters of one message: exactly the names FIXED_MESSAGES lists for it (none for listed ids). */
export type MessageParams = { readonly [name: string]: string | number };

/**
 * One language's fixed texts. `format` substitutes `{name}` with the parameter's value as given;
 * it never reads a file or the environment. A missing or extra parameter is a programming error
 * and throws.
 */
export interface MessageCatalog {
  readonly language: MessageLanguage;
  format(id: MessageId, params?: MessageParams): string;
}

/** Signature of `createMessageCatalog`, exported by `src/i18n/index.ts`. */
export type CreateMessageCatalog = (language: MessageLanguage) => MessageCatalog;

/**
 * How a command was given, for the "next command" hints of a run summary.
 * `workspace` is the `--workspace` value or "." for a one-line run, as typed and cleaned of
 * control characters; null for a task file run, whose workspace comes from the file and is not
 * shown (the hint then says `<workspace>`).
 */
export interface RunSummaryContext {
  readonly workspace: string | null;
  /** N-1: the config came from the default location; shown with DEFAULT_CONFIG_DISPLAY's value. */
  readonly configDefaultDisplay: string | null;
  /** N-8: the profile chosen with `--profile`, or null. */
  readonly profile: string | null;
}

/** For the revert summary's hints. `workspace` as for RunSummaryContext (always the typed value). */
export interface RevertSummaryContext {
  readonly workspace: string;
}

/**
 * Renders outputs as text for people, in the catalog's language. Every method returns complete
 * lines ending with LF (or null where noted) and never reads anything. The CLI masks the text
 * with the run's privacy gateway where it has one, replaces control characters, and writes it.
 */
export interface HumanOutput {
  /** N-5: stderr after any command that printed a CliErrorOutput: what, detail, how to fix, code. */
  error(output: CliErrorOutput): string;
  /**
   * N-5: stderr at the end of `run`: status and reason as words, verifier result, number of
   * changed files, denied calls (with the hint once), usage, run id, next commands with the real id.
   */
  runSummary(result: EngineResult, context: RunSummaryContext): string;
  /**
   * N-5: one progress line body for a journal record, without PROGRESS_PREFIX, or null for
   * records that are not shown. Codes go in parentheses after the words.
   */
  progressLine(event: JournalEvent): string | null;
  /** N-7: stderr after `revert` and `revert --dry-run`. */
  revertSummary(output: RevertOutput, context: RevertSummaryContext): string;
  /** N-7: stdout text of `codaryn runs` without `--json`. */
  runsText(output: RunsOutput): string;
}

/** Signature of `createHumanOutput`, exported by `src/cli/human/index.ts`. */
export type CreateHumanOutput = (messages: MessageCatalog) => HumanOutput;
