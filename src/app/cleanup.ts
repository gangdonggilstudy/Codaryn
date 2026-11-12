/**
 * DR-39 for the GUI (standalone-gui 3.8, GU-4): seeing and cleaning up the state directory through
 * the store's summarizeState, planCleanup and applyCleanup.
 *
 * - What would be removed comes first: previewCleanup makes the plan (items with their warnings,
 *   blocked items, totals, the parked files that are never cleaned, and the plan's digest) and
 *   removes nothing. It returns the moment the plan counted `olderThanDays` from, so the apply makes
 *   the same plan.
 * - Only what the person confirmed is removed: applyCleanup passes the confirmation to the store:
 *   the digest of the plan shown, and apart from it whether the discarded-files folders (people's
 *   own files) may go and (DR-44 (a)) whether the records of runs not reverted or only partly
 *   reverted may go. The store makes the plan again under the workspace lock and removes nothing
 *   unless its digest is the confirmed one. The GUI's main process asks the person each question.
 * - DR-48 (AXM-3): a cleanup that was carried out says what it did with the contract's one rule
 *   (cleanupStatusOf: removed, nothing_removed, partly_failed), and its outcome is `ok` for
 *   `removed` only, as the CLI's JSON. A digest that is not the plan's is the error
 *   `cleanup_plan_changed` and a held lock `workspace_locked`; neither is an outcome.
 * - DR-44 and U-13: the store's warnings (partly_reverted, discarded_left, leftover), leftover
 *   folders and kept reasons (partly_removed, not_reverted_not_confirmed, used_by_kept_apply,
 *   discarded_left) are passed on as they are.
 * - Arguments are checked before anything is read: exact run directory names (isStoredRunId), whole
 *   non-negative day counts, `reverted: true` only, no unknown field, a timestamp of the contract's
 *   form, a 64-hex digest, a boolean for the discarded files.
 * - The values name run ids, sizes and codes only, never a person's file name or a path.
 */

import { RUN_TIMESTAMP_PATTERN_SOURCE, cleanupStatusOf } from "../contracts/index.js";
import type { CleanupConfirmation, CleanupFailureCode, CleanupSelection } from "../contracts/index.js";
import { applyCleanupWith, isStoredRunId, planCleanup, summarizeState } from "../store/index.js";
import type { CleanupOperations } from "../store/index.js";
import { INTERNAL_ERROR, appError } from "./errors.js";
import { workspaceRootOf } from "./runs.js";
import type {
  AppCallOutcome,
  AppEnvironment,
  AppError,
  ApplyCleanupRequest,
  CleanupApplied,
  CleanupPreview,
  CleanupPreviewRequest,
  StateSummaryRequest,
  StateSummaryView,
} from "./types.js";

/** Most run ids one part of a selection names. */
export const MAX_CLEANUP_RUN_IDS = 10_000;
/** Most days `olderThanDays` counts (100 years). */
const MAX_DAYS = 36_500;
const RUN_TIMESTAMP = new RegExp(RUN_TIMESTAMP_PATTERN_SOURCE);
const DIGEST = /^[0-9a-f]{64}$/;

type Checked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ReturnType<typeof appError> };

const invalid = (message: string) => ({ ok: false as const, error: appError("invalid_arguments", message) });
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every((key) => keys.includes(key));

/** One part of a selection (`runs` or `discarded`), checked field by field. */
function partOf(value: unknown, name: string, withReverted: boolean): Checked<{ olderThanDays?: number; runIds?: string[]; reverted?: true } | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  const keys = withReverted ? ["olderThanDays", "runIds", "reverted"] : ["olderThanDays", "runIds"];
  if (!isRecord(value) || !onlyKeys(value, keys)) return invalid(`selection.${name} may only have ${keys.join(", ")}`);
  const part: { olderThanDays?: number; runIds?: string[]; reverted?: true } = {};
  const days = value["olderThanDays"];
  if (days !== undefined) {
    if (typeof days !== "number" || !Number.isSafeInteger(days) || days < 0 || days > MAX_DAYS) return invalid(`selection.${name}.olderThanDays must be a whole number from 0 to ${MAX_DAYS}`);
    part.olderThanDays = days;
  }
  const ids = value["runIds"];
  if (ids !== undefined) {
    if (!Array.isArray(ids) || ids.length > MAX_CLEANUP_RUN_IDS || !ids.every((id) => typeof id === "string" && isStoredRunId(id))) {
      return invalid(`selection.${name}.runIds must be a list of run ids (at most ${MAX_CLEANUP_RUN_IDS})`);
    }
    part.runIds = [...(ids as string[])];
  }
  if (withReverted && value["reverted"] !== undefined) {
    if (value["reverted"] !== true) return invalid(`selection.${name}.reverted may only be true`);
    part.reverted = true;
  }
  return { ok: true, value: part };
}

