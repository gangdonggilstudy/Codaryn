/**
 * The main process's IPC handlers (docs/design/standalone-gui.md 6.4): one handler per preload
 * function. Each checks the sender and its arguments before anything else; the renderer gets
 * views and codes, never paths it did not choose, real names behind masked ones, or engine
 * exceptions.
 */

import { isAbsolute, join, relative } from "node:path";
import { dialog, ipcMain, shell } from "electron";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS, doctorMessageIds, isNoArgs, parseDoctorArgs, parseIdArg, parseRevealArgs, parseTreeArgs, toDoctorView } from "../shared/ipc.js";
import type { DoctorReply, InfoView, OpenFolderReply, OpenReply, RecentView, TreeReply } from "../shared/ipc.js";
import { isAppUrl } from "./app-url.js";
import type { EngineHost } from "./engine-client.js";
import type { Workspaces } from "./workspaces.js";

const DOCTOR_TIMEOUT_MS = 60_000;
const MESSAGES_TIMEOUT_MS = 10_000;
const TREE_TIMEOUT_MS = 30_000;

export interface IpcDeps {
  readonly window: () => BrowserWindow | null;
  /** The engine host, or why there is none. */
  readonly host: () => Promise<{ readonly host: EngineHost } | { readonly failure: string }>;
  readonly workspaces: Workspaces;
  readonly osLocale: () => string;
  /** A workspace named on the command line of this start, already opened. */
  readonly initialWorkspace: () => { readonly handle: string; readonly name: string } | null;
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
  const { workspaces } = deps;
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
    return chosen === null
      ? { language: "en", engine: "host_error", initialWorkspace }
      : { language: chosen.language, engine: "ready", initialWorkspace };
  });

  handle(IPC_CHANNELS.openFolder, async (args): Promise<OpenFolderReply> => {
    if (!isNoArgs(args)) return null;
    const window = deps.window();
    if (window === null) return null;
    const chosen = await dialog.showOpenDialog(window, { properties: ["openDirectory", "dontAddToRecent"] });
    const folder = chosen.canceled ? undefined : chosen.filePaths[0];
    if (folder === undefined) return null;
    const opened = await workspaces.open(folder);
    return opened.ok ? { handle: opened.handle, name: opened.name } : null;
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
}
