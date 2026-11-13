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
export { MODEL_TEXT_MAX_ROWS, modelTextRows } from "./model-text.js";
export type { ModelTextOptions } from "./model-text.js";
export { MAX_WORKSPACE_DIR_ENTRIES, WORKSPACE_PAGE_SIZE, isWorkspaceDir, listWorkspaceDirIn, workspaceDirArguments } from "./workspace-dir.js";
export type { WorkspaceDirOptions, WorkspaceDirSource } from "./workspace-dir.js";
export { MAX_RUN_EVENTS_PAGE, MAX_RUN_EVENTS_PAGE_BYTES, RUN_EVENTS_PAGE_SIZE, RUN_EVENT_TYPES, listRunEventsIn, runEventsArguments } from "./run-events.js";
export type { RunEventsDeps, RunEventsSource } from "./run-events.js";
export { checkApplyArguments, checkApplyIn } from "./check-apply.js";
export type { ApplyCheckOperations, ApplyCheckSource } from "./check-apply.js";
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
  CheckApplyRequest,
  CodarynApp,
  ConfirmAnswer,
  ConfirmRequest,
  CreateSettingsRequest,
  DoctorRequest,
  ListModelsRequest,
  ApplyCleanupRequest,
  CleanupApplied,
  CleanupDoneOutcome,
  CleanupPreview,
  CleanupPreviewRequest,
  ListRunsRequest,
  ListRunEventsRequest,
  ListWorkspaceDirRequest,
  StateSummaryRequest,
  StateSummaryView,
  PlanCheck,
  PlanRequest,
  ReadSettingsRequest,
  ReportMarkdown,
  ReportRequest,
  ResolvedRun,
  ResolveRunRequest,
  ReviewRequest,
  RevertRequest,
  RunEvent,
  RunEventType,
  RunEventsPage,
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
  WorkflowPolicyNarrowing,
  StartOutcome,
  StartRunRequest,
  StoredRunRecord,
  RevertConsentRequest,
  TaskForm,
  UnsafeMoveConsentRequest,
  WorkspaceDirListing,
  WorkspaceEntry,
  WorkspaceEntryKind,
} from "./types.js";
