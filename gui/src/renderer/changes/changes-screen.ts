/**
 * The changes view (docs/design/standalone-gui.md 3.4; DR-7, DR-29, DR-32 (c)): a run's changed
 * files, masked with the secrets the task form registers now ("current secrets").
 * - A file's texts come only when the app layer found them masked now as the run masked them and
 *   the file is still what the run left; the window then compares them line by line (diff/). Else
 *   it shows the path and state, and says why there is no text (`masking_unverified` and the rest).
 * - Keys: F7 and Shift+F7 move to the next and previous change, Alt+F7 and Alt+Shift+F7 to the next
 *   and previous file. Nothing here edits; copying copies the masked text on the screen.
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asChanges } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { el } from "../shell/dom.js";
import type { Screen } from "../shell/shell.js";
import type { ChangedFileItem } from "../../shared/ipc.js";
import { hunkStarts, lineDiff } from "../diff/line-diff.js";

export interface ChangesDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  readonly current: () => Workspace | null;
}

export interface ChangesScreen extends Screen {
  /** Which run's changes to show next, and the profile and task kind of its task form. */
  choose(runId: string, profile: string | null, workflow: string | null): void;
}

/** Lines drawn for one file; a longer comparison says how many were left out. */
export const MAX_SHOWN_LINES = 5000;

function word(t: Texts, prefix: string, value: string): string {
  const id = `${prefix}.${value}`;
  return t.has(id) ? t.format(id) : value;
}

function fileSection(t: Texts, file: ChangedFileItem, index: number): HTMLElement {
  const section = el("section", undefined, { class: "changed-file", "data-file": String(index), "data-state": file.state, "data-created": String(file.created), tabindex: "-1" });
  const facts = [word(t, "changestate", file.state)];
  if (file.created) facts.push(t.format("changes.created"));
  if (file.unavailable !== null && file.unavailable !== "masking_unverified") facts.push(word(t, "unavailable", file.unavailable));
  section.append(el("h3", file.path, { class: "path" }), el("p", facts.join(" · "), { class: "facts" }));
  if (file.before === null && file.after === null) {
    if (file.unavailable === "masking_unverified") section.append(el("p", t.format("changes.unverified"), { class: "notice", "data-text": "hidden" }));
    section.setAttribute("data-text", "none");
    return section;
  }
  // One side only, and its absence is not what the run did (it did not create the file, the file
  // is not gone): a comparison would show every line as added or removed. Show that side as it is.
  const onlyAfter = file.before === null && !file.created && file.after !== null;
  const onlyBefore = file.after === null && file.state !== "missing" && file.before !== null;
  if (onlyAfter || onlyBefore) {
    const text = (onlyAfter ? file.after : file.before) ?? "";
    section.append(el("p", t.format(onlyAfter ? "changes.currentOnly" : "changes.originalOnly"), { class: "notice" }));
    const rows = text.split("\n");
    if (rows.length > 1 && rows[rows.length - 1] === "") rows.pop();
    const list = el("ol", undefined, { class: "diff single", "aria-label": t.format(onlyAfter ? "changes.currentOf" : "changes.originalOf", { path: file.path }) });
    for (const [k, row] of rows.slice(0, MAX_SHOWN_LINES).entries()) {
      const item = el("li", undefined, { "data-kind": "same", class: "diff-same" });
      item.append(el("span", String(k + 1), { class: "no", "aria-hidden": "true" }), el("span", row, { class: "text" }));
      list.append(item);
    }
    section.append(list);
    if (rows.length > MAX_SHOWN_LINES) section.append(el("p", t.format("changes.truncated", { count: String(rows.length - MAX_SHOWN_LINES) }), { class: "notice" }));
    section.setAttribute("data-text", onlyAfter ? "current" : "original");
    return section;
  }
  const lines = lineDiff(file.before, file.after);
  const starts = new Set(hunkStarts(lines));
  const list = el("ol", undefined, { class: "diff", "aria-label": t.format("changes.diffOf", { path: file.path }) });
  for (const [k, line] of lines.slice(0, MAX_SHOWN_LINES).entries()) {
    const mark = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
    const item = el("li", undefined, { "data-kind": line.kind, class: `diff-${line.kind}` });
    if (starts.has(k)) {
      item.setAttribute("data-hunk", "");
      item.setAttribute("tabindex", "-1");
    }
    item.append(
      el("span", line.oldNo === null ? "" : String(line.oldNo), { class: "no", "aria-hidden": "true" }),
      el("span", line.newNo === null ? "" : String(line.newNo), { class: "no", "aria-hidden": "true" }),
      el("span", mark, { class: "mark", "aria-label": word(t, "diffkind", line.kind) }),
      el("span", line.text, { class: "text" }),
    );
    list.append(item);
  }
  section.append(list);
  if (lines.length > MAX_SHOWN_LINES) section.append(el("p", t.format("changes.truncated", { count: String(lines.length - MAX_SHOWN_LINES) }), { class: "notice" }));
  section.setAttribute("data-text", "shown");
  return section;
}

export function changesScreen(deps: ChangesDeps): ChangesScreen {
  const { texts: t, api } = deps;
  let chosen: { runId: string; profile: string | null; workflow: string | null } | null = null;
  return {
    id: "changes",
    title: "nav.changes",
    choose(runId, profile, workflow) {
      chosen = { runId, profile, workflow };
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
      body.addEventListener("keydown", (event) => {
        if (event.key !== "F7") return;
        event.preventDefault();
        const selector = event.altKey ? ".changed-file" : "[data-hunk]";
        const stops = [...body.querySelectorAll<HTMLElement>(selector)];
        if (stops.length === 0) return;
        const active = document.activeElement;
        const at = stops.findIndex((stop) => stop === active || (active !== null && stop.contains(active)));
        const next = event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at + 1) % stops.length;
        stops[next]?.focus();
      });
      void (async () => {
        body.replaceChildren(el("p", t.format("runs.loading")));
        const reply = asChanges(await api.changes(workspace.handle, target.runId, target.profile, target.workflow));
        if (!reply.ok) {
          body.replaceChildren(el("div", `${errorText(t, reply.code)} ${t.format("error.code", { code: reply.code })}`, { role: "alert", class: "error", "data-error": reply.code }));
          body.setAttribute("data-changes-ready", "error");
          return;
        }
        body.replaceChildren(
          el("p", t.format("changes.of", { runId: reply.runId, count: String(reply.files.length) }), { id: "changes-summary" }),
          el("p", t.format("changes.masking"), { class: "notice" }),
          el("p", t.format("changes.textRule"), { class: "notice" }),
          el("p", t.format("changes.keys"), { class: "notice" }),
          ...(reply.files.length === 0 ? [el("p", t.format("changes.empty"))] : reply.files.map((file, index) => fileSection(t, file, index))),
        );
        body.setAttribute("data-changes-ready", String(reply.files.length));
      })();
    },
  };
}
