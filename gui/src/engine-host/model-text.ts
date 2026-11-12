/**
 * U-32 (U-14 AXM-15, DR-47): text a model wrote (a plan's summary) as rows for people, drawn by the
 * engine's own quoteModelText (src/cli/human/format.ts), the one the CLI's `plan` draws the summary
 * with: key shapes hidden over the whole text first, runs of white space as one space, invisible
 * characters shown as "?" (R-52 R52-M1), control characters replaced, folded at the CLI's width
 * (MODEL_TEXT_COLUMNS, the width it takes when the output is not a terminal), at most `maxRows` rows
 * and a "… (+N)" row for the rest. `hide` runs first with every provider's key value now set, as the
 * CLI hides the current key before it quotes. The CLI's quote mark (MODEL_TEXT_PREFIX) is left off
 * each row: the window draws its own (.agent-words) under a label that says whose words they are.
 */

/** The engine's quoteModelText: `columns` null is the width for output that is not a terminal. */
export type QuoteModelText = (text: string, maxRows: number, columns: number | null) => string[];

/** A model's text as rows for people; no rows when nothing is left to show or it cannot be drawn. */
export type ModelText = (text: string) => readonly string[];

export function modelTextOf(quote: QuoteModelText, prefix: string, maxRows: number, hide: (text: string) => string): ModelText {
  return (text) => {
    try {
      return quote(hide(text), maxRows, null).map((row) => (prefix.length > 0 && row.startsWith(prefix) ? row.slice(prefix.length) : row.trim()));
    } catch {
      return [];
    }
  };
}
