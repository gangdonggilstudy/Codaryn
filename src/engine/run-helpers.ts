/** Per-run helpers over constant references. Values are read only when a helper is called. */
import { BUILTIN_TOOLS, REFUSAL_HINTS, asRawText, failedToolContent, safeModelText, toolFailureMessage } from "../contracts/index.js";
import type { EngineDeps, EffectiveToolCall, EffectiveWorkflowToolCall, JournalEvent, JournalRecord, MaskedText, PolicyDecision, RawToolOutcome, RawWorkflowToolOutcome, ToolCall, ToolDescriptor, ToolErrorCode, ToolResult, WorkflowToolName } from "../contracts/index.js";
import { UNKNOWN_TOOL_LEAD, WRITE_NOT_APPLIED_MESSAGE } from "./model-texts.js";
import { CANCELLED, MASKING_FAILED, UNKNOWN_OUTCOME } from "./pure.js";
import type { End } from "./pure.js";
import { ARGS_RULES, argsProblemText } from "./validate-args.js";
import type { ArgsProblem } from "./validate-args.js";

export function createRunHelpers(
  privacy: EngineDeps["privacy"],
  journal: EngineDeps["journal"],
  signal: EngineDeps["signal"],
  deadline: Pick<AbortController, "signal">,
  clock: EngineDeps["clock"],
  startedAt: number,
  limits: EngineDeps["task"]["limits"],
  tools: EngineDeps["tools"],
  policy: EngineDeps["policy"],
  runSignal: AbortSignal,
  offered: readonly string[],
) {
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

  const interrupted = (): End | null => {
    if (signal.aborted) return CANCELLED;
    if (deadline.signal.aborted || clock.now() - startedAt >= limits.maxDurationMs) {
      return { status: "budget-exhausted", reason: "max_duration" };
    }
    return null;
  };

  // AC-D3 (C-2): the journal resolves with the stored record; the engine needs only that it was stored.
  const record = (event: JournalEvent): Promise<JournalRecord> => journal.append(event);

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

  return { mask, maskJson, interrupted, record, errorResult, shownText, recordDenial, denied, execute, unknownTool, invalidArgsOf, executeWorkflow, finishWorkflowCall };
}
