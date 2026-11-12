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
  openFolder: "codaryn:workspace:open",
  recent: "codaryn:workspace:recent",
  openRecent: "codaryn:workspace:openrecent",
  forgetRecent: "codaryn:workspace:forgetrecent",
  tree: "codaryn:workspace:tree",
  reveal: "codaryn:workspace:reveal",
  doctor: "codaryn:doctor:run",
} as const;

const EVENTS = {
  workspaceOpened: "codaryn:event:workspaceopened",
} as const;

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const count = (value: unknown): number => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0);

let workspaceListener: ((payload: unknown) => void) | null = null;
ipcRenderer.on(EVENTS.workspaceOpened, (_event, payload: unknown) => {
  // Only the payload goes on, as a plain copy; the event object never reaches the page.
  const value = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  workspaceListener?.({ handle: text(value["handle"]), name: text(value["name"]) });
});

const api = Object.freeze({
  info: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.info),
  openFolder: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.openFolder),
  recent: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.recent),
  openRecent: (id: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.openRecent, text(id)),
  forgetRecent: (id: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.forgetRecent, text(id)),
  tree: (workspace: unknown, node: unknown, offset: unknown): Promise<unknown> =>
    ipcRenderer.invoke(CHANNELS.tree, { workspace: text(workspace), node: text(node), offset: count(offset) }),
  reveal: (workspace: unknown, node: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.reveal, { workspace: text(workspace), node: text(node) }),
  doctor: (workspace: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.doctor, { workspace: text(workspace) }),
  /** One listener at a time; a new one replaces the old. */
  onWorkspaceOpened: (listener: unknown): void => {
    workspaceListener = typeof listener === "function" ? (listener as (payload: unknown) => void) : null;
  },
});

contextBridge.exposeInMainWorld("codaryn", api);
