/**
 * Top-level guard for the process (S-6, H2-6). stdout must always carry exactly one complete
 * output: one JSON object, or the text of `--help`, `--version`, `report` or `doctor`. DR-49
 * (U-23): at a terminal a JSON object may be left out instead (stdoutText); never a part of one.
 * An exception that escapes a command becomes `internal_error` (exit code 70). Its text and stack
 * are dropped, because they may hold paths, file contents or secret values.
 */

import { cliError } from "../app/prepare.js";
import type { CommandOutcome, JsonOutcome } from "../app/command-outcome.js";

// U-306 (C-7a): the outcome types are the app layer's (src/app/command-outcome.ts); these names stay (plan A).
export type { CommandOutcome, JsonOutcome } from "../app/command-outcome.js";

export const UNEXPECTED_ERROR_MESSAGE = "codaryn stopped because of an unexpected internal error";

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

/** DR-49 (U-23): what decides whether stdout carries a JSON outcome. main.ts gives the process's. */
export interface StdoutContext {
  /** The command's arguments (process.argv without node and the script). */
  readonly argv: readonly string[];
  /** Whether stdout is a terminal (process.stdout.isTTY). */
  readonly stdoutIsTerminal: boolean;
  /** U-45 (R-58 Q-1): whether stderr is a terminal (process.stderr.isTTY). */
  readonly stderrIsTerminal: boolean;
}

/**
 * DR-49 (U-23, UXM-17): at a terminal the person reads the human text on stderr (the end summary,
 * the explained error), so the JSON line after it is left out. U-45 (R-58 R58-L1, PM Q-1): only when
 * stdout and stderr are both a terminal; with stderr sent to a file the human text is not on the
 * screen, so the JSON line is. It is written as before with `--json`, when stdout is not a terminal
 * (a pipe or a file), when stderr is not, and with `--quiet` (no human text, so nothing else would
 * show). A text outcome is always written. Like `--quiet`, `--json` counts wherever it appears,
 * parsed or not (no option value starts with "--").
 */
export function jsonLineLeftOut(outcome: CommandOutcome, context: StdoutContext): boolean {
  return (
    "output" in outcome &&
    context.stdoutIsTerminal &&
    context.stderrIsTerminal &&
    !context.argv.includes("--json") &&
    !context.argv.includes("--quiet")
  );
}

/** The bytes for stdout under DR-49: renderOutcome's, or nothing when the JSON line is left out. */
export function stdoutText(outcome: CommandOutcome, context: StdoutContext): string {
  return jsonLineLeftOut(outcome, context) ? "" : renderOutcome(outcome);
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
