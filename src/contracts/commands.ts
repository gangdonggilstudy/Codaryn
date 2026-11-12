/**
 * Output objects of `codaryn report` (U-5), `codaryn doctor` (U-6), `codaryn models` (Y-1),
 * `codaryn init` (N-2) and `codaryn runs` (N-7). All print human-readable text on stdout by default and these objects as one JSON line with
 * `--json`. Errors that stop any of them print CliErrorOutput as one JSON line, as `run` and
 * `revert` do.
 */

import type { FileChangeRecord, EngineResult, RunReason, TerminalRunStatus } from "./engine.js";
import type { DefaultConfigDisplay } from "./config.js";
import type { DoctorText, MessageLanguage, RunId } from "./human.js";
import type { IntegrityPhase } from "./integrity.js";
import type { ModelInfo } from "./model.js";
import type { Limits, ModelProviderName } from "./task.js";
import type { ApplyResult, ApprovalChannel, PlanItemProblem } from "./plan.js";
import type { ContentHash, MaskedText } from "./text.js";
import type { VerifierResult } from "./verify.js";
import type { ReviewRecord } from "./workflow.js";

/**
 * `codaryn report --workspace <dir> --run <runId> [--json]` reads
 * `<root>/.codaryn/runs/<runId>/result.json` and `journal.jsonl` and nothing else. Both hold
 * masked text only, and the report uses nothing but them. It changes nothing and takes no lock.
 *
 * - complete: result.json and the journal were both read.
 * - incomplete: the run has no result.json (it is still running, or it stopped without writing
 *   one). The report is built from the journal alone, and a last journal line without its line
 *   feed is ignored as not yet written.
 *
 * Errors: `invalid_arguments`; `workspace_not_found`; `run_not_found` (no journal for that run);
 * `invalid_run_record` (a file cannot be read or parsed, is larger than MAX_REPORT_FILE_BYTES, or
 * names another run). The report is only as reliable as these files: commands allowed during the
 * run could have changed them, since the state directory is closed to the file tools only.
 *
 * G-G (DR-12): an apply run (its journal starts with `apply_started`) is reported as
 * ApplyReportOutput (`runKind: "apply"`) from its result.json (ApplyResult) and its journal
 * (ApplyReportJournalSummary). A run that ended as `needs-input`/`awaiting_review` also carries the
 * person's verdict (RunReportOutput.verdict). The app layer and the GUI use the same forms
 * (AnyReportOutput).
 */
export const REPORT_EXIT_CODES = { complete: 0, incomplete: 3 } as const;
export type ReportStatus = keyof typeof REPORT_EXIT_CODES;

/** Largest result.json or journal.jsonl the report reads (256 MiB). Larger is `invalid_run_record`. */
export const MAX_REPORT_FILE_BYTES = 256 * 1024 * 1024;

/** What the report takes from the run's journal. Every text field is masked as recorded. */
export interface ReportJournalSummary {
  /** From `run_started`. */
  readonly taskId: string;
  readonly workflow: MaskedText;
  readonly provider: ModelProviderName;
  readonly limits: Limits;
  /** Number of records read. */
  readonly records: number;
  /** `model_request` records. */
  readonly modelRequests: number;
  /** `tool_decision` records with `allowed: false`. */
  readonly deniedToolCalls: number;
  /** `repair_started` records. */
  readonly repairs: number;
  /** `verifier_result` records after the last `repair_started` (all of them when there was no repair). */
  readonly lastRound: readonly VerifierResult[];
  /** `file_changed` records in order, without `callId`. */
  readonly changes: readonly FileChangeRecord[];
  /** `integrity_checked` records in order. Empty when the run had no integrity check. */
  readonly integrityChecks: readonly { readonly phase: IntegrityPhase; readonly changed: readonly MaskedText[] }[];
  /** From `run_finished`, or null when the journal has none. */
  readonly finished: { readonly status: TerminalRunStatus; readonly reason: RunReason } | null;
}

