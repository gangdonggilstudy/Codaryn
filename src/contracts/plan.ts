/**
 * Plan confirmation and apply (stage 4, G-A). Design: docs/design/general-tasks.md sections 6 and 7,
 * decisions GT-D4, GT-D5, GT-D13 and, after the R-1 review, DR-1, DR-5, DR-6, DR-9
 * (docs/work-orders/phase-4-5-design.md).
 *
 * A task whose workflow settings say `plan: "apply"` runs in two steps that a person joins. The
 * approval happens between them, never inside a run (DR-1): there is no plan question while a run
 * is going.
 * 1. The plan run. The model may read and call `propose_plan` once. The engine judges every action
 *    with the policy gate (PLAN_ACTION_DESCRIPTORS), the tool checks the plan against the workspace,
 *    hashes every source file and stores the actions as `plan.json` (PlanRecorder). The run ends as
 *    `needs-input`/`plan_pending` with `EngineResult.plan`. No workspace file changes.
 * 2. The apply run. `codaryn apply` (with the same task form as `run`, `--run <plan run id>` and
 *    `--digest <hex>`), or an adapter's `applyPlan(runId, digest)` after a person approved the
 *    shown plan, applies exactly the stored actions under the workspace lock. Policy, verifiers,
 *    limits and secrets come from the user's config and the task as they are at apply time
 *    (DR-5); `plan.json` holds actions and source hashes only. Each action is recorded, then the
 *    inventory check and the task's verifiers run, and the apply writes its own result
 *    (ApplyResult, a new run id that names the plan run). No model takes part.
 *
 * Moves and discards exist only here. No tool a model can call moves or deletes a file, and an
 * apply needs the digest of the stored plan, so nothing is moved without a person's approval.
 * The digest guards against approving another plan by mistake. It is no defence against someone
 * who can write the workspace's state directory (allowed commands can, T-11).
 *
 * P1 (named here only, not part of this contract): plan mode "run" (approval, then a model run
 * whose writes are limited to the approved paths).
 */

import type { Clock, RunReason, RunUsage, TerminalRunStatus } from "./engine.js";
import type { IntegrityChecker } from "./integrity.js";
import type { JournalEvent } from "./journal.js";
import type { PolicyGate } from "./policy.js";
import type { PrivacyGateway } from "./privacy.js";
import type { ContentHash, MaskedText } from "./text.js";
import type { ToolDescriptor } from "./tool.js";
import type { InventoryChecker, VerifierConfig, VerifierResult, VerifierRunner } from "./verify.js";

/** How a task treats a plan. `none`: no plan step, as before stage 4. P1 adds "run". */
export const PLAN_MODES = ["none", "apply"] as const;
export type PlanMode = (typeof PLAN_MODES)[number];

/**
 * What a plan may do. `move` renames a file inside the workspace. `discard` moves a file into
 * DISCARDED_DIR_NAME, where `codaryn revert` can bring it back; nothing is deleted (GT-D5). A kind
 * runs only when `PolicyConfig.planActions` lists it.
 */
export const PLAN_ACTION_KINDS = ["move", "discard"] as const;
export type PlanActionKind = (typeof PLAN_ACTION_KINDS)[number];

/** Most actions in one plan. More is `invalid_plan` (`too_many`). */
export const MAX_PLAN_ACTIONS = 1000;
/**
 * Most bytes of source files in one plan, summed (4 GiB). Every source is hashed when the plan is
 * proposed, again before it is applied, and its target once more by the inventory check. More is
 * `invalid_plan` (`too_large`), found before anything is stored.
 */
export const MAX_PLAN_SOURCE_BYTES = 4 * 1024 * 1024 * 1024;
/** Longest `propose_plan.summary`, in characters. */
export const MAX_PLAN_SUMMARY_CHARS = 500;
/** Shortest digest prefix `apply --digest` accepts, in lowercase hex characters. */
export const MIN_PLAN_DIGEST_PREFIX = 12;

