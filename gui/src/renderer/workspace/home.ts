/**
 * GU-2: the workspace screen (docs/design/standalone-gui.md 3.2): open a folder, the recent list
 * (open, remove, "not found"), and the notice about what may leave the machine during a task.
 * Folders are chosen by the main process (dialog, recent list); the page never sends a path.
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asOpen, asRecent } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { button, el } from "../shell/dom.js";
import type { Screen } from "../shell/shell.js";

export interface HomeDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  readonly current: () => Workspace | null;
  readonly open: () => void;
  readonly opened: (workspace: Workspace) => void;
  /** Why the folder chosen in the dialog was refused, once, or null. */
  readonly takeOpenError: () => string | null;
}

export function homeScreen(deps: HomeDeps): Screen {
  const { texts: t, api } = deps;
  return {
    id: "home",
    title: "nav.home",
    show(root) {
      const current = deps.current();
      const message = el("p", undefined, { role: "alert", class: "message", hidden: "" });
      const recentList = el("ul", undefined, { class: "recent", "aria-labelledby": "recent-title" });
      root.replaceChildren(
        el("h2", t.format("home.title")),
        el("p", current === null ? t.format("home.none") : t.format("home.current", { name: current.name }), { id: "current-workspace" }),
        button(t.format("home.open"), deps.open, { id: "open-workspace", "aria-keyshortcuts": "Control+O", title: t.format("home.openShortcut") }),
        el("p", t.format("home.notice"), { class: "notice" }),
        message,
        el("h3", t.format("home.recent"), { id: "recent-title" }),
        recentList,
      );

      const showError = (code: string): void => {
        message.textContent = `${errorText(t, code)} ${t.format("error.code", { code })}`;
        message.removeAttribute("hidden");
      };
      const refused = deps.takeOpenError();
      if (refused !== null) showError(refused);

      const load = async (): Promise<void> => {
        const items = asRecent(await api.recent());
        recentList.setAttribute("data-recent-ready", String(items.length));
        if (items.length === 0) {
          recentList.replaceChildren(el("li", t.format("home.recentEmpty"), { class: "empty" }));
          return;
        }
        recentList.replaceChildren(
          ...items.map((item) => {
            const row = el("li", undefined, { "data-recent": item.exists ? "exists" : "missing" });
            const text = el("div", undefined, { class: "recent-text" });
            text.append(el("span", item.name, { class: "recent-name" }));
            if (item.where !== "") text.append(el("span", t.format("home.recentIn", { folder: item.where }), { class: "recent-path" }));
            if (!item.exists) text.append(el("span", t.format("home.recentMissing"), { class: "recent-missing" }));
            const open = button(t.format("home.recentOpen"), () => {
              void (async () => {
                const reply = asOpen(await api.openRecent(item.id));
                if (reply.ok) deps.opened({ handle: reply.handle, name: reply.name });
                else showError(reply.code);
              })();
            });
            if (!item.exists) open.setAttribute("disabled", "");
            open.setAttribute("aria-label", `${t.format("home.recentOpen")}: ${item.name}`);
            const forget = button(t.format("home.recentForget"), () => {
              void (async () => {
                await api.forgetRecent(item.id);
                await load();
              })();
            });
            forget.setAttribute("aria-label", `${t.format("home.recentForget")}: ${item.name}`);
            row.append(text, open, forget);
            return row;
          }),
        );
      };
      void load();
    },
  };
}
