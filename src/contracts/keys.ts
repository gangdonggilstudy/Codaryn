/**
 * DR-40 (R-25): checking a file or an argument for key material before it can leave the machine
 * (S-6 task and config files, S-8 `--goal`). Pure functions with no platform module (the GUI imports
 * the contracts too). The refusal shapes are defined in config.ts (API_KEY_PATTERN_SOURCES); these
 * functions give the same answers in time linear in the text's length.
 */

import { ANTHROPIC_KEY_FORMAT_PATTERN_SOURCE, OPENAI_LEGACY_KEY_PATTERN_SOURCE, OPENAI_PREFIXED_KEY_PATTERN_SOURCE } from "./config.js";

/**
 * The run ANTHROPIC_KEY_REFUSAL_PATTERN_SOURCE needs: the prefix at a word start and 32 or more key
 * characters, matched once each (global, greedy); whether the run holds a digit is checked in code.
 */
const ANTHROPIC_REFUSAL_RUN = /\bsk-ant-([A-Za-z0-9_-]{32,})/g;
const DIGIT = /[0-9]/;
const ANTHROPIC_FORMAT = new RegExp(ANTHROPIC_KEY_FORMAT_PATTERN_SOURCE);
const OPENAI_PREFIXED = new RegExp(OPENAI_PREFIXED_KEY_PATTERN_SOURCE);
const OPENAI_LEGACY = new RegExp(OPENAI_LEGACY_KEY_PATTERN_SOURCE);

/**
 * DR-40 (a), R-25 M-1: the characters a key can be split by without a person seeing the split:
 * white space, control characters (Cc) and format characters (Cf: zero-width space and joiners,
 * soft hyphen, word joiner, byte order mark, direction marks). For a regular expression with the
 * `u` flag. Characters outside the Basic Multilingual Plane are matched only as whole code points.
 */
export const KEY_SEPARATOR_PATTERN_SOURCE = "[\\s\\p{Cc}\\p{Cf}]";
const SEPARATORS = new RegExp(`${KEY_SEPARATOR_PATTERN_SOURCE}+`, "gu");

/** DR-40 (a): `text` with every KEY_SEPARATOR_PATTERN_SOURCE character left out. */
export function compactKeyText(text: string): string {
  return text.replace(SEPARATORS, "");
}

/**
 * DR-40 (c), R-25 L-2: whether `text` matches ANTHROPIC_KEY_REFUSAL_PATTERN_SOURCE, in linear time.
 * That source's look-ahead rescans the run after every word-start prefix, so as a regular
 * expression it takes time growing with the square of the length (seconds for 256 KiB). Here each
 * maximal run is found once and searched for a digit once. Same answers: a later prefix inside a
 * run has the tail of that run, so it holds a digit only when the whole run does.
 */
export function anthropicRefusalShapeIn(text: string): boolean {
  for (const match of text.matchAll(ANTHROPIC_REFUSAL_RUN)) {
    if (DIGIT.test(match[1] as string)) return true;
  }
  return false;
}

function shapeIn(text: string): boolean {
  return anthropicRefusalShapeIn(text) || ANTHROPIC_FORMAT.test(text) || OPENAI_PREFIXED.test(text) || OPENAI_LEGACY.test(text);
}

/**
 * DR-40: whether `text` holds a refusal key shape (API_KEY_PATTERN_SOURCES), on the text as it is
 * and, DR-40 (a), on its compact view (compactKeyText), in linear time. Use this, not a regular
 * expression joined from the sources.
 * - The compact view finds a key split by a line break or an invisible character (R-25 M-1).
 * - False positive it adds: an ordinary name starting with a key prefix after a non-word character,
 *   joined across white space or a line break with the words after it, when the joined run has the
 *   shape (for example `- sk-ant-design-system` and then `components-...-v2-2026`). After a word
 *   there is no word start once joined, and punctuation ends the run. R-20's 14 ordinary names, one
 *   per line or in a row, do not match.
 * - Misses left: an OpenAI key split after a word (no word start in the compact view) that no
 *   registered value finds.
 */
export function holdsRefusedKeyShape(text: string): boolean {
  if (shapeIn(text)) return true;
  const compact = compactKeyText(text);
  return compact !== text && shapeIn(compact);
}

/**
 * DR-40 (a): whether `text` holds one of `values` (registered key values), as it is or split by
 * KEY_SEPARATOR_PATTERN_SOURCE characters (both compacted). Empty values are ignored.
 */
export function createKeyValueCheck(values: readonly string[]): (text: string) => boolean {
  const keys = values.filter((value) => value.length > 0).map((value) => ({ value, compact: compactKeyText(value) }));
  return (text: string): boolean => {
    if (keys.some((key) => text.includes(key.value))) return true;
    const compact = compactKeyText(text);
    return compact !== text && keys.some((key) => key.compact.length > 0 && compact.includes(key.compact));
  };
}

/**
 * DR-40: the S-6 and S-8 check: a registered key value or a refusal key shape, each on the text as
 * it is and on its compact view. `values` are the key values the caller registers by the S-2 rules
 * (the run's own key from 16 characters, another provider's from MIN_OTHER_PROVIDER_KEY_LENGTH).
 */
export function createKeyRefusalCheck(values: readonly string[]): (text: string) => boolean {
  const holdsValue = createKeyValueCheck(values);
  return (text: string): boolean => holdsValue(text) || holdsRefusedKeyShape(text);
}
