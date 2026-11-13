/**
 * Layout rules shared by the human output (N-5, N-7): safe lines, paths, local times, command
 * arguments that can be copied, and the width of text in a terminal.
 */

import { KEY_MASK_SHAPE_SOURCE } from "../security/index.js";
import { REPLACEMENT, cleanText, hideKeys, safeToken } from "../text-safety.js";

/** Longest path shown in a human line, in characters (as progress.ts). */
export const MAX_SHOWN_PATH = 200;

/** A recorded path for one line: key shapes hidden, control characters replaced, long paths cut. */
export function shownPath(text: string): string {
  const clean = finalLine(text);
  return clean.length > MAX_SHOWN_PATH ? `${clean.slice(0, MAX_SHOWN_PATH)}...` : clean;
}

/** A code or id as recorded (status, reason, permission, run id), or "?" when it holds anything else. */
export const token = safeToken;

// SP-2, DR-32 (a): every key shape hidden in output, the loose one included.
const KEY_SHAPE = new RegExp(KEY_MASK_SHAPE_SOURCE, "g");
const HIDDEN_KEY = "[key]";

/** A character that `cleanText` replaces (controls, line and paragraph separators, bidi controls). */
function isUnsafe(char: string): boolean {
  return char !== REPLACEMENT && cleanText(char) === REPLACEMENT;
}

/**
 * N-23(h): key-shaped text hidden before control characters are replaced. The key pattern is
 * looked for in the text with the unsafe characters left out, so a control character inside a key
 * cannot split it into two harmless-looking parts; the whole span, controls included, becomes
 * "[key]". `hideKeys` runs afterwards as before.
 */
export function hideKeysAcrossControls(text: string): string {
  const visible: string[] = [];
  /** For each code unit of `visible.join("")`, the index in `text` of its character. */
  const origin: number[] = [];
  let index = 0;
  for (const char of text) {
    if (!isUnsafe(char)) {
      visible.push(char);
      for (let unit = 0; unit < char.length; unit += 1) origin.push(index);
    }
    index += char.length;
  }
  const joined = visible.join("");
  const spans: [number, number][] = [];
  for (const match of joined.matchAll(KEY_SHAPE)) {
    const start = origin[match.index] as number;
    const last = origin[match.index + match[0].length - 1] as number;
    spans.push([start, last + 1]);
  }
  if (spans.length === 0) return text;
  let out = "";
  let at = 0;
  for (const [start, end] of spans) {
    out += text.slice(at, start) + HIDDEN_KEY;
    at = end;
  }
  return out + text.slice(at);
}

/**
 * The last step for every line written for people: no key-shaped text (looked for first, across
 * control characters) and no control characters (a line cannot overwrite another or reorder itself).
 */
export function finalLine(text: string): string {
  return hideKeys(cleanText(hideKeysAcrossControls(text)), null);
}

