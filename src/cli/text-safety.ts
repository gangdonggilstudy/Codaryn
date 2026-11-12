/**
 * Text that the CLI prints for people (progress lines, the report). Recorded text can hold
 * anything a model or a file name put there, so control characters that could drive a terminal
 * or reorder a line are replaced before printing, and key-shaped text is hidden.
 */

import { KEY_SEPARATOR_PATTERN_SOURCE, compactKeyText } from "../contracts/index.js";
import { KEY_MASK_SHAPE_SOURCE, keyValuesOf } from "./security/index.js";
import type { KnownKeys } from "./security/index.js";

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
/**
 * N-27 (c), review R-7 L-2: `hideKeys` applied to every string of a value before it is written as
 * JSON. In JSON text a control character becomes `\uXXXX`, so the check must see the strings
 * themselves, not the JSON.
 */
export function hideKeysInStrings<T>(value: T, currentKey: KnownKeys): T {
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") return hideKeys(item, currentKey);
    if (Array.isArray(item)) return item.map(walk);
    if (typeof item === "object" && item !== null) {
      return Object.fromEntries(Object.entries(item).map(([name, child]) => [name, walk(child)]));
    }
    return item;
  };
  return walk(value) as T;
}

/** `text` without the code points `skip` names, and for each kept UTF-16 unit its index in `text`. */
function strippedOf(text: string, skip: (cp: number, char: string) => boolean): { readonly stripped: string; readonly kept: readonly number[] } {
  const kept: number[] = [];
  let stripped = "";
  for (let index = 0; index < text.length; ) {
    const cp = text.codePointAt(index) as number;
    const size = cp > 0xffff ? 2 : 1;
    const char = text.slice(index, index + size);
    if (!skip(cp, char)) {
      for (let k = 0; k < size; k += 1) kept.push(index + k);
      stripped += char;
    }
    index += size;
  }
  return { stripped, kept };
}

/** DR-40 (a): Unicode format characters (zero-width space and joiners, soft hyphen, BOM): invisible. */
const FORMAT_CHAR = /^\p{Cf}$/u;
/** DR-40 (a): every character that can split a key (the contract's KEY_SEPARATOR_PATTERN_SOURCE: white space, Cc, Cf). */
const SPLITTER_CHAR = new RegExp(`^${KEY_SEPARATOR_PATTERN_SOURCE}$`, "u");

export function hideKeys(text: string, currentKey: KnownKeys): string {
  const spans: [number, number][] = [];
  const adder =
    (kept: readonly number[]) =>
    (start: number, length: number): void => {
      const from = kept[start];
      const to = kept[start + length - 1];
      if (from !== undefined && to !== undefined) spans.push([from, to + 1]);
    };
  // N-23 (review R-2 L-5), DR-40 (a): key shapes with control and format characters skipped, so a
  // key broken by one (`sk-ant-AB<BEL>CDEF...`, a zero-width space, a soft hyphen) is still found.
  // Visible whitespace stays: removing it would glue a key to the word before it and lose the
  // shape's word start. The span covers the skipped characters too.
  const forShapes = strippedOf(text, (cp, char) => isUnsafeCodePoint(cp, false) || FORMAT_CHAR.test(char));
  const addShape = adder(forShapes.kept);
  // SP-2, DR-32 (a): every hiding shape (the loose one too).
  for (const match of forShapes.stripped.matchAll(new RegExp(KEY_MASK_SHAPE_SOURCE, "g"))) addShape(match.index, match[0].length);
  // Every given key value (every key variable that is set), with every key-splitting character
  // skipped as well (DR-40 (a): a registered value split by a line break or a space is still found).
  const forValues = strippedOf(text, (cp, char) => isUnsafeCodePoint(cp, false) || SPLITTER_CHAR.test(char));
  const addValue = adder(forValues.kept);
  for (const key of keyValuesOf(currentKey)) {
    const joined = compactKeyText(key);
    for (let at = forValues.stripped.indexOf(joined); at !== -1; at = forValues.stripped.indexOf(joined, at + joined.length)) addValue(at, joined.length);
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
