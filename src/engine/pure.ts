/** Pure engine decisions and constants; no execution context or run loop (IR-26 step 1). */
import {
  ALL_TOOL_DESCRIPTORS, CONFIRM_ANSWER_DECISIONS, CALL_ID_PATTERN_SOURCE, POLICY_NARROWING_KINDS,
  PROFILE_NAME_PATTERN_SOURCE, TOOL_NAMES, WORKFLOW_TOOL_NAMES,
} from "../contracts/index.js";
import type {
  AnyToolName, ConfirmAnswer, ContentHash, PolicyNarrowing,
  PolicyNarrowingKind, PlanMode, ResolvedPlanAction, StoredChangesPlan,
  RunReason, TerminalRunStatus, ToolName, WorkflowToolName,
} from "../contracts/index.js";
import type { FailedForFeedback } from "./feedback.js";
import { APPROVED_PLAN_LABEL, APPROVED_PLAN_INTRO, APPROVED_SUMMARY_LABEL } from "./model-texts.js";

export const MAX_TIMER_MS = 2_147_483_647;
/** AC-D15: the call ids the engine keeps as given. */
export const CALL_ID_PATTERN = new RegExp(CALL_ID_PATTERN_SOURCE);
export const PROFILE_NAME_PATTERN = new RegExp(PROFILE_NAME_PATTERN_SOURCE);

/**
 * DR-41: the policy narrowings a run records: listed kinds with a positive whole count, the first
 * such entry of each kind, in POLICY_NARROWING_KINDS order. Kinds and counts only.
 */
export function recordableNarrowings(given: unknown): PolicyNarrowing[] {
  if (!Array.isArray(given)) return [];
  const counts = new Map<PolicyNarrowingKind, number>();
  for (const entry of given as readonly unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { kind, count } = entry as { kind?: unknown; count?: unknown };
    if (typeof kind !== "string" || !(POLICY_NARROWING_KINDS as readonly string[]).includes(kind)) continue;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) continue;
    if (!counts.has(kind as PolicyNarrowingKind)) counts.set(kind as PolicyNarrowingKind, count);
  }
  return POLICY_NARROWING_KINDS.filter((kind) => counts.has(kind)).map((kind) => ({ kind, count: counts.get(kind) as number }));
}

/** Most changed paths one integrity notice names (U-2). The record and the result keep them all. */
export const INTEGRITY_NOTICE_PATHS = 10;

export interface End {
  readonly status: TerminalRunStatus;
  readonly reason: RunReason;
}

export const MASKING_FAILED: End = { status: "failed", reason: "model_error" };
export const CANCELLED: End = { status: "cancelled", reason: "cancelled" };
export const UNKNOWN_OUTCOME: End = { status: "needs-input", reason: "unknown_tool_outcome" };
export const PROTECTED_CHANGED: End = { status: "needs-input", reason: "protected_changed" };
/** DR-38: the run's records changed other than by the run, or could not be checked. */
export const STATE_CHANGED: End = { status: "failed", reason: "state_changed" };
export const codeUnitOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const PLAN_PENDING: End = { status: "needs-input", reason: "plan_pending" };
/** U-187 (B-6, B-7): a run that carries out an approved plan which no longer fits, or was carried out. */
export const PLAN_STALE: End = { status: "failed", reason: "plan_stale" };
export const AWAITING_REVIEW: End = { status: "needs-input", reason: "awaiting_review" };
export const NO_PLAN: End = { status: "failed", reason: "model_error" };

/** A verification that failed in a way a repair may fix. */
export interface RepairNeeded {
  readonly failed: readonly FailedForFeedback[];
}

export function isEnd(value: object): value is End {
  return "status" in value && "reason" in value;
}

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

export function isWorkflowToolName(name: string): name is WorkflowToolName {
  return (WORKFLOW_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * GT-E1, GT-E3: the tools a run offers, from the task's settings, in their order and once each.
 * A plan run (`plan: "apply"`, U-170 also `plan: "run"`) offers read tools and the plan tool of its
 * own mode only (ToolDescriptor.planMode); any other run offers every listed tool except the plan
 * tools. A legacy task lists TOOL_NAMES and gets exactly those.
 */
export function offeredTools(tools: readonly AnyToolName[], plan: PlanMode): readonly AnyToolName[] {
  const offered: AnyToolName[] = [];
  for (const name of tools) {
    if (offered.includes(name) || !Object.hasOwn(ALL_TOOL_DESCRIPTORS, name)) continue;
    const descriptor = ALL_TOOL_DESCRIPTORS[name];
    const endsPlan = descriptor.endsRun === "plan";
    const allowed = plan === "none" ? !endsPlan : descriptor.displayClass === "read" || (endsPlan && descriptor.planMode === plan);
    if (allowed) offered.push(name);
  }
  return offered;
}

/** A stored plan's digest and size, as `EngineResult.plan` holds it. */
export interface ProposedPlan {
  readonly digest: ContentHash;
  readonly actions: number;
  /** U-180 (R-99 M-3): a `run` plan, whose `actions` counts its files. */
  readonly kind?: "changes";
}

/**
 * U-106 (R-79 L-3): the decision of a permission answer, read once, inside a try, from an own
 * property only. A read that throws (a getter, a proxy), a `decision` on the prototype (an IPC value
 * copied with Object.assign can bring one through `__proto__`), or anything not one of
 * CONFIRM_ANSWER_DECISIONS is `dismissed`, as ConfirmPermission says.
 */
export function answerDecision(answer: unknown): ConfirmAnswer["decision"] {
  try {
    if (typeof answer !== "object" || answer === null || !Object.hasOwn(answer, "decision")) return "dismissed";
    const decision: unknown = (answer as { readonly decision?: unknown }).decision;
    return (CONFIRM_ANSWER_DECISIONS as readonly unknown[]).includes(decision) ? (decision as ConfirmAnswer["decision"]) : "dismissed";
  } catch {
    return "dismissed";
  }
}

export function isProposedPlan(payload: unknown): payload is { readonly digest: ContentHash; readonly actions: readonly ResolvedPlanAction[] } {
  if (typeof payload !== "object" || payload === null) return false;
  const value = payload as { digest?: unknown; actions?: unknown };
  return typeof value.digest === "string" && Array.isArray(value.actions);
}

/**
 * U-187 (B-3): the approved plan as the system text gives it: the label, the fixed lines, each file
 * with its change, and the summary (`summary`: its visible parts joined with the gap marker, made
 * safe by the caller).
 */
export function approvedPlanText(plan: StoredChangesPlan, summary: string): string {
  const files = plan.files.map((file) => `- ${file.change} ${file.path}`).join("\n");
  return `${APPROVED_PLAN_LABEL}\n${APPROVED_PLAN_INTRO}\n${files}\n${APPROVED_SUMMARY_LABEL}\n${summary}`;
}

/** U-180: what `propose_changes` returns when it stored the plan (ProposeChangesPayload). */
export function isProposedChanges(payload: unknown): payload is { readonly digest: ContentHash; readonly files: readonly unknown[] } {
  if (typeof payload !== "object" || payload === null) return false;
  const value = payload as { digest?: unknown; files?: unknown };
  return typeof value.digest === "string" && Array.isArray(value.files);
}
