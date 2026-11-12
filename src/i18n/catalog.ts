/**
 * `createMessageCatalog` (CreateMessageCatalog, src/contracts/human.ts): one language's fixed
 * texts. `format` checks the id and the parameter names (a missing, extra or unknown one is a
 * programming error and throws, without any value in the error), turns each value into text by
 * its kind (params.ts), substitutes `{name}` once, and returns one clean line.
 */

import { messageParams } from "../contracts/index.js";
import type { CreateMessageCatalog, MessageCatalog, MessageId, MessageLanguage, MessageParams } from "../contracts/index.js";
import { EN_MESSAGES } from "./en.js";
import { KO_MESSAGES } from "./ko.js";
import { DEFAULT_MESSAGE_LANGUAGE, parseMessageLanguage } from "./language.js";
import { cleanLine, formatParam, REPLACEMENT } from "./params.js";

/** One language's text for every MessageId. A parameter is written `{name}`. */
export type MessageTexts = { readonly [Id in MessageId]: string };

export const MESSAGE_TEXTS: { readonly [L in MessageLanguage]: MessageTexts } = { ko: KO_MESSAGES, en: EN_MESSAGES };

/** `{name}` in a template. */
export const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/** How many of its own recent outputs a catalog remembers for `text` and `detail` parameters. */
export const OWN_TEXT_MEMORY = 512;

export class MessageFormatError extends Error {
  override readonly name = "MessageFormatError";
}

export const createMessageCatalog: CreateMessageCatalog = (language: MessageLanguage): MessageCatalog => {
  const lang = parseMessageLanguage(language) ?? DEFAULT_MESSAGE_LANGUAGE;
  const texts = MESSAGE_TEXTS[lang];
  const produced = new Set<string>();
  const ownText = (text: string): boolean => produced.has(text);
  const remember = (text: string): void => {
    produced.delete(text);
    produced.add(text);
    if (produced.size > OWN_TEXT_MEMORY) produced.delete(produced.values().next().value as string);
  };

  return {
    language: lang,
    format(id: MessageId, params?: MessageParams): string {
      if (typeof id !== "string" || !Object.hasOwn(texts, id)) throw new MessageFormatError("unknown message id");
      const spec = messageParams(id);
      const given: Readonly<Record<string, unknown>> = params ?? {};
      for (const name of Object.keys(given)) {
        if (!Object.hasOwn(spec, name)) throw new MessageFormatError(`message ${id}: unexpected parameter`);
      }
      const values: Record<string, string> = {};
      for (const [name, kind] of Object.entries(spec)) {
        if (!Object.hasOwn(given, name)) throw new MessageFormatError(`message ${id}: missing parameter ${name}`);
        values[name] = formatParam(kind, given[name], lang, ownText);
      }
      const line = cleanLine(texts[id].replace(PLACEHOLDER, (_whole, name: string) => values[name] ?? REPLACEMENT));
      remember(line);
      return line;
    },
  };
};
