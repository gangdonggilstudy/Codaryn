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
 *   what the engine's check before its first model request judges after a file's staleness. The
 *   staleness (the file as the plan saw it, plannedFileStale) is the engine's: it reads the files
 *   then, and the check here would only say what may change before the run. Reads only, no lock.
 * - Thin on the stored plan's form (Codex V-11 may change it): only `kind`, each file's `path` for
 *   the gate, and the loaded plan handed whole to changesPlanOutput.
 */

import { PLANNED_FILE_DESCRIPTOR } from "../contracts/index.js";
import type { ChangesPlanOutput, PolicyConfig, PrivacyGateway, WritablePathSet } from "../contracts/index.js";
import { changesPlanOutput } from "../cli/human/changes-plan.js";
import { createPolicyGate } from "../policy/index.js";
import { hasRecordsChangedMark, loadAnyPlan } from "../store/index.js";
import { createWorkspace } from "../workspace/index.js";
import { appError } from "./errors.js";
import type { AppCallOutcome } from "./types.js";

/** The stored plan's kind for the run: "changes" (a run plan), "plan" (mode apply), or null when none can be read. */
export async function storedPlanKindOf(workspaceRoot: string, runId: string): Promise<"changes" | "plan" | null> {
  try {
    const loaded = await loadAnyPlan({ workspaceRoot, runId });
    return loaded.ok ? loaded.plan.kind : null;
  } catch {
    return null;
  }
}

/** A run plan's view, and the planned files' paths as stored (for the gate; never shown). */
export interface ChangesPlanView {
  readonly output: ChangesPlanOutput;
  readonly files: readonly { readonly path: string }[];
}

/** The view of the run plan of `runId` (checked by the caller to be a run plan). */
export async function changesPlanViewIn(source: { readonly workspaceRoot: string; readonly privacy: Pick<PrivacyGateway, "mask"> }, runId: string): Promise<AppCallOutcome<ChangesPlanView>> {
  const loaded = await loadAnyPlan({ workspaceRoot: source.workspaceRoot, runId });
  if (!loaded.ok) return { ok: false, error: appError(loaded.code, `the plan of run ${runId} cannot be shown (${loaded.code})`) };
  if (loaded.plan.kind !== "changes") return { ok: false, error: appError("internal_error", "the plan is not a run plan") };
  const recordsChanged = await hasRecordsChangedMark(source.workspaceRoot, runId);
  const view = changesPlanOutput({ plan: loaded.plan, digest: loaded.digest, applied: loaded.applied }, source.privacy, recordsChanged ? { recordsChanged } : {});
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

/** What a run that carries a run plan out is given: its policy and writable lists (ResolvedTaskSpec's). */
export interface ChangesPlanCheckSource {
  readonly workspaceRoot: string;
  readonly policy: PolicyConfig;
  readonly writablePathSets?: readonly WritablePathSet[];
}

/**
 * Each planned file the gate of the run that carries the plan out would deny as a write, by its index
 * in the plan: the task's lists and the plan's files as one more list (each entry exactly that file;
 * as approvedPlanWritablePathSets), protected paths and the other denials as for any write.
 */
export async function checkChangesPlanFiles(source: ChangesPlanCheckSource, files: readonly { readonly path: string }[]): Promise<readonly { readonly index: number; readonly problem: "denied" }[]> {
  const workspace = await createWorkspace({ root: source.workspaceRoot });
  const writablePathSets: readonly WritablePathSet[] = [...(source.writablePathSets ?? []), { source: "plan", entries: files.map((file) => file.path) }];
  const gate = createPolicyGate({ config: source.policy, workspace, writablePathSets });
  const problems: { index: number; problem: "denied" }[] = [];
  for (const [index, file] of files.entries()) {
    const call = { id: "plan-check", name: PLANNED_FILE_DESCRIPTOR.name, args: { path: file.path } };
    const requested = gate.checkRequested(call, PLANNED_FILE_DESCRIPTOR);
    const decision = requested.allowed ? await gate.checkEffective(call, PLANNED_FILE_DESCRIPTOR) : requested;
    if (!decision.allowed) problems.push({ index, problem: "denied" });
  }
  return problems;
}
