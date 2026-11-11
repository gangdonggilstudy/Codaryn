/**
 * Text that the CLI prints for people (progress lines, the report). Recorded text can hold
 * anything a model or a file name put there, so control characters that could drive a terminal
 * or reorder a line are replaced before printing, and key-shaped text is hidden.
 */

import { ANTHROPIC_KEY_PATTERN_SOURCE } from "../contracts/index.js";
import { MIN_CURRENT_KEY_LENGTH } from "./security/index.js";

/** Shown in place of a replaced character. */
export const REPLACEMENT = "?";

function isUnsafeCodePoint(cp: number, keepLineBreaks: boolean): boolean {
  if (keepLineBreaks && (cp === 0x0a || cp === 0x09)) return false;
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return true;
  // Line and paragraph separators, and bidirectional controls (they can reorder what is shown).
  if (cp === 0x2028 || cp === 0x2029 || cp === 0x061c || cp === 0x200e || cp === 0x200f) return true;
  return (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}

/**
 * Replaces control characters. With `keepLineBreaks` LF and TAB stay (for code blocks); CR is
 * always replaced, so a line cannot overwrite itself.
 */
export function cleanText(text: string, keepLineBreaks = false): string {
  let out = "";
  for (const char of text) {
    out += isUnsafeCodePoint(char.codePointAt(0) as number, keepLineBreaks) ? REPLACEMENT : char;
  }
  return out;
}

/** A short identifier as recorded (ids, codes), or "?" when it holds anything else. */
export function safeToken(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,128}$/.test(value) ? value : REPLACEMENT;
}

/**
 * Hides anything with the shape of an Anthropic key, and the current key value, in printed text.
 * Defence in depth: the records are masked, but commands allowed during a run could have
 * written into them.
 */
export function hideKeys(text: string, currentKey: string | null): string {
  let out = text.replace(new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE, "g"), "[key]");
  if (currentKey !== null && currentKey.length >= MIN_CURRENT_KEY_LENGTH) out = out.split(currentKey).join("[key]");
  return out;
}
