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
import { BrowserWindow, Menu, Notification, app, clipboard, dialog, nativeTheme, screen, session, shell } from "electron";
import { fitBounds } from "./window-bounds.js";
import type { QuestionAnswer } from "./runs.js";
import type { PermissionQuestion } from "../shared/protocol.js";
import type { MessageBoxOptions, OpenDialogOptions } from "electron";
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
import { PlanApprovals } from "./plans.js";
import { SettingsProposals } from "./settings-proposals.js";
import { CleanupPreviews } from "./cleanup-previews.js";
import { saveDialogOptions } from "./save-file.js";
import { cleanupQuestions } from "../shared/cleanup.js";
import { WIDENING_KINDS, applyFormText, permissionDialogOptions, cleanupDiscardedDetail, endNotice, formatBytes, widenText } from "./dialog-texts.js";
import { ModelEntries, ModelListLimit } from "./model-entries.js";
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
  /**
   * R21-I-3: smoke tests only (`main.ts` never sets it). The engine host gets the test transport:
   * requests reach this machine only, so a real API is never called whatever the config says.
   */
  readonly loopbackOnly?: boolean;
  /** Called once the window has loaded (smoke tests only; `main.ts` never sets it). */
  readonly afterLoad?: (context: GuiContext) => Promise<void>;
  /**
   * Answers the main process's OS dialogs instead of a person: gets the dialog's id and returns the
   * index of the button chosen (smoke tests only; `main.ts` never sets it).
   */
  readonly answerDialog?: (id: DialogTextId) => Promise<number>;
  /** Smoke tests only: chooses the file a report is saved to instead of the OS save dialog (null: cancelled). */
  readonly answerSaveDialog?: (name: string) => Promise<string | null>;
  /** Smoke tests only: receives the OS end notification instead of the OS (3.6). */
  readonly notify?: (notice: { readonly title: string; readonly body: string }) => void;
  /** Smoke tests only: chooses the task file or the variables file instead of the OS open dialog (null: cancelled, U-63). */
  readonly answerOpenDialog?: (kind: "task" | "vars") => Promise<string | null>;
  /** Smoke tests only: receives what would be copied instead of the OS clipboard (U-62). */
  readonly writeClipboard?: (text: string) => void;
  /** Smoke tests only: answers a permission question instead of the OS dialog (U-124); the signal aborts when the engine ended it. */
  readonly answerPermission?: (question: PermissionQuestion, signal: AbortSignal) => Promise<QuestionAnswer>;
  /** Smoke tests only: receives the path "show in folder" would select instead of the OS file manager (U-66). */
  readonly showItemInFolder?: (path: string) => void;
  /** Smoke tests only: whether the window counts as active (focus cannot be taken away reliably in a test). */
  readonly windowActive?: () => boolean;
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
    ...(options.loopbackOnly === true ? { transport: "loopback-only" as const } : {}),
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
  /** U-64: tells the window the engine's state ("ready" or why not). */
  const tellEngine = (state: string): void => {
    if (window !== null && !window.isDestroyed()) window.webContents.send(IPC_EVENTS.engineState, { state });
  };
  /**
   * Starts the engine host (at the start, and again when the person asks after it ended, U-64). When
   * it ends, calls fail with adapter_host_exited, a run going on ends unknown, and the window is told;
   * it is not started again on its own (4.4).
   */
  const launchHost = (): void => {
    hostState = startHost(options).then((outcome) => {
      if (!outcome.ok) return { failure: outcome.failure };
      currentHost = outcome.host;
      let state: { readonly host: EngineHost } | { readonly failure: string } = { host: outcome.host };
      outcome.host.onRunMessage((message) => void runs.receive(message));
      outcome.host.onExit(() => {
        state = { failure: "adapter_host_exited" };
        hostState = Promise.resolve(state);
        runs.hostExited();
        if (!closingHost) tellEngine("adapter_host_exited");
      });
      return state;
    });
  };
  let restarting = false;
  /** U-70: the state file's saves were waited for once the app began to quit. */
  let stateFlushed = false;
  /** U-70: keeps the window's size and place now (before-quit comes before the windows close). */
  let saveWindowNow = (): void => undefined;
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
  const approvals = new PlanApprovals((size) => randomBytes(size), () => Date.now());
  const runs = new RunManager({
    send: (channel, payload) => {
      if (window !== null && !window.isDestroyed()) window.webContents.send(channel, payload);
    },
    // U-124 (3.6, DR-3): the run's permission question, asked by this process's OS dialog. The window
    // cannot answer. Deny is the default button and what Esc gives; no window means no answer
    // (dismissed). The text is the engine's masked executable and the number of arguments only.
    ask: async (question, signal) => {
      if (options.answerPermission !== undefined) return options.answerPermission(question, signal);
      if (window === null || window.isDestroyed()) return "dismissed";
      const reply = await dialog.showMessageBox(window, { ...permissionDialogOptions(language, question), signal });
      if (signal.aborted) return "dismissed";
      return reply.response === 0 ? "allow_once" : "deny";
    },
    answer: async (token, id, decision) => {
      const state = await hostState;
      if ("host" in state) await state.host.call("answerQuestion", { run: token, id, decision }, 10_000);
    },
    labels: async (status, reason) => {
      const state = await hostState;
      const ids = [`status.${status}`, `reason.${reason}`];
      const found = "host" in state ? await texts(state.host, app.getLocale(), ids) : null;
      return { status: found?.texts[ids[0] as string] ?? status, reason: found?.texts[ids[1] as string] ?? reason };
    },
    // 3.6: the taskbar shows that a run goes on, without a number or the goal.
    onEnded: (runId, reason, status) => {
      approvals.ended(runId, reason);
      // 3.6: an OS notification only while the window is not active; fixed text and the status word.
      const active = options.windowActive !== undefined ? options.windowActive() : window !== null && !window.isDestroyed() && window.isFocused();
      const notice = endNotice(language, active, status);
      if (notice === null) return;
      if (options.notify !== undefined) {
        options.notify(notice);
        return;
      }
      if (!Notification.isSupported()) return;
      const shown = new Notification({ title: notice.title, body: notice.body });
      shown.on("click", () => {
        if (window !== null && !window.isDestroyed()) {
          window.show();
          window.focus();
        }
      });
      shown.show();
    },
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
    if (closingHost || currentHost === null || currentHost.exited) {
      // U-70: the state file's saves under way end before the app does.
      if (stateFlushed) return;
      event.preventDefault();
      stateFlushed = true;
      saveWindowNow();
      void workspaces.flush().finally(() => app.quit());
      return;
    }
    // DR-8: the engine host ends with the app. Close its stdin, wait, then quit.
    event.preventDefault();
    closingHost = true;
    stateFlushed = true;
    saveWindowNow();
    void Promise.all([currentHost.close(), workspaces.flush()]).finally(() => app.quit());
  });

  void app.whenReady().then(async () => {
    secureSession(session.defaultSession);
    const ses = session.fromPartition(SESSION_PARTITION);
    secureSession(ses);
    handleAppProtocol(ses, join(options.guiRoot, "build", "src", "renderer"));

    launchHost();
    const startFolder = folderArgument(process.argv, app.isPackaged, process.cwd(), process.platform);
    if (startFolder !== null) {
      const opened = await workspaces.open(startFolder);
      if (opened.ok) initialWorkspace = { handle: opened.handle, name: opened.name };
    }
    registerIpc({
      window: () => window,
      // U-64 (3.12, 4.4): only after the engine host ended (or never started); never while one runs or the app quits.
      restartEngine: async () => {
        if (closingHost) return { ok: false, code: "app_closing" };
        if (restarting) return { ok: false, code: "engine_starting" };
        const before = await hostState;
        if ("host" in before && !before.host.exited) return { ok: false, code: "engine_running" };
        restarting = true;
        try {
          launchHost();
          const after = await hostState;
          if (!("host" in after)) return { ok: false, code: after.failure };
          tellEngine("ready");
          return { ok: true };
        } finally {
          restarting = false;
        }
      },
      writeClipboard: options.writeClipboard ?? ((text) => clipboard.writeText(text)),
      showItemInFolder: options.showItemInFolder ?? ((path) => shell.showItemInFolder(path)),
      uiMemory: async () => {
        const memory = await workspaces.windowMemory();
        return { screen: memory.screen, treeWidth: memory.treeWidth };
      },
      saveUi: (change) => workspaces.rememberWindow(change),
      host: () => hostState,
      workspaces,
      osLocale: () => app.getLocale(),
      initialWorkspace: () => initialWorkspace,
      modelEntries: new ModelEntries((size) => randomBytes(size)),
      modelListLimit: new ModelListLimit(() => Date.now()),
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
      // GU-4 (3.8), DR-39, DR-44: each question apart; "keep" is every default.
      // GU-3 (3.7): the OS save dialog chooses where a report goes; the window never names a path.
      chooseSavePath: async (name) => {
        if (options.answerSaveDialog !== undefined) return options.answerSaveDialog(name);
        const box = saveDialogOptions(join(app.getPath("documents"), name));
        const chosen = window !== null && !window.isDestroyed() ? await dialog.showSaveDialog(window, box) : await dialog.showSaveDialog(box);
        return chosen.canceled || chosen.filePath === undefined || chosen.filePath.length === 0 ? null : chosen.filePath;
      },
      // U-63 (3.5, GUI-D8): the OS open dialog; the path chosen is used once and not kept.
      chooseOpenFile: async (kind) => {
        if (options.answerOpenDialog !== undefined) return options.answerOpenDialog(kind);
        const box: OpenDialogOptions = {
          title: dialogText(language, kind === "task" ? "openTask.title" : "openVars.title"),
          properties: ["openFile", "dontAddToRecent"],
          ...(kind === "task" ? { filters: [{ name: "JSON", extensions: ["json"] }] } : {}),
        };
        const chosen = window !== null && !window.isDestroyed() ? await dialog.showOpenDialog(window, box) : await dialog.showOpenDialog(box);
        return chosen.canceled ? null : (chosen.filePaths[0] ?? null);
      },
      cleanupPreviews: new CleanupPreviews((size) => randomBytes(size), () => Date.now()),
      confirmCleanup: async (record) => {
        const questions = cleanupQuestions(record.plan);
        const values = {
          runs: questions.records.count,
          runSize: formatBytes(language, questions.records.bytes),
          discarded: questions.discarded.count,
          leftovers: questions.leftovers,
          digest: record.plan.digest.slice(0, 12),
        };
        // DR-44 (c), U-13 (DR-53): apply runs with discarded files keep their records unless those files go too.
        const detail = [...(questions.discardedLeft > 0 ? [dialogText(language, "cleanup.discardedLeft", { count: questions.discardedLeft })] : []), dialogText(language, "cleanup.detail")].join("\n");
        const buttons = [dialogText(language, "cleanup.confirm"), dialogText(language, "cleanup.keep")];
        return (await ask("cleanup.message", { type: "warning", title: dialogText(language, "closeRun.title"), detail, buttons, defaultId: 1, cancelId: 1, noLink: true }, values)) === 0;
      },
      confirmCleanupNotReverted: async (record) => {
        const values = { count: cleanupQuestions(record.plan).notReverted };
        const buttons = [dialogText(language, "cleanup.notReverted.confirm"), dialogText(language, "cleanup.notReverted.keep")];
        const box = { type: "warning" as const, title: dialogText(language, "closeRun.title"), detail: dialogText(language, "cleanup.notReverted.detail"), buttons, defaultId: 1, cancelId: 1, noLink: true };
        return (await ask("cleanup.notReverted.message", box, values)) === 0;
      },
      confirmCleanupDiscarded: async (record) => {
        const discarded = cleanupQuestions(record.plan).discarded;
        const values = { count: discarded.count, files: discarded.files, size: formatBytes(language, discarded.bytes) };
        const buttons = [dialogText(language, "cleanup.discarded.confirm"), dialogText(language, "cleanup.discarded.keep")];
        // R33b-I1, U-13: keeping the discarded files (the default) keeps those apply runs' records too; said here.
        const detail = cleanupDiscardedDetail(language, cleanupQuestions(record.plan).discardedLeft);
        const box = { type: "warning" as const, title: dialogText(language, "closeRun.title"), detail, buttons, defaultId: 1, cancelId: 1, noLink: true };
        return (await ask("cleanup.discarded.message", box, values)) === 0;
      },
      settingsProposals: new SettingsProposals((size) => randomBytes(size), () => Date.now()),
      // 6.6: "do not write" is the default; the dialog names each widening by kind and field, never a value.
      confirmWidening: async (proposal) => {
        const items = proposal.widening.map((item) => widenText(language, (WIDENING_KINDS as readonly string[]).includes(item.kind) ? item.kind : "other", item.field));
        const buttons = [dialogText(language, "widen.confirm"), dialogText(language, "widen.keep")];
        const answer = await ask("widen.message", { type: "warning", title: dialogText(language, "closeRun.title"), detail: items.join("\n"), buttons, defaultId: 1, cancelId: 1, noLink: true });
        return answer === 0;
      },
      // DR-25: a separate dialog; "do not agree" is the default. It holds for this one revert.
      confirmRevertConsent: async (retry) => {
        const values = { runId: retry.runId, count: retry.files };
        const buttons = [dialogText(language, "revertConsent.agree"), dialogText(language, "revertConsent.keep")];
        const answer = await ask("revertConsent.message", { type: "warning", title: dialogText(language, "closeRun.title"), detail: dialogText(language, "revertConsent.detail"), buttons, defaultId: 1, cancelId: 1, noLink: true }, values);
        return answer === 0;
      },
      approvals,
      // 3.9: "do not apply" is the default; the digest's first 12 characters and the counts are shown.
      confirmApply: async (approval) => {
        const values = { moves: approval.moves, discards: approval.discards, digest: approval.digest.slice(0, 12) };
        const buttons = [dialogText(language, "apply.confirm"), dialogText(language, "apply.keep")];
        // R29-I2: the dialog names the form the plan is applied with (from the token), then the rules.
        const detail = `${applyFormText(language, approval.profile, approval.workflowRef)}\n${dialogText(language, "apply.detail")}`;
        const answer = await ask("apply.message", { type: "question", title: dialogText(language, "closeRun.title"), detail, buttons, defaultId: 1, cancelId: 1, noLink: true }, values);
        return answer === 0;
      },
      // DR-21: a separate dialog; "do not agree" is the default. Agreeing holds for the next apply only.
      confirmConsent: async (approval) => {
        const values = { digest: approval.digest.slice(0, 12) };
        const buttons = [dialogText(language, "consent.agree"), dialogText(language, "consent.keep")];
        const answer = await ask("consent.message", { type: "warning", title: dialogText(language, "closeRun.title"), detail: dialogText(language, "consent.detail"), buttons, defaultId: 1, cancelId: 1, noLink: true }, values);
        return answer === 0;
      },
    });

    const devTools = !app.isPackaged && process.env["CODARYN_GUI_DEVTOOLS"] === "1";
    // U-70 (4.5): the size and place the window was left in, when enough of them is on a display now.
    const remembered = await workspaces.windowMemory();
    const placed = fitBounds(remembered.bounds, screen.getAllDisplays().map((display) => display.workArea));
    window = new BrowserWindow({
      ...(placed === null ? { width: 1100, height: 760 } : placed),
      show: false,
      title: "Codaryn",
      // U-69 (10): no white flash before the page in the OS's dark theme.
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff",
      webPreferences: secureWebPreferences(join(options.guiRoot, "build", "src", "preload", "preload.cjs"), devTools),
    });
    if (remembered.maximized) window.maximize();
    // U-70: the size, place and maximized state are kept a moment after they change, and on closing.
    let boundsTimer: ReturnType<typeof setTimeout> | null = null;
    const keepBounds = (): void => {
      if (boundsTimer !== null) clearTimeout(boundsTimer);
      boundsTimer = null;
      if (window === null || window.isDestroyed()) return;
      void workspaces.rememberWindow({ bounds: window.getNormalBounds(), maximized: window.isMaximized() });
    };
    const keepBoundsSoon = (): void => {
      if (boundsTimer !== null) clearTimeout(boundsTimer);
      boundsTimer = setTimeout(keepBounds, 500);
    };
    window.on("resize", keepBoundsSoon);
    window.on("move", keepBoundsSoon);
    window.on("maximize", keepBounds);
    window.on("unmaximize", keepBounds);
    window.on("close", keepBounds);
    saveWindowNow = keepBounds;
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
      approvals.clear();
    });
    await window.loadURL(APP_INDEX_URL);
    if (devTools) window.webContents.openDevTools({ mode: "detach" });
    if (options.afterLoad !== undefined) {
      await options.afterLoad({ window, host: () => hostState, openFromOutside });
    }
  });
}
