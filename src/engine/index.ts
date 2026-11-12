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
 * workflow settings (`workflowSettingsOf`) and never a workflow id. A task without them gets the
 * legacy settings, and its requests, records and result are as before.
 * - GT-E1: only the settings' tools are offered (built-in ones in `tools`, workflow tools in
 *   `workflowTools`) and may be called; any other name is `unknown_tool`. Workflow tools take the
 *   same checks and run through `ToolRunner.executeWorkflowTool`.
 * - GT-E2: `instructions` follow the fixed prompt under INSTRUCTIONS_LABEL, masked with it.
 * - GT-E3, GT-E5: with `plan: "apply"` only read tools and the tool whose descriptor says
 *   `endsRun: "plan"` are offered. Each plan action is judged on its own (the task's `planActions`,
 *   the gate before and after restoration). A stored plan ends the run as needs-input/plan_pending
 *   with `EngineResult.plan` and no verification; ending without one is failed/model_error.
 * - GT-E4: with `completion: "human_review"`, checks that are done (all pass, or no verifier) end
 *   the run as needs-input/awaiting_review with `EngineResult.review`, never as done.
 */

import {
  ALL_TOOL_DESCRIPTORS,
  ALL_TOOL_NAMES,
  BUILTIN_TOOLS,
  CALL_ID_PATTERN_SOURCE,
  JOURNAL_FILE_NAME,
  PLAN_ACTION_DESCRIPTORS,
  REPLACED_CALL_ID_PREFIX,
  RESULT_SCHEMA_VERSION,
  RUNS_DIR_NAME,
  RUN_EXIT_CODES,
  STATE_DIR_NAME,
  TOOL_NAMES,
  UNKNOWN_TOOL_RECORD_NAME,
  WORKFLOW_TOOLS,
  WORKFLOW_TOOL_NAMES,
  asRawText,
  workflowSettingsOf,
} from "../contracts/index.js";
import type {
  AnyToolName,
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
  ModelMessage,
  PolicyDecision,
  ProposePlanArgs,
  RawText,
  RawToolOutcome,
  RawVerifierResult,
  RawWorkflowToolOutcome,
  ResolvedPlanAction,
  RunReason,
  RunTask,
  TerminalRunStatus,
  ToolCall,
  ToolDescriptor,
  ToolErrorCode,
  ToolName,
  ToolResult,
  VerifierOutcome,
  VerifierResult,
  WorkflowToolName,
} from "../contracts/index.js";
import { REPAIR_FIXED_TEXTS, buildRepairFeedback, failureSignature, prepareEvidence } from "./feedback.js";
import type { FailedForFeedback } from "./feedback.js";
import { RunState } from "./state.js";
import { validateToolArgs, validateWorkflowToolArgs } from "./validate-args.js";

export { RunState, InvalidTransitionError, canTransition } from "./state.js";
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
  "When the work is finished, reply without tool calls. Verifiers decide whether the task succeeded.",
].join("\n");

/**
 * GT-E2: the label between the fixed system prompt and a workflow's instructions. The whole system
 * text is masked before it is sent or recorded.
 */
export const INSTRUCTIONS_LABEL = "Workflow instructions:";
/** GT-E3: a plan run whose model ended without a stored plan. */
const NO_PLAN_MESSAGE = "the run ended without a plan: propose_plan did not succeed";
/** GT-E3: the lead of a denial or restore failure that concerns one plan action. */
const PLAN_ACTION_LEAD = "action ";
/** GT-E4: notice of a run that waits for a person's review. */
const REVIEW_NOTICE = "awaiting human review: the configured checks are done; a person records the verdict";
const NO_VERIFIER_NOTICE = "no automatic verification: no verifier is configured for this task";
const UNKNOWN_TOOL_MESSAGE = "unknown tool";
const INVALID_ARGS_MESSAGE = "invalid arguments for this tool";
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

/** Every fixed text the engine sends to a model or records. Tests mask these with the real gateway. */
export const FIXED_MODEL_TEXTS: readonly string[] = [
  SYSTEM_PROMPT,
  INSTRUCTIONS_LABEL,
  NO_PLAN_MESSAGE,
  PLAN_ACTION_LEAD,
  REVIEW_NOTICE,
  NO_VERIFIER_NOTICE,
  UNKNOWN_TOOL_MESSAGE,
  INVALID_ARGS_MESSAGE,
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
  INTEGRITY_END_UNMASKABLE,
  INTEGRITY_END_LABEL,
];
const MAX_TIMER_MS = 2_147_483_647;
/** AC-D15: the call ids the engine keeps as given. */
const CALL_ID_PATTERN = new RegExp(CALL_ID_PATTERN_SOURCE);

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
const PLAN_PENDING: End = { status: "needs-input", reason: "plan_pending" };
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
 * A plan run (`plan: "apply"`) offers read tools and the plan tool only; any other run offers every
 * listed tool except the plan tool. A legacy task lists TOOL_NAMES and gets exactly those.
 */
