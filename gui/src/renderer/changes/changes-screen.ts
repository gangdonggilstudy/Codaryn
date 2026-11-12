/**
 * The changes view (docs/design/standalone-gui.md 3.4) as DR-29 allows it now: a run's changed
 * files by path and state. The app layer's `changes` masks them with the secrets the task form
 * registers now ("current secrets", DR-7); the file text is not shown until a run records how it
 * masked each file, so a value the run hid can never appear here in plain text (R-11, DR-28).
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asChanges } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { el } from "../shell/dom.js";
import type { Screen } from "../shell/shell.js";

export interface ChangesDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  readonly current: () => Workspace | null;
}

export interface ChangesScreen extends Screen {
  /** Which run's changes to show next, and the profile of its task form. */
  choose(runId: string, profile: string | null): void;
}

function word(t: Texts, prefix: string, value: string): string {
  const id = `${prefix}.${value}`;
  return t.has(id) ? t.format(id) : value;
}

export function changesScreen(deps: ChangesDeps): ChangesScreen {
  const { texts: t, api } = deps;
  let chosen: { runId: string; profile: string | null } | null = null;
  return {
    id: "changes",
    title: "nav.changes",
    choose(runId, profile) {
      chosen = { runId, profile };
    },
    show(root) {
      const workspace = deps.current();
      const body = el("div", undefined, { id: "changes" });
      root.replaceChildren(el("h2", t.format("changes.title")), body);
      if (workspace === null || chosen === null) {
        body.append(el("p", t.format("changes.none")));
        body.setAttribute("data-changes-ready", "none");
        return;
      }
      const target = chosen;
      void (async () => {
        body.replaceChildren(el("p", t.format("runs.loading")));
        const reply = asChanges(await api.changes(workspace.handle, target.runId, target.profile));
        if (!reply.ok) {
          body.replaceChildren(el("div", `${errorText(t, reply.code)} ${t.format("error.code", { code: reply.code })}`, { role: "alert", class: "error", "data-error": reply.code }));
          body.setAttribute("data-changes-ready", "error");
          return;
        }
        const list = el("ul", undefined, { id: "changes-files" });
        for (const file of reply.files) {
          const facts = [word(t, "changestate", file.state)];
          if (file.created) facts.push(t.format("changes.created"));
          if (file.unavailable !== null && file.unavailable !== "masking_unverified") facts.push(word(t, "unavailable", file.unavailable));
          const row = el("li", undefined, { "data-state": file.state, "data-created": String(file.created) });
          row.append(el("span", file.path, { class: "path" }), el("span", facts.join(" · "), { class: "facts" }));
          list.append(row);
        }
        body.replaceChildren(
          el("p", t.format("changes.of", { runId: reply.runId, count: String(reply.files.length) }), { id: "changes-summary" }),
          el("p", t.format("changes.masking"), { class: "notice" }),
          el("p", t.format("changes.textLater"), { class: "notice" }),
          reply.files.length === 0 ? el("p", t.format("changes.empty")) : list,
        );
        body.setAttribute("data-changes-ready", String(reply.files.length));
      })();
    },
  };
}
