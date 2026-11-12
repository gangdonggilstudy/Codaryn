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
 * P1 (named here only, not part of this contract): plan mode "run" (approval, then a model run
 * whose writes are limited to the approved paths).
 */

import type { Clock, RunReason, RunReasonByStatus, RunUsage, TerminalRunStatus } from "./engine.js";
import type { IntegrityChecker } from "./integrity.js";
import type { StateGuard } from "./state.js";
import type { JournalEvent } from "./journal.js";
import type { PolicyGate } from "./policy.js";
import type { PrivacyGateway } from "./privacy.js";
import { PRIVACY_TOKEN_PATTERN_SOURCE } from "./text.js";
import type { ContentHash, MaskedText } from "./text.js";
import type { ToolDescriptor } from "./tool.js";
import type { Workspace } from "./workspace.js";
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
 * DR-24 (c): plan.json and applied.json are created exclusively also on a drive without hard links
 * (for example by an exclusive-create open), so a plan run and the DR-21 consent path work there.
 * They are new files, not moves: no consent is involved.
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
 * DR-28 (R-11 M-1): a masked text's visible parts, the text split at every privacy token
 * (PRIVACY_TOKEN_PATTERN_SOURCE) with the tokens left out: `[[CODARYN_SECRET:…]]/a.jpg` gives
 * `["", "/a.jpg"]`, two tokens in a row give an empty part between them, and a text without a
 * token gives `[text]`. Token ids are random in every run, the parts are not: two maskings of the
 * same path have the same parts exactly when they leave the same text visible. It holds no secret
 * value and no hash of one.
 */
export type MaskedParts = readonly string[];

/** DR-28: an action's paths as the plan run masked them, as visible parts. */
export type PlanActionShown =
  | { readonly from: MaskedParts; readonly to: MaskedParts }
  | { readonly path: MaskedParts };

/** DR-28: `masked` split into its visible parts (MaskedParts). */
export function maskedParts(masked: string): MaskedParts {
  return masked.split(new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE));
}

/**
 * DR-32 (c): the exact text whose SHA-256 is the digest of a visible-part list: the list as JSON
 * (`JSON.stringify`), hashed as UTF-8 bytes, written as 64 lowercase hex characters. Each side that
 * needs a digest computes it with its own SHA-256 from this text, so all of them agree; the
 * contracts hash nothing themselves (they hold no platform module).
 */
export function maskedPartsEncoding(parts: MaskedParts): string {
  return JSON.stringify(parts);
}

/** DR-28, DR-29: true when two visible-part lists are the same, part by part. */
export function sameMaskedParts(a: MaskedParts, b: MaskedParts): boolean {
  return a.length === b.length && a.every((part, i) => part === b[i]);
}

/** DR-28: the shown form of an action masked by the plan run's gateway, stored with the action. */
export function planActionShown(masked: MaskedPlanAction): PlanActionShown {
  return masked.kind === "move"
    ? { from: maskedParts(masked.from), to: maskedParts(masked.to) }
    : { path: maskedParts(masked.path) };
}

/**
 * DR-28: true when `masked`, the stored action masked with the secrets registered now, leaves
 * exactly the text visible that the plan run left visible (`action.shown`). False when the kinds
 * differ, a part differs, or the action has no `shown` (a plan written before DR-28): such a plan
 * is not shown or applied (`plan_secrets_differ`).
 */
export function planActionShownMatches(action: StoredPlanAction, masked: MaskedPlanAction): boolean {
  const shown = action.shown;
  if (shown === undefined || action.kind !== masked.kind) return false;
  const now = planActionShown(masked);
  if ("path" in shown) return "path" in now && sameMaskedParts(shown.path, now.path);
  return "from" in now && sameMaskedParts(shown.from, now.from) && sameMaskedParts(shown.to, now.to);
}

/**
 * A stored action: the resolved action and (DR-28) its paths as the plan run masked them. `shown`
 * is written for every action from DR-28 on; it is optional only so that values built before it
 * still type-check. A plan whose action has none is treated as masked differently.
 */
export type StoredPlanAction =
  | (Extract<ResolvedPlanAction, { readonly kind: "move" }> & {
      readonly shown?: { readonly from: MaskedParts; readonly to: MaskedParts };
    })
  | (Extract<ResolvedPlanAction, { readonly kind: "discard" }> & { readonly shown?: { readonly path: MaskedParts } });

/**
 * plan.json: the actions and their source hashes, nothing else (DR-5), plus (DR-28) each action's
 * masked form as visible parts. No policy, verifier, limit, secret name, secret value or hash of
 * one is stored, so this file inside the workspace cannot decide how the apply runs. Raw local
 * text, like the snapshots (R-8): never sent to a model; shown only masked.
 */
