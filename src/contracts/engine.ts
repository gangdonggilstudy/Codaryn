/**
 * Run states, exit codes, the engine entry point and the CLI output objects. The CLI error contract
 * (codes, exit codes, categories, hints, input diagnostics) is in engine-errors.ts; this module
 * passes it on (IR-26 step 3 E1).
 */

import type { RevertOutcome } from "./changes.js";
import type { DoctorOutput, InitOutput, ModelsOutput, ReportOutput, RunsOutput } from "./commands.js";
import type { IntegrityChecker } from "./integrity.js";
import type { StateGuard } from "./state.js";
import type { Journal } from "./journal.js";
import type { ModelErrorKind, ModelProvider } from "./model.js";
import "./model.js"; // Preserve module evaluation order.
import type { ConfirmPermission, PolicyGate } from "./policy.js";
import type { PrivacyGateway } from "./privacy.js";
import type { ModelProviderName, ResolvedTaskSpec, WritablePathSet } from "./task.js";
import type { ContentHash, MaskedText } from "./text.js";
import type { ToolRunner } from "./tool.js";
import type { VerifierResult, VerifierRunner } from "./verify.js";
import type { ApplyResult, ApprovedChangesPlan, ChangesPlanOutput, PlanOutput } from "./plan.js";
import type { ReviewOutput } from "./workflow.js";
import type { CliErrorOutput } from "./engine-errors.js";

export { CLI_ERROR_EXIT_CODES, CLI_ERROR_CATEGORIES, CLI_ERROR_CATEGORY, CLI_ERROR_RETRYABLE, cliErrorFacts, CLI_ERROR_HINTS, DETAILED_CLI_ERROR_HINTS, ALL_CLI_ERROR_HINTS, CLI_ERROR_HINT_DETAIL, PROVIDER_SETTINGS, INPUT_DIAGNOSTIC_CODES } from "./engine-errors.js";
export type { CliErrorCode, CliErrorCategory, CliErrorOutput, CliErrorHint, DetailedCliErrorHint, ProviderSetting, ProviderSettingMissing, CliErrorHintDetail, InputDiagnosticCode, InputDiagnostic } from "./engine-errors.js";

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
   * P1 (DR-69, B-6): plan_stale also ends a run that carries out an approved `run` plan when a
   * planned file no longer fits (plannedFileStale) or the plan was already carried out (B-7), before
   * its first model request; nothing was written.
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
   * a person's approval and `codaryn apply` (EngineResult.plan). awaiting_review: the task type's
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
   * number of actions. U-175 (R-99 M-3, DR-69 B-1): `kind: "changes"` for a `run` plan
   * (StoredChangesPlan), whose `actions` is its number of files, so a reader can say "files" and
   * not "actions". Absent for a plan of mode apply: its JSON is as before.
   */
  readonly plan?: { readonly digest: ContentHash; readonly actions: number; readonly kind?: "changes" };
  /**
   * P1 (DR-69, B-3): present together in a run that carries out an approved `run` plan: the plan
   * run's id and the approved digest, as `run_started` records them. Absent in every other run, so
   * no result written before has them.
   */
  readonly planRunId?: string;
  readonly planDigest?: ContentHash;
  /**
   * U-59 (AXM-15): with `plan`, the agent's description of that plan: the `summary` of the
   * propose_plan call that stored it (ProposePlanArgs.summary), masked by the run's gateway and made
   * safe as finalMessage is (safeModelText: invisible characters left out, key shapes as `[key]`).
   * The model's own words, not checked; not in plan.json or the digest, so not what a person
   * approves (PlanOutput.summary is the same text read back for the plan view). Apart from `plan`,
   * whose two fields stay. Absent without `plan`, when it is empty after that, and in results
   * written before U-59.
   */
  readonly planSummary?: MaskedText;
  /**
   * DR-52 (AXM-17): whether masking worked, in counts only (never a value, a place or a length).
   * `registeredValues`: PrivacyGateway.registeredValues. `maskedPlaces`: the protected tokens
   * (countPrivacyTokens) in the texts the engine sent to the model (the system text, the task's
   * message, tool results and repair messages), each text counted once when it is first sent; tokens
   * the model sent back are not counted. Present only when at least one value was registered (absent
   * also for a gateway that does not say, and in results written before DR-52). The end summary shows
   * it with `summary.masking`. Merged only after the security reviewer confirms the counts are no
   * clue to a secret (DR-52).
   */
  readonly masking?: { readonly registeredValues: number; readonly maskedPlaces: number };
  /** G-A: present with reason `awaiting_review` only. The task type's checklist, masked. */
  readonly review?: { readonly checklist: readonly MaskedText[] };
  /**
   * DR-47 (AXM-1): the agent's last message: the run's last model response, when it is a final
   * reply (`stop: "final"`, no tool calls). Absent when the model was asked again after it or the
   * run ended without a reply (a limit, a model error, a cancel). It is the model's own words, not a
   * verified fact; every view shows it after a label that says so (`summary.final_message`,
   * `report.final_message`). Its text is the recorded `model_response.text` made safe by
   * safeModelText (R-52): line breaks as LF and tabs kept and every other control and invisible
   * character (KEY_INVISIBLE_PATTERN_SOURCE) left out first, then masked again by the run's gateway
   * (a registered value those characters split is found whole), then key shapes
   * (API_KEY_MASK_PATTERN_SOURCES) shown as `[key]`, also across LF and TAB; none when masking
   * fails. Then cut, never inside a protected token or a `[key]`, to at most
   * MAX_FINAL_MESSAGE_CHARS characters (code points), `truncated` true then. Absent also when that
   * text is empty or only white space, and for a plan run (reason `plan_pending`: its place is the
   * plan's summary, PlanOutput.summary). Results written before DR-47 do not have it.
   */
  readonly finalMessage?: { readonly text: MaskedText; readonly truncated: boolean };
  /**
   * U-55 (AXM-9): the model error that ended the run, for programs that decide whether to try again
   * without reading the journal. Present only with reason `model_error` when a model error ended
   * it: a provider failure (the outcome's kind), a malformed response or a plan run that ended
   * without a plan (`malformed_response`). Absent when reason `model_error` came from masking that
   * failed, which is no model error, and in results written before U-55. The journal's
   * `model_error` record keeps the masked message; nothing of the provider's reply is here.
   */
  readonly modelError?: RunModelError;
}

