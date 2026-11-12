/**
 * Public surface of the app layer (docs/design/adapter-contract.md). Adapters import from here.
 */

export { PROBE_GOAL, createCodarynApp, runArguments, runRequestOf } from "./app.js";
export type { AppHooks } from "./app.js";
export { copyEnvironment, createNodeAppEnvironment, loadVarsInto, lookupEnv, readVarsFileSync } from "./environment.js";
export { INTERNAL_ERROR, appError, appErrorExitCode, fromCliError, toCliError } from "./errors.js";
export { CONNECTED_MODEL_PROVIDERS, modelsArguments } from "./models.js";
export { initArguments, suggestionsFor } from "./init.js";
export { changesOf, digestOf, wideningOf } from "./settings-change.js";
export { revertConsentOf, unsafeMoveConsentOf } from "./consent.js";
export { applyArguments, applyJournalWithEvents, taskFormArguments } from "./apply.js";
export { planArguments, reviewArguments } from "./plans.js";
export { profileWorkflowsOf } from "./settings.js";
export { UNKNOWN_TOOL_NAME, deliver, journalWithEvents, sanitizeRecord } from "./events.js";
export type {
  AppliedActionRecord,
  ApplyJournalEvent,
  ApplyJournalRecord,
  ApplyReason,
  ApplyJournalEntry,
  ApplyResult,
  ApprovalChannel,
  MaskedPlanAction,
  PlanItemProblem,
  PlanItemStartedEvent,
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
  ApplySettingsChangeRequest,
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
  ReportMarkdown,
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
  SettingsChangeProposal,
  SettingsChangeRequest,
  SettingsFieldChange,
  SettingsSuggestions,
  SettingsSuggestionsRequest,
  SettingsWidening,
  SettingsWritten,
  SettingsView,
  StartOutcome,
  StartRunRequest,
  RevertConsentRequest,
  TaskForm,
  UnsafeMoveConsentRequest,
} from "./types.js";
