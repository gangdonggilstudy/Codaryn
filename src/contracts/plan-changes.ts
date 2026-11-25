/** Planned file writes and approved run-plan contracts. Re-exported by plan.ts. */

import type { PolicyDecision, PolicyGate } from "./policy.js";
import type { ContentHash, MaskedText } from "./text.js";
import type { WritablePathSet } from "./task.js";
import type { ToolDescriptor } from "./tool.js";
import type { PlanMode, MaskedParts, StoredPlan, ApprovalChannel } from "./plan-core.js";

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
 * stale (fail closed). tools' `createPlannedFileProbe` makes it for a workspace. Review V-11 H-1:
 * a planned file's path is its effective path when the plan was made (links resolved); it fits only
 * while it still resolves to itself, so a link now on its way (a parent turned into a junction) is
 * `other`.
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
 * Pure. U-219: it reads the files' paths only, so a caller that holds just those (the app layer's
 * check before the approval) builds the same lists.
 */
export function approvedPlanWritablePathSets(
  sets: readonly WritablePathSet[] | undefined,
  plan: { readonly files: readonly { readonly path: string }[] },
): readonly WritablePathSet[] {
  return [...(sets ?? []), { source: "plan", entries: plan.files.map((file) => file.path) }];
}

/**
 * U-219 (p5a's request): how the gate of a run that carries out an approved `run` plan judges one
 * planned file before its first model request (U-187, B-6): a write of `path` with
 * PLANNED_FILE_DESCRIPTOR (call id `approved-plan`), the requested decision and, only when it
 * allows, the effective one (the text, then the real path). `policy` is that run's gate: the task's
 * policy with approvedPlanWritablePathSets. The engine's check calls this function (src/engine
 * `judgePlannedFile`), given out as PreflightPlan is so the app layer's check before the approval can
 * call the same one. Codex V-21: the app does not yet; checkChangesPlanFiles still builds the lists
 * and asks the gate in its own lines (call id `plan-check`), the same judgement, until p5a connects
 * it (U-229). The file's staleness (plannedFileStale) is not in it; a gate that throws rejects it.
 */
export type JudgePlannedFile = (policy: PolicyGate, path: string) => Promise<PolicyDecision>;
