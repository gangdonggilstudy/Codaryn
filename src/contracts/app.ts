/**
 * Adapter contract of the app layer (docs/design/adapter-contract.md, sections 4 and 5, with the
 * decisions DR-1 to DR-4, DR-7, DR-10, DR-12, DR-14, DR-15 and DR-17).
 *
 * U-254 (the CLI migration, DR-65, step C-1 = migration step 1a): moved here unchanged from
 * src/app/types.ts, where it waited for this place, with the one type of src/app/general-tasks.ts
 * (ApplyReason); plan, apply and review use the G-A contract's own types (DR-17). Only types: no
 * behaviour, no constants. Like every contract module it imports neither the app layer nor the CLI.
 * src/app/types.ts passes every name on, so the app layer's names (src/app/index.ts, the GUI's) are
 * as before.
 *
 * Not in the contracts' index (src/contracts/index.ts): two names mean other shapes there. The app
 * layer's ListRunsRequest and RevertRequest take a workspace as typed and a run reference; the CLI's
 * (commands.ts, changes.ts) take a resolved workspace root. Import this module by its path.
 *
 * IR-26 step 3 (A0-A3): the common types are in app-core.ts and the settings, file view and plan
 * lifecycle types in app-settings.ts, app-files.ts and app-plans.ts; this module passes them on.
 */

import type { CleanupConfirmation, CleanupOutput, CleanupPlan, CleanupSelection, CleanupStatus, StateSummary } from "./cleanup.js";
import type { DoctorOutput, InitOutput, ModelsOutput, ReportOutput, RunsOutput } from "./commands.js";
import type { DefaultConfigDisplay } from "./config.js";
import type { EngineResult, RevertOutput } from "./engine.js";
import type { MessageLanguage } from "./human.js";
import type { JournalEventType, JournalRecord } from "./journal.js";
import type { AnyPlanOutput, ApplyJournalEventType } from "./plan.js";
import type { ConfirmAnswer, ConfirmRequest } from "./policy.js";
import type { MaskedText } from "./text.js";
import type { PolicyNarrowing, ReviewOutput } from "./workflow.js";
import type { AppError, RunEvent, AppCallOutcome, TaskForm } from "./app-core.js";
import type { CreateSettingsRequest, SettingsSuggestionsRequest, SettingsSuggestions, SettingsChangeRequest, ApplySettingsChangeRequest, SettingsChangeProposal, SettingsWritten, ReadSettingsRequest, SettingsView, ListModelsRequest, SelectModelRequest } from "./app-settings.js";
import type { ChangesRequest, ChangesOptions, ChangesOutput, ListWorkspaceDirRequest, WorkspaceDirListing, ReadWorkspaceTextRequest, WorkspaceText, WriteWorkspaceTextRequest, WorkspaceTextWritten } from "./app-files.js";
import type { CheckApplyRequest, PlanCheck, PlanRequest, ApplyPlanRequest, ApplyObserver, ApplyHandle, ReviewRequest } from "./app-plans.js";

export type { AppEnvironment, AppError, RunEvent, AppCallOutcome, TaskForm, RunFacts } from "./app-core.js";
export type { CreateSettingsRequest, SettingsSuggestionsRequest, SettingsSuggestions, SettingsChangeRequest, ApplySettingsChangeRequest, SettingsFieldChange, SettingsWidening, SettingsChangeProposal, WorkflowPolicyNarrowing, SettingsWritten, ReadSettingsRequest, SettingsView, SettingsPrivateData, ListModelsRequest, SelectModelRequest } from "./app-settings.js";

