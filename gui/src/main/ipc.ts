/**
 * The main process's IPC handlers (docs/design/standalone-gui.md 6.4): one handler per preload
 * function. Each checks the sender and its arguments before anything else; the renderer gets
 * views and codes, never paths it did not choose or engine exceptions.
 */

import { basename } from "node:path";
import { dialog, ipcMain } from "electron";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS, doctorMessageIds, isNoArgs, parseDoctorArgs, toDoctorView } from "../shared/ipc.js";
import type { DoctorReply, InfoView, OpenFolderReply } from "../shared/ipc.js";
import { isAppUrl } from "./app-url.js";
import type { WorkspaceHandles } from "./handles.js";
import type { EngineHost } from "./engine-client.js";

const DOCTOR_TIMEOUT_MS = 60_000;
const MESSAGES_TIMEOUT_MS = 10_000;

export interface IpcDeps {
  readonly window: () => BrowserWindow | null;
  /** The engine host, or why there is none. */
  readonly host: () => Promise<{ readonly host: EngineHost } | { readonly failure: string }>;
  readonly handles: WorkspaceHandles;
  readonly osLocale: () => string;
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
async function texts(host: EngineHost, osLocale: string, ids: readonly string[]): Promise<{ language: "ko" | "en"; texts: Record<string, string> } | null> {
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
  const guard = <A extends unknown[], R>(handler: (...args: A) => Promise<R>) =>
    async (event: IpcMainInvokeEvent, ...args: A): Promise<R | null> => {
      if (!fromAppWindow(event, deps.window())) return null;
      return handler(...args);
    };

  ipcMain.handle(
    IPC_CHANNELS.info,
    guard(async (...args: unknown[]): Promise<InfoView | null> => {
      if (!isNoArgs(args)) return null;
      const state = await deps.host();
      if (!("host" in state)) return { language: "en", engine: state.failure };
      const chosen = await texts(state.host, deps.osLocale(), []);
      return chosen === null ? { language: "en", engine: "host_error" } : { language: chosen.language, engine: "ready" };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.openFolder,
    guard(async (...args: unknown[]): Promise<OpenFolderReply> => {
      if (!isNoArgs(args)) return null;
      const window = deps.window();
      if (window === null) return null;
      const chosen = await dialog.showOpenDialog(window, { properties: ["openDirectory", "dontAddToRecent"] });
      const folder = chosen.canceled ? undefined : chosen.filePaths[0];
      if (folder === undefined) return null;
      return { handle: deps.handles.issue(folder), name: basename(folder) || folder };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.doctor,
    guard(async (...args: unknown[]): Promise<DoctorReply> => {
      const parsed = args.length === 1 ? parseDoctorArgs(args[0]) : null;
      if (parsed === null) return { ok: false, code: "invalid_args" };
      let workspace: string | null = null;
      if (parsed.workspace !== null) {
        workspace = deps.handles.resolve(parsed.workspace);
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
      return { ok: true, view, labels: labels?.texts ?? {}, workspaceName: workspace === null ? null : basename(workspace) || workspace };
    }),
  );
}
