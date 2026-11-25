/**
 * The main process's IPC handlers (docs/design/standalone-gui.md 6.4): one handler per preload
 * function. Each checks the sender and its arguments before anything else; the renderer gets
 * views and codes, never paths it did not choose, real names behind masked ones, or engine
 * exceptions.
 */

import { pathOnDisk } from "./on-disk.js";
import { ipcMain } from "electron";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  isNoArgs,
  parseStartRunArgs,
  parsePreviewArgs,
  parseRetryArgs,
  parsePlanArgs,
  parseApplyArgs,
  parseReviewArgs,
  planApprovable,
  toPlanView,
  toReviewReply,
  toChangesReply,
  toReportReply,
  parseRunArgs,
  toRevertView,
  isRunId,
  hostCodeOf,
} from "../shared/ipc.js";
import type { InfoView, SaveTextReply, TextReply } from "../shared/ipc.js";
import { isAppUrl } from "./app-url.js";
import { reviewTarget } from "./history.js";
import type { ChangesReply, PlanReply, ReportReply, RevertReply, ReviewReply } from "../shared/ipc.js";
import { reportFileName, reportPathInStateDir, writeTextFile } from "./save-file.js";
import { toHostReportMarkdown } from "../shared/ipc.js";
import { parseCheckPlanArgs, toPlanCheckReply, toStartFailure, parseRunEventsArgs, parseStartTaskArgs, revealableChange, toRunEventsReply } from "../shared/ipc.js";
import type { PlanCheckReply, RunEventsReply } from "../shared/ipc.js";
import { parseRunItems } from "../shared/protocol.js";
import type { RestartReply } from "../shared/ipc.js";
import type { SaveReportReply } from "../shared/ipc.js";
import { basename } from "node:path";
import { createTextFiles } from "./text-files.js";
import { CANCEL_TIMEOUT_MS, PLAN_CHECK_TIMEOUT_MS, REVERT_TIMEOUT_MS, RUNS_TIMEOUT_MS, START_TIMEOUT_MS, TEXT_TIMEOUT_MS, texts } from "./ipc-context.js";
import type { IpcDeps, IpcHandlerContext, StartRunReply } from "./ipc-context.js";
import { createWorkspaceHandlers } from "./ipc-workspace.js";
import { createSettingsHandlers } from "./ipc-settings.js";
import { createHistoryHandlers } from "./ipc-history.js";

export type { IpcDeps, StartRunReply } from "./ipc-context.js";
export { texts } from "./ipc-context.js";

/** Only the app window's main frame on the app's own origin may call. */
function fromAppWindow(event: IpcMainInvokeEvent, window: BrowserWindow | null): boolean {
  const frame = event.senderFrame;
  return (
    window !== null &&
    !window.isDestroyed() &&
    event.sender.id === window.webContents.id &&
    frame !== null &&
    frame === event.sender.mainFrame &&
    isAppUrl(frame.url)
  );
}

