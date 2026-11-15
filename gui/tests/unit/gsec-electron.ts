/**
 * G-sec (U-274): a stand-in for the `electron` module, so the main process's real IPC handlers
 * (src/main/ipc.ts) run in plain Node. gsec-hooks.ts resolves `electron` to this file once
 * gsec-ipc-harness.ts registers it. It keeps what the handlers register and every OS dialog they
 * open; a dialog answers "cancelled".
 */

export type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

/** The handlers by channel, as ipcMain.handle got them. */
export const handlers = new Map<string, Handler>();
/** Every OS dialog a handler opened, by its method's name. */
export const dialogCalls: string[] = [];

export const ipcMain = {
  handle(channel: string, handler: Handler): void {
    if (handlers.has(channel)) throw new Error(`gsec: ${channel} is registered twice`);
    handlers.set(channel, handler);
  },
  removeHandler(channel: string): void {
    handlers.delete(channel);
  },
  on(channel: string): void {
    throw new Error(`gsec: ipcMain.on(${channel}) bypasses the sender check of handle`);
  },
};

export const dialog = {
  async showOpenDialog(): Promise<{ canceled: boolean; filePaths: string[] }> {
    dialogCalls.push("showOpenDialog");
    return { canceled: true, filePaths: [] };
  },
  async showSaveDialog(): Promise<{ canceled: boolean; filePath?: string }> {
    dialogCalls.push("showSaveDialog");
    return { canceled: true };
  },
  async showMessageBox(): Promise<{ response: number; checkboxChecked: boolean }> {
    dialogCalls.push("showMessageBox");
    return { response: 0, checkboxChecked: false };
  },
};