export type { ChangesRequest, ChangesOptions, ChangedFileUnavailable, ChangedFileView, ChangesOutput, ListWorkspaceDirRequest, WorkspaceEntryKind, WorkspaceEntry, WorkspaceDirListing, ReadWorkspaceTextRequest, WorkspaceTextLineEnding, WorkspaceTextReadOnlyReason, WorkspaceText, WriteWorkspaceTextRequest, WorkspaceTextProblem, WorkspaceTextWritten } from "./app-files.js";
export type { CheckApplyRequest, PlanCheck, PlanRequest, UnsafeMoveConsentRequest, ApplyPlanRequest, ApplyEvent, ApplyObserver, ApplyLifeHooks, ApplyFacts, ApplyApprovalView, ApplyRunEnd, ApplyOutcome, ApplyHandle, ReviewRequest, ApplyReason } from "./app-plans.js";

/** The settings of one run, as `codaryn run` takes them. */
export interface StartRunRequest {
  readonly input:
    | { readonly kind: "task"; readonly taskPath: string }
    | { readonly kind: "quick"; readonly workspace: string; readonly goal: string };
  /** `--config`. Null: CODARYN_CONFIG, then the default location (N-1). */
  readonly configPath: string | null;
  /** `--vars-file` (C-2). */
  readonly varsFile: string | null;
  /** `--profile` (N-8). */
  readonly profile: string | null;
  /**
   * DR-2: the task type definition to use (`--workflow`, GT 4.2), passed to the CLI's quick form. A
   * task file names its own `workflowRef`; giving both is the CLI's `invalid_arguments` (R-14 I-4).
   */
  readonly workflowRef: string | null;
  /** `--cancel-file` (P-2). Must lie outside the workspace (T-12). */
  readonly cancelFile: string | null;
}
// There is no field for a key, an API address, or a policy, limit or protected path override
// (C-1, C-5, M-9).

/**
 * DR-1, DR-3: questions during a run are permission questions only. Plan approval is a step
 * between runs (`plan`, `applyPlan`). Only the user's settings and profiles can make a permission
 * ask (never a task file, M-9); after an answer the effective arguments are judged again.
 * U-108: the contract's types (src/contracts/policy.ts, U-74): the request has fixed fields, the
 * masked executable made safe for a screen (U-106) and the number of arguments, never the
 * arguments; the answer is allow_once, deny or dismissed (closed without answering, recorded as
 * deny by `default`).
 */
export type { ConfirmAnswer, ConfirmRequest };

export interface RunObserver {
  /** Called synchronously for each event. Exceptions are ignored and never change the run. */
  onEvent?(event: RunEvent): void;
  /**
   * U-108 (B-4, DR-3): asked for each permission question of the run, after the
   * `confirmation_requested` event and before `confirmation_answered` (permission.ts). `signal`
   * aborts when the run is cancelled or its time is up; the run stops waiting then. Absent, a
   * throw, or an answer that is not one of the decisions (read once, as an own data property) is
   * `dismissed`: recorded as deny by `default`, never as the person's (DR-10).
   */
  confirm?(request: ConfirmRequest, signal: AbortSignal): Promise<ConfirmAnswer>;
  /**
   * C-6a (PM, after U-289's secret-in-closed-word case): each record of the run as the journal
   * stored it, in `seq` order, synchronously right after it was stored and before onEvent gets its
   * copy. It carries the engine's masking only, the same as the run's journal.jsonl holds:
   * - its free text (paths, outputs, messages) is masked;
   * - its closed words (for example `type`, `code`, `permission`, `decision`, `by`, `kind`, a
   *   check's `phase`, the provider) are as written, not masked again;
   * - model-given tool names and call ids are as stored (onEvent's L-1 reading does not apply).
   * For an adapter that draws people's lines in this process from those closed words, as the CLI
   * draws its progress lines now. It masks each drawn line with RunHandle.mask before it shows it.
   * onEvent's copy would not do: a registered value that matched a closed word changes it, and with
   * it the line drawn. A host that hands anything of a run to a window or over IPC uses onEvent
   * (DR-15) and never this; the GUI's engine host does not (u292 test). Exceptions are ignored and
   * never change the run.
   */
  onStoredRecord?(record: JournalRecord): void;
}

