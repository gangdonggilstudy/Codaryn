/** Run start, result, confirmation and plan-check IPC checks. Public callers use ../ipc.js. */
import { MAX_ITEMS, count, hasOnlyKeys, isHandle, isObj, isRunId, shortText, textList, ERROR_CODE, DIGEST, hostCodeOf, NAME, numOrNull } from "./primitives.js";
import { toFinalMessage, toPlanActions, RUN_STATUSES, maskingOf } from "./core.js";
import type { FinalMessageView, PlanActionView, RunItemView, RunResultView, ConfirmationsView } from "./core.js";

/** GU-3: the longest goal the window sends (the CLI's own checks still run in startRun). */
export const MAX_GOAL_CHARS = 20_000;

/** `startRun` arguments: the workspace handle, the goal, and the profile and task kind chosen, or null. */
/**
 * U-63 (3.5, GUI-D8): `startTaskRun` arguments: the open workspace and whether to choose a variables
 * file too. No path: the main process's OS dialogs choose the task file (and the variables file),
 * and neither path is kept or sent to the page.
 */
export function parseStartTaskArgs(value: unknown): { readonly workspace: string; readonly withVars: boolean } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace", "withVars"])) return null;
  const { workspace, withVars } = value;
  return isHandle(workspace) && typeof withVars === "boolean" ? { workspace, withVars } : null;
}

export function parseStartRunArgs(value: unknown): { readonly workspace: string; readonly goal: string; readonly profile: string | null; readonly workflow: string | null } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace", "goal", "profile", "workflow"])) return null;
  const { workspace, goal } = value;
  const profile = value["profile"] ?? null;
  const workflow = value["workflow"] ?? null;
  if (!isHandle(workspace) || typeof goal !== "string" || goal.trim().length === 0 || goal.length > MAX_GOAL_CHARS || goal.includes("\u0000")) return null;
  if (profile !== null && (typeof profile !== "string" || !NAME.test(profile))) return null;
  if (workflow !== null && (typeof workflow !== "string" || !NAME.test(workflow))) return null;
  return { workspace, goal, profile: profile as string | null, workflow: workflow as string | null };
}

const REASON = /^[a-z][a-z_]{0,39}$/;
export interface RunEventsPayload {
  readonly runId: string;
  readonly items: readonly RunItemView[];
  /** U-271 (3.6): `limits`, the run's limits once known (protocol.ts RunLimitsView). */
  readonly counts: { readonly turns: number; readonly tools: number; readonly limits?: { readonly turns: number; readonly tools: number; readonly durationMs: number } };
}

export type RunDonePayload =
  | { readonly runId: string; readonly ok: true; readonly result: RunResultView; readonly labels: { readonly status: string; readonly reason: string } }
  | { readonly runId: string; readonly ok: false; readonly code: string };

/** The engine host's `done` outcome, checked field by field. */
export function toRunResultView(value: unknown): { readonly ok: true; readonly result: RunResultView } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail = { ok: false, code: "host_error" } as const;
  const result = value["result"];
  if (!isObj(result)) return fail;
  const { runId, status, reason, exitCode, changes, verifiers, usage, notices, plan, review, protectedChanged } = result;
  if (!isRunId(runId) || typeof status !== "string" || !(RUN_STATUSES as readonly string[]).includes(status) || typeof reason !== "string" || !REASON.test(reason)) return fail;
  if (!numOrNull(exitCode) || !numOrNull(protectedChanged) || !textList(notices)) return fail;
  if (!Array.isArray(changes) || changes.length > MAX_ITEMS || !Array.isArray(verifiers) || verifiers.length > MAX_ITEMS || !isObj(usage)) return fail;
  const changeViews: { path: string; created: boolean }[] = [];
  for (const change of changes) {
    if (!isObj(change) || !shortText(change["path"]) || typeof change["created"] !== "boolean") return fail;
    changeViews.push({ path: change["path"], created: change["created"] });
  }
  const verifierViews: { number: number; outcome: string }[] = [];
  for (const verifier of verifiers) {
    if (!isObj(verifier) || !count(verifier["number"]) || typeof verifier["outcome"] !== "string" || !REASON.test(verifier["outcome"])) return fail;
    verifierViews.push({ number: verifier["number"], outcome: verifier["outcome"] });
  }
  const { turns, tools, inputTokens, outputTokens, durationMs } = usage;
  if (![turns, tools, inputTokens, outputTokens, durationMs].every(numOrNull)) return fail;
  let planView: RunResultView["plan"] = null;
  if (plan !== null) {
    if (!isObj(plan) || typeof plan["digest"] !== "string" || !DIGEST.test(plan["digest"]) || !numOrNull(plan["actions"])) return fail;
    // U-226 (U-221): a run plan's kind (its actions are its files); absent for a plan of moves.
    if (plan["kind"] !== undefined && plan["kind"] !== "changes") return fail;
    planView = { digest: plan["digest"], actions: plan["actions"] as number | null, ...(plan["kind"] === "changes" ? { kind: "changes" as const } : {}) };
  }
  let reviewView: RunResultView["review"] = null;
  if (review !== null) {
    if (!isObj(review) || !textList(review["checklist"])) return fail;
    reviewView = { checklist: review["checklist"] };
  }
  const kind = result["kind"] === "apply" ? "apply" : "run";
  const planRunId = result["planRunId"] ?? null;
  const unsafeMoves = result["unsafeMoves"] ?? null;
  const applied = kind === "apply" ? toPlanActions(result["applied"], 10_000) : [];
  if (applied === null || !(planRunId === null || isRunId(planRunId)) || !numOrNull(unsafeMoves)) return fail;
  // U-226: only a run that carried out a plan has the count of its writes outside the plan.
  const deniedNotPlanned = result["deniedNotPlanned"];
  if (deniedNotPlanned !== undefined && (!count(deniedNotPlanned) || kind !== "run" || planRunId === null)) return fail;
  const lockLeft = result["lockLeft"];
  if (lockLeft !== undefined && lockLeft !== true) return fail;
  const finalMessage = toFinalMessage(result["finalMessage"]);
  if (finalMessage === "bad") return fail;
  return {
    ok: true,
    result: {
      runId,
      status: status as RunResultView["status"],
      reason,
      exitCode: exitCode as number | null,
      changes: changeViews,
      verifiers: verifierViews,
      usage: {
        turns: turns as number | null,
        tools: tools as number | null,
        inputTokens: inputTokens as number | null,
        outputTokens: outputTokens as number | null,
        durationMs: durationMs as number | null,
      },
      notices,
      plan: planView,
      review: reviewView,
      protectedChanged: protectedChanged as number | null,
      kind,
      planRunId: planRunId as string | null,
      unsafeMoves: unsafeMoves as number | null,
      applied,
      finalMessage,
      // U-40: counts only; anything else is not shown (no line), the rest of the result stays.
      masking: maskingOf(result["masking"]),
      // U-124: how the run's permission questions ended, counts only; anything else gives no lines.
      confirmations: confirmationsOf(result["confirmations"]),
      ...(deniedNotPlanned === undefined ? {} : { deniedNotPlanned }),
      ...(lockLeft === true ? { lockLeft } : {}),
    },
  };
}

