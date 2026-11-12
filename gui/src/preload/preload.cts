/**
 * The narrow channel (docs/design/standalone-gui.md 6.4). A sandboxed preload cannot load local
 * modules, so the channel names repeat src/shared/ipc.ts (a unit test keeps them equal). Only
 * these functions reach the page: no ipcRenderer, no channel name from the page, no Node object.
 */

import electron = require("electron");

const { contextBridge, ipcRenderer } = electron;

const CHANNELS = {
  info: "codaryn:app:info",
  openFolder: "codaryn:workspace:open",
  doctor: "codaryn:doctor:run",
} as const;

const api = Object.freeze({
  info: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.info),
  openFolder: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.openFolder),
  doctor: (workspace: unknown): Promise<unknown> =>
    ipcRenderer.invoke(CHANNELS.doctor, { workspace: typeof workspace === "string" ? workspace : null }),
});

contextBridge.exposeInMainWorld("codaryn", api);
