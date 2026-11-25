/**
 * Plan confirmation and apply (stage 4, G-A). Design: docs/design/general-tasks.md sections 6 and 7,
 * decisions GT-D4, GT-D5, GT-D13 and, after the R-1 review, DR-1, DR-5, DR-6, DR-9
 * (docs/work-orders/phase-4-5-design.md).
 *
 * A task whose task type settings say `plan: "apply"` runs in two steps that a person joins. The
 * approval happens between them, never inside a run (DR-1): there is no plan question while a run
 * is going.
 * 1. The plan run. The model may read and call `propose_plan` once. The engine judges every action
 *    with the policy gate (PLAN_ACTION_DESCRIPTORS), the tool checks the plan against the workspace,
 *    hashes every source file and stores the actions as `plan.json` (PlanRecorder). The run ends as
 *    `needs-input`/`plan_pending` with `EngineResult.plan`. No workspace file changes.
 *    DR-18 (c): a cancel or the duration limit that arrives while the plan is being stored ends the
 *    plan run as `cancelled` or `budget-exhausted`, without `EngineResult.plan`. plan.json may stay,
 *    but its run did not end as `plan_pending`, so LoadPlan answers `run_not_plan` and it cannot be
 *    applied.
 * 2. The apply run. `codaryn apply` (with the same task form as `run`: `--task <task.json>`, or
 *    `--workspace <dir> [--profile <name>] [--workflow <id>]`; with `--run <plan run id>` and
 *    `--digest <hex>`), or an adapter's `applyPlan(runId, digest)` after a person approved the
 *    shown plan, applies exactly the stored actions under the workspace lock. Policy, verifiers,
 *    limits and secrets come from the user's config and the task as they are at apply time
 *    (DR-5); `plan.json` holds actions and source hashes only, plus (DR-28) how the plan run masked
 *    each action's paths. Showing or applying a plan whose paths the secrets registered now mask
 *    differently stops before anything is shown or moved (`plan_secrets_differ`). Each action is
 *    recorded, then the
 *    inventory check and the task's verifiers run, and the apply writes its own result
 *    (ApplyResult, a new run id that names the plan run). No model takes part.
 *
 * Moves and discards exist only here. No tool a model can call moves or deletes a file, and an
 * apply needs the digest of the stored plan, so nothing is moved without a person's approval.
 * The digest guards against approving another plan by mistake. It is no defence against someone
 * who can write the workspace's state directory (allowed commands can, T-11).
 *
 * P1 (DR-69, proposal B-1 to B-8): plan mode "run": a person approves the files a model may write,
 * then a later model run writes those files only. Its contract starts at PLANNED_FILE_CHANGES.
 * U-180 (B-3): the `propose_changes` tool stores such a plan (PlanRecorder.saveChangesPlan); the
 * run that carries one out follows with the next unit, and the CLI and the app with B-4.
 */

import type { PolicyGate } from "./policy.js";
import "./text.js"; // Preserve module evaluation order.
import type { ContentHash, MaskedText } from "./text.js";
import type { PlanActionKind, ResolvedPlanAction, MaskedPlanAction, MaskedParts, StoredPlanAction, StoredPlan } from "./plan-core.js";
import type { StoredPlannedFile, AnyStoredPlan, MaskedPlannedFile } from "./plan-changes.js";

import type { PlanExecutor, PlanItemProblem } from "./plan-apply.js";

