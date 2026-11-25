/** Run list and revert IPC arguments and views. Public callers use ../ipc.js. */
import { count, hasOnlyKeys, isHandle, isObj, isRunId, shortText, WORD, hostCodeOf, TIME } from "./primitives.js";
import type { RunFormView } from "./core.js";

/** GU-4: `listRuns` arguments: `{workspace}`. */
export function parseWorkspaceArgs(value: unknown): { readonly workspace: string } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace"])) return null;
  return isHandle(value["workspace"]) ? { workspace: value["workspace"] } : null;
}

/** GU-4: `previewRevert` arguments: `{workspace, runId}`, a run id from the list (never "latest"). */
export function parseRunArgs(value: unknown): { readonly workspace: string; readonly runId: string } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace", "runId"])) return null;
  const { workspace, runId } = value;
  return isHandle(workspace) && isRunId(runId) ? { workspace, runId } : null;
}

/** GU-4: `revert` arguments: `{preview}`, the token of a preview the main process made. */
export function parsePreviewArgs(value: unknown): { readonly preview: string } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["preview"])) return null;
  return isHandle(value["preview"]) ? { preview: value["preview"] } : null;
}

export const REVERT_ACTIONS = ["restored", "deleted", "moved_back", "restored_from_discard"] as const;

/**
 * U-61 (U-16, R-55): what became of a plan run's apply, by the contract's one rule
 * (planApplyStateOf in src/contracts/commands.ts, PLAN_APPLY_STATES there; a unit test compares).
 */
export const PLAN_APPLY_STATES = ["applied", "unfinished", "applying", "reverted", "record_missing"] as const;
export interface PlanApplyView {
  readonly state: (typeof PLAN_APPLY_STATES)[number];
  readonly applyRunId: string;
  /** The apply run's reason, for "unfinished"; null otherwise or when it has none. */
  readonly reason: string | null;
  /** U-226 (U-221): a run plan carried out by a run (not an apply run); the CLI's carried words. */
  readonly carried?: true;
}

/** GU-4 (3.8): one row of the run list. A damaged run has its id only. */
export type RunListItem =
  | {
      readonly state: "checked";
      readonly runId: string;
      readonly kind: "run" | "apply";
      readonly startedAt: string | null;
      readonly taskId: string;
      readonly status: string | null;
      readonly reason: string | null;
      readonly changes: number | null;
      readonly reverted: { readonly at: string; readonly status: "complete" | "partial" } | null;
      readonly revertRecordDamaged: boolean;
      /** UXM-14, DR-38: the run has a records-changed mark; its records are not to be trusted. */
      readonly recordsChanged?: boolean;
      /** U-61 (U-16): for a plan run an apply claimed, what became of that apply; null otherwise. */
      readonly planApply?: PlanApplyView | null;
      /** U-271 (C-27, U-155): a run without a result: still going, or stopped without one; null otherwise or unknown. */
      readonly phase?: "running" | "no_result" | null;
      /**
       * U-244 (the CLI's runs.apply_of, runs.carried_plan): the plan run this run applied (an apply run) or
       * carried out (a run that carried out a changes plan); null or absent for any other run.
       */
      readonly planRunId?: string | null;
      /**
       * R21b-L-1: the task form the run was started with, when this app started it (the main process
       * remembers it). Null: unknown (started elsewhere), so a plan of it is shown but not applied here.
       */
      readonly form?: RunFormView | null;
    }
  | { readonly state: "damaged"; readonly runId: string };

export type RunsReply = { readonly ok: true; readonly runs: readonly RunListItem[]; readonly omitted: number } | { readonly ok: false; readonly code: string };

const revertedMark = (value: unknown): { at: string; status: "complete" | "partial" } | null | undefined => {
  if (value === null) return null;
  if (!isObj(value) || typeof value["at"] !== "string" || !TIME.test(value["at"]) || (value["status"] !== "complete" && value["status"] !== "partial")) return undefined;
  return { at: value["at"], status: value["status"] };
};

/** U-61: a row's plan apply state as the engine host gives it: null when absent, "bad" when it does not fit. */
function planApplyOf(value: unknown): PlanApplyView | null | "bad" {
  if (value === undefined || value === null) return null;
  if (!isObj(value) || !hasOnlyKeys(value, ["state", "applyRunId", "reason", "carried"])) return "bad";
  const { state, applyRunId, reason, carried } = value;
  if (typeof state !== "string" || !(PLAN_APPLY_STATES as readonly string[]).includes(state) || !isRunId(applyRunId) || !(reason === null || (typeof reason === "string" && WORD.test(reason)))) return "bad";
  if (carried !== undefined && carried !== true) return "bad";
  return { state: state as PlanApplyView["state"], applyRunId, reason, ...(carried === true ? { carried } : {}) };
}

