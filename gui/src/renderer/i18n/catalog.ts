/**
 * The GUI's two-language text frame (docs/design/standalone-gui.md 11, N-4, GUI-D21). Pure: no DOM,
 * so unit tests run it under Node.
 * - The language is the one the engine host chose as the CLI chooses (CODARYN_LANG, the settings,
 *   the OS); the window does not choose its own.
 * - `{name}` placeholders take only values the window was given (a count, a folder name, a code).
 *   Control characters, line and paragraph separators and bidi controls in a value are replaced,
 *   so a value cannot add a line or turn the text around (S-6). The result goes into textContent.
 */

import { EN } from "./en.js";
import { KO } from "./ko.js";
import type { TextId } from "./ko.js";

export type Language = "ko" | "en";
export type { TextId };

export const REPLACEMENT = "?";

/** C0 and C1 controls, DEL, line and paragraph separators, bidi embedding, override and isolate controls. */
export function isUnsafeCodePoint(cp: number): boolean {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0x200e ||
    cp === 0x200f ||
    cp === 0x061c
  );
}

export function cleanValue(value: string): string {
  let out = "";
  for (const char of value) out += isUnsafeCodePoint(char.codePointAt(0) as number) ? REPLACEMENT : char;
  return out;
}

const TABLES: { readonly [L in Language]: { readonly [K in TextId]: string } } = { ko: KO, en: EN };

/** The placeholder names a template uses, in order of appearance. */
export function placeholders(template: string): string[] {
  return [...template.matchAll(/\{([a-z][a-zA-Z]*)\}/g)].map((match) => match[1] as string);
}

export interface Texts {
  readonly language: Language;
  /** The text for `id` with its placeholders filled. A placeholder without a value shows as "?". */
  format(id: TextId, values?: Readonly<Record<string, string | number>>): string;
  /** Whether the language has a text for an id built at run time (such as `error.<code>`). */
  has(id: string): id is TextId;
}

export function textsFor(language: Language): Texts {
  const table = TABLES[language];
  return {
    language,
    format(id, values = {}) {
      return table[id].replace(/\{([a-z][a-zA-Z]*)\}/g, (_match, name: string) => {
        const value = values[name];
        return value === undefined ? REPLACEMENT : cleanValue(String(value));
      });
    },
    has(id: string): id is TextId {
      return Object.hasOwn(table, id);
    },
  };
}

/** The error text for a code, or the default error text. The code is shown apart, in parentheses. */
export function errorText(texts: Texts, code: string): string {
  const id = `error.${code}`;
  return texts.has(id) ? texts.format(id) : texts.format("error.default");
}

/**
 * U-212 (bundle A): a refused start in words: the error's text, then the CLI's hint for it when one came
 * and the window has its words (error.hint.<hint>, e.g. why analyze-private was refused), then the code.
 */
export function startErrorText(texts: Texts, code: string, hint: string | null | undefined): string {
  const id = hint == null ? null : `error.hint.${hint}`;
  const hinted = id !== null && texts.has(id) ? ` ${texts.format(id)}` : "";
  return `${errorText(texts, code)}${hinted} ${texts.format("error.code", { code })}`;
}
