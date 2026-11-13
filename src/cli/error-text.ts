/**
 * N-5, N-25 (a): the explained error the entry point writes to stderr. The renderer
 * (`HumanOutput.error`) writes what happened, the diagnostic, how to fix it and the doctor hint;
 * this adds the lock hint for `workspace_locked`, indented like the renderer's own lines, and only
 * when the text does not already hold it.
 */

import type { CliErrorOutput, HumanOutput, MessageCatalog } from "../contracts/index.js";

/**
 * U-190 (AXM-21): the error as the renderer is given it; the JSON line keeps the output as it is.
 * With `config_missing` (no config file at all, so the quick form's settings were never given) a
 * setting the run needs is missing rather than invalid: an `invalid_value` diagnostic is shown as
 * `missing_field`, so the diagnostic line agrees with the hint's line ("There is no config file
 * yet"). Every other error is given as it is.
 */
function shownToPerson(output: CliErrorOutput): CliErrorOutput {
  const diagnostic = output.diagnostic;
  if (output.hint !== "config_missing" || diagnostic === undefined || diagnostic.code !== "invalid_value") return output;
  return { ...output, diagnostic: { ...diagnostic, code: "missing_field" } };
}

export function explainedErrorText(output: CliErrorOutput, human: { readonly output: HumanOutput; readonly messages: MessageCatalog }): string {
  let text = human.output.error(shownToPerson(output));
  if (output.code === "workspace_locked") {
    const hint = human.messages.format("lock.remove_hint");
    if (!text.includes(hint)) text = `${text.endsWith("\n") || text.length === 0 ? text : `${text}\n`}  ${hint}\n`;
  }
  return text;
}
