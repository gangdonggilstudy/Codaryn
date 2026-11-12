/**
 * Public surface of the app layer (docs/design/adapter-contract.md). Adapters import from here.
 */

export { createCodarynApp, runArguments } from "./app.js";
export type { AppHooks } from "./app.js";
export { copyEnvironment, createNodeAppEnvironment, loadVarsInto, readVarsFileSync } from "./environment.js";
export { INTERNAL_ERROR, appError, appErrorExitCode, fromCliError, toCliError } from "./errors.js";
export { deliver, journalWithEvents } from "./events.js";
export type {
  AppCallOutcome,
  AppEnvironment,
  AppError,
  CodarynApp,
  ConfirmAnswer,
  ConfirmRequest,
  DoctorRequest,
  ReportRequest,
  RevertRequest,
  RunEvent,
  RunHandle,
  RunObserver,
  RunOutcome,
  StartOutcome,
  StartRunRequest,
} from "./types.js";
