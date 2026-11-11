/**
 * Repair feedback (R-3, R-4): the message that sends a failed verification back to the model,
 * and the failure signature that tells a repeated failure apart from a new one.
 *
 * The evidence handed in is already masked. Cutting happens after masking, so a secret is never
 * cut in half and missed. The engine masks the finished message once more before it is sent.
 */

import { createHash } from "node:crypto";
import { MAX_FEEDBACK_BYTES, PRIVACY_TOKEN_PATTERN_SOURCE } from "../contracts/index.js";
import type { VerifierResult } from "../contracts/index.js";

/** Fixed text of the repair message. It must never spell the privacy token marker. */
export const REPAIR_HEADER =
  "Verification failed after your last reply. Find the cause, fix it with the tools, then reply without tool calls when finished.";
export const REPAIR_FIXED_TEXTS: readonly string[] = [
  REPAIR_HEADER,
  "Repair attempt ",
  " of ",
  "Verifier ",
  " outcome: ",
  "Evidence:",
  "[... ",
  " bytes omitted ...]",
];

const TOKEN = new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g");

function omissionNote(bytes: number): string {
  return `\n[... ${bytes} bytes omitted ...]\n`;
}

function utf8Size(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** Start and end (code unit indexes) of every well-formed privacy token in `text`. */
function tokenSpans(text: string): readonly (readonly [number, number])[] {
  return [...text.matchAll(TOKEN)].map((match) => [match.index, match.index + match[0].length] as const);
}

/** Moves `index` out of a token: to its start (`toStart`) or to its end. */
function outsideTokens(index: number, spans: readonly (readonly [number, number])[], toStart: boolean): number {
  for (const [start, end] of spans) {
    if (start < index && index < end) return toStart ? start : end;
  }
  return index;
}

export interface CutText {
  readonly text: string;
  /** True when the middle was replaced by an omission note. */
  readonly truncated: boolean;
}

/**
 * Keeps `text` when its UTF-8 size is at most `maxBytes`. Otherwise keeps a head and a tail and
 * replaces the middle with an omission note, so that the result, note included, fits `maxBytes`
 * (as long as `maxBytes` is larger than the note). Never cuts inside a privacy token or between
 * the two halves of a surrogate pair, so no character is split.
 */
export function cutMiddle(text: string, maxBytes: number): CutText {
  const total = byteLength(text);
  if (total <= maxBytes) return { text, truncated: false };

  // The note never gets longer than this: the omitted count has at most as many digits as `total`.
  const available = Math.max(0, maxBytes - byteLength(omissionNote(total)));
  const headBudget = Math.floor(available / 2);
  const tailBudget = available - headBudget;
  const points = Array.from(text);
  const spans = tokenSpans(text);

  let headEnd = 0;
  let headBytes = 0;
  for (const point of points) {
    const size = utf8Size(point.codePointAt(0) ?? 0);
    if (headBytes + size > headBudget) break;
    headBytes += size;
    headEnd += point.length;
  }
  headEnd = outsideTokens(headEnd, spans, true);

  let tailStart = text.length;
  let tailBytes = 0;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index] ?? "";
    const size = utf8Size(point.codePointAt(0) ?? 0);
    if (tailBytes + size > tailBudget) break;
    tailBytes += size;
    tailStart -= point.length;
  }
  tailStart = outsideTokens(tailStart, spans, false);

  const head = text.slice(0, headEnd);
  const tail = text.slice(tailStart);
  const omitted = total - byteLength(head) - byteLength(tail);
  return { text: `${head}${omissionNote(omitted)}${tail}`, truncated: true };
}

/**
 * Failure signature (R-3): SHA-256 of the failed verifier ids with their full masked evidence,
 * in task order. Two verifications fail "the same way" when their signatures are equal.
 */
export function failureSignature(failed: readonly Pick<VerifierResult, "id" | "evidence">[]): string {
  const material = JSON.stringify(failed.map((result) => [result.id, result.evidence]));
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export interface RepairFeedback {
  /** Not masked again yet. Every part is fixed text, a verifier id, or masked evidence. */
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * The repair message: a fixed header, the attempt number, then for each failed verifier its id,
 * its outcome and its evidence. The verifiers share MAX_FEEDBACK_BYTES equally (R-4).
 */
export function buildRepairFeedback(
  failed: readonly Pick<VerifierResult, "id" | "outcome" | "evidence">[],
  attempt: number,
  maxAttempts: number,
): RepairFeedback {
  const share = Math.floor(MAX_FEEDBACK_BYTES / Math.max(1, failed.length));
  let truncated = false;
  const blocks = failed.map((result) => {
    const cut = cutMiddle(result.evidence, share);
    truncated ||= cut.truncated;
    return `Verifier ${JSON.stringify(result.id)} outcome: ${result.outcome}\nEvidence:\n${cut.text}`;
  });
  const text = [REPAIR_HEADER, `Repair attempt ${attempt} of ${maxAttempts}.`, ...blocks].join("\n\n");
  return { text, truncated };
}
