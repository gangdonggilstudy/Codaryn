/**
 * The window's entry (GU-2): the language from the engine host, the frame, the workspace screen
 * with the recent list, the checks screen and the read-only file tree. The page talks to
 * `window.codaryn` (the preload) and to nothing else.
 * U-69 (11): a language change in the settings redraws the window in that language at once. The
 * frame, the tree, the screens and the palette are built again with the new texts (mountUi); the
 * open workspace, the run going on, the engine's state and the main process's listeners stay.
 */

import { asEngineState, asInfo, asOpen, asRestart, asRunDone, asRunEvents, asSettings } from "./api.js";
import type { Workspace } from "./api.js";
import { checksScreen } from "./checks/checks.js";
import { textsFor } from "./i18n/catalog.js";
import { Shell } from "./shell/shell.js";
import { Palette } from "./shell/palette.js";
import type { Command } from "./shell/palette.js";
import { newTaskScreen } from "./run/new-task.js";
import { RunModel, clock } from "./run/run-model.js";
import { runScreen } from "./run/run-screen.js";
import { runsScreen } from "./runs/runs-screen.js";
import { planScreen } from "./plan/plan-screen.js";
import { changesScreen } from "./changes/changes-screen.js";
import { textScreen } from "./text/text-screen.js";
import { reportScreen } from "./report/report-screen.js";
import { cleanupScreen } from "./runs/cleanup-screen.js";
import { setupScreen } from "./setup/setup-screen.js";
import { settingsScreen } from "./settings/settings.js";
import { homeScreen } from "./workspace/home.js";
import { TreeView } from "./workspace/tree-view.js";
import { OpenCheck, heldFor } from "./workspace/open-check.js";

