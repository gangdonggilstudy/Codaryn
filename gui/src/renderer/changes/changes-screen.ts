/**
 * The changes view (docs/design/standalone-gui.md 3.4; DR-7, DR-29, DR-32 (c)): a run's changed
 * files, masked with the secrets the task form registers now ("current secrets").
 * - A file's texts come only when the app layer found them masked now as the run masked them and
 *   the file is still what the run left; the window then compares them line by line (diff/). Else
 *   it shows the path and state, and says why there is no text (`masking_unverified` and the rest).
 * - U-48 (U-43, DR-38): a run with a records-changed mark has its warning first, as the run list,
 *   the plan and the report have theirs; its files come without text, and each says the mark is why.
 * - Keys: F7 and Shift+F7 move to the next and previous change, Alt+F7 and Alt+Shift+F7 to the next
 *   and previous file. Nothing here edits; copying copies the masked text on the screen.
 * - U-65 (3.3): opened from the file tree's changed file, the view starts at that file; the files it
 *   loaded go back to the tree as its marks.
 * - U-66 (3.4): two views of a comparison, one column (the default) or side by side (before | now,
 *   diff/side-by-side.ts), and long lines wrapped (the default) or not; both stay while the window
 *   is open and redraw the loaded files without asking again. "Show in folder" for a file the main
 *   process gave an id (a plain path that is there now); the page never names a path.
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asChanges } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { button, el } from "../shell/dom.js";
import type { Screen } from "../shell/shell.js";
import type { ChangedFileItem } from "../../shared/ipc.js";
import { hunkStarts, lineDiff } from "../diff/line-diff.js";
import type { DiffLine } from "../diff/line-diff.js";
import { sideBySide } from "../diff/side-by-side.js";

export interface ChangesDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  readonly current: () => Workspace | null;
  /** U-65: the run's files as loaded, for the file tree's marks. */
  readonly loaded?: (run: { readonly runId: string; readonly profile: string | null; readonly workflow: string | null }, files: readonly ChangedFileItem[]) => void;
}

export interface ChangesScreen extends Screen {
  /** Which run's changes to show next, and the profile and task kind of its task form; U-65: and the file to start at. */
  choose(runId: string, profile: string | null, workflow: string | null, file?: string | null): void;
}

/** Lines drawn for one file; a longer comparison says how many were left out. */
export const MAX_SHOWN_LINES = 5000;

/** U-66: how comparisons are drawn: side by side or in one column; long lines wrapped or not. */
export interface ChangesView {
  readonly side: boolean;
  readonly wrap: boolean;
}

/** U-66: shows a file in the file manager by the main process's id; the status cell says if it could not. */
type Reveal = (file: ChangedFileItem, status: HTMLElement) => void;

/** U-66: one side of a side-by-side row: the line number, then the mark and the text. */
function sideCells(t: Texts, line: DiffLine | null, side: "old" | "new"): HTMLElement[] {
  if (line === null) return [el("td", "", { class: "no" }), el("td", "", { class: "text diff-empty", "data-kind": "none" })];
  const no = side === "old" ? line.oldNo : line.newNo;
  const mark = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
  const cell = el("td", undefined, { class: `text diff-${line.kind}`, "data-kind": line.kind });
  cell.append(el("span", mark, { class: "mark", "aria-label": word(t, "diffkind", line.kind) }), el("span", line.text));
  return [el("td", no === null ? "" : String(no), { class: "no", "aria-hidden": "true" }), cell];
}