/**
 * Printed by `codaryn report --json`. Without `--json` the same content is printed as Markdown.
 * N-24 (a): the Markdown shows each verifier by its number (1-based, in the order of the run's
 * verifier list), never by its id; the id stays in this JSON only. Key shapes are hidden in both.
 */
export interface ReportOutput {
  readonly schemaVersion: 1;
  readonly kind: "report";
  readonly runId: string;
  readonly status: ReportStatus;
  readonly exitCode: number;
  /** The run's result.json, or null when it has none (`incomplete`). */
  readonly result: EngineResult | null;
  readonly journal: ReportJournalSummary;
}

/**
 * N-D (5th round): a run's report with the person's review verdict. `verdict` is present only for
 * a run that ended as `needs-input`/`awaiting_review`: its review.json (ReviewRecord), or null
 * before a verdict, or when the record cannot be read (which never stops the report). Moved from
 * the CLI (`src/cli/report.ts`) as it was.
 */
export interface RunReportOutput extends ReportOutput {
  readonly verdict?: ReviewRecord | null;
}

/**
 * DR-12 (G-G): what the report takes from an apply run's journal, which starts with
 * `apply_started` (ApplyJournalEvent). Text fields are masked as recorded. Moved from the CLI
 * (`src/cli/report.ts`) as it was.
 */
export interface ApplyReportJournalSummary {
  readonly planRunId: string;
  readonly taskId: string;
  readonly digest: ContentHash;
  readonly approval: ApprovalChannel;
  /** DR-21: the channel of the person's consent to unsafe moves, or null for none. */
  readonly unsafeMoveConsent: ApprovalChannel | null;
  /** Number of actions in the plan (`apply_started.actions`). */
  readonly actions: number;
  readonly maxDurationMs: number;
  /** Number of records read. */
  readonly records: number;
  /** The preflight (`plan_checked`), or null when the journal has none. */
  readonly checked: { readonly problems: number; readonly inventoryLimitReached: boolean; readonly unsafeMoves: number } | null;
  /** R-9 I-4: `plan_item_started` records. */
  readonly started: number;
  readonly moved: readonly { readonly index: number; readonly from: MaskedText; readonly to: MaskedText; readonly unsafe: boolean }[];
  readonly discarded: readonly { readonly index: number; readonly path: MaskedText; readonly stored: string }[];
  readonly failed: readonly { readonly index: number; readonly problem: PlanItemProblem }[];
  /** `verifier_result` records: the inventory check first, then the task's verifiers. */
  readonly lastRound: readonly VerifierResult[];
  readonly integrityChecks: readonly { readonly phase: IntegrityPhase; readonly changed: readonly MaskedText[] }[];
  /** From `run_finished`, or null when the journal has none. */
  readonly finished: { readonly status: TerminalRunStatus; readonly reason: RunReason } | null;
}

/**
 * DR-12: printed by `codaryn report --json` for an apply run; without `--json` as Markdown. Moved
 * from the CLI (`src/cli/report.ts`) as it was.
 */
export interface ApplyReportOutput {
  readonly schemaVersion: 1;
  readonly kind: "report";
  /** Tells an apply run's report from a run's (ReportOutput has no such field). */
  readonly runKind: "apply";
  readonly runId: string;
  readonly status: ReportStatus;
  readonly exitCode: number;
  /** The apply run's result.json, or null when it has none (`incomplete`). */
  readonly result: ApplyResult | null;
  readonly journal: ApplyReportJournalSummary;
}

/**
 * What `codaryn report --json` prints, and what the app layer and the GUI read: a run's report, or
 * an apply run's (told apart by `runKind: "apply"`, which a run's report does not have).
 */
export type AnyReportOutput = RunReportOutput | ApplyReportOutput;

