/**
 * Key detection for task files, config files and `--goal` (S-6, S-8).
 * Iterative with a depth limit, so deep input cannot overflow the stack.
 * A reported location holds known schema field names and indexes only, never other text.
 */

import {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_KEY_FORMAT_PATTERN_SOURCE,
  API_KEY_ENVS,
  API_KEY_MASK_PATTERN_SOURCES,
  KEY_FIELD_NAMES,
  OPENAI_API_KEY_ENV,
  anthropicRefusalShapeIn,
  createKeyRefusalCheck,
  createKeyValueCheck,
  holdsRefusedKeyShape,
  withoutInvisibleCharacters,
} from "../../contracts/index.js";
import type { ApiKeyEnv } from "../../contracts/index.js";

/** Containers (objects and arrays) deeper than this are rejected as invalid input. */
export const MAX_KEY_SCAN_DEPTH = 64;

/** A current key shorter than this is not searched for, to avoid matching ordinary text. */
export const MIN_CURRENT_KEY_LENGTH = 16;

/**
 * SP-2 (design 4.2, 4.3): the key values a check or a cleaner looks for. One key (the first form,
 * the Anthropic key), several (every key variable Codaryn knows that is set, `knownKeyValues`), or
 * none.
 */
export type KnownKeys = string | null | readonly string[];

/** The given key values long enough to look for (MIN_CURRENT_KEY_LENGTH), each once. */
export function keyValuesOf(keys: KnownKeys): string[] {
  const list = keys === null ? [] : typeof keys === "string" ? [keys] : [...keys];
  return [...new Set(list.filter((key) => key.length >= MIN_CURRENT_KEY_LENGTH))];
}


/**
 * DR-32 (a): the key shapes hidden in output (API_KEY_MASK_PATTERN_SOURCES): the refusal shapes and
 * the loose `sk-` one. Hiding an ordinary name costs a word; letting a key through costs the key.
 */
export const KEY_MASK_SHAPE_SOURCE = API_KEY_MASK_PATTERN_SOURCES.map((source) => `(?:${source})`).join("|");

/** Field names of the task and config file schemas. Only these appear in a location as written. */
export const KNOWN_FIELD_NAMES: ReadonlySet<string> = new Set([
  "schemaVersion", "id", "goal", "workflow", "workspaceRoot", "model", "provider", "scriptPath",
  "maxOutputTokens", "policy", "commands", "executable", "argsPrefix", "allowExtraArgs", "network",
  "destructive", "restorePathTokens", "protectedPaths", "privacy", "secretEnv", "limits",
  "maxModelTurns", "maxToolCalls", "maxTotalTokens", "maxDurationMs", "maxRepairAttempts",
  "maxSameFailures", "verifiers", "kind", "args", "cwd", "timeoutMs", "expectExitCode", "rules",
  "type", "path", "text", "apiBaseUrl", "requestTimeoutMs", "maxRetries", "integrity", "paths",
]);

const KEY_NAMES: ReadonlySet<string> = new Set(KEY_FIELD_NAMES);
/** Letters, `_` and `-` only: no digits, so no key material fits the printed form (T-14). */
const PRINTABLE_KEY_FIELD = /^[A-Za-z_-]{1,40}$/;

