/**
 * Run states, exit codes, the engine entry point and the CLI output objects.
 */

import type { RevertOutcome } from "./changes.js";
import type { DoctorOutput, InitOutput, ModelsOutput, ReportOutput, RunsOutput } from "./commands.js";
import type { InputDiagnosticFile, SchemaFieldPath } from "./human.js";
import type { IntegrityChecker } from "./integrity.js";
import type { StateGuard } from "./state.js";
import type { Journal } from "./journal.js";
import type { ModelProvider } from "./model.js";
import type { PolicyGate } from "./policy.js";
import type { PrivacyGateway } from "./privacy.js";
import type { ModelProviderName, ResolvedTaskSpec } from "./task.js";
import type { ContentHash, MaskedText } from "./text.js";
import type { ToolRunner } from "./tool.js";
import type { VerifierResult, VerifierRunner } from "./verify.js";
import type { ApplyResult, PlanOutput } from "./plan.js";
import type { ReviewOutput } from "./workflow.js";

export const RUN_STATUSES = [
  "created",
  "running",
  "verifying",
  "done",
  "failed",
  "needs-input",
  "cancelled",
  "budget-exhausted",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_RUN_STATUSES = [
  "done",
  "failed",
  "needs-input",
  "cancelled",
  "budget-exhausted",
] as const;
export type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number];

/**
 * Allowed transitions. Any transition not listed here is rejected.
 * `verifying → running` is a repair: a failed verification goes back to the model (R-1).
 */
export const RUN_TRANSITIONS: { readonly [S in RunStatus]: readonly RunStatus[] } = {
  created: ["running", "cancelled"],
  running: ["verifying", "failed", "needs-input", "cancelled", "budget-exhausted"],
  verifying: ["running", "done", "failed", "needs-input", "cancelled", "budget-exhausted"],
  done: [],
  failed: [],
  "needs-input": [],
  cancelled: [],
  "budget-exhausted": [],
};

/** Why a run ended in its status. */
export interface RunReasonByStatus {
  /** Every configured verifier passed. */
  readonly done: "verified";
  /**
   * verifier_failed: a verifier failed and no repair is left (`maxRepairAttempts` used up, or 0).
   * repeated_failure: the same failure signature occurred `maxSameFailures` times in a row (R-3).
   */
  /**
   * G-A, apply runs only (plan.ts):
   * plan_stale: the plan cannot be applied to the workspace as it is now: the preflight found an
   * action that no longer fits or that the policy denies, the workspace is beyond the inventory
   * limit (DR-6), or the plan was already applied; nothing was moved. apply_incomplete: an action
   * failed while applying; the earlier ones stay done and `codaryn revert` undoes them.
   */
  /**
   * state_changed (DR-38): the run's records or the rest of the state directory changed during the
   * run other than by the run itself (a command, a command verifier or their child), or the run's
   * own records could not be checked. The run ends at once; see EngineDeps.stateGuard.
   */
  readonly failed: "verifier_failed" | "model_error" | "repeated_failure" | "plan_stale" | "apply_incomplete" | "state_changed";
  /**
   * protected_changed (U-2): an integrity check found protected material changed, or could not
   * show it unchanged (`unchecked` entries). The run is not repaired; see `EngineDeps.integrity`.
   * G-A: plan_pending: `propose_plan` stored a plan; nothing changed in the workspace. It waits for
   * a person's approval and `codaryn apply` (EngineResult.plan). awaiting_review: the workflow's
   * completion is `human_review` and its verifiers all passed (or there is none); a person records
   * a verdict with `codaryn review` (EngineResult.review). Neither is ever `done`.
   * consent_required (DR-21, apply runs only): the preflight found moves that could only be made
   * unsafely and the person gave no consent for this apply; nothing was moved.
   */
  readonly "needs-input":
    | "verifier_inconclusive"
    | "no_verifier"
    | "unknown_tool_outcome"
    | "protected_changed"
    | "plan_pending"
    | "awaiting_review"
    | "consent_required";
  readonly cancelled: "cancelled";
  readonly "budget-exhausted":
    | "max_model_turns"
    | "max_tool_calls"
    | "max_total_tokens"
    | "max_duration"
    | "usage_unknown";
}
export type RunReason = RunReasonByStatus[TerminalRunStatus];

