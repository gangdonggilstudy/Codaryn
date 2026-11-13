/**
 * The narrow channel (docs/design/standalone-gui.md 6.4). A sandboxed preload cannot load local
 * modules, so the channel names repeat src/shared/ipc.ts (a unit test keeps them equal). Only
 * these functions reach the page: no ipcRenderer, no channel name from the page, no Node object,
 * no IPC event object.
 */

import electron = require("electron");

const { contextBridge, ipcRenderer } = electron;

const CHANNELS = {
  info: "codaryn:app:info",
  restartEngine: "codaryn:app:restartengine",
  copyText: "codaryn:app:copy",
  copyPath: "codaryn:workspace:copypath",
  revealConfig: "codaryn:settings:revealconfig",
  saveUi: "codaryn:app:saveui",
  openFolder: "codaryn:workspace:open",
  recent: "codaryn:workspace:recent",
  openRecent: "codaryn:workspace:openrecent",
  forgetRecent: "codaryn:workspace:forgetrecent",
  tree: "codaryn:workspace:tree",
  reveal: "codaryn:workspace:reveal",
  doctor: "codaryn:doctor:run",
  settings: "codaryn:settings:read",
  listModels: "codaryn:models:list",
  selectModel: "codaryn:models:select",
  startRun: "codaryn:run:start",
  startTaskRun: "codaryn:run:starttask",
  cancelRun: "codaryn:run:cancel",
  listRuns: "codaryn:runs:list",
  previewRevert: "codaryn:runs:previewrevert",
  revert: "codaryn:runs:revert",
  revertConsent: "codaryn:runs:revertconsent",
  plan: "codaryn:plan:read",
  applyPlan: "codaryn:plan:apply",
  review: "codaryn:review:record",
  changes: "codaryn:changes:read",
  report: "codaryn:report:read",
  proposeSettings: "codaryn:settings:propose",
  applySettings: "codaryn:settings:apply",
  stateSummary: "codaryn:state:summary",
  previewCleanup: "codaryn:cleanup:preview",
  applyCleanup: "codaryn:cleanup:apply",
  saveReport: "codaryn:report:save",
  createSettings: "codaryn:settings:create",
  settingsSuggestions: "codaryn:settings:suggestions",
} as const;

const EVENTS = {
  workspaceOpened: "codaryn:event:workspaceopened",
  runEvents: "codaryn:event:runevents",
  runDone: "codaryn:event:rundone",
  engineState: "codaryn:event:enginestate",
} as const;

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const count = (value: unknown): number => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0);

let workspaceListener: ((payload: unknown) => void) | null = null;
ipcRenderer.on(EVENTS.workspaceOpened, (_event, payload: unknown) => {
  // Only the payload goes on, as a plain copy; the event object never reaches the page.
  const value = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  workspaceListener?.({ handle: text(value["handle"]), name: text(value["name"]) });
});

/** A plain data copy of a payload: no prototype, function or event object reaches the page. */
function plain(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as unknown;
  } catch {
    return null;
  }
}

let runEventsListener: ((payload: unknown) => void) | null = null;
let runDoneListener: ((payload: unknown) => void) | null = null;
ipcRenderer.on(EVENTS.runEvents, (_event, payload: unknown) => runEventsListener?.(plain(payload)));
ipcRenderer.on(EVENTS.runDone, (_event, payload: unknown) => runDoneListener?.(plain(payload)));
let engineListener: ((payload: unknown) => void) | null = null;
ipcRenderer.on(EVENTS.engineState, (_event, payload: unknown) => engineListener?.(plain(payload)));

