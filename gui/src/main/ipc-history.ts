/** Cleanup and run-history IPC callbacks; ipc.ts owns authentication and registration. */
import { cleanupQuestions } from "../shared/cleanup.js";
import { parseCleanupPreviewArgs, parseRunArgs, parseTokenArgs, parseWorkspaceArgs, toCleanupResultReply, toHostCleanupPreview, toRevertView, toRunsReply, toStateSummaryReply } from "../shared/ipc.js";
import type { CleanupPreviewReply, CleanupResultReply, RevertReply, RunsReply, StateSummaryReply } from "../shared/ipc.js";
import { REVERT_TIMEOUT_MS, RUNS_TIMEOUT_MS } from "./ipc-context.js";
import type { IpcHandlerContext } from "./ipc-context.js";

export function createHistoryHandlers(context: IpcHandlerContext) {
  const { deps, workspaces } = context;

  // GU-4 (3.8), DR-39, DR-44: the state summary; a cleanup preview (the plan stays here, the window gets
  // a token); cleaning by token only, after the main process's questions.
  const stateSummary = async (args: unknown[]): Promise<StateSummaryReply> => {
    const parsed = args.length === 1 ? parseWorkspaceArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("stateSummary", { workspace: root }, RUNS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    return toStateSummaryReply(response.value);
  };

  const previewCleanup = async (args: unknown[]): Promise<CleanupPreviewReply> => {
    const parsed = args.length === 1 ? parseCleanupPreviewArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("previewCleanup", { workspace: root, selection: parsed.selection }, RUNS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const preview = toHostCleanupPreview(response.value);
    if (!preview.ok) return preview;
    const token = deps.cleanupPreviews.issue({ workspace: parsed.workspace, root, selection: parsed.selection, now: preview.now, plan: preview.plan });
    return { ok: true, token, plan: preview.plan };
  };

  const applyCleanup = async (args: unknown[]): Promise<CleanupResultReply> => {
    const parsed = args.length === 1 ? parseTokenArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const record = deps.cleanupPreviews.take(parsed.token);
    if (record === null) return { ok: false, code: "unknown_preview" };
    const questions = cleanupQuestions(record.plan);
    if (!questions.hasItems) return { ok: false, code: "nothing_to_clean" };
    if (!(await deps.confirmCleanup(record))) return { ok: false, code: "not_confirmed" };
    // Asked apart, each only when the plan has such items; each answer holds for this cleanup only.
    const includeNotReverted = questions.notReverted > 0 ? await deps.confirmCleanupNotReverted(record) : false;
    const discarded = questions.discarded.count > 0 ? await deps.confirmCleanupDiscarded(record) : false;
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const confirmation = { digest: record.plan.digest, discarded, includeNotReverted };
    const response = await state.host.call("applyCleanup", { workspace: record.root, selection: record.selection, now: record.now, confirmation }, RUNS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    return toCleanupResultReply(response.value);
  };

  // GU-4 (3.8): the run list, a revert preview (a dry run) and the revert, which takes the preview's token only.
  const listRuns = async (args: unknown[]): Promise<RunsReply> => {
    const parsed = args.length === 1 ? parseWorkspaceArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("listRuns", { workspace: root }, RUNS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const reply = toRunsReply(response.value);
    if (!reply.ok) return reply;
    deps.history.listedRuns(parsed.workspace, reply.runs.map((run) => run.runId));
    const forms = await workspaces.runForms(parsed.workspace);
    return { ...reply, runs: reply.runs.map((run) => (run.state === "checked" ? { ...run, form: forms.get(run.runId) ?? null } : run)) };
  };

  const previewRevert = async (args: unknown[]): Promise<RevertReply> => {
    const parsed = args.length === 1 ? parseRunArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    if (!deps.history.wasListed(parsed.workspace, parsed.runId)) return { ok: false, code: "unknown_run" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("revert", { workspace: root, runId: parsed.runId, dryRun: true }, REVERT_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const checked = toRevertView(response.value);
    if (!checked.ok) return checked;
    if (checked.view.runId !== parsed.runId || !checked.view.dryRun) return { ok: false, code: "host_error" };
    const preview = deps.history.issuePreview({ workspace: parsed.workspace, runId: parsed.runId, reverted: checked.view.reverted.length, skipped: checked.view.skipped.length });
    return { ok: true, view: checked.view, preview, consentRetry: null };
  };

  return { stateSummary, previewCleanup, applyCleanup, listRuns, previewRevert };
}