/** Every RunReason, for lists that must cover them all (N-4 message ids). */
export const RUN_REASONS = [
  "verified",
  "verifier_failed",
  "model_error",
  "repeated_failure",
  "verifier_inconclusive",
  "no_verifier",
  "unknown_tool_outcome",
  "protected_changed",
  "cancelled",
  "max_model_turns",
  "max_tool_calls",
  "max_total_tokens",
  "max_duration",
  "usage_unknown",
  "plan_stale",
  "apply_incomplete",
  "plan_pending",
  "awaiting_review",
  "consent_required",
  "state_changed",
] as const satisfies readonly RunReason[];
/** Compile-time check that RUN_REASONS misses none. */
export type MissingRunReason = Exclude<RunReason, (typeof RUN_REASONS)[number]>;
const runReasonsComplete: [MissingRunReason] extends [never] ? true : false = true;
void runReasonsComplete;

/**
 * DR-16 (R-4 M-1): the reasons each end status may have, the one table every reader of result.json
 * and journals uses to check a recorded status and reason (report, the run list, human output).
 * Readers must not keep their own lists: a reason added here is then accepted everywhere at once.
 * It covers runs and apply runs (ApplyResult uses the same reasons).
 */
export const RUN_REASONS_BY_STATUS = {
  done: ["verified"],
  failed: ["verifier_failed", "model_error", "repeated_failure", "plan_stale", "apply_incomplete", "state_changed"],
  "needs-input": [
    "verifier_inconclusive",
    "no_verifier",
    "unknown_tool_outcome",
    "protected_changed",
    "plan_pending",
    "awaiting_review",
    "consent_required",
  ],
  cancelled: ["cancelled"],
  "budget-exhausted": ["max_model_turns", "max_tool_calls", "max_total_tokens", "max_duration", "usage_unknown"],
} as const satisfies { readonly [S in TerminalRunStatus]: readonly RunReasonByStatus[S][] };

/** Compile-time check that RUN_REASONS_BY_STATUS lists every reason of every status. */
export type MissingReasonByStatus = {
  [S in TerminalRunStatus]: Exclude<RunReasonByStatus[S], (typeof RUN_REASONS_BY_STATUS)[S][number]>;
}[TerminalRunStatus];
const reasonsByStatusComplete: [MissingReasonByStatus] extends [never] ? true : false = true;
void reasonsByStatusComplete;

/** Whether `reason` is one of `status`'s reasons (RUN_REASONS_BY_STATUS). Pure. */
export function isReasonOfStatus(status: TerminalRunStatus, reason: string): reason is RunReason {
  return (RUN_REASONS_BY_STATUS[status] as readonly string[]).includes(reason);
}

/** Process exit code for each terminal status. */
export const RUN_EXIT_CODES: { readonly [S in TerminalRunStatus]: number } = {
  done: 0,
  failed: 1,
  "needs-input": 3,
  "budget-exhausted": 4,
  cancelled: 5,
};

/**
 * Errors that end the CLI before a run starts, or before a revert changes anything.
 * No journal is written for them.
 */
