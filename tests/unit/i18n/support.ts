/** Shared samples for the i18n tests. All values are fake. */

import { DEFAULT_CONFIG_DISPLAY, MESSAGE_IDS, messageParams } from "../../../src/contracts/index.js";
import type { MessageCatalog, MessageId, MessageLanguage, MessageParamKind } from "../../../src/contracts/index.js";

export const LANGS: readonly MessageLanguage[] = ["ko", "en"];
export const IDS: readonly MessageId[] = MESSAGE_IDS;

export function specOf(id: MessageId): Readonly<Record<string, MessageParamKind>> {
  return messageParams(id);
}

/** `format` without the per-id types, for tests that pass wrong values on purpose. */
export function loose(catalog: MessageCatalog): (id: MessageId, params?: Readonly<Record<string, unknown>>) => string {
  return catalog.format as unknown as (id: MessageId, params?: Readonly<Record<string, unknown>>) => string;
}

/** Two different valid values of a kind; the first is the default sample. `text` is made with the same catalog. */
export function samples(kind: MessageParamKind, catalog: MessageCatalog): readonly [unknown, unknown] {
  switch (kind) {
    case "count":
      return [11, 12];
    case "status":
      return ["done", "failed"];
    case "reason":
      return ["verified", "model_error"];
    case "permission":
      return ["command", "path"];
    case "denial":
      return ["command_not_allowed", "protected_path"];
    case "modelError":
      return ["auth_failed", "timeout"];
    case "phase":
      return ["run_start", "after_verify"];
    case "provider":
      return ["scripted", "anthropic"];
    case "field":
      return ["policy.commands[2]", "limits.maxModelTurns"];
    case "runId":
      return ["20261112T010203Z-0123abcd", "20261112T010204Z-89abcdef"];
    case "text":
      return [catalog.format("status.done"), catalog.format("status.failed")];
    case "location":
      return [DEFAULT_CONFIG_DISPLAY.windows, "--config"];
    case "suggestedCommand":
      return ["npm test", "npm run build"];
    case "suggestedPath":
      return ["tests", "package.json"];
  }
}

/** Valid parameters for a message, with one parameter replaced if asked. */
export function paramsFor(
  catalog: MessageCatalog,
  id: MessageId,
  replace?: { readonly name: string; readonly value: unknown },
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [name, kind] of Object.entries(specOf(id))) params[name] = samples(kind, catalog)[0];
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
