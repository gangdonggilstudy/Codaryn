/** Shared samples for the i18n tests. All values are fake. */

import { DEFAULT_CONFIG_DISPLAY, MESSAGE_IDS, messageParams } from "../../../src/contracts/index.js";
import type { MessageCatalog, MessageId, MessageLanguage, MessageParamKind } from "../../../src/contracts/index.js";

export const LANGS: readonly MessageLanguage[] = ["ko", "en"];
export const IDS: readonly MessageId[] = MESSAGE_IDS;

export function specOf(id: MessageId): Readonly<Record<string, MessageParamKind>> {
  return messageParams(id);
}

/**
 * Two different valid values of a kind; the first is the default sample. `text` and `detail`
 * take only text the same catalog produced, so they are made with it.
 */
export function samples(kind: MessageParamKind, catalog: MessageCatalog): readonly [string | number, string | number] {
  switch (kind) {
    case "count":
      return [11, 12];
    case "code":
      return ["done", "command_not_allowed"];
    case "field":
      return ["policy.commands[2]", "limits.maxModelTurns"];
    case "runId":
      return ["20261112T010203Z-0123abcd", "20261112T010204Z-89abcdef"];
    case "path":
      return [DEFAULT_CONFIG_DISPLAY.windows, DEFAULT_CONFIG_DISPLAY.home];
    case "name":
      return ["read_file", "run_command"];
    case "command":
      return ["codaryn doctor", "codaryn revert --workspace <workspace> --run 20261112T010203Z-0123abcd"];
    case "text":
    case "detail":
      return [catalog.format("status.done"), catalog.format("status.failed")];
  }
}

/** Valid parameters for a message, with one parameter replaced if asked. */
export function paramsFor(
  catalog: MessageCatalog,
  id: MessageId,
  replace?: { readonly name: string; readonly value: unknown },
): Record<string, string | number> {
  const params: Record<string, unknown> = {};
  for (const [name, kind] of Object.entries(specOf(id))) params[name] = samples(kind, catalog)[0];
  if (replace !== undefined) params[replace.name] = replace.value;
  return params as Record<string, string | number>;
}

/** A fake value with the shape of an Anthropic key, built at run time so no source line has that shape. */
export const KEY_SHAPED = ["sk", "ant", "Q".repeat(24)].join("-");

/**
 * C0, C1, line and paragraph separators, bidirectional controls. Built from a string: the
 * compiler writes ` ` in a regular expression literal as the raw character, which ends the line.
 */
export const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u061c\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]", "u");
