/** Per-run conversation, error and budget decisions, with private call cache and sent cursor. */
import { countPrivacyTokens, modelErrorRetryable, safeModelText } from "../contracts/index.js";
import type { ApprovedChangesPlan, EngineDeps, MaskedText, MaskedToolCall, ModelErrorKind, ToolName, ToolResult, WorkflowToolName, workflowSettingsOf } from "../contracts/index.js";
import { SYSTEM_PROMPT, INSTRUCTIONS_LABEL, APPROVED_SUMMARY_GAP } from "./model-texts.js";
import { PROFILE_NAME_PATTERN, recordableNarrowings, MASKING_FAILED, PLAN_PENDING, isEnd, approvedPlanText } from "./pure.js";
import type { End } from "./pure.js";
import type { createCallIds } from "./run-calls.js";
import type { createRunChecks } from "./run-checks.js";
import type { createRunHelpers } from "./run-helpers.js";
import type { RunTally } from "./run-tally.js";
import type { createRunTools } from "./run-tools.js";

export function createRunConverse(
  tally: RunTally,
  task: EngineDeps["task"],
  model: EngineDeps["model"],
  privacy: EngineDeps["privacy"],
  limits: EngineDeps["task"]["limits"],
  settings: ReturnType<typeof workflowSettingsOf>,
  approved: ApprovedChangesPlan | null,
  offeredBuiltin: readonly ToolName[],
  offeredWorkflow: readonly WorkflowToolName[],
  runSignal: AbortSignal,
  mask: ReturnType<typeof createRunHelpers>["mask"],
  maskJson: ReturnType<typeof createRunHelpers>["maskJson"],
  interrupted: ReturnType<typeof createRunHelpers>["interrupted"],
  record: ReturnType<typeof createRunHelpers>["record"],
  recordableCalls: ReturnType<typeof createCallIds>["recordableCalls"],
  noteActivity: ReturnType<typeof createRunChecks>["noteActivity"],
  handleCall: ReturnType<typeof createRunTools>["handleCall"],
) {
  /** Results by call id. A call id that was already answered is never executed again. */
  const answered = new Map<string, ToolResult>();
  /** How many messages earlier `model_request` records already hold. */
  let sent = 0;

  // U-82 (DR-68): `verdict` is the outcome's own retryable, which comes first.
  const endedByModelError = (kind: ModelErrorKind, turn: number, httpStatus?: number, verdict?: boolean): End => {
    const retryable = modelErrorRetryable(kind, httpStatus, verdict);
    tally.endingModelError = retryable === undefined ? { kind, turn } : { kind, turn, retryable };
    return { status: "failed", reason: "model_error" };
  };

  /** Why no further model call may start, or null when one may. */
  const budgetStop = (): End | null => {
    const stop = interrupted();
    if (stop !== null) return stop;
    if (tally.modelTurns >= limits.maxModelTurns) {
      return { status: "budget-exhausted", reason: "max_model_turns" };
    }
    if (
      limits.maxTotalTokens !== null &&
      tally.inputTokens !== null &&
      tally.outputTokens !== null &&
      tally.inputTokens + tally.outputTokens >= limits.maxTotalTokens
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
    tally.state.transition("running");
    tally.messages.push({ role: "user", content: goal });
    return system;
  };

  /** Model and tool calls until the model replies without tool calls (null) or the run ends. */
  const converse = async (system: MaskedText): Promise<End | null> => {
    for (;;) {
      const stop = budgetStop();
      if (stop !== null) return stop;

      const turn = tally.modelTurns + 1;
      await record({
        type: "model_request",
        turn,
        system: turn === 1 ? system : null,
        newMessages: tally.messages.slice(sent),
      });
      // DR-52: each text counted once, when first sent; the model's own messages are not counted.
      if (turn === 1) tally.maskedPlaces += countPrivacyTokens(system);
      for (const message of tally.messages.slice(sent)) {
        if (message.role === "user") tally.maskedPlaces += countPrivacyTokens(message.content);
        else if (message.role === "tool") for (const sentResult of message.results) tally.maskedPlaces += countPrivacyTokens(sentResult.content);
      }
      sent = tally.messages.length;

      // W-1: this turn and its tool calls may change protected material.
      noteActivity("model");
      // GT-E1: the offered tools. A legacy task offers TOOL_NAMES and no task type tool, so its
      // request has the same shape as before (no workflowTools field).
      const request =
        offeredWorkflow.length > 0
          ? { system, messages: tally.messages, tools: offeredBuiltin, workflowTools: offeredWorkflow }
          : { system, messages: tally.messages, tools: offeredBuiltin };
      tally.lastFinal = null;
      const outcome = await model.complete(request, runSignal);
      tally.modelTurns = turn;
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
        tally.inputTokens = null;
        tally.outputTokens = null;
        // The token limit cannot be checked any more, so nothing further is done.
        if (limits.maxTotalTokens !== null) {
          return { status: "budget-exhausted", reason: "usage_unknown" };
        }
      } else if (tally.inputTokens !== null && tally.outputTokens !== null) {
        tally.inputTokens += response.usage.inputTokens;
        tally.outputTokens += response.usage.outputTokens;
      }

      const wantsTools = response.toolCalls.length > 0;
      if (response.stop === "final" && !wantsTools) {
        // Kept so that a repair message follows the model's own reply.
        tally.lastFinal = text;
        tally.messages.push({ role: "assistant", text, toolCalls: [] });
        return null;
      }
      if (response.stop !== "tool_calls" || !wantsTools) {
        const message = mask(`malformed model response: stop=${response.stop}`);
        if (message !== null) {
          await record({ type: "model_error", turn, kind: "malformed_response", message });
        }
        return endedByModelError("malformed_response", turn);
      }

      tally.messages.push({ role: "assistant", text, toolCalls: echoed });
      const results: ToolResult[] = [];
      for (const call of calls) {
        const interruption = interrupted();
        if (interruption !== null) return interruption;

        const earlier = answered.get(call.id);
        if (earlier !== undefined) {
          results.push(earlier);
          continue;
        }
        if (tally.toolCalls >= limits.maxToolCalls) {
          return { status: "budget-exhausted", reason: "max_tool_calls" };
        }
        const handled = await handleCall(call);
        if (isEnd(handled)) return handled;
        answered.set(call.id, handled);
        results.push(handled);
        // GT-E3: a stored plan ends the run. Later calls of this turn are not run.
        // DR-18 (c): a cancel or the duration limit that came while the plan was stored wins; the
        // run then ends without EngineResult.plan, so its plan.json cannot be applied.
        if (tally.proposedPlan !== null) return interrupted() ?? PLAN_PENDING;
      }
      tally.messages.push({ role: "tool", results });
    }
  };

  return { endedByModelError, budgetStop, start, converse };
}
