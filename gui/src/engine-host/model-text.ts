/**
 * U-32 (U-14 AXM-15, DR-47), U-48 (U-42, R-59 I-1): text a model wrote (a plan's summary) as rows
 * for people, drawn by the app layer's `modelTextRows` (src/app/model-text.ts): the rows the CLI's
 * `plan` draws for the same text, without the CLI's quote mark (the window draws its own,
 * .agent-words, under a label that says whose words they are). Key shapes hidden over the whole
 * text, runs of white space as one space, invisible characters shown as "?" (R-52 R52-M1), control
 * characters replaced, folded at the CLI's width for output that is not a terminal, at most
 * `maxRows` rows and a "… (+N)" row for the rest.
 *
 * `hide` runs first: every provider's key value now set hidden, as the CLI hides the current key
 * before it draws, and as everything else this host hands on is hidden (the host's own hiding, so
 * the rows are those it drew before U-48). The app layer's `keys` option is not used.
 */

/** The app layer's modelTextRows (src/app/index.ts). */
export type ModelTextRows = (text: string, options?: { readonly maxRows?: number }) => unknown;

/** A model's text as rows for people; no rows when nothing is left to show or it cannot be drawn. */
export type ModelText = (text: string) => readonly string[];

export function modelTextOf(rows: ModelTextRows, maxRows: number, hide: (text: string) => string): ModelText {
  return (text) => {
    try {
      const drawn = rows(hide(text), { maxRows });
      return Array.isArray(drawn) && drawn.every((row) => typeof row === "string") ? (drawn as string[]) : [];
    } catch {
      return [];
    }
  };
}
