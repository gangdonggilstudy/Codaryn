/**
 * Message parameters by kind (N-14, `MessageParamTypeByKind` in src/contracts/human.ts). The
 * types already limit what a caller can give; this is the run-time check behind them, for values
 * that were cast or came from JavaScript. A value outside its kind's closed form becomes
 * REPLACEMENT, never the value itself. Pure: reads nothing.
 *
 * - count: a non-negative safe integer, in decimal digits.
 * - seconds: a non-negative number with at most one decimal place, in decimal digits ("12", "4.2").
 * - status, reason, permission, denial, modelError, phase, provider, language: one of the
 *   contracts' codes.
 * - field: a SchemaFieldPath (`toSchemaFieldPath`). runId: a RunId (`toRunId`).
 * - text: text the same catalog produced (`ownText`).
 * - location, suggestedCommand, suggestedPath: one of the fixed display strings.
 */

import {
  ANTHROPIC_KEY_PATTERN_SOURCE,
  DEFAULT_CONFIG_DISPLAY,
  INIT_SUGGESTED_COMMANDS,
  INIT_SUGGESTED_PROTECTED_PATHS,
  INTEGRITY_PHASES,
  MESSAGE_LANGUAGES,
  MODEL_ERROR_KINDS,
  PERMISSION_KINDS,
  POLICY_DENIAL_CODES,
  RUN_REASONS,
  TERMINAL_RUN_STATUSES,
  TOOL_ERROR_CODES,
  toRunId,
  toSchemaFieldPath,
} from "../contracts/index.js";
import type { ConfigLocationDisplay, MessageParamKind, ModelProviderName } from "../contracts/index.js";

/** Shown in place of a value that does not fit its kind, and of a replaced character. */
export const REPLACEMENT = "?";
/** Shown in place of key-shaped text. */
export const HIDDEN_KEY = "[key]";

const KEY_PATTERN = new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE, "g");

const PROVIDERS = ["scripted", "anthropic"] as const satisfies readonly ModelProviderName[];
type MissingProvider = Exclude<ModelProviderName, (typeof PROVIDERS)[number]>;
const providersComplete: [MissingProvider] extends [never] ? true : false = true;
void providersComplete;

const LOCATIONS = [...Object.values(DEFAULT_CONFIG_DISPLAY), "--config", "CODARYN_CONFIG"] as const satisfies readonly ConfigLocationDisplay[];

type ClosedKind = Exclude<MessageParamKind, "count" | "seconds" | "field" | "runId" | "text">;

/** Largest number of seconds shown (about 31 years); larger values are not plausible durations. */
const MAX_SECONDS = 1_000_000_000;

/** The values each closed kind accepts. */
export const CLOSED_KIND_VALUES: { readonly [K in ClosedKind]: ReadonlySet<string> } = {
  status: new Set(TERMINAL_RUN_STATUSES),
  reason: new Set(RUN_REASONS),
  permission: new Set(PERMISSION_KINDS),
  denial: new Set([...POLICY_DENIAL_CODES, ...TOOL_ERROR_CODES]),
  modelError: new Set(MODEL_ERROR_KINDS),
  phase: new Set(INTEGRITY_PHASES),
  provider: new Set(PROVIDERS),
  location: new Set(LOCATIONS),
  suggestedCommand: new Set(INIT_SUGGESTED_COMMANDS),
  suggestedPath: new Set(INIT_SUGGESTED_PROTECTED_PATHS),
  language: new Set(MESSAGE_LANGUAGES),
};

/** C0 and C1 controls, line and paragraph separators, and bidirectional controls. */
function isUnsafeCodePoint(cp: number): boolean {
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return true;
  if (cp === 0x2028 || cp === 0x2029 || cp === 0x061c || cp === 0x200e || cp === 0x200f) return true;
  return (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}

/**
 * One line for a terminal. Key-shaped text is hidden first, and unsafe characters inside it do not
 * break it up (N-23 h, review R-2 L-5): the key search runs on the text without them, and the whole
 * stretch, unsafe characters included, becomes HIDDEN_KEY. Then every other unsafe character (line
 * breaks included) becomes REPLACEMENT. The same character rules as `src/cli/text-safety.ts`.
 */
export function cleanLine(text: string): string {
  const chars = Array.from(text);
  const unsafe = chars.map((char) => isUnsafeCodePoint(char.codePointAt(0) as number));
  // The safe characters, with the index of each in `chars` by its UTF-16 offset in `visible`.
  let visible = "";
  const indexAtOffset: number[] = [];
  chars.forEach((char, index) => {
    if (unsafe[index] === true) return;
    for (let unit = 0; unit < char.length; unit += 1) indexAtOffset.push(index);
    visible += char;
  });
  const hiddenFrom = new Map<number, number>();
  for (const match of visible.matchAll(KEY_PATTERN)) {
    const first = indexAtOffset[match.index] as number;
    const last = indexAtOffset[match.index + match[0].length - 1] as number;
    hiddenFrom.set(first, last);
  }
  let out = "";
  for (let index = 0; index < chars.length; index += 1) {
    const last = hiddenFrom.get(index);
    if (last !== undefined) {
      out += HIDDEN_KEY;
      index = last;
      continue;
    }
    out += unsafe[index] === true ? REPLACEMENT : (chars[index] as string);
  }
  return out;
}

/** Seconds with at most one decimal place, or REPLACEMENT. */
function formatSeconds(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_SECONDS) return REPLACEMENT;
  const tenths = Math.round(value * 10);
  if (Math.abs(value * 10 - tenths) > 1e-6) return REPLACEMENT;
  return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1);
}

/**
 * One parameter by its kind, as text for the template. `ownText` says whether a string is a
 * message this catalog produced (for `text`).
 */
export function formatParam(kind: MessageParamKind, value: unknown, ownText: (text: string) => boolean): string {
  switch (kind) {
    case "count":
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : REPLACEMENT;
    case "seconds":
      return formatSeconds(value);
    case "field":
      return typeof value === "string" && toSchemaFieldPath(value) !== null ? value : REPLACEMENT;
    case "runId":
      return typeof value === "string" && toRunId(value) !== null ? value : REPLACEMENT;
    case "text":
      return typeof value === "string" && ownText(value) ? value : REPLACEMENT;
    default:
      return typeof value === "string" && CLOSED_KIND_VALUES[kind].has(value) ? value : REPLACEMENT;
  }
}