export const CLI_ERROR_EXIT_CODES = {
  invalid_arguments: 2,
  invalid_task: 2,
  /** The config file cannot be read, or a value in it is invalid. */
  invalid_config: 2,
  /** A task or config file, or `--goal`, has a key field or a key value. Checked before anything else in those inputs. */
  key_in_file: 2,
  invalid_script: 2,
  secret_env_missing: 2,
  workspace_not_found: 2,
  /**
   * U-3: the workspace's real path is the running CLI's install directory (the package root that
   * holds the entry file), lies inside it or contains it. Checked before the lock; nothing is written.
   */
  workspace_is_install_dir: 2,
  /**
   * Another run (or revert) holds `<workspace>/.codaryn/lock.json`. N-25 (a): the human-readable
   * error adds `lock.remove_hint`: when no Codaryn is running in that workspace, remove the file.
   */
  workspace_locked: 6,
  provider_not_configured: 7,
  provider_not_implemented: 7,
  /** `codaryn models` (Y-1): the Models API request failed. The message names the ModelErrorKind. */
  model_list_failed: 8,
  /** `codaryn models --use` (Y-3), `codaryn init` (N-2): the config file could not be written. It was left as it was. */
  config_write_failed: 2,
  /** `codaryn init` (N-2): a file already exists where the config would be written. Nothing was written. */
  config_exists: 2,
  /** `codaryn revert`: the workspace has no journal for that run id. */
  run_not_found: 2,
  /** `codaryn revert`: the run's journal cannot be read or parsed. Nothing was changed. */
  invalid_run_record: 2,
  /**
   * G-A (R-9c C-1), `codaryn revert --run <apply runId>`: the plan run that apply used
   * (`apply_started.planRunId`) has no directory or no plan.json any more. The real paths of the
   * apply's files are known only from that plan (DR-24 f), so nothing was changed. A plan run must
   * be kept while its apply may be reverted. `codaryn plan`, `codaryn apply` (LoadPlanOutcome): the
   * plan run ended as `plan_pending` but its plan.json is gone; nothing was shown or changed.
   */
  plan_run_missing: 2,
  /**
   * G-A, `codaryn plan`, `codaryn apply`: the run has no stored plan (it did not end as
   * `plan_pending`), or the task given to `apply` does not resolve to `plan: "apply"`. Nothing was
   * changed.
   */
  run_not_plan: 2,
  /**
   * G-A, `codaryn apply`: no approval. `--digest` is missing (without a terminal), shorter than
   * MIN_PLAN_DIGEST_PREFIX, or not a prefix of the stored plan's digest, or the terminal answer was
   * no. Nothing was changed.
   */
  plan_not_approved: 2,
  /** G-A, `codaryn apply`: the plan was already applied (applied.json exists). Nothing was changed. */
  plan_already_applied: 2,
  /**
   * DR-28 (R-11 M-1), `codaryn plan`, `codaryn apply` and the app layer: the secrets registered now
   * mask the plan's paths differently from the plan run (planActionShownMatches is false for an
   * action), or the plan was stored without its masked form. Checked right after the plan is
   * loaded: nothing was shown, asked, recorded or moved. Use the same task form, and so the same
   * secrets, as the plan run, or make the plan again.
   */
  plan_secrets_differ: 2,
  /**
   * U-1 (R-33 R33-L3), `codaryn apply` and the app layer: the plan run has a records-changed mark
   * (DR-38, RECORDS_CHANGED_FILE_NAME; one that cannot be read counts too), so its plan may differ
   * from what a person saw. Checked right after the plan is loaded, before anything is asked:
   * nothing was asked, recorded or moved, and no apply run was made. Make the plan again with a new
   * `codaryn run` (U-14, UXM-6: `codaryn plan` only shows a plan, it does not make one).
   */
  plan_records_changed: 2,
  /** G-A, `codaryn review`: the run did not end as `needs-input`/`awaiting_review`. Nothing was written. */
  run_not_awaiting_review: 2,
  internal_error: 70,
} as const;
export type CliErrorCode = keyof typeof CLI_ERROR_EXIT_CODES;

export interface RunUsage {
  readonly modelTurns: number;
  readonly toolCalls: number;
  /** `null` when at least one response did not report usage. */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly durationMs: number;
  /**
   * Repairs started in this run (`repair_started` records). The phase 2 engine always sets it.
   * It is optional only because journals and results written before phase 2 do not have it.
   */
  readonly repairAttempts?: number;
}

