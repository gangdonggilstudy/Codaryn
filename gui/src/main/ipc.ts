/**
 * The main process's IPC handlers (docs/design/standalone-gui.md 6.4): one handler per preload
 * function. Each checks the sender and its arguments before anything else; the renderer gets
 * views and codes, never paths it did not choose, real names behind masked ones, or engine
 * exceptions.
 */

import { isAbsolute, join, relative } from "node:path";
import { dialog, ipcMain, shell } from "electron";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import {
  IPC_CHANNELS,
  doctorMessageIds,
  isNoArgs,
  parseDoctorArgs,
  parseEntryArgs,
  parseIdArg,
  parseProviderArgs,
  parseRevealArgs,
  parseStartRunArgs,
  parsePreviewArgs,
  parsePlanArgs,
  parseApplyArgs,
  parseReviewArgs,
  toPlanView,
  toReviewReply,
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
import type { ModelEntries } from "./model-entries.js";
import type { RunManager } from "./runs.js";
import type { RevertPreview, RunHistory } from "./history.js";
import type { PlanReply, RevertReply, ReviewReply, RunsReply } from "../shared/ipc.js";
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
  /** GU-5: the plans shown and their approval tokens. */
  readonly approvals: PlanApprovals;
  /** GU-5 (3.9, 6.6): asks the person (an OS dialog) whether to apply this plan; true only on "apply". */
  readonly confirmApply: (approval: PlanApproval) => Promise<boolean>;
  /** GU-5 (DR-21): asks the person (a separate OS dialog) for the consent to unsafe moves; true only on "agree". */
  readonly confirmConsent: (approval: PlanApproval) => Promise<boolean>;
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
    return { language: chosen.language, engine: "ready", initialWorkspace };
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
    shell.showItemInFolder(target);
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

  handle(IPC_CHANNELS.listModels, async (args): Promise<ModelsReply> => {
    const parsed = args.length === 1 ? parseProviderArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    deps.modelEntries.clear();
    const response = await state.host.call("listModels", { provider: parsed.provider }, MODELS_TIMEOUT_MS);
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
    if (reply.ok) deps.history.listedRuns(parsed.workspace, reply.runs.map((run) => run.runId));
    return reply;
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
    return { ok: true, view: checked.view, preview };
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
    return { ok: true, view: checked.view, preview: null };
  });

  // GU-5 (3.9, 3.7): the plan view, its apply (asked first, DR-21 consent asked separately) and a review.
  handle(IPC_CHANNELS.plan, async (args): Promise<PlanReply> => {
    const parsed = args.length === 1 ? parsePlanArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("plan", { workspace: root, profile: parsed.profile, runId: parsed.runId }, RUNS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const checked = toPlanView(response.value);
    if (!checked.ok) return checked;
    if (checked.view.runId !== parsed.runId) return { ok: false, code: "host_error" };
    const moves = checked.view.actions.filter((action) => action.kind === "move").length;
    const approval =
      checked.view.status === "pending"
        ? deps.approvals.issue({ workspace: parsed.workspace, profile: parsed.profile, planRunId: parsed.runId, digest: checked.view.digest, moves, discards: checked.view.actions.length - moves })
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
      const request = { workspace: root, profile: approval.profile, planRunId: approval.planRunId, digest: approval.digest, consent, language };
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

  handle(IPC_CHANNELS.review, async (args): Promise<ReviewReply> => {
    const parsed = args.length === 1 ? parseReviewArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("review", { workspace: root, profile: parsed.profile, runId: parsed.runId, decision: parsed.decision, note: parsed.note }, RUNS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    return toReviewReply(response.value);
  });

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
