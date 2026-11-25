/** Renderer run, plan, report and cleanup replies. Public callers use ./api.js. */
import type {
  ChangedFileItem,
  ChangesReply,
  PlanReply,
  ReportReply,
  ReportView,
  PlanView,
  ReviewReply,
  RevertReply,
  RevertView,
  RunDonePayload,
  PlanApplyView,
  RunListItem,
  RunsReply,
  RunEventsPayload,
  RunItemView,
  RunResultView,
  RunEventsReply,
  PlanCheckReply,
} from "../shared/ipc.js";
import type { CleanupPlanView, CleanupResultView, StateSummaryView } from "../shared/cleanup.js";
import { asForm, failed, HEX, isObj, RUN_ID, str } from "./api-core.js";

/** GU-3: the answer to startRun. */
export function asStartRun(value: unknown): { readonly ok: true; readonly runId: string } | { readonly ok: false; readonly code: string; readonly hint?: string } {
  if (isObj(value) && value["ok"] === true && str(value["runId"]) && RUN_ID.test(value["runId"])) return { ok: true, runId: value["runId"] };
  // U-212: the CLI's hint id, when the main process passed one.
  const hint = isObj(value) ? value["hint"] : undefined;
  return { ...failed(value), ...(str(hint) && /^[a-z][a-z0-9_]{0,63}$/.test(hint) ? { hint } : {}) };
}

/** GU-3: a batch of progress items; null when it does not fit. */
export function asRunEvents(value: unknown): RunEventsPayload | null {
  if (!isObj(value) || !str(value["runId"]) || !Array.isArray(value["items"]) || !isObj(value["counts"])) return null;
  const items: RunItemView[] = value["items"].flatMap((item: unknown) =>
    isObj(item) && str(item["kind"]) && str(item["text"]) && (item["at"] === null || str(item["at"])) ? [{ at: item["at"] as string | null, kind: item["kind"], text: item["text"] }] : [],
  );
  const n = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
  // U-271 (3.6): the run's limits checked again (whole numbers above 0); left out when they do not fit.
  const given = value["counts"]["limits"];
  const above = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
  const lTurns = isObj(given) ? given["turns"] : null;
  const lTools = isObj(given) ? given["tools"] : null;
  const lTime = isObj(given) ? given["durationMs"] : null;
  const limits = above(lTurns) && above(lTools) && above(lTime) ? { turns: lTurns, tools: lTools, durationMs: lTime } : null;
  return { runId: value["runId"], items, counts: { turns: n(value["counts"]["turns"]), tools: n(value["counts"]["tools"]), ...(limits === null ? {} : { limits }) } };
}

/** GU-3: a run's end; null when it does not fit. The main process checked the result already. */
export function asRunDone(value: unknown): RunDonePayload | null {
  if (!isObj(value) || !str(value["runId"])) return null;
  if (value["ok"] !== true) return { runId: value["runId"], ok: false, code: str(value["code"]) ? value["code"] : "host_error" };
  const result = value["result"];
  const labels = value["labels"];
  if (!isObj(result) || !str(result["status"]) || !str(result["reason"]) || !isObj(labels) || !str(labels["status"]) || !str(labels["reason"])) return null;
  return { runId: value["runId"], ok: true, result: result as unknown as RunResultView, labels: { status: labels["status"], reason: labels["reason"] } };
}

/** GU-4: the run list. Rows that do not fit are left out. */
/** U-61: a row's plan apply state (the main process checked it; the window takes the known states only). */
function asPlanApply(value: unknown): PlanApplyView | null {
  if (!isObj(value) || !str(value["applyRunId"]) || !RUN_ID.test(value["applyRunId"])) return null;
  const state = value["state"];
  if (state !== "applied" && state !== "unfinished" && state !== "applying" && state !== "reverted" && state !== "record_missing") return null;
  return { state, applyRunId: value["applyRunId"], reason: str(value["reason"]) ? value["reason"] : null, ...(value["carried"] === true ? { carried: true as const } : {}) };
}

