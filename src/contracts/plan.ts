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

import type { Clock, RunReason, RunReasonByStatus, RunUsage, TerminalRunStatus } from "./engine.js";
import type { IntegrityChecker } from "./integrity.js";
import type { StateGuard } from "./state.js";
import type { JournalEvent } from "./journal.js";
import type { PolicyGate } from "./policy.js";
import type { PrivacyGateway } from "./privacy.js";
import { PRIVACY_TOKEN_PATTERN_SOURCE } from "./text.js";
import type { ContentHash, MaskedText } from "./text.js";
import type { WritablePathSet } from "./task.js";
import type { ToolDescriptor } from "./tool.js";
import type { Workspace } from "./workspace.js";
import type { InventoryChecker, InventoryManifest, VerifierConfig, VerifierResult, VerifierRunner } from "./verify.js";

/**
 * How a task treats a plan. `none`: no plan step, as before stage 4. `apply`: a person approves
 * moves and discards that an apply run carries out without a model (above). `run` (P1, DR-69,
 * B-1): a person approves the files a model may write (StoredChangesPlan), and a later model run
 * writes those files only. A plan run offers the read tools and its own mode's plan tool
 * (ToolDescriptor.planMode): `propose_changes` (U-180, B-3) for `run`. A plan run whose task does
 * not list it reads, ends without a plan (`failed`/`model_error`) and writes nothing.
 */
export const PLAN_MODES = ["none", "apply", "run"] as const;
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
 * P1 (DR-69, B-1): what a `run` plan says will happen to a file. `create`: a new file where nothing
 * exists now. `modify`: a regular file that exists now; its SHA-256 is bound into the plan (B-2).
 * Nothing else: such a plan never deletes, moves or names a directory (B-5).
 */
export const PLANNED_FILE_CHANGES = ["create", "modify"] as const;
export type PlannedFileChange = (typeof PLANNED_FILE_CHANGES)[number];

/** B-5: most files in one `run` plan. Files only, never a directory prefix. More is `invalid_plan` (`too_many`). */
export const MAX_PLANNED_FILES = 100;

/** A planned file as the model proposes it. The path is relative to the workspace root, `/` or `\` separated. */
export interface PlannedFileArgs {
  readonly path: string;
  readonly change: PlannedFileChange;
}

/** Arguments of `propose_changes` (PROPOSE_CHANGES_DEFINITION, tool.ts). */
export interface ProposeChangesArgs {
  /**
   * What will be done, at most MAX_PLAN_SUMMARY_CHARS. Unlike ProposePlanArgs.summary it is stored
   * in plan.json, under the digest the person approves (StoredChangesPlan.summary), and becomes the
   * later run's instruction (B-2): it guides the model and is not enforced. Only the paths are.
   * R-99 L-1: the proposal's B-2 binds only the paths and the hashes; binding the summary too is a
   * deliberate difference the PM accepted, as the safer side: the instruction the person approves is
   * the instruction the later run gets.
   */
  readonly summary: string;
  /** 1 to MAX_PLANNED_FILES files, each path once. */
  readonly files: readonly PlannedFileArgs[];
}

/**
 * A planned file after every check: the path is relative to the workspace root, `/` separated, with
 * links resolved and permitted tokens restored. `sha256`: for `modify`, the file's SHA-256 as the
 * tool read it when the plan was proposed (the model never supplies it); null for `create`. Local
 * text: masked before it is recorded, sent or shown.
 */
export type ResolvedPlannedFile =
  | { readonly path: string; readonly change: "create"; readonly sha256: null }
  | { readonly path: string; readonly change: "modify"; readonly sha256: ContentHash };

/** What `propose_changes` returns when the plan was stored, as ProposePlanPayload does. */
export interface ProposeChangesPayload {
  /** PlanRecorder's result: the SHA-256 of plan.json's bytes. */
  readonly digest: ContentHash;
  readonly files: readonly ResolvedPlannedFile[];
}