/**
 * Upper bound, in UTF-8 bytes, for the verifier evidence in one repair message (R-4).
 * The failed verifiers share it equally. Evidence is masked first and cut afterwards: the head and
 * the tail are kept and the middle is replaced by an omission note, which counts toward the share.
 * A cut never falls inside a privacy token or a UTF-8 sequence.
 */
export const MAX_FEEDBACK_BYTES = 8192;

export interface FileChangeRecord {
  readonly path: MaskedText;
  readonly previousHash: ContentHash | null;
  readonly newHash: ContentHash;
  readonly created: boolean;
}

export const RESULT_SCHEMA_VERSION = 1;

/** Result of one run. Printed on stdout as one JSON line and stored as result.json. */
export interface EngineResult {
  readonly schemaVersion: 1;
  readonly kind: "run";
  readonly runId: string;
  readonly taskId: string;
  readonly status: TerminalRunStatus;
  readonly reason: RunReason;
  readonly exitCode: number;
  /** "scripted" means no real API was called. */
  readonly provider: ModelProviderName;
  /** In task order. Empty when the run ended before verification or no verifier is configured. */
  readonly verifiers: readonly VerifierResult[];
  /** Applied changes in order. They are kept when a run is cancelled or fails. */
  readonly changes: readonly FileChangeRecord[];
  readonly usage: RunUsage;
  /** Relative to the workspace root, `/` separated. */
  readonly journalPath: string;
  /** Short masked notes, for example "no automatic verification". */
  readonly notices: readonly MaskedText[];
  /**
   * U-2: present when the run recorded at least one `integrity_checked`; the `changed` list of the
   * last one. Empty when nothing changed. Non-empty only with reason `protected_changed`.
   * Absent when the run had no integrity checker (nothing was protected).
   */
  readonly protectedChanged?: readonly MaskedText[];
  /**
   * DR-38: present when the run recorded at least one `state_checked`; the `changed` list of the
   * last one. Non-empty only with reason `state_changed`. Absent when the run had no state guard.
   */
  readonly stateChanged?: readonly MaskedText[];
  /**
   * G-A: present with reason `plan_pending` only. The stored plan's digest, the one value both
   * `codaryn apply --digest` and the app layer's `applyPlan(runId, digest)` take (DR-1), and its
   * number of actions.
   */
  readonly plan?: { readonly digest: ContentHash; readonly actions: number };
  /** G-A: present with reason `awaiting_review` only. The workflow's checklist, masked. */
  readonly review?: { readonly checklist: readonly MaskedText[] };
  /**
   * DR-47 (AXM-1): the agent's last message: the run's last model response, when it is a final
   * reply (`stop: "final"`, no tool calls). Absent when the model was asked again after it or the
   * run ended without a reply (a limit, a model error, a cancel). It is the model's own words, not a
   * verified fact; every view shows it after a label that says so (`summary.final_message`,
   * `report.final_message`). Its text is the recorded `model_response.text` (registered values
   * masked), with line breaks as LF and tabs kept, every other control and invisible character
   * (KEY_INVISIBLE_PATTERN_SOURCE) left out, and key shapes (API_KEY_MASK_PATTERN_SOURCES) shown as
   * `[key]`; then cut, never inside a protected token or a `[key]`, to at most
   * MAX_FINAL_MESSAGE_CHARS characters (code points), `truncated` true then. Absent also when that
   * text is empty or only white space, and for a plan run (reason `plan_pending`: its place is the
   * plan's summary, PlanOutput.summary). Results written before DR-47 do not have it.
   */
  readonly finalMessage?: { readonly text: MaskedText; readonly truncated: boolean };
}

/** DR-47: the longest EngineResult.finalMessage text, in characters (code points). */
export const MAX_FINAL_MESSAGE_CHARS = 2000;