/** `<root>/.codaryn/runs/<plan runId>/plan.json`: the stored plan (StoredPlan). Written once. */
export const PLAN_FILE_NAME = "plan.json";
/**
 * `<root>/.codaryn/runs/<plan runId>/applied.json` (PlanAppliedRecord): written exclusively by the
 * apply run after its preflight passed and before its first action. Its presence makes a plan
 * applied: a second apply stops as `plan_already_applied`.
 */
export const PLAN_APPLIED_FILE_NAME = "applied.json";
/**
 * DR-9: `<root>/.codaryn/discarded/<apply runId>/` holds the files a `discard` action set aside.
 * It lies outside the run directories, so deleting a run's records never deletes these files.
 * Removing them is a separate step that shows their number and size and asks on its own.
 */
export const DISCARDED_DIR_NAME = "discarded";

/** An action as the model proposes it. Paths are relative to the workspace root, `/` or `\` separated. */
export type PlanActionArgs =
  | { readonly kind: "move"; readonly from: string; readonly to: string }
  | { readonly kind: "discard"; readonly path: string };

/** Arguments of `propose_plan`. */
export interface ProposePlanArgs {
  /**
   * One line for people, at most MAX_PLAN_SUMMARY_CHARS. Masked and recorded with the tool call;
   * not part of plan.json, so it is not what a person approves.
   */
  readonly summary: string;
  /** 1 to MAX_PLAN_ACTIONS actions, applied in this order. */
  readonly actions: readonly PlanActionArgs[];
}

/**
 * An action after every check: paths are relative to the workspace root, `/` separated, with links
 * resolved and permitted tokens restored. `sha256` is the source file's SHA-256 as the tool read it
 * when the plan was proposed; the model never supplies it. Local text: masked before it is
 * recorded, sent or shown.
 */
export type ResolvedPlanAction =
  | { readonly kind: "move"; readonly from: string; readonly to: string; readonly sha256: ContentHash }
  | { readonly kind: "discard"; readonly path: string; readonly sha256: ContentHash };

/** The masked form, as results and PlanOutput hold it. */
export type MaskedPlanAction =
  | { readonly kind: "move"; readonly from: MaskedText; readonly to: MaskedText; readonly sha256: ContentHash }
  | { readonly kind: "discard"; readonly path: MaskedText; readonly sha256: ContentHash };

/**
 * Why `propose_plan` rejects a plan (tool error `invalid_plan`; the message names the action index
 * and this code, never a path). Nothing is stored.
 * - empty, too_many: no action, or more than MAX_PLAN_ACTIONS
 * - too_large: the sources sum to more than MAX_PLAN_SOURCE_BYTES (index of the action that passed it)
 * - same_path: a move whose `from` and `to` are the same file
 * - duplicate_source: a path is the source of more than one action
 * - duplicate_destination: two moves have the same `to`
 * - destination_is_source: a `to` is another action's source (chains and swaps are refused)
 * - source_missing, source_not_file: the source does not exist, or is not a regular file
 *   (directories are moved file by file; links are not moved)
 * - destination_exists: something exists at `to`
 * - destination_parent_not_dir: a parent of `to` exists and is not a directory
 */
export const PLAN_PROBLEMS = [
  "empty",
  "too_many",
  "too_large",
  "same_path",
  "duplicate_source",
  "duplicate_destination",
  "destination_is_source",
  "source_missing",
  "source_not_file",
  "destination_exists",
  "destination_parent_not_dir",
] as const;
export type PlanProblem = (typeof PLAN_PROBLEMS)[number];

/**
 * What `propose_plan` returns when the plan was stored. The engine masks it before recording it
 * (`tool_result`) or returning it to the model, and then ends the run as `plan_pending` with
 * `EngineResult.plan` taken from it.
 */
