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
  ConfirmAnswer,
  EffectiveToolCall,
  EffectiveWorkflowToolCall,
  EngineDeps,
  EngineResult,
  FileChangeRecord,
  JournalEvent,
  JournalRecord,
  JsonObject,
  MaskedText,
  MaskedToolCall,
  ModelErrorKind,
  ModelMessage,
  PolicyDecision,
  ProposeChangesArgs,
  ProposePlanArgs,
  RawText,
  RawToolOutcome,
  RawVerifierResult,
  RawWorkflowToolOutcome,
  ApprovedChangesPlan,
  PlannedFileNow,
  RunApprovedPlan,
  RunModelError,
  RunTask,
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
import type { End, RepairNeeded, ProposedPlan } from "./pure.js";
export { INTEGRITY_NOTICE_PATHS, offeredTools } from "./pure.js";

import { createRunHelpers } from "./run-helpers.js";
import { createCallIds, createPermission } from "./run-calls.js";
import { createRunChecks } from "./run-checks.js";

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
  /** The model-bound conversation. It keeps growing across repairs. */
  const messages: ModelMessage[] = [];
  /** How many messages earlier `model_request` records already hold. */
  let sent = 0;
  let repairAttempts = 0;
  /** Signature of the latest failed verification, and how many times in a row it occurred. */
  let lastSignature: string | null = null;
  let sameFailures = 0;
  // DR-52 (U-25): the protected tokens in what the engine sent to the model (EngineResult.masking).
  let maskedPlaces = 0;
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
  const stateGuard = deps.stateGuard;

  // Real-time deadline so that a model or tool call in flight is interrupted at the duration limit.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), Math.min(limits.maxDurationMs, MAX_TIMER_MS));
  timer.unref();
  const runSignal = AbortSignal.any([signal, deadline.signal]);
  const { mask, maskJson, interrupted, record, errorResult, shownText, recordDenial, denied, execute, unknownTool, invalidArgsOf, executeWorkflow, finishWorkflowCall } = createRunHelpers(privacy, journal, signal, deadline, clock, startedAt, limits, tools, policy, runSignal, offered);
  const { recordableCalls } = createCallIds(mask);
  const { askPermission } = createPermission(shownText, record, interrupted, recordDenial, policy, deps, runSignal);
  const checks = createRunChecks(integrity, stateGuard, mask, record, interrupted, notices);
  const { checkIntegrity, checkAtEnd, checkState, checkStateAtEnd, checkPoint, noteActivity } = checks;

  /**
   * Builds, records and returns the masked result of a call that was rejected before execution.
   * Every result handed back to the model is recorded as a tool_result.
   */
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
      noteActivity("model");
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
    const interruption = interrupted();
    if (interruption !== null) return interruption;
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
      ...(checks.protectedChanged !== undefined ? { protectedChanged: checks.protectedChanged } : {}),
      // DR-52: counts only, and only when the gateway says it holds at least one value.
      ...(privacy.registeredValues !== undefined && privacy.registeredValues > 0
        ? { masking: { registeredValues: privacy.registeredValues, maskedPlaces } }
        : {}),
      // DR-38: only when at least one state_checked was recorded; the last one's list.
      ...(checks.stateChanged !== undefined ? { stateChanged: checks.stateChanged } : {}),
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
