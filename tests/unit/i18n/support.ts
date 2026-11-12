/** Shared sample values for the i18n tests. */

import { EN_TERMS } from "../../../src/i18n/en.js";
import { MESSAGE_PARAMS, TERM_KINDS } from "../../../src/i18n/index.js";
import type { Language, MessageKey, ParamKind, TermKind } from "../../../src/i18n/index.js";

export const LANGS: readonly Language[] = ["ko", "en"];

export const KEYS = Object.keys(MESSAGE_PARAMS) as MessageKey[];

export function specOf(key: MessageKey): Readonly<Record<string, ParamKind>> {
  return MESSAGE_PARAMS[key] as Readonly<Record<string, ParamKind>>;
}

export function isTermKind(kind: ParamKind): kind is TermKind {
  return (TERM_KINDS as readonly string[]).includes(kind);
}

/** Every code of a term kind, in table order. */
export function codesOf(kind: TermKind): string[] {
  return Object.keys(EN_TERMS[kind]);
}

/** Two different valid values of a kind: the first is the default sample. */
export function samples(kind: ParamKind): readonly [unknown, unknown] {
  if (isTermKind(kind)) {
    const [a, b] = codesOf(kind);
    return [a, b ?? a];
  }
  switch (kind) {
    case "count":
      return [11, 12];
    case "durationMs":
      return [78, 4200];
    case "field":
      return ["policy.commands[2]", "limits.maxModelTurns"];
    case "id":
      return ["run-a1", "run-b2"];
    case "recordedPath":
      return ["docs/INSTALL.md", "notes/README.md"];
  }
}

/** Valid parameters for a message, with one parameter replaced if asked. */
export function paramsFor(key: MessageKey, replace?: { readonly name: string; readonly value: unknown }): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [name, kind] of Object.entries(specOf(key))) params[name] = samples(kind)[0];
  if (replace !== undefined) params[replace.name] = replace.value;
  return params;
}

/** A fake value with the shape of an Anthropic key, built at run time so no source line has that shape. */
export const KEY_SHAPED = ["sk", "ant", "Q".repeat(24)].join("-");

/**
 * C0, C1, line and paragraph separators, bidirectional controls. Built from a string: the
 * compiler writes ` ` in a regular expression literal as the raw character, which ends the line.
 */
export const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u061c\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]", "u");
