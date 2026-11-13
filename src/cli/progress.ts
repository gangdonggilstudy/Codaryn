/**
 * U-8: one progress line on stderr per notable journal record, while the run goes on.
 * Lines are built from the masked records only, masked again with the run's privacy gateway and
 * cleaned of control characters, so neither a secret nor a model-written name reaches the
 * terminal as is. Tool names outside every tool list are not shown (U-267: the task type tools are
 * named, ALL_TOOL_NAMES, as the renderer names them). A failing write is ignored:
 * progress never changes the run. stdout keeps its single JSON line.
 * DR-43 (b), review R-31 L-1: a record may give several lines; the run's start names, one line
 * each, what the task type's rules left out of the given policy (run_started.policyNarrowings).
 * U-58 (R-65 I-2): without a renderer the English lines give a line for the same records as the
 * renderer does: a failed call, and a command that exited with a code other than 0 or timed out.
 */

import { ALL_TOOL_NAMES } from "../contracts/index.js";
import type { Journal, JournalEvent, PrivacyGateway } from "../contracts/index.js";
import { createFailedCalls } from "./failed-calls.js";
import { cleanText, safeToken } from "./text-safety.js";

export const PROGRESS_PREFIX = "codaryn: ";

/** Longest path shown in a progress line, in characters. */
const MAX_SHOWN_PATH = 200;

/** A tool a task may list (built-in or task type), else "(unknown tool)": a model-written name is never shown. */
function toolName(name: string): string {
  return (ALL_TOOL_NAMES as readonly string[]).includes(name) ? name : "(unknown tool)";
}

