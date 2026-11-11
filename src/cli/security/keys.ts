/**
 * Key detection for task files, config files and `--goal` (S-6, S-8).
 * Iterative with a depth limit, so deep input cannot overflow the stack.
 * A reported location holds known schema field names and indexes only, never other text.
 */

import { ANTHROPIC_KEY_PATTERN_SOURCE, KEY_FIELD_NAMES } from "../../contracts/index.js";

/** Containers (objects and arrays) deeper than this are rejected as invalid input. */
export const MAX_KEY_SCAN_DEPTH = 64;

/** A current key shorter than this is not searched for, to avoid matching ordinary text. */
export const MIN_CURRENT_KEY_LENGTH = 16;

/** Field names of the task and config file schemas. Only these appear in a location as written. */
export const KNOWN_FIELD_NAMES: ReadonlySet<string> = new Set([
  "schemaVersion", "id", "goal", "workflow", "workspaceRoot", "model", "provider", "scriptPath",
  "maxOutputTokens", "policy", "commands", "executable", "argsPrefix", "allowExtraArgs", "network",
  "destructive", "restorePathTokens", "protectedPaths", "privacy", "secretEnv", "limits",
  "maxModelTurns", "maxToolCalls", "maxTotalTokens", "maxDurationMs", "maxRepairAttempts",
  "maxSameFailures", "verifiers", "kind", "args", "cwd", "timeoutMs", "expectExitCode", "rules",
  "type", "path", "text", "apiBaseUrl", "requestTimeoutMs", "maxRetries",
]);

const KEY_NAMES: ReadonlySet<string> = new Set(KEY_FIELD_NAMES);
const PLAIN_ASCII_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/**
 * The contract rule (lowercase, keep a-z and 0-9, then compare; "apikey" anywhere matches),
 * after NFKC so that full-width and other compatibility forms fold to ASCII first.
 */
export function isKeyFieldName(name: string): boolean {
  const normalized = name.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
  return KEY_NAMES.has(normalized) || normalized.includes("apikey");
}

function keyMatcher(currentKey: string | null): (text: string) => boolean {
  const shape = new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE);
  const current = currentKey !== null && currentKey.length >= MIN_CURRENT_KEY_LENGTH ? currentKey : null;
  return (text) => shape.test(text) || (current !== null && text.includes(current));
}

export type KeyScanOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "key"; readonly location: string }
  | { readonly kind: "too_deep" };

/**
 * S-6: the first key field or key value in parsed JSON. Field names that hold a key, string
 * values with a key shape or the current key, and key-shaped field names all count.
 * Nesting deeper than MAX_KEY_SCAN_DEPTH containers is `too_deep`.
 */
export function findKeyInJson(value: unknown, currentKey: string | null): KeyScanOutcome {
  const holdsKey = keyMatcher(currentKey);
  const segment = (name: string): string =>
    (KNOWN_FIELD_NAMES.has(name) || (isKeyFieldName(name) && PLAIN_ASCII_NAME.test(name))) && !holdsKey(name)
      ? name
      : "<field>";
  const child = (where: string, name: string): string => (where === "" ? segment(name) : `${where}.${segment(name)}`);

  // Depth-first, in document order: the stack holds work items, pushed in reverse.
  const stack: { item: unknown; where: string; depth: number }[] = [{ item: value, where: "", depth: 0 }];
  while (stack.length > 0) {
    const { item, where, depth } = stack.pop() as { item: unknown; where: string; depth: number };
    if (typeof item === "string") {
      if (holdsKey(item)) return { kind: "key", location: where === "" ? "<root>" : where };
      continue;
    }
    if (typeof item !== "object" || item === null) continue;
    if (depth + 1 > MAX_KEY_SCAN_DEPTH) return { kind: "too_deep" };
    const next: { item: unknown; where: string; depth: number }[] = [];
    if (Array.isArray(item)) {
      item.forEach((entry, index) => next.push({ item: entry, where: `${where}[${index}]`, depth: depth + 1 }));
    } else {
      for (const [name, entry] of Object.entries(item)) {
        if (isKeyFieldName(name) || holdsKey(name)) return { kind: "key", location: child(where, name) };
        next.push({ item: entry, where: child(where, name), depth: depth + 1 });
      }
    }
    for (let index = next.length - 1; index >= 0; index -= 1) stack.push(next[index] as (typeof next)[number]);
  }
  return { kind: "none" };
}

/**
 * S-6: the same value check on the file text before JSON.parse. It catches what parsing hides,
 * such as the first of two duplicate fields. It reports no location.
 */
export function rawTextHoldsKey(text: string, currentKey: string | null): boolean {
  return keyMatcher(currentKey)(text);
}

/** S-8: `--goal` is sent and recorded as written, so it must not hold a key either. */
export function goalHoldsKey(goal: string, currentKey: string | null): boolean {
  return keyMatcher(currentKey)(goal);
}
