/**
 * The only place a verifier result is built (VF-03). Shared by every verifier module.
 */

import { asRawText } from "../contracts/index.js";
import type { RawVerifierResult, VerifierKind, VerifierOutcome } from "../contracts/index.js";

export interface RawVerifierResultInput {
  readonly id: string;
  readonly kind: VerifierKind;
  readonly outcome: VerifierOutcome;
  readonly evidence: string;
  /** True when the command runner dropped output (T-6). Kept on the result only when true. */
  readonly evidenceTruncated?: boolean;
  readonly checked: readonly string[];
  readonly limits: readonly string[];
}

const OUTCOMES: readonly string[] = ["pass", "fail", "inconclusive"];
/** G-D adds `data_checks` (VF-04) and `inventory` (VF-05) to the kinds of stage 1. */
const KINDS: readonly string[] = ["command", "file_rules", "data_checks", "inventory"];

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Rejects a result without `checked` (at least one non-empty entry) or without `limits`.
 * An empty `limits` list is accepted: it states "no known limits".
 */
export function createRawVerifierResult(input: RawVerifierResultInput): RawVerifierResult {
  const value: Partial<Record<keyof RawVerifierResultInput, unknown>> = input ?? {};
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new TypeError("verifier result: id must be a non-empty string");
  }
  if (typeof value.kind !== "string" || !KINDS.includes(value.kind)) {
    throw new TypeError("verifier result: unknown kind");
  }
  if (typeof value.outcome !== "string" || !OUTCOMES.includes(value.outcome)) {
    throw new TypeError("verifier result: unknown outcome");
  }
  if (typeof value.evidence !== "string") {
    throw new TypeError("verifier result: evidence must be a string");
  }
  if (
    !isStringList(value.checked) ||
    value.checked.length === 0 ||
    value.checked.some((item) => item.trim().length === 0)
  ) {
    throw new TypeError("verifier result: checked must list at least one non-empty entry");
  }
  if (!isStringList(value.limits)) {
    throw new TypeError("verifier result: limits is required (use an empty list for no known limits)");
  }
  if (value.evidenceTruncated !== undefined && typeof value.evidenceTruncated !== "boolean") {
    throw new TypeError("verifier result: evidenceTruncated must be a boolean when given");
  }
  return {
    id: value.id,
    kind: value.kind as VerifierKind,
    outcome: value.outcome as VerifierOutcome,
    evidence: asRawText(value.evidence),
    ...(value.evidenceTruncated === true ? { evidenceTruncated: true } : {}),
    checked: [...value.checked],
    limits: [...value.limits],
  };
}
