/**
 * Engine: runs one task. It repeats model and tool calls, then lets verifiers decide.
 * When a verification fails and repairs are left, the masked, cut evidence goes back to the
 * model and the loop continues (phase 2, R-1 to R-4). All limits cover the whole run.
 * It knows no Git, no test runner and no provider format.
 *
 * Everything bound for a model or the journal goes through `privacy.mask` first.
 * When masking fails, the text is neither sent nor recorded and the run ends.
 *
 * Integrity (phase 3, U-1, U-2): with `EngineDeps.integrity` the engine takes a baseline of the
 * protected material at run start and compares it again before and after every verification
 * round. A change, or material that cannot be shown unchanged, ends the run as
 * `needs-input`/`protected_changed` without a repair. Order with interruptions:
 * - A cancel or the duration limit already in effect when a check is due ends the run as before,
 *   and that check is not made there (a capture can hash up to MAX_INTEGRITY_BYTES).
 * - W-1: whatever ends the run, a model turn or verifiers that no check has followed are checked
 *   once more at the end. That end check keeps the end status (only `done` could not stand, and it
 *   never needs the check) and records the change with a notice.
 * - A check that is made is recorded. A non-empty result ends the run ahead of the verifiers'
 *   outcomes, repairs, and an interruption that arrived during its own capture.
 * - A capture that rejects (not a file-level problem; those are `unchecked` entries) fails
 *   closed: `protected_changed` with a notice, and no `integrity_checked` record, since there is no
 *   list of paths to record.
 *
 * General tasks (stage 4, GT-E1 to GT-E5, design general-tasks.md 4.3). The engine reads the task's
 * task type settings (`workflowSettingsOf`) and never a task type id. A task without them gets the
 * legacy settings, and its requests, records and result are as before.
 * - GT-E1: only the settings' tools are offered (built-in ones in `tools`, task type tools in
 *   `workflowTools`) and may be called; any other name is `unknown_tool`. Task type tools take the
 *   same checks and run through `ToolRunner.executeWorkflowTool`.
 * - GT-E2: `instructions` follow the fixed prompt under INSTRUCTIONS_LABEL, masked with it.
 * - GT-E3, GT-E5: with `plan: "apply"` only read tools and the tool whose descriptor says
 *   `endsRun: "plan"` are offered. U-170 (B-1): a plan tool only in a run of its own plan mode
 *   (ToolDescriptor.planMode), and `plan: "run"` is a plan run as well; until its tool is offered
 *   (B-3) it has read tools only and ends without a plan. Each plan action is judged on its own (the task's `planActions`,
 *   the gate before and after restoration). A stored plan ends the run as needs-input/plan_pending
 *   with `EngineResult.plan` and no verification; ending without one is failed/model_error.
 * - GT-E4: with `completion: "human_review"`, checks that are done (all pass, or no verifier) end
 *   the run as needs-input/awaiting_review with `EngineResult.review`, never as done.
 */

import {
  ALL_TOOL_DESCRIPTORS,
  ALL_TOOL_NAMES,
  BUILTIN_TOOLS,
  CONFIRM_ANSWER_DECISIONS,
  CALL_ID_PATTERN_SOURCE,
  JOURNAL_FILE_NAME,
  PLAN_ACTION_DESCRIPTORS,
  PLANNED_FILE_DESCRIPTOR,
  approvedPlanWritablePathSets,
  plannedFileStale,
  POLICY_NARROWING_KINDS,
  PROFILE_NAME_PATTERN_SOURCE,
  REPLACED_CALL_ID_PREFIX,
  RESULT_SCHEMA_VERSION,
  modelErrorRetryable,
  RUNS_DIR_NAME,
  RUN_EXIT_CODES,
  STATE_DIR_NAME,
  TOOL_NAMES,
  UNKNOWN_TOOL_RECORD_NAME,
  WORKFLOW_TOOLS,
  WORKFLOW_TOOL_NAMES,
  REFUSAL_HINTS,
  TOOL_FAILURE_HINTS,
  asRawText,
  failedToolContent,
  safeModelText,
  toolFailureMessage,
  workflowSettingsOf,
} from "../contracts/index.js";
import type {
  AnyToolName,
  ConfirmAnswer,
  ContentHash,
  EffectiveToolCall,
  EffectiveWorkflowToolCall,
  EngineDeps,
  EngineResult,
  FileChangeRecord,
  IntegrityManifest,
  IntegrityPhase,
  JournalEvent,
  JsonObject,
  MaskedText,
  MaskedToolCall,
  ModelErrorKind,
  ModelMessage,
  PolicyDecision,
  PolicyNarrowing,
  PolicyNarrowingKind,
  PlanMode,
  ProposeChangesArgs,
  ProposePlanArgs,
  RawText,
  RawToolOutcome,
  RawVerifierResult,
  RawWorkflowToolOutcome,
  ResolvedPlanAction,
  ApprovedChangesPlan,
  PlannedFileNow,
  RunApprovedPlan,
  StoredChangesPlan,
  RunModelError,
  RunReason,
  RunTask,
  StateCheckPhase,
  StateFingerprint,
  TerminalRunStatus,
  ToolCall,
  ToolDescriptor,
  ToolErrorCode,
  ToolName,
  ToolResult,
  ConfirmRequest,
  ConfirmationBy,
  ConfirmationDecision,
  VerifierOutcome,
  VerifierResult,
  WorkflowToolName,
} from "../contracts/index.js";
import { countPrivacyTokens } from "../contracts/index.js";
import { REPAIR_FIXED_TEXTS, buildRepairFeedback, failureSignature, prepareEvidence } from "./feedback.js";
import type { FailedForFeedback } from "./feedback.js";
import { FINAL_MESSAGE_KEY_MARKER, finalMessageOf } from "./final-message.js";
import { judgePlannedFile } from "./planned-file.js";
import { RunState } from "./state.js";
import {
  ARGS_RULES,
  INVALID_ARGS_LEAD,
  argsProblemText,
  toolArgsProblem,
  validateToolArgs,
  validateWorkflowToolArgs,
  workflowToolArgsProblem,
} from "./validate-args.js";
import type { ArgsProblem } from "./validate-args.js";

export { RunState, InvalidTransitionError, canTransition } from "./state.js";
export { APPLY_FIXED_TEXTS, applyPlan } from "./apply.js";
export { preflightPlan } from "./preflight.js";
export { judgePlannedFile } from "./planned-file.js";
export { validateToolArgs, validateWorkflowToolArgs } from "./validate-args.js";
export {
  EVIDENCE_CAPTURE_NOTE,
  EVIDENCE_SLACK_BYTES,
  REPAIR_HEADER,
  buildRepairFeedback,
  cutMiddle,
  failureSignature,
  normalizeVolatile,
  prepareEvidence,
} from "./feedback.js";
export type { CutText, FailedForFeedback, RepairFeedback } from "./feedback.js";

/**
 * Fixed instructions for the model. It contains no task data.
 * Fixed model-bound text must never spell the privacy token marker: masking would treat it as
 * a protected fragment and turn it into a token. Placeholders are described in words instead.
 */
export const SYSTEM_PROMPT = [
  "You are Codaryn, a local task agent working inside one workspace directory.",
  "Use the tools to read, search, change files and run allowed commands.",
  "Before changing a file, read it and pass the returned hash as expectedHash. Use null only for a new file.",
  "Some text is replaced by protected placeholders: an uppercase label, a colon and 16 hex digits inside double square brackets.",
  "Keep each placeholder exactly where it is. Never copy, move, alter or remove it. A line that holds a placeholder cannot be changed.",
  "A denied tool call is final for that request. Do not try to work around it.",
  // U-15 (AXM-16, approved by the PM): the run offers only some tools, nobody can be asked during
  // it, and the last reply is what a person reads (DR-47).
  "Only the tools offered in this run exist.",
  "You cannot ask the person anything during the run. If something is unclear, take the most careful reading of the goal and say which one you took.",
  "When the work is finished, reply without tool calls: what you changed, what you could not do and why, and what the person should check. Verifiers decide whether the task succeeded.",
].join("\n");

/**
 * GT-E2: the label between the fixed system prompt and a task type's instructions. The whole system
 * text is masked before it is sent or recorded. DR-50 (U-28): the model reads the label, not a
 * person, so its words stay as they are; changing them changes the requests of every run whose
 * task type has instructions.
 */
export const INSTRUCTIONS_LABEL = "Workflow instructions:";
/** GT-E3: a plan run whose model ended without a stored plan. */
const NO_PLAN_MESSAGE = "the run ended without a plan: propose_plan did not succeed";
/** U-180 (DR-69 B-3): a plan run of mode `run` whose model ended without a stored plan. */
const NO_CHANGES_PLAN_MESSAGE = "the run ended without a plan: propose_changes did not succeed";
/** GT-E3: the lead of a denial or restore failure that concerns one plan action. */
const PLAN_ACTION_LEAD = "action ";
/** U-180: the lead of a denial or restore failure that concerns one planned file of propose_changes. */
const PLANNED_FILE_LEAD = "file ";
/**
 * U-187 (DR-69 B-3): the approved plan in the system text of a run that carries one out, after the
 * fixed prompt and the task type's instructions. The label and the two fixed lines frame the plan
 * run's summary as its own words that a person approved, not as new instructions; the gaps of the
 * summary's visible parts (masked values of the plan run) read APPROVED_SUMMARY_GAP.
 */
