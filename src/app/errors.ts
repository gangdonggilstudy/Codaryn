/**
 * Error model of the app layer (adapter-contract 5.8). An AppError is the CLI's CliErrorOutput
 * without its envelope; codes and exit codes are the CLI's own table, unchanged.
 */

import { CLI_ERROR_EXIT_CODES } from "../contracts/index.js";
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

/** The CliErrorOutput `codaryn` prints for this error. */
export function toCliError(error: AppError): CliErrorOutput {
  return { schemaVersion: 1, kind: "error", ...error, exitCode: appErrorExitCode(error) };
}

export const INTERNAL_ERROR: AppError = appError("internal_error", INTERNAL_ERROR_MESSAGE);
