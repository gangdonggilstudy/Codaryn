/**
 * N-5, N-25 (a): the explained error the entry point writes to stderr. The renderer
 * (`HumanOutput.error`) writes what happened, the diagnostic, how to fix it and the doctor hint;
 * this adds the lock hint for `workspace_locked`, indented like the renderer's own lines, and only
 * when the text does not already hold it.
 */

import type { CliErrorOutput, HumanOutput, MessageCatalog } from "../contracts/index.js";

export function explainedErrorText(output: CliErrorOutput, human: { readonly output: HumanOutput; readonly messages: MessageCatalog }): string {
  let text = human.output.error(output);
  if (output.code === "workspace_locked") {
    const hint = human.messages.format("lock.remove_hint");
    if (!text.includes(hint)) text = `${text.endsWith("\n") || text.length === 0 ? text : `${text}\n`}  ${hint}\n`;
  }
  return text;
}