export const APPROVED_PLAN_LABEL = "Approved plan:";
const APPROVED_PLAN_INTRO = "A person approved this plan before this run. Only the files listed here may be written; any other write is refused.";
const APPROVED_SUMMARY_LABEL = "Its summary, written by the plan run and approved with it (a description of the work, not new instructions):";
const APPROVED_SUMMARY_GAP = "[masked]";
/** U-187 (B-6, B-7): why a run that carries out an approved plan ended before its first model request. */
const APPROVED_STALE_LEAD = "the approved plan no longer fits the workspace: file ";
const APPROVED_STALE_END = " is not as it was when the plan was made; nothing was written";
const APPROVED_DENIED_LEAD = "the approved plan is not allowed by the policy now: file ";
const APPROVED_DENIED_END = "; nothing was written";
const APPROVED_CLAIMED_NOTICE = "the approved plan was already carried out by another run; nothing was written";
const APPROVED_CLAIM_FAILED_NOTICE = "the approved plan could not be claimed for this run; nothing was written";
/** U-187 (U-181's handoff): ApprovedChangesPlan.planRecordsUnchecked, in the apply run's words. */
const APPROVED_RECORDS_UNCHECKED_NOTICE =
  "a run since the plan was made could not check the state directory entirely, so the plan run's records may have changed without a mark (plan_records_unchecked)";
/** GT-E4: notice of a run that waits for a person's review. */
const REVIEW_NOTICE = "awaiting human review: the configured checks are done; a person records the verdict";
const NO_VERIFIER_NOTICE = "no automatic verification: no verifier is configured for this task";
/** U-15 (AXM-5): an unknown tool is answered with the tools this run offers, never the name given. */
const UNKNOWN_TOOL_LEAD = "unknown tool; the tools offered in this run: ";
/** U-15 (AXM-7): the two fixed parts of failedToolContent, `error (<code>): <message>`. */
const FAILED_CONTENT_PARTS = ["error (", "): "] as const;
const WRITE_NOT_APPLIED_MESSAGE = "the write was not applied";
const VERIFIER_NOT_RUN_EVIDENCE = "the verifier could not be run";
const VERIFIER_NOT_RUN_CHECKED = "nothing: the verifier did not complete";

/** U-2 notices: a fixed lead per check, then the changed display paths. */
const INTEGRITY_NOTICE_LEADS: { readonly [P in IntegrityPhase]: string } = {
  run_start: "protected material could not be checked at run start: ",
  before_verify: "protected material changed or could not be checked before verification; the verifiers were not run: ",
  after_verify: "protected material changed or could not be checked after verification; the result is not trusted: ",
};
const INTEGRITY_MORE_PATHS = [", and ", " more"] as const;
const INTEGRITY_FAILED_NOTICE = ["the integrity check could not be completed (", "); protected material is treated as changed"] as const;
/** W-1: the check made when a run ends. Its end status stays; the notice states the change. */
const INTEGRITY_END_LEAD = "protected material changed or could not be checked by the end of the run: ";
const INTEGRITY_END_UNMASKABLE =
  "protected material changed by the end of the run, but the changed paths could not be masked and are not recorded";
const INTEGRITY_END_LABEL = "run end";

/** DR-38: the notice of a change to the run records, then the changed paths; and of a check not made. */
const STATE_NOTICE_LEAD = "Codaryn's run records changed outside the run, so they are not trusted: ";
const STATE_FAILED_NOTICE = "the run records could not be checked, so they are not trusted";

/** Every fixed text the engine sends to a model or records. Tests mask these with the real gateway. */
export const FIXED_MODEL_TEXTS: readonly string[] = [
  SYSTEM_PROMPT,
  INSTRUCTIONS_LABEL,
  NO_PLAN_MESSAGE,
  NO_CHANGES_PLAN_MESSAGE,
  APPROVED_PLAN_LABEL,
  APPROVED_PLAN_INTRO,
  APPROVED_SUMMARY_LABEL,
  APPROVED_SUMMARY_GAP,
  APPROVED_STALE_LEAD,
  APPROVED_STALE_END,
  APPROVED_DENIED_LEAD,
  APPROVED_DENIED_END,
  APPROVED_CLAIMED_NOTICE,
  APPROVED_CLAIM_FAILED_NOTICE,
  APPROVED_RECORDS_UNCHECKED_NOTICE,
  PLAN_ACTION_LEAD,
  PLANNED_FILE_LEAD,
  REVIEW_NOTICE,
  NO_VERIFIER_NOTICE,
  UNKNOWN_TOOL_LEAD,
  INVALID_ARGS_LEAD,
  ...Object.values(ARGS_RULES),
  ...Object.values(REFUSAL_HINTS),
  // U-50 (AXM-6): the hint after a tool runner's failure.
  ...(Object.values(TOOL_FAILURE_HINTS) as string[]),
  ...FAILED_CONTENT_PARTS,
  WRITE_NOT_APPLIED_MESSAGE,
  VERIFIER_NOT_RUN_EVIDENCE,
  VERIFIER_NOT_RUN_CHECKED,
  "denied by policy: ",
  "token not usable in field: ",
  "malformed model response: stop=",
  ...REPAIR_FIXED_TEXTS,
  ...Object.values(INTEGRITY_NOTICE_LEADS),
  ...INTEGRITY_MORE_PATHS,
  ...INTEGRITY_FAILED_NOTICE,
  INTEGRITY_END_LEAD,
  FINAL_MESSAGE_KEY_MARKER,
  INTEGRITY_END_UNMASKABLE,
  INTEGRITY_END_LABEL,
  STATE_NOTICE_LEAD,
  STATE_FAILED_NOTICE,
];
const MAX_TIMER_MS = 2_147_483_647;
/** AC-D15: the call ids the engine keeps as given. */
const CALL_ID_PATTERN = new RegExp(CALL_ID_PATTERN_SOURCE);
const PROFILE_NAME_PATTERN = new RegExp(PROFILE_NAME_PATTERN_SOURCE);

/**
 * DR-41: the policy narrowings a run records: listed kinds with a positive whole count, the first
 * such entry of each kind, in POLICY_NARROWING_KINDS order. Kinds and counts only.
 */