/**
 * `codaryn doctor [--config <config.json>] [--vars-file <path>] [--task <task.json> | --workspace <dir>] [--profile <name>] [--json]`
 * checks what a run would need without running one: no network access, no model request, no
 * write. One check per id, in this order. A check that has nothing to look at is `skipped`.
 *
 * `--task` and `--workspace` cannot be combined (`invalid_arguments`, W-5): a task file names its
 * own workspace (`workspaceRoot`). `--profile` (N-8) checks the config with that profile applied.
 * `language` (N-20) says which language the human output uses and where that came from; it warns
 * when CODARYN_LANG is set to something other than `ko` or `en`. `lock` (N-25 a) reads
 * `<workspace>/.codaryn/lock.json` without changing it: none, held by a live process (`warn`, with
 * the hint to remove the file when no Codaryn is running), left by a process that has ended
 * (`ok`: the next run reclaims it), or unreadable (`warn`); `skipped` without a workspace. Because
 * a process id can be given to another process later, "held" can be wrong (architecture A-6). The
 * workspace checks (`workspace`, `file_locations`,
 * `install_dir`, and the position part of `integrity_paths`) use the task's `workspaceRoot` or
 * `--workspace`; with neither they are `skipped`.
 */
export const DOCTOR_CHECK_IDS = [
  "node_version",
  "config_file",
  "vars_file",
  "task_file",
  "api_key",
  "model",
  "limits",
  "file_locations",
  "commands",
  "workspace",
  "install_dir",
  "integrity_paths",
  "language",
  "lock",
] as const;
export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number];

export const DOCTOR_CHECK_STATUSES = ["ok", "warn", "fail", "skipped"] as const;
export type DoctorCheckStatus = (typeof DOCTOR_CHECK_STATUSES)[number];

export interface DoctorCheck {
  readonly id: DoctorCheckId;
  readonly status: DoctorCheckStatus;
  /**
   * One line built from fixed text, field positions (such as `policy.commands[2]`) and counts.
   * Never a value read from a file or the environment: the API key is reported as present or
   * absent only, and paths, names and contents are not echoed.
   */
  readonly message: string;
  /**
   * N-21: the same outcome as a catalog message id and its parameters, used for the human output
   * in the chosen language. Absent only in outputs from before N-21.
   */
  readonly text?: DoctorText;
}

/** `warn`: a run may work but something needs attention. `fail`: a run would stop. */
export const DOCTOR_EXIT_CODES = { ok: 0, warn: 3, fail: 1 } as const;
export type DoctorStatus = keyof typeof DOCTOR_EXIT_CODES;

/** Printed by `codaryn doctor --json`. Without `--json` one text line per check. */
export interface DoctorOutput {
  readonly schemaVersion: 1;
  readonly kind: "doctor";
  /** The worst check: `fail` over `warn` over `ok`. `skipped` counts as `ok`. */
  readonly status: DoctorStatus;
  readonly exitCode: number;
  /** One per DOCTOR_CHECK_IDS entry, in that order. */
  readonly checks: readonly DoctorCheck[];
}

/**
 * `codaryn models [--config <config.json>] [--vars-file <path>] [--json] [--use <number|id>]`
 * (Y-1 to Y-3). Lists the models the key can use through `listAnthropicModels` (a real API
 * request) and can write one of them into the config file's `model`. No workspace is needed.
 *
 * - Key and API address: the same rules as `run` (ANTHROPIC_API_KEY, `--vars-file`, `--config` or
 *   CODARYN_CONFIG, CODARYN_API_BASE_URL). The key goes into the request header only.
 * - Errors (CliErrorOutput): `invalid_arguments`, `invalid_config`, `key_in_file`,
 *   `provider_not_configured` (no key; nothing is sent), `model_list_failed` (the API request
 *   failed; the message names the ModelErrorKind, nothing is written), `config_write_failed`
 *   (the config file could not be written; it is left as it was).
 * - `--use` takes a 1-based number from the list or a listed id. Anything else is
 *   `invalid_arguments` and nothing is written. It needs `--config` (or CODARYN_CONFIG).
 */