/**
 * Why `propose_changes` rejects a plan (tool error `invalid_plan`, as PLAN_PROBLEMS: the message
 * names the file index and this code, never a path). Nothing is stored.
 * - empty, too_many: no file, or more than MAX_PLANNED_FILES
 * - too_large: the `modify` files sum to more than MAX_PLAN_SOURCE_BYTES (every one is hashed)
 * - duplicate_path: a path is listed more than once, as the workspace compares paths
 * - file_missing: a `modify` path where nothing exists
 * - file_exists: a `create` path where something exists
 * - not_file: a `modify` path that is not a regular file (a directory, a link)
 * - parent_not_dir: a parent of the path exists and is not a directory
 * The policy gate judges each path as a write first (PLANNED_FILE_DESCRIPTOR), so a protected path
 * or one outside the run's writable paths is a policy denial, not a problem here.
 */
export const CHANGES_PLAN_PROBLEMS = [
  "empty",
  "too_many",
  "too_large",
  "duplicate_path",
  "file_missing",
  "file_exists",
  "not_file",
  "parent_not_dir",
] as const;
export type ChangesPlanProblem = (typeof CHANGES_PLAN_PROBLEMS)[number];

/**
 * B-1: the synthetic descriptor for judging one planned file with the policy gate, when the plan is
 * proposed and again before the later run starts, as PLAN_ACTION_DESCRIPTORS are used. Its path is
 * a write. No `planAction`: writing a file needs no plan action kind (`PolicyConfig.planActions`).
 */
export const PLANNED_FILE_DESCRIPTOR: ToolDescriptor = {
  name: "plan.file",
  displayClass: "write-local",
  requires: {
    paths: [{ field: "path", access: "write" }],
    command: false,
    network: false,
    destructive: false,
  },
  restoreFields: ["path"],
  documentFields: [],
};

/** A stored planned file: the resolved file and (DR-28) its path as the plan run masked it. */
export type StoredPlannedFile = ResolvedPlannedFile & { readonly shown: MaskedParts };

/**
 * B-1: plan.json of a `run` plan: the same file name, digest rule (the SHA-256 of its bytes) and
 * exclusive write as StoredPlan, under the same DR-5 rule: files, their hashes and the summary,
 * nothing that decides how the later run runs (its policy, limits, verifiers and secrets come from
 * the user's settings and the task at that time). `summary` is the summary as the plan run made it
 * safe (safeModelText, review V-7 M-1: control and invisible characters left out, registered values
 * masked, key shapes hidden as HIDDEN_KEY_MARKER), as visible parts (MaskedParts: no privacy token,
 * no secret value, no key shape); the later run masks it again before sending it (B-3). R-99 L-1:
 * the summary under the digest differs from the proposal's B-2 (paths and hashes only); the PM
 * accepted it as the safer side. U-181: the store writes it (PlanRecorder.saveChangesPlan) and
 * reads it with LoadAnyPlan; LoadPlan still takes `kind: "plan"` only and answers
 * `invalid_run_record` for this kind.
 */
export interface StoredChangesPlan {
  readonly schemaVersion: 1;
  readonly kind: "changes";
  /** The plan run. A file naming another run is `invalid_run_record`. */
  readonly runId: string;
  readonly summary: MaskedParts;
  readonly files: readonly StoredPlannedFile[];
}

/** U-175 (R-99 M-3): either stored plan, told apart by `kind`. */
export type AnyStoredPlan = StoredPlan | StoredChangesPlan;

/** U-175 (R-99 M-3): a planned file as results and ChangesPlanOutput hold it (masked). */
export type MaskedPlannedFile =
  | { readonly path: MaskedText; readonly change: "create"; readonly sha256: null }
  | { readonly path: MaskedText; readonly change: "modify"; readonly sha256: ContentHash };

/** B-1: plan.json's `kind` by the plan mode whose plan run writes it. */
export const STORED_PLAN_KIND_BY_MODE = { apply: "plan", run: "changes" } as const satisfies {
  readonly [M in Exclude<PlanMode, "none">]: (StoredPlan | StoredChangesPlan)["kind"];
};

/**
 * B-6: what the workspace holds at a planned file's path now, as the check before the later run
 * sees it after links are resolved (a link that is left, or anything not a regular file, is `other`).
 */