/**
 * C-6a (the CLI migration, PM): the end summary's counts of one run, counted by the app layer from
 * each record as the engine appended it: the CLI's RunNotes counting (src/cli/run.ts `watched` and
 * notePrivateData), moved letter for letter, never from the events, which mask every string again
 * (DR-15) and so could miss a closed word that a registered value matched. Each field has the
 * meaning, the rule and the "absent" of RunSummaryContext's field of the same name
 * (contracts/human.ts); an adapter builds its end summary from them and its own facts (how the
 * workspace was given, the profile, whether it could ask). Counts and closed words only: no path,
 * no value, no rule. Not in the result, result.json or any record, and `codaryn run --json` prints
 * the result alone (u290 test).
 */
export interface RunTally {
  /** N-17: `tool_decision` records with `allowed: false`. */
  readonly deniedToolCalls: number;
  /** N-23: those whose permission is `command`. */
  readonly deniedCommandCalls: number;
  /** U-18 (AXM-4): calls allowed and then failed, by the failed-call rule (failed-calls.ts). */
  readonly failedToolCalls: number;
  /** U-195, U-198: denials with code `path_not_writable` in a run that carries out no plan. Absent while there is none. */
  readonly deniedNotWritable?: number;
  /** U-195, U-198: such denials in a run that carries out a run plan (step C-6b's apply). Absent while there is none. */
  readonly deniedNotPlanned?: number;
  /** U-210: denials with code `unreadable_path`. Absent while there is none. */
  readonly deniedUnreadable?: number;
  /** U-110: `confirmation_answered` records with `deny`, by who decided. Absent while there is none. */
  readonly confirmationDenied?: { readonly user: number; readonly default: number; readonly cancelled: number };
  /** U-148: `run_started.policyNarrowings` as recorded. Absent when it has none. */
  readonly policyNarrowings?: readonly PolicyNarrowing[];
  /** U-210, R-108 L-2: query_table results that hid groups or values, and the largest k they applied. Absent while there is none. */
  readonly hiddenGroups?: { readonly results: number; readonly minGroupSize: number };
}

export type RunOutcome =
  | {
      readonly ok: true;
      readonly result: EngineResult;
      /**
       * U-193 (after U-176): the run's workspace lock could not be released at its end (the release
       * threw after its retries, or answered false). The result is the run's as written to
       * result.json; nothing in it changes. The lock is held while this process lives (the app's
       * engine runs in it), so a later start here is workspace_locked until the app closes; a run
       * of another process then finds it stale. Absent: released. Message: lock.release_failed.
       */
      readonly lockLeft?: true;
      /**
       * C-6a: the run's end summary counts (RunTally), beside the result, never in it. Given by the
       * app's own run lifecycle (the migration's next step); absent until then, when the contract
       * makes it required.
       */
      readonly tally?: RunTally;
      /**
       * C-6a, Y-4: the run ended as model_error after the provider answered 404 for the model; the
       * result's notices then hold the English hint. The adapter says its own line before its end
       * summary (the CLI: progress.model_not_found, in the chosen language). Absent otherwise.
       */
      readonly modelNotFound?: true;
    }
  /** An internal error after the start (`internal_error`). The lock is released. There is no tally: no end summary is written. */
  | { readonly ok: false; readonly error: AppError };