export function asRuns(value: unknown): RunsReply {
  if (!isObj(value) || value["ok"] !== true || !Array.isArray(value["runs"])) return failed(value);
  const runs: RunListItem[] = value["runs"].flatMap((run: unknown): RunListItem[] => {
    if (!isObj(run) || !str(run["runId"]) || !RUN_ID.test(run["runId"])) return [];
    if (run["state"] === "damaged") return [{ state: "damaged", runId: run["runId"] }];
    if (run["state"] !== "checked" || (run["kind"] !== "run" && run["kind"] !== "apply") || !str(run["taskId"])) return [];
    const reverted = isObj(run["reverted"]) && str(run["reverted"]["at"]) ? { at: run["reverted"]["at"], status: run["reverted"]["status"] === "partial" ? ("partial" as const) : ("complete" as const) } : null;
    return [
      {
        state: "checked",
        runId: run["runId"],
        kind: run["kind"],
        startedAt: str(run["startedAt"]) ? run["startedAt"] : null,
        taskId: run["taskId"],
        status: str(run["status"]) ? run["status"] : null,
        reason: str(run["reason"]) ? run["reason"] : null,
        changes: typeof run["changes"] === "number" ? run["changes"] : null,
        reverted,
        revertRecordDamaged: run["revertRecordDamaged"] === true,
        recordsChanged: run["recordsChanged"] === true,
        planApply: asPlanApply(run["planApply"]),
        planRunId: str(run["planRunId"]) && RUN_ID.test(run["planRunId"]) ? run["planRunId"] : null,
        phase: run["phase"] === "running" || run["phase"] === "no_result" ? run["phase"] : null,
        form: asForm(run["form"]),
      },
    ];
  });
  return { ok: true, runs, omitted: typeof value["omitted"] === "number" ? value["omitted"] : 0 };
}

/** GU-4: a revert or its preview (the main process checked the view already). */
export function asRevert(value: unknown): RevertReply {
  if (!isObj(value) || value["ok"] !== true || !isObj(value["view"])) return failed(value);
  const view = value["view"];
  if (!str(view["runId"]) || !Array.isArray(view["reverted"]) || !Array.isArray(view["skipped"])) return failed(value);
  const preview = str(value["preview"]) && HEX.test(value["preview"]) ? value["preview"] : null;
  const consentRetry = str(value["consentRetry"]) && HEX.test(value["consentRetry"]) ? value["consentRetry"] : null;
  return { ok: true, view: view as unknown as RevertView, preview, consentRetry };
}

/** GU-5: a plan view (the main process checked it already) and the approval token its apply takes. */
export function asPlan(value: unknown): PlanReply {
  if (!isObj(value) || value["ok"] !== true || !isObj(value["view"])) return failed(value);
  const view = value["view"];
  if (!str(view["runId"]) || !str(view["digest"]) || !Array.isArray(view["actions"]) || (view["status"] !== "pending" && view["status"] !== "applied")) return failed(value);
  // U-206: a run plan names its kind and lists its files (the main process checked each).
  if (view["planKind"] !== undefined && (view["planKind"] !== "changes" || !Array.isArray(view["files"]))) return failed(value);
  const approval = str(value["approval"]) && HEX.test(value["approval"]) ? value["approval"] : null;
  return { ok: true, view: view as unknown as PlanView, approval };
}

/** GU-5: a recorded review. */
export function asReview(value: unknown): ReviewReply {
  if (!isObj(value) || value["ok"] !== true || (value["verdict"] !== "accepted" && value["verdict"] !== "rejected")) return failed(value);
  return { ok: true, verdict: value["verdict"], replaced: value["replaced"] === true };
}

/** DR-29: a run's changed files, by path and state. Rows that do not fit are left out. U-48: the run's records-changed mark. */
export function asChanges(value: unknown): ChangesReply {
  if (!isObj(value) || value["ok"] !== true || !str(value["runId"]) || !Array.isArray(value["files"])) return failed(value);
  const files: ChangedFileItem[] = value["files"].flatMap((file: unknown): ChangedFileItem[] =>
    isObj(file) && str(file["path"]) && typeof file["created"] === "boolean" && str(file["state"])
      ? [
          {
            path: file["path"],
            created: file["created"],
            state: file["state"] as ChangedFileItem["state"],
            unavailable: str(file["unavailable"]) ? file["unavailable"] : null,
            before: str(file["before"]) ? file["before"] : null,
            after: str(file["after"]) ? file["after"] : null,
            // U-66: the main process's id for "show in folder", or null.
            id: str(file["id"]) && HEX.test(file["id"]) ? file["id"] : null,
          },
        ]
      : [],
  );
  return { ok: true, runId: value["runId"], recordsChanged: value["recordsChanged"] === true, files };
}

/** U-119: the check before an apply (the main process checked it already). */
export function asPlanCheck(value: unknown): PlanCheckReply {
  if (!isObj(value) || value["ok"] !== true || !Array.isArray(value["problems"]) || !Array.isArray(value["unsafeMoves"])) return failed(value);
  const n = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
  return {
    ok: true,
    ...(value["planKind"] === "changes" ? { planKind: "changes" as const } : {}),
    problems: value["problems"].flatMap((item: unknown) => (isObj(item) && typeof item["index"] === "number" && str(item["problem"]) ? [{ index: n(item["index"]), problem: item["problem"] }] : [])),
    unsafeMoves: value["unsafeMoves"].filter((index: unknown): index is number => typeof index === "number" && Number.isSafeInteger(index) && index >= 0),
    inventoryLimitReached: value["inventoryLimitReached"] === true,
    probesLeft: n(value["probesLeft"]),
    probesRemoved: n(value["probesRemoved"]),
    lockLeft: value["lockLeft"] === true,
  };
}

