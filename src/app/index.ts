/**
 * Public surface of the app layer (docs/design/adapter-contract.md). Adapters import from here.
 */

export { PROBE_GOAL, createCodarynApp, runArguments, runRequestOf } from "./app.js";
export type { AppHooks } from "./app.js";
export { copyEnvironment, createNodeAppEnvironment, loadVarsInto, lookupEnv, readVarsFileSync } from "./environment.js";
export { INTERNAL_ERROR, appError, appErrorExitCode, fromCliError, toCliError } from "./errors.js";
export { CONNECTED_MODEL_PROVIDERS, modelsArguments } from "./models.js";
export { initArguments, suggestionsFor } from "./init.js";
export { UNKNOWN_TOOL_NAME, deliver, journalWithEvents, sanitizeRecord } from "./events.js";
export type {
  AppliedActionRecord,
  ApplyJournalEvent,
  ApplyJournalRecord,
  ApplyReason,
  ApplyResult,
  ApprovalChannel,
  MaskedPlanAction,
  PlanItemProblem,
  PlanOutput,
  PlanStatus,
  ReviewOutput,
  ReviewVerdict,
} from "./general-tasks.js";
export type {
  AppCallOutcome,
  AppEnvironment,
  AppError,
  ApplyEvent,
  ApplyHandle,
  ApplyObserver,
  ApplyPlanRequest,
  ChangedFileUnavailable,
  ChangedFileView,
  ChangesOutput,
  ChangesRequest,
  CodarynApp,
  ConfirmAnswer,
  ConfirmRequest,
  CreateSettingsRequest,
  DoctorRequest,
  ListModelsRequest,
  ListRunsRequest,
  PlanRequest,
  ReadSettingsRequest,
  ReportRequest,
  ResolvedRun,
  ResolveRunRequest,
  ReviewRequest,
  RevertRequest,
  RunEvent,
  RunHandle,
  RunObserver,
  RunOutcome,
  SelectModelRequest,
  SettingsSuggestions,
  SettingsSuggestionsRequest,
  SettingsView,
  StartOutcome,
  StartRunRequest,
  TaskForm,
} from "./types.js";