export const MODELS_STATUSES = ["listed", "selected"] as const;
/** listed: the list only. selected: a model was written into the config file. */
export type ModelsStatus = (typeof MODELS_STATUSES)[number];
export const MODELS_EXIT_CODES: { readonly [S in ModelsStatus]: number } = { listed: 0, selected: 0 };

/** One listed model and the number `--use` accepts for it. */
export interface ModelsListEntry extends ModelInfo {
  /** 1-based position in the list. */
  readonly number: number;
}

/** Printed by `codaryn models --json`. Without `--json` a numbered table. */
export interface ModelsOutput {
  readonly schemaVersion: 1;
  readonly kind: "models";
  readonly status: ModelsStatus;
  readonly exitCode: number;
  /** In the API's order. */
  readonly models: readonly ModelsListEntry[];
  /**
   * The model a run without a task `model.model` would use now: CODARYN_MODEL, else the config
   * file's `model`. `listed` says whether that id is in `models`. Null when neither is set.
   */
  readonly current: { readonly id: string; readonly source: "CODARYN_MODEL" | "config"; readonly listed: boolean } | null;
  /**
   * The model written by `--use` or chosen at the terminal prompt, or null. `created`: the config
   * file did not exist and was created with `schemaVersion` and `model` only.
   * `overriddenBy`: CODARYN_MODEL is set, so runs keep using it until it is unset.
   */
  readonly selected: { readonly id: string; readonly created: boolean; readonly overriddenBy: "CODARYN_MODEL" | null } | null;
}

/**
 * `codaryn init [--config <file>] [--workspace <dir>] [--json]` (N-2, N-10). Creates a config
 * file at the default location (N-1), or at `--config` when given. It never overwrites: a file
 * already there stops it as `config_exists` with nothing written.
 *
 * - Questions are asked only when stdin and stderr are terminals, and go to stderr so stdout keeps
 *   one output. Otherwise nothing is asked and only the defaults are written (`interactive: false`).
 * - Written: `schemaVersion`, `model` (a model chosen from `codaryn models`' list, else
 *   MODEL_PLACEHOLDER), `maxOutputTokens` (INIT_DEFAULT_MAX_OUTPUT_TOKENS), `limits`
 *   (INIT_DEFAULT_LIMITS), `policy` (DENY_ALL_POLICY plus the command rules and protected paths the
 *   user accepted one by one, every rule with `allowExtraArgs: false`), and `language` when one was
 *   chosen.
 * - Suggestions come from `--workspace` only: command rules for a fixed set of package.json
 *   script names, and protected paths for a fixed set of names that exist there. Only those fixed
 *   names are shown; script bodies and other file content are never printed. When `--workspace` is
 *   given, a target inside it is refused (S-1, `invalid_config`).
 * - The key is never asked for, read from a file or written (C-1, N-10). The output says only
 *   whether ANTHROPIC_API_KEY is set and how to register it as a user environment variable.
 * - The model list is requested only when the key is set and the questions are asked; that is a
 *   real API request, as with `codaryn models`. Its failure leaves the placeholder.
 * - The directory is created when missing; the file is created exclusively (it must not exist).
 *
 * Errors (CliErrorOutput): `invalid_arguments`; `invalid_config` (no default location, a network
 * or device path, inside `--workspace`); `config_exists`; `config_write_failed`.
 */
export const INIT_STATUSES = ["created", "declined"] as const;
/** created: the file was written. declined: the user answered no at the terminal; nothing was written. */
export type InitStatus = (typeof INIT_STATUSES)[number];
export const INIT_EXIT_CODES: { readonly [S in InitStatus]: number } = { created: 0, declined: 3 };

