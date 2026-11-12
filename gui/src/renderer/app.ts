/**
 * The window's entry (GU-2): the language from the engine host, the frame, the workspace screen
 * with the recent list, the checks screen and the read-only file tree. The page talks to
 * `window.codaryn` (the preload) and to nothing else.
 */

import { asInfo, asOpen } from "./api.js";
import type { Workspace } from "./api.js";
import { checksScreen } from "./checks/checks.js";
import { textsFor } from "./i18n/catalog.js";
import { Shell } from "./shell/shell.js";
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
  shell.add(checksScreen({ texts, api, current: () => current, announce: (text) => shell?.announce(text) }));
  shell.setEngine(info.engine);
  shell.setWorkspace(null);
  shell.show("home");

  api.onWorkspaceOpened((payload) => {
    const opened = asOpen({ ok: true, ...(typeof payload === "object" && payload !== null ? payload : {}) });
    if (opened.ok) setWorkspace({ handle: opened.handle, name: opened.name });
  });
  if (info.initialWorkspace !== null) setWorkspace(info.initialWorkspace);
}

void start();
