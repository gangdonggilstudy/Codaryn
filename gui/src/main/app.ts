/**
 * The GUI's main process (docs/design/standalone-gui.md 4, 6): security settings before anything
 * else, the `app://codaryn/` window, the engine host (a separate Node 26+ process, DR-26) and the
 * IPC handlers. `main.ts` starts it; the smoke test starts it with an `afterLoad` check.
 */

import { randomBytes } from "node:crypto";
import inspector from "node:inspector";
import { existsSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { BrowserWindow, Menu, app, session } from "electron";
import { IPC_EVENTS } from "../shared/ipc.js";
import type { OpenReply } from "../shared/ipc.js";
import { APP_INDEX_URL } from "./app-url.js";
import { folderArgument } from "./cli-args.js";
import { startEngineHost } from "./engine-client.js";
import type { EngineHost, StartOutcome } from "./engine-client.js";
import { hostEnvironment } from "./environment.js";
import { GUI_STATE_FILE_NAME, settingsDir } from "./gui-state.js";
import { registerIpc } from "./ipc.js";
import { ModelEntries } from "./model-entries.js";
import { envValue, findDevelopmentNode } from "./node-path.js";
import { handleAppProtocol, registerAppScheme } from "./protocol.js";
import { guardContents, secureSession } from "./security.js";
import { SESSION_PARTITION, debuggingRequested, secureWebPreferences } from "./security-policy.js";
import { Workspaces } from "./workspaces.js";

export interface GuiOptions {
  /** The `gui` package directory. */
  readonly guiRoot: string;
  /** Chromium's profile directory. Default: outside the settings directory (6.3). */
  readonly userDataDir?: string;
  /** gui-state.json. Default: the settings directory of N-1. Null: keep nothing between starts. */
  readonly stateFile?: string | null;
  /** Pass the engine host's stderr through. */
  readonly showHostStderr?: boolean;
  /** Called once the window has loaded (smoke tests only; `main.ts` never sets it). */
  readonly afterLoad?: (context: GuiContext) => Promise<void>;
}

export interface GuiContext {
  readonly window: BrowserWindow;
  readonly host: () => Promise<{ readonly host: EngineHost } | { readonly failure: string }>;
  /**
   * Opens a folder as a second start of the app with that folder on its command line does, and
   * tells the window (the dialog cannot be driven by a test, the command line can).
   */
  readonly openFromOutside: (folder: string) => Promise<OpenReply>;
}

function defaultUserDataDir(): string {
  const local = process.platform === "win32" ? process.env["LOCALAPPDATA"] : undefined;
  if (local !== undefined && isAbsolute(local)) return join(local, "Codaryn", "gui-profile");
  return join(app.getPath("appData"), "Codaryn GUI Profile");
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function defaultStateFile(): string | null {
  const dir = settingsDir(process.platform, process.env, homedir() || null);
  return dir === null ? null : join(dir, GUI_STATE_FILE_NAME);
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** DR-26: development uses an installed Node 26+; packaged builds carry their own (decided before distribution). */
async function startHost(options: GuiOptions): Promise<StartOutcome | { readonly ok: false; readonly failure: string }> {
  const engineDir = join(options.guiRoot, "..", "dist", "src");
  const nodePath = app.isPackaged ? null : findDevelopmentNode(process.env, process.platform, isFile);
  if (nodePath === null) return { ok: false, failure: "node_not_found" };
  if (!existsSync(join(engineDir, "app", "index.js"))) return { ok: false, failure: "engine_not_built" };
  return startEngineHost({
    nodePath,
    hostScript: join(options.guiRoot, "build", "src", "engine-host", "main.js"),
    engineDir,
    env: hostEnvironment(process.env),
    cwd: app.getPath("home"),
    showStderr: options.showHostStderr === true,
  });
}

export function startGui(options: GuiOptions): void {
  // 6.7, R-10 L-1: a debugging switch, NODE_OPTIONS asking for the inspector, or an inspector that is
  // already open ends the app here. The inspector is closed first. `--inspect-brk` never reaches this
  // line; only the fuses (GU-9) refuse it.
  const debugging = debuggingRequested({
    argv: process.argv.slice(1),
    nodeOptions: process.env["NODE_OPTIONS"],
    inspectorUrl: inspector.url(),
    hasSwitch: (name) => app.commandLine.hasSwitch(name),
  });
  if (debugging !== null) {
    inspector.close();
    app.exit(2);
    return;
  }
  app.enableSandbox();
  registerAppScheme();
  app.setPath("userData", options.userDataDir ?? defaultUserDataDir());
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  Menu.setApplicationMenu(null);
  app.on("web-contents-created", (_event, contents) => guardContents(contents));

  let window: BrowserWindow | null = null;
  let hostState: Promise<{ readonly host: EngineHost } | { readonly failure: string }> = Promise.resolve({ failure: "host_starting" });
  let currentHost: EngineHost | null = null;
  const workspaces = new Workspaces({
    stateFile: options.stateFile === undefined ? defaultStateFile() : options.stateFile,
    platform: process.platform,
    randomBytes: (size) => randomBytes(size),
    now: () => new Date(),
    isDirectory,
  });
  let initialWorkspace: { readonly handle: string; readonly name: string } | null = null;

  /** A folder from a command line (this start's, or a second start's): opened, then shown in the window. */
  async function openFromOutside(folder: string): Promise<OpenReply> {
    const opened = await workspaces.open(folder);
    if (opened.ok && window !== null && !window.isDestroyed()) {
      window.webContents.send(IPC_EVENTS.workspaceOpened, { handle: opened.handle, name: opened.name });
    }
    return opened;
  }

  app.on("second-instance", (_event, argv, workingDirectory) => {
    if (window === null) return;
    if (window.isMinimized()) window.restore();
    window.focus();
    const folder = folderArgument(argv, app.isPackaged, workingDirectory, process.platform);
    if (folder !== null) void openFromOutside(folder);
  });
  app.on("window-all-closed", () => app.quit());
  let closingHost = false;
  app.on("before-quit", (event) => {
    if (closingHost || currentHost === null || currentHost.exited) return;
    // DR-8: the engine host ends with the app. Close its stdin, wait, then quit.
    event.preventDefault();
    closingHost = true;
    void currentHost.close().finally(() => app.quit());
  });

  void app.whenReady().then(async () => {
    secureSession(session.defaultSession);
    const ses = session.fromPartition(SESSION_PARTITION);
    secureSession(ses);
    handleAppProtocol(ses, join(options.guiRoot, "build", "src", "renderer"));

    hostState = startHost(options).then((outcome) => {
      if (!outcome.ok) return { failure: outcome.failure };
      currentHost = outcome.host;
      let state: { readonly host: EngineHost } | { readonly failure: string } = { host: outcome.host };
      outcome.host.onExit(() => {
        state = { failure: "adapter_host_exited" };
        hostState = Promise.resolve(state);
      });
      return state;
    });
    const startFolder = folderArgument(process.argv, app.isPackaged, process.cwd(), process.platform);
    if (startFolder !== null) {
      const opened = await workspaces.open(startFolder);
      if (opened.ok) initialWorkspace = { handle: opened.handle, name: opened.name };
    }
    registerIpc({
      window: () => window,
      host: () => hostState,
      workspaces,
      osLocale: () => app.getLocale(),
      initialWorkspace: () => initialWorkspace,
      modelEntries: new ModelEntries((size) => randomBytes(size)),
      envFacts: () => ({
        model: (envValue(process.env, "CODARYN_MODEL", process.platform) ?? "").trim().length > 0,
        language: (envValue(process.env, "CODARYN_LANG", process.platform) ?? "").trim().length > 0,
      }),
    });

    const devTools = !app.isPackaged && process.env["CODARYN_GUI_DEVTOOLS"] === "1";
    window = new BrowserWindow({
      width: 1100,
      height: 760,
      show: false,
      title: "Codaryn",
      webPreferences: secureWebPreferences(join(options.guiRoot, "build", "src", "preload", "preload.cjs"), devTools),
    });
    window.once("ready-to-show", () => window?.show());
    window.on("closed", () => {
      window = null;
      workspaces.clear();
    });
    await window.loadURL(APP_INDEX_URL);
    if (devTools) window.webContents.openDevTools({ mode: "detach" });
    if (options.afterLoad !== undefined) {
      await options.afterLoad({ window, host: () => hostState, openFromOutside });
    }
  });
}
