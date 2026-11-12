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
  // N-23 (review R-2 L-5): look for key shapes with control characters skipped, so a key broken
  // by one (`sk-ant-AB<BEL>CDEF...`) is still found. The span covers the skipped characters too.
  const kept: number[] = [];
  let stripped = "";
  for (let index = 0; index < text.length; ) {
    const cp = text.codePointAt(index) as number;
    const size = cp > 0xffff ? 2 : 1;
    if (!isUnsafeCodePoint(cp, false)) {
      for (let k = 0; k < size; k += 1) kept.push(index + k);
      stripped += text.slice(index, index + size);
    }
    index += size;
  }
  const spans: [number, number][] = [];
  const add = (start: number, length: number): void => {
    const from = kept[start];
    const to = kept[start + length - 1];
    if (from !== undefined && to !== undefined) spans.push([from, to + 1]);
  };
  for (const match of stripped.matchAll(new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE, "g"))) add(match.index, match[0].length);
  if (currentKey !== null && currentKey.length >= MIN_CURRENT_KEY_LENGTH) {
    for (let at = stripped.indexOf(currentKey); at !== -1; at = stripped.indexOf(currentKey, at + currentKey.length)) {
      add(at, currentKey.length);
    }
  }
  if (spans.length === 0) return text;
  spans.sort((a, b) => a[0] - b[0]);
  let out = "";
  let cursor = 0;
  for (const [start, end] of spans) {
    if (end <= cursor) continue;
    if (start >= cursor) out += `${text.slice(cursor, start)}[key]`;
    cursor = end;
  }
  return out + text.slice(cursor);
}
