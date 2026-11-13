/**
 * Adapter contract of the app layer (docs/design/adapter-contract.md, sections 4 and 5, with the
 * decisions DR-1 to DR-4, DR-7, DR-10, DR-12, DR-14, DR-15 and DR-17).
 *
 * Interim location: these types belong in `src/contracts/app.ts` (migration step 1, role 1).
 * Plan, apply and review use the G-A contract's own types (DR-17); until G-A is in main they come
 * from ./general-tasks.ts, which repeats them under the same names.
 */

import type {
  ChangesApplyRun,
  CliErrorCategory,
  CliErrorCode,
  Clock,
  CodarynConfig,
  CommandRule,
  ConfirmAnswer,
  ConfirmRequest,
  InitOutput,
  InitSuggestedCommand,
  InitSuggestedProtectedPath,
  InputDiagnostic,
  DoctorOutput,
  EngineResult,
  JournalRecord,
  MaskedText,
  ModelsOutput,
  CleanupConfirmation,
  CleanupOutput,
  CleanupPlan,
  CleanupSelection,
  CleanupStatus,
  PermissionKind,
  PolicyNarrowingKind,
  StateSummary,
  ReportOutput,
  RevertOutput,
  RunsOutput,
  ToolName,
} from "../contracts/index.js";
import type { ApplyJournalRecord, ApplyResult, PlanOutput, ReviewOutput } from "./general-tasks.js";

/** Process facts an adapter hands to the app layer. The app layer never touches process globals. */
export interface AppEnvironment {
  /**
   * Environment variables. Copied for every call (on Windows into a copy that looks names up
   * without case, DR-4); this object is never changed. The copy, with the variables file loaded,
   * is also the parent environment of the run's commands (DR-4).
   */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  /** U-3: the running Codaryn install directory. Null refuses every run. */
  readonly installDir: string | null;
  /** `process.versions.node`, for `doctor`. */
  readonly nodeVersion: string;
  /** Reads a UTF-8 file. Rejects when it cannot be read. */
  readonly readFile: (file: string) => Promise<string>;
  readonly isDirectory: (dir: string) => Promise<boolean>;
  /** True for an existing regular file. Never throws. */
  readonly isFile: (file: string) => Promise<boolean>;
  /**
   * C-2: the variables a `--vars-file` defines, as name → value. Throws when the file cannot be
   * read. It must not change `process.env`. Synchronous because the run's loading step is.
   */
  readonly readVarsFile: (file: string) => Readonly<Record<string, string>>;
  readonly clock: Clock;
  readonly randomBytes: (size: number) => Uint8Array;
  /** Defaults to `process.platform`. Windows looks environment names up without case. */
  readonly platform?: NodeJS.Platform;
  /**
   * N-1: the home directory, for the default config location the CLI reads when neither a config
   * path nor CODARYN_CONFIG is given. Absent or null: no default location (as the CLI without one).
   */
  readonly homeDir?: string | null;
  /** N-4, N-20: the operating system's locale, for `doctor`'s language check. Absent: not known. */
  readonly osLocale?: string | null;
}

/** One error that stopped a call before anything changed, or an internal error after a start. */
export interface AppError {
  readonly code: CliErrorCode;
  /** Fixed text, field positions and counts only. Never a value read from a file or the environment. */
  readonly message: string;
  /** N-6: where in the config or task file the problem is (field path, line and column), when it can be said safely. */
  readonly diagnostic?: InputDiagnostic;
  /**
   * U-55 (AXM-9): the CLI's own facts when the error came from its output (fromCliError keeps
   * them). toCliError gives every error cliErrorFacts of its code where these are absent.
   */
  readonly category?: CliErrorCategory;
  readonly retryable?: boolean;
}

/** N-2: create the config file with the defaults (`init --json`, no questions). */
export interface CreateSettingsRequest {
  /** Where to write. Null: the default location (N-1). CODARYN_CONFIG names a file to read, not this one. */
  readonly configPath: string | null;
  /** The workspace the file must lie outside of (S-1). Null: not checked against one. */
  readonly workspace: string | null;
}