async function start(): Promise<void> {
  const root = document.getElementById("app");
  if (root === null) return;
  const api = window.codaryn;
  const info = asInfo(await api.info());
  let language = info.language;
  document.documentElement.lang = language;
  let texts = textsFor(language);

  let current: Workspace | null = null;
  let shell = null as Shell | null;
  let tree = null as TreeView | null;
  let palette = null as Palette | null;
  /** U-65: the handle of the workspace the run going on started in. */
  let runWorkspace: string | null = null;
  /** U-64, U-69: the engine's state, kept over a redraw. */
  let engineState = info.engine;
  /** U-70 (4.5): the file panel's width as last chosen (kept over a redraw and by the main process). */
  let treeWidth = info.ui?.treeWidth ?? null;
  let savedScreen = info.ui?.screen ?? null;

  // U-68 (3.2): the checks when a workspace opens (again when a run ends and on F5).
  const openCheck = new OpenCheck(api);
  const setWorkspace = (workspace: Workspace): void => {
    current = workspace;
    void openCheck.run(workspace);
    shell?.setWorkspace(workspace.name);
    tree?.setWorkspace(workspace);
    shell?.refresh();
    shell?.announce(texts.format("home.current", { name: workspace.name }));
  };

  /** An error from the folder dialog, shown once by the workspace screen. */
  let openError: string | null = null;
  const openWorkspace = (): void => {
    void (async () => {
      const reply = await api.openFolder();
      if (reply === null) return;
      const opened = asOpen(reply);
      if (opened.ok) {
        setWorkspace({ handle: opened.handle, name: opened.name });
        return;
      }
      // R10b-L-2: say why the chosen folder was refused, on the workspace screen.
      openError = opened.code;
      shell?.show("home");
    })();
  };
  const takeOpenError = (): string | null => {
    const code = openError;
    openError = null;
    return code;
  };

  // U-67 (3.13): F5 reads the tree again and redraws a screen without a form.
  const REDRAWN_ON_F5 = new Set(["home", "runs", "checks", "changes", "report", "plan", "cleanup", "settings", "text"]);
  const readAgain = (): void => {
    tree?.refresh();
    void openCheck.run(current);
    const id = shell?.currentScreen ?? null;
    if (id !== null && REDRAWN_ON_F5.has(id)) shell?.refresh();
  };
  const run = new RunModel();
  // U-68: this window's own run in the open workspace holds its lock; that is not another run's.
  const ownRunHere = (): boolean => runWorkspace !== null && runWorkspace === current?.handle && run.phase !== "idle" && run.phase !== "done";
  // U-247, Codex V-27 L-1: held until an answer says free (a check going on or failed keeps it).
  const lockedByOther = (): boolean => heldFor(openCheck.state, current?.handle) && !ownRunHere();
  const runGoing = (): boolean => run.phase !== "idle" && run.phase !== "done";
  // U-64 (3.12, 4.4): when the engine ended (or did not start), its card and the restart button.
  const restartEngine = async (): Promise<string> => {
    const reply = asRestart(await api.restartEngine());
    return reply.ok ? "ready" : reply.code;
  };

  /** U-69: builds the window with the current texts and shows `screen`; an earlier frame is taken down first. */
  const mountUi = (screen: string): void => {
    shell?.destroy();
    const frame = new Shell(texts, {
      openWorkspace,
      palette: () => palette?.open(),
      newTask: () => shell?.show("newtask"),
      settings: () => shell?.show("settings"),
      refresh: readAgain,
      // U-184 (3.14): the text view with an unsaved edit asks before it is left (or drawn again).
      leaving: (from, to) => from !== "text" || text.leave(to),
      treeWidth: (width) => {
        treeWidth = width;
        void api.saveUi({ treeWidth: width });
      },
      shown: (id) => {
        // U-123 (R-87 U-68 L1): while another process's lock is seen, showing these screens looks again.
        if ((id === "home" || id === "newtask") && lockedByOther()) void openCheck.run(current);
        if (id === savedScreen) return;
        savedScreen = id;
        void api.saveUi({ screen: id });
      },
    });
    shell = frame;
    frame.mount(root);
    // U-174 (DR-72, 3.14): the read-only text view of a tree or changes entry, by the main process's id.
    const text = textScreen({ texts, api, current: () => current, back: (id) => shell?.show(id), running: runGoing, watchRun: (listener) => run.subscribe(listener) });
    const openText = (node: string, name: string, from: string): void => {
      // U-184: with an unsaved edit the view asks first, and opens the file once the edit is let go.
      if (text.choose({ node, name }, from)) shell?.show("text");
    };
    // U-65: a changed file chosen in the tree opens its run's comparison at that file.
    tree = new TreeView(texts, api, frame.filePanel, {
      openChange: (marked, path) => openChanges(marked.runId, marked.profile, marked.workflow, path),
      openText: (node, name) => openText(node, name, savedScreen ?? "home"),
    });
    frame.add(
      homeScreen({ texts, api, current: () => current, open: openWorkspace, opened: setWorkspace, takeOpenError, openCheck: { check: openCheck, ownRun: ownRunHere, showChecks: () => shell?.show("checks") } }),
    );
    frame.add(
      newTaskScreen({
        texts,
        api,
        run,
        current: () => current,
        open: openWorkspace,
        showRun: () => shell?.show("run"),
        // R21b-L-1: the main process remembers it too; this keeps the open workspace's copy current.
        rememberForm: (form) => {
          if (current !== null) current = { ...current, lastForm: form };
        },
        lock: { locked: lockedByOther, watch: (watcher) => openCheck.watch("newtask", watcher) },
      }),
    );
    const plan = planScreen({ texts, api, run, current: () => current, showRun: () => shell?.show("run") });
    /** `formKnown` false: the run's form is unknown (started elsewhere); its plan is shown, not applied. */
    const openPlan = (runId: string, profile: string | null, workflow: string | null, formKnown = true, recordsChanged = false): void => {
      plan.choose(runId, profile, workflow, formKnown, recordsChanged);
      shell?.show("plan");
    };
    // U-65: the files a changes view loaded are the tree's marks.
    const changes = changesScreen({ texts, api, current: () => current, loaded: (marked, files) => tree?.markRun(marked, files), openText: (node, name) => openText(node, name, "changes") });
    const openChanges = (runId: string, profile: string | null, workflow: string | null, file: string | null = null): void => {
      changes.choose(runId, profile, workflow, file);
      shell?.show("changes");
    };
    const report = reportScreen({ texts, api, current: () => current, openChanges: (runId, form) => openChanges(runId, form?.profile ?? null, form?.workflow ?? null) });
    /** The report of a run, with the run's own form (for its changes view); U-61: and the tab to open first. */
    const openReport = (runId: string, form: { readonly profile: string | null; readonly workflow: string | null } | null, tab: string | null = null): void => {
      report.choose(runId, form, tab);
      shell?.show("report");
    };
    const runs = runsScreen({ texts, api, current: () => current, open: openWorkspace, announce: (text) => shell?.announce(text), openPlan, openChanges, openReport });
    // U-61 (3.12): a result's next steps: the run list with that run's revert preview, and the settings' limits.
    const openRevert = (runId: string): void => {
      runs.choosePreview(runId);
      shell?.show("runs");
    };
    const openSettings = (): void => shell?.show("settings");
    frame.add(runScreen({ texts, api, run, newTask: () => shell?.show("newtask"), announce: (text) => shell?.announce(text), current: () => current, openPlan, openChanges, openReport, openRevert, openSettings }));
    frame.add(plan);
    frame.add(changes);
    frame.add(report);
    frame.add(runs);
    frame.add(cleanupScreen({ texts, api, current: () => current, announce: (text) => shell?.announce(text) }));
    frame.add(checksScreen({ texts, api, current: () => current, announce: (text) => shell?.announce(text) }));
    frame.add(settingsScreen({ texts, api, language, announce: (text) => shell?.announce(text), languageChanged: () => void relanguage() }));
    frame.add(setupScreen({ texts, api, current: () => current, announce: (text) => shell?.announce(text), show: (id) => shell?.show(id) }));
    frame.add(text);
    // U-67 (3.13): the palette's fixed commands (nothing is built from a model's text or a file name).
    const commands = (): Command[] => [
      { id: "newtask", label: texts.format("cmd.newTask"), keys: "Ctrl+N", run: () => shell?.show("newtask") },
      {
        id: "taskfile",
        label: texts.format("cmd.taskFile"),
        keys: null,
        run: () => {
          shell?.show("newtask");
          document.getElementById("task-run-file")?.click();
        },
      },
      { id: "open", label: texts.format("cmd.openWorkspace"), keys: "Ctrl+O", run: openWorkspace },
      { id: "recent", label: texts.format("cmd.recent"), keys: null, run: () => shell?.show("home") },
      { id: "runs", label: texts.format("cmd.runs"), keys: null, run: () => shell?.show("runs") },
      { id: "changes", label: texts.format("cmd.changes"), keys: null, run: () => shell?.show("changes") },
      { id: "revert", label: texts.format("cmd.revert"), keys: null, run: () => shell?.show("runs") },
      { id: "checks", label: texts.format("cmd.checks"), keys: null, run: () => shell?.show("checks") },
      { id: "model", label: texts.format("cmd.model"), keys: null, run: () => shell?.show("settings") },
      { id: "language", label: texts.format("cmd.language"), keys: null, run: () => shell?.show("settings") },
      {
        id: "cancel",
        label: texts.format("cmd.cancel"),
        keys: null,
        available: runGoing,
        // The run screen's own question follows (its default is to keep running).
        run: () => {
          shell?.show("run");
          document.getElementById("run-cancel")?.click();
        },
      },
      { id: "settings", label: texts.format("cmd.settings"), keys: "Ctrl+,", run: () => shell?.show("settings") },
      { id: "refresh", label: texts.format("cmd.refresh"), keys: "F5", run: readAgain },
    ];
    palette = new Palette(texts, commands);
    root.append(palette.element);
    frame.setEngine(engineState);
    if (engineState !== "ready") frame.engineEnded(engineState, restartEngine);
    frame.setTreeWidth(treeWidth);
    frame.setWorkspace(current?.name ?? null);
    if (current !== null) tree.setWorkspace(current);
    updateRunStatus();
    frame.show(screen);
  };

  /** U-69 (11): after a settings change, the language as the engine host chooses it now; a new one redraws the window. */
  const relanguage = async (): Promise<void> => {
    const now = asInfo(await api.info());
    if (now.language === language) return;
    language = now.language;
    texts = textsFor(language);
    document.documentElement.lang = language;
    mountUi(shell?.currentScreen ?? "home");
    shell?.announce(texts.format("settings.languageNow"));
  };

  /** GU-3: the status bar follows the run that goes on. */
  const updateRunStatus = (): void => {
    if (run.phase === "idle" || run.phase === "done") {
      shell?.setRun(null);
      return;
    }
    const seconds = run.elapsed(Date.now());
    shell?.setRun(texts.format("run.statusBar", { state: texts.format(`run.phase.${run.phase}`), time: seconds === null ? "-" : clock(seconds), turns: String(run.counts.turns), tools: String(run.counts.tools) }));
  };

  // U-70 (4.5): the last screen when it is one that stands on its own (not a run's plan, changes or report).
  const RESTORED = new Set(["home", "newtask", "runs", "cleanup", "checks", "settings"]);
  mountUi(info.ui?.screen !== null && info.ui?.screen !== undefined && RESTORED.has(info.ui.screen) ? info.ui.screen : "home");
  api.onEngineState((payload) => {
    const state = asEngineState(payload);
    if (state === null) return;
    engineState = state;
    if (state === "ready") shell?.engineReady();
    else shell?.engineEnded(state, restartEngine);
  });
  // U-11 (3.11): the first start (no config file at the default location yet) begins with the guide.
  void (async () => {
    const settings = asSettings(await api.settings());
    if (settings.ok && settings.view.file !== null && !settings.view.file.exists) shell?.show("setup");
  })();

  // GU-3: progress and the end of the run come from the main process; the status bar follows them.
  api.onRunEvents((payload) => {
    const events = asRunEvents(payload);
    if (events !== null) run.events(events);
  });
  api.onRunDone((payload) => {
    const done = asRunDone(payload);
    if (done === null) return;
    run.finished(done);
    // U-65 (3.3): the tree is read again, and marks what this run did when it ran in the open workspace
    // with a form the window knows (a task file's run names its own workspace); else the old marks go.
    const here = runWorkspace !== null && runWorkspace === current?.handle && run.last !== null && run.last.taskFile !== true;
    runWorkspace = null;
    if (done.ok && done.result.kind === "run" && here) tree?.markRun({ runId: done.runId, profile: run.last?.profile ?? null, workflow: run.last?.workflow ?? null }, done.result.changes);
    else tree?.clearMarks();
    tree?.refresh();
    // U-68: the lock this run held is gone; check again.
    void openCheck.run(current);
    shell?.announce(done.ok ? texts.format("run.ended", { status: done.labels.status }) : texts.format("run.endedError", { code: done.code }));
  });
  run.subscribe(() => {
    // U-65: the workspace a run started in (the open one then).
    // A start that was refused (back to idle) forgets it.
    if (run.phase === "idle") runWorkspace = null;
    if (run.phase !== "idle" && run.phase !== "done" && runWorkspace === null) runWorkspace = current?.handle ?? null;
    updateRunStatus();
  });

  // U-123 (R-82 U-103 L1): settings were written; the main process dropped the tree's ids, so it is read again.
  api.onTreeReset(() => tree?.refresh());
  api.onWorkspaceOpened((payload) => {
    const opened = asOpen({ ok: true, ...(typeof payload === "object" && payload !== null ? payload : {}) });
    if (opened.ok) setWorkspace({ handle: opened.handle, name: opened.name });
  });
  if (info.initialWorkspace !== null) setWorkspace(info.initialWorkspace);
}

void start();
