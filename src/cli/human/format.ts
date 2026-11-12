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

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function isZeroWidth(cp: number): boolean {
  return (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1160 && cp <= 0x11ff) || cp === 0x200b || (cp >= 0xfe00 && cp <= 0xfe0f);
}

/** Columns the text takes in a terminal: East Asian wide characters (Hangul, CJK) count 2. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) as number;
    width += isZeroWidth(cp) ? 0 : isWide(cp) ? 2 : 1;
  }
  return width;
}

/** `text` followed by spaces up to `width` columns. */
export function padEnd(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}
