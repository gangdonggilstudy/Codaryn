/**
 * Error model of the app layer (adapter-contract 5.8). An AppError is the CLI's CliErrorOutput
 * without its envelope; codes and exit codes are the CLI's own table, unchanged.
 */

import { CLI_ERROR_EXIT_CODES, cliErrorFacts } from "../contracts/index.js";
import type { CliErrorCode, CliErrorOutput } from "../contracts/index.js";
import type { AppError } from "./types.js";

export const INTERNAL_ERROR_MESSAGE = "the call stopped because of an internal error";

export function appError(code: CliErrorCode, message: string): AppError {
  return { code, message };
}

/**
 * Drops only the envelope (`schemaVersion`, `kind`, `exitCode`). Any other field the CLI adds to
 * its error output (such as the N-6 input diagnostic on the N-A branch) is kept as it is.
 */
export function fromCliError(output: CliErrorOutput): AppError {
  const { schemaVersion: _schemaVersion, kind: _kind, exitCode: _exitCode, ...error } = output;
  return error;
}

/** The exit code `codaryn` uses for this error (CLI_ERROR_EXIT_CODES). */
export function appErrorExitCode(error: AppError): number {
  return CLI_ERROR_EXIT_CODES[error.code];
}

/**
 * The CliErrorOutput `codaryn` prints for this error. U-55 (AXM-9): with the contract's facts,
 * `category` and `retryable` (cliErrorFacts of its code), after the error's own fields. An error
 * that already carries them (the CLI's own error output, which fromCliError keeps: model_list_failed
 * decides `retryable` by the listing's model error) keeps its own; `retryable` is left out only when
 * neither says (model_list_failed without the listing's model error: unknown, never false).
 */
export function toCliError(error: AppError): CliErrorOutput {
  const facts = cliErrorFacts(error.code);
  const category = error.category ?? facts.category;
  const retryable = error.retryable ?? facts.retryable;
  return { schemaVersion: 1, kind: "error", ...error, category, ...(retryable === undefined ? {} : { retryable }), exitCode: appErrorExitCode(error) };
}

/**
 * U-293 (the CLI migration's C-6a): the CliErrorOutput `codaryn run` prints for an error of a run's
 * start, in the CLI's own key order (cliError, src/app/prepare.ts: code, exitCode, message,
 * diagnostic, category, retryable, then a hint and its detail, withHint), so its JSON line stays as
 * it was before the run moved into the app layer. The exact inverse of fromCliError for every error the
 * CLI makes: fromCliError keeps the other keys in their order, and an object's rest keeps its symbol
 * key (the hint's detail, CLI_ERROR_HINT_DETAIL). An error the app made itself (no category) gets its
 * code's facts where cliError puts them. toCliError keeps its order (exitCode last) for the commands
 * already printed through it (changes).
 */
export function runErrorOutput(error: AppError): CliErrorOutput {
  const { code, message, diagnostic, category, retryable, ...after } = error as AppError & { readonly [key: PropertyKey]: unknown };
  const facts = category === undefined ? cliErrorFacts(code) : { category, ...(retryable === undefined ? {} : { retryable }) };
  return {
    schemaVersion: 1,
    kind: "error",
    code,
    exitCode: appErrorExitCode(error),
    message,
    ...(diagnostic === undefined ? {} : { diagnostic }),
    ...facts,
    ...after,
  } as CliErrorOutput;
}

export const INTERNAL_ERROR: AppError = appError("internal_error", INTERNAL_ERROR_MESSAGE);