function recordableNarrowings(given: unknown): PolicyNarrowing[] {
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

interface End {
  readonly status: TerminalRunStatus;
  readonly reason: RunReason;
}

const MASKING_FAILED: End = { status: "failed", reason: "model_error" };
const CANCELLED: End = { status: "cancelled", reason: "cancelled" };
const UNKNOWN_OUTCOME: End = { status: "needs-input", reason: "unknown_tool_outcome" };
const PROTECTED_CHANGED: End = { status: "needs-input", reason: "protected_changed" };
/** DR-38: the run's records changed other than by the run, or could not be checked. */
const STATE_CHANGED: End = { status: "failed", reason: "state_changed" };
const codeUnitOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const PLAN_PENDING: End = { status: "needs-input", reason: "plan_pending" };
/** U-187 (B-6, B-7): a run that carries out an approved plan which no longer fits, or was carried out. */
const PLAN_STALE: End = { status: "failed", reason: "plan_stale" };
const AWAITING_REVIEW: End = { status: "needs-input", reason: "awaiting_review" };
const NO_PLAN: End = { status: "failed", reason: "model_error" };

/** A verification that failed in a way a repair may fix. */
interface RepairNeeded {
  readonly failed: readonly FailedForFeedback[];
}

function isEnd(value: object): value is End {
  return "status" in value && "reason" in value;
}

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

function isWorkflowToolName(name: string): name is WorkflowToolName {
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
interface ProposedPlan {
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
function answerDecision(answer: unknown): ConfirmAnswer["decision"] {
  try {
    if (typeof answer !== "object" || answer === null || !Object.hasOwn(answer, "decision")) return "dismissed";
    const decision: unknown = (answer as { readonly decision?: unknown }).decision;
    return (CONFIRM_ANSWER_DECISIONS as readonly unknown[]).includes(decision) ? (decision as ConfirmAnswer["decision"]) : "dismissed";
  } catch {
    return "dismissed";
  }
}

function isProposedPlan(payload: unknown): payload is { readonly digest: ContentHash; readonly actions: readonly ResolvedPlanAction[] } {
  if (typeof payload !== "object" || payload === null) return false;
  const value = payload as { digest?: unknown; actions?: unknown };
  return typeof value.digest === "string" && Array.isArray(value.actions);
}

/**
 * U-187 (B-3): the approved plan as the system text gives it: the label, the fixed lines, each file
 * with its change, and the summary (`summary`: its visible parts joined with the gap marker, made
 * safe by the caller).
 */
function approvedPlanText(plan: StoredChangesPlan, summary: string): string {
  const files = plan.files.map((file) => `- ${file.change} ${file.path}`).join("\n");
  return `${APPROVED_PLAN_LABEL}\n${APPROVED_PLAN_INTRO}\n${files}\n${APPROVED_SUMMARY_LABEL}\n${summary}`;
}

/** U-180: what `propose_changes` returns when it stored the plan (ProposeChangesPayload). */
function isProposedChanges(payload: unknown): payload is { readonly digest: ContentHash; readonly files: readonly unknown[] } {
  if (typeof payload !== "object" || payload === null) return false;
  const value = payload as { digest?: unknown; files?: unknown };
  return typeof value.digest === "string" && Array.isArray(value.files);
}

/** GT-E1 to GT-E4 and, with `approved` (U-187), a run that carries out an approved `run` plan. */
async function runWith(deps: EngineDeps, approved: ApprovedChangesPlan | null): Promise<EngineResult> {
  const { task, runId, model, privacy, policy, tools, verifiers, journal, clock, signal, integrity } = deps;
  const limits = task.limits;
  // GT-E1 to GT-E4: everything a task type changes comes from the task's explicit settings.
  // A task without them gets the legacy settings, so its requests, records and result stay as before.
  const settings = workflowSettingsOf(task);
  // U-187 (B-3): a run that carries out an approved plan has no plan step of its own.
  const offered = offeredTools(settings.tools, approved === null ? settings.plan : "none");
  const offeredBuiltin = offered.filter(isToolName);
  const offeredWorkflow = offered.filter(isWorkflowToolName);
  /** GT-E3: set when `propose_plan` stored a plan; the run then ends as plan_pending. */
  let proposedPlan: ProposedPlan | null = null;
  /** U-59 (AXM-15): the made-safe summary of the propose_plan call that stored proposedPlan. */
  let planSummary: MaskedText | null = null;
  /** GT-E4: the masked checklist of a run that ends as awaiting_review. */
  let reviewChecklist: readonly MaskedText[] | null = null;
  const state = new RunState();
  const startedAt = clock.now();

  let modelTurns = 0;
  let toolCalls = 0;
  let inputTokens: number | null = 0;
  let outputTokens: number | null = 0;
  const changes: FileChangeRecord[] = [];
  const verifierResults: VerifierResult[] = [];
  const notices: MaskedText[] = [];
  /** Results by call id. A call id that was already answered is never executed again. */
  const answered = new Map<string, ToolResult>();
  /** AC-D15: the recorded id of every model-given call id seen in this run, and the ids in use. */
  const recordedIds = new Map<string, string>();
  const usedIds = new Set<string>();
  let replacedIds = 0;
  /** The model-bound conversation. It keeps growing across repairs. */
  const messages: ModelMessage[] = [];
  /** How many messages earlier `model_request` records already hold. */
  let sent = 0;
  let repairAttempts = 0;
  /** Signature of the latest failed verification, and how many times in a row it occurred. */
  let lastSignature: string | null = null;
  let sameFailures = 0;
  /** The run_start manifest (U-1). Every later check compares with it. Local only, never recorded. */
  let baseline: IntegrityManifest | null = null;
  /** `changed` of the latest recorded `integrity_checked`; undefined while none was recorded. */
  // DR-52 (U-25): the protected tokens in what the engine sent to the model (EngineResult.masking).
  let maskedPlaces = 0;
  let protectedChanged: readonly MaskedText[] | undefined;
  // DR-47 (U-21): the masked text of the last model response when it was a final reply; reset when
  // the model is asked again, so a run that ended without a reply has none.
  let lastFinal: MaskedText | null = null;
  /** U-55 (AXM-9): the model error that ended the run (EngineResult.modelError); null otherwise. */
  let endingModelError: RunModelError | null = null;
  // U-82 (DR-68): `verdict` is the outcome's own retryable, which comes first.
  const endedByModelError = (kind: ModelErrorKind, turn: number, httpStatus?: number, verdict?: boolean): End => {
    const retryable = modelErrorRetryable(kind, httpStatus, verdict);
    endingModelError = retryable === undefined ? { kind, turn } : { kind, turn, retryable };
    return { status: "failed", reason: "model_error" };
  };
  // DR-38: the state guard, the last tier-run fingerprint (each window chains from it) and the
  // tier-state base of the run's start; the last recorded list goes into the result.
  const stateGuard = deps.stateGuard;
  let lastRunPrint: StateFingerprint | null = null;
  let stateBase: StateFingerprint | null = null;
  let stateChanged: readonly MaskedText[] | undefined;
  /**
   * W-1: what ran since the last integrity check was made: nothing, a model turn (with its tool
   * calls), or verifiers. Anything but "nothing" at the end of the run calls for one more check.
   */
  let sinceCheck: "nothing" | "model" | "verifiers" = "nothing";

  // Real-time deadline so that a model or tool call in flight is interrupted at the duration limit.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), Math.min(limits.maxDurationMs, MAX_TIMER_MS));
  timer.unref();
  const runSignal = AbortSignal.any([signal, deadline.signal]);

  const mask = (text: string): MaskedText | null => {
    try {
      const outcome = privacy.mask(text);
      return outcome.ok ? outcome.text : null;
    } catch {
      return null;
    }
  };

  /**
   * Masks a structured value for JSON transport. Every string value (nested included) is masked
   * before serialization, so an already escaped secret is not escaped again and missed.
   * The serialized text is masked once more in case escaping itself formed a secret.
   * Returns null when any masking fails.
   */
  const maskJson = (value: unknown): MaskedText | null => {
    let failed = false;
    const walk = (item: unknown): unknown => {
      if (failed) return null;
      if (typeof item === "string") {
        const masked = mask(item);
        if (masked === null) failed = true;
        return masked;
      }
      if (Array.isArray(item)) return item.map(walk);
      if (typeof item === "object" && item !== null) {
        return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, walk(entry)]));
      }
      return item;
    };
    const masked = walk(value);
    return failed ? null : mask(JSON.stringify(masked));
  };

  /**
   * AC-D15 (DR-13, R-1 L-1): the calls of one model response as the engine records, answers and
   * sends them back. A name in no tool list becomes UNKNOWN_TOOL_RECORD_NAME (so it is unknown_tool).
   * An id is kept when it passes CALL_ID_PATTERN_SOURCE, masking leaves it unchanged and no other id
   * stands for it; otherwise it gets REPLACED_CALL_ID_PREFIX and a number not in use. The same id
   * keeps its recorded id for the whole run, so a call and its result stay paired and a repeated
   * call is still answered once. Ids that can be kept are placed first, so a replacement never
   * takes the place of a valid id given in the same response.
   */
  const recordableCalls = (given: readonly ToolCall[]): ToolCall[] => {
    const keepable = (id: string): boolean => {
      if (!CALL_ID_PATTERN.test(id) || usedIds.has(id)) return false;
      return mask(id) === id;
    };
    for (const call of given) {
      if (recordedIds.has(call.id) || !keepable(call.id)) continue;
      recordedIds.set(call.id, call.id);
      usedIds.add(call.id);
    }
    return given.map((call) => {
      let id = recordedIds.get(call.id);
      if (id === undefined) {
        do {
          replacedIds += 1;
          id = `${REPLACED_CALL_ID_PREFIX}${replacedIds}`;
        } while (usedIds.has(id));
        recordedIds.set(call.id, id);
        usedIds.add(id);
      }
      const name = (ALL_TOOL_NAMES as readonly string[]).includes(call.name) ? call.name : UNKNOWN_TOOL_RECORD_NAME;
      return { id, name, args: call.args };
    });
  };

  const interrupted = (): End | null => {
    if (signal.aborted) return CANCELLED;
    if (deadline.signal.aborted || clock.now() - startedAt >= limits.maxDurationMs) {
      return { status: "budget-exhausted", reason: "max_duration" };
    }
    return null;
  };

  const record = (event: JournalEvent): Promise<void> => journal.append(event);

  /**
   * One integrity check (U-1, U-2): capture, compare with the run_start baseline, record the
   * masked list and add a notice when it is not empty. Paths are masked one by one for the record
   * and the result; the notice is built from the raw paths and masked as a whole.
   * - "failed": the capture rejected (not a file-level problem; those are `unchecked` entries).
   *   There is no list of paths, so nothing is recorded; a notice says the check was not completed.
   * - "unmaskable": a changed path could not be masked. Nothing about it is recorded.
   */
  const inspect = async (
    integrityChecker: NonNullable<EngineDeps["integrity"]>,
    phase: IntegrityPhase,
    lead: string,
    label: string,
  ): Promise<"unchanged" | "changed" | "failed" | "unmaskable"> => {
    sinceCheck = "nothing";
    let changedRaw: readonly RawText[];
    try {
      const current = await integrityChecker.capture();
      if (phase === "run_start" && baseline === null) baseline = current;
      if (baseline === null) throw new Error("no run_start baseline");
      changedRaw = integrityChecker.compare(baseline, current);
    } catch {
      const notice = mask(`${INTEGRITY_FAILED_NOTICE[0]}${label}${INTEGRITY_FAILED_NOTICE[1]}`);
      if (notice !== null) notices.push(notice);
      return "failed";
    }
    const changed: MaskedText[] = [];
    for (const path of changedRaw) {
      const masked = mask(path);
      if (masked === null) return "unmaskable";
      changed.push(masked);
    }
    await record({ type: "integrity_checked", phase, changed });
    protectedChanged = changed;
    if (changed.length === 0) return "unchanged";
    const shown = changedRaw.slice(0, INTEGRITY_NOTICE_PATHS).join(", ");
    const hidden = changedRaw.length - INTEGRITY_NOTICE_PATHS;
    const more = hidden > 0 ? `${INTEGRITY_MORE_PATHS[0]}${hidden}${INTEGRITY_MORE_PATHS[1]}` : "";
    const notice = mask(`${lead}${shown}${more}`);
    if (notice !== null) notices.push(notice);
    return "changed";
  };

  /**
   * A check at run start or around a verification round: a change, or material that cannot be
   * shown unchanged, ends the run as needs-input/protected_changed (fails closed).
   */
  const checkIntegrity = async (phase: IntegrityPhase): Promise<End | null> => {
    if (integrity === undefined) return null;
    const outcome = await inspect(integrity, phase, INTEGRITY_NOTICE_LEADS[phase], phase);
    if (outcome === "unchanged") return null;
    return outcome === "unmaskable" ? MASKING_FAILED : PROTECTED_CHANGED;
  };

  /**
   * W-1: one more check when the run ends after a model turn or verifiers that no check has
   * followed (limits, cancel, model error, unknown tool outcome, no verifier, a round cut short).
   * The end keeps its status and reason; the change goes into the record, `protectedChanged` and a
   * notice. Only `done` would be overturned, and done always follows an after_verify check, so
   * nothing has run since. The contract has no run_end phase: the check is recorded as
   * after_verify when verifiers ran since the last check, otherwise as before_verify.
   */
  const checkAtEnd = async (end: End): Promise<End> => {
    if (integrity === undefined || baseline === null || sinceCheck === "nothing") return end;
    const phase: IntegrityPhase = sinceCheck === "verifiers" ? "after_verify" : "before_verify";
    const outcome = await inspect(integrity, phase, INTEGRITY_END_LEAD, INTEGRITY_END_LABEL);
    if (outcome === "unchanged") return end;
    if (outcome === "unmaskable") {
      const notice = mask(INTEGRITY_END_UNMASKABLE);
      if (notice !== null) notices.push(notice);
    }
    return end.status === "done" ? PROTECTED_CHANGED : end;
  };

  /**
   * DR-38: one check of the state directory (EngineDeps.stateGuard). Tier "run" is compared with the
   * last tier-run fingerprint, so a change between two windows is found too (the guard discounts
   * the run's own writes); tier "state", when `both`, with the run's start. Recorded at run_start and
   * run_end always, otherwise only when something changed or tier "state" was limited. A change, or
   * a capture that cannot be made (fail closed), marks the runs and ends the run as
   * failed/state_changed; a changed path that cannot be masked ends it as masking_failed.
   */
  const checkState = async (phase: StateCheckPhase, both: boolean, callId?: string): Promise<End | null> => {
    if (stateGuard === undefined) return null;
    let changedRaw: RawText[];
    let limited = false;
    try {
      const nowRun = await stateGuard.capture("run");
      changedRaw = [...stateGuard.compare(lastRunPrint ?? nowRun, nowRun).changed];
      lastRunPrint = nowRun;
      if (both) {
        const nowState = await stateGuard.capture("state");
        if (stateBase === null) stateBase = nowState;
        const comparison = stateGuard.compare(stateBase, nowState);
        changedRaw.push(...comparison.changed);
        limited = comparison.limited;
      }
    } catch {
      const notice = mask(STATE_FAILED_NOTICE);
      if (notice !== null) notices.push(notice);
      return STATE_CHANGED;
    }
    const sorted = [...new Set(changedRaw)].sort(codeUnitOrder);
    const changed: MaskedText[] = [];
    for (const path of sorted) {
      const masked = mask(path);
      if (masked === null) return MASKING_FAILED;
      changed.push(masked);
    }
    if (phase === "run_start" || phase === "run_end" || changed.length > 0 || limited) {
      await record({ type: "state_checked", phase, ...(callId === undefined ? {} : { callId }), changed, limited });
      stateChanged = changed;
    }
    if (changed.length === 0) return null;
    try {
      await stateGuard.markRecordsChanged(changed);
    } catch {
      // The run still ends as state_changed; the record above names the paths.
    }
    const hidden = sorted.length - INTEGRITY_NOTICE_PATHS;
    const more = hidden > 0 ? `${INTEGRITY_MORE_PATHS[0]}${hidden}${INTEGRITY_MORE_PATHS[1]}` : "";
    const notice = mask(`${STATE_NOTICE_LEAD}${sorted.slice(0, INTEGRITY_NOTICE_PATHS).join(", ")}${more}`);
    if (notice !== null) notices.push(notice);
    return STATE_CHANGED;
  };

  /** DR-38: the run_end check; a change replaces the end the run would have had. */
  const checkStateAtEnd = async (end: End): Promise<End> => {
    if (stateGuard === undefined || end.reason === "state_changed") return end;
    return (await checkState("run_end", true)) ?? end;
  };

  /** A check point: an interruption already in effect comes first and skips the check. */
  const checkPoint = async (phase: IntegrityPhase): Promise<End | null> => {
    if (integrity === undefined) return null;
    const stop = interrupted();
    if (stop !== null) return stop;
    return checkIntegrity(phase);
  };

  /**
   * Builds, records and returns the masked result of a call that was rejected before execution.
   * Every result handed back to the model is recorded as a tool_result.
   */
  const errorResult = async (call: ToolCall, code: ToolErrorCode, message: string): Promise<ToolResult | End> => {
    const content = mask(failedToolContent(code, message));
    if (content === null) return MASKING_FAILED;
    const result: ToolResult = { callId: call.id, tool: call.name, ok: false, content, errorCode: code };
    await record({ type: "tool_result", result });
    return result;
  };

  /** U-74: the number of the last permission question of this run (ConfirmRequest.id `q<k>`). */
  let confirmations = 0;

  /** U-106: text a screen shows as it is (safeModelText with the run's gateway); null when masking fails. */
  const shownText = (text: string): MaskedText | null => {
    try {
      const shown = safeModelText(text, (one) => privacy.mask(one));
      return shown === null ? null : (shown as MaskedText);
    } catch {
      return null;
    }
  };

  /** A call's denial as recorded: its `tool_decision` with `allowed: false`. */
  const recordDenial = async (
    call: ToolCall,
    stage: "policy_requested" | "policy_effective",
    decision: Extract<PolicyDecision, { allowed: false }>,
  ): Promise<void> => {
    await record({
      type: "tool_decision",
      callId: call.id,
      tool: call.name,
      stage,
      allowed: false,
      permission: decision.permission,
      code: decision.code,
    });
  };

  /**
   * U-74 B-3 (DR-3, DR-10): the second check gave the confirm mark. Records the question (fixed
   * fields, the masked executable, the number of arguments; never the arguments), asks
   * EngineDeps.confirm (absent: nobody, so deny by default), records the answer, and after
   * `allow_once` judges the same call again: allowed, or the same mark (the answer is for this call
   * once), runs it; any other denial denies. The wait counts in maxDurationMs: the run's signal ends
   * it, and a cancel or the time limit then ends the run. U-137 (R88b-L1): then too the call's
   * denial is recorded after the answer, with no result (the run ends).
   */
  const askPermission = async (
    call: ToolCall,
    tool: ToolName,
    effective: EffectiveToolCall,
    descriptor: ToolDescriptor,
    mark: Extract<PolicyDecision, { allowed: false }>,
  ): Promise<PolicyDecision | End> => {
    const args = effective.args as { readonly executable?: unknown; readonly args?: unknown };
    // U-106 (R-79 L-2): a screen shows the subject as it is, so it is made safe as the final message
    // is (safeModelText): masked by the gateway and its key shapes hidden. Null fails closed.
    const subject = shownText(typeof args.executable === "string" ? args.executable : "");
    if (subject === null) return MASKING_FAILED;
    confirmations += 1;
    const request: ConfirmRequest = {
      kind: "permission",
      id: `q${confirmations}`,
      callId: call.id,
      tool,
      permission: mark.permission,
      subject,
      argumentCount: Array.isArray(args.args) ? args.args.length : 0,
    };
    await record({ type: "confirmation_requested", ...request });
    // U-120 (R-86 L-1): the asker gets a frozen copy, and the answer record takes the id from the
    // engine's own question, so a changed copy changes no record.
    const { id } = request;
    const asked: ConfirmRequest = Object.freeze({ ...request });
    let decision: ConfirmAnswer["decision"] = "dismissed";
    const ask = deps.confirm;
    if (ask !== undefined && !runSignal.aborted) {
      let stopWaiting: () => void = () => {};
      const ended = new Promise<never>((_resolve, reject) => {
        stopWaiting = () => reject(new Error("the run's signal aborted"));
        runSignal.addEventListener("abort", stopWaiting, { once: true });
      });
      try {
        // U-106 (R-79 L-3): the answer is read once, right after it came (answerDecision).
        decision = answerDecision(await Promise.race([ask(asked, runSignal), ended]));
      } catch {
        decision = "dismissed";
      } finally {
        runSignal.removeEventListener("abort", stopWaiting);
        ended.catch(() => {});
      }
    }
    const answered = async (decision: ConfirmationDecision, by: ConfirmationBy): Promise<void> => {
      await record({ type: "confirmation_answered", id, decision, by });
    };
    const stop = interrupted();
    if (stop !== null) {
      await answered("deny", stop.status === "cancelled" ? "cancelled" : "default");
      // U-137 (R88b-L1): the call is denied as when the answer is no, so its decision follows the
      // answer (journal.ts) and every reader counts it among the denied calls. No result goes back
      // to the model: the run ends here.
      await recordDenial(call, "policy_effective", mark);
      return stop;
    }
    if (decision !== "allow_once") {
      await answered("deny", decision === "deny" ? "user" : "default");
      return mark;
    }
    await answered("allow_once", "user");
    const again = await policy.checkEffective(effective, descriptor);
    return again.allowed || again.confirm === true ? { allowed: true } : again;
  };

  const denied = async (
    call: ToolCall,
    stage: "policy_requested" | "policy_effective",
    decision: Extract<PolicyDecision, { allowed: false }>,
  ): Promise<ToolResult | End> => {
    await recordDenial(call, stage, decision);
    return errorResult(call, "policy_denied", `denied by policy: ${decision.permission}/${decision.code}. ${REFUSAL_HINTS[decision.code]}`);
  };

  /**
   * Executes a checked call. When the runner throws, the outcome is unknown:
   * a read is retried once, a local write is confirmed by hash, anything else needs input.
   */
  const execute = async (
    call: EffectiveToolCall,
    descriptor: ToolDescriptor,
  ): Promise<RawToolOutcome | End> => {
    try {
      return await tools.execute(call, runSignal);
    } catch {
      const stop = interrupted();
      if (stop !== null) return stop;
      if (descriptor.displayClass === "read") {
        try {
          return await tools.execute(call, runSignal);
        } catch {
          return UNKNOWN_OUTCOME;
        }
      }
      if (call.name !== "write_file") return UNKNOWN_OUTCOME;
      const probe: EffectiveToolCall = {
        id: `${call.id}#verify`,
        name: "read_file",
        args: { path: call.args.path },
      };
      try {
        const allowed = await policy.checkEffective(probe, BUILTIN_TOOLS.read_file);
        if (!allowed.allowed) return UNKNOWN_OUTCOME;
        const seen = await tools.execute(probe, runSignal);
        const expected = call.args.expectedHash;
        const untouched = seen.ok
          ? "hash" in seen.payload && seen.payload.hash === expected
          : seen.code === "not_found" && expected === null;
        if (!untouched) return UNKNOWN_OUTCOME;
        return { ok: false, code: "io_error", message: asRawText(WRITE_NOT_APPLIED_MESSAGE) };
      } catch {
        return UNKNOWN_OUTCOME;
      }
    }
  };

  const unknownTool = async (call: ToolCall): Promise<ToolResult | End> => {
    await record({
      type: "tool_decision",
      callId: call.id,
      tool: call.name,
      stage: "validate",
      allowed: false,
      permission: null,
      code: "unknown_tool",
    });
    return errorResult(call, "unknown_tool", `${UNKNOWN_TOOL_LEAD}${offered.join(", ")}`);
  };

  const invalidArgsOf = async (call: ToolCall, problem: ArgsProblem | null): Promise<ToolResult | End> => {
    await record({
      type: "tool_decision",
      callId: call.id,
      tool: call.name,
      stage: "validate",
      allowed: false,
      permission: null,
      code: "invalid_args",
    });
    return errorResult(call, "invalid_args", argsProblemText(problem ?? { field: "", rule: ARGS_RULES.nonEmpty }));
  };

  /**
   * Runs a checked task type tool call. Like `execute`: when the runner throws, a read is retried
   * once and anything else (the plan tool writes plan.json) is an unknown outcome.
   */
  const executeWorkflow = async (
    call: EffectiveWorkflowToolCall,
    descriptor: ToolDescriptor,
  ): Promise<RawWorkflowToolOutcome | End> => {
    const run = tools.executeWorkflowTool;
    if (run === undefined) return UNKNOWN_OUTCOME;
    try {
      return await run.call(tools, call, runSignal);
    } catch {
      const stop = interrupted();
      if (stop !== null) return stop;
      if (descriptor.displayClass !== "read") return UNKNOWN_OUTCOME;
      try {
        return await run.call(tools, call, runSignal);
      } catch {
        return UNKNOWN_OUTCOME;
      }
    }
  };

  /** Masks, records and returns the outcome of an executed task type tool call. */
  const finishWorkflowCall = async (
    call: ToolCall,
    name: WorkflowToolName,
    outcome: RawWorkflowToolOutcome,
  ): Promise<ToolResult | End> => {
    // U-50 (AXM-6): a runner's failure gets its code's hint (TOOL_FAILURE_HINTS), then the one form.
    const content = outcome.ok ? maskJson(outcome.payload) : mask(failedToolContent(outcome.code, toolFailureMessage(outcome.code, outcome.message)));
    if (content === null) return MASKING_FAILED;
    const result: ToolResult = {
      callId: call.id,
      tool: name,
      ok: outcome.ok,
      content,
      errorCode: outcome.ok ? null : outcome.code,
    };
    await record({ type: "tool_result", result });
    return result;
  };

  /**
   * GT-E3: `propose_plan` (the tool whose descriptor says `endsRun: "plan"`). Every action is judged
   * on its own with PLAN_ACTION_DESCRIPTORS: the task's `planActions`, then the policy gate before
   * restoration, permitted restoration of its path fields, and the gate on the effective paths. One
   * denied action denies the call; the model gets the reason and may propose again. When the tool
   * stored the plan, the run ends as plan_pending after this call.
   */
  const handlePlanCall = async (call: ToolCall, args: ProposePlanArgs, descriptor: ToolDescriptor): Promise<ToolResult | End> => {
    const allowedKinds = task.policy.planActions ?? [];
    const effectiveActions: JsonObject[] = [];
    for (const [index, action] of args.actions.entries()) {
      const actionDescriptor = PLAN_ACTION_DESCRIPTORS[action.kind];
      const actionArgs: JsonObject = action.kind === "move" ? { from: action.from, to: action.to } : { path: action.path };
      const denyAction = async (
        stage: "policy_requested" | "policy_effective",
        decision: Extract<PolicyDecision, { allowed: false }>,
      ): Promise<ToolResult | End> => {
        await record({
          type: "tool_decision",
          callId: call.id,
          tool: call.name,
          stage,
          allowed: false,
          permission: decision.permission,
          code: decision.code,
        });
        return errorResult(
          call,
          "policy_denied",
          `denied by policy: ${PLAN_ACTION_LEAD}${index}: ${decision.permission}/${decision.code}. ${REFUSAL_HINTS[decision.code]}`,
        );
      };
      // The task's planActions are checked here as well as by the gate (fail closed).
      if (!allowedKinds.includes(action.kind)) {
        return denyAction("policy_requested", { allowed: false, permission: "destructive", code: "plan_action_not_allowed" });
      }
      const synthetic: ToolCall = { id: call.id, name: actionDescriptor.name, args: actionArgs };
      const requested = policy.checkRequested(synthetic, actionDescriptor);
      if (!requested.allowed) return denyAction("policy_requested", requested);
      const resolved = privacy.resolveToolArgs({
        args: actionArgs,
        restoreFields: policy.restorableFields(actionDescriptor),
        documentFields: [],
      });
      if (!resolved.ok) {
        await record({
          type: "tool_decision",
          callId: call.id,
          tool: call.name,
          stage: "restore",
          allowed: false,
          permission: "restore",
          code: resolved.code,
        });
        return errorResult(call, resolved.code, `token not usable in field: ${PLAN_ACTION_LEAD}${index}: ${resolved.field}. ${REFUSAL_HINTS[resolved.code]}`);
      }
      const checked = await policy.checkEffective({ id: call.id, name: actionDescriptor.name, args: resolved.args }, actionDescriptor);
      if (!checked.allowed) return denyAction("policy_effective", checked);
      effectiveActions.push({ kind: action.kind, ...resolved.args });
    }
    const effectiveInput = { summary: args.summary, actions: effectiveActions };
    const effectiveArgs = validateWorkflowToolArgs("propose_plan", effectiveInput);
    if (effectiveArgs === null) return invalidArgsOf(call, workflowToolArgsProblem("propose_plan", effectiveInput));
    await record({
      type: "tool_decision",
      callId: call.id,
      tool: call.name,
      stage: "policy_effective",
      allowed: true,
      permission: null,
      code: null,
    });
    toolCalls += 1;
    const outcome = await executeWorkflow({ id: call.id, name: "propose_plan", args: effectiveArgs }, descriptor);
    if (isEnd(outcome)) return outcome;
    const result = await finishWorkflowCall(call, "propose_plan", outcome);
    if (isEnd(result) || !outcome.ok) return result;
    if (!isProposedPlan(outcome.payload)) return UNKNOWN_OUTCOME;
    proposedPlan = { digest: outcome.payload.digest, actions: outcome.payload.actions.length };
    // U-59 (AXM-15): the agent's description of this plan, masked and made safe as the last message.
    const maskedSummary = mask(args.summary);
    planSummary = maskedSummary === null ? null : (finalMessageOf(maskedSummary, (text) => privacy.mask(text))?.text ?? null);
    return result;
  };

  /**
   * U-180 (DR-69 B-1, B-3): `propose_changes`, the plan tool of plan mode `run` (its descriptor's
   * `planMode`). Every planned file is judged on its own with PLANNED_FILE_DESCRIPTOR, as a plan
   * action is: the policy gate before restoration, permitted restoration of its path, and the gate on
   * the effective path, so a protected path, one outside the run's writable lists, the state
   * directory or a path outside the workspace denies the call. The model gets the reason (the file's
   * index, never its path) and may propose again. When the tool stored the plan, the run ends as
   * plan_pending after this call, with EngineResult.plan of kind "changes".
   */
  const handleChangesCall = async (call: ToolCall, args: ProposeChangesArgs, descriptor: ToolDescriptor): Promise<ToolResult | End> => {
    const effectiveFiles: JsonObject[] = [];
    for (const [index, file] of args.files.entries()) {
      const fileArgs: JsonObject = { path: file.path };
      const denyFile = async (
        stage: "policy_requested" | "policy_effective",
        decision: Extract<PolicyDecision, { allowed: false }>,
      ): Promise<ToolResult | End> => {
        await record({
          type: "tool_decision",
          callId: call.id,
          tool: call.name,
          stage,
          allowed: false,
          permission: decision.permission,
          code: decision.code,
        });
        return errorResult(
          call,
          "policy_denied",
          `denied by policy: ${PLANNED_FILE_LEAD}${index}: ${decision.permission}/${decision.code}. ${REFUSAL_HINTS[decision.code]}`,
        );
      };
      const synthetic: ToolCall = { id: call.id, name: PLANNED_FILE_DESCRIPTOR.name, args: fileArgs };
      const requested = policy.checkRequested(synthetic, PLANNED_FILE_DESCRIPTOR);
      if (!requested.allowed) return denyFile("policy_requested", requested);
      const resolved = privacy.resolveToolArgs({
        args: fileArgs,
        restoreFields: policy.restorableFields(PLANNED_FILE_DESCRIPTOR),
        documentFields: [],
      });
      if (!resolved.ok) {
        await record({
          type: "tool_decision",
          callId: call.id,
          tool: call.name,
          stage: "restore",
          allowed: false,
          permission: "restore",
          code: resolved.code,
        });
        return errorResult(call, resolved.code, `token not usable in field: ${PLANNED_FILE_LEAD}${index}: ${resolved.field}. ${REFUSAL_HINTS[resolved.code]}`);
      }
      const checked = await policy.checkEffective({ id: call.id, name: PLANNED_FILE_DESCRIPTOR.name, args: resolved.args }, PLANNED_FILE_DESCRIPTOR);
      if (!checked.allowed) return denyFile("policy_effective", checked);
      effectiveFiles.push({ ...resolved.args, change: file.change });
    }
    const effectiveInput = { summary: args.summary, files: effectiveFiles };
    const effectiveArgs = validateWorkflowToolArgs("propose_changes", effectiveInput);
    if (effectiveArgs === null) return invalidArgsOf(call, workflowToolArgsProblem("propose_changes", effectiveInput));
    await record({
      type: "tool_decision",
      callId: call.id,
      tool: call.name,
      stage: "policy_effective",
      allowed: true,
      permission: null,
      code: null,
    });
    toolCalls += 1;
    const outcome = await executeWorkflow({ id: call.id, name: "propose_changes", args: effectiveArgs }, descriptor);
    if (isEnd(outcome)) return outcome;
    const result = await finishWorkflowCall(call, "propose_changes", outcome);
    if (isEnd(result) || !outcome.ok) return result;
    if (!isProposedChanges(outcome.payload)) return UNKNOWN_OUTCOME;
    proposedPlan = { digest: outcome.payload.digest, actions: outcome.payload.files.length, kind: "changes" };
    // As propose_plan's (U-59): the summary, masked and made safe as the last message, for the result.
    const maskedSummary = mask(args.summary);
    planSummary = maskedSummary === null ? null : (finalMessageOf(maskedSummary, (text) => privacy.mask(text))?.text ?? null);
    return result;
  };

  /** GT-E1: a task type tool call. Same order as a built-in call: validate, check, restore, check, run. */
  const handleWorkflowCall = async (call: ToolCall, name: WorkflowToolName): Promise<ToolResult | End> => {
    // A runner that cannot run task type tools answers them as unknown (contract ToolRunner).
    if (tools.executeWorkflowTool === undefined) return unknownTool(call);
    const descriptor = WORKFLOW_TOOLS[name];
    // U-180: the plan tool of mode run, chosen by the descriptor's planMode (never by the name).
    if (descriptor.endsRun === "plan" && descriptor.planMode === "run") {
      const args = validateWorkflowToolArgs("propose_changes", call.args);
      if (args === null) return invalidArgsOf(call, workflowToolArgsProblem("propose_changes", call.args));
      return handleChangesCall(call, args, descriptor);
    }
    if (descriptor.endsRun === "plan") {
      const args = validateWorkflowToolArgs("propose_plan", call.args);
      if (args === null) return invalidArgsOf(call, workflowToolArgsProblem("propose_plan", call.args));
      return handlePlanCall(call, args, descriptor);
    }
    const problem = workflowToolArgsProblem(name, call.args);
    if (problem !== null) return invalidArgsOf(call, problem);

    const requested = policy.checkRequested(call, descriptor);
    if (!requested.allowed) return denied(call, "policy_requested", requested);

    const resolved = privacy.resolveToolArgs({
      args: call.args,
      restoreFields: policy.restorableFields(descriptor),
      documentFields: descriptor.documentFields,
    });
    if (!resolved.ok) {
      await record({
        type: "tool_decision",
        callId: call.id,
        tool: name,
        stage: "restore",
        allowed: false,
        permission: "restore",
        code: resolved.code,
      });
      return errorResult(call, resolved.code, `token not usable in field: ${resolved.field}. ${REFUSAL_HINTS[resolved.code]}`);
    }
    const effectiveArgs = validateWorkflowToolArgs(name, resolved.args);
    if (effectiveArgs === null) return invalidArgsOf(call, workflowToolArgsProblem(name, resolved.args));
    const effective = { id: call.id, name, args: effectiveArgs } as EffectiveWorkflowToolCall;

    const checked = await policy.checkEffective(effective, descriptor);
    if (!checked.allowed) return denied(call, "policy_effective", checked);
    await record({
      type: "tool_decision",
      callId: call.id,
      tool: name,
      stage: "policy_effective",
      allowed: true,
      permission: null,
      code: null,
    });

    toolCalls += 1;
    const outcome = await executeWorkflow(effective, descriptor);
    if (isEnd(outcome)) return outcome;
    return finishWorkflowCall(call, name, outcome);
  };

  /** Order: validate, checkRequested, restore permitted fields, checkEffective, execute, mask, record. */
  const handleCall = async (call: ToolCall): Promise<ToolResult | End> => {
    // GT-E1: only the tools this run offers may be called. For a legacy task that is TOOL_NAMES.
    if (!(offered as readonly string[]).includes(call.name)) return unknownTool(call);
    if (isWorkflowToolName(call.name)) return handleWorkflowCall(call, call.name);
    if (!isToolName(call.name)) return unknownTool(call);
    const name = call.name;
    const descriptor = BUILTIN_TOOLS[name];
    const invalidArgs = async (problem: ArgsProblem | null): Promise<ToolResult | End> => {
      await record({
        type: "tool_decision",
        callId: call.id,
        tool: name,
        stage: "validate",
        allowed: false,
        permission: null,
        code: "invalid_args",
      });
      return errorResult(call, "invalid_args", argsProblemText(problem ?? { field: "", rule: ARGS_RULES.nonEmpty }));
    };
    const requestedProblem = toolArgsProblem(name, call.args);
    if (requestedProblem !== null) return invalidArgs(requestedProblem);

    const requested = policy.checkRequested(call, descriptor);
    if (!requested.allowed) return denied(call, "policy_requested", requested);

    const resolved = privacy.resolveToolArgs({
      args: call.args,
      restoreFields: policy.restorableFields(descriptor),
      documentFields: descriptor.documentFields,
    });
    if (!resolved.ok) {
      await record({
        type: "tool_decision",
        callId: call.id,
        tool: name,
        stage: "restore",
        allowed: false,
        permission: "restore",
        code: resolved.code,
      });
      return errorResult(call, resolved.code, `token not usable in field: ${resolved.field}. ${REFUSAL_HINTS[resolved.code]}`);
    }

    const effectiveArgs = validateToolArgs(name, resolved.args);
    if (effectiveArgs === null) return invalidArgs(toolArgsProblem(name, resolved.args));
    const effective = { id: call.id, name, args: effectiveArgs } as EffectiveToolCall;

    let checked = await policy.checkEffective(effective, descriptor);
    // U-74 (DR-3): only the confirm mark asks; without it nothing here changes.
    if (!checked.allowed && checked.confirm === true) {
      const answeredDecision = await askPermission(call, name, effective, descriptor, checked);
      if (isEnd(answeredDecision)) return answeredDecision;
      checked = answeredDecision;
    }
    if (!checked.allowed) return denied(call, "policy_effective", checked);
    await record({
      type: "tool_decision",
      callId: call.id,
      tool: name,
      stage: "policy_effective",
      allowed: true,
      permission: null,
      code: null,
    });

    toolCalls += 1;
    // DR-38: a command's window. The decision is recorded before it and the result after it, so
    // nothing the run writes falls inside; whatever changed the records there came from outside.
    const command = name === "run_command";
    if (command) {
      const before = await checkState("before_command", false, call.id);
      if (before !== null) return before;
    }
    const outcome = await execute(effective, descriptor);
    if (command) {
      const after = await checkState("after_command", false, call.id);
      if (after !== null) return after;
    }
    if (isEnd(outcome)) return outcome;

    // Mask before anything is recorded or returned to the model.
    // U-50 (AXM-6): a runner's failure gets its code's hint (TOOL_FAILURE_HINTS), then the one form.
    const content = outcome.ok ? maskJson(outcome.payload) : mask(failedToolContent(outcome.code, toolFailureMessage(outcome.code, outcome.message)));
    if (content === null) return MASKING_FAILED;
    const result: ToolResult = {
      callId: call.id,
      tool: name,
      ok: outcome.ok,
      content,
      errorCode: outcome.ok ? null : outcome.code,
    };
    await record({ type: "tool_result", result });

    if (outcome.ok && "newHash" in outcome.payload) {
      const path = mask(outcome.payload.path);
      if (path === null) return MASKING_FAILED;
      const change: FileChangeRecord = {
        path,
        previousHash: outcome.payload.previousHash,
        newHash: outcome.payload.newHash,
        created: outcome.payload.created,
      };
      changes.push(change);
      await record({ type: "file_changed", callId: call.id, ...change });
    }
    return result;
  };

  /** Why no further model call may start, or null when one may. */
  const budgetStop = (): End | null => {
    const stop = interrupted();
    if (stop !== null) return stop;
    if (modelTurns >= limits.maxModelTurns) {
      return { status: "budget-exhausted", reason: "max_model_turns" };
    }
    if (
      limits.maxTotalTokens !== null &&
      inputTokens !== null &&
      outputTokens !== null &&
      inputTokens + outputTokens >= limits.maxTotalTokens
    ) {
      return { status: "budget-exhausted", reason: "max_total_tokens" };
    }
    return null;
  };

  /** Masks the fixed instructions and the goal, records run_started and opens the conversation. */
  const start = async (): Promise<MaskedText | End> => {
    // GT-E2: a task type's instructions follow the fixed prompt under a fixed label, masked as one text.
    const instructions = settings.instructions;
    const baseText =
      instructions === null || instructions.trim().length === 0
        ? SYSTEM_PROMPT
        : `${SYSTEM_PROMPT}\n\n${INSTRUCTIONS_LABEL}\n${instructions}`;
    // U-187 (B-3): the approved plan follows, masked with the rest by this run's gateway. Review
    // V-7 M-1: its summary made safe once more as the last message is (safeModelText: key shapes
    // hidden too), whatever the stored plan holds; masking that fails ends the run (fail closed).
    let systemText = baseText;
    if (approved !== null) {
      const summary = safeModelText(approved.plan.summary.join(APPROVED_SUMMARY_GAP), (text) => privacy.mask(text));
      if (summary === null) return MASKING_FAILED;
      systemText = `${baseText}\n\n${approvedPlanText(approved.plan, summary)}`;
    }
    const system = mask(systemText);
    const goal = mask(task.goal);
    const workflow = mask(task.workflow);
    if (system === null || goal === null || workflow === null) return MASKING_FAILED;

    // run_started carries the task type settings only when the task has any, so a legacy run's
    // record is unchanged.
    const hasWorkflow =
      task.workflowRef !== undefined ||
      task.tools !== undefined ||
      task.instructions !== undefined ||
      task.plan !== undefined ||
      task.completion !== undefined ||
      task.humanReview !== undefined;
    let workflowFields = {};
    if (hasWorkflow) {
      let workflowRef: MaskedText | null = null;
      if (task.workflowRef !== undefined) {
        workflowRef = mask(task.workflowRef);
        if (workflowRef === null) return MASKING_FAILED;
      }
      workflowFields = {
        workflowRef,
        tools: [...settings.tools],
        plan: settings.plan,
        completion: settings.completion,
      };
    }

    // DR-37 (d): the applied profile, only a name of its pattern that masking leaves unchanged (a
    // name holding a registered secret is left out rather than recorded as a token).
    const profile =
      typeof task.profile === "string" && PROFILE_NAME_PATTERN.test(task.profile) && mask(task.profile) === task.profile ? task.profile : null;
    // DR-41: what the task type's rules left out of the given policy, for the run's start lines.
    const policyNarrowings = recordableNarrowings(task.policyNarrowings);
    await record({
      type: "run_started",
      schemaVersion: 1,
      taskId: task.id,
      workflow,
      provider: model.name,
      limits,
      ...workflowFields,
      ...(profile === null ? {} : { profile }),
      ...(policyNarrowings.length === 0 ? {} : { policyNarrowings }),
      ...(approved === null ? {} : { planRunId: approved.planRunId, planDigest: approved.digest, approval: approved.approval }),
    });
    state.transition("running");
    messages.push({ role: "user", content: goal });
    return system;
  };

  /** Model and tool calls until the model replies without tool calls (null) or the run ends. */
  const converse = async (system: MaskedText): Promise<End | null> => {
    for (;;) {
      const stop = budgetStop();
      if (stop !== null) return stop;

      const turn = modelTurns + 1;
      await record({
        type: "model_request",
        turn,
        system: turn === 1 ? system : null,
        newMessages: messages.slice(sent),
      });
      // DR-52: each text counted once, when first sent; the model's own messages are not counted.
      if (turn === 1) maskedPlaces += countPrivacyTokens(system);
      for (const message of messages.slice(sent)) {
        if (message.role === "user") maskedPlaces += countPrivacyTokens(message.content);
        else if (message.role === "tool") for (const sentResult of message.results) maskedPlaces += countPrivacyTokens(sentResult.content);
      }
      sent = messages.length;

      // W-1: this turn and its tool calls may change protected material.
      sinceCheck = "model";
      // GT-E1: the offered tools. A legacy task offers TOOL_NAMES and no task type tool, so its
      // request has the same shape as before (no workflowTools field).
      const request =
        offeredWorkflow.length > 0
          ? { system, messages, tools: offeredBuiltin, workflowTools: offeredWorkflow }
          : { system, messages, tools: offeredBuiltin };
      lastFinal = null;
      const outcome = await model.complete(request, runSignal);
      modelTurns = turn;
      if (!outcome.ok) {
        const interruption = interrupted();
        if (interruption !== null) return interruption;
        const message = mask(outcome.message);
        if (message !== null) {
          await record({ type: "model_error", turn, kind: outcome.kind, message });
        }
        return endedByModelError(outcome.kind, turn, outcome.httpStatus, outcome.retryable);
      }

      const response = outcome.response;
      const text = mask(response.text);
      if (text === null) return MASKING_FAILED;
      // AC-D15: from here on the calls carry only names and ids the engine may record and send back.
      const calls = recordableCalls(response.toolCalls);
      const echoed: MaskedToolCall[] = [];
      for (const call of calls) {
        const argsJson = maskJson(call.args);
        if (argsJson === null) return MASKING_FAILED;
        echoed.push({ id: call.id, name: call.name, argsJson });
      }
      await record({
        type: "model_response",
        turn,
        stop: response.stop,
        text,
        toolCalls: echoed,
        usage: response.usage,
        // DR-31 (c): the count only, and only a plausible one (model output is untrusted).
        ...(Number.isSafeInteger(response.reasoningItems) && (response.reasoningItems as number) >= 0
          ? { reasoningItems: response.reasoningItems as number }
          : {}),
      });

      if (response.usage === null) {
        inputTokens = null;
        outputTokens = null;
        // The token limit cannot be checked any more, so nothing further is done.
        if (limits.maxTotalTokens !== null) {
          return { status: "budget-exhausted", reason: "usage_unknown" };
        }
      } else if (inputTokens !== null && outputTokens !== null) {
        inputTokens += response.usage.inputTokens;
        outputTokens += response.usage.outputTokens;
      }

      const wantsTools = response.toolCalls.length > 0;
      if (response.stop === "final" && !wantsTools) {
        // Kept so that a repair message follows the model's own reply.
        lastFinal = text;
        messages.push({ role: "assistant", text, toolCalls: [] });
        return null;
      }
      if (response.stop !== "tool_calls" || !wantsTools) {
        const message = mask(`malformed model response: stop=${response.stop}`);
        if (message !== null) {
          await record({ type: "model_error", turn, kind: "malformed_response", message });
        }
        return endedByModelError("malformed_response", turn);
      }

      messages.push({ role: "assistant", text, toolCalls: echoed });
      const results: ToolResult[] = [];
      for (const call of calls) {
        const interruption = interrupted();
        if (interruption !== null) return interruption;

        const earlier = answered.get(call.id);
        if (earlier !== undefined) {
          results.push(earlier);
          continue;
        }
        if (toolCalls >= limits.maxToolCalls) {
          return { status: "budget-exhausted", reason: "max_tool_calls" };
        }
        const handled = await handleCall(call);
        if (isEnd(handled)) return handled;
        answered.set(call.id, handled);
        results.push(handled);
        // GT-E3: a stored plan ends the run. Later calls of this turn are not run.
        // DR-18 (c): a cancel or the duration limit that came while the plan was stored wins; the
        // run then ends without EngineResult.plan, so its plan.json cannot be applied.
        if (proposedPlan !== null) return interrupted() ?? PLAN_PENDING;
      }
      messages.push({ role: "tool", results });
    }
  };

  /**
   * Runs every verifier once (one round). `EngineResult.verifiers` holds the latest round.
   * Returns the end of the run, or the failed results when a repair may follow.
   */
  /**
   * GT-E4: with `completion: "human_review"`, a run whose checks are done waits for a person: it
   * ends as needs-input/awaiting_review with the masked checklist. It never becomes done.
   */
  const awaitReview = (): End => {
    const checklist: MaskedText[] = [];
    for (const item of settings.humanReview?.checklist ?? []) {
      const masked = mask(item);
      if (masked === null) return MASKING_FAILED;
      checklist.push(masked);
    }
    reviewChecklist = checklist;
    const notice = mask(REVIEW_NOTICE);
    if (notice !== null) notices.push(notice);
    return AWAITING_REVIEW;
  };

  const verify = async (): Promise<End | RepairNeeded> => {
    state.transition("verifying");
    if (task.verifiers.length === 0) {
      const notice = mask(NO_VERIFIER_NOTICE);
      if (notice !== null) notices.push(notice);
      if (settings.completion === "human_review") return awaitReview();
      return { status: "needs-input", reason: "no_verifier" };
    }
    // U-1: when protected material changed since run start, this round's verifiers are not run.
    // EngineResult.verifiers then keeps the previous round, as when a limit ends the run here.
    const before = await checkPoint("before_verify");
    if (before !== null) return before;
    const stateBefore = await checkState("before_verify", true);
    if (stateBefore !== null) return stateBefore;
    verifierResults.length = 0;
    /** Whether each recorded evidence of this round was cut (T-6), by verifier id. */
    const evidenceCut = new Map<string, boolean>();
    const outcomes: VerifierOutcome[] = [];
    for (const config of task.verifiers) {
      const stop = interrupted();
      if (stop !== null) return stop;
      let raw: RawVerifierResult;
      // W-1: a verifier command may change protected material.
      sinceCheck = "verifiers";
      try {
        raw = await verifiers.run(config, runSignal);
      } catch {
        raw = {
          id: config.id,
          kind: config.kind,
          outcome: "inconclusive" as const,
          evidence: asRawText(VERIFIER_NOT_RUN_EVIDENCE),
          checked: [VERIFIER_NOT_RUN_CHECKED],
          limits: [],
        };
      }
      const masked = mask(raw.evidence);
      const checked = raw.checked.map(mask);
      const limitNotes = raw.limits.map(mask);
      if (masked === null || checked.includes(null) || limitNotes.includes(null)) {
        return MASKING_FAILED;
      }
      // T-6: masked first, then the runner's slack dropped and the text cut. A cut of masked text
      // plus a fixed note holds nothing that was not already masked.
      const prepared = prepareEvidence(masked, raw.evidenceTruncated === true);
      const result: VerifierResult = {
        id: raw.id,
        kind: raw.kind,
        outcome: raw.outcome,
        evidence: prepared.text as MaskedText,
        checked: checked as MaskedText[],
        limits: limitNotes as MaskedText[],
      };
      verifierResults.push(result);
      evidenceCut.set(result.id, prepared.truncated);
      outcomes.push(raw.outcome);
      await record({ type: "verifier_result", result });
    }
    // T-8: the user's cancel, or the duration limit ending while the last verifier ran.
    const stopped = interrupted();
    if (stopped !== null) return stopped;
    // U-1, U-2: a change made during the round (a verifier command, for example) makes the whole
    // round untrusted, whatever the verifiers said, and is not repaired.
    const after = await checkPoint("after_verify");
    if (after !== null) return after;
    const stateAfter = await checkState("after_verify", true);
    if (stateAfter !== null) return stateAfter;
    if (integrity !== undefined) {
      // The capture itself may have outlasted the duration limit or met a cancel.
      const late = interrupted();
      if (late !== null) return late;
    }
    if (!outcomes.includes("fail")) {
      if (outcomes.includes("inconclusive")) return { status: "needs-input", reason: "verifier_inconclusive" };
      if (settings.completion === "human_review") return awaitReview();
      return { status: "done", reason: "verified" };
    }
    // R-1: a verifier that could not decide is not something the model can fix, so no repair.
    if (outcomes.includes("inconclusive")) return { status: "failed", reason: "verifier_failed" };
    return decideRepair(
      verifierResults
        .filter((result) => result.outcome === "fail")
        .map((result) => ({ ...result, evidenceCut: evidenceCut.get(result.id) === true })),
    );
  };

  /** R-2, R-3: a repair only while attempts are left and the same failure has not repeated too often. */
  const decideRepair = (failed: readonly FailedForFeedback[]): End | RepairNeeded => {
    const signature = failureSignature(failed);
    sameFailures = signature === lastSignature ? sameFailures + 1 : 1;
    lastSignature = signature;
    if (repairAttempts >= limits.maxRepairAttempts) return { status: "failed", reason: "verifier_failed" };
    if (sameFailures >= limits.maxSameFailures) return { status: "failed", reason: "repeated_failure" };
    return { failed: [...failed] };
  };

  /**
   * Starts a repair: records repair_started, goes back to running and adds the masked, cut
   * evidence as the next user message. Nothing starts when no model call could follow.
   */
  const repair = async (needed: RepairNeeded): Promise<End | null> => {
    const stop = budgetStop();
    if (stop !== null) return stop;
    const attempt = repairAttempts + 1;
    const feedback = buildRepairFeedback(needed.failed, attempt, limits.maxRepairAttempts);
    const content = mask(feedback.text);
    if (content === null) return MASKING_FAILED;
    repairAttempts = attempt;
    await record({
      type: "repair_started",
      attempt,
      failedVerifiers: needed.failed.map((result) => result.id),
      feedbackTruncated: feedback.truncated,
    });
    state.transition("running");
    messages.push({ role: "user", content });
    return null;
  };

  /** Ends the run before its first model request with a notice (masked); null when it cannot be masked. */
  const staleWith = (text: string): End => {
    const masked = mask(text);
    if (masked !== null) notices.push(masked);
    return PLAN_STALE;
  };

  /**
   * U-187 (B-6, B-7): before the first model request of a run that carries out an approved plan,
   * every planned file as it is now (fail closed), then the gate on it as a write, then the claim.
   */
  const checkApprovedPlan = async (plan: ApprovedChangesPlan): Promise<End | null> => {
    for (const [index, file] of plan.plan.files.entries()) {
      let now: PlannedFileNow;
      try {
        now = await plan.fileNow(file, signal);
      } catch {
        now = { kind: "other" };
      }
      const stop = interrupted();
      if (stop !== null) return stop;
      if (plannedFileStale(file, now)) return staleWith(`${APPROVED_STALE_LEAD}${index}${APPROVED_STALE_END}`);
      // U-219: judgePlannedFile, given out for the app layer's check before the approval;
      // Codex V-21: the app still has its own lines until p5a connects it (U-229).
      const decision = await judgePlannedFile(policy, file.path);
      if (!decision.allowed) return staleWith(`${APPROVED_DENIED_LEAD}${index}: ${decision.permission}/${decision.code}${APPROVED_DENIED_END}`);
    }
    const stop = interrupted();
    if (stop !== null) return stop;
    let claimed: "marked" | "already_applied";
    try {
      claimed = await plan.markApplied();
    } catch {
      return staleWith(APPROVED_CLAIM_FAILED_NOTICE);
    }
    if (claimed !== "marked") return staleWith(APPROVED_CLAIMED_NOTICE);
    // U-181's handoff: as an apply run, whether a run since the plan could not check the records;
    // told once, the run goes on. A question that cannot be answered counts as unchecked.
    if (plan.planRecordsUnchecked !== undefined) {
      let unchecked: boolean;
      try {
        unchecked = (await plan.planRecordsUnchecked()) === true;
      } catch {
        unchecked = true;
      }
      if (unchecked) {
        const masked = mask(APPROVED_RECORDS_UNCHECKED_NOTICE);
        if (masked !== null) notices.push(masked);
      }
    }
    return null;
  };

  const runLoop = async (): Promise<End> => {
    const system = await start();
    if (typeof system !== "string") return system;
    // U-187 (B-6, B-7): checked and claimed before the baselines, so the claim (applied.json in the
    // plan run's records) is not a change the state checks see during this run.
    if (approved !== null) {
      const blocked = await checkApprovedPlan(approved);
      if (blocked !== null) return blocked;
    }
    // U-1: the baseline, after run_started and before the first model request.
    const unchecked = await checkPoint("run_start");
    if (unchecked !== null) return unchecked;
    // DR-38: the state directory's fingerprints at the start.
    const stateStart = await checkState("run_start", true);
    if (stateStart !== null) return stateStart;
    for (;;) {
      const conversed = await converse(system);
      if (conversed !== null) return conversed;
      // GT-E3: a plan run is verified only after its plan is applied (an apply run). A model that
      // ends without a stored plan has not done what a plan run asks for. U-170: `run` too. U-187:
      // a run that carries out an approved plan is verified as any run.
      if (approved === null && settings.plan !== "none") {
        const message = mask(settings.plan === "run" ? NO_CHANGES_PLAN_MESSAGE : NO_PLAN_MESSAGE);
        if (message !== null) {
          notices.push(message);
          await record({ type: "model_error", turn: modelTurns, kind: "malformed_response", message });
        }
        endedByModelError("malformed_response", modelTurns);
        return NO_PLAN;
      }
      const verdict = await verify();
      if (isEnd(verdict)) return verdict;
      const repaired = await repair(verdict);
      if (repaired !== null) return repaired;
    }
  };

  try {
    // W-1: whatever ended the run, activity after the last integrity check is checked once more.
    // DR-38: then the run records, after everything else and before run_finished.
    const end = await checkStateAtEnd(await checkAtEnd(await runLoop()));
    if (state.status === "created" && end.status !== "cancelled") state.transition("running");
    state.transition(end.status);

    const usage = {
      modelTurns,
      toolCalls,
      inputTokens,
      outputTokens,
      durationMs: clock.now() - startedAt,
      repairAttempts,
    };
    await record({ type: "run_finished", status: end.status, reason: end.reason, usage });
    const finalMessage = lastFinal !== null && end.reason !== "plan_pending" ? finalMessageOf(lastFinal, (text) => privacy.mask(text)) : null;
    return {
      schemaVersion: RESULT_SCHEMA_VERSION,
      kind: "run",
      runId,
      taskId: task.id,
      status: end.status,
      reason: end.reason,
      exitCode: RUN_EXIT_CODES[end.status],
      provider: model.name,
      verifiers: verifierResults,
      changes,
      usage,
      journalPath: `${STATE_DIR_NAME}/${RUNS_DIR_NAME}/${runId}/${JOURNAL_FILE_NAME}`,
      notices,
      // U-2: only when at least one integrity_checked was recorded; the last one's list.
      ...(protectedChanged !== undefined ? { protectedChanged } : {}),
      // DR-52: counts only, and only when the gateway says it holds at least one value.
      ...(privacy.registeredValues !== undefined && privacy.registeredValues > 0
        ? { masking: { registeredValues: privacy.registeredValues, maskedPlaces } }
        : {}),
      // DR-38: only when at least one state_checked was recorded; the last one's list.
      ...(stateChanged !== undefined ? { stateChanged } : {}),
      // DR-47: the agent's last message, only when the run's last model response was a final reply
      // and the run is not a plan run (its place is the plan's summary).
      ...(finalMessage !== null ? { finalMessage } : {}),
      // GT-E3, GT-E4: only with the reasons that carry them.
      ...(end.reason === "plan_pending" && proposedPlan !== null ? { plan: proposedPlan } : {}),
      // U-59 (AXM-15): apart from `plan`, whose two fields stay.
      ...(end.reason === "plan_pending" && proposedPlan !== null && planSummary !== null ? { planSummary } : {}),
      ...(end.reason === "awaiting_review" && reviewChecklist !== null ? { review: { checklist: reviewChecklist } } : {}),
      // U-55 (AXM-9): only when a model error ended the run (not masking that failed).
      ...(end.reason === "model_error" && endingModelError !== null ? { modelError: endingModelError } : {}),
      // U-187 (B-3): a run that carries out an approved plan names it.
      ...(approved === null ? {} : { planRunId: approved.planRunId, planDigest: approved.digest }),
    };
  } finally {
    clearTimeout(timer);
    await journal.close();
  }
}

export const runTask: RunTask = (deps: EngineDeps): Promise<EngineResult> => runWith(deps, null);

/**
 * U-187 (DR-69 B-3, B-4, B-6, B-7): carries out an approved `run` plan (ApprovedPlanRunDeps). The
 * engine makes the gate itself, with the task's writable lists and the plan's files as one more list
 * (approvedPlanWritablePathSets), then runs as runTask does with the checks, the claim and the
 * system text the contract names.
 */
export const runApprovedPlan: RunApprovedPlan = (deps) => {
  const { approved, policyFor, ...rest } = deps;
  const policy = policyFor(approvedPlanWritablePathSets(rest.task.writablePathSets, approved.plan));
  return runWith({ ...rest, policy }, approved);
};