function shownPath(text: string): string {
  const clean = cleanText(text);
  return clean.length > MAX_SHOWN_PATH ? `${clean.slice(0, MAX_SHOWN_PATH)}...` : clean;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * DR-43 (b): what the task type's own rules left out of the given policy, in the words of the
 * catalog's English (progress.workflow_policy.*, DR-50: task type); kinds and counts only, no rule or path.
 */
export function narrowingLines(event: JournalEvent): string[] {
  if (event.type !== "run_started") return [];
  return (event.policyNarrowings ?? []).flatMap((narrowing): string[] => {
    const shown = Number.isSafeInteger(narrowing.count) && narrowing.count > 0 ? narrowing.count : null;
    switch (narrowing.kind) {
      case "commands_dropped":
        return shown === null ? [] : [`the task type's own rules leave out command rules of the configured policy: ${shown}`];
      case "commands_narrowed":
        return shown === null ? [] : [`the task type's own rules narrow command rules of the configured policy: ${shown}`];
      case "plan_actions_dropped":
        return shown === null ? [] : [`the task type's own rules leave out plan actions of the configured policy: ${shown}`];
      case "restore_path_tokens_off":
        return ["the task type's own rules turn off restoring path tokens, which the configured policy allows"];
      case "verifiers_dropped":
        return shown === null ? [] : [`the task type's own checks leave out checks given in the config or task with the same id: ${shown}`];
      default:
        return [];
    }
  });
}

/**
 * U-18 (AXM-4): the English lines of one run, records in journal order: progressLines', and for a
 * call that was allowed and then failed (failed-calls.ts) a line with its tool error code. Each
 * call gives its own state (the calls denied so far), so give each run its own.
 */
export function englishProgressLines(): (event: JournalEvent) => string[] {
  const failed = createFailedCalls();
  return (event) => {
    const lines = progressLines(event);
    if (failed.observe(event) && event.type === "tool_result") {
      lines.unshift(`tool ${toolName(event.result.tool)}: failed (${safeToken(event.result.errorCode ?? "none")})`);
    }
    // U-58 (R-65 I-2): a command that ran, as the renderer tells it.
    const command = commandLine(event);
    if (command !== null) lines.unshift(command);
    return lines;
  };
}

/**
 * U-58 (R-65 I-2): a `run_command` result that is ok but timed out, or else exited with a code other
 * than 0, by its content (the masked JSON of RunCommandPayload), in the catalog's English
 * (progress.command_timed_out, progress.command_exited). Not a failed call (PM Q-2 (a)). Content
 * that does not parse, an exit code that is not a positive integer, or a null exit code without a
 * timeout (a stopped command): no line, as with the renderer.
 */
function commandLine(event: JournalEvent): string | null {
  if (event.type !== "tool_result") return null;
  const told = event.result;
  if (told.ok !== true || told.tool !== "run_command" || typeof told.content !== "string") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(told.content);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const { exitCode, timedOut } = payload as { readonly exitCode?: unknown; readonly timedOut?: unknown };
  if (timedOut === true) return "command ran — stopped at its time limit";
  return typeof exitCode === "number" && Number.isSafeInteger(exitCode) && exitCode >= 1 ? `command ran — exit code ${exitCode}` : null;
}

/** The lines for one record, without the prefix: progressLine's, then the narrowings at the start. */
export function progressLines(event: JournalEvent): string[] {
  const line = progressLine(event);
  return [...(line === null ? [] : [line]), ...narrowingLines(event)];
}

/** The line for one record, without the prefix, or null for records that are not shown. */
export function progressLine(event: JournalEvent): string | null {
  switch (event.type) {
    case "run_started":
      return `run started: task ${safeToken(event.taskId)}, provider ${safeToken(event.provider)}`;
    case "model_request":
      return `turn ${event.turn}`;
    case "model_error":
      return `turn ${event.turn}: model error ${safeToken(event.kind)}`;
    case "tool_decision":
      if (event.allowed) return `tool ${toolName(event.tool)}: allowed`;
      return `tool ${toolName(event.tool)}: denied (${safeToken(event.permission ?? "check")}/${safeToken(event.code ?? "none")})`;
    case "file_changed":
      return `${event.created ? "created" : "changed"} ${shownPath(event.path)}`;
    case "verifier_result":
      return `verifier ${safeToken(event.result.id)}: ${safeToken(event.result.outcome)}`;
    case "repair_started":
      return `repair ${event.attempt}: ${count(event.failedVerifiers.length, "verifier", "verifiers")} failed`;
    case "integrity_checked":
      return event.changed.length === 0
        ? `protected material ${event.phase}: unchanged`
        : `protected material ${event.phase}: ${count(event.changed.length, "path", "paths")} changed or not checkable`;
    case "state_checked":
      // DR-38: a check of the run records around commands and verification. Only a change or a
      // part that could not be checked is worth a line; an unchanged check says nothing.
      if (event.changed.length > 0) return `run records ${safeToken(event.phase)}: ${count(event.changed.length, "path", "paths")} changed outside the run`;
      return event.limited ? `run records ${safeToken(event.phase)}: part of the state could not be checked` : null;
    case "run_finished":
      return `finished: ${safeToken(event.status)} (${safeToken(event.reason)})`;
    // U-74 (DR-3, DR-10): the in-run permission question. The masked executable and the number of
    // arguments only (the arguments are the model's text and are never in the record).
    case "confirmation_requested": {
      const argumentCount = Number.isSafeInteger(event.argumentCount) && event.argumentCount >= 0 ? event.argumentCount : 0;
      return `tool ${toolName(event.tool)}: permission question ${safeToken(event.id)} for ${shownPath(event.subject)} (${count(argumentCount, "argument", "arguments")})`;
    }
    case "confirmation_answered":
      return event.decision === "allow_once"
        ? `permission question ${safeToken(event.id)}: allowed for this call once`
        : `permission question ${safeToken(event.id)}: denied (${safeToken(event.by)})`;
    case "model_response":
    // U-18: a failed call's result needs the run's earlier decisions (englishProgressLines).
    case "tool_result":
      return null;
  }
}

/**
 * Wraps the run's journal: after a record is stored, its progress line (if any) is written.
 * `write` receives one complete line including the line feed.
 */
export function withProgress(
  journal: Journal,
  privacy: PrivacyGateway,
  write: (line: string) => void,
  /**
   * N-5: the human renderer's `progressLine` in the chosen language; the English lines above
   * otherwise (one state per journal, U-18). DR-43 (b): it may give several lines for one record,
   * each written on its own.
   */
  render: (event: JournalEvent) => string | readonly string[] | null = englishProgressLines(),
): Journal {
  return {
    async append(event) {
      const stored = await journal.append(event);
      let lines: readonly string[];
      try {
        const drawn = render(event);
        lines = drawn === null ? [] : typeof drawn === "string" ? [drawn] : drawn;
      } catch {
        lines = [];
      }
      for (const line of lines) {
        const masked = privacy.mask(`${PROGRESS_PREFIX}${line}`);
        if (!masked.ok) continue;
        try {
          write(`${cleanText(masked.text)}\n`);
        } catch {
          // Progress is best effort.
        }
      }
      return stored;
    },
    close: () => journal.close(),
  };
}