export type PlannedFileNow =
  | { readonly kind: "missing" }
  | { readonly kind: "file"; readonly sha256: ContentHash }
  | { readonly kind: "other" };

/**
 * B-6: true when a planned file no longer fits the workspace: a `modify` file that is gone, is not a
 * regular file or has another SHA-256, or a `create` path where something exists now. One such file
 * ends the later run as `failed`/`plan_stale` before its first model request (no model tokens are
 * spent). Pure.
 */
export function plannedFileStale(file: ResolvedPlannedFile, now: PlannedFileNow): boolean {
  if (file.change === "create") return now.kind !== "missing";
  return now.kind !== "file" || now.sha256 !== file.sha256;
}

/**
 * U-187 (DR-69 B-6): what the workspace holds at a planned file's path now, for the check before a
 * run carries the plan out. For `create`: `missing` while nothing is at the path and its existing
 * parents are folders, `other` for anything else (a dangling link too). For `modify`: `file` with its
 * SHA-256 when the path names a regular file (its last name not a link), `missing` when it is gone,
 * `other` otherwise. A check that cannot be made answers `other`, which plannedFileStale takes as
 * stale (fail closed). tools' `createPlannedFileProbe` makes it for a workspace.
 */
export type PlannedFileProbe = (file: ResolvedPlannedFile, signal: AbortSignal) => Promise<PlannedFileNow>;

/**
 * U-187 (DR-69 B-3, B-6, B-7): an approved `run` plan as the engine carries it out
 * (RunApprovedPlan, engine.ts). The caller (B-4: the CLI's and the app's `apply`) loaded it with
 * LoadAnyPlan, checked that the person approved this digest (DR-1) and resolved the task to
 * `plan: "run"`, as an apply run's caller does for `apply`.
 */
export interface ApprovedChangesPlan {
  readonly planRunId: string;
  /** The approved digest, the SHA-256 of the bytes `plan` was read from. */
  readonly digest: ContentHash;
  readonly approval: ApprovalChannel;
  readonly plan: StoredChangesPlan;
  readonly fileNow: PlannedFileProbe;
  /**
   * As ApplyDeps.markApplied: writes PLAN_APPLIED_FILE_NAME exclusively; "already_applied" when it
   * exists. U-181: RunRecorders.markApplied of this run's recorders (made with
   * RunRecordersOptions.planRunId), whose state guard knows that write.
   */
  markApplied(): Promise<"marked" | "already_applied">;
  /**
   * U-187 (U-181's handoff), as ApplyDeps.planRecordsUnchecked: whether a run since the plan could
   * not check the state directory (the store's StateUncheckedSince for `planRunId`, with this run as
   * the apply run). True, or a question that cannot be answered, adds a notice once; the run goes
   * on. Asked once, after the claim. Absent: not asked.
   */
  readonly planRecordsUnchecked?: () => Promise<boolean>;
}

/**
 * U-187 (DR-69 B-4, B-5): the writable lists of a run that carries out `plan`: the task's lists
 * (ResolvedTaskSpec.writablePathSets), then the plan's files as one more list (source `plan`, each
 * entry exactly that file), so a write must be both a planned file and inside every policy list.
 * Pure.
 */
export function approvedPlanWritablePathSets(sets: readonly WritablePathSet[] | undefined, plan: StoredChangesPlan): readonly WritablePathSet[] {
  return [...(sets ?? []), { source: "plan", entries: plan.files.map((file) => file.path) }];
}

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
  /**
   * U-105 (app layer U-91): how many hard link probes this executor made (`check`, DR-21) and
   * could not take back: the removal failed, and not because the probe was already gone. Such a
   * probe is a second name of a source file, in the state directory or next to the source. A count
   * only, never a name (a name holds a path). Changes nothing. Optional for other executors (test
   * doubles); tools' `createPlanExecutor` always gives it.
   */
  probesLeft?(): number;
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
 * U-105 (app layer U-90): every ApplyJournalEventType at run time, as JOURNAL_EVENT_TYPES is for
 * runs. The table names each type once; `satisfies` makes a type added to ApplyJournalEvent fail to
 * compile until it is listed here. Order: as in ApplyJournalEvent.
 */
