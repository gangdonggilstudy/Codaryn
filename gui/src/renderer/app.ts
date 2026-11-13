/**
 * The window's entry (GU-2): the language from the engine host, the frame, the workspace screen
 * with the recent list, the checks screen and the read-only file tree. The page talks to
 * `window.codaryn` (the preload) and to nothing else.
 */

import { asEngineState, asInfo, asOpen, asRestart, asRunDone, asRunEvents, asSettings } from "./api.js";
import type { Workspace } from "./api.js";
import { checksScreen } from "./checks/checks.js";
import { textsFor } from "./i18n/catalog.js";
import { Shell } from "./shell/shell.js";
import { newTaskScreen } from "./run/new-task.js";
import { RunModel, clock } from "./run/run-model.js";
import { runScreen } from "./run/run-screen.js";
import { runsScreen } from "./runs/runs-screen.js";
import { planScreen } from "./plan/plan-screen.js";
import { changesScreen } from "./changes/changes-screen.js";
import { reportScreen } from "./report/report-screen.js";
import { cleanupScreen } from "./runs/cleanup-screen.js";
import { setupScreen } from "./setup/setup-screen.js";
import { settingsScreen } from "./settings/settings.js";
import { homeScreen } from "./workspace/home.js";
import { TreeView } from "./workspace/tree-view.js";

async function start(): Promise<void> {
  const root = document.getElementById("app");
  if (root === null) return;
  const api = window.codaryn;
  const info = asInfo(await api.info());
  document.documentElement.lang = info.language;
  const texts = textsFor(info.language);

  let current: Workspace | null = null;
  let shell: Shell | null = null;
  let tree: TreeView | null = null;

  const setWorkspace = (workspace: Workspace): void => {
    current = workspace;
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

  shell = new Shell(texts, { openWorkspace });
  shell.mount(root);
  tree = new TreeView(texts, api, shell.filePanel);
  shell.add(homeScreen({ texts, api, current: () => current, open: openWorkspace, opened: setWorkspace, takeOpenError }));
  const run = new RunModel();
  shell.add(
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
    }),
  );
  const plan = planScreen({ texts, api, run, current: () => current, showRun: () => shell?.show("run") });
  /** `formKnown` false: the run's form is unknown (started elsewhere); its plan is shown, not applied. */
  const openPlan = (runId: string, profile: string | null, workflow: string | null, formKnown = true, recordsChanged = false): void => {
    plan.choose(runId, profile, workflow, formKnown, recordsChanged);
    shell?.show("plan");
  };
  const changes = changesScreen({ texts, api, current: () => current });
  const openChanges = (runId: string, profile: string | null, workflow: string | null): void => {
    changes.choose(runId, profile, workflow);
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
  shell.add(runScreen({ texts, api, run, newTask: () => shell?.show("newtask"), announce: (text) => shell?.announce(text), current: () => current, openPlan, openChanges, openReport, openRevert, openSettings }));
  shell.add(plan);
  shell.add(changes);
  shell.add(report);
  shell.add(runs);
  shell.add(cleanupScreen({ texts, api, current: () => current, announce: (text) => shell?.announce(text) }));
  shell.add(checksScreen({ texts, api, current: () => current, announce: (text) => shell?.announce(text) }));
  shell.add(settingsScreen({ texts, api, language: info.language, announce: (text) => shell?.announce(text) }));
  shell.add(setupScreen({ texts, api, current: () => current, announce: (text) => shell?.announce(text), show: (id) => shell?.show(id) }));
  shell.setEngine(info.engine);
  // U-64 (3.12, 4.4): when the engine ended (or did not start), its card and the restart button.
  const restartEngine = async (): Promise<string> => {
    const reply = asRestart(await api.restartEngine());
    return reply.ok ? "ready" : reply.code;
  };
  if (info.engine !== "ready") shell.engineEnded(info.engine, restartEngine);
  api.onEngineState((payload) => {
    const state = asEngineState(payload);
    if (state === null) return;
    if (state === "ready") shell?.engineReady();
    else shell?.engineEnded(state, restartEngine);
  });
  shell.setWorkspace(null);
  shell.show("home");
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
    shell?.announce(done.ok ? texts.format("run.ended", { status: done.labels.status }) : texts.format("run.endedError", { code: done.code }));
  });
  run.subscribe(() => {
    if (run.phase === "idle" || run.phase === "done") {
      shell?.setRun(null);
      return;
    }
    const seconds = run.elapsed(Date.now());
    shell?.setRun(texts.format("run.statusBar", { state: texts.format(`run.phase.${run.phase}`), time: seconds === null ? "-" : clock(seconds), turns: String(run.counts.turns), tools: String(run.counts.tools) }));
  });

  api.onWorkspaceOpened((payload) => {
    const opened = asOpen({ ok: true, ...(typeof payload === "object" && payload !== null ? payload : {}) });
    if (opened.ok) setWorkspace({ handle: opened.handle, name: opened.name });
  });
  if (info.initialWorkspace !== null) setWorkspace(info.initialWorkspace);
}

void start();
