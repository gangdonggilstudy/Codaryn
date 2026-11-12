/**
 * GU-4 (3.8), DR-39, DR-44: the app layer's state summary, cleanup preview and cleanup, as the
 * window may see them. The engine host keeps the known fields only (run ids, leftover ids, kinds,
 * statuses, times, counts, sizes, codes); nothing names a person's file. The shapes are checked
 * again by the main process (src/shared/cleanup.ts).
 */

import { cleanupPlanOf, cleanupResultOf, isCleanupTimestamp, stateSummaryOf } from "../shared/cleanup.js";
import { failureOf } from "./settings.js";
import type { HostFailure } from "./settings.js";

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);

function outputOf(outcome: unknown, kind: string): Obj | null {
  if (!isObj(outcome) || outcome["ok"] !== true || !isObj(outcome["output"])) return null;
  return outcome["output"]["kind"] === kind ? outcome["output"] : null;
}

const HOST_ERROR: HostFailure = { ok: false, code: "host_error" };

/** `stateSummary` → `{ok, summary}`. */
export function summaryValue(outcome: unknown): Obj | HostFailure {
  const output = outputOf(outcome, "state_summary");
  if (output === null) return isObj(outcome) && outcome["ok"] === true ? HOST_ERROR : failureOf(outcome);
  const summary = stateSummaryOf(output["summary"]);
  return summary === null ? HOST_ERROR : { ok: true, summary };
}

/** A CleanupItemRef as the window names it: a run id, or a leftover folder's 16 hex digits. */
function refOf(item: Obj): { target: unknown; id: unknown } {
  return { target: item["target"], id: item["target"] === "leftover" ? item["leftoverId"] : item["runId"] };
}

function sizeFields(value: unknown): { files: unknown; bytes: unknown } {
  return isObj(value) ? { files: value["files"], bytes: value["bytes"] } : { files: undefined, bytes: undefined };
}

/** `previewCleanup` → `{ok, now, plan}`: the plan's items, blocked items, totals, parked files and digest. */
export function previewValue(outcome: unknown): Obj | HostFailure {
  const output = outputOf(outcome, "cleanup_preview");
  if (output === null) return isObj(outcome) && outcome["ok"] === true ? HOST_ERROR : failureOf(outcome);
  const plan = output["plan"];
  if (!isObj(plan) || !Array.isArray(plan["items"]) || !Array.isArray(plan["blocked"]) || !isCleanupTimestamp(output["now"])) return HOST_ERROR;
  const view = cleanupPlanOf({
    items: plan["items"].map((item) => (isObj(item) ? { ...refOf(item), ...sizeFields(item["size"]), warnings: item["warnings"] } : item)),
    blocked: plan["blocked"].map((item) => (isObj(item) ? { target: item["target"], runId: item["runId"], code: item["code"] } : item)),
    totals: plan["totals"],
    parked: plan["parked"],
    digest: plan["digest"],
  });
  return view === null ? HOST_ERROR : { ok: true, now: output["now"], plan: view };
}

/** `applyCleanup` → `{ok, result}`: removed entirely, kept and why, or why nothing was (plan_changed, workspace_locked). */
export function appliedValue(outcome: unknown): Obj | HostFailure {
  const output = outputOf(outcome, "cleanup_applied");
  if (output === null) return isObj(outcome) && outcome["ok"] === true ? HOST_ERROR : failureOf(outcome);
  const result = output["outcome"];
  if (!isObj(result)) return HOST_ERROR;
  const view =
    result["ok"] === true && Array.isArray(result["removed"]) && Array.isArray(result["kept"])
      ? cleanupResultOf({
          ok: true,
          removed: result["removed"].map((item) => (isObj(item) ? { ...refOf(item), ...sizeFields(item["size"]) } : item)),
          kept: result["kept"].map((item) => (isObj(item) ? { ...refOf(item), reason: item["reason"] } : item)),
          totals: result["totals"],
        })
      : cleanupResultOf(result);
  return view === null ? HOST_ERROR : { ok: true, result: view };
}