/** A selection of the contract's shape, or why not. */
export function cleanupSelectionOf(value: unknown): Checked<CleanupSelection> {
  if (!isRecord(value) || !onlyKeys(value, ["runs", "discarded"])) return invalid("the selection may only have runs and discarded");
  const runs = partOf(value["runs"], "runs", true);
  if (!runs.ok) return runs;
  const discarded = partOf(value["discarded"], "discarded", false);
  if (!discarded.ok) return discarded;
  return { ok: true, value: { ...(runs.value === undefined ? {} : { runs: runs.value }), ...(discarded.value === undefined ? {} : { discarded: discarded.value }) } };
}

/**
 * The person's confirmation: the plan's digest, and each asked apart (DR-44 (a)): whether the
 * discarded-files folders (people's files) may go, and whether the records of runs not reverted or
 * only partly reverted may go. Both are required booleans, so a confirmation never says yes by
 * leaving one out.
 */
function confirmationOf(value: unknown): Checked<CleanupConfirmation> {
  if (!isRecord(value) || !onlyKeys(value, ["digest", "discarded", "includeNotReverted"])) {
    return invalid("the confirmation is the plan's digest, whether the discarded files may go and whether runs not reverted may go");
  }
  const { digest, discarded, includeNotReverted } = value;
  if (typeof digest !== "string" || !DIGEST.test(digest)) return invalid("the confirmation's digest must be the plan's 64 hex characters");
  if (typeof discarded !== "boolean") return invalid("the confirmation's discarded must be true or false");
  if (typeof includeNotReverted !== "boolean") return invalid("the confirmation's includeNotReverted must be true or false");
  return { ok: true, value: { digest, discarded, includeNotReverted } };
}

export async function stateSummaryIn(environment: AppEnvironment, request: StateSummaryRequest): Promise<AppCallOutcome<StateSummaryView>> {
  const root = await workspaceRootOf(request.workspace, environment.cwd);
  if (!root.ok) return root;
  try {
    return { ok: true, output: { kind: "state_summary", summary: await summarizeState({ workspaceRoot: root.value }) } };
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }
}

export async function previewCleanupIn(environment: AppEnvironment, request: CleanupPreviewRequest): Promise<AppCallOutcome<CleanupPreview>> {
  const selection = cleanupSelectionOf(request.selection);
  if (!selection.ok) return selection;
  const root = await workspaceRootOf(request.workspace, environment.cwd);
  if (!root.ok) return root;
  const now = new Date(environment.clock.now()).toISOString();
  try {
    return { ok: true, output: { kind: "cleanup_preview", now, plan: await planCleanup({ workspaceRoot: root.value, selection: selection.value, now }) } };
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }
}

/** DR-48: why nothing was removed, as the call's error (fixed text, no path or value). */
function cleanupFailure(code: CleanupFailureCode): AppError {
  switch (code) {
    case "plan_changed":
      return appError("cleanup_plan_changed", "the plan made again under the lock is not the confirmed one (the state changed since the preview, or another digest was given); nothing was removed. Preview again and confirm its digest.");
    case "workspace_locked":
      return appError("workspace_locked", "another task holds the workspace lock; nothing was removed. Try again when it ends.");
  }
}

export async function applyCleanupIn(environment: AppEnvironment, request: ApplyCleanupRequest, operations: CleanupOperations = {}): Promise<AppCallOutcome<CleanupApplied>> {
  const selection = cleanupSelectionOf(request.selection);
  if (!selection.ok) return selection;
  if (typeof request.now !== "string" || !RUN_TIMESTAMP.test(request.now)) return invalid("now must be the preview's moment");
  const confirmation = confirmationOf(request.confirmation);
  if (!confirmation.ok) return confirmation;
  const root = await workspaceRootOf(request.workspace, environment.cwd);
  if (!root.ok) return root;
  try {
    const outcome = await applyCleanupWith({ workspaceRoot: root.value, selection: selection.value, now: request.now, confirmation: confirmation.value }, operations);
    if (!outcome.ok) return { ok: false, error: cleanupFailure(outcome.code) };
    const status = cleanupStatusOf(outcome);
    return { ok: true, output: { kind: "cleanup_applied", status, outcome: { ...outcome, ok: status === "removed" } } };
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }
}