export { PLAN_MODES, PLAN_ACTION_KINDS, MAX_PLAN_ACTIONS, MAX_PLAN_SOURCE_BYTES, MAX_PLAN_SUMMARY_CHARS, MIN_PLAN_DIGEST_PREFIX, PLAN_FILE_NAME, PLAN_APPLIED_FILE_NAME, DISCARDED_DIR_NAME, PLAN_PROBLEMS, PLAN_ACTION_DESCRIPTORS, maskedParts, maskedPartsEncoding, sameMaskedParts, planActionShown, planActionShownMatches, APPROVAL_CHANNELS, DISCARDED_STORED_NAME_PATTERN_SOURCE, discardedStoredName, UNSAFE_MOVE_CONSENT_ARGUMENT } from "./plan-core.js";
export type { PlanMode, PlanActionKind, PlanActionArgs, ProposePlanArgs, ResolvedPlanAction, MaskedPlanAction, PlanProblem, ProposePlanPayload, MaskedParts, PlanActionShown, StoredPlanAction, StoredPlan, ApprovalChannel, UnsafeMoveConsent } from "./plan-core.js";
export { PLANNED_FILE_CHANGES, MAX_PLANNED_FILES, CHANGES_PLAN_PROBLEMS, PLANNED_FILE_DESCRIPTOR, STORED_PLAN_KIND_BY_MODE, plannedFileStale, approvedPlanWritablePathSets } from "./plan-changes.js";
export type { PlannedFileChange, PlannedFileArgs, ProposeChangesArgs, ResolvedPlannedFile, ProposeChangesPayload, ChangesPlanProblem, StoredPlannedFile, StoredChangesPlan, AnyStoredPlan, MaskedPlannedFile, PlannedFileNow, PlannedFileProbe, ApprovedChangesPlan, JudgePlannedFile } from "./plan-changes.js";
export { PLAN_ITEM_PROBLEMS, APPLY_JOURNAL_EVENT_TYPES, APPLY_JOURNAL_ENTRY_TYPES, APPLY_REASONS_BY_STATUS, foldersLeftEmptyOf, APPLY_NOTICE_KINDS, PLAN_RECORDS_UNCHECKED_CAUSES } from "./plan-apply.js";
export type { PlanItemProblem, AppliedPlanAction, PlanItemOutcome, PlanExecutor, PlanExecutorOptions, CreatePlanExecutor, ApplyJournalEvent, ApplyJournalEventType, PlanItemStartedEvent, ApplyJournalEntry, ApplyJournalEntryType, ApplyJournalRecord, ApplyJournalEntryRecord, ApplyJournal, ApplyDeps, AppliedActionRecord, ApplyResult, ApplyNoticeKind, PlanRecordsUncheckedCause, ApplyPlan } from "./plan-apply.js";

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
   * file exists or cannot be written; the tool then reports `io_error` and no plan exists. It does
   * not depend on hard links (DR-24 c). A reader that sees the file half written finds its digest
   * wrong and reports `invalid_run_record`. DR-28: every action carries `shown`, which the
   * `propose_plan` tool (ToolRunner, src/tools, G-C) builds with planActionShown from the action
   * masked by the run's own gateway (the one it was created with); a path that cannot be masked
   * fails the call with `io_error` and stores nothing. The recorder writes `shown` as given, as part
   * of the bytes the digest covers. `loadPlan` accepts an action with or without `shown` (exact
   * keys either way; the parts must be arrays of strings).
   */
  savePlan(actions: readonly StoredPlanAction[]): Promise<ContentHash>;
  /**
   * U-175 (R-99 M-3, DR-69 B-1, B-3): writes plan.json of a `run` plan for this run
   * (StoredChangesPlan: `schemaVersion` 1, `kind: "changes"`, this run's id, then `summary` and
   * `files` as given), with savePlan's rules: created exclusively, resolved with the SHA-256 of the
   * bytes written, rejected when the file exists or cannot be written, no hard links needed. The
   * `propose_changes` tool builds every `shown` and the summary's visible parts with the run's own
   * gateway, the summary made safe with safeModelText first (V-7 M-1). U-181 (store): the store's
   * recorders have it. It stays optional in the contract for other recorders (test doubles): a
   * recorder without it stores no `run` plan, and the tool then fails with `io_error`, as without
   * a recorder.
   */
  saveChangesPlan?(plan: { readonly summary: MaskedParts; readonly files: readonly StoredPlannedFile[] }): Promise<ContentHash>;
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
 * - run_not_plan: the run has no result.json, or it is not `needs-input`/`plan_pending`
 * - plan_run_missing (R-9c C-1): the run ended as `needs-input`/`plan_pending` but its plan.json
 *   is gone (deleted), so there is no plan to show or apply
 * - invalid_run_record: plan.json or result.json cannot be read or parsed, plan.json names another
 *   run, or its digest is not `EngineResult.plan.digest`. DR-24 (d): also when an action's path
 *   does not pass the workspace's lexical path rules (as `Workspace.resolve` applies them: relative,
 *   no `..`, not in the state directory, no reserved or aliasing names, no stream suffix)
 */