/** C-6a, C-7b: the handle's runId, configLanguage, defaultConfig and mask mean what RunFacts' fields of the same names mean. */
export interface RunHandle {
  /** Known before the first event is delivered and before the engine starts. */
  readonly runId: string;
  /** Real path of the workspace root, as the run's assembly resolved it. */
  readonly workspaceRoot: string;
  /**
   * C-6a, N-4: the config's `language`, known before the first event, for the adapter's renderer and
   * its questions; null when the config sets none (the adapter then picks as it does without one).
   * Given by the app's own run lifecycle (the migration's next step); absent until then, when the
   * contract makes it required.
   */
  readonly configLanguage?: MessageLanguage | null;
  /**
   * C-6a, N-1: the fixed display form of the default config location (DEFAULT_CONFIG_DISPLAY, N-14:
   * no variable expanded, no user name) when the run's config came from it; null otherwise. The app
   * still puts its English notice in the result at the end; the CLI says its own line right after
   * `run_started`. Absent until the app's own run lifecycle gives it, as configLanguage.
   */
  readonly defaultConfig?: DefaultConfigDisplay | null;
  /**
   * C-6a: the run's own masking (its privacy gateway, with the values the run registered, DR-17), for
   * the text an adapter shows people besides the events: the CLI's progress lines, its default
   * config and Y-4 lines, its end summary and DR-51's shown workspace, which the CLI masks so now.
   * Before, during and after the run. Null when the text cannot be masked: write nothing then.
   * Never for what goes to a model or into a record. It gives the masked form of the text passed in
   * only, never a value; an adapter could test a guess with it, but it gave the settings the values
   * come from. A window could not: an engine host never hands it to a window or over IPC. Absent
   * until the app's own run lifecycle gives it, as configLanguage.
   */
  readonly mask?: (text: string) => MaskedText | null;
  /** Idempotent. After the run ended it does nothing. */
  cancel(): void;
  /** Never rejects. Resolves after result.json was written and the workspace lock released. */
  readonly done: Promise<RunOutcome>;
}

export type StartOutcome =
  | { readonly ok: true; readonly handle: RunHandle }
  | {
      readonly ok: false;
      readonly error: AppError;
      /**
       * C-6a: the config's `language` when the refusal came after the config was read and it sets
       * one, so the adapter explains the error in it (the CLI's main.ts); absent otherwise. Beside the
       * error, not in AppError, so no error JSON carries it.
       */
      readonly configLanguage?: MessageLanguage;
    };

/**
 * U-229 (R-106 L-1, after U-220): a revert's outcome. `lockLeft: true` when the revert finished but
 * its workspace lock could not be released (the CLI's RevertCliOutcome.lockLeft); the output is the
 * revert's own, as when the lock was released. Absent: released.
 */
export type RevertCallOutcome = { readonly ok: true; readonly output: RevertOutput; readonly lockLeft?: true } | { readonly ok: false; readonly error: AppError };

export interface ReportRequest {
  readonly workspace: string;
  /** A run id or "latest" (N-7). */
  readonly runId: string;
  /** DR-77: Markdown only; omitted means English. Structured report data is unchanged. */
  readonly language?: MessageLanguage;
}

/**
 * GU-3 (standalone-gui 3.7, saving a report): the report exactly as `codaryn report` prints it
 * without `--json`, from the same records as `report`: Markdown, with every API provider's key value
 * hidden. For writing to a file the person chose. A window shows the structured `report`; it never
 * renders this text as HTML.
 */
export interface ReportMarkdown {
  readonly kind: "report_markdown";
  readonly markdown: string;
  /** The report's exit code, as `codaryn report` ends with it (the same as `report`'s `exitCode`). */
  readonly exitCode: number;
}

export interface RevertRequest {
  readonly workspace: string;
  /** A run id or "latest" (N-7). */
  readonly runId: string;
  /** N-7: decide and report every file the same way, change nothing, take no lock, write no revert record. */
  readonly dryRun?: boolean;
  /**
   * DR-25: the person's consent, given on the GUI's screen for this one revert, to move this run's
   * files back unsafely (no hard links on that drive). Absent or null: none, and such files are
   * skipped as `unsafe_move`. The app layer passes it to the CLI as the adapter's consent
   * (`AdapterRevert`); it must name the run reverted (not "latest") and cannot go with a dry run.
   */
  readonly unsafeMoveConsent?: RevertConsentRequest | null;
}

/** DR-25: the GUI's consent to unsafe moves for one revert: the run id the person agreed for. */
export interface RevertConsentRequest {
  readonly runId: string;
}

/** N-7: `codaryn runs --json`. */
/** DR-39: a workspace whose state directory is summed up. */
export interface StateSummaryRequest {
  readonly workspace: string;
}