/** Printed by `codaryn init --json`. Without `--json` the same content as text. */
export interface InitOutput {
  readonly schemaVersion: 1;
  readonly kind: "init";
  readonly status: InitStatus;
  readonly exitCode: number;
  /**
   * Where the file is (or would have been) written. `display` is DEFAULT_CONFIG_DISPLAY's value
   * for the default location, or "--config" when the path came from the command line.
   */
  readonly config: { readonly source: "argument" | "default"; readonly display: DefaultConfigDisplay | "--config" };
  /** Whether questions were asked. */
  readonly interactive: boolean;
  /** "selected": a listed model was written. "placeholder": MODEL_PLACEHOLDER was written. */
  readonly model: "selected" | "placeholder";
  /** The language written, or null (the file has no `language`). */
  readonly language: MessageLanguage | null;
  /** Number of command rules and protected paths written. */
  readonly commands: number;
  readonly protectedPaths: number;
  /** Whether ANTHROPIC_API_KEY is set. Never its value. */
  readonly keySet: boolean;
  /** "CODARYN_CONFIG": that variable is set, so runs read its file instead of the one written. */
  readonly overriddenBy: "CODARYN_CONFIG" | null;
}

/**
 * `codaryn runs [--workspace <dir>] [--limit <n>] [--json]` (N-7). Lists the runs recorded in
 * `<workspace>/.codaryn/runs/`, newest first. `--workspace` defaults to the current directory,
 * `--limit` to RUNS_DEFAULT_LIMIT (1 to RUNS_MAX_LIMIT). It changes nothing, takes no lock and
 * does not create the state directory: a workspace without one has no runs (exit 0).
 * Errors (CliErrorOutput): `invalid_arguments`, `workspace_not_found`, `invalid_run_record`
 * (N-22: `.codaryn` or `.codaryn/runs` is a link or cannot be listed; the same for `--run latest`).
 * `parseRunsArgs` and RUNS_USAGE live in `src/cli/runs.ts` (N-22).
 */
export const RUNS_DEFAULT_LIMIT = 20;
export const RUNS_MAX_LIMIT = 1000;
export const RUNS_EXIT_CODES = { listed: 0 } as const;

/**
 * N-7: `--run latest` in `report` and `revert` stands for the first `checked` run `listRuns`
 * returns. Damaged runs are never chosen. No checked run: `run_not_found`.
 * N-18: when `<root>/.codaryn/runs/latest` exists (a run directory literally named so), the
 * alias is not used: the command stops with `invalid_arguments` and changes nothing, because it
 * cannot tell which run was meant.
 */
export const LATEST_RUN_ALIAS = "latest";

/**
 * The fixed shape of a timestamp the run list accepts: ISO 8601 UTC with `Z`, optional
 * milliseconds, and a date `Date.parse` accepts. Anything else makes the entry damaged.
 */
export const RUN_TIMESTAMP_PATTERN_SOURCE = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?Z$";

/**
 * One run as `listRuns` reads it (N-16). A run is `checked` only when its records pass the same
 * kind of checks `report` makes; otherwise it is `damaged` and carries nothing but its id.
 *
 * Checks for `checked`:
 * - the run directory is a directory, not a link (junctions included), and its name is a run id;
 * - journal.jsonl's first record is `run_started` with `seq` 1, `runId` equal to the directory
 *   name, a `taskId` matching TASK_ID_PATTERN_SOURCE and an `at` matching RUN_TIMESTAMP_PATTERN_SOURCE;
 * - result.json, when present, has `kind` "run", the same `runId`, a terminal `status`, a
 *   `reason` allowed for that status (RunReasonByStatus), `exitCode` equal to RUN_EXIT_CODES[status]
 *   and `changes` as an array;
 * - revert.json, when present, has `kind` "revert_record", the same `runId`, `at` matching
 *   RUN_TIMESTAMP_PATTERN_SOURCE, `status` "complete" or "partial";
 * - each file is read at most MAX_REPORT_FILE_BYTES; a missing result.json or revert.json is not
 *   damage (the fields are null), but a result.json that cannot be read, parsed or checked is.
 * - N-23 (g): a revert.json that cannot be read, parsed or checked does not make the run damaged:
 *   the entry stays `checked` with `reverted: null` and `revertRecordDamaged: true`, and
 *   `revert` goes on without the record. N-26: a `damaged` run is refused by `revert`
 *   (`invalid_run_record`) even when named by its id.
 * - N-22: the checks are at least as strict as `report`'s: `run_started` also has
 *   `schemaVersion` 1 and a known provider; result.json also has `schemaVersion` 1, a known
 *   provider, the journal's `taskId`, and `changes` entries of the FileChangeRecord shape.
 * Strings put into an entry are only those checked against these patterns, so no control
 * character can be in them. The patterns allow a key-shaped run id or task id, so every output
 * (the JSON line and the table) hides key shapes, as `report` does (N-24 b, review R-3 R3-2).
 */