/** U-66: the side-by-side table of a two-sided comparison; the first row of each change can take the focus (F7). */
function sideTable(t: Texts, file: ChangedFileItem, lines: readonly DiffLine[]): { readonly table: HTMLElement; readonly rows: number } {
  const rows = sideBySide(lines);
  const table = el("table", undefined, { class: "diff-side", "aria-label": t.format("changes.diffOf", { path: file.path }) });
  const head = el("tr");
  head.append(el("th", t.format("changes.before"), { colspan: "2", scope: "col" }), el("th", t.format("changes.now"), { colspan: "2", scope: "col" }));
  const thead = el("thead");
  thead.append(head);
  const tbody = el("tbody");
  for (const row of rows.slice(0, MAX_SHOWN_LINES)) {
    const tr = el("tr", undefined, { "data-left": row.left?.kind ?? "none", "data-right": row.right?.kind ?? "none" });
    if (row.hunk) {
      tr.setAttribute("data-hunk", "");
      tr.setAttribute("tabindex", "-1");
    }
    tr.append(...sideCells(t, row.left, "old"), ...sideCells(t, row.right, "new"));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  return { table, rows: rows.length };
}

function word(t: Texts, prefix: string, value: string): string {
  const id = `${prefix}.${value}`;
  return t.has(id) ? t.format(id) : value;
}

function fileSection(t: Texts, file: ChangedFileItem, index: number, marked: boolean, view: ChangesView = { side: false, wrap: true }, reveal: Reveal | null = null): HTMLElement {
  const section = el("section", undefined, { class: "changed-file", "data-file": String(index), "data-state": file.state, "data-created": String(file.created), tabindex: "-1" });
  const facts = [word(t, "changestate", file.state)];
  if (file.created) facts.push(t.format("changes.created"));
  if (file.unavailable !== null && file.unavailable !== "masking_unverified") facts.push(word(t, "unavailable", file.unavailable));
  section.append(el("h3", file.path, { class: "path" }), el("p", facts.join(" · "), { class: "facts" }));
  // U-66 (3.4): the file in the file manager, by the main process's id (a plain path that is there).
  if (reveal !== null && typeof file.id === "string") {
    const status = el("span", undefined, { role: "status", class: "reveal-status" });
    section.append(button(t.format("tree.reveal"), () => reveal(file, status), { class: "reveal", "data-reveal": String(index) }), status);
  }
  if (file.before === null && file.after === null) {
    if (file.unavailable === "masking_unverified") section.append(el("p", t.format(marked ? "changes.unverifiedMarked" : "changes.unverified"), { class: "notice", "data-text": "hidden" }));
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
  if (view.side) {
    const { table, rows } = sideTable(t, file, lines);
    section.append(table);
    if (rows > MAX_SHOWN_LINES) section.append(el("p", t.format("changes.truncated", { count: String(rows - MAX_SHOWN_LINES) }), { class: "notice" }));
    section.setAttribute("data-text", "shown");
    return section;
  }
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
  let chosen: { runId: string; profile: string | null; workflow: string | null; file: string | null } | null = null;
  // U-66: the view stays while the window is open.
  let view: ChangesView = { side: false, wrap: true };
  return {
    id: "changes",
    title: "nav.changes",
    choose(runId, profile, workflow, file = null) {
      chosen = { runId, profile, workflow, file };
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
      body.setAttribute("data-view", view.side ? "side" : "column");
      body.setAttribute("data-wrap", view.wrap ? "on" : "off");
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
        // U-48 (DR-38): the mark's warning first; every file below is the marked run's record.
        const warning = reply.recordsChanged ? [el("p", t.format("changes.recordsChanged"), { class: "notice", id: "changes-records-changed" })] : [];
        const reveal: Reveal = (file, status) => {
          void (async () => {
            const shown = typeof file.id === "string" && (await api.reveal(workspace.handle, file.id)) === true;
            status.textContent = shown ? "" : t.format("changes.revealFailed");
            status.setAttribute("data-revealed", shown ? "ok" : "no");
          })();
        };
        const files = el("div", undefined, { id: "changes-files" });
        const draw = (): HTMLElement[] => {
          const sections = reply.files.map((file, index) => fileSection(t, file, index, reply.recordsChanged, view, reveal));
          files.replaceChildren(...(reply.files.length === 0 ? [el("p", t.format("changes.empty"))] : sections));
          return sections;
        };
        // U-66 (3.4): the two view switches; a change redraws the loaded files (nothing is asked again).
        const toggle = (id: string, label: string, on: boolean, change: (value: boolean) => void): HTMLElement => {
          const box = el("input", undefined, { type: "checkbox", id });
          box.checked = on;
          box.addEventListener("change", () => {
            change(box.checked);
            body.setAttribute("data-view", view.side ? "side" : "column");
            body.setAttribute("data-wrap", view.wrap ? "on" : "off");
            draw();
          });
          const wrap = el("label", undefined, { class: "toggle" });
          wrap.append(box, el("span", label));
          return wrap;
        };
        const controls = el("div", undefined, { class: "changes-view", role: "group", "aria-label": t.format("changes.viewLabel") });
        controls.append(
          toggle("changes-side", t.format("changes.sideBySide"), view.side, (value) => (view = { ...view, side: value })),
          toggle("changes-wrap", t.format("changes.wrap"), view.wrap, (value) => (view = { ...view, wrap: value })),
        );
        const sections = draw();
        body.replaceChildren(
          ...warning,
          el("p", t.format("changes.of", { runId: reply.runId, count: String(reply.files.length) }), { id: "changes-summary" }),
          el("p", t.format("changes.masking"), { class: "notice" }),
          el("p", t.format("changes.textRule"), { class: "notice" }),
          el("p", t.format("changes.keys"), { class: "notice" }),
          controls,
          files,
        );
        body.setAttribute("data-changes-ready", String(reply.files.length));
        deps.loaded?.({ runId: target.runId, profile: target.profile, workflow: target.workflow }, reply.files);
        // U-65: opened from the tree's changed file: start there (once; the next opening starts at the top).
        const at = target.file === null ? -1 : reply.files.findIndex((file) => file.path === target.file);
        if (chosen === target) chosen = { ...target, file: null };
        const section = at < 0 ? undefined : sections[at];
        if (section !== undefined) {
          body.setAttribute("data-focus-file", String(at));
          section.focus();
        }
      })();
    },
  };
}