export interface StateSummaryView {
  readonly kind: "state_summary";
  /** The store's summarizeState: run ids, kinds, statuses, start times and sizes; no file name of a person's. */
  readonly summary: StateSummary;
}

/** DR-39: what to remove (CleanupSelection: exact run ids, whole days, `reverted: true`). */
export interface CleanupPreviewRequest {
  readonly workspace: string;
  readonly selection: CleanupSelection;
}

export interface CleanupPreview {
  readonly kind: "cleanup_preview";
  /** The moment the plan counted `olderThanDays` from (RUN_TIMESTAMP_PATTERN_SOURCE); give it back to applyCleanup. */
  readonly now: string;
  /**
   * Items with their warnings, blocked items, totals, the parked files (never cleaned) and the digest to
   * confirm. DR-44: leftover folders of an earlier cleanup come last (target "leftover"), and
   * totals.runs.notReverted counts the runs that need their own confirmation.
   */
  readonly plan: CleanupPlan;
}

/** DR-39: the selection and `now` of a preview, and the person's confirmation of its plan. */
export interface ApplyCleanupRequest {
  readonly workspace: string;
  readonly selection: CleanupSelection;
  readonly now: string;
  /**
   * The digest of the plan shown, and each asked apart: whether the discarded-files folders (people's
   * files) may go, and (DR-44 (a)) whether the records of runs not reverted or only partly reverted may go.
   */
  readonly confirmation: CleanupConfirmation;
}

/** DR-48: the outcome of a cleanup that was carried out, as the CLI's JSON (CleanupOutput) gives it. */
export type CleanupDoneOutcome = Extract<CleanupOutput, { readonly status: Exclude<CleanupStatus, "preview"> }>["outcome"];

export interface CleanupApplied {
  readonly kind: "cleanup_applied";
  /**
   * DR-48 (AXM-3): what the cleanup did, by the contract's one rule (cleanupStatusOf): removed,
   * nothing_removed, or partly_failed (something kept for a problem, CLEANUP_PROBLEM_KEPT_REASONS).
   */
  readonly status: Exclude<CleanupStatus, "preview">;
  /**
   * The store's outcome: what was removed entirely and what was kept and why (DR-44: partly_removed is
   * never reported as removed). `ok` is true for `removed` only, as in the CLI's JSON. A digest that
   * is not the plan's (cleanup_plan_changed) and a held lock (workspace_locked) are call errors, not
   * outcomes. U-193: its `lockLeft` (the contract's, when the store could not release the lock) is
   * passed on as the store gives it.
   */
  readonly outcome: CleanupDoneOutcome;
}

export interface ListRunsRequest {
  readonly workspace: string;
  /** 1 to RUNS_MAX_LIMIT; RUNS_DEFAULT_LIMIT when absent. */
  readonly limit?: number;
}

/** N-7, N-23(b): which run a reference names, so an adapter can show it before acting on it. */
export interface ResolveRunRequest {
  readonly workspace: string;
  /** A run id or "latest". */
  readonly run: string;
}

export interface ResolvedRun {
  readonly runId: string;
  /** The reference was "latest". */
  readonly latest: boolean;
  /** `run_started`'s time when the run list checked the run; null otherwise. */
  readonly startedAt: string | null;
  /** The run list holds this id as damaged (a given id may be; "latest" never names one). */
  readonly damaged: boolean;
}

export interface DoctorRequest {
  readonly configPath: string | null;
  readonly varsFile: string | null;
  /** At most one of the two (W-5). */
  readonly taskPath: string | null;
  readonly workspace: string | null;
}

/** U-90: a record type a run's journal (JournalEventType) or an apply's (ApplyJournalEventType) shows; RUN_EVENT_TYPES lists them. */
export type RunEventType = JournalEventType | ApplyJournalEventType;