/** Printed on stdout as one JSON line when the CLI stops before a run starts. */
export interface CliErrorOutput {
  readonly schemaVersion: 1;
  readonly kind: "error";
  readonly code: CliErrorCode;
  readonly exitCode: number;
  /** Never contains secret values, keys or file contents. */
  readonly message: string;
  /**
   * N-15: where in a config, task or script file the problem is, for `invalid_config`,
   * `invalid_task` and `invalid_script` when it can be said safely. Absent otherwise.
   */
  readonly diagnostic?: InputDiagnostic;
  /**
   * R-12 L-2: advice the CLI can give beyond the code, because it knows the cause. The human error
   * adds it as its own line (`error.hint.<hint>`); `message` says the same for JSON readers.
   * Absent otherwise.
   */
  readonly hint?: CliErrorHint;
}

/**
 * R-12 L-2: the error hints (CliErrorOutput.hint).
 * - quick_form_needs_task: `plan`, `apply` or `review` in the quick form (`--workspace`) failed on
 *   the config file's run settings (limits included, `invalid_config`); the plan run's task given
 *   with `--task` brings its own settings, and its secrets (DR-28).
 */
export const CLI_ERROR_HINTS = ["quick_form_needs_task"] as const;
export type CliErrorHint = (typeof CLI_ERROR_HINTS)[number];

/**
 * N-15 (review M1): a structured input diagnostic. It holds a fixed code, a schema field position
 * and numbers only: never the JSON parser's message, a value, or the name of an unknown key.
 */
export const INPUT_DIAGNOSTIC_CODES = ["json_syntax", "unknown_field", "invalid_value", "missing_field", "too_deep"] as const;
export type InputDiagnosticCode = (typeof INPUT_DIAGNOSTIC_CODES)[number];

export interface InputDiagnostic {
  readonly code: InputDiagnosticCode;
  readonly file: InputDiagnosticFile;
  /**
   * The field: for `unknown_field` the object that holds the unknown key (`config`, `limits`,
   * `policy.commands[0]`), never the key itself; for `invalid_value` and `missing_field` the field.
   * Null for `json_syntax` and `too_deep`, and whenever no safe position exists.
   */
  readonly field: SchemaFieldPath | null;
  /** `json_syntax` only: 1-based line and column (in Unicode code points, a BOM not counted). Else null. */
  readonly line: number | null;
  readonly column: number | null;
  /** `unknown_field` only: the closest allowed field name at that position, when one is close. */
  readonly suggestion?: SchemaFieldPath | null;
}

export type CliOutput = EngineResult | CliErrorOutput;

/**
 * `complete`: every changed file was reverted or was already as before the run (`already_reverted`),
 * or nothing had changed. `partial`: some file was skipped for any other reason (N-22).
 */
export const REVERT_EXIT_CODES = { complete: 0, partial: 3 } as const;
export type RevertStatus = keyof typeof REVERT_EXIT_CODES;

/**
 * Printed on stdout as one JSON line by
 * `codaryn revert --workspace <dir> --run <runId|latest> [--dry-run] [--quiet]`.
 * Its errors use CliErrorOutput (for example `run_not_found` or `workspace_locked`).
 * With `--dry-run` (N-7) `reverted` and `skipped` say what a revert would do, nothing was changed,
 * and `status` and `exitCode` are what the revert would give.
 */
export interface RevertOutput {
  readonly schemaVersion: 1;
  readonly kind: "revert";
  readonly runId: string;
  readonly status: RevertStatus;
  readonly exitCode: number;
  /** DR-38: the run has a records-changed mark (state.ts); the revert still ran its checks. Absent: false. */
  readonly recordsChanged?: boolean;
  /** Paths as the run's journal recorded them (masked). See `RevertRun`. */
  readonly reverted: RevertOutcome["reverted"];
  readonly skipped: RevertOutcome["skipped"];
  /** N-7: present and true for `--dry-run` only. */
  readonly dryRun?: true;
  /** DR-25: RevertOutcome.moveSafetyUnchecked, passed on (a dry run that lists a file to move back). */
  readonly moveSafetyUnchecked?: true;
  /**
   * N-7: the run's revert record from before this command, when it had one: the run was already
   * reverted at `at` with that status. A second revert of the same run normally skips every file
   * as `changed_since_run`; this says why. N-16: present only when the record passes the run
   * list's checks (same run id, `at` matching RUN_TIMESTAMP_PATTERN_SOURCE, a known status).
   */
  readonly revertedBefore?: { readonly at: string; readonly status: RevertStatus };
}