const APPLY_JOURNAL_EVENT_TYPE_TABLE = {
  apply_started: true,
  plan_checked: true,
  file_moved: true,
  file_discarded: true,
  plan_item_failed: true,
  verifier_result: true,
  integrity_checked: true,
  state_checked: true,
  run_finished: true,
} as const satisfies Record<ApplyJournalEventType, true>;

/** U-105: the record types an apply journal shows (ApplyJournalEventType), in ApplyJournalEvent's order. */
export const APPLY_JOURNAL_EVENT_TYPES: readonly ApplyJournalEventType[] = Object.keys(APPLY_JOURNAL_EVENT_TYPE_TABLE) as ApplyJournalEventType[];

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

export type ApplyJournalEntryType = ApplyJournalEntry["type"];

/** U-105: the shown types and the start record; `satisfies` as for APPLY_JOURNAL_EVENT_TYPES. */
const APPLY_JOURNAL_ENTRY_TYPE_TABLE = {
  ...APPLY_JOURNAL_EVENT_TYPE_TABLE,
  plan_item_started: true,
} as const satisfies Record<ApplyJournalEntryType, true>;

/**
 * U-105: every type a stored line of an apply journal may have: APPLY_JOURNAL_EVENT_TYPES, then
 * `plan_item_started` (R-9 I-4), which readers count but do not show.
 */
export const APPLY_JOURNAL_ENTRY_TYPES: readonly ApplyJournalEntryType[] = Object.keys(APPLY_JOURNAL_ENTRY_TYPE_TABLE) as ApplyJournalEntryType[];

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
 * apply (its task type settings must say `plan: "apply"`; otherwise `run_not_plan`), registered the
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
   * store's StateUncheckedSince for `planRunId` and this apply's `runId`). True, or a question that
   * cannot be answered, adds the notice kind `plan_records_unchecked`, once; the apply goes on. Asked
   * once, after the U-1 check. The CLI passes it; without it only the apply's own checks count (as
   * before). U-33 (R-56 Q-1 (a)): the apply's own limited check comes first. When one of its state
   * checks was limited (any phase), the notice and the result are U-8's, as if it were not asked
   * (main a191a50, nothing added). Only when every own check was complete (or there was none) is the
   * answer told: after the apply's last check (run_end), with its own notice and
   * ApplyResult.planRecordsUncheckedCause "run_since_plan".
   */
  readonly planRecordsUnchecked?: () => Promise<boolean>;
  /**
   * U-1 (R-33 R33-L3): whether the plan run (`planRunId`) has a records-changed mark, as the store's
   * `hasRecordsChangedMark` says (fail closed). The CLI passes it, and the app layer through the
   * CLI; without it the apply does not check (as before). Called once, right after `apply_started`.
   */
  readonly planRecordsChanged?: () => Promise<boolean>;
  /**
   * U-16 (UXM-15): the task id the plan run ran with (its `run_started.taskId`, as its run list entry
   * gives it). When given and not `taskId`, the apply adds the notice kind `plan_task_differs`. The
   * CLI passes it; without it nothing is compared (as before).
   */
  readonly planTaskId?: string;
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
  /**
   * U-33 (R-56 Q-1 (a)): why `plan_records_unchecked` is told, when it is not the apply's own check
   * (PLAN_RECORDS_UNCHECKED_CAUSES). Absent with that kind: a state check of this apply was limited
   * (U-8; it comes first when both are so), and its texts are U-8's. "run_since_plan": every check of
   * this apply was complete, but a run since the plan could not check the state directory
   * (ApplyDeps.planRecordsUnchecked); the human line is
   * `apply.notice.plan_records_unchecked.run_since_plan`, not U-8's. Absent without that kind.
   */
  readonly planRecordsUncheckedCause?: PlanRecordsUncheckedCause;
  /**
   * U-155 (GT-D14, the contract's part): how many folders the apply's actions left without any file,
   * which stay in place (removing a folder is not an action: GT-D14 tells and keeps them). See
   * foldersLeftEmptyOf for the count. Absent when it is 0, when the apply stopped before its
   * inventory after the actions, when either inventory reached MAX_INVENTORY_FILES (it cannot be
   * told), and in results before U-155. A count only, never a path. U-158: `applyPlan` sets it
   * from its inventories before and after the actions; the human line (`apply.folders_left_empty`)
   * follows with the renderer.
   */
  readonly foldersLeftEmpty?: number;
}