export interface ProposePlanPayload {
  /** PlanRecorder.savePlan's result: the SHA-256 of plan.json's bytes. */
  readonly digest: ContentHash;
  readonly actions: readonly ResolvedPlanAction[];
}

/**
 * Synthetic descriptors for judging one plan action with the policy gate, when the plan is proposed
 * and again in the apply's preflight. They are not tools: their names are not tool names, so the
 * gate takes their requirements as given (`createPolicyGate`). Every path is a write: a move
 * changes both places and a discard removes the file. `planAction` asks the gate to check
 * `PolicyConfig.planActions` (denial `destructive`/`plan_action_not_allowed`).
 */
export const PLAN_ACTION_DESCRIPTORS: { readonly [K in PlanActionKind]: ToolDescriptor } = {
  move: {
    name: "plan.move",
    displayClass: "write-local",
    requires: {
      paths: [
        { field: "from", access: "write" },
        { field: "to", access: "write" },
      ],
      command: false,
      network: false,
      destructive: false,
      planAction: "move",
    },
    restoreFields: ["from", "to"],
    documentFields: [],
  },
  discard: {
    name: "plan.discard",
    displayClass: "write-local",
    requires: {
      paths: [{ field: "path", access: "write" }],
      command: false,
      network: false,
      destructive: false,
      planAction: "discard",
    },
    restoreFields: ["path"],
    documentFields: [],
  },
};

/**
 * plan.json: the actions and their source hashes, nothing else (DR-5). No policy, verifier, limit
 * or secret name is stored, so this file inside the workspace cannot decide how the apply runs.
 * Raw local text, like the snapshots (R-8): never sent to a model; shown only masked.
 */
export interface StoredPlan {
  readonly schemaVersion: 1;
  readonly kind: "plan";
  /** The plan run. A file naming another run is `invalid_run_record`. */
  readonly runId: string;
  readonly actions: readonly ResolvedPlanAction[];
}

export interface PlanRecorderOptions {
  /** Real absolute path of the workspace root. */
  readonly workspaceRoot: string;
  readonly runId: string;
}

/**
 * Given to the tool runner like the ChangeRecorder (`createToolRunner`'s `planRecorder`). Only
 * `propose_plan` uses it.
 */
export interface PlanRecorder {
  /**
   * Writes plan.json for this run, created exclusively (it must not exist), and resolves with the
   * SHA-256 of the bytes written after they were handed to the operating system. Rejects when the
   * file exists or cannot be written; the tool then reports `io_error` and no plan exists.
   */
  savePlan(actions: readonly ResolvedPlanAction[]): Promise<ContentHash>;
}

/** Signature of `createPlanRecorder`, exported by `src/store/index.ts` (G-E). */
export type CreatePlanRecorder = (options: PlanRecorderOptions) => PlanRecorder;

/** applied.json. */
export interface PlanAppliedRecord {
  readonly schemaVersion: 1;
  readonly kind: "plan_applied";
  readonly planRunId: string;
  readonly applyRunId: string;
  /** ISO 8601 UTC, when the apply claimed the plan. */
  readonly at: string;
}

export interface LoadPlanRequest {
  /** Real absolute path of the workspace root. */
  readonly workspaceRoot: string;
  readonly runId: string;
}

/**
 * - run_not_found: no journal for that run
 * - run_not_plan: the run's result.json is not `needs-input`/`plan_pending`, or it has no plan.json
 * - invalid_run_record: plan.json or result.json cannot be read or parsed, plan.json names another
 *   run, or its digest is not `EngineResult.plan.digest`
 */
export type LoadPlanOutcome =
  | {
      readonly ok: true;
      readonly plan: StoredPlan;
      /** SHA-256 of plan.json's bytes, equal to the plan run's `EngineResult.plan.digest`. */
      readonly digest: ContentHash;
      /** applied.json, or null when the plan was not applied. */
      readonly applied: PlanAppliedRecord | null;
    }
  | { readonly ok: false; readonly code: "run_not_found" | "run_not_plan" | "invalid_run_record" };

