/**
 * U-306 (CLI migration C-7a): what one command prints, the app layer's type now, so the plan view's and
 * review's rules (plan-view.ts) and the app's calls need nothing of src/cli for it. As it was in
 * src/cli/guard.ts, which re-exports both names (plan A).
 */

import type { CommandOutput } from "../contracts/index.js";

/** A command outcome printed as one JSON line. */
export interface JsonOutcome {
  readonly output: CommandOutput;
  readonly exitCode: number;
}

/**
 * What one command prints on stdout, and the process exit code. `output` is printed as one JSON
 * line; `text` is printed as it is, ending with a line feed.
 */
export type CommandOutcome = JsonOutcome | { readonly text: string; readonly exitCode: number };