/**
 * U-155 (GT-D14): the folders that held at least one file or link in `before` and hold none in
 * `after`, among the folders on the applied actions' source paths (each folder from the source's
 * parent up to, not including, the workspace root). The inventories list files and links only
 * (InventoryManifest), so a folder left with only empty folders inside counts as left empty too.
 * Null when either manifest reached its limit or holds an `unchecked` entry under such a folder (it
 * cannot be told). Paths are root-relative, `/` separated, as the manifests and the actions give
 * them; letter case is compared as written. Pure; ApplyResult.foldersLeftEmpty is its value when
 * above 0.
 */
export function foldersLeftEmptyOf(
  before: InventoryManifest,
  after: InventoryManifest,
  applied: readonly AppliedPlanAction[],
): number | null {
  if (before.limitReached || after.limitReached) return null;
  const folders = new Set<string>();
  for (const { action } of applied) {
    const source = action.kind === "move" ? action.from : action.path;
    const parts = source.split("/");
    for (let end = parts.length - 1; end > 0; end -= 1) folders.add(parts.slice(0, end).join("/"));
  }
  const holds = (manifest: InventoryManifest, folder: string): boolean | null => {
    let found = false;
    for (const entry of manifest.entries) {
      if (!entry.path.startsWith(`${folder}/`)) continue;
      if (entry.kind === "unchecked") return null;
      found = true;
    }
    return found;
  };
  let count = 0;
  for (const folder of folders) {
    const had = holds(before, folder);
    const has = holds(after, folder);
    if (had === null || has === null) return null;
    if (had && !has) count += 1;
  }
  return count;
}

/**
 * U-8 (R-39 L-1): what an apply tells a person besides its status. Each kind comes with one fixed
 * notice in ApplyResult.notices (for the JSON and the report) and the text `apply.notice.<kind>` for
 * the human output; neither changes the status.
 * - plan_records_unchecked: a state check of the apply was limited (StateComparison.limited: the
 *   state directory is larger than MAX_STATE_ENTRIES or MAX_STATE_HASH_BYTES), so the plan run's
 *   records may have been changed without a records-changed mark, and U-1 could not refuse the plan.
 *   The apply is not refused. A cleanup that makes the state directory smaller lets them be checked.
 *   U-29, U-33: also when every own check was complete but a run since the plan could not check
 *   (ApplyResult.planRecordsUncheckedCause "run_since_plan"); then the notice and the human line say
 *   so, and do not advise a cleanup (the state directory may be small now; the record stays).
 * - plan_task_differs (U-16, UXM-15): the plan run ran with another task than the one given to the
 *   apply (ApplyDeps.planTaskId is not ApplyDeps.taskId), for example a plan made with a task file
 *   and applied with the quick form: that task's verifiers and rules are not the ones used. Not
 *   refused.
 */
export const APPLY_NOTICE_KINDS = ["plan_records_unchecked", "plan_task_differs"] as const;
export type ApplyNoticeKind = (typeof APPLY_NOTICE_KINDS)[number];

/**
 * U-33 (R-56 Q-1 (a)): the causes of `plan_records_unchecked` other than the apply's own limited
 * check (which has no value: ApplyResult.planRecordsUncheckedCause absent). Each has the human line
 * `apply.notice.plan_records_unchecked.<cause>`.
 */
export const PLAN_RECORDS_UNCHECKED_CAUSES = ["run_since_plan"] as const;
export type PlanRecordsUncheckedCause = (typeof PLAN_RECORDS_UNCHECKED_CAUSES)[number];

/** Signature of `applyPlan`, exported by `src/engine/index.ts` (G-B). */
export type ApplyPlan = (deps: ApplyDeps) => Promise<ApplyResult>;

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