/** `YYYY-MM-DD HH:MM:SS` in the local time zone (ux-design 6절: people read local time). */
export function formatLocalTime(ms: number): string {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return "?";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

const PLAIN_ARG = /^[A-Za-z0-9_\-.\/\\:~+@,=]+$/;
/** Characters double quotes keep literal in PowerShell, cmd and POSIX shells alike. */
const QUOTABLE_ARG = /^[^"`$%!\u0000-\u001f\u007f-\u009f]+$/u;

/**
 * A command line argument a person can copy into PowerShell, cmd or a POSIX shell: as it is when
 * it holds only plain characters, in double quotes when it has spaces or other characters that
 * double quotes keep literal in all three, and null when it cannot be written safely that way
 * (the caller then shows a placeholder).
 */
export function shellArg(value: string): string | null {
  if (value.length === 0 || cleanText(value) !== value) return null;
  if (PLAIN_ARG.test(value)) return value;
  return QUOTABLE_ARG.test(value) && !value.endsWith("\\") ? `"${value}"` : null;
}

/**
 * U-125: code point ranges, inclusive, of characters a terminal draws two columns wide: the East
 * Asian wide and fullwidth blocks (Hangul, kana, CJK ideographs and their symbols, fullwidth forms)
 * and the common emoji blocks. No dependency: a fixed table, as the Unicode East Asian Width data
 * gives them (`W` and `F`) for the blocks a Korean, Japanese or Chinese text uses.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo: initial consonants
  [0x2e80, 0x303e], // CJK radicals, Kangxi radicals, ideographic description, CJK symbols and punctuation
  [0x3040, 0xa4cf], // kana, Bopomofo, Hangul compatibility Jamo, Kanbun, CJK strokes, enclosed CJK, CJK ideographs, Yi
  [0xa960, 0xa97f], // Hangul Jamo Extended-A: initial consonants
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms, small form variants
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6], // fullwidth signs
  [0x1f300, 0x1f64f], // emoji: symbols and pictographs, emoticons
  [0x1f900, 0x1f9ff], // emoji: supplemental symbols and pictographs
  [0x20000, 0x3fffd], // CJK ideographs, extensions B and later
];

/**
 * U-125: code point ranges, inclusive, of characters that take no column: combining marks (drawn on
 * the character before them), the Hangul Jamo vowels and final consonants that join an initial into
 * one syllable, the kana voiced sound marks, zero-width spaces and joiners, and variation selectors.
 * Looked up before WIDE_RANGES, so a mark inside a wide block still takes none.
 */
const ZERO_WIDTH_RANGES: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f], // combining diacritical marks
  [0x1160, 0x11ff], // Hangul Jamo: vowels and final consonants (conjoining)
  [0x1ab0, 0x1aff], // combining diacritical marks extended
  [0x1dc0, 0x1dff], // combining diacritical marks supplement
  [0x200b, 0x200d], // zero width space, non-joiner, joiner
  [0x2060, 0x2060], // word joiner
  [0x20d0, 0x20ff], // combining diacritical marks for symbols
  [0x3099, 0x309a], // combining kana voiced and semi-voiced sound marks
  [0xd7b0, 0xd7ff], // Hangul Jamo Extended-B: vowels and final consonants (conjoining)
  [0xfe00, 0xfe0f], // variation selectors
  [0xfe20, 0xfe2f], // combining half marks
  [0xfeff, 0xfeff], // zero width no-break space
  [0xe0100, 0xe01ef], // variation selectors supplement
];

function inRanges(cp: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([low, high]) => cp >= low && cp <= high);
}

/**
 * Columns the text takes in a terminal (U-125: the one width every table and fold of the human
 * output uses): a character in ZERO_WIDTH_RANGES counts 0, one in WIDE_RANGES (Hangul, CJK) 2,
 * any other 1. For ASCII text it is the length.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) as number;
    width += inRanges(cp, ZERO_WIDTH_RANGES) ? 0 : inRanges(cp, WIDE_RANGES) ? 2 : 1;
  }
  return width;
}

/** U-125: spaces up to `width` columns, then `text` (a right-aligned cell); never cut. */
export function padStart(text: string, width: number): string {
  return " ".repeat(Math.max(0, width - displayWidth(text))) + text;
}

