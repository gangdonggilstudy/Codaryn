/**
 * A task file's limits (IR-26 step 3 T1): their shape and types, and the config file's bounds on
 * them (S-7). task.ts passes its public name on; of the parser's modules this one imports only
 * task-core.ts.
 */

import type { Limits, ModelProviderName, ResolvedTaskSpec } from "../../contracts/index.js";
import { fail, positive, record } from "./task-core.js";
import { resolveBoundedLimits } from "./security/index.js";

const LIMIT_FIELDS = [
  "maxModelTurns",
  "maxToolCalls",
  "maxTotalTokens",
  "maxDurationMs",
  "maxRepairAttempts",
  "maxSameFailures",
] as const;

type MutableLimits = { -readonly [K in keyof Limits]?: Limits[K] };

function nonNegative(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${field} must be an integer of 0 or more`);
  }
  return value;
}

/**
 * Validates the shape and the type of the limit fields that are present. Absent fields stay absent.
 * Upper bounds (config over task, absolute caps, no null tokens for anthropic) are S-7's
 * `resolveBoundedLimits`, applied once the provider is known.
 */
export function parsePartialLimits(value: unknown): Partial<Limits> {
  const rec = record(value, "limits", LIMIT_FIELDS);
  const limits: MutableLimits = {};
  for (const field of LIMIT_FIELDS) {
    if (!Object.hasOwn(rec, field)) continue;
    const item = rec[field];
    const name = `limits.${field}`;
    if (field === "maxTotalTokens") {
      limits.maxTotalTokens = item === null ? null : positive(item, name);
    } else if (field === "maxRepairAttempts") {
      limits.maxRepairAttempts = nonNegative(item, name);
    } else {
      // maxSameFailures, like the budget limits, is at least 1.
      limits[field] = positive(item, name);
    }
  }
  return limits;
}

/** S-7: the run's limits, with the config file's values as upper bounds. */
export function boundedLimits(
  form: "task" | "quick",
  provider: ModelProviderName,
  own: Partial<Limits> | undefined,
  config: Partial<Limits> | undefined,
): ResolvedTaskSpec["limits"] {
  const outcome = resolveBoundedLimits({ form, provider, task: own, config });
  return outcome.ok ? outcome.limits : fail(outcome.message, outcome.code);
}