export interface StoredPlan {
  readonly schemaVersion: 1;
  readonly kind: "plan";
  /** The plan run. A file naming another run is `invalid_run_record`. */
  readonly runId: string;
  readonly actions: readonly StoredPlanAction[];
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
export type LoadPlanOutcome =
  | {
      readonly ok: true;
      readonly plan: StoredPlan;
      /** SHA-256 of plan.json's bytes, equal to the plan run's `EngineResult.plan.digest`. */
      readonly digest: ContentHash;
      /** applied.json, or null when the plan was not applied. */
      readonly applied: PlanAppliedRecord | null;
    }
  | { readonly ok: false; readonly code: "run_not_found" | "run_not_plan" | "plan_run_missing" | "invalid_run_record" };

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
 * DR-21: the person's consent to unsafe moves (`unsafe_move`) for one apply. It comes only from a
 * person: the CLI's own argument (UNSAFE_MOVE_CONSENT_ARGUMENT, `cli-flag`) or terminal answer
 * (`cli-tty`) for this one `apply`, or an adapter after the person agreed on screen (`adapter`).
 * No task file, config file, profile, plan or model can give it; there is no such field anywhere
 * and none may be added. It names the digest of the plan it is for and holds for that apply only:
 * a later apply needs it again. It is recorded in `apply_started.unsafeMoveConsent`, and every move
 * made under it is marked `unsafe` in `file_moved` and in the result.
 */
export interface UnsafeMoveConsent {
  readonly channel: ApprovalChannel;
  /** Must equal ApplyDeps.digest; a consent for another plan counts as none. */
  readonly digest: ContentHash;
}

/**
 * DR-24 (a): the name a discarded file gets inside `.codaryn/discarded/<apply runId>/`: the
 * action's 0-based index in decimal, one segment (`String(index)`). Readers accept nothing else.
 */
export const DISCARDED_STORED_NAME_PATTERN_SOURCE = "^(0|[1-9][0-9]{0,5})$";
export function discardedStoredName(index: number): string {
  return String(index);
}

/** DR-21: the CLI argument by which a person consents to unsafe moves for this apply. */
export const UNSAFE_MOVE_CONSENT_ARGUMENT = "--allow-unsafe-move";

/**
 * Why the apply's preflight or an action cannot go on.
 * - source_missing, source_changed: the source is gone, or its SHA-256 differs from the plan's
 * - source_not_file, destination_exists, destination_parent_not_dir: as in PLAN_PROBLEMS, now
 * - denied: the policy at apply time refuses the action (DR-5)
 * - cross_device: the rename would cross a volume; nothing is copied
 * - unsafe_move (DR-21, replacing DR-18 b): the move can only be made by a rename that does not
 *   refuse an existing destination (no hard links on that volume, as on FAT or exFAT, or a
 *   read-only source on Windows), so a file created at `to` meanwhile could be replaced. Blocked by
 *   default: the preflight lists such actions (`plan_checked.unsafeMoves`, not `problems`) and the
 *   apply stops as `needs-input`/`consent_required` with nothing moved, unless the person consented
 *   for this apply (UnsafeMoveConsent). While applying, an executor without that consent reports
 *   it as the action's problem and does not move.
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
  "unsafe_move",
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
  /** DR-21: present and true for an action (a move, or a discard's move) made without the exclusive guarantee, after consent. */
  readonly unsafe?: true;
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
  /**
   * Checks one action against the workspace as it is now (hashing the source). Null: it can be
   * applied safely. DR-21: `unsafe_move` when the move could only be made unsafely; the check finds
   * this ahead of the apply and leaves nothing behind (a probe it makes is removed). Changes nothing.
   */
  check(action: ResolvedPlanAction): Promise<PlanItemProblem | null>;
  /**
   * Applies one action. A move creates missing parent directories and renames; it never replaces
   * an existing file and never copies. A discard renames the file into the run's discarded
   * directory as `discardedStoredName(index)` and reports that as `stored`. Never rejects for an
   * item-level failure.
   * DR-21: without `options.allowUnsafeMove` a move (or a discard's move) that could only be made
   * unsafely is not done (`unsafe_move`). With it, the executor may make that move by a plain rename
   * right after checking that the destination is still absent, and marks the outcome `unsafe: true`.
   * The engine passes it only for the actions the preflight listed in `unsafeMoves`.
   */
  apply(
    action: ResolvedPlanAction,
    index: number,
    signal: AbortSignal,
    options?: { readonly allowUnsafeMove: boolean },
  ): Promise<PlanItemOutcome>;
}