/** The engine host's run list, checked field by field. */
export function toRunsReply(value: unknown): RunsReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail = { ok: false, code: "host_error" } as const;
  const { runs, omitted } = value;
  if (!Array.isArray(runs) || runs.length > 1000 || !count(omitted)) return fail;
  const items: RunListItem[] = [];
  for (const run of runs) {
    if (!isObj(run) || !isRunId(run["runId"])) return fail;
    if (run["state"] === "damaged") {
      items.push({ state: "damaged", runId: run["runId"] });
      continue;
    }
    const { kind, startedAt, taskId, status, reason, changes, revertRecordDamaged } = run;
    const recordsChanged = run["recordsChanged"] ?? false;
    if (typeof recordsChanged !== "boolean") return fail;
    const reverted = revertedMark(run["reverted"]);
    if (run["state"] !== "checked" || (kind !== "run" && kind !== "apply") || !(startedAt === null || (typeof startedAt === "string" && TIME.test(startedAt)))) return fail;
    if (!shortText(taskId) || !(status === null || (typeof status === "string" && WORD.test(status))) || !(reason === null || (typeof reason === "string" && WORD.test(reason)))) return fail;
    if (!(changes === null || count(changes)) || reverted === undefined || typeof revertRecordDamaged !== "boolean") return fail;
    const planApply = planApplyOf(run["planApply"]);
    if (planApply === "bad") return fail;
    const planRunId = run["planRunId"] ?? null;
    if (!(planRunId === null || isRunId(planRunId)) || planRunId === run["runId"]) return fail;
    const phase = run["phase"] ?? null;
    if (!(phase === null || ((phase === "running" || phase === "no_result") && status === null))) return fail;
    items.push({ state: "checked", runId: run["runId"], kind, startedAt: startedAt as string | null, taskId, status: status as string | null, reason: reason as string | null, changes: changes as number | null, reverted, revertRecordDamaged, recordsChanged, planApply, planRunId, phase });
  }
  return { ok: true, runs: items, omitted };
}

/** GU-4 (3.8): a revert or its preview. */
export interface RevertView {
  readonly runId: string;
  readonly status: "complete" | "partial";
  readonly dryRun: boolean;
  readonly reverted: readonly { readonly path: string; readonly action: (typeof REVERT_ACTIONS)[number]; readonly from: string | null; readonly unsafe: boolean }[];
  /** U-318 (R-119 L-1): `path` null for a missing_record skip, whose path comes unmasked (the window shows "?"). */
  readonly skipped: readonly { readonly path: string | null; readonly reason: string }[];
  readonly moveSafetyUnchecked: boolean;
  readonly revertedBefore: { readonly at: string; readonly status: "complete" | "partial" } | null;
  /** U-32 (UXM-14, DR-38): the run has a records-changed mark; the revert still checks every file. Absent: none. */
  readonly recordsChanged?: true;
  /** U-271 (U-229): the revert could not release the workspace lock at its end. Absent: released. */
  readonly lockLeft?: true;
}

/**
 * A preview carries the token its revert takes; a revert does not. DR-25: a revert that skipped
 * files as `unsafe_move` carries `consentRetry`, the token to revert once more with the person's
 * consent (asked by the main process).
 */
export type RevertReply =
  | { readonly ok: true; readonly view: RevertView; readonly preview: string | null; readonly consentRetry: string | null }
  | { readonly ok: false; readonly code: string };

/** DR-25: `revertConsent` arguments: `{retry}`, a token a revert's result gave. */
export function parseRetryArgs(value: unknown): { readonly retry: string } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["retry"])) return null;
  return isHandle(value["retry"]) ? { retry: value["retry"] } : null;
}

/** The engine host's revert value, checked field by field. */
export function toRevertView(value: unknown): { readonly ok: true; readonly view: RevertView } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail = { ok: false, code: "host_error" } as const;
  const { runId, status, dryRun, reverted, skipped, moveSafetyUnchecked } = value;
  const before = revertedMark(value["revertedBefore"]);
  if (!isRunId(runId) || (status !== "complete" && status !== "partial") || typeof dryRun !== "boolean" || typeof moveSafetyUnchecked !== "boolean" || before === undefined) return fail;
  if (!Array.isArray(reverted) || reverted.length > 1000 || !Array.isArray(skipped) || skipped.length > 1000) return fail;
  const files: RevertView["reverted"][number][] = [];
  for (const file of reverted) {
    if (!isObj(file) || !shortText(file["path"]) || typeof file["action"] !== "string" || !(REVERT_ACTIONS as readonly string[]).includes(file["action"])) return fail;
    if (!(file["from"] === null || shortText(file["from"])) || typeof file["unsafe"] !== "boolean") return fail;
    files.push({ path: file["path"], action: file["action"] as (typeof REVERT_ACTIONS)[number], from: file["from"] as string | null, unsafe: file["unsafe"] });
  }
  const skips: RevertView["skipped"][number][] = [];
  for (const file of skipped) {
    if (!isObj(file) || typeof file["reason"] !== "string" || !WORD.test(file["reason"])) return fail;
    // U-318 (R-119 L-1): no missing_record path is kept, even one that came; every other skip has its path.
    const hidden = file["reason"] === "missing_record";
    if (hidden ? !(file["path"] === null || shortText(file["path"])) : !shortText(file["path"])) return fail;
    skips.push({ path: hidden ? null : (file["path"] as string), reason: file["reason"] });
  }
  const recordsChanged = value["recordsChanged"] ?? false;
  if (typeof recordsChanged !== "boolean") return fail;
  const lockLeft = value["lockLeft"];
  if (lockLeft !== undefined && lockLeft !== true) return fail;
  return {
    ok: true,
    view: { runId, status, dryRun, reverted: files, skipped: skips, moveSafetyUnchecked, revertedBefore: before, ...(recordsChanged ? { recordsChanged: true as const } : {}), ...(lockLeft === true ? { lockLeft } : {}) },
  };
}