/** The fixed candidates init would ask about for a workspace (N-2, N-14). */
export interface SettingsSuggestionsRequest {
  readonly workspace: string;
}

export interface SettingsSuggestions {
  readonly kind: "settings_suggestions";
  /** package.json scripts on init's fixed list, with the rule each becomes (arguments fixed). Allowing one widens the policy. */
  readonly commands: readonly { readonly shown: InitSuggestedCommand; readonly rule: CommandRule }[];
  /** Fixed protected path names that exist in the workspace. Protecting one narrows the policy. */
  readonly protectedPaths: readonly InitSuggestedProtectedPath[];
}

/** Settings change (standalone-gui 3.6, UX 7): the whole new config as the GUI built it. */
export interface SettingsChangeRequest {
  /** The file to change, chosen as readSettings chooses it. It must exist (createSettings first). */
  readonly configPath: string | null;
  /** The new config: a JSON value. It is checked like a config file read from disk. */
  readonly next: unknown;
}

export interface ApplySettingsChangeRequest extends SettingsChangeRequest {
  /** The proposal's `baseDigest`: the file must still be what the proposal saw. */
  readonly baseDigest: string;
  /** True only after the person confirmed the proposal's `widening` (the GUI's main process asks). */
  readonly confirmWidening: boolean;
}

export interface SettingsFieldChange {
  /** Top-level field, or one level down inside `policy` and `limits` (for example "limits.maxModelTurns"). */
  readonly field: string;
  readonly change: "added" | "removed" | "changed";
}

export interface SettingsWidening {
  readonly kind:
    | "command_added"
    | "extra_args_allowed"
    /**
     * U-107 (R-79 F-1): calls a rule asked a person about (U-74 `confirm: true`) are allowed without
     * asking: the rule lost `confirm`, or a plain rule matching the same calls was added.
     */
    | "confirm_removed"
    | "limit_raised"
    | "protected_path_removed"
    | "integrity_path_removed"
    | "secret_env_removed"
    | "verifier_removed"
    /** R-14 L-2: a command verifier added or changed; it runs with the person's rights on every run. */
    | "verifier_command_added"
    | "restore_path_tokens_enabled"
    | "plan_action_allowed"
    /** A provider's API address: top-level `apiBaseUrl`, or `providers.<name>.apiBaseUrl` (GUI F-3). */
    | "api_base_url_changed"
    /** GUI F-3: quick runs use another provider (`provider`), so the workspace's text goes to another API. */
    | "provider_changed"
    | "profile_changed"
    | "workflow_changed";
  /** Where: a field path such as "policy.commands[2]". Never a value. */
  readonly field: string;
}

export interface SettingsChangeProposal {
  readonly kind: "settings_change";
  readonly file: { readonly source: "argument" | "environment" | "default"; readonly path: string; readonly display: string };
  /** SHA-256 of the file as it is now; apply needs it back. */
  readonly baseDigest: string;
  /** SHA-256 of the text that would be written. */
  readonly digest: string;
  readonly changes: readonly SettingsFieldChange[];
  /** Changes that let runs do more. Empty: nothing to confirm. */
  readonly widening: readonly SettingsWidening[];
  /** DR-41: what each workflow's own rules would leave out of the new config's policy. See WorkflowPolicyNarrowing. */
  readonly policyNarrowings: readonly WorkflowPolicyNarrowing[];
  /** The new config as parsed. */
  readonly config: CodarynConfig;
}

/**
 * DR-41: a workflow whose own policy leaves part of the config's policy out of its quick runs
 * (workflowPolicyNarrowings: a command rule dropped or kept in part, a plan action kind, path token
 * restoring). Kinds and counts only, never a rule, a command or a path. Built-in workflows first,
 * then the config's, as workflowDefinitions orders them.
 */