/** U-90 (GUI 3.7, adapter-contract 5.13): one page of a run's stored records. */
export interface ListRunEventsRequest {
  /** The workspace and the values registered now, which mask the records again (DR-17, U-17). */
  readonly settings: TaskForm;
  /** A run id from the run list; "latest" is not taken. */
  readonly runId: string;
  /** From 0: the previous page's `nextOffset` (a place among the records that pass, not a `seq`). */
  readonly offset: number;
  /** 1 to MAX_RUN_EVENTS_PAGE (1,000); RUN_EVENTS_PAGE_SIZE (200) when left out. */
  readonly limit?: number;
  /** Only these record types; all when left out. Not empty, names from RUN_EVENT_TYPES only. */
  readonly types?: readonly RunEventType[];
}

/**
 * U-90: a stored record as given: checked for its `seq`, `at`, `runId` and `type` and for plain
 * field names, every string masked again. Its other fields are as the journal holds them, so an
 * adapter reads them as it would any outside data (a line a command wrote can have the right shape).
 */
export interface StoredRunRecord {
  readonly seq: number;
  readonly at: string;
  readonly runId: string;
  readonly type: RunEventType;
  readonly [field: string]: unknown;
}

export interface RunEventsPage {
  readonly kind: "run_events";
  readonly runId: string;
  /** By the journal's first record (DR-12): `run_started` or `apply_started`. */
  readonly runKind: "run" | "apply";
  /**
   * "incomplete": the run has no result.json (still going, or stopped without one). R-80 M-1:
   * "damaged": a line is broken or not this run's, a number is missing or given twice, or `report`
   * refuses the journal or result.json; the records taken are given, with `missing`.
   */
  readonly status: "complete" | "incomplete" | "damaged";
  /** DR-38: the run has a records-changed mark (one that cannot be checked counts). Absent: none. */
  readonly recordsChanged?: true;
  /** Masked with the values registered now, not with the run's table; tokens are never restored. */
  readonly masking: "current_secrets";
  readonly records: readonly StoredRunRecord[];
  /** The records that pass the checks and the filter. */
  readonly total: number;
  /** Lines of the whole journal left out: not of this run's shape, or not maskable. */
  readonly skipped: number;
  /** R-80 M-1: record numbers no single line gives (a gap, or a number two lines give); 0 when none. */
  readonly missing: number;
  readonly offset: number;
  readonly nextOffset: number | null;
}

