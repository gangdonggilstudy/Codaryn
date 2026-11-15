/**
 * Scripted model provider: answers the Nth request with the Nth step of a script file.
 * It stands in for a model. Its tool calls take the same policy and privacy path as any other.
 */

import {
  PRIVACY_TOKEN_PATTERN_SOURCE,
  SCRIPT_SCHEMA_VERSION,
  SCRIPT_TOKEN_PLACEHOLDER_SOURCE,
} from "../contracts/index.js";
import type {
  JsonObject,
  JsonValue,
  ModelOutcome,
  ModelProvider,
  ModelRequest,
  ModelStop,
  ScriptStep,
  ScriptToolCall,
  ScriptedModelScript,
  ToolCall,
} from "../contracts/index.js";

export type ParseScriptOutcome =
  | { readonly ok: true; readonly script: ScriptedModelScript }
  | { readonly ok: false; readonly message: string };

const STOPS: readonly string[] = ["tool_calls", "final", "length"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function stepProblem(step: unknown): string | null {
  if (!isRecord(step)) return "must be an object";
  if (!hasOnlyKeys(step, ["text", "toolCalls", "stop", "usage", "delayMs"])) return "has an unknown field";
  if (step["text"] !== undefined && typeof step["text"] !== "string") return "text must be a string";
  if (step["stop"] !== undefined && !STOPS.includes(step["stop"] as string)) return "stop is not valid";
  if (step["delayMs"] !== undefined && !isCount(step["delayMs"])) return "delayMs must be a non-negative integer";
  const usage = step["usage"];
  if (usage !== undefined && usage !== null) {
    if (!isRecord(usage) || !isCount(usage["inputTokens"]) || !isCount(usage["outputTokens"])) {
      return "usage must be null or {inputTokens, outputTokens}";
    }
  }
  const calls = step["toolCalls"];
  if (calls !== undefined) {
    if (!Array.isArray(calls)) return "toolCalls must be an array";
    for (const call of calls) {
      if (!isRecord(call) || !hasOnlyKeys(call, ["id", "name", "args"])) return "has an invalid tool call";
      if (call["id"] !== undefined && typeof call["id"] !== "string") return "tool call id must be a string";
      if (typeof call["name"] !== "string" || !isRecord(call["args"])) return "tool call needs name and args";
    }
  }
  return null;
}

/** Validates a parsed script file. Messages name positions only, never file contents. */
export function parseScript(value: unknown): ParseScriptOutcome {
  if (!isRecord(value)) return { ok: false, message: "script must be a JSON object" };
  if (value["schemaVersion"] !== SCRIPT_SCHEMA_VERSION) {
    return { ok: false, message: "script schemaVersion must be 1" };
  }
  const steps = value["steps"];
  if (!Array.isArray(steps)) return { ok: false, message: "script steps must be an array" };
  for (const [index, step] of steps.entries()) {
    const problem = stepProblem(step);
    if (problem !== null) return { ok: false, message: `script step ${index + 1} ${problem}` };
  }
  return { ok: true, script: value as unknown as ScriptedModelScript };
}

/** Distinct privacy tokens in the request, in order of first appearance. */
function tokensSeen(request: ModelRequest): string[] {
  const parts: string[] = [request.system];
  for (const message of request.messages) {
    if (message.role === "user") {
      parts.push(message.content);
    } else if (message.role === "assistant") {
      parts.push(message.text, ...message.toolCalls.map((call) => call.argsJson));
    } else {
      parts.push(...message.results.map((result) => result.content));
    }
  }
  const pattern = new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g");
  const seen: string[] = [];
  for (const part of parts) {
    for (const match of part.matchAll(pattern)) {
      if (!seen.includes(match[0])) seen.push(match[0]);
    }
  }
  return seen;
}

class MissingToken extends Error {}

function expandText(text: string, tokens: readonly string[]): string {
  return text.replace(new RegExp(SCRIPT_TOKEN_PLACEHOLDER_SOURCE, "g"), (_match, index: string) => {
    const token = tokens[Number(index) - 1];
    if (token === undefined) throw new MissingToken();
    return token;
  });
}

function expandValue(value: JsonValue, tokens: readonly string[]): JsonValue {
  if (typeof value === "string") return expandText(value, tokens);
  if (Array.isArray(value)) return value.map((item: JsonValue) => expandValue(item, tokens));
  if (typeof value === "object" && value !== null) {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value as JsonObject)) {
      result[key] = expandValue(item, tokens);
    }
    return result;
  }
  return value;
}

/** Resolves after `ms`, or earlier with `false` when the signal aborts. */
function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function createScriptedProvider(script: ScriptedModelScript): ModelProvider {
  let next = 0;
  return {
    name: "scripted",
    async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelOutcome> {
      if (signal.aborted) return { ok: false, kind: "aborted", message: "aborted" };
      const stepNumber = next + 1;
      const step: ScriptStep | undefined = script.steps[next];
      next = stepNumber;
      if (step === undefined) {
        return { ok: false, kind: "script_exhausted", message: `the script has no step ${stepNumber}` };
      }
      if (step.delayMs !== undefined && step.delayMs > 0) {
        const completed = await wait(step.delayMs, signal);
        if (!completed) return { ok: false, kind: "aborted", message: "aborted" };
      }

      const tokens = tokensSeen(request);
      const scripted: readonly ScriptToolCall[] = step.toolCalls ?? [];
      try {
        const toolCalls: ToolCall[] = scripted.map((call, index) => ({
          id: call.id ?? `call_${stepNumber}_${index + 1}`,
          name: call.name,
          args: expandValue(call.args, tokens) as JsonObject,
        }));
        const stop: ModelStop = step.stop ?? (toolCalls.length > 0 ? "tool_calls" : "final");
        return {
          ok: true,
          response: {
            stop,
            text: expandText(step.text ?? "", tokens),
            toolCalls,
            usage: step.usage ?? null,
          },
        };
      } catch (error) {
        if (error instanceof MissingToken) {
          return {
            ok: false,
            kind: "script_exhausted",
            message: `script step ${stepNumber} refers to a secret token that was not shown`,
          };
        }
        throw error;
      }
    },
  };
}