export interface WorkflowPolicyNarrowing {
  readonly workflow: string;
  readonly kind: PolicyNarrowingKind;
  readonly count: number;
}

export interface SettingsWritten {
  readonly kind: "settings_written";
  readonly file: SettingsChangeProposal["file"];
  /** False when nothing changed (the file was left as it was). */
  readonly written: boolean;
  /** SHA-256 of the file now. */
  readonly digest: string;
  readonly changes: readonly SettingsFieldChange[];
  readonly widening: readonly SettingsWidening[];
}

/** The config file a run would read, and what it holds (standalone-gui 3.2, 3.6). */
export interface ReadSettingsRequest {
  /** `--config`. Null: CODARYN_CONFIG, then the default location (N-1). */
  readonly configPath: string | null;
}

export interface SettingsView {
  readonly kind: "settings";
  /**
   * The file chosen, or null when none is (no --config, no CODARYN_CONFIG, no default location).
   * `path` is for reading and writing it; show `display` (N-14). `exists` false only for the
   * default location, where a missing file means "no config yet" (the wizard creates one).
   */
  readonly file: {
    readonly source: "argument" | "environment" | "default";
    readonly path: string;
    readonly display: string;
    readonly exists: boolean;
  } | null;
  /** The parsed config, or null when there is no file. A file that fails a check is an AppError instead. */
  readonly config: CodarynConfig | null;
  /** N-8: profile names in the file's order, for the new task screen. */
  readonly profiles: readonly string[];
  /** G-A: workflow ids the config file defines, in the file's order. */
  readonly workflows: readonly string[];
  /** G-A BUILTIN_WORKFLOW_IDS: the built-in workflows, available with or without a config file. */
  readonly builtinWorkflows: readonly string[];
  /** N-8, G-A: each profile with the workflow it uses when the task names none (`workflowRef`), or null; file order. */
  readonly profileWorkflows: readonly { readonly profile: string; readonly workflowRef: string | null }[];
  /**
   * Whether the key of the provider a quick run would use is set (SP-6: the config's `provider`,
   * else anthropic; ANTHROPIC_API_KEY or OPENAI_API_KEY). Never its value (C-1).
   */
  readonly keyAvailable: boolean;
  /** DR-41: what each workflow's own rules leave out of this config's policy. See WorkflowPolicyNarrowing. */
  readonly policyNarrowings: readonly WorkflowPolicyNarrowing[];
}

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
   * DR-2: the workflow definition to use (`--workflow`, GT 4.2), passed to the CLI's quick form. A
   * task file names its own `workflowRef`; giving both is the CLI's `invalid_arguments` (R-14 I-4).
   */
  readonly workflowRef: string | null;
  /** `--cancel-file` (P-2). Must lie outside the workspace (T-12). */
  readonly cancelFile: string | null;
}
// There is no field for a key, an API address, or a policy, limit or protected path override
// (C-1, C-5, M-9).

export type RunEvent =
  /**
   * A record as the journal stored it (masked), in `seq` order, after it was written. Model-given
   * tool names outside the built-in set read "(unknown tool)" and call ids are masked again (L-1).
   */
  | { readonly kind: "record"; readonly record: JournalRecord }
  /** A run-level note outside the journal (for example the Y-4 hint). Also in the result's notices. */
  | { readonly kind: "notice"; readonly text: MaskedText };

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
}

export type RunOutcome =
  | { readonly ok: true; readonly result: EngineResult }
  /** An internal error after the start (`internal_error`). The lock is released. */
  | { readonly ok: false; readonly error: AppError };

export interface RunHandle {
  /** Known before the first event is delivered and before the engine starts. */
  readonly runId: string;
  /** Real path of the workspace root, as the run's assembly resolved it. */
  readonly workspaceRoot: string;
  /** Idempotent. After the run ended it does nothing. */
  cancel(): void;
  /** Never rejects. Resolves after result.json was written and the workspace lock released. */
  readonly done: Promise<RunOutcome>;
}