export interface CodarynApp {
  /**
   * Checks and assembles a run exactly as `codaryn run` does, then starts the engine and returns
   * its handle. A failure before the start returns an AppError and creates nothing.
   */
  startRun(request: StartRunRequest, observer?: RunObserver): Promise<StartOutcome>;
  /** `codaryn report --json` (run id or "latest"): reads the run's records only, takes no lock. */
  report(request: ReportRequest): Promise<AppCallOutcome<ReportOutput>>;
  /** `codaryn report` without `--json`: the same report as Markdown, for saving (GU-3). See ReportMarkdown. */
  reportMarkdown(request: ReportRequest): Promise<AppCallOutcome<ReportMarkdown>>;
  /** `codaryn revert [--dry-run]` (run id or "latest"). See RevertRequest; U-229: lockLeft, RevertCallOutcome. */
  revert(request: RevertRequest): Promise<RevertCallOutcome>;
  /** N-7: `codaryn runs --json`. Reads only. */
  listRuns(request: ListRunsRequest): Promise<AppCallOutcome<RunsOutput>>;
  /** N-7, N-23(b): the run a reference names and its start time. Reads only. */
  resolveRun(request: ResolveRunRequest): Promise<AppCallOutcome<ResolvedRun>>;
  /** DR-39: the state directory's runs, discarded files and parked files with their sizes. Reads only. */
  stateSummary(request: StateSummaryRequest): Promise<AppCallOutcome<StateSummaryView>>;
  /** DR-39: what a cleanup would remove (the store's plan and its digest). Removes nothing. */
  previewCleanup(request: CleanupPreviewRequest): Promise<AppCallOutcome<CleanupPreview>>;
  /** DR-39: removes only a plan the person confirmed (its digest); people's discarded files only with their own yes. */
  applyCleanup(request: ApplyCleanupRequest): Promise<AppCallOutcome<CleanupApplied>>;
  /** `codaryn doctor --json`: no network access, no write. */
  doctor(request: DoctorRequest): Promise<AppCallOutcome<DoctorOutput>>;
  /** The config file a run would read and what it holds; profile and task type names. Reads only. */
  readSettings(request: ReadSettingsRequest): Promise<AppCallOutcome<SettingsView>>;
  /** N-2: `init --json` without questions: the config file with the defaults. Never overwrites, never a key. */
  createSettings(request: CreateSettingsRequest): Promise<AppCallOutcome<InitOutput>>;
  /** The fixed suggestions init would ask about for a workspace. Reads only. */
  settingsSuggestions(request: SettingsSuggestionsRequest): Promise<AppCallOutcome<SettingsSuggestions>>;
  /** UX 7: what a settings change would change and widen. Writes nothing. */
  proposeSettingsChange(request: SettingsChangeRequest): Promise<AppCallOutcome<SettingsChangeProposal>>;
  /** Writes a proposed change atomically: same file as proposed, widening only when confirmed. */
  applySettingsChange(request: ApplySettingsChangeRequest): Promise<AppCallOutcome<SettingsWritten>>;
  /** `codaryn models --json`: a real API request; only when a person asked. Writes nothing. */
  listModels(request: ListModelsRequest): Promise<AppCallOutcome<ModelsOutput>>;
  /** `codaryn models --json --use <id>`: writes the config file's `model` atomically, nothing else. */
  selectModel(request: SelectModelRequest): Promise<AppCallOutcome<ModelsOutput>>;
  /** DR-7: the run's changes, masked again with the secrets registered now. Reads only. */
  changes(request: ChangesRequest, options?: ChangesOptions): Promise<AppCallOutcome<ChangesOutput>>;
  /** U-89 (GUI 3.3): one directory of the workspace, masked, links never followed. Reads only. */
  listWorkspaceDir(request: ListWorkspaceDirRequest): Promise<AppCallOutcome<WorkspaceDirListing>>;
  /** U-172 (DR-72): a workspace text file for a person, as shown, and whether it can be edited here. Reads only, no lock (adapter-contract 5.15). */
  readWorkspaceText(request: ReadWorkspaceTextRequest): Promise<AppCallOutcome<WorkspaceText>>;
  /** U-172 (DR-72): a person's edit, judged again, on the digest read, under the workspace lock; no run record (adapter-contract 5.15). */
  writeWorkspaceText(request: WriteWorkspaceTextRequest): Promise<AppCallOutcome<WorkspaceTextWritten>>;
  /** U-90 (GUI 3.7): one page of a run's stored records, checked line by line and masked again (adapter-contract 5.13). */
  listRunEvents(request: ListRunEventsRequest): Promise<AppCallOutcome<RunEventsPage>>;
  /** U-91 (GUI 3.9, DR-21): the apply's preflight for a pending plan, under the lock; nothing moved or recorded (adapter-contract 5.14). */
  checkApply(request: CheckApplyRequest): Promise<AppCallOutcome<PlanCheck>>;
  /**
   * DR-1, DR-17: the plan screen after a `needs-input`/`plan_pending` result, the apply with the
   * person's approval (and DR-21 consent), and the person's review after `awaiting_review`.
   * Required since the general task commands are in main (PM decision on A-5 question 1).
   */
  /**
   * U-196: a run plan (plan.json `kind: "changes"`) is shown as ChangesPlanOutput (`planKind:
   * "changes"`); a plan of mode apply as PlanOutput, as before (AnyPlanOutput, told apart by planKind).
   */
  plan(request: PlanRequest): Promise<AppCallOutcome<AnyPlanOutput>>;
  applyPlan(request: ApplyPlanRequest, observer?: ApplyObserver): Promise<{ readonly ok: true; readonly handle: ApplyHandle } | { readonly ok: false; readonly error: AppError }>;
  review(request: ReviewRequest): Promise<AppCallOutcome<ReviewOutput>>;
}