/** Signature of `loadPlan`, exported by `src/store/index.ts` (G-E). Reads only; changes nothing. */
export type LoadPlan = (request: LoadPlanRequest) => Promise<LoadPlanOutcome>;

/**
 * How the person approved the plan. Recorded in `apply_started`; never who.
 * - cli-tty: the CLI showed the plan at a terminal and the answer was yes
 * - cli-flag: `--digest` matched the stored plan (non-interactive)
 * - adapter: an adapter (VS Code, GUI) opened its plan view after the `plan_pending` result and
 *   passed the approved digest to the app layer's `applyPlan(runId, digest)` (DR-1)
 */
export const APPROVAL_CHANNELS = ["cli-tty", "cli-flag", "adapter"] as const;
export type ApprovalChannel = (typeof APPROVAL_CHANNELS)[number];

/**
 * Why the apply's preflight or an action cannot go on.
 * - source_missing, source_changed: the source is gone, or its SHA-256 differs from the plan's
 * - source_not_file, destination_exists, destination_parent_not_dir: as in PLAN_PROBLEMS, now
 * - denied: the policy at apply time refuses the action (DR-5)
 * - cross_device: the rename would cross a volume; nothing is copied
 * - io_error: any other file system failure
 */
export const PLAN_ITEM_PROBLEMS = [
  "source_missing",
  "source_changed",
  "source_not_file",
  "destination_exists",
  "destination_parent_not_dir",
  "denied",
  "cross_device",
  "io_error",
] as const;
export type PlanItemProblem = (typeof PLAN_ITEM_PROBLEMS)[number];

/** An action the apply run carried out, as handed to the inventory check. */
export interface AppliedPlanAction {
  /** 0-based position in the plan. */
  readonly index: number;
  readonly action: ResolvedPlanAction;
  /** For `discard`: the file's place inside the apply run's discarded directory, `/` separated. Null for `move`. */
  readonly stored: string | null;
}

export type PlanItemOutcome =
  | { readonly ok: true; readonly applied: AppliedPlanAction }
  | { readonly ok: false; readonly problem: PlanItemProblem };

/**
 * Carries out plan actions in the workspace (`src/tools`, G-C). Every path goes through
 * `Workspace.resolve`; nothing outside the root or inside the state directory is touched, except
 * the apply run's own `.codaryn/discarded/<runId>/`. It does not judge policy (the engine does).
 */
export interface PlanExecutor {
  /** Checks one action against the workspace as it is now (hashing the source). Changes nothing. Null: it can be applied. */
  check(action: ResolvedPlanAction): Promise<PlanItemProblem | null>;
  /**
   * Applies one action. A move creates missing parent directories and renames; it never replaces
   * an existing file and never copies. A discard renames the file into the run's discarded
   * directory under a name built from `index` only. Never rejects for an item-level failure.
   */
  apply(action: ResolvedPlanAction, index: number, signal: AbortSignal): Promise<PlanItemOutcome>;
}

export interface PlanExecutorOptions {
  /** Real absolute path of the workspace root. */
  readonly workspaceRoot: string;
  /** The apply run. `.codaryn/discarded/<runId>/` receives discarded files. */
  readonly runId: string;
}

/**
 * Records of an apply run's journal (`<root>/.codaryn/runs/<apply runId>/journal.jsonl`). An apply
 * run has no model, so it has its own record set: it starts with `apply_started` (no `run_started`)
 * and shares `verifier_result`, `integrity_checked` and `run_finished` with runs. Readers of
 * journals (report, runs, revert, progress) tell the two apart by the first record. JournalEvent
 * itself is unchanged, so readers of run journals are unaffected.
 */
