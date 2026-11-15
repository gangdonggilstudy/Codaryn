/**
 * Repair feedback (R-3, R-4): the message that sends a failed verification back to the model,
 * and the failure signature that tells a repeated failure apart from a new one.
 *
 * The evidence handed in is already masked. Cutting happens after masking, so a secret is never
 * cut in half and missed. The engine masks the finished message once more before it is sent.
 *
 * Fix batch T (engine part):
 * - T-5: the signature uses the verifier id, its outcome and the masked evidence with every run of
 *   digits (and a decimal fraction) replaced by one symbol, outside privacy tokens. Run times and
 *   similar numbers no longer make the same failure look new.
 * - T-6: `prepareEvidence` turns masked verifier evidence into the recorded evidence. When the
 *   command runner dropped output, the trailing slack is dropped first, because its capture may
 *   end inside a secret that masking could not recognize. Then the text is cut to MAX_EVIDENCE_BYTES.
 */

import { createHash } from "node:crypto";
import { MAX_EVIDENCE_BYTES, MAX_FEEDBACK_BYTES, PRIVACY_TOKEN_PATTERN_SOURCE } from "../contracts/index.js";
import type { VerifierOutcome, VerifierResult } from "../contracts/index.js";

/**
 * Bytes dropped from the end of evidence the command runner cut (T-6). It equals the runner's
 * capture slack (`COMMAND_CAPTURE_SLACK_BYTES` in src/tools; a unit test keeps them equal):
 * a secret of up to this many bytes that the capture cut in two is dropped whole.
 */
export const EVIDENCE_SLACK_BYTES = 4_096;

/** Fixed text of the repair message. It must never spell the privacy token marker. */
export const REPAIR_HEADER =
  "Verification failed after your last reply. Find the cause, fix it with the tools, then reply without tool calls when finished.";
/** Ends evidence whose command output was cut by the runner. */
export const EVIDENCE_CAPTURE_NOTE = "\n[... output past the capture limit omitted ...]";
export const REPAIR_FIXED_TEXTS: readonly string[] = [
  REPAIR_HEADER,
  "Repair attempt ",
  " of ",
  "Verifier ",
  " outcome: ",
  "Evidence:",
  "[... ",
  " bytes omitted ...]",
  EVIDENCE_CAPTURE_NOTE,
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
 * Drops the last `bytes` UTF-8 bytes of `text`. Never splits a character; when the cut falls
 * inside a privacy token, the whole token is dropped too.
 */
function dropTrailingBytes(text: string, bytes: number): string {
  const keep = byteLength(text) - bytes;
  if (keep <= 0) return "";
  let end = 0;
  let kept = 0;
  for (const point of text) {
    const size = utf8Size(point.codePointAt(0) ?? 0);
    if (kept + size > keep) break;
    kept += size;
    end += point.length;
  }
  return text.slice(0, outsideTokens(end, tokenSpans(text), true));
}

/**
 * Turns masked verifier evidence into the evidence that is recorded and reused for repairs (T-6).
 * `runnerCut` is RawVerifierResult.evidenceTruncated: the command runner dropped output, so the
 * evidence ends at an arbitrary byte. EVIDENCE_SLACK_BYTES are then dropped from the end and a
 * fixed note says so. The result is at most MAX_EVIDENCE_BYTES (head and tail kept, R-4).
 */
export function prepareEvidence(masked: string, runnerCut: boolean): CutText {
  const text = runnerCut ? `${dropTrailingBytes(masked, EVIDENCE_SLACK_BYTES)}${EVIDENCE_CAPTURE_NOTE}` : masked;
  const cut = cutMiddle(text, MAX_EVIDENCE_BYTES);
  return { text: cut.text, truncated: runnerCut || cut.truncated };
}

/**
 * V-1: what changes from run to run of the same failure. Each pass skips privacy tokens (the
 * token alternative comes first and is returned unchanged), and the passes run in this order so
 * that an earlier, wider form is replaced before its parts could match a later one.
 */
const NUMBER = String.raw`\d+(?:\.\d+)?`;
const VOLATILE_PASSES: readonly { readonly source: string; readonly replace: (groups: Record<string, string | undefined>) => string | null }[] = [
  {
    // ISO dates with an optional time and zone, compact timestamps (20261112T031500Z, run ids),
    // and clock times with seconds (07:37:48.123). Two-part "6:10" is a line and column: kept.
    source: String.raw`(?<![\w.:])(?<date>\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?|\d{8}T\d{6}(?:\.\d+)?Z?|\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?)(?![\w:])`,
    replace: () => "#",
  },
  {
    // Hex of 8 or more digits (addresses, ids, hashes). It must have a 0x prefix or a letter, so
    // a plain decimal value such as an expected 12345678 is kept.
    source: String.raw`(?<![\w])(?<hex>(?:0[xX])?[0-9a-fA-F]{8,})(?![\w])`,
    replace: ({ hex = "" }) => (/^0x|[a-f]/i.test(hex) ? "#" : null),
  },
  {
    // A number with a time unit: (0.7457ms), 1.5 s, 250µs, 12ns. The unit is kept.
    source: String.raw`(?<![\w.])(?<num>${NUMBER})(?<unit>[ \t]?(?:ms|s|µs|μs|ns))(?![\w])`,
    replace: ({ unit = "" }) => `#${unit}`,
  },
  {
    // The value of a duration, elapsed or time key: "duration_ms 83.1", "elapsed=3", "startTime": 5.
    source: String.raw`(?<![\w])(?<key>[A-Za-z_][\w-]*)(?<sep>["']?[ \t]*[:=][ \t]*["']?|[ \t]+)(?<value>${NUMBER})(?!\w)`,
    replace: ({ key = "", sep = "" }) => (isTimeKey(key) ? `${key}${sep}#` : null),
  },
];

const TIME_KEY_WORDS: ReadonlySet<string> = new Set(["duration", "elapsed", "time", "timestamp", "runtime"]);

/** True when one word of the key (split at `_`, `-` and camelCase) is a time word. `timeout` is not. */
function isTimeKey(key: string): boolean {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[_-]+/);
  return words.some((word) => TIME_KEY_WORDS.has(word));
}

