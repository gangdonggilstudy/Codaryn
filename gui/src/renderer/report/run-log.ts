/**
 * U-118 (docs/design/standalone-gui.md 3.7 "records" tab; adapter-contract 5.13): a run's stored
 * records, page by page, as the progress list's lines (the engine host made them; they go in as
 * text only) with the run screen's filter. The page's state comes first in words: a damaged log
 * (lines left out, record numbers missing) is an alert, a run without a result says so, and lines
 * the log left out are counted. Records with no line (a model's response) are counted, not shown.
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asRunEventsPage } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { button, el } from "../shell/dom.js";
import { filterItems, localDateTime } from "../run/run-model.js";
import type { RunFilter } from "../run/run-model.js";
import type { RunItemView } from "../../shared/ipc.js";

const FILTERS: readonly RunFilter[] = ["all", "denied", "files", "checks"];

export interface RunLogTarget {
  readonly workspace: Workspace;
  readonly runId: string;
  readonly profile: string | null;
  readonly workflow: string | null;
}

/** The records tab's content: its notes, the filter, the list and "more"; it loads its first page itself. */
export function runLog(t: Texts, api: CodarynApi, target: RunLogTarget): HTMLElement[] {
  const notes = el("div", undefined, { id: "report-log-notes" });
  const list = el("ol", undefined, { id: "report-log", "aria-label": t.format("report.log.label") });
  const counts = el("p", undefined, { id: "report-log-counts" });
  const more = button(t.format("report.log.more"), () => void load(), { id: "report-log-more", hidden: "" });
  const select = el("select", undefined, { id: "report-log-filter" });
  for (const value of FILTERS) select.append(el("option", t.format(`run.filter.${value}`), { value }));
  const filterField = el("p", undefined, { class: "field" });
  filterField.append(el("label", t.format("run.filter"), { for: "report-log-filter" }), select);
  let filter: RunFilter = "all";
  let items: RunItemView[] = [];
  let records = 0;
  let next: number | null = 0;

  const row = (item: RunItemView): HTMLElement => {
    const li = el("li", undefined, { "data-kind": item.kind });
    if (item.at !== null) li.append(el("span", localDateTime(item.at), { class: "at" }), " ");
    li.append(el("span", item.text, { class: "text" }));
    return li;
  };
  const draw = (): void => {
    const shown = filterItems(items, filter);
    list.replaceChildren(...(shown.length === 0 ? [el("li", t.format("report.log.empty"), { class: "empty" })] : shown.map(row)));
  };
  select.addEventListener("change", () => {
    filter = (FILTERS as readonly string[]).includes(select.value) ? (select.value as RunFilter) : "all";
    draw();
  });

  const load = async (): Promise<void> => {
    if (next === null) return;
    more.setAttribute("disabled", "");
    list.setAttribute("data-log-ready", "loading");
    const page = asRunEventsPage(await api.runEvents(target.workspace.handle, target.runId, target.profile, target.workflow, next));
    more.removeAttribute("disabled");
    if (!page.ok) {
      notes.replaceChildren(el("p", `${errorText(t, page.code)} ${t.format("error.code", { code: page.code })}`, { role: "alert", class: "error", "data-error": page.code }));
      list.setAttribute("data-log-ready", "error");
      return;
    }
    const lines: HTMLElement[] = [];
    if (page.status === "damaged") lines.push(el("p", t.format("report.log.damaged", { missing: String(page.missing), skipped: String(page.skipped) }), { role: "alert", class: "error", id: "report-log-damaged" }));
    else if (page.skipped > 0) lines.push(el("p", t.format("report.log.skipped", { count: String(page.skipped) }), { class: "notice", id: "report-log-skipped" }));
    if (page.status === "incomplete") lines.push(el("p", t.format("report.log.incomplete"), { class: "notice", id: "report-log-incomplete" }));
    if (page.recordsChanged) lines.push(el("p", t.format("report.recordsChanged"), { class: "notice", id: "report-log-records-changed" }));
    notes.replaceChildren(...lines);
    items = [...items, ...page.items];
    records += page.records;
    next = page.nextOffset;
    counts.textContent = t.format("report.log.counts", { read: String(records), total: String(page.total), lines: String(items.length) });
    if (next === null) more.setAttribute("hidden", "");
    else more.removeAttribute("hidden");
    list.setAttribute("data-log-ready", page.status);
    draw();
  };
  void load();
  return [notes, counts, filterField, list, more];
}
