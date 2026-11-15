/**
 * DR-47 (U-21, AXM-1): EngineResult.finalMessage from the masked text of the run's last final
 * reply. R-52 (R52-M1, R52-M2): the contract's safeModelText makes it safe in the one right order:
 * control and invisible characters left out first (LF and TAB kept), then masked again by the run's
 * gateway (so a registered value they split is found whole), then key shapes hidden also across LF
 * and TAB. Then it is cut at MAX_FINAL_MESSAGE_CHARS code points without splitting a token or a
 * marker.
 */

import { HIDDEN_KEY_MARKER, MAX_FINAL_MESSAGE_CHARS, PRIVACY_TOKEN_PATTERN_SOURCE, safeModelText } from "../contracts/index.js";
import type { MaskedText, MaskOutcome } from "../contracts/index.js";

/** What a hidden key shape becomes (the contract's HIDDEN_KEY_MARKER, as in the CLI's hideKeys). */
export const FINAL_MESSAGE_KEY_MARKER = HIDDEN_KEY_MARKER;

/** A token or a key marker, which a cut must not split. */
const WHOLE = new RegExp(`${PRIVACY_TOKEN_PATTERN_SOURCE}|${HIDDEN_KEY_MARKER.replace(/[[\]]/g, "\\$&")}`, "g");

/**
 * `masked` is the recorded text of the reply; `mask` is the run's gateway. Null when there is
 * nothing to show, or when masking fails (fail closed).
 */
export function finalMessageOf(masked: MaskedText, mask: (text: string) => MaskOutcome): { readonly text: MaskedText; readonly truncated: boolean } | null {
  const text = safeModelText(masked, mask);
  if (text === null || text.trim() === "") return null;
  const points = Array.from(text);
  if (points.length <= MAX_FINAL_MESSAGE_CHARS) return { text: text as MaskedText, truncated: false };
  let cut = points.slice(0, MAX_FINAL_MESSAGE_CHARS).join("").length;
  for (const match of text.matchAll(WHOLE)) {
    if (match.index < cut && match.index + match[0].length > cut) cut = match.index;
  }
  return { text: text.slice(0, cut) as MaskedText, truncated: true };
}