export type ApplyJournalEvent =
  | {
      readonly type: "apply_started";
      readonly schemaVersion: 1;
      readonly planRunId: string;
      /** The task given to the apply (DR-5). */
      readonly taskId: string;
      readonly digest: ContentHash;
      readonly approval: ApprovalChannel;
      /** Number of actions in the plan. */
      readonly actions: number;
      readonly maxDurationMs: number;
    }
  | {
      /**
       * The preflight. Empty `problems` and `inventoryLimitReached` false: every action can be
       * applied. Otherwise the apply ends as `failed`/`plan_stale` with nothing moved.
       */
      readonly type: "plan_checked";
      readonly problems: readonly { readonly index: number; readonly problem: PlanItemProblem }[];
      /** DR-6: the workspace has more than MAX_INVENTORY_FILES files, so the apply could not be verified. */
      readonly inventoryLimitReached: boolean;
    }
  | {
      /** A `move` done. `from` and `to` are masked. */
      readonly type: "file_moved";
      readonly index: number;
      readonly from: MaskedText;
      readonly to: MaskedText;
      readonly sha256: ContentHash;
    }
  | {
      /** A `discard` done: the file now lies at `.codaryn/discarded/<runId>/<stored>`. */
      readonly type: "file_discarded";
      readonly index: number;
      readonly path: MaskedText;
      /** Built from the action index only, never from the file name. */
      readonly stored: string;
      readonly sha256: ContentHash;
    }
  | {
      /** An action failed while applying; the apply ends as `failed`/`apply_incomplete`. */
      readonly type: "plan_item_failed";
      readonly index: number;
      readonly problem: PlanItemProblem;
    }
  | Extract<JournalEvent, { readonly type: "verifier_result" | "integrity_checked" | "run_finished" }>;

export type ApplyJournalEventType = ApplyJournalEvent["type"];

/** A stored line of an apply journal: the event plus the fields every journal adds. */
export type ApplyJournalRecord = ApplyJournalEvent & {
  readonly seq: number;
  readonly at: string;
  readonly runId: string;
};

/** Same contract as Journal (append-only, masked text only), for apply records. */
export interface ApplyJournal {
  append(event: ApplyJournalEvent): Promise<void>;
  close(): Promise<void>;
}

/**
 * The apply run (`applyPlan`, `src/engine`, G-B). The CLI (or the app layer) has already loaded
 * the plan, checked the digest and that the plan is not applied, resolved the task given to the
 * apply (its workflow settings must say `plan: "apply"`), registered the secrets as `run` does and
 * taken the lock. Order:
 * 1. `apply_started`; the integrity baseline when `integrity` is given.
 * 2. Preflight: `inventory.capture()`; every action judged by `policy` (PLAN_ACTION_DESCRIPTORS)
 *    and by `executor.check`. `plan_checked` records the outcome. A problem, or the inventory limit
 *    reached, ends the apply as `failed`/`plan_stale` with nothing moved.
 * 3. `markApplied()`; "already_applied" ends the apply as `failed`/`plan_stale` with nothing moved.
 * 4. Each action in order: `file_moved` or `file_discarded`, or `plan_item_failed` and the apply
 *    ends as `failed`/`apply_incomplete`. A cancel or the duration limit is honoured between
 *    actions and ends the apply as `cancelled`/`cancelled` or `budget-exhausted`/`max_duration`.
 *    In every case what was done stays, is listed in `ApplyResult.applied`, and `codaryn revert
 *    --run <apply runId>` undoes it.
 * 5. Verification: the inventory check (VF-05, always first), then the task's verifiers, each
 *    recorded as `verifier_result`; integrity checks around them as in a run. No repair: no model.
 * 6. `run_finished` and the result: all pass → `done`/`verified`; a fail → `failed`/`verifier_failed`;
 *    otherwise `needs-input`/`verifier_inconclusive` (or `protected_changed`).
 */
