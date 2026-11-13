/**
 * The main process's IPC handlers (docs/design/standalone-gui.md 6.4): one handler per preload
 * function. Each checks the sender and its arguments before anything else; the renderer gets
 * views and codes, never paths it did not choose, real names behind masked ones, or engine
 * exceptions.
 */

import { isAbsolute, join, relative } from "node:path";
import { pathOnDisk } from "./on-disk.js";
import { unnamedWidening } from "./dialog-texts.js";
import { dialog, ipcMain } from "electron";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  doctorMessageIds,
  isNoArgs,
  parseDoctorArgs,
  parseEntryArgs,
  parseIdArg,
  parseProviderArgs,
  parseRevealArgs,
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
  toHostProposal,
  toWrittenReply,
  parseTokenArgs,
  parseRunArgs,
  parseWorkspaceArgs,
  toRevertView,
  toRunsReply,
  parseTreeArgs,
  isRunId,
  toDoctorView,
  toHostModelList,
  toSelectModelReply,
  toSettingsView,
  hostCodeOf,
} from "../shared/ipc.js";
import type { DoctorReply, InfoView, ModelsReply, OpenFolderReply, OpenReply, RecentView, SelectModelReply, SettingsReply, SettingsView, TreeReply } from "../shared/ipc.js";
import { isAppUrl } from "./app-url.js";
import type { EngineHost } from "./engine-client.js";
import type { ModelEntries, ModelListLimit } from "./model-entries.js";
import type { RunManager } from "./runs.js";
import type { ConsentRetry, RevertPreview, RunHistory } from "./history.js";
import { reviewTarget } from "./history.js";
import type { ChangesReply, PlanReply, ReportReply, RevertReply, ReviewReply, RunsReply, SettingsProposalReply, SettingsWrittenReply } from "../shared/ipc.js";
import { parseSettingsEdit } from "../shared/settings-edit.js";
import { cleanupQuestions } from "../shared/cleanup.js";
import { parseCleanupPreviewArgs, toCleanupResultReply, toHostCleanupPreview, toStateSummaryReply } from "../shared/ipc.js";
import type { CleanupPreviewReply, CleanupResultReply, StateSummaryReply } from "../shared/ipc.js";
import type { CleanupPreviewRecord, CleanupPreviews } from "./cleanup-previews.js";
import { reportFileName, writeTextFile } from "./save-file.js";
import { toHostReportMarkdown } from "../shared/ipc.js";
import { copyablePath, parseCheckPlanArgs, toPlanCheckReply, parseCopyArgs, parseRunEventsArgs, parseSaveUiArgs, parseStartTaskArgs, revealableChange, toRunEventsReply } from "../shared/ipc.js";
import type { PlanCheckReply, RunEventsReply } from "../shared/ipc.js";
import { parseRunItems } from "../shared/protocol.js";
import type { UiMemoryView } from "../shared/ipc.js";
import type { CopyReply, RestartReply } from "../shared/ipc.js";
import type { SaveReportReply } from "../shared/ipc.js";
import { parseCreateSettingsArgs, toCreateSettingsReply, toSuggestionsReply } from "../shared/ipc.js";
import type { CreateSettingsReply, SuggestionsReply } from "../shared/ipc.js";
import { basename } from "node:path";
import type { SettingsProposal, SettingsProposals } from "./settings-proposals.js";
import type { PlanApproval, PlanApprovals } from "./plans.js";
import type { Workspaces } from "./workspaces.js";

