/**
 * Limit merging with upper bounds (S-7, H2-7, H2-8).
 * - A config value is an upper bound: the task may lower it, never raise it.
 * - Every value is also under an absolute cap in code.
 * - An anthropic run must have a token limit.
 * Messages name the field and the rule, never a number taken from a file.
 */

import { DEFAULT_MAX_REPAIR_ATTEMPTS, DEFAULT_MAX_SAME_FAILURES } from "../../../contracts/index.js";
import type { Limits, ModelProviderName, ResolvedLimits } from "../../../contracts/index.js";

/** Largest delay Node timers honour. Larger values fire after 1 ms. */
export const MAX_TIMER_MS = 2_147_483_647;

/** Absolute caps. The repair caps are proposals for PM approval (S-7 names the other four). */
export const ABSOLUTE_LIMITS = {
  maxModelTurns: 1000,
  maxToolCalls: 5000,
  maxTotalTokens: 50_000_000,
  maxDurationMs: 86_400_000,
  maxRepairAttempts: 20,
  maxSameFailures: 10,
} as const;

type LimitField = keyof typeof ABSOLUTE_LIMITS;

/** Lowest allowed value per field. The four budget limits are positive. */
const MINIMUM: { readonly [F in LimitField]: number } = {
  maxModelTurns: 1,
  maxToolCalls: 1,
  maxTotalTokens: 1,
  maxDurationMs: 1,
  maxRepairAttempts: 0,
  maxSameFailures: 1,
};

const BUDGET_FIELDS = ["maxModelTurns", "maxToolCalls", "maxTotalTokens", "maxDurationMs"] as const;
const REPAIR_FIELDS = ["maxRepairAttempts", "maxSameFailures"] as const;

export interface BoundedLimitsInput {
  /** "task": a task file (task limits under config limits). "quick": config limits only. */
  readonly form: "task" | "quick";
  readonly provider: ModelProviderName;
  readonly task: Partial<Limits> | undefined;
  readonly config: Partial<Limits> | undefined;
}

export type BoundedLimitsOutcome =
  | { readonly ok: true; readonly limits: ResolvedLimits }
  | { readonly ok: false; readonly code: "invalid_task" | "invalid_config"; readonly message: string };

type Source = "task" | "config";

class LimitError extends Error {
  constructor(
    readonly source: Source,
    message: string,
  ) {
    super(message);
  }
}

function present(limits: Partial<Limits> | undefined, field: LimitField): boolean {
  return limits !== undefined && Object.hasOwn(limits, field) && limits[field] !== undefined;
}

/** Checks one value against its range and the absolute cap. `null` is allowed for tokens only. */
function checked(value: unknown, field: LimitField, source: Source): number | null {
  if (value === null && field === "maxTotalTokens") return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < MINIMUM[field]) {
    throw new LimitError(source, `limits.${field} must be an integer of at least ${MINIMUM[field]}`);
  }
  if (value > ABSOLUTE_LIMITS[field]) {
    throw new LimitError(source, `limits.${field} must be at most ${ABSOLUTE_LIMITS[field]}`);
  }
  return value;
}

/** S-7: merges task and config limits under the config bounds and the absolute caps. */
export function resolveBoundedLimits(input: BoundedLimitsInput): BoundedLimitsOutcome {
  const missingCode = input.form === "task" ? "invalid_task" : "invalid_config";
  const resolved: { [F in LimitField]?: number | null } = {};
  try {
    for (const field of [...BUDGET_FIELDS, ...REPAIR_FIELDS]) {
      const fromConfig = present(input.config, field) ? checked(input.config?.[field], field, "config") : undefined;
      const fromTask = present(input.task, field) ? checked(input.task?.[field], field, "task") : undefined;
      if (fromTask !== undefined && fromConfig !== undefined && fromConfig !== null) {
        // A config number bounds the task. A task null (no token limit) would lift it.
        if (fromTask === null || fromTask > fromConfig) {
          throw new LimitError("task", `limits.${field} in the task must not exceed the config file's limits.${field}`);
        }
      }
      if (fromTask !== undefined) {
        resolved[field] = fromTask;
      } else if (fromConfig !== undefined) {
        resolved[field] = fromConfig;
      } else if ((REPAIR_FIELDS as readonly string[]).includes(field)) {
        resolved[field] = field === "maxRepairAttempts" ? DEFAULT_MAX_REPAIR_ATTEMPTS : DEFAULT_MAX_SAME_FAILURES;
      } else {
        return { ok: false, code: missingCode, message: `limits.${field} is not set in the task or the config file` };
      }
      // SP-4 (design 4.5): every API provider run needs a token limit, not only anthropic's; the
      // message names the provider, so anthropic's is the one before SP-4.
      if (field === "maxTotalTokens" && resolved[field] === null && input.provider !== "scripted") {
        const source: Source = fromTask !== undefined ? "task" : "config";
        throw new LimitError(source, `limits.maxTotalTokens must be a number for the ${input.provider} provider; null is not allowed`);
      }
    }
  } catch (error) {
    if (!(error instanceof LimitError)) throw error;
    return { ok: false, code: error.source === "task" ? "invalid_task" : "invalid_config", message: error.message };
  }
  return { ok: true, limits: resolved as unknown as ResolvedLimits };
}

/** S-7 / H2-8: any other time value in milliseconds (requestTimeoutMs, verifier timeoutMs). */
export function checkTimerMs(value: unknown, field: string): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_TIMER_MS
    ? { ok: true }
    : { ok: false, message: `${field} must be a positive integer of at most ${MAX_TIMER_MS} ms` };
}
