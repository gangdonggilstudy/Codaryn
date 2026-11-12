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
import { BrowserWindow, Menu, app, dialog, session } from "electron";
import type { MessageBoxOptions } from "electron";
import { IPC_EVENTS } from "../shared/ipc.js";
import type { OpenReply } from "../shared/ipc.js";
import { APP_INDEX_URL } from "./app-url.js";
import { folderArgument } from "./cli-args.js";
import { startEngineHost } from "./engine-client.js";
import type { EngineHost, StartOutcome } from "./engine-client.js";
import { hostEnvironment } from "./environment.js";
import { GUI_STATE_FILE_NAME, settingsDir } from "./gui-state.js";
import { dialogText } from "./dialog-texts.js";
import type { DialogLanguage, DialogTextId } from "./dialog-texts.js";
import { cancelActiveRun, registerIpc, texts } from "./ipc.js";
import { RunManager } from "./runs.js";
import { RunHistory } from "./history.js";
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
  /**
   * Answers the main process's OS dialogs instead of a person: gets the dialog's id and returns the
   * index of the button chosen (smoke tests only; `main.ts` never sets it).
   */
  readonly answerDialog?: (id: DialogTextId) => Promise<number>;
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
  let language: DialogLanguage = "en";
  const history = new RunHistory((size) => randomBytes(size), () => Date.now());
  const runs = new RunManager({
    send: (channel, payload) => {
      if (window !== null && !window.isDestroyed()) window.webContents.send(channel, payload);
    },
    labels: async (status, reason) => {
      const state = await hostState;
      const ids = [`status.${status}`, `reason.${reason}`];
      const found = "host" in state ? await texts(state.host, app.getLocale(), ids) : null;
      return { status: found?.texts[ids[0] as string] ?? status, reason: found?.texts[ids[1] as string] ?? reason };
    },
    // 3.6: the taskbar shows that a run goes on, without a number or the goal.
    onChange: (running) => {
      if (window !== null && !window.isDestroyed()) window.setProgressBar(running ? 2 : -1, { mode: running ? "indeterminate" : "none" });
    },
  });

  /** One of the main process's own OS dialogs; resolves to the index of the button chosen. */
  async function ask(id: DialogTextId, box: Omit<MessageBoxOptions, "message">, values: Readonly<Record<string, string | number>> = {}): Promise<number> {
    if (options.answerDialog !== undefined) return options.answerDialog(id);
    const message = dialogText(language, id, values);
    const shown = window !== null && !window.isDestroyed() ? await dialog.showMessageBox(window, { ...box, message }) : await dialog.showMessageBox({ ...box, message });
    return shown.response;
  }

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
  let closeAfterRun = false;
  app.on("before-quit", (event) => {
    // 3.6: quitting while a run goes on asks first, through the window's close.
    if (runs.running && !closeAfterRun && window !== null && !window.isDestroyed()) {
      event.preventDefault();
      window.close();
      return;
    }
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
      outcome.host.onRunMessage((message) => void runs.receive(message));
      outcome.host.onExit(() => {
        state = { failure: "adapter_host_exited" };
        hostState = Promise.resolve(state);
        runs.hostExited();
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
      runs,
      onLanguage: (chosen) => {
        language = chosen;
      },
      history,
      // 3.8, 6.6: the main process's own question; "do not revert" is the default.
      confirmRevert: async (preview) => {
        const values = { runId: preview.runId, reverted: preview.reverted, skipped: preview.skipped };
        const buttons = [dialogText(language, "revert.confirm"), dialogText(language, "revert.keep")];
        const answer = await ask("revert.message", { type: "warning", title: dialogText(language, "closeRun.title"), detail: dialogText(language, "revert.detail", values), buttons, defaultId: 1, cancelId: 1, noLink: true }, values);
        return answer === 0;
      },
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
    // 3.6: closing while a run goes on asks first (default: keep running); then cancel, and wait
    // for the end (result.json written, lock released) at most 10 seconds.
    window.on("close", (event) => {
      if (closeAfterRun || !runs.running) return;
      event.preventDefault();
      void (async () => {
        const buttons = [dialogText(language, "closeRun.cancelAndClose"), dialogText(language, "closeRun.keep")];
        const answer = await ask("closeRun.message", { type: "question", title: dialogText(language, "closeRun.title"), detail: dialogText(language, "closeRun.detail"), buttons, defaultId: 1, cancelId: 1, noLink: true });
        if (answer !== 0 || !runs.running) return;
        await cancelActiveRun({ host: () => hostState, runs });
        if (!(await runs.waitDone(10_000))) {
          await ask("closeRun.unknown", { type: "warning", title: dialogText(language, "closeRun.title"), buttons: [dialogText(language, "ok")], defaultId: 0, noLink: true });
        }
        closeAfterRun = true;
        if (window !== null && !window.isDestroyed()) window.close();
      })();
    });
    window.on("closed", () => {
      window = null;
      workspaces.clear();
      history.clear();
    });
    await window.loadURL(APP_INDEX_URL);
    if (devTools) window.webContents.openDevTools({ mode: "detach" });
    if (options.afterLoad !== undefined) {
      await options.afterLoad({ window, host: () => hostState, openFromOutside });
    }
  });
}