const DOCTOR_TIMEOUT_MS = 60_000;
const MESSAGES_TIMEOUT_MS = 10_000;
const TREE_TIMEOUT_MS = 30_000;
const SETTINGS_TIMEOUT_MS = 30_000;
/** Listing and choosing a model ask the provider's API (Y-2): the request time limit and retries fit in this. */
const MODELS_TIMEOUT_MS = 120_000;
/** startRun answers after its checks (the CLI's order), before the engine works; the run itself has no time limit here. */
const START_TIMEOUT_MS = 120_000;
const CANCEL_TIMEOUT_MS = 10_000;
const RUNS_TIMEOUT_MS = 30_000;
/** U-119: the check hashes the plan's source files; a large plan takes longer than a listing. */
const PLAN_CHECK_TIMEOUT_MS = 120_000;
/** A revert waits for the workspace lock and moves files back; its preview only reads. */
const REVERT_TIMEOUT_MS = 120_000;

/** What `startRun` answers the window. */
export type StartRunReply = { readonly ok: true; readonly runId: string } | { readonly ok: false; readonly code: string };

export interface IpcDeps {
  readonly window: () => BrowserWindow | null;
  /** The engine host, or why there is none. */
  readonly host: () => Promise<{ readonly host: EngineHost } | { readonly failure: string }>;
  readonly workspaces: Workspaces;
  readonly osLocale: () => string;
  /** A workspace named on the command line of this start, already opened. */
  readonly initialWorkspace: () => { readonly handle: string; readonly name: string } | null;
  /** GU-6: the models of the last list, by entry id. */
  readonly modelEntries: ModelEntries;
  /** R21-I-3: one model list at a time, a few a minute. */
  readonly modelListLimit: ModelListLimit;
  /** Whether CODARYN_MODEL and CODARYN_LANG are set in the app's environment (never their values). */
  readonly envFacts: () => SettingsView["env"];
  /** GU-3: the one run at a time. */
  readonly runs: RunManager;
  /** The window's language once the engine host chose it (for the main process's own dialogs). */
  readonly onLanguage: (language: "ko" | "en") => void;
  /** GU-4: the run lists and revert previews. */
  readonly history: RunHistory;
  /** GU-4 (6.6): asks the person (an OS dialog) whether to revert as previewed; true only on "revert". */
  readonly confirmRevert: (preview: RevertPreview) => Promise<boolean>;
  /** GU-3 (3.7): the OS save dialog: where a report goes (null: cancelled). */
  readonly chooseSavePath: (name: string) => Promise<string | null>;
  /** GU-4 (3.8), DR-39, DR-44: the cleanup previews shown, and the main process's questions before cleaning. */
  readonly cleanupPreviews: CleanupPreviews;
  /** The plan as shown (counts, sizes, the digest's start); "do not clean" is the default. */
  readonly confirmCleanup: (record: CleanupPreviewRecord) => Promise<boolean>;
  /** DR-44 (a): apart, the records of runs not (or only partly) reverted; "keep them" is the default. */
  readonly confirmCleanupNotReverted: (record: CleanupPreviewRecord) => Promise<boolean>;
  /** DR-9: apart, the discarded-files folders (people's files, deleted for good); "keep them" is the default. */
  readonly confirmCleanupDiscarded: (record: CleanupPreviewRecord) => Promise<boolean>;
  /** GU-6: the settings change proposals shown. */
  readonly settingsProposals: SettingsProposals;
  /** GU-6 (6.6): asks the person (an OS dialog) whether to write a change that widens what runs may do. */
  readonly confirmWidening: (proposal: SettingsProposal) => Promise<boolean>;
  /** DR-25: asks the person (a separate OS dialog) for the consent to move this run's files back unsafely. */
  readonly confirmRevertConsent: (retry: ConsentRetry) => Promise<boolean>;
  /** GU-5: the plans shown and their approval tokens. */
  readonly approvals: PlanApprovals;
  /** GU-5 (3.9, 6.6): asks the person (an OS dialog) whether to apply this plan; true only on "apply". */
  readonly confirmApply: (approval: PlanApproval) => Promise<boolean>;
  /** GU-5 (DR-21): asks the person (a separate OS dialog) for the consent to unsafe moves; true only on "agree". */
  readonly confirmConsent: (approval: PlanApproval) => Promise<boolean>;
  /**
   * U-64 (3.12, 4.4): starts a new engine host when the one before has ended (never while one runs).
   * Only the window's "Restart engine" asks for it; the main process never restarts it on its own.
   */
  readonly restartEngine: () => Promise<RestartReply>;
  /** U-63 (3.5, GUI-D8): the OS open dialog for the task file or the variables file (null: cancelled). Never kept. */
  readonly chooseOpenFile: (kind: "task" | "vars") => Promise<string | null>;
  /** U-62 (6.4): puts checked text on the clipboard (the OS clipboard; smoke tests record it instead). */
  readonly writeClipboard: (text: string) => void;
  /** U-66: shows an entry selected in the file manager (the OS one; smoke tests record it instead). Nothing is opened or run. */
  readonly showItemInFolder: (path: string) => void;
  /** U-70 (4.5): what the window remembers of itself, and keeping a change to it. */
  readonly uiMemory: () => Promise<UiMemoryView>;
  readonly saveUi: (change: { readonly screen?: string; readonly treeWidth?: number }) => Promise<void>;
}

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