export type RunListEntry =
  | {
      readonly state: "checked";
      readonly runId: RunId;
      /**
       * G-A (N-C request): "run" for a run (journal starts with `run_started`), "apply" for an apply
       * run (journal starts with `apply_started`, ApplyJournalEvent). Absent means "run": lists
       * written before G-A have no apply runs.
       */
      readonly kind?: "run" | "apply";
      /** G-A: for an apply run, the plan run it applied (`apply_started.planRunId`). Absent for a run. */
      readonly planRunId?: RunId;
      /** `at` of `run_started` (an apply run: of `apply_started`). */
      readonly startedAt: string;
      /** `taskId` of `run_started` (an apply run: of `apply_started`). JSON only: the human table does not show it (N-14). */
      readonly taskId: string;
      /** From result.json; null when there is none (still running, or stopped without one). */
      readonly status: TerminalRunStatus | null;
      /**
       * A run's reason is checked against RUN_REASONS_BY_STATUS, an apply run's against
       * APPLY_REASONS_BY_STATUS (plan.ts).
       */
      readonly reason: RunReason | null;
      /**
       * Number of distinct files changed: the distinct `path`s of result.json's `changes`, as the
       * end-of-run summary counts them (N-23 d, N-D 5). An apply run: the number of `applied`
       * actions. Null without result.json.
       */
      readonly changes: number | null;
      /** The last revert of this run, from its revert record; null when never reverted. */
      readonly reverted: { readonly at: string; readonly status: "complete" | "partial" } | null;
      /**
       * N-23 (g): the run has a revert record that failed the checks; it is shown apart and ignored.
       * Absent means false (entries built without the revert record check, as G-A's contract tests do).
       */
      readonly revertRecordDamaged?: boolean;
    }
  | { readonly state: "damaged"; readonly runId: RunId };

export interface ListRunsRequest {
  /** Real absolute path of the workspace root. */
  readonly workspaceRoot: string;
}

/**
 * `runs`: checked runs first, newest first by `startedAt` and then by run id, both descending;
 * damaged runs after them by run id, descending. Directory entries whose names are not run ids
 * are ignored.
 */
export interface RunListing {
  readonly runs: readonly RunListEntry[];
}

/**
 * Signature of `listRuns`, exported by `src/store/index.ts` (N-C). Reads only the state
 * directory: per run its result.json, the journal's first record and the revert record. Changes
 * nothing and creates nothing. Rejects only when the runs directory exists but cannot be listed.
 */
export type ListRuns = (request: ListRunsRequest) => Promise<RunListing>;

/** Printed by `codaryn runs --json`. Without `--json` a table (HumanOutput.runsText). */
export interface RunsOutput {
  readonly schemaVersion: 1;
  readonly kind: "runs";
  readonly status: keyof typeof RUNS_EXIT_CODES;
  readonly exitCode: number;
  /** At most `--limit` entries, in RunListing order. */
  readonly runs: readonly RunListEntry[];
  /** How many more runs there are beyond `--limit`. */
  readonly omitted: number;
}
