/**
 * Top-level guard for the process (S-6, H2-6). stdout must always carry exactly one JSON object.
 * An exception that escapes a command becomes `internal_error` (exit code 70). Its text and stack
 * are dropped, because they may hold paths, file contents or secret values.
 */

import type { CommandOutput } from "../contracts/index.js";
import { cliError } from "./run.js";

export const UNEXPECTED_ERROR_MESSAGE = "codaryn stopped because of an unexpected internal error";

/** What one command prints on stdout, and the process exit code. */
export interface CommandOutcome {
  readonly output: CommandOutput;
  readonly exitCode: number;
}

export async function runGuarded(command: () => Promise<CommandOutcome>): Promise<CommandOutcome> {
  try {
    return await command();
  } catch {
    return cliError("internal_error", UNEXPECTED_ERROR_MESSAGE);
  }
}
