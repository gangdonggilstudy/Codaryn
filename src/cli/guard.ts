/**
 * Top-level guard for the process (S-6, H2-6). stdout must always carry exactly one complete
 * output: one JSON object, or the text of `--help`, `--version`, `report` or `doctor`.
 * An exception that escapes a command becomes `internal_error` (exit code 70). Its text and stack
 * are dropped, because they may hold paths, file contents or secret values.
 */

import type { CommandOutput } from "../contracts/index.js";
import { cliError } from "./run.js";

export const UNEXPECTED_ERROR_MESSAGE = "codaryn stopped because of an unexpected internal error";

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

/**
 * N-19: one JSON line in ASCII only. Every character above U+007F is written as \uXXXX (an
 * astral character as its surrogate pair), which JSON reads back as the same value. A console
 * that decodes stdout with a legacy code page (Windows PowerShell 5.1) cannot garble it.
 */
export function jsonLine(value: unknown): string {
  const text = JSON.stringify(value).replace(/[\u0080-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `${text}\n`;
}

/** The exact bytes for stdout. */
export function renderOutcome(outcome: CommandOutcome): string {
  if ("output" in outcome) return jsonLine(outcome.output);
  return outcome.text.endsWith("\n") ? outcome.text : `${outcome.text}\n`;
}

/** For commands that print JSON only. */
export async function runGuarded(command: () => Promise<JsonOutcome>): Promise<JsonOutcome> {
  try {
    return await command();
  } catch {
    return cliError("internal_error", UNEXPECTED_ERROR_MESSAGE);
  }
}

/** The process entry point's guard: any command, JSON or text. */
export async function runGuardedCommand(command: () => Promise<CommandOutcome>): Promise<CommandOutcome> {
  try {
    return await command();
  } catch {
    return cliError("internal_error", UNEXPECTED_ERROR_MESSAGE);
  }
}