export interface PlanExecutorOptions {
  /** The workspace every path is resolved through. */
  readonly workspace: Workspace;
  /** Real absolute path of the workspace root. */
  readonly workspaceRoot: string;
  /** The apply run. `.codaryn/discarded/<runId>/` receives discarded files. */
  readonly runId: string;
}

/**
 * Signature of `createPlanExecutor`, exported by `src/tools/index.ts` (G-C). The CLI (or the app
 * layer) creates one per apply run and hands it to `applyPlan` as `ApplyDeps.executor`.
 */
export type CreatePlanExecutor = (options: PlanExecutorOptions) => PlanExecutor;

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
      /**
       * DR-21: how the person consented to unsafe moves for this apply, or null for no consent.
       * Absent in journals written before DR-21 (no consent).
       */
      readonly unsafeMoveConsent?: ApprovalChannel | null;
    }
  | {
      /**
       * The preflight. Empty `problems`, `inventoryLimitReached` false and no `unsafeMoves` (or
       * consent for them): every action can be applied. Problems or the limit end the apply as
       * `failed`/`plan_stale`; unsafe moves without consent end it as `needs-input`/`consent_required`.
       * Either way nothing is moved.
       */
      readonly type: "plan_checked";
      /** Actions that cannot be applied. Unsafe moves are not listed here. */
      readonly problems: readonly { readonly index: number; readonly problem: PlanItemProblem }[];
      /** DR-6: the workspace has more than MAX_INVENTORY_FILES files, so the apply could not be verified. */
      readonly inventoryLimitReached: boolean;
      /**
       * DR-21: 0-based indexes of the actions that could only be made unsafely (`unsafe_move` from
       * the check), in plan order. A discard counts too: it moves the file into the discarded
       * directory. Absent in journals written before DR-21 (none).
       */
      readonly unsafeMoves?: readonly number[];
    }
  | {
      /** A `move` done. `from` and `to` are masked. */
      readonly type: "file_moved";
      readonly index: number;
      readonly from: MaskedText;
      readonly to: MaskedText;
      readonly sha256: ContentHash;
      /** DR-21: present and true when the move was made unsafely, with the person's consent. */
      readonly unsafe?: true;
    }
  | {
      /** A `discard` done: the file now lies at `.codaryn/discarded/<runId>/<stored>`. */
      readonly type: "file_discarded";
      readonly index: number;
      readonly path: MaskedText;
      /** Built from the action index only, never from the file name: `discardedStoredName(index)`. */
      readonly stored: string;
      readonly sha256: ContentHash;
      /** DR-21: present and true when the file was moved into the discarded directory unsafely, with consent. */
      readonly unsafe?: true;
    }
  | {
      /** An action failed while applying; the apply ends as `failed`/`apply_incomplete`. */
      readonly type: "plan_item_failed";
      readonly index: number;
      readonly problem: PlanItemProblem;
    }
  | Extract<JournalEvent, { readonly type: "verifier_result" | "integrity_checked" | "state_checked" | "run_finished" }>;

export type ApplyJournalEventType = ApplyJournalEvent["type"];

/**
 * R-9 I-4: written right before the executor carries out action `index`, after the checks for a
 * cancel and the duration. An action is done first and recorded (`file_moved`, `file_discarded`)
 * after, so a journal that ends between the two (the process stopped) still names the action, and
 * a revert can find it (changes.ts RevertRun). It is a recovery record, not progress: it is kept
 * out of ApplyJournalEvent so readers that show ApplyJournalEvent stay as they are, and a reader of
 * stored lines skips a type it does not show. Every action the executor was asked to carry out has
 * one; an action that was not reached has none.
 */
export interface PlanItemStartedEvent {
  readonly type: "plan_item_started";
  readonly index: number;
  /** The plan action as recorded: paths masked (the masked plan the apply checked before claiming it). */
  readonly action: MaskedPlanAction;
}

/** What an apply run appends to its journal: the shown records plus the start records. */
export type ApplyJournalEntry = ApplyJournalEvent | PlanItemStartedEvent;

/**
 * A stored line of an apply journal: the event plus the fields every journal adds. Lines of
 * PlanItemStartedEvent, with the same added fields, may appear between them (R-9 I-4).
 */
export type ApplyJournalRecord = ApplyJournalEvent & {
  readonly seq: number;
  readonly at: string;
  readonly runId: string;
};

