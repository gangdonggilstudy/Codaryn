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
 */

import type { CleanupConfirmation, CleanupOutput, CleanupPlan, CleanupSelection, CleanupStatus, StateSummary } from "./cleanup.js";
import type { ChangesApplyRun, DoctorOutput, InitOutput, ModelsOutput, ReportOutput, RunsOutput } from "./commands.js";
import type { CodarynConfig, DefaultConfigDisplay } from "./config.js";
import type { CliErrorCategory, CliErrorCode, Clock, EngineResult, InputDiagnostic, RevertOutput } from "./engine.js";
import type { InitSuggestedCommand, InitSuggestedProtectedPath, MessageLanguage } from "./human.js";
import type { JournalEventType, JournalRecord } from "./journal.js";
import type { AnyPlanOutput, ApplyJournalEventType, ApplyJournalRecord, ApplyResult, ChangesPlanOutput, PlanItemProblem, PlanOutput } from "./plan.js";
import type { ConfirmAnswer, ConfirmRequest, PermissionKind } from "./policy.js";
import type { CommandRule } from "./task.js";
import type { ContentHash, MaskedText } from "./text.js";
import type { ToolName } from "./tool.js";
import type { PolicyNarrowing, PolicyNarrowingKind, ReviewOutput } from "./workflow.js";

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
  /**
   * C-6a (P-2): registers a handler for a process signal and returns its remover (as the CLI's
   * cancel source takes it). The app registers SIGINT and SIGTERM when a run's cancel source is made,
   * right before the assembly as the CLI does, and removes them when the run ends; either signal
   * then cancels that run. Not during the checks before it: the process ends as Node's default
   * there. Absent (the GUI's engine host): no handler; RunHandle.cancel and the cancel file cancel.
   * The app layer still never touches the process itself.
   */
  readonly onSignal?: (name: "SIGINT" | "SIGTERM", handler: () => void) => () => void;
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
    | "workflow_changed"
    /**
     * U-183 (DR-69 B-4): an entry of a list of writable paths (the config's `policy.writablePaths`,
     * a profile's, a task type definition's) covers a path that list did not cover: an entry added, a
     * broader prefix, the root. The field is the entry (`…writablePaths[i]`).
     */
    | "writable_path_added"
    /** U-183 (DR-69 B-4): a list of writable paths is gone, so that limit is lifted (no limit). The field is the list. */
    | "writable_paths_unlimited"
    /**
     * U-204 (DR-69 bundle A, A-7, R-7): a list of unreadable paths (the config's
     * `policy.unreadablePaths`, a profile's, a task type definition's) no longer has an entry it had,
     * by the gate's matching: removed, replaced by a broader one, the list gone or emptied. A
     * profile's or a definition's entry the config's new list still has is not one. The field is the list.
     */
    | "unreadable_path_removed"
    /**
     * U-204 (A-7, R-7, Q-4, DR-70): a lower group size k (never below 5): the config's
     * (`policy.minGroupSize`, 5 when it sets none), or a profile's or a task type definition's own
     * raise judged with the config's new value. The field is the `minGroupSize` that changed.
     */
    | "min_group_size_lowered";
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
  /** DR-41: what each task type's own rules would leave out of the new config's policy. See WorkflowPolicyNarrowing. */
  readonly policyNarrowings: readonly WorkflowPolicyNarrowing[];
  /** The new config as parsed. */
  readonly config: CodarynConfig;
}

/**
 * DR-41: a task type whose own policy leaves part of the config's policy out of its quick runs
 * (workflowPolicyNarrowings: a command rule dropped or kept in part, a plan action kind, path token
 * restoring). Kinds and counts only, never a rule, a command or a path. Built-in task types first,
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
  /** G-A: task type ids the config file defines, in the file's order. */
  readonly workflows: readonly string[];
  /** G-A BUILTIN_WORKFLOW_IDS: the built-in task types, available with or without a config file. */
  readonly builtinWorkflows: readonly string[];
  /** N-8, G-A: each profile with the task type it uses when the task names none (`workflowRef`), or null; file order. */
  readonly profileWorkflows: readonly { readonly profile: string; readonly workflowRef: string | null }[];
  /**
   * Whether the key of the provider a quick run would use is set (SP-6: the config's `provider`,
   * else anthropic; ANTHROPIC_API_KEY or OPENAI_API_KEY). Never its value (C-1).
   */
  readonly keyAvailable: boolean;
  /** DR-41: what each task type's own rules leave out of this config's policy. See WorkflowPolicyNarrowing. */
  readonly policyNarrowings: readonly WorkflowPolicyNarrowing[];
  /** U-215 (DR-69 bundle A): the config's unreadable paths and group size k, for the settings screen. See SettingsPrivateData. */
  readonly privateData: SettingsPrivateData;
}

