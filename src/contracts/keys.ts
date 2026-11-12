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
 * DR-42 (b), R-25b L-2: what is left out when the refusal shapes are checked a second time:
 * invisible characters and line breaks only, that is control characters (Cc: tab, line feed,
 * carriage return and the like), format characters (Cf) and the line and paragraph separators
 * (U+2028, U+2029). Visible spaces stay, so the words of an ordinary sentence are not joined into
 * a key shape. For a regular expression with the `u` flag.
 */
export const KEY_INVISIBLE_PATTERN_SOURCE = "[\\p{Cc}\\p{Cf}\\u2028\\u2029]";
const INVISIBLES = new RegExp(`${KEY_INVISIBLE_PATTERN_SOURCE}+`, "gu");

/** DR-42 (b): `text` with every KEY_INVISIBLE_PATTERN_SOURCE character left out. */
export function withoutInvisibleCharacters(text: string): string {
  return text.replace(INVISIBLES, "");
}

/**
 * DR-42 (a): a registered value's letters and digits (A-Z a-z 0-9) are compared only when there are
 * at least this many of them; a registered key is a long random value, so a chance match is
 * negligible.
 */
export const MIN_KEY_SKELETON_LENGTH = 16;

/** DR-42 (a), R-25b L-1: `text` with every character but A-Z, a-z and 0-9 left out. */
export function keyLettersAndDigits(text: string): string {
  return text.replace(/[^A-Za-z0-9]+/g, "");
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
 * DR-40, DR-42 (b): whether `text` holds a refusal key shape (API_KEY_PATTERN_SOURCES), on the text
 * as it is and on it without invisible characters and line breaks (withoutInvisibleCharacters), in
 * linear time. Use this, not a regular expression joined from the sources.
 * - The second look finds a key split by a line break or an invisible character, even unregistered
 *   (R-25 M-1): line feed, zero-width space, soft hyphen, tag characters, a split inside the prefix.
 * - Visible spaces stay (R-25b L-2), so ordinary sentences are not joined: a goal starting with a
 *   locale such as `sk-SK`, an `sk-admin-` or `sk-proj-` package name, R-20's names as a bullet list.
 * - False positives left: a key-prefixed name after a non-word character wrapped onto the next line
 *   when the joined run has the shape; R-20's names as a numbered list (a name runs into the next
 *   line's number, as on main).
 * - Misses left (the registered values find them when registered): a key split by a visible space,
 *   a no-break space or another visible character; an OpenAI key split after a word.
 */
export function holdsRefusedKeyShape(text: string): boolean {
  if (shapeIn(text)) return true;
  const joined = withoutInvisibleCharacters(text);
  return joined !== text && shapeIn(joined);
}

/**
 * DR-40 (a), DR-42 (a): whether `text` holds one of `values` (registered key values): as written;
 * split by KEY_SEPARATOR_PATTERN_SOURCE characters (both compacted); or split by any other
 * character, comparing letters and digits only (keyLettersAndDigits) for a value that has at least
 * MIN_KEY_SKELETON_LENGTH of them (R-25b L-1: variation selectors, the combining grapheme joiner,
 * the Hangul filler, the Braille blank, a backslash, a middle dot, a lone surrogate). Miss left: a
 * split written as a character reference with digits (`&#8203;`). Empty values are ignored.
 */
export function createKeyValueCheck(values: readonly string[]): (text: string) => boolean {
  const keys = values
    .filter((value) => value.length > 0)
    .map((value) => ({ value, compact: compactKeyText(value), skeleton: keyLettersAndDigits(value) }));
  return (text: string): boolean => {
    if (keys.some((key) => text.includes(key.value))) return true;
    const compact = compactKeyText(text);
    if (compact !== text && keys.some((key) => key.compact.length > 0 && compact.includes(key.compact))) return true;
    const skeleton = keyLettersAndDigits(text);
    return keys.some((key) => key.skeleton.length >= MIN_KEY_SKELETON_LENGTH && skeleton.includes(key.skeleton));
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