/** U-55: EngineResult.modelError. Kind and turn only, and whether trying again may help. */
export interface RunModelError {
  readonly kind: ModelErrorKind;
  /** The model turn of the failed request (1-based, as the journal's `model_error.turn`). */
  readonly turn: number;
  /** modelErrorRetryable. Absent when it cannot be told (an api_error without an HTTP status): unknown, never false. */
  readonly retryable?: boolean;
}

/** DR-47: the longest EngineResult.finalMessage text, in characters (code points). */
export const MAX_FINAL_MESSAGE_CHARS = 2000;

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
  // U-195 (DR-69 B-4; in na-core's unit for p4g-general to confirm): `codaryn plan --json` of a run plan.
  | ChangesPlanOutput
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
  /**
   * U-74 (DR-3, DR-10): asks a person about a call a `confirm: true` rule allows (PolicyDecision
   * `confirm`). Absent: nobody is asked and such a call is denied, recorded `by: "default"`. The wait
   * counts in maxDurationMs.
   */
  readonly confirm?: ConfirmPermission;
}

/**
 * U-187 (DR-69 B-3, B-4, B-6, B-7): EngineDeps for a run that carries out an approved `run` plan,
 * except the gate: the engine makes it with `policyFor`, giving it the task's writable lists and the
 * plan's files as one more list (approvedPlanWritablePathSets), so the run writes planned files only
 * and only where every list allows. The caller's `policyFor` is createPolicyGate with the run's
 * policy and workspace.
 * - Before the first model request: every planned file is checked (`approved.fileNow` and
 *   plannedFileStale), then judged by that gate as a write (PLANNED_FILE_DESCRIPTOR), then the plan
 *   is claimed once (`approved.markApplied`), all before the run's first state check. A file that
 *   no longer fits, a denial, a check that fails, a claim that fails or a plan already carried out
 *   ends the run as `failed`/`plan_stale` with a notice that names the file's index (never a path):
 *   no model request, nothing written, and (except a plan already claimed) the plan not claimed.
 * - Then it runs as a run without a plan step: no plan tool is offered, and its verifiers and
 *   completion are the task's. Its system text has, after the fixed prompt and the task type's
 *   instructions, a fixed label and the approved plan: the files with their change and the summary
 *   (its visible parts, the gaps marked), told as the plan run's words that the person approved, not
 *   as new instructions. The whole text is masked with this run's gateway.
 * - `run_started` records planRunId, planDigest and approval; the result planRunId and planDigest.
 */
export interface ApprovedPlanRunDeps extends Omit<EngineDeps, "policy"> {
  readonly approved: ApprovedChangesPlan;
  policyFor(writablePathSets: readonly WritablePathSet[]): PolicyGate;
}

/** U-187: signature of `runApprovedPlan`, exported by `src/engine/index.ts`. */
export type RunApprovedPlan = (deps: ApprovedPlanRunDeps) => Promise<EngineResult>;

/** Signature of `runTask`, exported by `src/engine/index.ts`. */
export type RunTask = (deps: EngineDeps) => Promise<EngineResult>;
