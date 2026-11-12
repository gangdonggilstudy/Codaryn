/**
 * DR-40 (R-25): checking a file or an argument for key material before it can leave the machine
 * (S-6 task and config files, S-8 `--goal`). Pure functions with no platform module (the GUI imports
 * the contracts too). The refusal shapes are defined in config.ts (API_KEY_PATTERN_SOURCES); these
 * functions give the same answers in time linear in the text's length.
 */

import {
  ANTHROPIC_KEY_FORMAT_PATTERN_SOURCE,
  API_KEY_MASK_PATTERN_SOURCES,
  OPENAI_LEGACY_KEY_PATTERN_SOURCE,
  OPENAI_PREFIXED_KEY_PATTERN_SOURCE,
} from "./config.js";
import type { MaskOutcome } from "./privacy.js";

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
 * DR-43 (c), R-32 L-1: whether a value's letters and digits (keyLettersAndDigits) look like a
 * generated key rather than words: at least MIN_KEY_SKELETON_LENGTH of them with a digit, an
 * upper-case and a lower-case letter, or at least 32 with a digit and a letter (a long hex or
 * single-case token). A phrase kept in a key variable for a local server (`your-api-key-goes-here`)
 * and values such as `summer2026winter` or `notapassword1234` are not. The one condition the privacy
 * gateway and the CLI's output hiding use too.
 */
export function keyLikeSkeleton(skeleton: string): boolean {
  if (skeleton.length < MIN_KEY_SKELETON_LENGTH || !/[0-9]/.test(skeleton) || !/[A-Za-z]/.test(skeleton)) return false;
  return (/[A-Z]/.test(skeleton) && /[a-z]/.test(skeleton)) || skeleton.length >= 32;
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
 * character, comparing letters and digits only (keyLettersAndDigits; R-25b L-1: variation
 * selectors, the combining grapheme joiner, the Hangul filler, the Braille blank, a backslash, a
 * middle dot, a lone surrogate). DR-43 (c), R-32 L-1: that last comparison only for a key-like value
 * (keyLikeSkeleton), so a phrase kept in a key variable does not match an ordinary sentence with
 * the same words. Miss left: a split written as a character reference with digits (`&#8203;`).
 * Empty values are ignored.
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
    return keys.some((key) => keyLikeSkeleton(key.skeleton) && skeleton.includes(key.skeleton));
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

/** What a hidden key shape becomes in model text shown to people (as the CLI's hideKeys writes it). */
export const HIDDEN_KEY_MARKER = "[key]";

const KEY_MASK_SHAPES = API_KEY_MASK_PATTERN_SOURCES.map((source) => `(?:${source})`).join("|");
/** One control or invisible character (KEY_INVISIBLE_PATTERN_SOURCE), for a single code point. */
const INVISIBLE_ONE = new RegExp(`^${KEY_INVISIBLE_PATTERN_SOURCE}$`, "u");

/**
 * Key shapes (API_KEY_MASK_PATTERN_SOURCES) as HIDDEN_KEY_MARKER, found also across LF and TAB:
 * they are looked for in the text with every control and invisible character skipped, as the CLI's
 * hideKeys does, and the span hidden covers the skipped characters too. Visible white space is not
 * skipped: a key glued to the next word would hide that word as well. A word right after a key
 * across a LF or a TAB is hidden with it, since it cannot be told from the key's rest (more is
 * hidden, never less).
 */
function hideKeyShapes(text: string): string {
  const kept: number[] = [];
  let stripped = "";
  let index = 0;
  for (const char of text) {
    if (!INVISIBLE_ONE.test(char)) {
      stripped += char;
      for (let unit = 0; unit < char.length; unit += 1) kept.push(index + unit);
    }
    index += char.length;
  }
  const spans: [number, number][] = [];
  for (const match of stripped.matchAll(new RegExp(KEY_MASK_SHAPES, "g"))) {
    const from = kept[match.index];
    const to = kept[match.index + match[0].length - 1];
    if (from !== undefined && to !== undefined) spans.push([from, to + 1]);
  }
  let out = "";
  let cursor = 0;
  for (const [start, end] of spans) {
    if (end <= cursor) continue;
    if (start >= cursor) out += `${text.slice(cursor, start)}${HIDDEN_KEY_MARKER}`;
    cursor = end;
  }
  return out + text.slice(cursor);
}

/**
 * R-52 (U-21, R52-M1, R52-M2): model text made safe to show people, in this order:
 * 1. line breaks as LF (CR LF and a lone CR), TAB kept, every other control and invisible character
 *    (KEY_INVISIBLE_PATTERN_SOURCE) left out, first, so nothing left out afterwards can join a value;
 * 2. masked by the run's gateway (`mask`): a registered value those characters split is whole now
 *    and found as the gateway finds any (exactly, and split by key separators from
 *    MIN_SPLIT_MATCH_LENGTH code points, compactKeyText's rule); tokens already there stay;
 * 3. key shapes hidden, also across LF and TAB (hideKeyShapes).
 * Null when masking fails (fail closed: show nothing). EngineResult.finalMessage is made with it.
 */
export function safeModelText(text: string, mask: (text: string) => MaskOutcome): string | null {
  let seen = "";
  for (const char of text.replace(/\r\n?/g, "\n")) {
    if (char === "\n" || char === "\t" || !INVISIBLE_ONE.test(char)) seen += char;
  }
  const masked = mask(seen);
  if (!masked.ok) return null;
  return hideKeyShapes(masked.text);
}