function normalizedFieldName(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The contract rule (lowercase, keep a-z and 0-9, then compare; "apikey" anywhere matches),
 * after NFKC so that full-width and other compatibility forms fold to ASCII first.
 */
export function isKeyFieldName(name: string): boolean {
  const normalized = normalizedFieldName(name);
  return KEY_NAMES.has(normalized) || normalized.includes("apikey");
}

/**
 * Whether a key field name may appear in a location as written: it must be exactly one of the
 * key field names, spelled with letters, `_` and `-` only. "apiKey" and "API_KEY" are printed;
 * "apikeyHunter2" is not, because the extra part may be key material (T-14).
 */
function isPrintableKeyFieldName(name: string): boolean {
  // A key's environment variable name is a fixed constant, not key material (SP-2: every known one).
  if ((API_KEY_ENVS as readonly string[]).includes(name)) return true;
  return PRINTABLE_KEY_FIELD.test(name) && KEY_NAMES.has(normalizedFieldName(name));
}

/**
 * S-6, S-8 (DR-40): the contract's check (createKeyRefusalCheck): every given key value (SP-2:
 * every known key variable that is set, from MIN_CURRENT_KEY_LENGTH characters) and the refusal
 * shapes (DR-33, DR-36 (c), the glued real-format Anthropic key of DR-40 (b)), each on the text as
 * it is and without the key separators (DR-40 (a): a key split by a line break or an invisible
 * character), in time linear in the text's length (DR-40 (c)).
 */
function keyMatcher(currentKey: KnownKeys): (text: string) => boolean {
  return createKeyRefusalCheck(keyValuesOf(currentKey));
}

const ANTHROPIC_FORMAT = new RegExp(ANTHROPIC_KEY_FORMAT_PATTERN_SOURCE);

/** A key value set now, with the variable it came from (for the key_in_file message). */
export interface KnownKeyEntry {
  readonly keyEnv: ApiKeyEnv;
  readonly value: string;
}

/**
 * For the key_in_file message (the documentation owner's finding): the key variable of the
 * provider whose key was found in `text`. A registered value names its own variable (the
 * contract's value check: as written or split); otherwise a refusal shape: Anthropic's (its
 * refusal run and the glued real format, as written and without invisible characters, in linear
 * time) or else OpenAI's, the only other refusal shapes (API_KEY_PATTERN_SOURCES). Null when
 * neither is found, as for a key field. Called only after a refusal.
 */
export function keyOwnerIn(text: string, keys: readonly KnownKeyEntry[]): ApiKeyEnv | null {
  for (const key of keys) {
    if (key.value.length >= MIN_CURRENT_KEY_LENGTH && createKeyValueCheck([key.value])(text)) return key.keyEnv;
  }
  const views = [text, withoutInvisibleCharacters(text)];
  if (views.some((view) => anthropicRefusalShapeIn(view) || ANTHROPIC_FORMAT.test(view))) return ANTHROPIC_API_KEY_ENV;
  return holdsRefusedKeyShape(text) ? OPENAI_API_KEY_ENV : null;
}

/** The key_in_file hint: the owner's key variable, or every key variable when none is known. */
export function keyHintFor(owner: ApiKeyEnv | null): string {
  return owner === null
    ? `keys are read only from environment variables (${API_KEY_ENVS.join(", ")})`
    : `keys are read only from the ${owner} environment variable`;
}

/**
 * DR-40 (b) (review R-25 L-2): the largest task or config file the CLI reads, in UTF-8 bytes. A
 * larger one is refused before any check reads it (no legitimate file comes near it; the key
 * checks' time stays bounded). The contract's constant replaces it when one is issued.
 */
export const MAX_INPUT_FILE_BYTES = 1024 * 1024;

/** DR-40 (b): whether a task or config file's text is over MAX_INPUT_FILE_BYTES. */
export function inputFileTooLarge(text: string): boolean {
  return text.length > MAX_INPUT_FILE_BYTES || Buffer.byteLength(text, "utf8") > MAX_INPUT_FILE_BYTES;
}

/** DR-40 (b): the fixed message for such a file; nothing from the file is in it. */
export function inputFileTooLargeMessage(label: string): string {
  return `the ${label} is larger than ${MAX_INPUT_FILE_BYTES} bytes (1 MiB); nothing in it was used`;
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
export function findKeyInJson(value: unknown, currentKey: KnownKeys): KeyScanOutcome {
  const holdsKey = keyMatcher(currentKey);
  const segment = (name: string): string =>
    (KNOWN_FIELD_NAMES.has(name) || isPrintableKeyFieldName(name)) && !holdsKey(name)
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

/** Decodes JSON string escapes left to right, so an escaped backslash before "u" stays a backslash. */
function decodeJsonEscapes(text: string): string {
  const simple: { readonly [escape: string]: string } = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
  return text.replace(/\\(?:u([0-9a-fA-F]{4})|(["\\/bfnrt]))/g, (_match, hex: string | undefined, single: string | undefined) =>
    hex !== undefined ? String.fromCharCode(Number.parseInt(hex, 16)) : (simple[single as string] ?? ""),
  );
}

/**
 * S-6: the same value check on the file text before JSON.parse. It catches what parsing hides,
 * such as the first of two duplicate fields, also when that value is written with `\u` escapes
 * (T-14). It reports no location.
 */
export function rawTextHoldsKey(text: string, currentKey: KnownKeys): boolean {
  const holdsKey = keyMatcher(currentKey);
  return holdsKey(text) || holdsKey(decodeJsonEscapes(text));
}

/** S-8: `--goal` is sent and recorded as written, so it must not hold a key either. */
export function goalHoldsKey(goal: string, currentKey: KnownKeys): boolean {
  return keyMatcher(currentKey)(goal);
}
