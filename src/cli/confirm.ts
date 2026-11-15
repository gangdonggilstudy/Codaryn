/**
 * U-110 (B-5, DR-3, DR-10): the permission question at a terminal, as the engine's
 * EngineDeps.confirm (ConfirmPermission). `run` gives it to the engine only when the CLI has a
 * terminal to ask at (standard input and stderr) and --quiet is not given; otherwise the engine has
 * no one to ask and denies by default.
 * - The question (contract: confirm.question.command): its text with the number of arguments, ": ",
 *   the masked executable (ConfirmRequest.subject), then prompt.yes_no_default_no. The arguments
 *   themselves are never shown.
 * - The answer, as apply's question reads it: y, yes, 예 or 네 (trimmed, any case) allows this one
 *   call; anything else, Enter included, denies it (by the person). No line at all (end of input,
 *   an asking that failed) is no answer: `dismissed`, which the engine records as deny by default.
 */

import type { ConfirmAnswer, ConfirmPermission, ConfirmRequest, MessageCatalog } from "../contracts/index.js";
import { cleanText } from "../app/input/text-safety.js";

/** apply's yes answers (plan-commands), compared trimmed and in lower case. */
const YES = new Set(["y", "yes", "예", "네"]);

/** A terminal's one-line question (main gives it only when standard input and stderr are terminals). */
export type AskLine = (question: string, signal: AbortSignal) => Promise<string | null>;

/** The question line for a command permission, ending in one space for the answer. */
export function confirmQuestion(request: ConfirmRequest, messages: MessageCatalog): string {
  const count = Number.isSafeInteger(request.argumentCount) && request.argumentCount >= 0 ? request.argumentCount : 0;
  return `${messages.format("confirm.question.command", { count })}: ${cleanText(request.subject)} ${messages.format("prompt.yes_no_default_no")} `;
}

/** What a line read means: allow this call once, deny it, or no answer (no line). */
export function confirmAnswerOf(line: string | null): ConfirmAnswer {
  if (line === null) return { decision: "dismissed" };
  return { decision: YES.has(line.trim().toLowerCase()) ? "allow_once" : "deny" };
}

/**
 * EngineDeps.confirm over a terminal. Only a command permission has a question text; any other is
 * not asked (no answer, so denied by default).
 */
export function terminalConfirm(ask: AskLine, messages: MessageCatalog): ConfirmPermission {
  return async (request, signal) => {
    if (request.permission !== "command") return { decision: "dismissed" };
    let line: string | null;
    try {
      line = await ask(confirmQuestion(request, messages), signal);
    } catch {
      line = null;
    }
    return confirmAnswerOf(line);
  };
}