export interface ApplyDeps {
  readonly plan: StoredPlan;
  readonly planRunId: string;
  /** The digest the person approved, equal to LoadPlanOutcome's `digest`. */
  readonly digest: ContentHash;
  readonly approval: ApprovalChannel;
  /** The apply run's own id. */
  readonly runId: string;
  /** The task given to the apply: its id and duration limit. */
  readonly taskId: string;
  readonly maxDurationMs: number;
  /** The task's verifiers, run after the inventory check. */
  readonly verifierConfigs: readonly VerifierConfig[];
  readonly executor: PlanExecutor;
  /** Created from the apply task's policy (DR-5). */
  readonly policy: PolicyGate;
  readonly privacy: PrivacyGateway;
  readonly verifiers: VerifierRunner;
  readonly inventory: InventoryChecker;
  readonly journal: ApplyJournal;
  readonly clock: Clock;
  readonly signal: AbortSignal;
  readonly integrity?: IntegrityChecker;
  /** Writes PLAN_APPLIED_FILE_NAME exclusively. "already_applied" when it exists. */
  markApplied(): Promise<"marked" | "already_applied">;
}

/** An applied action as results show it (masked). */
export interface AppliedActionRecord {
  readonly index: number;
  readonly action: MaskedPlanAction;
  readonly stored: string | null;
}

/**
 * Result of an apply run. Printed on stdout as one JSON line by `codaryn apply` and stored as the
 * apply run's result.json. Its exit code follows RUN_EXIT_CODES.
 */
export interface ApplyResult {
  readonly schemaVersion: 1;
  readonly kind: "apply";
  readonly runId: string;
  readonly planRunId: string;
  readonly taskId: string;
  readonly digest: ContentHash;
  readonly status: TerminalRunStatus;
  /**
   * One of: verified, verifier_failed, verifier_inconclusive, protected_changed, plan_stale,
   * apply_incomplete, cancelled, max_duration.
   */
  readonly reason: RunReason;
  readonly exitCode: number;
  /** In plan order, as far as the apply went. Kept when the apply fails or is cancelled. */
  readonly applied: readonly AppliedActionRecord[];
  /** The inventory check first, then the task's verifiers in order. Empty when the apply stopped before. */
  readonly verifiers: readonly VerifierResult[];
  /** `modelTurns`, `toolCalls` and the token counts are 0: no model takes part. */
  readonly usage: RunUsage;
  /** Relative to the workspace root, `/` separated. */
  readonly journalPath: string;
  readonly notices: readonly MaskedText[];
  readonly protectedChanged?: readonly MaskedText[];
}

/** Signature of `applyPlan`, exported by `src/engine/index.ts` (G-B). */
export type ApplyPlan = (deps: ApplyDeps) => Promise<ApplyResult>;

/**
 * `codaryn plan --workspace <dir> --run <runId|latest> [--json]`: shows a stored plan. It reads
 * plan.json and masks it again with the secrets it registers as `run` does (S-2 to S-4); it does
 * not show the journal's copy (DR-5). It also counts the workspace's files, so the inventory limit
 * is reported before an apply (DR-6). Changes nothing, takes no lock. Errors (CliErrorOutput):
 * `invalid_arguments`, `workspace_not_found`, `run_not_found`, `run_not_plan`, `invalid_run_record`.
 */
export const PLAN_STATUSES = ["pending", "applied"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const PLAN_EXIT_CODES: { readonly [S in PlanStatus]: number } = { pending: 0, applied: 0 };

/** Printed by `codaryn plan --json`. Without `--json` the same content as text. */
export interface PlanOutput {
  readonly schemaVersion: 1;
  readonly kind: "plan";
  readonly runId: string;
  readonly status: PlanStatus;
  readonly exitCode: number;
  readonly digest: ContentHash;
  readonly actions: readonly MaskedPlanAction[];
  /** DR-6: true when the workspace has more than MAX_INVENTORY_FILES files; an apply would stop as `plan_stale`. */
  readonly inventoryLimitReached: boolean;
  /** The apply that used this plan, from applied.json; null while pending. */
  readonly appliedBy: { readonly runId: string; readonly at: string } | null;
}