export type LoadPlanOutcome<P extends AnyStoredPlan = StoredPlan> =
  | {
      readonly ok: true;
      readonly plan: P;
      /** SHA-256 of plan.json's bytes, equal to the plan run's `EngineResult.plan.digest`. */
      readonly digest: ContentHash;
      /** applied.json, or null when the plan was not applied. */
      readonly applied: PlanAppliedRecord | null;
    }
  | { readonly ok: false; readonly code: "run_not_found" | "run_not_plan" | "plan_run_missing" | "invalid_run_record" };

/** Signature of `loadPlan`, exported by `src/store/index.ts` (G-E). Reads only; changes nothing. */
export type LoadPlan = (request: LoadPlanRequest) => Promise<LoadPlanOutcome>;

/**
 * U-175 (R-99 M-3, DR-69 B-3): as LoadPlan, for both kinds of plan (LoadPlanOutcome<AnyStoredPlan>):
 * the same codes and checks, and a `kind: "changes"` plan.json is read with its own exact keys
 * (StoredChangesPlan; each file's path passes the same lexical rules as an action's, DR-24 (d)).
 * LoadPlan keeps answering `invalid_run_record` for a `run` plan, so `plan` and `apply`, which use
 * it, are as before until they choose by kind (B-4). U-181: exported by the store (`loadAnyPlan`),
 * which also refuses a plan whose kind is not the one the plan run's result names
 * (EngineResult.plan.kind "changes" for a `run` plan).
 */
export type LoadAnyPlan = (request: LoadPlanRequest) => Promise<LoadPlanOutcome<AnyStoredPlan>>;

/**
 * U-105 (app layer U-91, gap survey GUI 3.9): what `preflightPlan` judges, the apply preflight's
 * judgement of each action as `applyPlan` makes it (ApplyDeps step 2, after the inventory).
 */
export interface PlanPreflightDeps {
  /** The stored plan's actions, in plan order. */
  readonly actions: readonly ResolvedPlanAction[];
  /** As ApplyDeps.planActions: the apply task's `policy.planActions` (absent: empty). */
  readonly planActions: readonly PlanActionKind[];
  /** As ApplyDeps.policy: created from the apply task's policy (DR-5). */
  readonly policy: PolicyGate;
  /** Only `check` is called. */
  readonly executor: Pick<PlanExecutor, "check">;
  /**
   * Asked before each action. True stops the preflight there, with no further action judged
   * (`applyPlan` passes its cancel and duration limit). Absent: never stops.
   */
  readonly stop?: () => boolean;
}

/** What `preflightPlan` found: the parts of `plan_checked` it judges, or a stop. */
export type PlanPreflightOutcome =
  | {
      readonly stopped: false;
      /** As `plan_checked.problems`: actions that cannot be applied, in plan order. */
      readonly problems: readonly { readonly index: number; readonly problem: PlanItemProblem }[];
      /** As `plan_checked.unsafeMoves`: actions that need the person's consent (DR-21), in plan order. */
      readonly unsafeMoves: readonly number[];
    }
  | { readonly stopped: true };

/**
 * Signature of `preflightPlan`, exported by `src/engine/index.ts` (U-105). It is the apply's own
 * preflight loop, which `applyPlan` calls, so a caller that checks a plan before applying it (the
 * app layer's checkApply) does not judge again. Each action, in plan order:
 * 1. its kind must be in `planActions`, else `denied`;
 * 2. the policy gate before and after (PLAN_ACTION_DESCRIPTORS, call id `action-<index>`, the
 *    action's path fields; the paths are already effective); a denial or a gate that throws is
 *    `denied`, and the executor is not asked;
 * 3. `executor.check`; one that throws is `io_error`. `unsafe_move` goes to `unsafeMoves`, any
 *    other problem to `problems`.
 * Nothing is moved, recorded or claimed. The executor's hard link probe is made and taken back as
 * in the apply; `PlanExecutor.probesLeft` tells one it could not take back.
 * Not in it, because the caller has them: the DR-28 masking comparison, the inventory (DR-6), the
 * lock, the records checks and the consent. The apply has them around this loop; the app layer
 * has them from the plan view and its own lock.
 */
