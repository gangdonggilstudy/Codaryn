/** Per-run tool calls; the shared tally and injected ports are read when a call runs. */
import { BUILTIN_TOOLS, PLAN_ACTION_DESCRIPTORS, PLANNED_FILE_DESCRIPTOR, WORKFLOW_TOOLS, REFUSAL_HINTS, failedToolContent, toolFailureMessage } from "../contracts/index.js";
import type { EffectiveToolCall, EffectiveWorkflowToolCall, EngineDeps, FileChangeRecord, JsonObject, PolicyDecision, ProposeChangesArgs, ProposePlanArgs, ToolCall, ToolDescriptor, ToolResult, WorkflowToolName } from "../contracts/index.js";
import { finalMessageOf } from "./final-message.js";
import { PLAN_ACTION_LEAD, PLANNED_FILE_LEAD } from "./model-texts.js";
import { MASKING_FAILED, UNKNOWN_OUTCOME, isEnd, isToolName, isWorkflowToolName, isProposedPlan, isProposedChanges } from "./pure.js";
import type { End, offeredTools } from "./pure.js";
import type { createPermission } from "./run-calls.js";
import type { createRunChecks } from "./run-checks.js";
import type { createRunHelpers } from "./run-helpers.js";
import type { RunTally } from "./run-tally.js";
import { ARGS_RULES, argsProblemText, toolArgsProblem, validateToolArgs, validateWorkflowToolArgs, workflowToolArgsProblem } from "./validate-args.js";
import type { ArgsProblem } from "./validate-args.js";

export function createRunTools(
  tally: RunTally,
  task: EngineDeps["task"],
  tools: EngineDeps["tools"],
  policy: EngineDeps["policy"],
  privacy: EngineDeps["privacy"],
  offered: ReturnType<typeof offeredTools>,
  mask: ReturnType<typeof createRunHelpers>["mask"],
  maskJson: ReturnType<typeof createRunHelpers>["maskJson"],
  record: ReturnType<typeof createRunHelpers>["record"],
  errorResult: ReturnType<typeof createRunHelpers>["errorResult"],
  denied: ReturnType<typeof createRunHelpers>["denied"],
  execute: ReturnType<typeof createRunHelpers>["execute"],
  unknownTool: ReturnType<typeof createRunHelpers>["unknownTool"],
  invalidArgsOf: ReturnType<typeof createRunHelpers>["invalidArgsOf"],
  executeWorkflow: ReturnType<typeof createRunHelpers>["executeWorkflow"],
  finishWorkflowCall: ReturnType<typeof createRunHelpers>["finishWorkflowCall"],
  askPermission: ReturnType<typeof createPermission>["askPermission"],
  checkState: ReturnType<typeof createRunChecks>["checkState"],
) {
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
    tally.toolCalls += 1;
    const outcome = await executeWorkflow({ id: call.id, name: "propose_plan", args: effectiveArgs }, descriptor);
    if (isEnd(outcome)) return outcome;
    const result = await finishWorkflowCall(call, "propose_plan", outcome);
    if (isEnd(result) || !outcome.ok) return result;
    if (!isProposedPlan(outcome.payload)) return UNKNOWN_OUTCOME;
    tally.proposedPlan = { digest: outcome.payload.digest, actions: outcome.payload.actions.length };
    // U-59 (AXM-15): the agent's description of this plan, masked and made safe as the last message.
    const maskedSummary = mask(args.summary);
    tally.planSummary = maskedSummary === null ? null : (finalMessageOf(maskedSummary, (text) => privacy.mask(text))?.text ?? null);
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
    tally.toolCalls += 1;
    const outcome = await executeWorkflow({ id: call.id, name: "propose_changes", args: effectiveArgs }, descriptor);
    if (isEnd(outcome)) return outcome;
    const result = await finishWorkflowCall(call, "propose_changes", outcome);
    if (isEnd(result) || !outcome.ok) return result;
    if (!isProposedChanges(outcome.payload)) return UNKNOWN_OUTCOME;
    tally.proposedPlan = { digest: outcome.payload.digest, actions: outcome.payload.files.length, kind: "changes" };
    // As propose_plan's (U-59): the summary, masked and made safe as the last message, for the result.
    const maskedSummary = mask(args.summary);
    tally.planSummary = maskedSummary === null ? null : (finalMessageOf(maskedSummary, (text) => privacy.mask(text))?.text ?? null);
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

    tally.toolCalls += 1;
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

    tally.toolCalls += 1;
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
      tally.changes.push(change);
      await record({ type: "file_changed", callId: call.id, ...change });
    }
    return result;
  };

  return { handleCall };
}
