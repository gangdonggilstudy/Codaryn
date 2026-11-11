/**
 * Key detection for task and config files (C-1). Runs on the parsed JSON before any other check.
 * The reported location is made of field names and indexes only, never of values.
 */

import { ANTHROPIC_KEY_PATTERN_SOURCE, KEY_FIELD_NAMES } from "../contracts/index.js";

const KEY_NAMES: ReadonlySet<string> = new Set(KEY_FIELD_NAMES);
const KEY_VALUE = new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE);
/** A current key shorter than this is not searched for, to avoid matching ordinary text. */
const MIN_CURRENT_KEY_LENGTH = 16;
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]{1,40}$/;

export function isKeyFieldName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return KEY_NAMES.has(normalized) || normalized.includes("apikey");
}

/**
 * Returns where the first key field or key value is, such as `model.apiKey`, or `null`.
 * `currentKey` is the ANTHROPIC_API_KEY value when set: the file must not contain it either.
 */
export function findKeyInFile(value: unknown, currentKey: string | null): string | null {
  const searchKey = currentKey !== null && currentKey.length >= MIN_CURRENT_KEY_LENGTH ? currentKey : null;
  const holdsKey = (text: string): boolean => KEY_VALUE.test(text) || (searchKey !== null && text.includes(searchKey));
  const segment = (name: string): string => (SAFE_SEGMENT.test(name) && !holdsKey(name) ? name : "<field>");
  const join = (where: string, name: string): string => (where === "" ? segment(name) : `${where}.${segment(name)}`);

  const visit = (item: unknown, where: string): string | null => {
    if (typeof item === "string") return holdsKey(item) ? where || "<root>" : null;
    if (Array.isArray(item)) {
      for (const [index, entry] of item.entries()) {
        const found = visit(entry, `${where}[${index}]`);
        if (found !== null) return found;
      }
      return null;
    }
    if (typeof item === "object" && item !== null) {
      for (const [name, entry] of Object.entries(item)) {
        if (isKeyFieldName(name) || holdsKey(name)) return join(where, name);
        const found = visit(entry, join(where, name));
        if (found !== null) return found;
      }
    }
    return null;
  };
  return visit(value, "");
}
