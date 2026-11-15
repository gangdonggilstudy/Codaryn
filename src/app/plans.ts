/**
 * The plan view and the person's review for an adapter (adapter-contract 5.6; DR-1, DR-5, DR-17,
 * GT-D6, R-4 L-4): the `codaryn plan` and `codaryn review` arguments for a request. The CLI parses
 * and judges them (run id, task form, note length) and masks the plan and the note with the
 * secrets this task form registers.
 *
 * Two things are settled here because the CLI's argument reader cannot take them as values:
 * - a note that starts with `--` would read as an option, so it is refused with its own message;
 * - an empty note is no note (the reader refuses an empty value).
 */

import { appError } from "./errors.js";
import { taskFormArguments } from "./apply.js";
import type { AppError, PlanRequest, ReviewRequest } from "./types.js";

/** `codaryn plan <task form> --run <runId|latest> --json`. */
export function planArguments(request: PlanRequest): string[] {
  return ["plan", ...taskFormArguments(request.settings), "--run", request.runId, "--json"];
}

/** `codaryn review <task form> --run <runId|latest> (--accept | --reject) [--note <text>] --json`, or why not. */
export function reviewArguments(request: ReviewRequest): { readonly ok: true; readonly argv: string[] } | { readonly ok: false; readonly error: AppError } {
  if (request.decision !== "accept" && request.decision !== "reject") {
    return { ok: false, error: appError("invalid_arguments", "a review is accept or reject; nothing was written") };
  }
  const note = request.note === null || request.note === "" ? null : request.note;
  if (note !== null && typeof note !== "string") {
    return { ok: false, error: appError("invalid_arguments", "a review note is text; nothing was written") };
  }
  if (note !== null && note.startsWith("--")) {
    return { ok: false, error: appError("invalid_arguments", "a review note cannot start with --; nothing was written") };
  }
  const argv = ["review", ...taskFormArguments(request.settings), "--run", request.runId, request.decision === "accept" ? "--accept" : "--reject"];
  if (note !== null) argv.push("--note", note);
  argv.push("--json");
  return { ok: true, argv };
}
