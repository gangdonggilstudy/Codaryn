/** App-layer plan, apply and review lifecycle contracts. Type-only; re-exported by app.ts. */

import type { EngineResult } from "./engine.js";
import type { JournalRecord } from "./journal.js";
import type { ApplyJournalRecord, ApplyResult, ChangesPlanOutput, PlanItemProblem, PlanOutput } from "./plan.js";
import type { ConfirmAnswer, ConfirmRequest } from "./policy.js";
import type { ContentHash, MaskedText } from "./text.js";
import type { AppError, RunEvent, TaskForm, RunFacts } from "./app-core.js";

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

/** The reasons an apply run ends with (G-A APPLY_REASONS_BY_STATUS). */
export type ApplyReason = ApplyResult["reason"];