export type PreflightPlan = (deps: PlanPreflightDeps) => Promise<PlanPreflightOutcome>;

/**
 * `codaryn plan (--task <task.json> | --workspace <dir> [--profile <name>] [--workflow <id>]) [--config <file>]
 * [--vars-file <file>] --run <runId|latest> [--json]` (DR-17): shows a stored plan. It takes the
 * same task form as `run` and `apply`, so it registers the same secrets (S-2 to S-4: the task's and
 * the config's `secretEnv`, the key, the variable file's values) and masks plan.json again with
 * them; it does not show the journal's copy (DR-5). The workspace is the task's `workspaceRoot` or
 * `--workspace`. It also counts the workspace's files, so the inventory limit is reported before an
 * apply (DR-6). It needs no model and makes no request: a missing key or model does not stop it.
 * Changes nothing, takes no lock. Errors (CliErrorOutput): `invalid_arguments`, `invalid_task`,
 * `invalid_config`, `key_in_file`, `secret_env_missing`, `workspace_not_found`, `run_not_found`,
 * `run_not_plan`, `plan_run_missing`, `invalid_run_record`, `plan_secrets_differ` (DR-28: checked
 * before anything is shown).
 * U-14 (UXM-6, AXM-2, AXM-15): the view is what a person approves from. A plan run with a
 * records-changed mark is still shown (exit code as before), with `plan.records_changed` first and
 * `plan.cannot_apply` instead of the command to apply it. The model's summary, when there is one, is
 * shown under `plan.summary_label` as the agent's description, not as what is approved. The text
 * ends with `plan.digest_guarantee`. A plan run without a mark is shown as before, plus the summary
 * and that line.
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
  /**
   * U-14 (AXM-15): the summary the model wrote for this plan (ProposePlanArgs.summary). It is not in
   * plan.json or the digest, so it is not what a person approves; it is shown as the agent's
   * description. The one thing the view reads from the plan run's journal (DR-5 otherwise): the
   * masked `argsJson` of the `propose_plan` call whose ok result names this plan's digest, masked
   * again with the current secrets. Absent when it cannot be found, read or masked, and when the plan
   * run has a records-changed mark (its journal may have been changed too).
   */
  readonly summary?: MaskedText;
  /**
   * U-14 (AXM-2, UXM-6): present and true when the plan run has a records-changed mark (fail closed,
   * as the store's `hasRecordsChangedMark`). `codaryn apply` refuses such a plan
   * (`plan_records_changed`). Absent otherwise, as for the other commands.
   */
  readonly recordsChanged?: true;
}

/**
 * U-175 (R-99 M-3, DR-69 B-1, B-4): what `codaryn plan --json` prints for a `run` plan, beside
 * PlanOutput, whose JSON for a plan of mode apply is as before (it has no `planKind`). Not printed
 * yet: the plan view reads LoadPlan, which refuses a `run` plan until B-4 chooses by kind.
 * - planKind: "changes", the stored plan's kind; readers tell the two outputs apart by it.
 * - files: the planned files, masked, in the plan's order.
 * - summary: what the later run will be told, masked again with the current secrets. Unlike
 *   PlanOutput.summary it is in plan.json under the digest (R-99 L-1), so it is part of what the
 *   person approves, and the view shows it as such.
 * - appliedBy: the run that carried the plan out, from applied.json (B-7); null while pending.
 * - recordsChanged: as PlanOutput's.
 */
export interface ChangesPlanOutput {
  readonly schemaVersion: 1;
  readonly kind: "plan";
  readonly planKind: "changes";
  readonly runId: string;
  readonly status: PlanStatus;
  readonly exitCode: number;
  readonly digest: ContentHash;
  readonly files: readonly MaskedPlannedFile[];
  readonly summary: MaskedText;
  readonly appliedBy: { readonly runId: string; readonly at: string } | null;
  readonly recordsChanged?: true;
}

/** U-175 (R-99 M-3): either plan view, told apart by `planKind` (present on ChangesPlanOutput only). */
export type AnyPlanOutput = PlanOutput | ChangesPlanOutput;