const VOLATILE_PATTERNS = VOLATILE_PASSES.map((pass) => ({
  pattern: new RegExp(`(?<token>${PRIVACY_TOKEN_PATTERN_SOURCE})|${pass.source}`, "g"),
  replace: pass.replace,
}));

/**
 * Replaces the values that change from run to run of one failure by "#" (V-1): times with a unit,
 * values of duration/elapsed/time keys, dates and clock times, and hex of 8 or more digits.
 * Line and column numbers, counts, test names and actual/expected values are kept, so a failure
 * that moves to another assertion or another value is a different failure. Privacy tokens are
 * left as they are, so different secrets stay different.
 */
export function normalizeVolatile(text: string): string {
  let out = text;
  for (const { pattern, replace } of VOLATILE_PATTERNS) {
    out = out.replace(pattern, (match: string, ...rest: unknown[]) => {
      const groups = rest.at(-1) as Record<string, string | undefined>;
      if (groups["token"] !== undefined) return match;
      return replace(groups) ?? match;
    });
  }
  return out;
}

/**
 * Failure signature (R-3, T-5, V-1): SHA-256 of the failed verifiers in task order, each as its
 * id, its outcome and its masked evidence with run-to-run values normalized (`normalizeVolatile`).
 * Two verifications fail "the same way" when their signatures are equal: a different run time
 * does not count, a different assertion line or value does.
 */
export function failureSignature(
  failed: readonly (Pick<VerifierResult, "id" | "evidence"> & { readonly outcome?: VerifierOutcome })[],
): string {
  const material = JSON.stringify(
    failed.map((result) => [result.id, result.outcome ?? null, normalizeVolatile(result.evidence)]),
  );
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export interface RepairFeedback {
  /** Not masked again yet. Every part is fixed text, a verifier id, or masked evidence. */
  readonly text: string;
  readonly truncated: boolean;
}

/** A failed verifier as the repair message needs it. `evidenceCut`: the recorded evidence was already cut. */
export type FailedForFeedback = Pick<VerifierResult, "id" | "outcome" | "evidence"> & {
  readonly evidenceCut?: boolean;
};

/**
 * The repair message: a fixed header, the attempt number, then for each failed verifier its id,
 * its outcome and its evidence. The verifiers share MAX_FEEDBACK_BYTES equally (R-4).
 * The evidence is the recorded one (masked, then cut by `prepareEvidence`), so the record and
 * the message come from the same masked text.
 */
export function buildRepairFeedback(
  failed: readonly FailedForFeedback[],
  attempt: number,
  maxAttempts: number,
): RepairFeedback {
  const share = Math.floor(MAX_FEEDBACK_BYTES / Math.max(1, failed.length));
  let truncated = false;
  const blocks = failed.map((result) => {
    const cut = cutMiddle(result.evidence, share);
    truncated ||= cut.truncated || result.evidenceCut === true;
    return `Verifier ${JSON.stringify(result.id)} outcome: ${result.outcome}\nEvidence:\n${cut.text}`;
  });
  const text = [REPAIR_HEADER, `Repair attempt ${attempt} of ${maxAttempts}.`, ...blocks].join("\n\n");
  return { text, truncated };
}
