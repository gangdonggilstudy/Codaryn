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
  ALL_TOOL_NAMES,
  BUILTIN_TOOLS,
  CALL_ID_PATTERN_SOURCE,
  JOURNAL_FILE_NAME,
  PLAN_ACTION_DESCRIPTORS,
  PLANNED_FILE_DESCRIPTOR,
  approvedPlanWritablePathSets,
  plannedFileStale,
  REPLACED_CALL_ID_PREFIX,
  RESULT_SCHEMA_VERSION,
  modelErrorRetryable,
  RUNS_DIR_NAME,
  RUN_EXIT_CODES,
  STATE_DIR_NAME,
  TOOL_NAMES,
  UNKNOWN_TOOL_RECORD_NAME,
  WORKFLOW_TOOLS,
  REFUSAL_HINTS,
  TOOL_FAILURE_HINTS,
  asRawText,
  failedToolContent,
  safeModelText,
  toolFailureMessage,
  workflowSettingsOf,
} from "../contracts/index.js";
import type {
  EngineDeps,
  EngineResult,
  ApprovedChangesPlan,
  RunApprovedPlan,
  RunTask,
} from "../contracts/index.js";
import { countPrivacyTokens } from "../contracts/index.js";
import { buildRepairFeedback, failureSignature, prepareEvidence } from "./feedback.js";
import { finalMessageOf } from "./final-message.js";
import { judgePlannedFile } from "./planned-file.js";
import { RunState } from "./state.js";
import {
  ARGS_RULES,
  argsProblemText,
  toolArgsProblem,
  validateToolArgs,
  validateWorkflowToolArgs,
  workflowToolArgsProblem,
} from "./validate-args.js";

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

import {
  SYSTEM_PROMPT, INSTRUCTIONS_LABEL, NO_PLAN_MESSAGE, NO_CHANGES_PLAN_MESSAGE,
  PLAN_ACTION_LEAD, PLANNED_FILE_LEAD, APPROVED_SUMMARY_GAP, APPROVED_STALE_LEAD,
  APPROVED_STALE_END, APPROVED_DENIED_LEAD, APPROVED_DENIED_END, APPROVED_CLAIMED_NOTICE,
  APPROVED_CLAIM_FAILED_NOTICE, APPROVED_RECORDS_UNCHECKED_NOTICE, REVIEW_NOTICE, NO_VERIFIER_NOTICE,
  UNKNOWN_TOOL_LEAD, WRITE_NOT_APPLIED_MESSAGE, VERIFIER_NOT_RUN_EVIDENCE, VERIFIER_NOT_RUN_CHECKED,
} from "./model-texts.js";
export { SYSTEM_PROMPT, INSTRUCTIONS_LABEL, APPROVED_PLAN_LABEL, FIXED_MODEL_TEXTS } from "./model-texts.js";
import {
  MAX_TIMER_MS, CALL_ID_PATTERN, PROFILE_NAME_PATTERN, recordableNarrowings,
  MASKING_FAILED, CANCELLED, UNKNOWN_OUTCOME,
  PLAN_PENDING,
  PLAN_STALE, AWAITING_REVIEW, NO_PLAN, isEnd,
  isToolName, isWorkflowToolName, offeredTools, answerDecision,
  isProposedPlan, approvedPlanText, isProposedChanges,
} from "./pure.js";
import type { End } from "./pure.js";
export { INTEGRITY_NOTICE_PATHS, offeredTools } from "./pure.js";

