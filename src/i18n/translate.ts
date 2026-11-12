/**
 * Renders a message in a language. Each parameter is turned into text by its kind (params.ts)
 * before the template sees it, and the finished line is cleaned once more, so a message is one
 * line without control characters or key-shaped text whatever the caller passed.
 */

import { EN_MESSAGES, EN_TERMS } from "./en.js";
import { KO_MESSAGES, KO_TERMS } from "./ko.js";
import { DEFAULT_LANGUAGE, parseLanguage } from "./language.js";
import type { Language } from "./language.js";
import { cleanLine, formatTerm, renderParam, REPLACEMENT } from "./params.js";
import { MESSAGE_PARAMS } from "./spec.js";
import type { MessageCatalog, MessageKey, MessageParams, ParamKind, Term, TermKind, TermKinds, TermTables } from "./spec.js";

const CATALOGS: { readonly [L in Language]: { readonly messages: MessageCatalog; readonly terms: TermTables } } = {
  ko: { messages: KO_MESSAGES, terms: KO_TERMS },
  en: { messages: EN_MESSAGES, terms: EN_TERMS },
};

/** The message's parameters as arguments: none for a message without parameters. */
export type MessageArgs<K extends MessageKey> = keyof MessageParams<K> extends never
  ? [params?: MessageParams<K>]
  : [params: MessageParams<K>];

/** A supported language as given, else DEFAULT_LANGUAGE (for callers outside the type checker). */
function supported(language: unknown): Language {
  return parseLanguage(language) ?? DEFAULT_LANGUAGE;
}

/** Message `key` in `language`. An unknown key gives REPLACEMENT. */
export function translate<K extends MessageKey>(language: Language, key: K, ...args: MessageArgs<K>): string {
  const lang = supported(language);
  if (!Object.hasOwn(MESSAGE_PARAMS, key)) return REPLACEMENT;
  const { messages, terms } = CATALOGS[lang];
  const spec = MESSAGE_PARAMS[key] as Readonly<Record<string, ParamKind>>;
  const given = (args[0] ?? {}) as Readonly<Record<string, unknown>>;
  const rendered: Record<string, string | Term> = {};
  for (const [name, kind] of Object.entries(spec)) {
    rendered[name] = renderParam(kind, Object.hasOwn(given, name) ? given[name] : undefined, lang, terms);
  }
  const template = messages[key] as (params: Readonly<Record<string, string | Term>>) => string;
  return cleanLine(template(rendered));
}

/** The label of one code in `language`, or REPLACEMENT for a code the kind does not have. */
export function termLabel<K extends TermKind>(language: Language, kind: K, code: TermKinds[K]): string {
  return cleanLine(formatTerm(kind, code, CATALOGS[supported(language)].terms).label);
}

export interface Translator {
  readonly language: Language;
  t<K extends MessageKey>(key: K, ...args: MessageArgs<K>): string;
  term<K extends TermKind>(kind: K, code: TermKinds[K]): string;
}

export function createTranslator(language: Language): Translator {
  const lang = supported(language);
  return {
    language: lang,
    t: (key, ...args) => translate(lang, key, ...args),
    term: (kind, code) => termLabel(lang, kind, code),
  };
}