/** U-118: a page of a run's records (the main process checked it already). Items that do not fit are left out. */
export function asRunEventsPage(value: unknown): RunEventsReply {
  if (!isObj(value) || value["ok"] !== true || !str(value["runId"]) || !Array.isArray(value["items"])) return failed(value);
  const status = value["status"];
  if (status !== "complete" && status !== "incomplete" && status !== "damaged") return failed(value);
  const n = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
  const items = value["items"].flatMap((item: unknown) => (isObj(item) && str(item["kind"]) && str(item["text"]) ? [{ at: str(item["at"]) ? item["at"] : null, kind: item["kind"], text: item["text"] }] : []));
  const next = value["nextOffset"];
  return {
    ok: true,
    runId: value["runId"],
    runKind: value["runKind"] === "apply" ? "apply" : "run",
    status,
    recordsChanged: value["recordsChanged"] === true,
    items,
    records: n(value["records"]),
    total: n(value["total"]),
    skipped: n(value["skipped"]),
    missing: n(value["missing"]),
    offset: n(value["offset"]),
    nextOffset: typeof next === "number" && Number.isSafeInteger(next) && next >= 0 ? next : null,
  };
}

/** GU-3: a run's report (the main process checked it already). */
export function asReport(value: unknown): ReportReply {
  if (!isObj(value) || value["ok"] !== true || !isObj(value["view"])) return failed(value);
  const view = value["view"];
  if (!str(view["runId"]) || (view["kind"] !== "run" && view["kind"] !== "apply") || !Array.isArray(view["verifiers"]) || !Array.isArray(view["integrity"])) return failed(value);
  const labels = value["labels"];
  return {
    ok: true,
    view: view as unknown as ReportView,
    labels: isObj(labels) && str(labels["status"]) && str(labels["reason"]) ? { status: labels["status"], reason: labels["reason"] } : null,
  };
}

/** GU-4: the state summary (the main process checked it). */
export function asStateSummary(value: unknown): { readonly ok: true; readonly summary: StateSummaryView } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true || !isObj(value["summary"])) return failed(value);
  const summary = value["summary"];
  if (!Array.isArray(summary["entries"]) || !isObj(summary["runs"]) || !isObj(summary["discarded"]) || !isObj(summary["parked"]) || !isObj(summary["leftovers"])) return failed(value);
  return { ok: true, summary: summary as unknown as StateSummaryView };
}

/** GU-4: a cleanup preview: the main process's token and the plan to show. */
export function asCleanupPreview(value: unknown): { readonly ok: true; readonly token: string; readonly plan: CleanupPlanView } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true || !str(value["token"]) || !HEX.test(value["token"]) || !isObj(value["plan"])) return failed(value);
  const plan = value["plan"];
  if (!Array.isArray(plan["items"]) || !Array.isArray(plan["blocked"]) || !isObj(plan["totals"]) || !isObj(plan["parked"]) || !str(plan["digest"])) return failed(value);
  return { ok: true, token: value["token"], plan: plan as unknown as CleanupPlanView };
}

/** GU-4: a cleanup's result, or why the main process did not clean (not_confirmed, unknown_preview, ...). */
export function asCleanupResult(value: unknown): { readonly ok: true; readonly result: CleanupResultView } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true || !isObj(value["result"])) return failed(value);
  const result = value["result"];
  if (result["ok"] === false) return { ok: true, result: { ok: false, code: str(result["code"]) ? result["code"] : "host_error" } };
  if (result["ok"] !== true || !Array.isArray(result["removed"]) || !Array.isArray(result["kept"]) || !isObj(result["totals"])) return failed(value);
  // DR-48: CLEANUP_RESULT_STATUSES of src/shared/cleanup.ts (the page loads nothing from there).
  if (!["removed", "nothing_removed", "partly_failed"].includes(result["status"] as string)) return failed(value);
  return { ok: true, result: result as unknown as CleanupResultView };
}

/** GU-3: a saved report: the chosen file's name, or why it was not saved (not_saved: the dialog was cancelled). */
export function asSaveReport(value: unknown): { readonly ok: true; readonly name: string } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true) return failed(value);
  return str(value["name"]) && value["name"].length <= 260 ? { ok: true, name: value["name"] } : failed(value);
}