import { createRunHelpers } from "./run-helpers.js";
import { createCallIds, createPermission } from "./run-calls.js";
import { createRunChecks } from "./run-checks.js";
import type { RunTally } from "./run-tally.js";
import { createRunTools } from "./run-tools.js";
import { createRunConverse } from "./run-converse.js";
import { createRunVerify } from "./run-verify.js";

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
  const initialState = new RunState();
  const startedAt = clock.now();
  const tally: RunTally = {
    /** GT-E3: set when `propose_plan` stored a plan; the run then ends as plan_pending. */
    proposedPlan: null,
    /** U-59 (AXM-15): the made-safe summary of the propose_plan call that stored proposedPlan. */
    planSummary: null,
    /** GT-E4: the masked checklist of a run that ends as awaiting_review. */
    reviewChecklist: null,
    state: initialState,
    modelTurns: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    changes: [],
    verifierResults: [],
    notices: [],
    /** The model-bound conversation. It keeps growing across repairs. */
    messages: [],
    repairAttempts: 0,
    // DR-52 (U-25): the protected tokens in what the engine sent to the model (EngineResult.masking).
    maskedPlaces: 0,
    // DR-47 (U-21): the masked text of the last model response when it was a final reply; reset when
    // the model is asked again, so a run that ended without a reply has none.
    lastFinal: null,
    /** U-55 (AXM-9): the model error that ended the run (EngineResult.modelError); null otherwise. */
    endingModelError: null,
  };
  const stateGuard = deps.stateGuard;

  // Real-time deadline so that a model or tool call in flight is interrupted at the duration limit.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), Math.min(limits.maxDurationMs, MAX_TIMER_MS));
  timer.unref();
  const runSignal = AbortSignal.any([signal, deadline.signal]);
  const { mask, maskJson, interrupted, record, errorResult, shownText, recordDenial, denied, execute, unknownTool, invalidArgsOf, executeWorkflow, finishWorkflowCall } = createRunHelpers(privacy, journal, signal, deadline, clock, startedAt, limits, tools, policy, runSignal, offered);
  const { recordableCalls } = createCallIds(mask);
  const { askPermission } = createPermission(shownText, record, interrupted, recordDenial, policy, deps, runSignal);
  const checks = createRunChecks(integrity, stateGuard, mask, record, interrupted, tally.notices);
  const { checkIntegrity, checkAtEnd, checkState, checkStateAtEnd, checkPoint, noteActivity } = checks;
  const { handleCall } = createRunTools(tally, task, tools, policy, privacy, offered, mask, maskJson, record, errorResult, denied, execute, unknownTool, invalidArgsOf, executeWorkflow, finishWorkflowCall, askPermission, checkState);
  const { endedByModelError, budgetStop, start, converse } = createRunConverse(tally, task, model, privacy, limits, settings, approved, offeredBuiltin, offeredWorkflow, runSignal, mask, maskJson, interrupted, record, recordableCalls, noteActivity, handleCall);
  const { verify, repair, checkApprovedPlan } = createRunVerify(tally, task, verifiers, settings, limits, integrity, policy, runSignal, mask, interrupted, record, checkPoint, checkState, noteActivity, budgetStop);

  /**
   * Builds, records and returns the masked result of a call that was rejected before execution.
   * Every result handed back to the model is recorded as a tool_result.
   */
  /**
   * Runs every verifier once (one round). `EngineResult.verifiers` holds the latest round.
   * Returns the end of the run, or the failed results when a repair may follow.
   */
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
          tally.notices.push(message);
          await record({ type: "model_error", turn: tally.modelTurns, kind: "malformed_response", message });
        }
        endedByModelError("malformed_response", tally.modelTurns);
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
    if (tally.state.status === "created" && end.status !== "cancelled") tally.state.transition("running");
    tally.state.transition(end.status);

    const usage = {
      modelTurns: tally.modelTurns,
      toolCalls: tally.toolCalls,
      inputTokens: tally.inputTokens,
      outputTokens: tally.outputTokens,
      durationMs: clock.now() - startedAt,
      repairAttempts: tally.repairAttempts,
    };
    await record({ type: "run_finished", status: end.status, reason: end.reason, usage });
    const finalMessage = tally.lastFinal !== null && end.reason !== "plan_pending" ? finalMessageOf(tally.lastFinal, (text) => privacy.mask(text)) : null;
    return {
      schemaVersion: RESULT_SCHEMA_VERSION,
      kind: "run",
      runId,
      taskId: task.id,
      status: end.status,
      reason: end.reason,
      exitCode: RUN_EXIT_CODES[end.status],
      provider: model.name,
      verifiers: tally.verifierResults,
      changes: tally.changes,
      usage,
      journalPath: `${STATE_DIR_NAME}/${RUNS_DIR_NAME}/${runId}/${JOURNAL_FILE_NAME}`,
      notices: tally.notices,
      // U-2: only when at least one integrity_checked was recorded; the last one's list.
      ...(checks.protectedChanged !== undefined ? { protectedChanged: checks.protectedChanged } : {}),
      // DR-52: counts only, and only when the gateway says it holds at least one value.
      ...(privacy.registeredValues !== undefined && privacy.registeredValues > 0
        ? { masking: { registeredValues: privacy.registeredValues, maskedPlaces: tally.maskedPlaces } }
        : {}),
      // DR-38: only when at least one state_checked was recorded; the last one's list.
      ...(checks.stateChanged !== undefined ? { stateChanged: checks.stateChanged } : {}),
      // DR-47: the agent's last message, only when the run's last model response was a final reply
      // and the run is not a plan run (its place is the plan's summary).
      ...(finalMessage !== null ? { finalMessage } : {}),
      // GT-E3, GT-E4: only with the reasons that carry them.
      ...(end.reason === "plan_pending" && tally.proposedPlan !== null ? { plan: tally.proposedPlan } : {}),
      // U-59 (AXM-15): apart from `plan`, whose two fields stay.
      ...(end.reason === "plan_pending" && tally.proposedPlan !== null && tally.planSummary !== null ? { planSummary: tally.planSummary } : {}),
      ...(end.reason === "awaiting_review" && tally.reviewChecklist !== null ? { review: { checklist: tally.reviewChecklist } } : {}),
      // U-55 (AXM-9): only when a model error ended the run (not masking that failed).
      ...(end.reason === "model_error" && tally.endingModelError !== null ? { modelError: tally.endingModelError } : {}),
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