export type StartOutcome =
  | { readonly ok: true; readonly handle: RunHandle }
  | { readonly ok: false; readonly error: AppError };

export type AppCallOutcome<T> = { readonly ok: true; readonly output: T } | { readonly ok: false; readonly error: AppError };

export interface ReportRequest {
  readonly workspace: string;
  /** A run id or "latest" (N-7). */
  readonly runId: string;
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
   * outcomes.
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

/**
 * Y-1, Y-2, DR-22: the models a provider's key can use. A real API request: only when a person
 * asked for the list. `configPath` null: CODARYN_CONFIG, then the default location (N-1).
 */
export interface ListModelsRequest {
  /**
   * DR-22, SP-6: one of the API providers (API_PROVIDER_NAMES, CONNECTED_MODEL_PROVIDERS). It decides
   * the key, the address, the lister and where a choice is written, whatever the config file's
   * `provider` is. Another name is `invalid_arguments` before anything is read.
   */
  readonly provider: string;
  readonly configPath: string | null;
  readonly varsFile: string | null;
}

/**
 * Y-3, SP-6: lists again and writes this id as that provider's model in the config file, only when
 * the list holds it (as the CLI's `models --use`: anthropic's top-level `model`, or
 * `providers.<name>.model`).
 */
export interface SelectModelRequest extends ListModelsRequest {
  readonly model: string;
}

export interface DoctorRequest {
  readonly configPath: string | null;
  readonly varsFile: string | null;
  /** At most one of the two (W-5). */
  readonly taskPath: string | null;
  readonly workspace: string | null;
}

/**
 * DR-7: the changes of one run, masked again with the secrets a run with the same settings
 * registers now (the run's own mapping is gone when it ends). Adapters show these texts only; they
 * never read the snapshot directory themselves.
 */
export interface ChangesRequest {
  /** The task form the run was started with; it decides the secrets and the workspace (DR-17). */
  readonly settings: TaskForm;
  /** A run id or "latest". */
  readonly runId: string;
}

/**
 * DR-17: the task form `plan`, `apply`, `review` and `changes` take, as G-A defines it for the CLI:
 * a task file, or a workspace with the config file's defaults and an optional profile. It decides
 * the secrets (S-2 to S-4) and the workspace exactly as for a run; it needs no goal and no model.
 */
export interface TaskForm {
  readonly input: { readonly kind: "task"; readonly taskPath: string } | { readonly kind: "workspace"; readonly workspace: string };
  readonly configPath: string | null;
  readonly varsFile: string | null;
  readonly profile: string | null;
  /**
   * R-14 L-3: `--workflow` (G-F, GT-D1): the workflow the workspace form resolves to, so a plan made
   * with `startRun`'s `workflowRef` is shown, applied and reviewed on the same form without a
   * profile. Null: the profile's or the config's. A task file names its own; the CLI refuses both.
   */
  readonly workflowRef: string | null;
}

export type ChangedFileUnavailable =
  /** The recorded path holds a privacy token, so the file cannot be found from it. */
  | "masked_path"
  /** No usable original was kept (none recorded, or it is not the state the run replaced). */
  | "snapshot_missing"
  /** The original or the current file is not UTF-8 text. */
  | "not_text"
  /** Larger than MAX_READ_BYTES. */
  | "too_large"
  | "unreadable"
  /** Masking failed; no text is given. */
  | "mask_failed"
  /**
   * R-11, DR-28 principle, DR-29: the text is shown only when the secrets registered now mask it as
   * the run did, by the run's record (changeShownMatches). Not so here: other secrets, a file
   * changed after the run, a run without a record, or a record that does not match. The path and
   * the state are given.
   */
  | "masking_unverified";

export interface ChangedFileView {
  /** As the journal recorded it (masked). */
  readonly path: MaskedText;
  /** The run created the file: there is no original. */
  readonly created: boolean;
  /**
   * as_run_left: the file's hash is the one the run left. changed_since_run: it was changed later.
   * missing: it no longer exists. unknown: it could not be read.
   */
  readonly state: "as_run_left" | "changed_since_run" | "missing" | "unknown";
  /** The original, masked. Null when the run created the file or it is unavailable. */
  readonly before: MaskedText | null;
  /** The current content, masked. Null when the file is missing or unavailable. */
  readonly after: MaskedText | null;
  /** Why `before` or `after` is missing although the file has one; null when both are given as expected. */
  readonly unavailable: ChangedFileUnavailable | null;
}

export interface ChangesOutput {
  readonly schemaVersion: 1;
  readonly kind: "changes";
  readonly runId: string;
  /** Always 0: reading the changes is not a judgement of them. */
  readonly exitCode: 0;
  /** Always "current_secrets": masked with the secrets registered now, not with the run's table. */
  readonly masking: "current_secrets";
  /** One entry per changed path, in the order the run first changed them. */
  readonly files: readonly ChangedFileView[];
  /**
   * U-16 (UXM-4): for an apply run only, the plan run it applied and how many actions it applied
   * (ChangesApplyRun). Its moves and discards are its plan's actions, not file writes of its own, so
   * `files` is empty; its report lists them. Judged as the run list judges the run; absent while
   * the apply has no result yet (the number of actions is not known then).
   */
  readonly applyRun?: ChangesApplyRun;
  /**
   * U-43 (DR-38): the run has a records-changed mark (contracts/state.ts), judged by the store's
   * hasRecordsChangedMark as `report` and `revert` judge it; a mark that cannot be checked counts.
   * Such a run has no text of its files (the store gives no `shown` record), only paths and states.
   * Absent: no mark.
   */
  readonly recordsChanged?: true;
}

/** U-89 (GUI 3.3): one directory of the workspace these settings resolve to (adapter-contract 5.12). */
export interface ListWorkspaceDirRequest {
  /** The workspace, the values registered now for masking and the protected paths (DR-17, U-17). */
  readonly settings: TaskForm;
  /** "" for the root, else plain relative segments joined by "/" (workspace-dir.ts isWorkspaceDir). */
  readonly dir: string;
  /** From 0: the previous page's `nextOffset`. */
  readonly offset: number;
  /** 1 to WORKSPACE_PAGE_SIZE (500); 500 when left out. */
  readonly limit?: number;
}

/** U-89: what an entry is. A `link` (link or junction) and the root's `state` are never listed in turn. */
export type WorkspaceEntryKind = "dir" | "file" | "link" | "state" | "other";

export interface WorkspaceEntry {
  /** The real name, for the adapter's own child paths only. Null for a masked entry: its real name never leaves the app layer. */
  readonly name: string | null;
  /** The name as shown (masked); "" when it cannot be shown at all. */
  readonly shown: MaskedText;
  readonly kind: WorkspaceEntryKind;
  /** The shown name is not the real one: the entry cannot be opened or chosen. */
  readonly masked: boolean;
  /** The effective policy's protected paths cover it. */
  readonly protected: boolean;
}

/**
 * U-89: a page of the directory, or why it is not listed. These are outcomes of reading, not call
 * errors: `refused` (outside the root, the state directory, a name the workspace rules reject, or a
 * link or junction on the way), `not_found`, `not_dir`, `too_large` (more than
 * MAX_WORKSPACE_DIR_ENTRIES entries; never listed in part) and `unreadable`.
 */
export type WorkspaceDirListing =
  | {
      readonly kind: "workspace_dir";
      readonly status: "listed";
      readonly masking: "current_secrets";
      /** Directories (and `state`) first, then the rest, each in a fixed order. */
      readonly entries: readonly WorkspaceEntry[];
      readonly total: number;
      readonly offset: number;
      readonly nextOffset: number | null;
    }
  | { readonly kind: "workspace_dir"; readonly status: "not_found" | "not_dir" | "too_large" | "refused" | "unreadable" };

/** DR-17: `codaryn plan`'s task form (G-A): the plan is masked again with the secrets of these settings. */
export interface PlanRequest {
  readonly settings: TaskForm;
  /** The plan run's id or "latest". */
  readonly runId: string;
}

/**
 * DR-21: the person's consent, given on the GUI's screen, to the moves of one apply that can only be
 * made unsafely (no hard links on that drive, so a file created at the destination meanwhile could
 * be replaced). The GUI's main process sets it only after the person agreed to those moves (the
 * apply ended as `needs-input`/`consent_required` with `plan_checked.unsafeMoves`). The app layer
 * turns it into G-A's UnsafeMoveConsent with channel `adapter` (consent.ts); the GUI cannot name
 * another channel. A task file, config, profile, plan or model never gives it. It holds for this
 * one apply: the next apply needs it again.
 */
export interface UnsafeMoveConsentRequest {
  /** The full SHA-256 of the plan the person consented for (64 lowercase hex): the plan being applied. */
  readonly digest: string;
}

/** DR-1, DR-2, DR-12: the apply takes the task form; its policy and verifiers come from it at apply time (DR-5). */
export interface ApplyPlanRequest {
  readonly settings: TaskForm;
  readonly planRunId: string;
  /** The digest, or its first 12 or more characters (G-A MIN_PLAN_DIGEST_PREFIX). */
  readonly digest: string;
  /** `--cancel-file` (DR-2). Outside the workspace (T-12). */
  readonly cancelFile: string | null;
  /** DR-21: null unless the person consented on screen to this apply's unsafe moves. */
  readonly unsafeMoveConsent: UnsafeMoveConsentRequest | null;
}

/** DR-2: an apply run's events: its own records (G-A ApplyJournalRecord), sanitized as run events are. */
export type ApplyEvent =
  | { readonly kind: "record"; readonly record: ApplyJournalRecord }
  | { readonly kind: "notice"; readonly text: MaskedText };

export interface ApplyObserver {
  /** Called synchronously for each event. Exceptions are ignored. */
  onEvent?(event: ApplyEvent): void;
}

/** DR-2: applying has the same event and cancel channel as a run. */
export interface ApplyHandle {
  readonly runId: string;
  cancel(): void;
  /** Never rejects; resolves after the apply's result.json is written and the lock released. */
  readonly done: Promise<AppCallOutcome<ApplyResult>>;
}

/** DR-17, R-4 L-4: `codaryn review` takes the task form; the note is masked with its secrets before it is stored. */
export interface ReviewRequest {
  readonly settings: TaskForm;
  /** A run id or "latest". */
  readonly runId: string;
  readonly decision: "accept" | "reject";
  readonly note: string | null;
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
  /** `codaryn revert [--dry-run]` (run id or "latest"). See RevertRequest. */
  revert(request: RevertRequest): Promise<AppCallOutcome<RevertOutput>>;
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
  /** The config file a run would read and what it holds; profile and workflow names. Reads only. */
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
  changes(request: ChangesRequest): Promise<AppCallOutcome<ChangesOutput>>;
  /** U-89 (GUI 3.3): one directory of the workspace, masked, links never followed. Reads only. */
  listWorkspaceDir(request: ListWorkspaceDirRequest): Promise<AppCallOutcome<WorkspaceDirListing>>;
  /**
   * DR-1, DR-17: the plan screen after a `needs-input`/`plan_pending` result, the apply with the
   * person's approval (and DR-21 consent), and the person's review after `awaiting_review`.
   * Required since the general task commands are in main (PM decision on A-5 question 1).
   */
  plan(request: PlanRequest): Promise<AppCallOutcome<PlanOutput>>;
  applyPlan(request: ApplyPlanRequest, observer?: ApplyObserver): Promise<{ readonly ok: true; readonly handle: ApplyHandle } | { readonly ok: false; readonly error: AppError }>;
  review(request: ReviewRequest): Promise<AppCallOutcome<ReviewOutput>>;
}
