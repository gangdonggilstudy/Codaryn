/**
 * The human renderer's shared layout (IR-26 step 3 O1): the prefix and list limits, the checks of
 * values taken from outputs and records, time and line helpers, and the small public helpers.
 * output.ts passes its public names on; this module imports no other renderer module.
 */

import { DOCTOR_HINT_ERROR_CODES, PRIVATE_REVIEW_ITEM, TERMINAL_RUN_STATUSES, isReasonOfStatus, MODEL_PROVIDER_NAMES } from "../../contracts/index.js";
import type { MessageCatalog, ModelProviderName, RunReason, TerminalRunStatus } from "../../contracts/index.js";
import { isRunTimestamp } from "../../store/index.js";
import { finalLine, formatLocalTime } from "../../app/input/format.js";
import { FINAL_MESSAGE_MAX_LINES } from "../../app/model-text.js";

/** As PROGRESS_PREFIX in ../progress.ts. Error and revert titles start with it. */
export const HUMAN_PREFIX = "codaryn: ";
/** Changed files listed in a run summary. The rest are counted. */
export const SUMMARY_MAX_PATHS = 5;
/** Files listed per group in a revert summary. The rest are counted. */
export const REVERT_MAX_LISTED = 20;
/** Shown in place of a path that may not be printed (a `missing_record` path is unmasked). */
export const HIDDEN_PATH = "?";

/** N-22: the errors after which the error text adds `error.doctor_hint` (the contract's list). */
export const DOCTOR_CODES: ReadonlySet<string> = new Set<string>(DOCTOR_HINT_ERROR_CODES);

// SP-1: the contract's provider names, not a list of its own.
export const PROVIDERS: readonly ModelProviderName[] = MODEL_PROVIDER_NAMES;
export const WORKSPACE_FORMS = ["current", "given", "task"] as const;
/** EngineResult.plan.digest in its only valid form. */
export const DIGEST = /^[0-9a-f]{64}$/;
/** Plan problems shown in one preflight line. The rest are counted. */
export const PLAN_PROBLEMS_SHOWN = 5;
/** Apply reasons after which every action was applied (verification only runs then). */
export const APPLIED_ALL_REASONS: ReadonlySet<string> = new Set(["verified", "verifier_failed", "verifier_inconclusive", "protected_changed"]);
export const OUTCOMES = ["pass", "fail", "inconclusive"] as const;

export function isOneOf<T extends string>(value: unknown, list: readonly T[]): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export function isCount(value: unknown, min = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

export function validStatusReason(status: unknown, reason: unknown): { status: TerminalRunStatus; reason: RunReason } | null {
  if (!isOneOf(status, TERMINAL_RUN_STATUSES) || typeof reason !== "string") return null;
  // DR-16: the contract's one table of reasons per status (G-A reasons included).
  return isReasonOfStatus(status, reason) ? { status, reason } : null;
}

/** A recorded time in local wall time, or null when it is not a real timestamp (N-24(c)). */
export function localTime(at: unknown): string | null {
  return isRunTimestamp(at) ? formatLocalTime(Date.parse(at)) : null;
}

// DR-47: rows of the agent's last message shown in a run summary. U-280 (CLI migration C-3a): the
// app layer's now (src/app/model-text.ts); re-exported for the renderer's users and the tests.
export { FINAL_MESSAGE_MAX_LINES };

/** "(+3)" after a cut list. */
export function moreLine(count: number): string {
  return `  … (+${count})`;
}

/**
 * The code in parentheses after a title. A title that introduces a list ends with a colon in some
 * languages; the code then goes before the colon, so the colon still leads into the list.
 */
export function withCode(title: string, code: string): string {
  return title.endsWith(":") ? `${title.slice(0, -1)} (${code}):` : `${title} (${code})`;
}

/**
 * U-201 (U-176, U-193): the line after a run, an apply, a revert or a cleanup that finished but could
 * not release the workspace lock (`lockLeft` true in its summary context or CleanupOutcome):
 * `lock.release_failed`, which names no path (doctor's lock line names the file). Null otherwise.
 */
export function lockReleaseFailedLine(lockLeft: unknown, messages: MessageCatalog): string | null {
  return lockLeft === true ? messages.format("lock.release_failed") : null;
}

/**
 * U-207 (P-3): a review checklist entry that a built-in task type records in English, in the chosen
 * language: analyze-private's item (PRIVATE_REVIEW_ITEM, `review.item.no_identifying_values`). Null
 * for any other entry, which is shown as recorded. For `codaryn review` and the GUI as well.
 */
export function builtinReviewItemText(entry: unknown, messages: MessageCatalog): string | null {
  return entry === PRIVATE_REVIEW_ITEM ? messages.format("review.item.no_identifying_values") : null;
}

export function lines(out: readonly string[]): string {
  return `${out.map(finalLine).join("\n")}\n`;
}