/**
 * Same contract as Journal (append-only, masked text only), for apply records. A wrapper that also
 * shows progress (HumanOutput.applyProgressLine) passes on every entry and shows only
 * ApplyJournalEvent; `plan_item_started` has no progress line.
 */
export interface ApplyJournal {
  append(event: ApplyJournalEntry): Promise<void>;
  close(): Promise<void>;
}

/**
 * The apply run (`applyPlan`, `src/engine`, G-B). The CLI (or the app layer) has already loaded
 * the plan, checked the digest and that the plan is not applied, resolved the task given to the
 * apply (its workflow settings must say `plan: "apply"`; otherwise `run_not_plan`), registered the
 * secrets as `run` does, checked (DR-28) that every action masked with those secrets matches its
 * `shown` (planActionShownMatches; otherwise `plan_secrets_differ` before anything is shown, asked
 * or started), checked (U-1) that the plan run has no records-changed mark (otherwise
 * `plan_records_changed` before anything is asked) and
 * taken the lock. Order:
 * 1. `apply_started`. U-1: then `planRecordsChanged` when given, the same check again under the lock
 *    (a mark may have been written since the caller's); a mark, or a check that throws, ends the
 *    apply as `failed`/`plan_stale` with a fixed notice naming `plan_records_changed`, before
 *    anything else: nothing is checked, claimed or moved. Then the integrity baseline when
 *    `integrity` is given.
 * 2. Preflight. First (DR-28, the same check as the caller's, kept as a second defence): every
 *    action is masked with `privacy` and compared with its `shown` (planActionShownMatches). When one
 *    differs, the apply ends as `failed`/`plan_stale` with a fixed notice naming
 *    `plan_secrets_differ`; when one cannot be masked, the same with the notice that the paths could
 *    not be masked. Either way before the inventory is taken: nothing is checked, claimed or moved,
 *    and no path is recorded. The masked actions are the ones recorded later. Then:
 *    `inventory.capture()`; every action judged by `policy` (PLAN_ACTION_DESCRIPTORS)
 *    and by `executor.check`. `plan_checked` records the outcome. A problem, or the inventory limit
 *    reached, ends the apply as `failed`/`plan_stale` with nothing moved. DR-21: moves the check
 *    finds unsafe are listed apart (`unsafeMoves`); without a consent for this plan's digest the
 *    apply ends as `needs-input`/`consent_required` with nothing moved; with it those moves are made
 *    with `allowUnsafeMove` and recorded as unsafe.
 * 3. `markApplied()`; "already_applied" ends the apply as `failed`/`plan_stale` with nothing moved.
 * 4. Each action in order: `file_moved` or `file_discarded`, or `plan_item_failed` and the apply
 *    ends as `failed`/`apply_incomplete`. A cancel or the duration limit is honoured between
 *    actions and ends the apply as `cancelled`/`cancelled` or `budget-exhausted`/`max_duration`.
 *    PLAN_ITEM_PROBLEMS has no "cancelled": an executor that saw the signal abort may report
 *    `io_error`. The engine therefore looks at the signal itself before each action and after a
 *    failed one; when it is aborted (or the duration is over) the apply ends as cancelled (or
 *    budget-exhausted), not as `apply_incomplete`, and that action is recorded as not done.
 *    In every case what was done stays, is listed in `ApplyResult.applied`, and `codaryn revert
 *    --run <apply runId>` undoes it. R-9 I-4: before each action `plan_item_started` is recorded,
 *    so an action done just before the process ended, but not yet recorded as done, is still
 *    named in the journal and the revert handles it (PlanItemStartedEvent).
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
  /** DR-21: the person's consent to unsafe moves for this apply, or absent/null for none (blocked). */
  readonly unsafeMoveConsent?: UnsafeMoveConsent | null;
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
  /**
   * The apply task's `policy.planActions` (absent: empty). The engine checks every action's kind
   * against it as well as through the gate, as a plan run does, so an apply fails closed even where
   * a gate does not judge `requires.planAction`.
   */
  readonly planActions: readonly PlanActionKind[];
  /** Real absolute path of `.codaryn/discarded/<runId>/` for this apply run (InventoryCheckInput). */
  readonly discardedRoot: string;
  readonly privacy: PrivacyGateway;
  readonly verifiers: VerifierRunner;
  readonly inventory: InventoryChecker;
  readonly journal: ApplyJournal;
  readonly clock: Clock;
  readonly signal: AbortSignal;
  readonly integrity?: IntegrityChecker;
  /**
   * DR-38: changes to Codaryn's records during the apply (state.ts), from CreateApplyRecorders.
   * Absent: no check and no `state_checked` record. An apply runs no command; the outside code it
   * runs is the verification round. When present the engine:
   * - run_start: after `apply_started`: `base = capture("state")`; records `state_checked` with
   *   `limited`.
   * - before_verify: after the actions: tier "run" is taken afresh as the round's base (the
   *   executor's moves into the run's discarded-files folder are the run's own, and no outside code
   *   ran before this point); tier "state" is compared with `base` (the guard knows markApplied's
   *   write). Recorded only when something changed or `limited` is true.
   * - after_verify: tier "run" against the round's base (the guard knows the journal's verifier
   *   records), tier "state" against `base`. Recorded likewise.
   * - run_end: both again, tier "run" against after_verify's, always recorded, before `run_finished`.
   * A non-empty `changed` is passed to `markRecordsChanged` and ends the apply as
   * `failed`/`state_changed` (at run_end it replaces the status); the moves made stay, and
   * `codaryn revert` can undo them as for any apply run. U-8: a check whose tier state is `limited`,
   * at any phase, adds the notice kind `plan_records_unchecked` (ApplyResult.noticeKinds); the apply
   * goes on.
   */
  readonly stateGuard?: StateGuard;
  /**
   * U-29 (R-44 R44-L1): whether a run before this apply could not check the plan run's records (the
   * store's StateUncheckedSince for `planRunId`). True, or a question that cannot be answered, adds
   * the notice kind `plan_records_unchecked` as the apply's own limited check does, once; the apply
   * goes on. Asked once, after the U-1 check. The CLI passes it; without it only the apply's own
   * checks count (as before).
   */
  readonly planRecordsUnchecked?: () => Promise<boolean>;
  /**
   * U-1 (R-33 R33-L3): whether the plan run (`planRunId`) has a records-changed mark, as the store's
   * `hasRecordsChangedMark` says (fail closed). The CLI passes it, and the app layer through the
   * CLI; without it the apply does not check (as before). Called once, right after `apply_started`.
   */
  readonly planRecordsChanged?: () => Promise<boolean>;
  /** Writes PLAN_APPLIED_FILE_NAME exclusively. "already_applied" when it exists. */
  markApplied(): Promise<"marked" | "already_applied">;
}

