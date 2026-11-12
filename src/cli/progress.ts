/**
 * U-8: one progress line on stderr per notable journal record, while the run goes on.
 * Lines are built from the masked records only, masked again with the run's privacy gateway and
 * cleaned of control characters, so neither a secret nor a model-written name reaches the
 * terminal as is. Tool names outside the built-in set are not shown. A failing write is ignored:
 * progress never changes the run. stdout keeps its single JSON line.
 * DR-43 (b), review R-31 L-1: a record may give several lines; the run's start names, one line
 * each, what the workflow's rules left out of the given policy (run_started.policyNarrowings).
 */

import { TOOL_NAMES } from "../contracts/index.js";
import type { Journal, JournalEvent, PrivacyGateway } from "../contracts/index.js";
import { cleanText, safeToken } from "./text-safety.js";

export const PROGRESS_PREFIX = "codaryn: ";

/** Longest path shown in a progress line, in characters. */
const MAX_SHOWN_PATH = 200;

function toolName(name: string): string {
  return (TOOL_NAMES as readonly string[]).includes(name) ? name : "(unknown tool)";
}

function shownPath(text: string): string {
  const clean = cleanText(text);
  return clean.length > MAX_SHOWN_PATH ? `${clean.slice(0, MAX_SHOWN_PATH)}...` : clean;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * DR-43 (b): what the workflow's own rules left out of the given policy, in the words of the
 * catalog's English (progress.workflow_policy.*); kinds and counts only, no rule or path.
 */
export function narrowingLines(event: JournalEvent): string[] {
  if (event.type !== "run_started") return [];
  return (event.policyNarrowings ?? []).flatMap((narrowing): string[] => {
    const shown = Number.isSafeInteger(narrowing.count) && narrowing.count > 0 ? narrowing.count : null;
    switch (narrowing.kind) {
      case "commands_dropped":
        return shown === null ? [] : [`the workflow's own rules leave out command rules of the configured policy: ${shown}`];
      case "commands_narrowed":
        return shown === null ? [] : [`the workflow's own rules narrow command rules of the configured policy: ${shown}`];
      case "plan_actions_dropped":
        return shown === null ? [] : [`the workflow's own rules leave out plan actions of the configured policy: ${shown}`];
      case "restore_path_tokens_off":
        return ["the workflow's own rules turn off restoring path tokens, which the configured policy allows"];
      default:
        return [];
    }
  });
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
    case "model_response":
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
   * otherwise. DR-43 (b): it may give several lines for one record, each written on its own.
   */
  render: (event: JournalEvent) => string | readonly string[] | null = progressLines,
): Journal {
  return {
    async append(event) {
      await journal.append(event);
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
    },
    close: () => journal.close(),
  };
}
