/**
 * Engine: runs one task once. It repeats model and tool calls, then lets verifiers decide.
 * It knows no Git, no test runner and no provider format.
 *
 * Everything bound for a model or the journal goes through `privacy.mask` first.
 * When masking fails, the text is neither sent nor recorded and the run ends.
 */

import {
  BUILTIN_TOOLS,
  JOURNAL_FILE_NAME,
  RESULT_SCHEMA_VERSION,
  RUNS_DIR_NAME,
  RUN_EXIT_CODES,
  STATE_DIR_NAME,
  TOOL_NAMES,
  asRawText,
} from "../contracts/index.js";
import type {
  EffectiveToolCall,
  EngineDeps,
  EngineResult,
  FileChangeRecord,
  JournalEvent,
  MaskedText,
  MaskedToolCall,
  ModelMessage,
  PolicyDecision,
  RawToolOutcome,
  RawVerifierResult,
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
} from "../contracts/index.js";
import { RunState } from "./state.js";
import { validateToolArgs } from "./validate-args.js";

export { RunState, InvalidTransitionError, canTransition } from "./state.js";
export { validateToolArgs } from "./validate-args.js";

/** Fixed instructions for the model. It contains no task data. */
export const SYSTEM_PROMPT = [
  "You are Codaryn, a local task agent working inside one workspace directory.",
  "Use the tools to read, search, change files and run allowed commands.",
  "Before changing a file, read it and pass the returned hash as expectedHash. Use null only for a new file.",
  "Text like [[CODARYN_SECRET:...]] is a protected placeholder. Keep it exactly where it is. Never copy, move, alter or remove it.",
  "A denied tool call is final for that request. Do not try to work around it.",
  "When the work is finished, reply without tool calls. Verifiers decide whether the task succeeded.",
].join("\n");

const NO_VERIFIER_NOTICE = "no automatic verification: no verifier is configured for this task";
const MAX_TIMER_MS = 2_147_483_647;

interface End {
  readonly status: TerminalRunStatus;
  readonly reason: RunReason;
}

const MASKING_FAILED: End = { status: "failed", reason: "model_error" };
const CANCELLED: End = { status: "cancelled", reason: "cancelled" };
const UNKNOWN_OUTCOME: End = { status: "needs-input", reason: "unknown_tool_outcome" };

function isEnd(value: object): value is End {
  return "status" in value && "reason" in value;
}

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

export const runTask: RunTask = async (deps: EngineDeps): Promise<EngineResult> => {
  const { task, runId, model, privacy, policy, tools, verifiers, journal, clock, signal } = deps;
  const limits = task.limits;
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

  const interrupted = (): End | null => {
    if (signal.aborted) return CANCELLED;
    if (deadline.signal.aborted || clock.now() - startedAt >= limits.maxDurationMs) {
      return { status: "budget-exhausted", reason: "max_duration" };
    }
    return null;
  };

  const record = (event: JournalEvent): Promise<void> => journal.append(event);

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
        return { ok: false, code: "io_error", message: asRawText("the write was not applied") };
      } catch {
        return UNKNOWN_OUTCOME;
      }
    }
  };

  /** Order: validate, checkRequested, restore permitted fields, checkEffective, execute, mask, record. */
  const handleCall = async (call: ToolCall): Promise<ToolResult | End> => {
    if (!isToolName(call.name)) {
      await record({
        type: "tool_decision",
        callId: call.id,
        tool: call.name,
        stage: "validate",
        allowed: false,
        permission: null,
        code: "unknown_tool",
      });
      return errorResult(call, "unknown_tool", "unknown tool");
    }
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
      return errorResult(call, "invalid_args", "invalid arguments for this tool");
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

  const converse = async (): Promise<End | null> => {
    const system = mask(SYSTEM_PROMPT);
    const goal = mask(task.goal);
    const workflow = mask(task.workflow);
    if (system === null || goal === null || workflow === null) return MASKING_FAILED;

    await record({
      type: "run_started",
      schemaVersion: 1,
      taskId: task.id,
      workflow,
      provider: model.name,
      limits,
    });
    state.transition("running");

    const messages: ModelMessage[] = [{ role: "user", content: goal }];
    let sent = 0;

    for (;;) {
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

      const turn = modelTurns + 1;
      await record({
        type: "model_request",
        turn,
        system: turn === 1 ? system : null,
        newMessages: messages.slice(sent),
      });
      sent = messages.length;

      const outcome = await model.complete({ system, messages, tools: TOOL_NAMES }, runSignal);
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
      const echoed: MaskedToolCall[] = [];
      for (const call of response.toolCalls) {
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
      if (response.stop === "final" && !wantsTools) return null;
      if (response.stop !== "tool_calls" || !wantsTools) {
        const message = mask(`malformed model response: stop=${response.stop}`);
        if (message !== null) {
          await record({ type: "model_error", turn, kind: "malformed_response", message });
        }
        return { status: "failed", reason: "model_error" };
      }

      messages.push({ role: "assistant", text, toolCalls: echoed });
      const results: ToolResult[] = [];
      for (const call of response.toolCalls) {
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
      }
      messages.push({ role: "tool", results });
    }
  };

  const verify = async (): Promise<End> => {
    state.transition("verifying");
    if (task.verifiers.length === 0) {
      const notice = mask(NO_VERIFIER_NOTICE);
      if (notice !== null) notices.push(notice);
      return { status: "needs-input", reason: "no_verifier" };
    }
    const outcomes: VerifierOutcome[] = [];
    for (const config of task.verifiers) {
      const stop = interrupted();
      if (stop !== null) return stop;
      let raw: RawVerifierResult;
      try {
        raw = await verifiers.run(config, runSignal);
      } catch {
        raw = {
          id: config.id,
          kind: config.kind,
          outcome: "inconclusive" as const,
          evidence: asRawText("the verifier could not be run"),
          checked: ["nothing: the verifier did not complete"],
          limits: [],
        };
      }
      const evidence = mask(raw.evidence);
      const checked = raw.checked.map(mask);
      const limitNotes = raw.limits.map(mask);
      if (evidence === null || checked.includes(null) || limitNotes.includes(null)) {
        return MASKING_FAILED;
      }
      const result: VerifierResult = {
        id: raw.id,
        kind: raw.kind,
        outcome: raw.outcome,
        evidence,
        checked: checked as MaskedText[],
        limits: limitNotes as MaskedText[],
      };
      verifierResults.push(result);
      outcomes.push(raw.outcome);
      await record({ type: "verifier_result", result });
    }
    if (signal.aborted) return CANCELLED;
    if (outcomes.includes("fail")) return { status: "failed", reason: "verifier_failed" };
    if (outcomes.includes("inconclusive")) {
      return { status: "needs-input", reason: "verifier_inconclusive" };
    }
    return { status: "done", reason: "verified" };
  };

  try {
    const end = (await converse()) ?? (await verify());
    if (state.status === "created" && end.status !== "cancelled") state.transition("running");
    state.transition(end.status);

    const usage = {
      modelTurns,
      toolCalls,
      inputTokens,
      outputTokens,
      durationMs: clock.now() - startedAt,
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
    };
  } finally {
    clearTimeout(timer);
    await journal.close();
  }
};