export function confirmationsOf(value: unknown): ConfirmationsView | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["allowed", "user", "default", "cancelled"])) return null;
  const { allowed, user, cancelled } = value;
  const byDefault = value["default"];
  return count(allowed) && count(user) && count(byDefault) && count(cancelled) ? { allowed, user, default: byDefault, cancelled } : null;
}

/**
 * GU-5: `plan` and `changes` arguments: the workspace, the run chosen, and the profile and task kind
 * of its task form (DR-17, DR-28; R-14 L-3: the task kind the run was started with).
 */
/**
 * U-119 (3.9, DR-21, adapter-contract 5.14): the check before an apply, for the plan the main process
 * showed: indexes of the plan view's actions, codes and counts; no path. It is no consent and no
 * approval. `probesLeft`, `probesRemoved` and `lockLeft` say what the check could not take back.
 */
export type PlanCheckReply =
  | {
      readonly ok: true;
      /** U-206: a run plan's check: its problems are planned files (by index) the later run's gate denies ("denied"). */
      readonly planKind?: "changes";
      readonly problems: readonly { readonly index: number; readonly problem: string }[];
      readonly unsafeMoves: readonly number[];
      readonly inventoryLimitReached: boolean;
      readonly probesLeft: number;
      readonly probesRemoved: number;
      readonly lockLeft: boolean;
    }
  | { readonly ok: false; readonly code: string };

/** `checkPlan` arguments: the plan view's approval token only (the main process knows its plan and digest). */
export function parseCheckPlanArgs(value: unknown): string | null {
  return isObj(value) && hasOnlyKeys(value, ["approval"]) && isHandle(value["approval"]) ? value["approval"] : null;
}

/** The engine host's check of the plan `planRunId` with `digest`, checked field by field; another plan's is host_error. */
export function toPlanCheckReply(value: unknown, planRunId: string, digest: string, actions: number, planKind?: "changes"): PlanCheckReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail = { ok: false, code: "host_error" } as const;
  const { problems, unsafeMoves, inventoryLimitReached, probesLeft, probesRemoved, lockLeft } = value;
  if (value["planRunId"] !== planRunId || value["digest"] !== digest) return fail;
  // U-206: the check must be of the plan kind the main process showed (a run plan's indexes are its files).
  if (value["planKind"] !== planKind) return fail;
  if (!Array.isArray(problems) || !Array.isArray(unsafeMoves) || typeof inventoryLimitReached !== "boolean" || !count(probesLeft) || !count(probesRemoved) || typeof lockLeft !== "boolean") return fail;
  const index = (n: unknown): n is number => count(n) && n < actions;
  const found: { index: number; problem: string }[] = [];
  for (const item of problems) {
    if (!isObj(item) || !index(item["index"]) || typeof item["problem"] !== "string" || !ERROR_CODE.test(item["problem"])) return fail;
    found.push({ index: item["index"], problem: item["problem"] });
  }
  if (!unsafeMoves.every(index) || (planKind === "changes" && unsafeMoves.length > 0)) return fail;
  return { ok: true, ...(planKind === "changes" ? { planKind } : {}), problems: found, unsafeMoves: [...unsafeMoves] as number[], inventoryLimitReached, probesLeft, probesRemoved, lockLeft };
}
