/**
 * U-42 (review R-59 I-1): text a model wrote (a plan's summary) as rows for an adapter's window,
 * drawn as the CLI draws it, so an adapter needs nothing of the CLI's own modules for it.
 *
 * - The rows are the CLI `plan` view's rows of the same text (src/cli/plan-commands.ts renderPlan):
 *   the key values given hidden first (`keys`, as the plan view hides every key value now set),
 *   then quoteModelText (src/cli/human/format.ts) at the width it takes for output that is not a
 *   terminal (MODEL_TEXT_COLUMNS): key shapes hidden over the whole text, runs of white space as one
 *   space, invisible characters shown as "?", control characters replaced, folded at a space.
 * - Without the CLI's quote mark (MODEL_TEXT_PREFIX): a window draws its own, under a label that
 *   says whose words they are. Its "… (+N)" row is given trimmed.
 * - At most `maxRows` rows of text (MODEL_TEXT_MAX_ROWS unless given), then one "… (+N)" row for
 *   the rest; so at most maxRows + 1 rows. No rows when nothing is left to show.
 *
 * The text should be masked already (as PlanOutput.summary is); this draws, it does not mask
 * registered secrets.
 */

import { MODEL_TEXT_PREFIX, quoteModelText } from "../cli/human/format.js";
import { FINAL_MESSAGE_MAX_LINES } from "../cli/human/output.js";
import { hideKeys } from "../cli/text-safety.js";

/** The rows of a model's text the CLI shows (its plan view and the end summary's last message). */
export const MODEL_TEXT_MAX_ROWS: number = FINAL_MESSAGE_MAX_LINES;

export interface ModelTextOptions {
  /** Rows of text before the "… (+N)" row; MODEL_TEXT_MAX_ROWS when left out or not a count. */
  readonly maxRows?: number;
  /** Key values to hide first, as the CLI hides the keys now set; none when left out. */
  readonly keys?: readonly string[];
}

export function modelTextRows(text: string, options: ModelTextOptions = {}): string[] {
  const { maxRows, keys } = options;
  const rows = maxRows !== undefined && Number.isSafeInteger(maxRows) && maxRows >= 0 ? maxRows : MODEL_TEXT_MAX_ROWS;
  return quoteModelText(hideKeys(text, keys ?? null), rows, null).map((row) =>
    row.startsWith(MODEL_TEXT_PREFIX) ? row.slice(MODEL_TEXT_PREFIX.length) : row.trim(),
  );
}
