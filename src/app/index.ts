/**
 * Public surface of the app layer (docs/design/adapter-contract.md). Adapters import from here.
 */

export { createCodarynApp, runArguments } from "./app.js";
export type { AppHooks } from "./app.js";
export { copyEnvironment, createNodeAppEnvironment, loadVarsInto, lookupEnv, readVarsFileSync } from "./environment.js";
export { INTERNAL_ERROR, appError, appErrorExitCode, fromCliError, toCliError } from "./errors.js";
export { UNKNOWN_TOOL_NAME, UNSHOWN_CALL_ID, deliver, journalWithEvents, sanitizeRecord } from "./events.js";
export type {
  AppCallOutcome,
  AppEnvironment,
  AppError,
  ApplyHandle,
  ApplyPlanRequest,
  ApplyResultView,
  ChangedFileUnavailable,
  ChangedFileView,
  ChangesOutput,
  ChangesRequest,
  CodarynApp,
  ConfirmAnswer,
  ConfirmRequest,
  DoctorRequest,
  PlanView,
  ReportRequest,
  ReviewOutputView,
  ReviewRequest,
  RevertRequest,
  RunEvent,
  RunHandle,
  RunObserver,
  RunOutcome,
  StartOutcome,
  StartRunRequest,
} from "./types.js";