/** An applied action as results show it (masked). */
export interface AppliedActionRecord {
  readonly index: number;
  readonly action: MaskedPlanAction;
  readonly stored: string | null;
  /** DR-21: present and true for an action (a move, or a discard's move) made unsafely, with consent. */
  readonly unsafe?: true;
}

/**
 * The reasons an apply run can end with, by status: the subset of RUN_REASONS_BY_STATUS that
 * ApplyResult and an apply run's `run_finished` use (for the run list, report and human output).
 */
export const APPLY_REASONS_BY_STATUS = {
  done: ["verified"],
  failed: ["verifier_failed", "plan_stale", "apply_incomplete", "state_changed"],
  "needs-input": ["verifier_inconclusive", "protected_changed", "consent_required"],
  cancelled: ["cancelled"],
  "budget-exhausted": ["max_duration"],
} as const satisfies { readonly [S in TerminalRunStatus]: readonly RunReasonByStatus[S][] };

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
  /** One of APPLY_REASONS_BY_STATUS[status]. */
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
  /** DR-38: as EngineResult.stateChanged, for the apply run's state checks. */
  readonly stateChanged?: readonly MaskedText[];
  /**
   * U-8: what the apply tells a person besides its status (APPLY_NOTICE_KINDS), each kind once, in
   * that list's order. Absent when there is none: an apply whose state checks were complete adds
   * nothing.
   */
  readonly noticeKinds?: readonly ApplyNoticeKind[];
}

/**
 * U-8 (R-39 L-1): what an apply tells a person besides its status. Each kind comes with one fixed
 * notice in ApplyResult.notices (for the JSON and the report) and the text `apply.notice.<kind>` for
 * the human output; neither changes the status.
 * - plan_records_unchecked: a state check of the apply was limited (StateComparison.limited: the
 *   state directory is larger than MAX_STATE_ENTRIES or MAX_STATE_HASH_BYTES), so the plan run's
 *   records may have been changed without a records-changed mark, and U-1 could not refuse the plan.
 *   The apply is not refused. A cleanup that makes the state directory smaller lets them be checked.
 */
export const APPLY_NOTICE_KINDS = ["plan_records_unchecked"] as const;
export type ApplyNoticeKind = (typeof APPLY_NOTICE_KINDS)[number];

/** Signature of `applyPlan`, exported by `src/engine/index.ts` (G-B). */
export type ApplyPlan = (deps: ApplyDeps) => Promise<ApplyResult>;

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