export function registerIpc(deps: IpcDeps): void {
  const { workspaces } = deps;
  let language: "ko" | "en" = "en";
  let starting = false;
  let reverting = false;
  let treeEpoch = 0;
  const handle = <R>(channel: string, handler: (args: unknown[]) => Promise<R>): void => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<R | null> => {
      if (!fromAppWindow(event, deps.window())) return null;
      return handler(args);
    });
  };
  const context: IpcHandlerContext = { deps, workspaces };
  const workspaceHandlers = createWorkspaceHandlers(context, () => treeEpoch);
  const historyHandlers = createHistoryHandlers(context);

  handle(IPC_CHANNELS.info, async (args): Promise<InfoView | null> => {
    if (!isNoArgs(args)) return null;
    const initialWorkspace = deps.initialWorkspace();
    const state = await deps.host();
    if (!("host" in state)) return { language: "en", engine: state.failure, initialWorkspace };
    const chosen = await texts(state.host, deps.osLocale(), []);
    if (chosen === null) return { language: "en", engine: "host_error", initialWorkspace };
    language = chosen.language;
    deps.onLanguage(language);
    return { language: chosen.language, engine: "ready", initialWorkspace, ui: await deps.uiMemory() };
  });

  handle(IPC_CHANNELS.openFolder, workspaceHandlers.openFolder);

  handle(IPC_CHANNELS.recent, workspaceHandlers.recent);

  handle(IPC_CHANNELS.openRecent, workspaceHandlers.openRecent);

  handle(IPC_CHANNELS.forgetRecent, workspaceHandlers.forgetRecent);

  handle(IPC_CHANNELS.tree, workspaceHandlers.tree);

  // U-174, U-184 (3.14): the text view's open and save (main/text-files.ts; V-5 M-1: a reset holds for requests under way too).
  const textFiles = createTextFiles({ workspaces, edits: deps.textEdits, host: deps.host, confirm: deps.confirmTextSave, timeoutMs: TEXT_TIMEOUT_MS });
  handle(IPC_CHANNELS.openText, (args): Promise<TextReply> => textFiles.open(args));
  handle(IPC_CHANNELS.saveText, (args): Promise<SaveTextReply> => textFiles.save(args));

  handle(IPC_CHANNELS.textDirty, workspaceHandlers.textDirty);

  /**
   * U-123 (R-82 U-103 L1): a settings write may register a value a tree name held; every tree and
   * changes id given before is dropped (copyPath and reveal refuse them as unknown_entry) and the
   * window is told to read its tree again.
   */
  const dropTreeIds = (): void => {
    treeEpoch++;
    workspaces.treeIds.clear();
    // U-184: an edit token stands for a tree or changes entry too; a settings write drops them.
    deps.textEdits.clear();
    const window = deps.window();
    if (window !== null && !window.isDestroyed()) window.webContents.send(IPC_EVENTS.treeReset, {});
  };

  handle(IPC_CHANNELS.reveal, workspaceHandlers.reveal);

  handle(IPC_CHANNELS.copyText, workspaceHandlers.copyText);

  handle(IPC_CHANNELS.copyPath, workspaceHandlers.copyPath);

  handle(IPC_CHANNELS.revealConfig, workspaceHandlers.revealConfig);

  handle(IPC_CHANNELS.saveUi, workspaceHandlers.saveUi);

  const settingsHandlers = createSettingsHandlers(context, dropTreeIds);

  handle(IPC_CHANNELS.doctor, settingsHandlers.doctor);

  handle(IPC_CHANNELS.settings, settingsHandlers.settings);

  handle(IPC_CHANNELS.createSettings, settingsHandlers.createSettings);

  handle(IPC_CHANNELS.settingsSuggestions, settingsHandlers.settingsSuggestions);

  // GU-3 (3.7): a report saved as Markdown to the file the person chose in the OS save dialog.
  handle(IPC_CHANNELS.saveReport, async (args): Promise<SaveReportReply> => {
    const parsed = args.length === 1 ? parseRunArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("reportMarkdown", { workspace: root, runId: parsed.runId, language }, RUNS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const report = toHostReportMarkdown(response.value);
    if (!report.ok) return report;
    const path = await deps.chooseSavePath(reportFileName(parsed.runId));
    if (path === null) return { ok: false, code: "not_saved" };
    try {
      if (await reportPathInStateDir(path)) return { ok: false, code: "save_state_dir" };
      await writeTextFile(path, report.text);
    } catch {
      return { ok: false, code: "save_failed" };
    }
    return { ok: true, name: basename(path) };
  });

  handle(IPC_CHANNELS.stateSummary, historyHandlers.stateSummary);

  handle(IPC_CHANNELS.previewCleanup, historyHandlers.previewCleanup);

  handle(IPC_CHANNELS.applyCleanup, historyHandlers.applyCleanup);

  handle(IPC_CHANNELS.proposeSettings, settingsHandlers.proposeSettings);

  handle(IPC_CHANNELS.applySettings, settingsHandlers.applySettings);

  handle(IPC_CHANNELS.listModels, settingsHandlers.listModels);

  handle(IPC_CHANNELS.selectModel, settingsHandlers.selectModel);

  // GU-3 (3.5, 3.6): one run at a time (GUI-D12). The workspace is a handle; the run token stays here.
  handle(IPC_CHANNELS.startRun, async (args): Promise<StartRunReply> => {
    const parsed = args.length === 1 ? parseStartRunArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    if (deps.runs.running || starting) return { ok: false, code: "run_active" };
    if (reverting) return { ok: false, code: "revert_active" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    starting = true;
    try {
      const state = await deps.host();
      if (!("host" in state)) return { ok: false, code: state.failure };
      const request = { workspace: root, goal: parsed.goal, profile: parsed.profile, workflowRef: parsed.workflow, language };
      const response = await state.host.call("startRun", request, START_TIMEOUT_MS);
      if (!response.ok) return { ok: false, code: response.error.code };
      const value = response.value as Record<string, unknown> | null;
      // U-212: with the CLI's hint id, when the app layer gave one (why the run was refused).
      if (typeof value !== "object" || value === null || value["ok"] !== true) return toStartFailure(value);
      const token = value["run"];
      const runId = value["runId"];
      if (typeof token !== "string" || !/^[0-9a-f]{32}$/.test(token) || !isRunId(runId)) return { ok: false, code: "host_error" };
      deps.runs.begin(token, runId);
      // R21b-L-1: the run's form, so its plan, changes and report open with it later (also after a restart).
      await workspaces.rememberRun(parsed.workspace, runId, { profile: parsed.profile, workflow: parsed.workflow });
      // U-92: the person sees this run's result, so its review is one they were shown.
      deps.history.noteStarted(parsed.workspace, runId);
      return { ok: true, runId };
    } finally {
      starting = false;
    }
  });

  /**
   * U-63 (3.5, GUI-D8): a run of a task file the person chooses in the OS dialog, with a variables
   * file chosen the same way when asked for. The paths go to the engine host only: not to the page,
   * not into gui-state.json (the run's form is not remembered, so its plan is shown, not applied
   * here). The app layer refuses a task file inside its workspace (S-1), as the CLI's run does.
   */
  handle(IPC_CHANNELS.startTaskRun, async (args): Promise<StartRunReply> => {
    const parsed = args.length === 1 ? parseStartTaskArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    if (deps.runs.running || starting) return { ok: false, code: "run_active" };
    if (reverting) return { ok: false, code: "revert_active" };
    if (workspaces.path(parsed.workspace) === null) return { ok: false, code: "unknown_workspace" };
    starting = true;
    try {
      const taskPath = await deps.chooseOpenFile("task");
      if (taskPath === null) return { ok: false, code: "cancelled" };
      const varsFile = parsed.withVars ? await deps.chooseOpenFile("vars") : null;
      if (parsed.withVars && varsFile === null) return { ok: false, code: "cancelled" };
      const state = await deps.host();
      if (!("host" in state)) return { ok: false, code: state.failure };
      const response = await state.host.call("startTaskRun", { taskPath, varsFile, language }, START_TIMEOUT_MS);
      if (!response.ok) return { ok: false, code: response.error.code };
      const value = response.value as Record<string, unknown> | null;
      if (typeof value !== "object" || value === null || value["ok"] !== true) return toStartFailure(value);
      const token = value["run"];
      const runId = value["runId"];
      if (typeof token !== "string" || !/^[0-9a-f]{32}$/.test(token) || !isRunId(runId)) return { ok: false, code: "host_error" };
      deps.runs.begin(token, runId);
      return { ok: true, runId };
    } finally {
      starting = false;
    }
  });

  handle(IPC_CHANNELS.listRuns, historyHandlers.listRuns);

  handle(IPC_CHANNELS.previewRevert, historyHandlers.previewRevert);

  handle(IPC_CHANNELS.revert, async (args): Promise<RevertReply> => {
    const parsed = args.length === 1 ? parsePreviewArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const preview = deps.history.takePreview(parsed.preview);
    if (preview === null) return { ok: false, code: "unknown_preview" };
    if (deps.runs.running || starting) return { ok: false, code: "run_active" };
    if (reverting) return { ok: false, code: "revert_active" };
    const root = workspaces.path(preview.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    reverting = true;
    try {
      if (!(await deps.confirmRevert(preview))) return { ok: false, code: "not_confirmed" };
      const state = await deps.host();
      if (!("host" in state)) return { ok: false, code: state.failure };
      const response = await state.host.call("revert", { workspace: root, runId: preview.runId, dryRun: false }, REVERT_TIMEOUT_MS);
      if (!response.ok) return { ok: false, code: response.error.code };
      const checked = toRevertView(response.value);
      if (!checked.ok) return checked;
      if (checked.view.runId !== preview.runId || checked.view.dryRun) return { ok: false, code: "host_error" };
      // DR-25: files skipped because their drive has no hard links may go back with the person's consent.
      const unsafe = checked.view.skipped.filter((file) => file.reason === "unsafe_move").length;
      const consentRetry = unsafe > 0 ? deps.history.issueConsentRetry({ workspace: preview.workspace, runId: preview.runId, files: unsafe }) : null;
      return { ok: true, view: checked.view, preview: null, consentRetry };
    } finally {
      reverting = false;
    }
  });

  // DR-25: the same run once more with the consent, only from a revert's own result and the person's answer.
  handle(IPC_CHANNELS.revertConsent, async (args): Promise<RevertReply> => {
    const parsed = args.length === 1 ? parseRetryArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const retry = deps.history.takeConsentRetry(parsed.retry);
    if (retry === null) return { ok: false, code: "unknown_retry" };
    if (deps.runs.running || starting) return { ok: false, code: "run_active" };
    if (reverting) return { ok: false, code: "revert_active" };
    const root = workspaces.path(retry.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    reverting = true;
    try {
      if (!(await deps.confirmRevertConsent(retry))) return { ok: false, code: "not_confirmed" };
      const state = await deps.host();
      if (!("host" in state)) return { ok: false, code: state.failure };
      const response = await state.host.call("revert", { workspace: root, runId: retry.runId, dryRun: false, consent: true }, REVERT_TIMEOUT_MS);
      if (!response.ok) return { ok: false, code: response.error.code };
      const checked = toRevertView(response.value);
      if (!checked.ok) return checked;
      if (checked.view.runId !== retry.runId || checked.view.dryRun) return { ok: false, code: "host_error" };
      return { ok: true, view: checked.view, preview: null, consentRetry: null };
    } finally {
      reverting = false;
    }
  });

  // GU-5 (3.9, 3.7): the plan view, its apply (asked first, DR-21 consent asked separately) and a review.
  handle(IPC_CHANNELS.plan, async (args): Promise<PlanReply> => {
    const parsed = args.length === 1 ? parsePlanArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("plan", { workspace: root, profile: parsed.profile, workflowRef: parsed.workflow, runId: parsed.runId }, RUNS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const checked = toPlanView(response.value);
    if (!checked.ok) return checked;
    if (checked.view.runId !== parsed.runId) return { ok: false, code: "host_error" };
    const moves = checked.view.actions.filter((action) => action.kind === "move").length;
    // U-206 (U-196): a run plan's token stands for its files (the check's indexes and its apply dialog).
    const changes = checked.view.planKind === "changes" ? { planKind: "changes" as const, files: checked.view.files?.length ?? 0 } : {};
    // U-32: a marked plan run gets no token (planApprovable): its apply is refused before any dialog.
    const approval =
      planApprovable(checked.view)
        ? deps.approvals.issue({ workspace: parsed.workspace, profile: parsed.profile, workflowRef: parsed.workflow, planRunId: parsed.runId, digest: checked.view.digest, moves, discards: checked.view.actions.length - moves, ...changes })
        : null;
    return { ok: true, view: checked.view, approval };
  });

  handle(IPC_CHANNELS.applyPlan, async (args): Promise<StartRunReply> => {
    const parsed = args.length === 1 ? parseApplyArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const approval = deps.approvals.get(parsed.approval);
    if (approval === null) return { ok: false, code: "unknown_plan" };
    // U-226 (U-218): a run plan is applied as a plan of moves is (its own dialog, confirmApply), as a
    // run that carries it out. It never asks the DR-21 consent: no apply of it ends consent_required.
    if (deps.runs.running || starting) return { ok: false, code: "run_active" };
    if (reverting) return { ok: false, code: "revert_active" };
    const root = workspaces.path(approval.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    starting = true;
    try {
      let consent = false;
      if (parsed.askConsent) {
        // DR-21: only after this plan's apply stopped as consent_required, and only from the person's answer.
        if (!deps.approvals.mayAskConsent(parsed.approval)) return { ok: false, code: "consent_not_asked" };
        if (!(await deps.confirmConsent(approval))) return { ok: false, code: "not_confirmed" };
        consent = true;
      } else if (!(await deps.confirmApply(approval))) {
        return { ok: false, code: "not_confirmed" };
      }
      const state = await deps.host();
      if (!("host" in state)) return { ok: false, code: state.failure };
      const request = { workspace: root, profile: approval.profile, workflowRef: approval.workflowRef, planRunId: approval.planRunId, digest: approval.digest, consent, language };
      const response = await state.host.call("applyPlan", request, START_TIMEOUT_MS);
      if (!response.ok) return { ok: false, code: response.error.code };
      const value = response.value as Record<string, unknown> | null;
      if (typeof value !== "object" || value === null || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
      const token = value["run"];
      const runId = value["runId"];
      if (typeof token !== "string" || !/^[0-9a-f]{32}$/.test(token) || !isRunId(runId)) return { ok: false, code: "host_error" };
      deps.approvals.applied(parsed.approval, runId);
      deps.runs.begin(token, runId);
      return { ok: true, runId };
    } finally {
      starting = false;
    }
  });

  // DR-7, DR-29 (3.4): a run's changed files, by path and state only. It reads; it changes nothing.
  /**
   * U-119 (3.9, DR-21): checks the plan a plan view showed before it is applied, by that view's
   * approval token (looked at, not used: the apply still takes it, and the person's OS confirmation).
   * The check moves and records nothing; the plan, its form and its digest are the token's.
   */
  handle(IPC_CHANNELS.checkPlan, async (args): Promise<PlanCheckReply> => {
    const token = args.length === 1 ? parseCheckPlanArgs(args[0]) : null;
    if (token === null) return { ok: false, code: "invalid_args" };
    const approval = deps.approvals.get(token);
    if (approval === null) return { ok: false, code: "unknown_plan" };
    const root = workspaces.path(approval.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call(
      "checkPlan",
      { workspace: root, profile: approval.profile, workflowRef: approval.workflowRef, planRunId: approval.planRunId, digest: approval.digest },
      PLAN_CHECK_TIMEOUT_MS,
    );
    if (!response.ok) return { ok: false, code: response.error.code };
    return approval.planKind === "changes"
      ? toPlanCheckReply(response.value, approval.planRunId, approval.digest, approval.files ?? 0, "changes")
      : toPlanCheckReply(response.value, approval.planRunId, approval.digest, approval.moves + approval.discards);
  });

  // U-118 (3.7): one page of a run's records, as the progress list's lines, in the window's language.
  handle(IPC_CHANNELS.runEvents, async (args): Promise<RunEventsReply> => {
    const parsed = args.length === 1 ? parseRunEventsArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call(
      "runEvents",
      { workspace: root, profile: parsed.profile, workflowRef: parsed.workflow, runId: parsed.runId, offset: parsed.offset, language: language === "ko" ? "ko" : "en" },
      RUNS_TIMEOUT_MS,
    );
    if (!response.ok) return { ok: false, code: response.error.code };
    const reply = toRunEventsReply(response.value, parseRunItems);
    return reply.ok && reply.runId !== parsed.runId ? { ok: false, code: "host_error" } : reply;
  });

  handle(IPC_CHANNELS.changes, async (args): Promise<ChangesReply> => {
    const parsed = args.length === 1 ? parsePlanArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const epoch = treeEpoch;
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("changes", { workspace: root, profile: parsed.profile, workflowRef: parsed.workflow, runId: parsed.runId }, RUNS_TIMEOUT_MS);
    if (treeEpoch !== epoch || workspaces.path(parsed.workspace) !== root) return { ok: false, code: "unknown_entry" };
    if (!response.ok) return { ok: false, code: response.error.code };
    const reply = toChangesReply(response.value);
    if (!reply.ok) return reply;
    if (reply.runId !== parsed.runId) return { ok: false, code: "host_error" };
    // U-66 (3.4): "show in folder" takes the tree's ids, given here for plain paths that are there; the page never names a path.
    // U-123 (R-87 U-66 L1): "there" is looked at on disk (lstat inside the root): a path the app layer
    // masked (a key shape shown as [key]) names nothing there and gets no id.
    const available = await Promise.all(reply.files.map(file => revealableChange(file) ? pathOnDisk(root, file.path) : false));
    // A reset can happen during any disk check. Issue all ids synchronously after the final check.
    if (treeEpoch !== epoch || workspaces.path(parsed.workspace) !== root) return { ok: false, code: "unknown_entry" };
    const files = reply.files.map((file, index) => ({ ...file, id: available[index] ? workspaces.treeIds.issue(parsed.workspace, file.path) : null }));
    return { ...reply, files };
  });

  // GU-3 (3.7): a run's report. It reads; it changes nothing. A run id, never "latest".
  handle(IPC_CHANNELS.report, async (args): Promise<ReportReply> => {
    const parsed = args.length === 1 ? parseRunArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("report", { workspace: root, runId: parsed.runId }, RUNS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const reply = toReportReply(response.value);
    if (!reply.ok) return reply;
    if (reply.view.runId !== parsed.runId) return { ok: false, code: "host_error" };
    const finished = reply.view.finished;
    if (finished === null) return { ...reply, labels: null };
    const ids = [`status.${finished.status}`, `reason.${finished.reason}`];
    const found = await texts(state.host, deps.osLocale(), ids);
    return { ...reply, labels: { status: found?.texts[ids[0] as string] ?? finished.status, reason: found?.texts[ids[1] as string] ?? finished.reason } };
  });

  handle(IPC_CHANNELS.review, async (args): Promise<ReviewReply> => {
    const parsed = args.length === 1 ? parseReviewArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    // U-92 (R-73, U-79 L1): a run the person was shown, with the form this app remembers for it (the page's is not used).
    const target = reviewTarget(deps.history.wasListed(parsed.workspace, parsed.runId), (await workspaces.runForms(parsed.workspace)).get(parsed.runId));
    if (!target.ok) return { ok: false, code: target.code };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("review", { workspace: root, profile: target.form.profile, workflowRef: target.form.workflow, runId: parsed.runId, decision: parsed.decision, note: parsed.note }, RUNS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    return toReviewReply(response.value);
  });

  handle(IPC_CHANNELS.restartEngine, async (args): Promise<RestartReply> => (isNoArgs(args) ? deps.restartEngine() : { ok: false, code: "invalid_args" }));

  handle(IPC_CHANNELS.cancelRun, async (args): Promise<boolean> => {
    if (!isNoArgs(args)) return false;
    return cancelActiveRun(deps);
  });
}

/** Cancels the run that goes on (the handle's cancel in the engine host). False when there is none. */
export async function cancelActiveRun(deps: Pick<IpcDeps, "host" | "runs">): Promise<boolean> {
  const token = deps.runs.token;
  if (token === null) return false;
  const state = await deps.host();
  if (!("host" in state)) return false;
  const response = await state.host.call("cancelRun", { run: token }, CANCEL_TIMEOUT_MS);
  return response.ok && typeof response.value === "object" && response.value !== null && (response.value as Record<string, unknown>)["ok"] === true;
}
