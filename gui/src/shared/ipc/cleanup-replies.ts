/** Cleanup IPC arguments and replies. Public callers use ../ipc.js. */
import { hasOnlyKeys, isHandle, isObj, hostCodeOf } from "./primitives.js";
import { cleanupPlanOf, cleanupResultOf, isCleanupTimestamp, parseCleanupSelection, stateSummaryOf } from "../cleanup.js";
import type { CleanupPlanView, CleanupResultView, CleanupSelectionArg, StateSummaryView } from "../cleanup.js";

/** GU-4 (3.8), DR-39: the state summary as the window gets it. */
export type StateSummaryReply = { readonly ok: true; readonly summary: StateSummaryView } | { readonly ok: false; readonly code: string };

/** DR-39, DR-44: a cleanup preview: a token for the plan the main process keeps, and the plan to show. */
export type CleanupPreviewReply = { readonly ok: true; readonly token: string; readonly plan: CleanupPlanView } | { readonly ok: false; readonly code: string };

export type CleanupResultReply = { readonly ok: true; readonly result: CleanupResultView } | { readonly ok: false; readonly code: string };

/** The engine host's summary value, checked. */
export function toStateSummaryReply(value: unknown): StateSummaryReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const summary = stateSummaryOf(value["summary"]);
  return summary === null ? { ok: false, code: "host_error" } : { ok: true, summary };
}

/** The engine host's preview value, checked: the plan and the moment it was counted from (kept by the main process). */
export function toHostCleanupPreview(value: unknown): { readonly ok: true; readonly now: string; readonly plan: CleanupPlanView } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const plan = cleanupPlanOf(value["plan"]);
  return plan === null || !isCleanupTimestamp(value["now"]) ? { ok: false, code: "host_error" } : { ok: true, now: value["now"], plan };
}

/** The engine host's cleanup value, checked. */
export function toCleanupResultReply(value: unknown): CleanupResultReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const result = cleanupResultOf(value["result"]);
  return result === null ? { ok: false, code: "host_error" } : { ok: true, result };
}

/** GU-4: `previewCleanup` arguments: `{workspace, selection}`. */
export function parseCleanupPreviewArgs(value: unknown): { readonly workspace: string; readonly selection: CleanupSelectionArg } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace", "selection"]) || !isHandle(value["workspace"])) return null;
  const selection = parseCleanupSelection(value["selection"]);
  return selection === null ? null : { workspace: value["workspace"], selection };
}
