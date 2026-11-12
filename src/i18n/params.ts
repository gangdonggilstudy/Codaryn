/**
 * Turns message parameters into text by their kind (see spec.ts). Pure: nothing is read from the
 * environment or a file. A value that does not fit its kind becomes REPLACEMENT, never the
 * value itself.
 */

import { ANTHROPIC_KEY_PATTERN_SOURCE } from "../contracts/index.js";
import type { Language } from "./language.js";
import { KNOWN_FIELD_NAMES, MAX_FIELD_POSITION, MAX_SHOWN_PATH, TERM_KINDS } from "./spec.js";
import type { ParamKind, Term, TermKind, TermTables } from "./spec.js";

/** Shown in place of a value that does not fit its kind, and of a replaced character. */
export const REPLACEMENT = "?";
/** Shown in place of key-shaped text. */
export const HIDDEN_KEY = "[key]";

const KEY_PATTERN = new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE, "g");
const ID_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;
const FIELD_NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const FIELD_INDEX = /\[(\d{1,6})\]/y;

const TOP_LEVEL: { readonly [L in Language]: string } = { ko: "최상위", en: "the top level" };

function isTermKind(kind: ParamKind): kind is TermKind {
  return (TERM_KINDS as readonly string[]).includes(kind);
}

/** C0 and C1 controls, line and paragraph separators, and bidirectional controls. */
function isUnsafeCodePoint(cp: number): boolean {
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return true;
  if (cp === 0x2028 || cp === 0x2029 || cp === 0x061c || cp === 0x200e || cp === 0x200f) return true;
  return (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}

/**
 * One line of text for a terminal: every unsafe character (line breaks included) becomes
 * REPLACEMENT and key-shaped text becomes HIDDEN_KEY. The same rules as `src/cli/text-safety.ts`.
 */
export function cleanLine(text: string): string {
  let out = "";
  for (const char of text) out += isUnsafeCodePoint(char.codePointAt(0) as number) ? REPLACEMENT : char;
  return out.replace(KEY_PATTERN, HIDDEN_KEY);
}

/** A recorded path for display: cleaned, and cut to MAX_SHOWN_PATH characters. */
export function shownPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return REPLACEMENT;
  const chars = Array.from(cleanLine(value));
  return chars.length > MAX_SHOWN_PATH ? `${chars.slice(0, MAX_SHOWN_PATH).join("")}...` : chars.join("");
}

/** A non-negative safe integer, or null. */
function wholeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function formatCount(value: unknown): string {
  const n = wholeNumber(value);
  return n === null ? REPLACEMENT : String(n);
}

/** `78 ms`, `4.2 s` / `4.2초`, `3 min 5 s` / `3분 5초`, `2 h 0 min` / `2시간 0분`. */
export function formatDuration(value: unknown, language: Language): string {
  const ms = wholeNumber(value);
  if (ms === null) return REPLACEMENT;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) {
    const seconds = (Math.floor(ms / 100) / 10).toFixed(1);
    return language === "ko" ? `${seconds}초` : `${seconds} s`;
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    const seconds = totalSeconds % 60;
    return language === "ko" ? `${minutes}분 ${seconds}초` : `${minutes} min ${seconds} s`;
  }
  const hours = Math.floor(minutes / 60);
  return language === "ko" ? `${hours}시간 ${minutes % 60}분` : `${hours} h ${minutes % 60} min`;
}

/**
 * A field position: names joined by "." with `[n]` indexes, such as `policy.commands[2].argsPrefix`.
 * "" is the top level. A name outside KNOWN_FIELD_NAMES is shown as "?"; a value that is not
 * such a position at all is REPLACEMENT as a whole.
 */
export function formatField(value: unknown, language: Language): string {
  if (value === "") return TOP_LEVEL[language];
  if (typeof value !== "string" || value.length > MAX_FIELD_POSITION) return REPLACEMENT;
  let out = "";
  let pos = 0;
  while (pos < value.length) {
    FIELD_INDEX.lastIndex = pos;
    const index = FIELD_INDEX.exec(value);
    if (index !== null && pos > 0) {
      out += `[${String(Number(index[1]))}]`;
      pos = FIELD_INDEX.lastIndex;
      continue;
    }
    if (pos > 0) {
      if (value[pos] !== ".") return REPLACEMENT;
      pos += 1;
      out += ".";
    }
    FIELD_NAME.lastIndex = pos;
    const name = FIELD_NAME.exec(value);
    if (name === null) return REPLACEMENT;
    out += KNOWN_FIELD_NAMES.has(name[0]) ? name[0] : REPLACEMENT;
    pos = FIELD_NAME.lastIndex;
  }
  return out;
}

export function formatId(value: unknown): string {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : REPLACEMENT;
}

/** The code and its label, or REPLACEMENT for both when the value is not one of the kind's codes. */
export function formatTerm(kind: TermKind, value: unknown, terms: TermTables): Term {
  const table = terms[kind] as Readonly<Record<string, string>>;
  if (typeof value === "string" && Object.hasOwn(table, value)) {
    return { code: value, label: table[value] as string };
  }
  return { code: REPLACEMENT, label: REPLACEMENT };
}

/** One parameter by its kind. */
export function renderParam(kind: ParamKind, value: unknown, language: Language, terms: TermTables): string | Term {
  if (isTermKind(kind)) return formatTerm(kind, value, terms);
  switch (kind) {
    case "count":
      return formatCount(value);
    case "durationMs":
      return formatDuration(value, language);
    case "field":
      return formatField(value, language);
    case "id":
      return formatId(value);
    case "recordedPath":
      return shownPath(value);
  }
}
