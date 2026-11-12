/**
 * DR-47 (U-21, AXM-1): EngineResult.finalMessage from the masked text of the run's last final
 * reply. The gateway has masked the registered values already; this keeps line breaks (as LF) and
 * tabs, leaves out every other control and invisible character (so none can split a key or move the
 * cursor of a terminal), hides key shapes as the CLI's output does (API_KEY_MASK_PATTERN_SOURCES,
 * `[key]`), and cuts at MAX_FINAL_MESSAGE_CHARS code points without splitting a token or a marker.
 */

import { API_KEY_MASK_PATTERN_SOURCES, KEY_INVISIBLE_PATTERN_SOURCE, MAX_FINAL_MESSAGE_CHARS, PRIVACY_TOKEN_PATTERN_SOURCE } from "../contracts/index.js";
import type { MaskedText } from "../contracts/index.js";

/** What a hidden key shape becomes, as in the CLI's hideKeys. */
export const FINAL_MESSAGE_KEY_MARKER = "[key]";

const KEY_SHAPES = API_KEY_MASK_PATTERN_SOURCES.map((source) => `(?:${source})`).join("|");
/**
 * Control and invisible characters (Cc, Cf, the line and paragraph separators), the contract's
 * KEY_INVISIBLE_PATTERN_SOURCE; LF and TAB are kept. Built from a string: TypeScript 7 writes the
 * line separator escape in a regular expression literal out as the character itself, which ends
 * the line.
 */
const UNSEEN = new RegExp(KEY_INVISIBLE_PATTERN_SOURCE, "gu");
/** A token or a key marker, which a cut must not split. */
const WHOLE = new RegExp(`${PRIVACY_TOKEN_PATTERN_SOURCE}|${FINAL_MESSAGE_KEY_MARKER.replace(/[[\]]/g, "\\$&")}`, "g");

export function finalMessageOf(masked: MaskedText): { readonly text: MaskedText; readonly truncated: boolean } | null {
  const seen = masked.replace(/\r\n?/g, "\n").replace(UNSEEN, (char) => (char === "\n" || char === "\t" ? char : ""));
  const text = seen.replace(new RegExp(KEY_SHAPES, "g"), FINAL_MESSAGE_KEY_MARKER);
  if (text.trim() === "") return null;
  const points = Array.from(text);
  if (points.length <= MAX_FINAL_MESSAGE_CHARS) return { text: text as MaskedText, truncated: false };
  let cut = points.slice(0, MAX_FINAL_MESSAGE_CHARS).join("").length;
  for (const match of text.matchAll(WHOLE)) {
    if (match.index < cut && match.index + match[0].length > cut) cut = match.index;
  }
  return { text: text.slice(0, cut) as MaskedText, truncated: true };
}