/**
 * U-215 (DR-69 bundle A, DR-70): the config's own private data settings, as the settings screen shows
 * and changes them (an edit applied to the config, then proposeSettingsChange, which judges taking an
 * entry away and lowering k as widenings, U-204). From the config's `policy` only: a profile's, a
 * task type definition's and a task file's own entries and k are not here.
 */
export interface SettingsPrivateData {
  /** The config's `policy.unreadablePaths`, in the file's order; empty when it has none. */
  readonly unreadablePaths: readonly string[];
  readonly minGroupSize: {
    /** The config's `policy.minGroupSize`, or null when it sets none. */
    readonly configured: number | null;
    /** What a run gets from the config alone (effectiveMinGroupSize: never below 5); a profile, a definition or a task file may raise it. */
    readonly effective: number;
    /** The values any source may set (MIN_GROUP_SIZE_LIMITS: whole numbers), so the window needs no copy of the contract's numbers. */
    readonly min: number;
    readonly max: number;
  };
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
   * DR-2: the task type definition to use (`--workflow`, GT 4.2), passed to the CLI's quick form. A
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
   * C-6a: every string in it is masked again with the run's gateway, its closed words too, so a
   * registered value that matched one changes it; RunObserver.onStoredRecord gives the record as stored.
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

export type AppCallOutcome<T> = { readonly ok: true; readonly output: T } | { readonly ok: false; readonly error: AppError };

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
 * U-234 (R-107 O-1): how a changes view may be given up. `signal`, once aborted, ends the waits of a
 * read in a burst of changes (U-213: up to GUARD_PAUSES_MS, 750 ms, per file) and starts no try more;
 * a file still changing is then `unreadable`, as when its tries ran out. Absent: the reads wait.
 */
export interface ChangesOptions {
  readonly signal?: AbortSignal;
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
   * R-14 L-3: `--workflow` (G-F, GT-D1): the task type the workspace form resolves to, so a plan made
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

/** U-172 (DR-72, GUI text editing): a text file of the workspace these settings resolve to, for a person (adapter-contract 5.15). */
export interface ReadWorkspaceTextRequest {
  /** The workspace, the values registered now for masking, the protected paths and the files the settings name (DR-17, U-17). */
  readonly settings: TaskForm;
  /** Plain relative segments joined by "/", as a listing's names give them (workspace-text.ts isWorkspaceFile). */
  readonly path: string;
}

/**
 * U-172: the file's line ending. `none`: no line break at all. `mixed`: CRLF with LF, or a CR alone;
 * such a file is read only (a textarea gives LF everywhere, so one ending could not be put back).
 */
export type WorkspaceTextLineEnding = "lf" | "crlf" | "none" | "mixed";

/**
 * U-172 (DR-72): why an opened file cannot be edited here, in this order:
 * - `masked`: the registered values, a key value or a key shape are in it (the shown text is not the file's);
 * - `control_characters`: a control, line separator or bidirectional character is shown replaced;
 * - `mixed_line_endings`: see WorkspaceTextLineEnding;
 * - `protected`: the effective policy's protected paths cover it (first version: read only);
 * - `settings_file`: the config, task or variables file these settings name;
 * - `read_only`: the file itself cannot be written (its read-only attribute or permissions);
 * - `hard_link`: it has more than one name; an atomic write would part them;
 * - `workspace_locked`: a run, apply or revert holds the workspace now.
 */
export type WorkspaceTextReadOnlyReason =
  | "masked"
  | "control_characters"
  | "mixed_line_endings"
  | "protected"
  | "settings_file"
  | "read_only"
  | "hard_link"
  | "workspace_locked";

/**
 * U-172: the file as shown, or why it is not opened: `refused` (outside the root, the state
 * directory, a name the workspace rules reject, a link or junction on the way), `not_found`,
 * `not_file`, `too_large` (more than MAX_READ_BYTES), `not_text` (not UTF-8, or a NUL byte),
 * `unreadable`, `mask_failed`. A file not opened gives no text.
 */
export type WorkspaceText =
  | {
      readonly kind: "workspace_text";
      readonly status: "opened";
      /** The path asked for. */
      readonly path: string;
      /**
       * The text as shown: without the BOM, every CRLF as LF, then masked with the values registered
       * now, key values and key shapes hidden, and control characters replaced (LF and TAB kept).
       * When `editable`, it is exactly the file's text (BOM and CRLF aside): showing it changed
       * nothing, and showing it again changes nothing.
       */
      readonly text: MaskedText;
      readonly masking: "current_secrets";
      /** Masking (the registered values, key values, key shapes) changed the text. */
      readonly masked: boolean;
      readonly protected: boolean;
      readonly lineEnding: WorkspaceTextLineEnding;
      /** The file starts with a byte order mark (kept on a write). */
      readonly bom: boolean;
      /** SHA-256 of the bytes read: the `baseDigest` a write needs. */
      readonly digest: ContentHash;
      readonly bytes: number;
      readonly editable: boolean;
      /** Empty when `editable`. */
      readonly readOnlyReasons: readonly WorkspaceTextReadOnlyReason[];
    }
  | {
      readonly kind: "workspace_text";
      readonly status: "not_found" | "not_file" | "refused" | "too_large" | "not_text" | "unreadable" | "mask_failed";
      readonly path: string;
    };

/** U-172: a person's edit of a file read with readWorkspaceText (adapter-contract 5.15). */
export interface WriteWorkspaceTextRequest {
  readonly settings: TaskForm;
  readonly path: string;
  /** The whole new text as the window has it: LF line breaks (a textarea's), no BOM. */
  readonly text: string;
  /** The `digest` readWorkspaceText gave (or the last write's): the file must still be those bytes. */
  readonly baseDigest: string;
}

/** U-172: what in a new text keeps it from being written (the editor never holds text that showing would change). */
export type WorkspaceTextProblem =
  /** The registered values, a key value or a key shape: masking would change it. */
  | "masked"
  /** A CR or another control, line separator or bidirectional character. */
  | "control_characters"
  /** More than MAX_READ_BYTES once its line ending and BOM are put back. */
  | "too_large";

/**
 * U-172: the write's outcome.
 * - `written`: atomically; `digest` is the file's now (the next write's base).
 * - `unchanged`: the text is the file's already; nothing was written.
 * - `conflict`: the file is not the bytes of `baseDigest` (another editor or a run changed it).
 * - `workspace_locked`: a run, apply or revert holds the workspace; nothing was judged or written.
 * - `not_editable`: judged again now, it cannot be edited here (`readOnlyReasons`).
 * - `text_refused`: the new text cannot be written (`textProblems`).
 * - `not_found` .. `mask_failed`: as readWorkspaceText's (`refused` also when a folder on the path
 *   changed during the write's checks; nothing was written); `write_failed`: the write did not happen.
 * - `path_changed` (V-1 H-1): right after the rename a folder on the path is not the one opened, or
 *   the file there is not the one written. A swap in the instant before the rename cannot be
 *   prevented (no rename by folder handle in Node); it is told: where the text went cannot be said.
 * Nothing goes into the run records. `lockLeft`: the lock could not be taken back, the release failed
 * or answered false (told, never hidden).
 */
export interface WorkspaceTextWritten {
  readonly kind: "workspace_text_write";
  readonly status:
    | "written"
    | "unchanged"
    | "conflict"
    | "workspace_locked"
    | "not_editable"
    | "text_refused"
    | "not_found"
    | "not_file"
    | "refused"
    | "too_large"
    | "not_text"
    | "unreadable"
    | "mask_failed"
    | "write_failed"
    | "path_changed";
  readonly path: string;
  /** `written` and `unchanged`: the file's digest now. Null otherwise. */
  readonly digest: ContentHash | null;
  readonly readOnlyReasons: readonly WorkspaceTextReadOnlyReason[];
  readonly textProblems: readonly WorkspaceTextProblem[];
  readonly lockLeft: boolean;
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

/** U-91 (GUI 3.9, DR-21, adapter-contract 5.14): a pending plan checked before it is applied. */
export interface CheckApplyRequest {
  /** The apply's settings (DR-5, DR-12): its policy and planActions judge the actions. */
  readonly settings: TaskForm;
  /** The plan run, by its own id ("latest" is not taken). */
  readonly planRunId: string;
  /** The digest of the plan shown, or its first MIN_PLAN_DIGEST_PREFIX (12) or more characters. Another plan is plan_not_approved. */
  readonly digest: string;
}

/**
 * U-91: what the apply's preflight would find now. Indexes, codes and counts only: the paths are the
 * plan view's (masked), matched by index. Not a consent (DR-21) and not a promise: the apply checks
 * again, and a file changed in between ends it as plan_stale.
 */
export interface PlanCheck {
  readonly kind: "plan_check";
  /**
   * U-196 (DR-69 B-3, B-4): present for a run plan (plan.json `kind: "changes"`), as ChangesPlanOutput's
   * `planKind`. Then `problems` are the planned files the gate of the run that carries the plan out
   * would deny as a write ("denied", by the file's index in the plan view); whether a file still fits
   * the plan is the engine's check before its first model request. No lock, probe or move is made:
   * `unsafeMoves` is empty, `inventoryLimitReached` false, `probesLeft` and `probesRemoved` 0, and
   * `lockLeft` false. Absent: a plan of mode apply, as before.
   */
  readonly planKind?: "changes";
  readonly planRunId: string;
  /** The full digest of the plan checked. */
  readonly digest: ContentHash;
  /** When it was checked (ISO 8601 UTC). */
  readonly checkedAt: string;
  /** Actions that cannot be applied (0-based index), judged as the apply's plan_checked.problems. */
  readonly problems: readonly { readonly index: number; readonly problem: PlanItemProblem }[];
  /** DR-21: actions that could only be made unsafely (no hard links there); the apply needs the person's consent for them. */
  readonly unsafeMoves: readonly number[];
  /** DR-6: the workspace has more files than the inventory lists, so the apply could not be verified. */
  readonly inventoryLimitReached: boolean;
  /** Hard link probes this check could not take back (normally 0), earlier ones it found included: each is a second name of a source file. */
  readonly probesLeft: number;
  /**
   * R-81 L1: probes an ended check or apply had left (in the state directory or the plan's source
   * folders), removed by this check. Only a second name of another file (nlink 2 or more) is removed;
   * a file of a probe name that is the only name of its content is kept and counted in `probesLeft`.
   */
  readonly probesRemoved: number;
  /** True when the workspace lock this check took could not be released: runs are refused until it is. */
  readonly lockLeft: boolean;
}

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
  /**
   * C-7b: every string in it is masked again, its closed words too, as in a run's record event;
   * ApplyObserver.onStoredRecord gives the record as stored.
   */
  | { readonly kind: "record"; readonly record: ApplyJournalRecord }
  | { readonly kind: "notice"; readonly text: MaskedText };

export interface ApplyObserver {
  /** Called synchronously for each event of a plan of moves. Exceptions are ignored. */
  onEvent?(event: ApplyEvent): void;
  /**
   * U-218 (DR-69 B-4): a run plan (plan "run") is carried out by a model run; its events, as
   * RunObserver.onEvent gets a run's (records masked again, notices). Exceptions are ignored.
   */
  onRunEvent?(event: RunEvent): void;
  /** U-218: that run's permission questions, as RunObserver.confirm (U-108: absent or failing is `dismissed`). */
  confirm?(request: ConfirmRequest, signal: AbortSignal): Promise<ConfirmAnswer>;
  /**
   * C-7b (PM D-4): each record of the apply run as its journal stored it, by RunObserver.onStoredRecord's
   * rule: in `seq` order, synchronously right after it was stored and before onEvent gets its copy,
   * with the engine's masking only (free text masked, closed words as written). For an adapter that
   * draws people's lines in this process (the CLI's apply progress lines), masking each drawn line
   * with ApplyFacts.mask. A host that hands anything of a run to a window or over IPC uses onEvent
   * and never this; the GUI's engine host does not (u292 test). Exceptions are ignored.
   */
  onStoredRecord?(record: ApplyJournalRecord): void;
  /**
   * C-7b: the same for the run that carries out a run plan: its records as stored, by
   * RunObserver.onStoredRecord's rule, its drawn lines masked with RunFacts.mask. Never to a window
   * or over IPC (u292 test). Exceptions are ignored.
   */
  onStoredRunRecord?(record: JournalRecord): void;
}

/**
 * C-7b (the CLI migration, PM D-2): what the app layer's apply life asks and tells the CLI's apply.
 * The CLI and CodarynApp.applyPlan call the same life; the app's applyPlan gives `observer` only, so
 * an adapter's apply asks nothing: it is approved before the call (DR-1, DR-3) and its consent to
 * unsafe moves comes in its request (DR-21). No CodarynApp method takes these hooks. A question hook
 * that throws counts as a no; any other hook's throw is ignored. None of them changes what is
 * applied, and nothing a hook gets is in the apply's result, result.json, a record or an error
 * (u309 test).
 */
export interface ApplyLifeHooks {
  readonly observer?: ApplyObserver;
  /**
   * Once, after the refusals that come before anything is asked (a plan already applied, a
   * records-changed mark, an adapter's consent checks) and before the approval: what the CLI draws
   * with.
   */
  ready?(facts: ApplyFacts): void;
  /**
   * The approval question (6.4 1), only when no digest was given: the view as the question shows it,
   * and true approves (channel cli-tty). Absent: plan_not_approved, an apply needs --digest. Asked
   * before the lock and the cancel source, as now. For a plan of moves, the workspace listing for
   * the view's inventory limit runs before it and takes the apply's cancel (R-18 L1).
   */
  approve?(view: ApplyApprovalView): Promise<boolean>;
  /**
   * A plan of moves: after each apply run ended (its result.json written, its lock released) and
   * before any question after it. The CLI writes that apply's end summary here, so DR-21's consent
   * question comes after the first summary.
   */
  applyEnded?(end: ApplyRunEnd): void;
  /**
   * DR-21: after an apply of a plan of moves ended as consent_required with no consent given: may a
   * second apply make these unsafe moves anyway, for that apply only? true starts it, with channel
   * cli-tty and a new apply run. Absent, or false: the first apply's end stands. Never for a run plan.
   */
  consentToUnsafeMoves?(unsafeMoves: number): Promise<boolean>;
  /** A run plan: once its run is assembled, before its first record; what the CLI draws that run with. */
  runReady?(facts: RunFacts): void;
}

/** C-7b: what an apply's drawing needs, given once by ApplyLifeHooks.ready. */
export interface ApplyFacts {
  /** "moves": a plan of moves and discards (plan "apply"); "changes": a run plan (plan "run"). */
  readonly planKind: "moves" | "changes";
  /**
   * U-131 (N5): the plan run ran with another task than this apply's. The CLI says it before the
   * approval question and right after the apply's start (apply_started, or the run plan's start).
   */
  readonly otherTask: boolean;
  /**
   * The apply's masking: the plan view's gateway, with which the CLI masks its apply progress lines,
   * its end summary and DR-51's shown workspace now (a run plan's run masks with its own: RunFacts.mask).
   * Null when the text cannot be masked: write nothing then. Never for a model or a record, never to a
   * window or over IPC.
   */
  readonly mask: (text: string) => MaskedText | null;
}

/** C-7b: the approval question's view, the plan output `codaryn plan --json` gives, as the question shows it. */
export type ApplyApprovalView =
  /** A plan of moves, with the inventory limit as listed for this question and the agent's summary (U-14) when it can be read. */
  | { readonly kind: "moves"; readonly plan: PlanOutput }
  /** A run plan (U-228): its view, and whether the task allows commands (the note changesApprovalText adds). */
  | { readonly kind: "changes"; readonly plan: ChangesPlanOutput; readonly commandsAllowed: boolean };

/**
 * C-7b: one apply run of a plan of moves, ended. Its result as written to result.json, and whether
 * its lock was left (U-220), for the CLI's end summary only. CodarynApp.applyPlan gives no
 * applyEnded, so ApplyOutcome stays without that lockLeft (PM: a change the GUI would show, after
 * the migration).
 */
export interface ApplyRunEnd {
  readonly result: ApplyResult;
  readonly lockLeft: boolean;
}

/**
 * C-7b: a run's facts for the adapter that draws it (a run plan's run through ApplyLifeHooks.runReady),
 * as RunHandle gives a run's.
 * - runId: the run's id.
 * - configLanguage (N-4): the config's `language`, or null when it sets none. A run plan's run is
 *   drawn in it, as a run is. The apply's own question, lines and summary are not: the CLI picks them
 *   without the config's language, as before.
 * - defaultConfig (N-1): the default config location's fixed display form when the config came from it.
 * - mask: the run's own masking (its gateway), as RunHandle.mask.
 */
export interface RunFacts {
  readonly runId: string;
  readonly configLanguage: MessageLanguage | null;
  readonly defaultConfig: DefaultConfigDisplay | null;
  readonly mask: (text: string) => MaskedText | null;
}

/**
 * DR-2: an apply's end. U-218: a run plan's apply is a model run, so its outcome is that run's
 * EngineResult (kind "run", with planRunId and planDigest; the run's verifiers and changes) and, as a
 * run's (U-193), `lockLeft` when its lock could not be released at its end.
 */
export type ApplyOutcome =
  | { readonly ok: true; readonly output: ApplyResult }
  | { readonly ok: true; readonly output: EngineResult; readonly lockLeft?: true }
  | { readonly ok: false; readonly error: AppError };

/** DR-2: applying has the same event and cancel channel as a run. */
export interface ApplyHandle {
  /** The run that applies: the apply run of a plan of moves, or (U-218) the run that carries out a run plan. */
  readonly runId: string;
  cancel(): void;
  /** Never rejects; resolves after the apply's result.json is written and the lock released. */
  readonly done: Promise<ApplyOutcome>;
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

/** The reasons an apply run ends with (G-A APPLY_REASONS_BY_STATUS). */
export type ApplyReason = ApplyResult["reason"];
