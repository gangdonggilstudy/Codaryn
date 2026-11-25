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
  MaskedText,
  RawVerifierResult,
  ApprovedChangesPlan,
  PlannedFileNow,
  RunApprovedPlan,
  RunTask,
  VerifierOutcome,
  VerifierResult,
} from "../contracts/index.js";
import { countPrivacyTokens } from "../contracts/index.js";
import { buildRepairFeedback, failureSignature, prepareEvidence } from "./feedback.js";
import type { FailedForFeedback } from "./feedback.js";
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
import type { End, RepairNeeded } from "./pure.js";
export { INTEGRITY_NOTICE_PATHS, offeredTools } from "./pure.js";

import { createRunHelpers } from "./run-helpers.js";
import { createCallIds, createPermission } from "./run-calls.js";
import { createRunChecks } from "./run-checks.js";
import type { RunTally } from "./run-tally.js";
import { createRunTools } from "./run-tools.js";
import { createRunConverse } from "./run-converse.js";

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
  /** Signature of the latest failed verification, and how many times in a row it occurred. */
  let lastSignature: string | null = null;
  let sameFailures = 0;
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

  /**
   * Builds, records and returns the masked result of a call that was rejected before execution.
   * Every result handed back to the model is recorded as a tool_result.
   */
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
    tally.reviewChecklist = checklist;
    const notice = mask(REVIEW_NOTICE);
    if (notice !== null) tally.notices.push(notice);
    return AWAITING_REVIEW;
  };

  const verify = async (): Promise<End | RepairNeeded> => {
    tally.state.transition("verifying");
    const interruption = interrupted();
    if (interruption !== null) return interruption;
    if (task.verifiers.length === 0) {
      const notice = mask(NO_VERIFIER_NOTICE);
      if (notice !== null) tally.notices.push(notice);
      if (settings.completion === "human_review") return awaitReview();
      return { status: "needs-input", reason: "no_verifier" };
    }
    // U-1: when protected material changed since run start, this round's verifiers are not run.
    // EngineResult.verifiers then keeps the previous round, as when a limit ends the run here.
    const before = await checkPoint("before_verify");
    if (before !== null) return before;
    const stateBefore = await checkState("before_verify", true);
    if (stateBefore !== null) return stateBefore;
    tally.verifierResults.length = 0;
    /** Whether each recorded evidence of this round was cut (T-6), by verifier id. */
    const evidenceCut = new Map<string, boolean>();
    const outcomes: VerifierOutcome[] = [];
    for (const config of task.verifiers) {
      const stop = interrupted();
      if (stop !== null) return stop;
      let raw: RawVerifierResult;
      // W-1: a verifier command may change protected material.
      noteActivity("verifiers");
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
      tally.verifierResults.push(result);
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
      tally.verifierResults
        .filter((result) => result.outcome === "fail")
        .map((result) => ({ ...result, evidenceCut: evidenceCut.get(result.id) === true })),
    );
  };

  /** R-2, R-3: a repair only while attempts are left and the same failure has not repeated too often. */
  const decideRepair = (failed: readonly FailedForFeedback[]): End | RepairNeeded => {
    const signature = failureSignature(failed);
    sameFailures = signature === lastSignature ? sameFailures + 1 : 1;
    lastSignature = signature;
    if (tally.repairAttempts >= limits.maxRepairAttempts) return { status: "failed", reason: "verifier_failed" };
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
    const attempt = tally.repairAttempts + 1;
    const feedback = buildRepairFeedback(needed.failed, attempt, limits.maxRepairAttempts);
    const content = mask(feedback.text);
    if (content === null) return MASKING_FAILED;
    tally.repairAttempts = attempt;
    await record({
      type: "repair_started",
      attempt,
      failedVerifiers: needed.failed.map((result) => result.id),
      feedbackTruncated: feedback.truncated,
    });
    tally.state.transition("running");
    tally.messages.push({ role: "user", content });
    return null;
  };

  /** Ends the run before its first model request with a notice (masked); null when it cannot be masked. */
  const staleWith = (text: string): End => {
    const masked = mask(text);
    if (masked !== null) tally.notices.push(masked);
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
        now = await plan.fileNow(file, runSignal);
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
        if (masked !== null) tally.notices.push(masked);
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
