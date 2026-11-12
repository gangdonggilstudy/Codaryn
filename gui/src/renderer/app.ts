/**
 * The window's entry (GU-2): the language from the engine host, the frame, the workspace screen
 * with the recent list, the checks screen and the read-only file tree. The page talks to
 * `window.codaryn` (the preload) and to nothing else.
 */

import { asInfo, asOpen, asRunDone, asRunEvents } from "./api.js";
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
  shell.add(newTaskScreen({ texts, api, run, current: () => current, open: openWorkspace, showRun: () => shell?.show("run") }));
  const plan = planScreen({ texts, api, run, current: () => current, showRun: () => shell?.show("run") });
  const openPlan = (runId: string, profile: string | null): void => {
    plan.choose(runId, profile);
    shell?.show("plan");
  };
  const changes = changesScreen({ texts, api, current: () => current });
  const openChanges = (runId: string, profile: string | null): void => {
    changes.choose(runId, profile);
    shell?.show("changes");
  };
  shell.add(runScreen({ texts, api, run, newTask: () => shell?.show("newtask"), announce: (text) => shell?.announce(text), current: () => current, openPlan, openChanges }));
  shell.add(plan);
  shell.add(changes);
  shell.add(runsScreen({ texts, api, current: () => current, open: openWorkspace, announce: (text) => shell?.announce(text), openPlan, openChanges }));
  shell.add(checksScreen({ texts, api, current: () => current, announce: (text) => shell?.announce(text) }));
  shell.add(settingsScreen({ texts, api, language: info.language, announce: (text) => shell?.announce(text) }));
  shell.setEngine(info.engine);
  shell.setWorkspace(null);
  shell.show("home");

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
