/**
 * The narrow channel between the renderer (through the preload) and the main process
 * (docs/design/standalone-gui.md 6.4): the channel names and the checks the main process runs on
 * every argument and on what it passes back. Pure: no Node, Electron or DOM API.
 *
 * The preload repeats the channel names because a sandboxed preload cannot load local modules;
 * a unit test keeps the two lists equal.
 */

export { HANDLE_PATTERN, isHandle, isRunId, hostCodeOf, toStartFailure } from "./ipc/primitives.js";
export { parseDoctorArgs, parseIdArg, MAX_TREE_OFFSET, parseTreeArgs, parseRevealArgs, copyableValue, parseCopyArgs, MAX_COPY_PATH_CHARS, copyablePath, isNoArgs, DOCTOR_CHECK_STATUSES, DOCTOR_STATUSES, toDoctorView, doctorMessageIds, TREE_WIDTH_MIN, TREE_WIDTH_MAX, SCREEN_ID, parseSaveUiArgs, TREE_KINDS, MAX_FINAL_MESSAGE_CHARS, RUN_STATUSES, maskingOf } from "./ipc/core.js";
export type { CopyReply, RestartReply, DoctorCheckStatusView, DoctorStatusView, DoctorCheckView, DoctorView, UiMemoryView, InfoView, DoctorReply, OpenFolderReply, RecentView, RunFormView, OpenReply, TreeKind, TreeEntryView, TreeReply, FinalMessageView, PlanActionView, RunItemView, MaskingView, RunResultView, ConfirmationsView } from "./ipc/core.js";

export { PROVIDER_PATTERN, parseProviderArgs, parseEntryArgs, SETTINGS_FILE_SOURCES, toNarrowings, toSettingsView, toHostProposal, toWrittenReply, parseTokenArgs, toHostModelList, toSelectModelReply } from "./ipc/settings.js";
export type { ProfileView, SettingsView, SettingsPrivateDataView, ApiProviderView, SettingsRules, PolicyNarrowingView, SettingsReply, SettingsProposalReply, SettingsWrittenReply, HostModelEntry, ModelCurrentView, HostModelList, ModelEntryView, ModelsReply, SelectModelReply } from "./ipc/settings.js";

export { MAX_GOAL_CHARS, parseStartTaskArgs, parseStartRunArgs, toRunResultView, confirmationsOf, parseCheckPlanArgs, toPlanCheckReply } from "./ipc/run.js";
export type { RunEventsPayload, RunDonePayload, PlanCheckReply } from "./ipc/run.js";

export { TEXT_READ_ONLY_REASONS, TEXT_NOT_OPENED, MAX_TEXT_CHARS, toTextReply, textDigestOf, TEXT_PROBLEMS, TEXT_SAVE_REFUSALS, parseSaveTextArgs, parseTextDirtyArgs, toSaveOutcome } from "./ipc/text.js";
export type { TextReadOnlyReason, TextNotOpened, TextReply, TextProblem, TextSaveRefusal, SaveTextReply } from "./ipc/text.js";

export { parseRunEventsArgs, RUN_EVENTS_STATUSES, toRunEventsReply, parsePlanArgs, parseApplyArgs, parseReviewArgs, MAX_PLAN_SUMMARY_ROWS, planApprovable, toPlanView, CHANGE_STATES, revealableChange, MAX_CHANGE_TEXT_CHARS, MAX_CHANGES_TOTAL_CHARS, toChangesReply, toReviewReply } from "./ipc/plan.js";
export type { RunEventsReply, PlannedFileView, PlanView, PlanReply, ChangedFileItem, ChangesReply, ReviewReply } from "./ipc/plan.js";

export { toReportReply, toHostReportMarkdown } from "./ipc/report.js";
export type { ReportVerifierView, ReportView, ReportReply, SaveReportReply } from "./ipc/report.js";

export { parseWorkspaceArgs, parseRunArgs, parsePreviewArgs, REVERT_ACTIONS, PLAN_APPLY_STATES, toRunsReply, parseRetryArgs, toRevertView } from "./ipc/runs.js";
export type { PlanApplyView, RunListItem, RunsReply, RevertView, RevertReply } from "./ipc/runs.js";

export { toStateSummaryReply, toHostCleanupPreview, toCleanupResultReply, parseCleanupPreviewArgs } from "./ipc/cleanup-replies.js";
export type { StateSummaryReply, CleanupPreviewReply, CleanupResultReply } from "./ipc/cleanup-replies.js";

export { toCreateSettingsReply, toSuggestionsReply, parseCreateSettingsArgs } from "./ipc/setup.js";
export type { CreateSettingsReply, SuggestedCommandView, SuggestionsReply } from "./ipc/setup.js";

export const IPC_CHANNELS = {
  info: "codaryn:app:info",
  restartEngine: "codaryn:app:restartengine",
  copyText: "codaryn:app:copy",
  copyPath: "codaryn:workspace:copypath",
  revealConfig: "codaryn:settings:revealconfig",
  saveUi: "codaryn:app:saveui",
  runEvents: "codaryn:runs:events",
  checkPlan: "codaryn:plan:check",
  openText: "codaryn:workspace:opentext",
  saveText: "codaryn:workspace:savetext",
  textDirty: "codaryn:workspace:textdirty",
  openFolder: "codaryn:workspace:open",
  recent: "codaryn:workspace:recent",
  openRecent: "codaryn:workspace:openrecent",
  forgetRecent: "codaryn:workspace:forgetrecent",
  tree: "codaryn:workspace:tree",
  reveal: "codaryn:workspace:reveal",
  doctor: "codaryn:doctor:run",
  settings: "codaryn:settings:read",
  listModels: "codaryn:models:list",
  selectModel: "codaryn:models:select",
  startRun: "codaryn:run:start",
  startTaskRun: "codaryn:run:starttask",
  cancelRun: "codaryn:run:cancel",
  listRuns: "codaryn:runs:list",
  previewRevert: "codaryn:runs:previewrevert",
  revert: "codaryn:runs:revert",
  revertConsent: "codaryn:runs:revertconsent",
  plan: "codaryn:plan:read",
  applyPlan: "codaryn:plan:apply",
  review: "codaryn:review:record",
  changes: "codaryn:changes:read",
  report: "codaryn:report:read",
  proposeSettings: "codaryn:settings:propose",
  applySettings: "codaryn:settings:apply",
  stateSummary: "codaryn:state:summary",
  previewCleanup: "codaryn:cleanup:preview",
  applyCleanup: "codaryn:cleanup:apply",
  saveReport: "codaryn:report:save",
  createSettings: "codaryn:settings:create",
  settingsSuggestions: "codaryn:settings:suggestions",
} as const;

/**
 * Main → renderer: a workspace was opened from outside the window (the command line of a second
 * start); GU-3: a run's progress items, and its end.
 */
export const IPC_EVENTS = {
  workspaceOpened: "codaryn:event:workspaceopened",
  runEvents: "codaryn:event:runevents",
  runDone: "codaryn:event:rundone",
  engineState: "codaryn:event:enginestate",
  treeReset: "codaryn:event:treereset",
} as const;