/** `text` followed by spaces up to `width` columns (displayWidth); never cut. */
export function padEnd(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

/** U-14 (R-49 R49-L2): before every row of text a model wrote, so no row of it can pass for the tool's own line. */
export const MODEL_TEXT_PREFIX = "  | ";
/** The widest row of quoted model text, prefix included, in terminal columns (folded here, not by the terminal). */
export const MODEL_TEXT_COLUMNS = 76;
/** R-52 R52-L1: the width taken for a terminal that does not tell its width. */
export const MODEL_TEXT_FALLBACK_COLUMNS = 40;
/** The narrowest row folded for: the prefix and a few characters (a narrower terminal folds anyway). */
const MODEL_TEXT_MIN_COLUMNS = 8;

/**
 * R-52 R52-L1: the narrowest terminal the person's output goes to (stdout or stderr, whichever is a
 * terminal), MODEL_TEXT_FALLBACK_COLUMNS for a terminal that does not tell its width, or null when
 * neither is a terminal (a file or a pipe: nothing folds it here).
 */
export function terminalColumns(): number | null {
  const widths: number[] = [];
  for (const stream of [process.stdout, process.stderr]) {
    if (stream?.isTTY !== true) continue;
    const columns: unknown = stream.columns;
    widths.push(typeof columns === "number" && Number.isSafeInteger(columns) && columns > 0 ? columns : MODEL_TEXT_FALLBACK_COLUMNS);
  }
  return widths.length === 0 ? null : Math.min(...widths);
}

/** The widest row for a terminal `columns` wide: one column less (a row that fills the last column may fold), at most MODEL_TEXT_COLUMNS. */
function modelTextWidth(columns: number | null): number {
  if (columns === null || !Number.isFinite(columns)) return MODEL_TEXT_COLUMNS;
  return Math.max(MODEL_TEXT_MIN_COLUMNS, Math.min(MODEL_TEXT_COLUMNS, Math.floor(columns) - 1));
}

/** Every line break a terminal may honour: CR LF, LF, CR, VT, FF, NEL, and the line and paragraph separators. */
const MODEL_LINE_BREAK = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/;
/** Characters that show nothing: zero-width spaces and joiners, the soft hyphen, the word joiner, the BOM, the Mongolian vowel separator. Shown as REPLACEMENT. */
const INVISIBLE = /[\u00ad\u180e\u200b-\u200d\u2060\ufeff]/g;
/** A run of white space of any kind (Unicode spaces, tabs). */
const WHITE_SPACE = /[\s\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+/g;

/**
 * U-14 (R-49 R49-L2), DR-47: text a model wrote (a plan's summary, the agent's last message) as rows
 * for people. It is the model's own words, so every row starts with MODEL_TEXT_PREFIX. Runs of
 * white space become one space and invisible characters show as REPLACEMENT, so padding cannot place words at the
 * start of a terminal row; the text is folded here (at a space when there is one), so the terminal
 * does not fold it: R-52 R52-L1, for a terminal `columns` wide (by default the terminal's,
 * terminalColumns) one column narrower, at most MODEL_TEXT_COLUMNS, and MODEL_TEXT_COLUMNS when the
 * output is not a terminal. Key shapes and control characters are replaced as in every line for
 * people. At most `maxRows` rows; the rest are counted in a last "(+N)" row. No rows when nothing is
 * left to show.
 */
export function quoteModelText(text: string, maxRows: number, columns: number | null = terminalColumns()): string[] {
  const room = modelTextWidth(columns) - displayWidth(MODEL_TEXT_PREFIX);
  const rows: string[] = [];
  // R-52 R52-M2: key shapes over the whole text first, so a key split by LF, TAB or CRLF (which split
  // it into rows below) is still found; hideKeys skips control and format characters.
  for (const raw of hideKeys(text, null).split(MODEL_LINE_BREAK)) {
    // White space first (a tab is a space here, not a control character to mark), then the last step
    // of every line. R-52 R52-M1: an invisible character shows as REPLACEMENT; removing it could put a
    // value back together that was masked apart (a short registered value split by a zero-width space).
    const line = finalLine(raw.replace(INVISIBLE, REPLACEMENT).replace(WHITE_SPACE, " ")).trim();
    if (line.length === 0) continue;
    let row = "";
    let width = 0;
    for (const word of line.split(" ")) {
      const wordWidth = displayWidth(word);
      if (row.length > 0 && width + 1 + wordWidth <= room) {
        row += ` ${word}`;
        width += 1 + wordWidth;
        continue;
      }
      if (row.length > 0) rows.push(row);
      row = "";
      width = 0;
      // A word wider than a row is cut into rows.
      for (const char of word) {
        const charWidth = displayWidth(char);
        if (width + charWidth > room) {
          rows.push(row);
          row = "";
          width = 0;
        }
        row += char;
        width += charWidth;
      }
    }
    if (row.length > 0) rows.push(row);
  }
  const shown = rows.slice(0, Math.max(0, maxRows)).map((row) => `${MODEL_TEXT_PREFIX}${row}`);
  return rows.length > shown.length ? [...shown, `  … (+${rows.length - shown.length})`] : shown;
}