export function offeredTools(tools: readonly AnyToolName[], plan: "none" | "apply"): readonly AnyToolName[] {
  const offered: AnyToolName[] = [];
  for (const name of tools) {
    if (offered.includes(name) || !Object.hasOwn(ALL_TOOL_DESCRIPTORS, name)) continue;
    const descriptor = ALL_TOOL_DESCRIPTORS[name];
    const endsPlan = descriptor.endsRun === "plan";
    const allowed = plan === "apply" ? descriptor.displayClass === "read" || endsPlan : !endsPlan;
    if (allowed) offered.push(name);
  }
  return offered;
}

/** A stored plan's digest and size, as `EngineResult.plan` holds it. */
interface ProposedPlan {
  readonly digest: ContentHash;
  readonly actions: number;
}

function isProposedPlan(payload: unknown): payload is { readonly digest: ContentHash; readonly actions: readonly ResolvedPlanAction[] } {
  if (typeof payload !== "object" || payload === null) return false;
  const value = payload as { digest?: unknown; actions?: unknown };
  return typeof value.digest === "string" && Array.isArray(value.actions);
}

export const runTask: RunTask = async (deps: EngineDeps): Promise<EngineResult> => {
  const { task, runId, model, privacy, policy, tools, verifiers, journal, clock, signal, integrity } = deps;
  const limits = task.limits;
  // GT-E1 to GT-E4: everything a workflow changes comes from the task's explicit settings.
  // A task without them gets the legacy settings, so its requests, records and result stay as before.
  const settings = workflowSettingsOf(task);
  const offered = offeredTools(settings.tools, settings.plan);
  const offeredBuiltin = offered.filter(isToolName);
  const offeredWorkflow = offered.filter(isWorkflowToolName);
  /** GT-E3: set when `propose_plan` stored a plan; the run then ends as plan_pending. */
  let proposedPlan: ProposedPlan | null = null;
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
  let protectedChanged: readonly MaskedText[] | undefined;
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
    const content = mask(message);
    if (content === null) return MASKING_FAILED;
    const result: ToolResult = { callId: call.id, tool: call.name, ok: false, content, errorCode: code };
    await record({ type: "tool_result", result });
    return result;
  };

  const denied = async (
    call: ToolCall,
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
    return errorResult(call, "policy_denied", `denied by policy: ${decision.permission}/${decision.code}`);
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
    return errorResult(call, "unknown_tool", UNKNOWN_TOOL_MESSAGE);
  };

  const invalidArgsOf = async (call: ToolCall): Promise<ToolResult | End> => {
    await record({
      type: "tool_decision",
      callId: call.id,
      tool: call.name,
      stage: "validate",
      allowed: false,
      permission: null,
      code: "invalid_args",
    });
    return errorResult(call, "invalid_args", INVALID_ARGS_MESSAGE);
  };

  /**
   * Runs a checked workflow tool call. Like `execute`: when the runner throws, a read is retried
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

  /** Masks, records and returns the outcome of an executed workflow tool call. */
  const finishWorkflowCall = async (
    call: ToolCall,
    name: WorkflowToolName,
    outcome: RawWorkflowToolOutcome,
  ): Promise<ToolResult | End> => {
    const content = outcome.ok ? maskJson(outcome.payload) : mask(outcome.message);
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
          `denied by policy: ${PLAN_ACTION_LEAD}${index}: ${decision.permission}/${decision.code}`,
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
        return errorResult(call, resolved.code, `token not usable in field: ${PLAN_ACTION_LEAD}${index}: ${resolved.field}`);
      }
      const checked = await policy.checkEffective({ id: call.id, name: actionDescriptor.name, args: resolved.args }, actionDescriptor);
      if (!checked.allowed) return denyAction("policy_effective", checked);
      effectiveActions.push({ kind: action.kind, ...resolved.args });
    }
    const effectiveArgs = validateWorkflowToolArgs("propose_plan", { summary: args.summary, actions: effectiveActions });
    if (effectiveArgs === null) return invalidArgsOf(call);
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
    return result;
  };

  /** GT-E1: a workflow tool call. Same order as a built-in call: validate, check, restore, check, run. */
  const handleWorkflowCall = async (call: ToolCall, name: WorkflowToolName): Promise<ToolResult | End> => {
    // A runner that cannot run workflow tools answers them as unknown (contract ToolRunner).
    if (tools.executeWorkflowTool === undefined) return unknownTool(call);
    const descriptor = WORKFLOW_TOOLS[name];
    if (descriptor.endsRun === "plan") {
      const args = validateWorkflowToolArgs("propose_plan", call.args);
      if (args === null) return invalidArgsOf(call);
      return handlePlanCall(call, args, descriptor);
    }
    if (validateWorkflowToolArgs(name, call.args) === null) return invalidArgsOf(call);

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
      return errorResult(call, resolved.code, `token not usable in field: ${resolved.field}`);
    }
    const effectiveArgs = validateWorkflowToolArgs(name, resolved.args);
    if (effectiveArgs === null) return invalidArgsOf(call);
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
    const invalidArgs = async (): Promise<ToolResult | End> => {
      await record({
        type: "tool_decision",
        callId: call.id,
        tool: name,
        stage: "validate",
        allowed: false,
        permission: null,
        code: "invalid_args",
      });
      return errorResult(call, "invalid_args", INVALID_ARGS_MESSAGE);
    };
    if (validateToolArgs(name, call.args) === null) return invalidArgs();

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
      return errorResult(call, resolved.code, `token not usable in field: ${resolved.field}`);
    }

    const effectiveArgs = validateToolArgs(name, resolved.args);
    if (effectiveArgs === null) return invalidArgs();
    const effective = { id: call.id, name, args: effectiveArgs } as EffectiveToolCall;

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
    const outcome = await execute(effective, descriptor);
    if (isEnd(outcome)) return outcome;

    // Mask before anything is recorded or returned to the model.
    const content = outcome.ok ? maskJson(outcome.payload) : mask(outcome.message);
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
    // GT-E2: a workflow's instructions follow the fixed prompt under a fixed label, masked as one text.
    const instructions = settings.instructions;
    const systemText =
      instructions === null || instructions.trim().length === 0
        ? SYSTEM_PROMPT
        : `${SYSTEM_PROMPT}\n\n${INSTRUCTIONS_LABEL}\n${instructions}`;
    const system = mask(systemText);
    const goal = mask(task.goal);
    const workflow = mask(task.workflow);
    if (system === null || goal === null || workflow === null) return MASKING_FAILED;

    // run_started carries the workflow settings only when the task has any, so a legacy run's
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

    await record({
      type: "run_started",
      schemaVersion: 1,
      taskId: task.id,
      workflow,
      provider: model.name,
      limits,
      ...workflowFields,
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
      sent = messages.length;

      // W-1: this turn and its tool calls may change protected material.
      sinceCheck = "model";
      // GT-E1: the offered tools. A legacy task offers TOOL_NAMES and no workflow tool, so its
      // request has the same shape as before (no workflowTools field).
      const request =
        offeredWorkflow.length > 0
          ? { system, messages, tools: offeredBuiltin, workflowTools: offeredWorkflow }
          : { system, messages, tools: offeredBuiltin };
      const outcome = await model.complete(request, runSignal);
      modelTurns = turn;
      if (!outcome.ok) {
        const interruption = interrupted();
        if (interruption !== null) return interruption;
        const message = mask(outcome.message);
        if (message !== null) {
          await record({ type: "model_error", turn, kind: outcome.kind, message });
        }
        return { status: "failed", reason: "model_error" };
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
        messages.push({ role: "assistant", text, toolCalls: [] });
        return null;
      }
      if (response.stop !== "tool_calls" || !wantsTools) {
        const message = mask(`malformed model response: stop=${response.stop}`);
        if (message !== null) {
          await record({ type: "model_error", turn, kind: "malformed_response", message });
        }
        return { status: "failed", reason: "model_error" };
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
        if (proposedPlan !== null) return PLAN_PENDING;
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

  const runLoop = async (): Promise<End> => {
    const system = await start();
    if (typeof system !== "string") return system;
    // U-1: the baseline, after run_started and before the first model request.
    const unchecked = await checkPoint("run_start");
    if (unchecked !== null) return unchecked;
    for (;;) {
      const conversed = await converse(system);
      if (conversed !== null) return conversed;
      // GT-E3: a plan run is verified only after its plan is applied (an apply run). A model that
      // ends without a stored plan has not done what a plan run asks for.
      if (settings.plan === "apply") {
        const message = mask(NO_PLAN_MESSAGE);
        if (message !== null) {
          notices.push(message);
          await record({ type: "model_error", turn: modelTurns, kind: "malformed_response", message });
        }
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
    const end = await checkAtEnd(await runLoop());
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
      // GT-E3, GT-E4: only with the reasons that carry them.
      ...(end.reason === "plan_pending" && proposedPlan !== null ? { plan: proposedPlan } : {}),
      ...(end.reason === "awaiting_review" && reviewChecklist !== null ? { review: { checklist: reviewChecklist } } : {}),
    };
  } finally {
    clearTimeout(timer);
    await journal.close();
  }
};