function safeLocale(locale: string): string | null {
  return /^[A-Za-z0-9_-]{1,64}$/.test(locale) ? locale : null;
}

/** The language the engine host chooses and the shared catalog's texts for `ids` in it. */
export async function texts(host: EngineHost, osLocale: string, ids: readonly string[]): Promise<{ language: "ko" | "en"; texts: Record<string, string> } | null> {
  const response = await host.call("messages", { osLocale: safeLocale(osLocale), ids }, MESSAGES_TIMEOUT_MS);
  if (!response.ok || typeof response.value !== "object" || response.value === null) return null;
  const { language: lang, texts: table } = response.value as Record<string, unknown>;
  if ((lang !== "ko" && lang !== "en") || typeof table !== "object" || table === null) return null;
  const out: Record<string, string> = {};
  for (const id of ids) {
    const text = (table as Record<string, unknown>)[id];
    if (typeof text === "string") out[id] = text;
  }
  return { language: lang, texts: out };
}

export function registerIpc(deps: IpcDeps): void {
  const { workspaces } = deps;
  let language: "ko" | "en" = "en";
  let starting = false;
  const handle = <R>(channel: string, handler: (args: unknown[]) => Promise<R>): void => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<R | null> => {
      if (!fromAppWindow(event, deps.window())) return null;
      return handler(args);
    });
  };

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

  handle(IPC_CHANNELS.openFolder, async (args): Promise<OpenFolderReply> => {
    if (!isNoArgs(args)) return null;
    const window = deps.window();
    if (window === null) return null;
    const chosen = await dialog.showOpenDialog(window, { properties: ["openDirectory", "dontAddToRecent"] });
    const folder = chosen.canceled ? undefined : chosen.filePaths[0];
    if (folder === undefined) return null;
    return workspaces.open(folder);
  });

  handle(IPC_CHANNELS.recent, async (args): Promise<RecentView[] | null> => (isNoArgs(args) ? workspaces.recent() : null));

  handle(IPC_CHANNELS.openRecent, async (args): Promise<OpenReply> => {
    const id = parseIdArg(args);
    return id === null ? { ok: false, code: "invalid_args" } : workspaces.openRecent(id);
  });

  handle(IPC_CHANNELS.forgetRecent, async (args): Promise<boolean> => {
    const id = parseIdArg(args);
    return id === null ? false : workspaces.forgetRecent(id);
  });

  handle(IPC_CHANNELS.tree, async (args): Promise<TreeReply> => {
    const parsed = args.length === 1 ? parseTreeArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const dir = workspaces.treeDir(parsed.workspace, parsed.node);
    if (dir === null) return { ok: false, code: "unknown_entry" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("tree", { workspace: root, dir, offset: parsed.offset }, TREE_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    return workspaces.treeReply(parsed.workspace, dir, response.value);
  });

  /**
   * U-123 (R-82 U-103 L1): a settings write may register a value a tree name held; every tree and
   * changes id given before is dropped (copyPath and reveal refuse them as unknown_entry) and the
   * window is told to read its tree again.
   */
  const dropTreeIds = (): void => {
    workspaces.treeIds.clear();
    const window = deps.window();
    if (window !== null && !window.isDestroyed()) window.webContents.send(IPC_EVENTS.treeReset, {});
  };

  handle(IPC_CHANNELS.reveal, async (args): Promise<boolean> => {
    const parsed = args.length === 1 ? parseRevealArgs(args[0]) : null;
    if (parsed === null) return false;
    const root = workspaces.path(parsed.workspace);
    const rel = root === null ? null : workspaces.treeIds.resolve(parsed.workspace, parsed.node);
    if (root === null || rel === null) return false;
    const target = join(root, ...rel.split("/"));
    const inside = relative(root, target);
    if (inside.length === 0 || inside.startsWith("..") || isAbsolute(inside)) return false;
    // Shows the entry selected in the file manager. Nothing is opened or run.
    deps.showItemInFolder(target);
    return true;
  });

  /**
   * U-62 (6.4; R-73 M1, L1): copies a run id or a digest's first 12 characters only (parseCopyArgs);
   * anything else is invalid_args. Nothing else reaches the clipboard; the page cannot read it.
   */
  handle(IPC_CHANNELS.copyText, async (args): Promise<CopyReply> => {
    const text = args.length === 1 ? parseCopyArgs(args[0]) : null;
    if (text === null) return { ok: false, code: "invalid_args" };
    deps.writeClipboard(text);
    return { ok: true };
  });

  /**
   * U-103 (G-list, 3.3): a tree entry's path relative to the workspace, by its id (the page never names
   * a path). Only entries the app layer did not mask have an id; the path is checked again (copyablePath).
   */
  handle(IPC_CHANNELS.copyPath, async (args): Promise<CopyReply> => {
    const parsed = args.length === 1 ? parseRevealArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    if (workspaces.path(parsed.workspace) === null) return { ok: false, code: "unknown_workspace" };
    const rel = workspaces.treeIds.resolve(parsed.workspace, parsed.node);
    if (rel === null) return { ok: false, code: "unknown_entry" };
    const text = copyablePath(rel);
    if (text === null) return { ok: false, code: "not_copyable" };
    deps.writeClipboard(text);
    return { ok: true };
  });

  /**
   * U-69 (3.10): shows the config file selected in the file manager. Its path comes from the engine
   * host (the settings a run reads) and stays in this process; the page names nothing.
   */
  handle(IPC_CHANNELS.revealConfig, async (args): Promise<CopyReply> => {
    if (!isNoArgs(args)) return { ok: false, code: "invalid_args" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("configFile", {}, SETTINGS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const value = response.value as Record<string, unknown> | null;
    if (typeof value !== "object" || value === null) return { ok: false, code: "host_error" };
    if (value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
    const path = value["path"];
    if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0") || typeof value["exists"] !== "boolean") return { ok: false, code: "host_error" };
    if (value["exists"] !== true) return { ok: false, code: "config_missing" };
    deps.showItemInFolder(path);
    return { ok: true };
  });

  // U-70 (4.5): the last screen and the file panel's width, checked here, kept in gui-state.json.
  handle(IPC_CHANNELS.saveUi, async (args): Promise<boolean> => {
    const parsed = args.length === 1 ? parseSaveUiArgs(args[0]) : null;
    if (parsed === null) return false;
    await deps.saveUi(parsed);
    return true;
  });

  handle(IPC_CHANNELS.doctor, async (args): Promise<DoctorReply> => {
    const parsed = args.length === 1 ? parseDoctorArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    let workspace: string | null = null;
    if (parsed.workspace !== null) {
      workspace = workspaces.path(parsed.workspace);
      if (workspace === null) return { ok: false, code: "unknown_workspace" };
    }
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("doctor", { workspace }, DOCTOR_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const outcome = response.value as Record<string, unknown> | null;
    if (typeof outcome !== "object" || outcome === null) return { ok: false, code: "host_error" };
    if (outcome["ok"] !== true) {
      const error = outcome["error"] as Record<string, unknown> | undefined;
      const code = typeof error?.["code"] === "string" && /^[a-z_]{1,64}$/.test(error["code"]) ? error["code"] : "host_error";
      return { ok: false, code };
    }
    const view = toDoctorView(outcome["output"]);
    if (view === null) return { ok: false, code: "host_error" };
    const labels = await texts(state.host, deps.osLocale(), doctorMessageIds(view));
    const name = workspace === null ? null : (workspace.split(/[\\/]/).filter((part) => part.length > 0).pop() ?? workspace);
    return { ok: true, view, labels: labels?.texts ?? {}, workspaceName: name };
  });

  // GU-6 (3.10): settings, models. The config file is read and written by the app layer only.
  handle(IPC_CHANNELS.settings, async (args): Promise<SettingsReply> => {
    if (!isNoArgs(args)) return { ok: false, code: "invalid_args" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("settings", {}, SETTINGS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    return toSettingsView(response.value, deps.envFacts());
  });

  // U-11 (3.11): the first-run guide: the config file with the defaults (never over an existing one),
  // and init's fixed suggestions for the open workspace (applied through settings proposals).
  handle(IPC_CHANNELS.createSettings, async (args): Promise<CreateSettingsReply> => {
    const parsed = args.length === 1 ? parseCreateSettingsArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = parsed.workspace === null ? null : workspaces.path(parsed.workspace);
    if (parsed.workspace !== null && root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("createSettings", { workspace: root }, SETTINGS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const created = toCreateSettingsReply(response.value);
    if (created.ok) dropTreeIds();
    return created;
  });

  handle(IPC_CHANNELS.settingsSuggestions, async (args): Promise<SuggestionsReply> => {
    const parsed = args.length === 1 ? parseWorkspaceArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("settingsSuggestions", { workspace: root }, SETTINGS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    return toSuggestionsReply(response.value);
  });

  // GU-3 (3.7): a report saved as Markdown to the file the person chose in the OS save dialog.
  handle(IPC_CHANNELS.saveReport, async (args): Promise<SaveReportReply> => {
    const parsed = args.length === 1 ? parseRunArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("reportMarkdown", { workspace: root, runId: parsed.runId }, RUNS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const report = toHostReportMarkdown(response.value);
    if (!report.ok) return report;
    const path = await deps.chooseSavePath(reportFileName(parsed.runId));
    if (path === null) return { ok: false, code: "not_saved" };
    try {
      await writeTextFile(path, report.text);
    } catch {
      return { ok: false, code: "save_failed" };
    }
    return { ok: true, name: basename(path) };
  });

  // GU-4 (3.8), DR-39, DR-44: the state summary; a cleanup preview (the plan stays here, the window gets
  // a token); cleaning by token only, after the main process's questions.
  handle(IPC_CHANNELS.stateSummary, async (args): Promise<StateSummaryReply> => {
    const parsed = args.length === 1 ? parseWorkspaceArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("stateSummary", { workspace: root }, RUNS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    return toStateSummaryReply(response.value);
  });

  handle(IPC_CHANNELS.previewCleanup, async (args): Promise<CleanupPreviewReply> => {
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
  });

  handle(IPC_CHANNELS.applyCleanup, async (args): Promise<CleanupResultReply> => {
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
  });

  // GU-6 (3.10): one edit → a proposal (the new config stays here) → applied by token, asked first when it widens.
  handle(IPC_CHANNELS.proposeSettings, async (args): Promise<SettingsProposalReply> => {
    const edit = args.length === 1 && typeof args[0] === "object" && args[0] !== null ? parseSettingsEdit((args[0] as Record<string, unknown>)["edit"]) : null;
    if (edit === null || Object.keys(args[0] as object).some((key) => key !== "edit")) return { ok: false, code: "invalid_args" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("proposeSettings", { edit }, SETTINGS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const proposal = toHostProposal(response.value);
    if (!proposal.ok) return proposal;
    const token = deps.settingsProposals.issue({ next: proposal.next, baseDigest: proposal.baseDigest, changes: proposal.changes, widening: proposal.widening });
    return { ok: true, token, changes: proposal.changes, widening: proposal.widening, policyNarrowings: proposal.policyNarrowings };
  });

  handle(IPC_CHANNELS.applySettings, async (args): Promise<SettingsWrittenReply> => {
    const parsed = args.length === 1 ? parseTokenArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const proposal = deps.settingsProposals.take(parsed.token);
    if (proposal === null) return { ok: false, code: "unknown_proposal" };
    const widens = proposal.widening.length > 0;
    // U-124: a widening the dialog cannot name is not written (nobody could be told what it widens).
    if (unnamedWidening(proposal.widening)) return { ok: false, code: "unknown_widening" };
    if (widens && !(await deps.confirmWidening(proposal))) return { ok: false, code: "not_confirmed" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("applySettings", { next: proposal.next, baseDigest: proposal.baseDigest, confirmWidening: widens }, SETTINGS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const written = toWrittenReply(response.value);
    if (written.ok && written.written) dropTreeIds();
    return written;
  });

  handle(IPC_CHANNELS.listModels, async (args): Promise<ModelsReply> => {
    const parsed = args.length === 1 ? parseProviderArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    // R21-I-3: the provider's API is asked only within the limit (the screen asks on a press only).
    if (!deps.modelListLimit.begin()) return { ok: false, code: "too_many_requests" };
    deps.modelEntries.clear();
    let response: Awaited<ReturnType<EngineHost["call"]>>;
    try {
      response = await state.host.call("listModels", { provider: parsed.provider }, MODELS_TIMEOUT_MS);
    } finally {
      deps.modelListLimit.end();
    }
    if (!response.ok) return { ok: false, code: response.error.code };
    const list = toHostModelList(response.value);
    if (!list.ok) return list;
    return { ok: true, provider: list.provider, models: deps.modelEntries.issue(list.provider, list.models), current: list.current };
  });

  handle(IPC_CHANNELS.selectModel, async (args): Promise<SelectModelReply> => {
    const parsed = args.length === 1 ? parseEntryArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const chosen = deps.modelEntries.resolve(parsed.entry);
    if (chosen === null) return { ok: false, code: "unknown_entry" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("selectModel", { provider: chosen.provider, model: chosen.id }, MODELS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    return toSelectModelReply(response.value);
  });

  // GU-3 (3.5, 3.6): one run at a time (GUI-D12). The workspace is a handle; the run token stays here.
  handle(IPC_CHANNELS.startRun, async (args): Promise<StartRunReply> => {
    const parsed = args.length === 1 ? parseStartRunArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    if (deps.runs.running || starting) return { ok: false, code: "run_active" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    starting = true;
    try {
      const request = { workspace: root, goal: parsed.goal, profile: parsed.profile, workflowRef: parsed.workflow, language };
      const response = await state.host.call("startRun", request, START_TIMEOUT_MS);
      if (!response.ok) return { ok: false, code: response.error.code };
      const value = response.value as Record<string, unknown> | null;
      if (typeof value !== "object" || value === null || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
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
      if (typeof value !== "object" || value === null || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
      const token = value["run"];
      const runId = value["runId"];
      if (typeof token !== "string" || !/^[0-9a-f]{32}$/.test(token) || !isRunId(runId)) return { ok: false, code: "host_error" };
      deps.runs.begin(token, runId);
      return { ok: true, runId };
    } finally {
      starting = false;
    }
  });

  // GU-4 (3.8): the run list, a revert preview (a dry run) and the revert, which takes the preview's token only.
  handle(IPC_CHANNELS.listRuns, async (args): Promise<RunsReply> => {
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
  });

  handle(IPC_CHANNELS.previewRevert, async (args): Promise<RevertReply> => {
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
  });

  handle(IPC_CHANNELS.revert, async (args): Promise<RevertReply> => {
    const parsed = args.length === 1 ? parsePreviewArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const preview = deps.history.takePreview(parsed.preview);
    if (preview === null) return { ok: false, code: "unknown_preview" };
    if (deps.runs.running) return { ok: false, code: "run_active" };
    const root = workspaces.path(preview.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
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
  });

  // DR-25: the same run once more with the consent, only from a revert's own result and the person's answer.
  handle(IPC_CHANNELS.revertConsent, async (args): Promise<RevertReply> => {
    const parsed = args.length === 1 ? parseRetryArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const retry = deps.history.takeConsentRetry(parsed.retry);
    if (retry === null) return { ok: false, code: "unknown_retry" };
    if (deps.runs.running) return { ok: false, code: "run_active" };
    const root = workspaces.path(retry.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    if (!(await deps.confirmRevertConsent(retry))) return { ok: false, code: "not_confirmed" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("revert", { workspace: root, runId: retry.runId, dryRun: false, consent: true }, REVERT_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const checked = toRevertView(response.value);
    if (!checked.ok) return checked;
    if (checked.view.runId !== retry.runId || checked.view.dryRun) return { ok: false, code: "host_error" };
    return { ok: true, view: checked.view, preview: null, consentRetry: null };
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
    // U-32: a marked plan run gets no token (planApprovable): its apply is refused before any dialog.
    const approval =
      planApprovable(checked.view)
        ? deps.approvals.issue({ workspace: parsed.workspace, profile: parsed.profile, workflowRef: parsed.workflow, planRunId: parsed.runId, digest: checked.view.digest, moves, discards: checked.view.actions.length - moves })
        : null;
    return { ok: true, view: checked.view, approval };
  });

  handle(IPC_CHANNELS.applyPlan, async (args): Promise<StartRunReply> => {
    const parsed = args.length === 1 ? parseApplyArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const approval = deps.approvals.get(parsed.approval);
    if (approval === null) return { ok: false, code: "unknown_plan" };
    if (deps.runs.running || starting) return { ok: false, code: "run_active" };
    const root = workspaces.path(approval.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    let consent = false;
    if (parsed.askConsent) {
      // DR-21: only after this plan's apply stopped as consent_required, and only from the person's answer.
      if (!deps.approvals.mayAskConsent(parsed.approval)) return { ok: false, code: "consent_not_asked" };
      if (!(await deps.confirmConsent(approval))) return { ok: false, code: "not_confirmed" };
      consent = true;
    } else if (!(await deps.confirmApply(approval))) {
      return { ok: false, code: "not_confirmed" };
    }
    if (deps.runs.running || starting) return { ok: false, code: "run_active" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    starting = true;
    try {
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
    return toPlanCheckReply(response.value, approval.planRunId, approval.digest, approval.moves + approval.discards);
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
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("changes", { workspace: root, profile: parsed.profile, workflowRef: parsed.workflow, runId: parsed.runId }, RUNS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const reply = toChangesReply(response.value);
    if (!reply.ok) return reply;
    if (reply.runId !== parsed.runId) return { ok: false, code: "host_error" };
    // U-66 (3.4): "show in folder" takes the tree's ids, given here for plain paths that are there; the page never names a path.
    // U-123 (R-87 U-66 L1): "there" is looked at on disk (lstat inside the root): a path the app layer
    // masked (a key shape shown as [key]) names nothing there and gets no id.
    const files = await Promise.all(reply.files.map(async (file) => ({ ...file, id: revealableChange(file) && (await pathOnDisk(root, file.path)) ? workspaces.treeIds.issue(parsed.workspace, file.path) : null })));
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
