/**
 * The GUI's main process (docs/design/standalone-gui.md 4, 6): security settings before anything
 * else, the `app://codaryn/` window, the engine host (a separate Node 26+ process, DR-26) and the
 * IPC handlers. `main.ts` starts it; the smoke test starts it with an `afterLoad` check.
 */

import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { BrowserWindow, Menu, app, session } from "electron";
import { APP_INDEX_URL } from "./app-url.js";
import { startEngineHost } from "./engine-client.js";
import type { EngineHost, StartOutcome } from "./engine-client.js";
import { hostEnvironment } from "./environment.js";
import { WorkspaceHandles } from "./handles.js";
import { registerIpc } from "./ipc.js";
import { findDevelopmentNode } from "./node-path.js";
import { handleAppProtocol, registerAppScheme } from "./protocol.js";
import { guardContents, secureSession } from "./security.js";
import { SESSION_PARTITION, FORBIDDEN_SWITCHES, forbiddenSwitch, secureWebPreferences } from "./security-policy.js";

export interface GuiOptions {
  /** The `gui` package directory. */
  readonly guiRoot: string;
  /** Chromium's profile directory. Default: outside the settings directory (6.3). */
  readonly userDataDir?: string;
  /** Pass the engine host's stderr through. */
  readonly showHostStderr?: boolean;
  /** Called once the window has loaded (smoke tests only; `main.ts` never sets it). */
  readonly afterLoad?: (context: GuiContext) => Promise<void>;
}

export interface GuiContext {
  readonly window: BrowserWindow;
  readonly host: () => Promise<{ readonly host: EngineHost } | { readonly failure: string }>;
  /** Issues a workspace handle as the folder dialog would (the dialog cannot be driven by a test). */
  readonly issueWorkspace: (folder: string) => string;
}

function defaultUserDataDir(): string {
  const local = process.platform === "win32" ? process.env["LOCALAPPDATA"] : undefined;
  if (local !== undefined && isAbsolute(local)) return join(local, "Codaryn", "gui-profile");
  return join(app.getPath("appData"), "Codaryn GUI Profile");
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
  const forbidden =
    forbiddenSwitch(process.argv.slice(1)) ?? FORBIDDEN_SWITCHES.find((name) => app.commandLine.hasSwitch(name)) ?? null;
  if (forbidden !== null) {
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
  const handles = new WorkspaceHandles((size) => randomBytes(size));

  app.on("second-instance", () => {
    if (window === null) return;
    if (window.isMinimized()) window.restore();
    window.focus();
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
    registerIpc({ window: () => window, host: () => hostState, handles, osLocale: () => app.getLocale() });

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
      handles.clear();
    });
    await window.loadURL(APP_INDEX_URL);
    if (devTools) window.webContents.openDevTools({ mode: "detach" });
    if (options.afterLoad !== undefined) {
      await options.afterLoad({ window, host: () => hostState, issueWorkspace: (folder) => handles.issue(folder) });
    }
  });
}