/**
 * Every JSON object the `codaryn` process can print: `run` prints CliOutput, `revert` prints
 * RevertOutput or CliErrorOutput, and `report --json`, `doctor --json`, `models --json`,
 * `init --json` and `runs --json` print ReportOutput, DoctorOutput, ModelsOutput, InitOutput and
 * RunsOutput (their default output is text, see commands.ts) or CliErrorOutput.
 * G-A: `apply` prints ApplyResult or CliErrorOutput; `plan --json` and `review --json` print
 * PlanOutput and ReviewOutput (their default output is text) or CliErrorOutput.
 */
export type CommandOutput =
  | CliOutput
  | RevertOutput
  | ReportOutput
  | DoctorOutput
  | ModelsOutput
  | InitOutput
  | RunsOutput
  | ApplyResult
  | PlanOutput
  | ReviewOutput;

/** Injected time source in milliseconds. */
export interface Clock {
  now(): number;
}

export interface EngineDeps {
  readonly task: ResolvedTaskSpec;
  readonly runId: string;
  readonly model: ModelProvider;
  readonly privacy: PrivacyGateway;
  readonly policy: PolicyGate;
  readonly tools: ToolRunner;
  readonly verifiers: VerifierRunner;
  readonly journal: Journal;
  readonly clock: Clock;
  /** Aborting it cancels the run. */
  readonly signal: AbortSignal;
  /**
   * U-1, U-2: integrity of protected material. The CLI passes it when `policy.protectedPaths` or
   * the config file's `integrity.paths` has an entry, and leaves it out otherwise. Absent: no
   * check and no `integrity_checked` record, as before phase 3. When present the engine checks:
   * - run_start: after `run_started`, before the first model request. `baseline = capture()`,
   *   `changed = compare(baseline, baseline)` (the paths that cannot be checked).
   * - before_verify: before each verification round. `changed = compare(baseline, capture())`.
   *   When it is not empty the round's verifiers are not run.
   * - after_verify: after the round's verifiers. `changed = compare(baseline, capture())`.
   * Every check is recorded as one `integrity_checked` with `changed` masked. A non-empty list ends
   * the run at once as `needs-input`/`protected_changed`: no repair and no further model request,
   * whatever the verifiers said. The comparison is always against the run_start baseline.
   */
  readonly integrity?: IntegrityChecker;
  /**
   * DR-38: changes to Codaryn's own records during the run (state.ts). The CLI and the app pass it;
   * absent: no check and no `state_checked` record, as before. When present the engine:
   * - run_start: after `run_started`, before the first model request: `run = capture("run")`,
   *   `base = capture("state")`; records `state_checked` with `limited` from compare(base, base).
   * - before_command, after_command: around each `run_command` it executes (the decision is recorded
   *   before, the result after): `now = capture("run")`, `changed = compare(last, now).changed`,
   *   `last = now`. Recorded only when `changed` is not empty.
   * - before_verify, after_verify: around each verification round: tier "run" as above, and tier
   *   "state" against `base`. Recorded only when something changed or `limited` is true.
   * - run_end: both tiers, always recorded, after the last step and before `run_finished`.
   * A non-empty `changed` (either tier) is recorded masked, passed to `markRecordsChanged`, and ends
   * the run at once as `failed`/`state_changed`: no further model request, command or verifier, and
   * at run_end it replaces the status the run would have ended with. `limited` (tier "state") is
   * recorded and the run goes on. Integrity checks and state checks at the same moment both run.
   */
  readonly stateGuard?: StateGuard;
}

/** Signature of `runTask`, exported by `src/engine/index.ts`. */
export type RunTask = (deps: EngineDeps) => Promise<EngineResult>;