const api = Object.freeze({
  info: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.info),
  restartEngine: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.restartEngine),
  openFolder: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.openFolder),
  recent: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.recent),
  openRecent: (id: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.openRecent, text(id)),
  forgetRecent: (id: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.forgetRecent, text(id)),
  tree: (workspace: unknown, node: unknown, offset: unknown): Promise<unknown> =>
    ipcRenderer.invoke(CHANNELS.tree, { workspace: text(workspace), node: text(node), offset: count(offset) }),
  reveal: (workspace: unknown, node: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.reveal, { workspace: text(workspace), node: text(node) }),
  copyText: (value: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.copyText, { text: text(value) }),
  copyPath: (workspace: unknown, node: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.copyPath, { workspace: text(workspace), node: text(node) }),
  revealConfig: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.revealConfig),
  saveUi: (change: unknown): Promise<unknown> => {
    const given = typeof change === "object" && change !== null ? (change as Record<string, unknown>) : {};
    return ipcRenderer.invoke(CHANNELS.saveUi, {
      ...(typeof given["screen"] === "string" ? { screen: given["screen"] } : {}),
      ...(typeof given["treeWidth"] === "number" ? { treeWidth: given["treeWidth"] } : {}),
    });
  },
  doctor: (workspace: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.doctor, { workspace: text(workspace) }),
  settings: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.settings),
  listModels: (provider: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.listModels, { provider: text(provider) }),
  selectModel: (entry: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.selectModel, { entry: text(entry) }),
  startRun: (workspace: unknown, goal: unknown, profile: unknown, workflow: unknown): Promise<unknown> =>
    ipcRenderer.invoke(CHANNELS.startRun, { workspace: text(workspace), goal: text(goal), profile: text(profile), workflow: text(workflow) }),
  startTaskRun: (workspace: unknown, withVars: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.startTaskRun, { workspace: text(workspace), withVars: withVars === true }),
  cancelRun: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.cancelRun),
  listRuns: (workspace: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.listRuns, { workspace: text(workspace) }),
  previewRevert: (workspace: unknown, runId: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.previewRevert, { workspace: text(workspace), runId: text(runId) }),
  revert: (preview: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.revert, { preview: text(preview) }),
  /** DR-25: the retry token a revert's result gave; never a consent: the main process asks the person. */
  /** U-11: the config file with the defaults; init's suggestions for a workspace. */
  createSettings: (workspace: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.createSettings, { workspace: workspace === null ? null : text(workspace) }),
  settingsSuggestions: (workspace: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.settingsSuggestions, { workspace: text(workspace) }),
  /** GU-3: saves a run's report; the main process's save dialog chooses the file. */
  saveReport: (workspace: unknown, runId: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.saveReport, { workspace: text(workspace), runId: text(runId) }),
  /** GU-4: the state summary; a cleanup preview of a selection (plain data); cleaning by the preview's token only. */
  stateSummary: (workspace: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.stateSummary, { workspace: text(workspace) }),
  previewCleanup: (workspace: unknown, selection: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.previewCleanup, { workspace: text(workspace), selection: plain(selection) }),
  applyCleanup: (token: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.applyCleanup, { token: text(token) }),
  /** One edit as plain data (copied here); never a config file or a path to one. */
  proposeSettings: (edit: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.proposeSettings, { edit: plain(edit) }),
  applySettings: (token: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.applySettings, { token: text(token) }),
  report: (workspace: unknown, runId: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.report, { workspace: text(workspace), runId: text(runId) }),
  revertConsent: (retry: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.revertConsent, { retry: text(retry) }),
  plan: (workspace: unknown, runId: unknown, profile: unknown, workflow: unknown): Promise<unknown> =>
    ipcRenderer.invoke(CHANNELS.plan, { workspace: text(workspace), runId: text(runId), profile: text(profile), workflow: text(workflow) }),
  /** Only the plan view's approval token and whether to be asked for the consent: never a consent or digest. */
  applyPlan: (approval: unknown, askConsent: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.applyPlan, { approval: text(approval), askConsent: askConsent === true }),
  changes: (workspace: unknown, runId: unknown, profile: unknown, workflow: unknown): Promise<unknown> =>
    ipcRenderer.invoke(CHANNELS.changes, { workspace: text(workspace), runId: text(runId), profile: text(profile), workflow: text(workflow) }),
  review: (workspace: unknown, runId: unknown, profile: unknown, workflow: unknown, decision: unknown, note: unknown): Promise<unknown> =>
    ipcRenderer.invoke(CHANNELS.review, { workspace: text(workspace), runId: text(runId), profile: text(profile), workflow: text(workflow), decision: text(decision), note: text(note) }),
  /** One listener at a time for each; a new one replaces the old. */
  onRunEvents: (listener: unknown): void => {
    runEventsListener = typeof listener === "function" ? (listener as (payload: unknown) => void) : null;
  },
  onRunDone: (listener: unknown): void => {
    runDoneListener = typeof listener === "function" ? (listener as (payload: unknown) => void) : null;
  },
  /** U-64: the engine's state when it changes (one listener at a time). */
  onEngineState: (listener: unknown): void => {
    engineListener = typeof listener === "function" ? (listener as (payload: unknown) => void) : null;
  },
  /** One listener at a time; a new one replaces the old. */
  onWorkspaceOpened: (listener: unknown): void => {
    workspaceListener = typeof listener === "function" ? (listener as (payload: unknown) => void) : null;
  },
});

contextBridge.exposeInMainWorld("codaryn", api);
