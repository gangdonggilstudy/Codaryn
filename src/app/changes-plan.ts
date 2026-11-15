/**
 * U-196 (DR-69 B-3, B-4): a `run` plan (plan.json `kind: "changes"`, the store's loadAnyPlan) through
 * the app layer, for the GUI's plan screen and its check before the approval. PM (a), AC-D16: the
 * CLI's `plan` and `apply` choose by the plan's kind in na-core's U-195; once its `plan` shows a run
 * plan, the app's plan() takes it from there and this view goes. Until then:
 * - The view: nc-human's changesPlanOutput (U-191) on the loaded plan, with the secrets these settings
 *   register now (DR-28: a planned path that masks otherwise now is plan_secrets_differ, nothing
 *   shown), and the plan run's records-changed mark.
 * - The check (checkChangesPlanFiles): each planned file judged by the gate the run that carries the
 *   plan out will have (the task's policy, its writable lists and the plan's files as one more list,
 *   approvedPlanWritablePathSets), with PLANNED_FILE_DESCRIPTOR, by the text and then the real path:
 *   what the engine's check before its first model request judges after a file's staleness. U-237
 *   (R-108 H-2, U-219, Codex V-21): that gate is made from runGuards (the run's unreadable paths
 *   included, as approvedPlan.policyFor makes it), and each file is judged by the engine's own
 *   judgePlannedFile, not by lines of this module. The
 *   staleness (the file as the plan saw it, plannedFileStale) is the engine's: it reads the files
 *   then, and the check here would only say what may change before the run. Reads only, no lock.
 * - Thin on the stored plan's form (Codex V-11 may change it): only `kind`, each file's `path` for
 *   the gate, and the loaded plan handed whole to changesPlanOutput.
 */

import { approvedPlanWritablePathSets } from "../contracts/index.js";
import type { ChangesPlanOutput, LoadPlanOutcome, PolicyConfig, PrivacyGateway, WritablePathSet } from "../contracts/index.js";
import { changesPlanOutput } from "./changes-plan-output.js";
import { runGuards } from "./input/unreadable.js";
import { judgePlannedFile } from "../engine/index.js";
import { hasRecordsChangedMark, loadAnyPlan } from "../store/index.js";
import { createWorkspace } from "../workspace/index.js";
import { appError } from "./errors.js";
import type { AppCallOutcome } from "./types.js";

/** The stored plan's kind, or why it cannot be read. */
export type StoredPlanKind =
  | { readonly ok: true; readonly kind: "changes" | "plan" }
  | { readonly ok: false; readonly code: Extract<LoadPlanOutcome, { readonly ok: false }>["code"] | "internal_error" };

/**
 * The stored plan's kind for the run: "changes" (a run plan), "plan" (mode apply). Review R-103
 * L-1: when the plan cannot be read, loadAnyPlan's code (run_not_found, run_not_plan,
 * plan_run_missing, invalid_run_record; the plan view's, which reads through the same store), or
 * internal_error when reading threw, so the caller gives the cause instead of guessing a kind.
 */
export async function storedPlanKindOf(workspaceRoot: string, runId: string): Promise<StoredPlanKind> {
  try {
    const loaded = await loadAnyPlan({ workspaceRoot, runId });
    return loaded.ok ? { ok: true, kind: loaded.plan.kind } : { ok: false, code: loaded.code };
  } catch {
    return { ok: false, code: "internal_error" };
  }
}

/** A run plan's view, and the planned files' paths as stored (for the gate; never shown). */
export interface ChangesPlanView {
  readonly output: ChangesPlanOutput;
  readonly files: readonly { readonly path: string }[];
}

/**
 * The view of the run plan of `runId` (checked by the caller to be a run plan). Review R-103 M-1:
 * `keys` is every API key value set now (knownKeyValues), so changesPlanOutput hides the current
 * key in the summary besides key shapes and control characters, as a plan of mode apply's summary
 * is hidden in the output itself (R-49 R49-M1): the GUI and its approval screen get it so.
 */
export async function changesPlanViewIn(
  source: { readonly workspaceRoot: string; readonly privacy: Pick<PrivacyGateway, "mask">; readonly keys: readonly string[] },
  runId: string,
): Promise<AppCallOutcome<ChangesPlanView>> {
  const loaded = await loadAnyPlan({ workspaceRoot: source.workspaceRoot, runId });
  if (!loaded.ok) return { ok: false, error: appError(loaded.code, `the plan of run ${runId} cannot be shown (${loaded.code})`) };
  if (loaded.plan.kind !== "changes") return { ok: false, error: appError("internal_error", "the plan is not a run plan") };
  const recordsChanged = await hasRecordsChangedMark(source.workspaceRoot, runId);
  const view = changesPlanOutput({ plan: loaded.plan, digest: loaded.digest, applied: loaded.applied }, source.privacy, {
    ...(recordsChanged ? { recordsChanged } : {}),
    currentKey: source.keys,
  });
  if (!view.ok) {
    return {
      ok: false,
      error:
        view.code === "plan_secrets_differ"
          ? appError("plan_secrets_differ", "the secrets registered now mask a planned path otherwise than when the plan was made (DR-28); nothing is shown")
          : appError("internal_error", "the plan could not be shown"),
    };
  }
  return { ok: true, output: { output: view.output, files: loaded.plan.files.map((file) => ({ path: file.path })) } };
}

/** What a run that carries a run plan out is given: its policy, writable lists and unreadable paths (ResolvedTaskSpec's). */
export interface ChangesPlanCheckSource {
  readonly workspaceRoot: string;
  readonly policy: PolicyConfig;
  readonly writablePathSets?: readonly WritablePathSet[];
  /** U-237 (R-108 H-2): the run's unreadable paths, every source's united (ResolvedTaskSpec.unreadablePaths). */
  readonly unreadablePaths?: readonly string[];
}

/**
 * Each planned file the gate of the run that carries the plan out would deny as a write, by its index
 * in the plan: the task's lists and the plan's files as one more list (each entry exactly that file;
 * as approvedPlanWritablePathSets), protected paths and the other denials as for any write.
 */
export async function checkChangesPlanFiles(source: ChangesPlanCheckSource, files: readonly { readonly path: string }[]): Promise<readonly { readonly index: number; readonly problem: "denied" }[]> {
  const workspace = await createWorkspace({ root: source.workspaceRoot });
  // U-237 (R-108 H-2): the gate approvedPlan.policyFor gives the carried-out run, from runGuards.
  const gate = runGuards(source, workspace).gate(approvedPlanWritablePathSets(source.writablePathSets, { files }));
  const problems: { index: number; problem: "denied" }[] = [];
  for (const [index, file] of files.entries()) {
    // U-219 (Codex V-21): the engine's own judgement of a planned file.
    const decision = await judgePlannedFile(gate, file.path);
    if (!decision.allowed) problems.push({ index, problem: "denied" });
  }
  return problems;
}
