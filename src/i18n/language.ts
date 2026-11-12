/**
 * N-4: the language of human-readable messages (`SelectMessageLanguage`, src/contracts/human.ts).
 *
 * First match wins: CODARYN_LANG (trimmed, any case; only ko or en counts) → the config file's
 * `language` → the operating system's display language (a locale whose language subtag is `ko`
 * gives ko) → en. The inputs only choose the language; none of them is kept or shown.
 */

import { MESSAGE_LANGUAGES } from "../contracts/index.js";
import type { MessageLanguage, MessageLanguageInput, SelectMessageLanguage } from "../contracts/index.js";

/** Used when nothing tells the language. */
export const DEFAULT_MESSAGE_LANGUAGE: MessageLanguage = "en";

/** "ko" or "en", ignoring case and surrounding white space; null for anything else. */
export function parseMessageLanguage(value: unknown): MessageLanguage | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (MESSAGE_LANGUAGES as readonly string[]).includes(normalized) ? (normalized as MessageLanguage) : null;
}

/**
 * The lowercased language subtag of a BCP 47 tag (`ko-KR`) or a POSIX locale (`ko_KR.UTF-8`,
 * `ko@euro`), or null when there is none.
 */
export function localeLanguage(locale: unknown): string | null {
  if (typeof locale !== "string") return null;
  const head = locale.trim().split(/[-_.@]/, 1)[0]?.toLowerCase() ?? "";
  return /^[a-z]{2,8}$/.test(head) ? head : null;
}

export const selectMessageLanguage: SelectMessageLanguage = (input: MessageLanguageInput): MessageLanguage => {
  const fromEnv = parseMessageLanguage(input.env);
  if (fromEnv !== null) return fromEnv;
  const fromConfig = parseMessageLanguage(input.config);
  if (fromConfig !== null) return fromConfig;
  if (localeLanguage(input.osLocale) === "ko") return "ko";
  return DEFAULT_MESSAGE_LANGUAGE;
};

/**
 * The runtime's default locale, for `MessageLanguageInput.osLocale`, or null when it cannot be
 * read. On Windows ICU takes it from the user's settings; elsewhere from LC_ALL, LC_MESSAGES or
 * LANG. Reads nothing else.
 */
export function runtimeLocale(): string | null {
  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    return typeof locale === "string" && locale.length > 0 ? locale : null;
  } catch {
    return null;
  }
}
