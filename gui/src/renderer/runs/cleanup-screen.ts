/**
 * GU-4 (docs/design/standalone-gui.md 3.8), DR-39, DR-44: seeing and cleaning up the open
 * workspace's run records and discard boxes.
 * - The summary counts and sizes come from the app layer (no file name of a person's). Files a
 *   revert could not put back are shown and never cleaned.
 * - The person chooses run records (older than some days, fully reverted only, or one by one) and
 *   discard boxes (older than some days, or one by one), and sees the plan first. Cleaning sends the
 *   preview's token only; the main process asks in OS dialogs: the plan, then apart the records of
 *   runs not (or only partly) reverted, and apart the discard boxes (people's files, gone for good).
 *   "Keep" is each default.
 * - The result lists what was removed entirely and, apart, what was kept and why. A folder that
 *   could not be removed entirely (partly_removed) is kept, never shown as removed (DR-44 (d)).
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asCleanupPreview, asCleanupResult, asStateSummary } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { button, el } from "../shell/dom.js";
import type { Screen } from "../shell/shell.js";
import type { CleanupItemView, CleanupPlanView, CleanupResultView, StateEntryView, StateSummaryView } from "../../shared/cleanup.js";
import { localDateTime } from "../run/run-model.js";

export interface CleanupDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  readonly current: () => Workspace | null;
  readonly announce: (text: string) => void;
}

/** A size as the screen shows it: bytes, KB, MB or GB (1024), one decimal above bytes. */
export function sizeText(t: Texts, bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? t.format("cleanup.bytes", { count: String(bytes) }) : `${value.toFixed(1)} ${units[unit]}`;
}

function word(t: Texts, prefix: string, value: string): string {
  const id = `${prefix}.${value}`;
  return t.has(id) ? t.format(id) : value;
}

function errorBox(t: Texts, code: string): HTMLElement {
  return el("div", `${errorText(t, code)} ${t.format("error.code", { code })}`, { role: "alert", class: "error", "data-error": code });
}

function summarySection(t: Texts, summary: StateSummaryView): HTMLElement {
  const box = el("section", undefined, { id: "cleanup-summary", "aria-labelledby": "cleanup-summary-title" });
  box.append(el("h3", t.format("cleanup.summary"), { id: "cleanup-summary-title" }));
  const runs = summary.runs;
  box.append(
    el("p", t.format("cleanup.summary.runs", { count: String(runs.count), size: sizeText(t, runs.bytes), oldest: runs.oldest === null ? "-" : localDateTime(runs.oldest) }), { "data-runs": String(runs.count) }),
    el("p", t.format("cleanup.summary.discarded", { runs: String(summary.discarded.runs), files: String(summary.discarded.files), size: sizeText(t, summary.discarded.bytes) }), { "data-discarded": String(summary.discarded.runs) }),
    el("p", t.format("cleanup.summary.parked", { files: String(summary.parked.files), size: sizeText(t, summary.parked.bytes) }), { class: "notice" }),
  );
  if (summary.leftovers.count > 0) {
    box.append(el("p", t.format("cleanup.summary.leftovers", { count: String(summary.leftovers.count), size: sizeText(t, summary.leftovers.bytes) }), { class: "notice", "data-leftovers": String(summary.leftovers.count) }));
  }
  return box;
}

function entryState(t: Texts, entry: StateEntryView): string {
  const parts = [entry.kind === null ? t.format("cleanup.entry.damaged") : word(t, "cleanup.kind", entry.kind), entry.status === null ? "-" : entry.status];
  if (entry.reverted) parts.push(t.format("cleanup.entry.reverted"));
  else if (entry.partlyReverted) parts.push(t.format("cleanup.entry.partlyReverted"));
  if (entry.recordsChanged) parts.push(t.format("cleanup.entry.recordsChanged"));
  return parts.join(" · ");
}

function checkbox(id: string, attrs: Readonly<Record<string, string>> = {}): HTMLInputElement {
  return el("input", undefined, { type: "checkbox", id, ...attrs });
}

function labelled(id: string, text: string, control: HTMLElement): HTMLElement {
  const box = el("p", undefined, { class: "field" });
  box.append(control, el("label", text, { for: id }));
  return box;
}

const itemWarnings = (t: Texts, item: CleanupItemView): string => item.warnings.map((code) => word(t, "cleanup.warning", code)).join(" · ");

function planSection(t: Texts, plan: CleanupPlanView): HTMLElement[] {
  const parts: HTMLElement[] = [];
  const totals = plan.totals;
  parts.push(el("p", t.format("cleanup.plan.runs", { count: String(totals.runs.count), size: sizeText(t, totals.runs.bytes) }), { id: "cleanup-plan-runs" }));
  // DR-44 (a): these records go only when the person agrees in their own question.
  if (totals.runs.notReverted > 0) parts.push(el("p", t.format("cleanup.plan.notReverted", { count: String(totals.runs.notReverted) }), { class: "notice", id: "cleanup-plan-not-reverted" }));
  if (totals.discarded.count > 0) {
    parts.push(el("p", t.format("cleanup.plan.discarded", { count: String(totals.discarded.count), files: String(totals.discarded.files), size: sizeText(t, totals.discarded.bytes) }), { class: "notice", id: "cleanup-plan-discarded" }));
  }
  // DR-44 (c): an apply run's records go while its discard box may stay.
  const discardedLeft = plan.items.filter((item) => item.target === "run" && item.warnings.includes("discarded_left")).length;
  if (discardedLeft > 0) parts.push(el("p", t.format("cleanup.plan.discardedLeft", { count: String(discardedLeft) }), { class: "notice", id: "cleanup-plan-discarded-left" }));
  if (totals.leftovers.count > 0) parts.push(el("p", t.format("cleanup.plan.leftovers", { count: String(totals.leftovers.count), size: sizeText(t, totals.leftovers.bytes) }), { class: "notice", id: "cleanup-plan-leftovers" }));
  const list = el("ul", undefined, { id: "cleanup-items" });
  for (const item of plan.items) {
    const warnings = itemWarnings(t, item);
    const line = `${word(t, "cleanup.target", item.target)} ${item.id} · ${sizeText(t, item.bytes)}${warnings === "" ? "" : ` · ${warnings}`}`;
    list.append(el("li", line, { "data-target": item.target, "data-id": item.id, "data-warnings": item.warnings.join(" ") }));
  }
  parts.push(plan.items.length === 0 ? el("p", t.format("cleanup.plan.empty"), { id: "cleanup-plan-empty" }) : list);
  if (plan.blocked.length > 0) {
    parts.push(el("h4", t.format("cleanup.plan.blocked")));
    const blocked = el("ul", undefined, { id: "cleanup-blocked" });
    for (const item of plan.blocked) blocked.append(el("li", `${word(t, "cleanup.target", item.target)} ${item.runId}: ${word(t, "cleanup.block", item.code)}`, { "data-code": item.code }));
    parts.push(blocked);
  }
  parts.push(el("p", t.format("cleanup.plan.parked", { files: String(plan.parked.files) }), { class: "notice" }));
  return parts;
}

function resultSection(t: Texts, result: CleanupResultView): HTMLElement[] {
  if (!result.ok) return [errorBox(t, result.code)];
  const removed = (target: string): { count: number; bytes: number } => {
    const items = result.removed.filter((item) => item.target === target);
    return { count: items.length, bytes: items.reduce((sum, item) => sum + item.bytes, 0) };
  };
  const runs = removed("run");
  const discarded = removed("discarded");
  const leftovers = removed("leftover");
  const parts: HTMLElement[] = [
    el(
      "p",
      t.format("cleanup.result.removed", {
        runs: String(runs.count),
        discarded: String(discarded.count),
        leftovers: String(leftovers.count),
        size: sizeText(t, runs.bytes + discarded.bytes + leftovers.bytes),
      }),
      { id: "cleanup-removed", "data-removed": String(result.removed.length) },
    ),
  ];
  if (result.kept.length > 0) {
    parts.push(el("h4", t.format("cleanup.result.kept", { count: String(result.kept.length) })));
    const list = el("ul", undefined, { id: "cleanup-kept" });
    for (const item of result.kept) list.append(el("li", `${word(t, "cleanup.target", item.target)} ${item.id}: ${word(t, "cleanup.kept", item.reason)}`, { "data-target": item.target, "data-id": item.id, "data-reason": item.reason }));
    parts.push(list);
    if (result.kept.some((item) => item.reason === "partly_removed")) parts.push(el("p", t.format("cleanup.result.partlyRemoved"), { class: "notice", id: "cleanup-partly-removed" }));
  }
  return parts;
}

export function cleanupScreen(deps: CleanupDeps): Screen {
  const { texts: t, api } = deps;
  return {
    id: "cleanup",
    title: "nav.cleanup",
    show(root) {
      const workspace = deps.current();
      const body = el("div", undefined, { id: "cleanup" });
      root.replaceChildren(el("h2", t.format("cleanup.title")), body);
      if (workspace === null) {
        body.append(el("p", t.format("cleanup.noWorkspace")));
        body.setAttribute("data-cleanup-ready", "none");
        return;
      }
      const summaryBox = el("div", undefined, { id: "cleanup-summary-box" });
      const panel = el("section", undefined, { id: "cleanup-plan", "aria-live": "polite" });
      const resultBox = el("section", undefined, { id: "cleanup-result", role: "status" });
      const form = el("section", undefined, { id: "cleanup-select", "aria-labelledby": "cleanup-select-title" });

      const loadSummary = async (): Promise<StateSummaryView | null> => {
        const reply = asStateSummary(await api.stateSummary(workspace.handle));
        if (!reply.ok) {
          summaryBox.replaceChildren(errorBox(t, reply.code));
          body.setAttribute("data-cleanup-ready", "error");
          return null;
        }
        summaryBox.replaceChildren(summarySection(t, reply.summary));
        return reply.summary;
      };

      const buildForm = (summary: StateSummaryView): void => {
        const runsDays = el("input", undefined, { type: "number", min: "0", step: "1", id: "cleanup-runs-days", "aria-label": t.format("cleanup.select.runsDays") });
        const reverted = checkbox("cleanup-runs-reverted");
        const discardedDays = el("input", undefined, { type: "number", min: "0", step: "1", id: "cleanup-discarded-days", "aria-label": t.format("cleanup.select.discardedDays") });
        const entries = el("ul", undefined, { id: "cleanup-entries" });
        const runChecks: HTMLInputElement[] = [];
        const discardedChecks: HTMLInputElement[] = [];
        for (const entry of summary.entries) {
          const row = el("li", undefined, { "data-run": entry.runId });
          const runCheck = checkbox(`cleanup-run-${entry.runId}`, { "data-run-select": entry.runId, "aria-label": t.format("cleanup.select.run", { runId: entry.runId }) });
          runChecks.push(runCheck);
          row.append(runCheck, el("span", `${entry.runId} · ${entry.startedAt === null ? "-" : localDateTime(entry.startedAt)} · ${entryState(t, entry)} · ${sizeText(t, entry.records.bytes)}`, { lang: "en" }));
          if (entry.discarded !== null) {
            const discardedCheck = checkbox(`cleanup-discarded-${entry.runId}`, { "data-discarded-select": entry.runId, "aria-label": t.format("cleanup.select.discarded", { runId: entry.runId }) });
            discardedChecks.push(discardedCheck);
            row.append(discardedCheck, el("label", t.format("cleanup.select.discardedOf", { files: String(entry.discarded.files), size: sizeText(t, entry.discarded.bytes) }), { for: `cleanup-discarded-${entry.runId}` }));
          }
          entries.append(row);
        }
        const days = (input: HTMLInputElement): number | null | "bad" => {
          if (input.value.trim() === "") return null;
          const n = Number(input.value);
          return Number.isSafeInteger(n) && n >= 0 && n <= 36_500 ? n : "bad";
        };
        const preview = button(t.format("cleanup.preview"), () => {
          const selection: Record<string, unknown> = {};
          const runDays = days(runsDays);
          const boxDays = days(discardedDays);
          if (runDays === "bad" || boxDays === "bad") {
            panel.replaceChildren(errorBox(t, "bad_number"));
            return;
          }
          const runIds = runChecks.filter((input) => input.checked === true).map((input) => input.getAttribute("data-run-select") ?? "");
          const boxIds = discardedChecks.filter((input) => input.checked === true).map((input) => input.getAttribute("data-discarded-select") ?? "");
          const runsPart: Record<string, unknown> = {};
          if (runDays !== null) runsPart["olderThanDays"] = runDays;
          if (reverted.checked === true) runsPart["reverted"] = true;
          if (runIds.length > 0) runsPart["runIds"] = runIds;
          if (Object.keys(runsPart).length > 0) selection["runs"] = runsPart;
          const boxPart: Record<string, unknown> = {};
          if (boxDays !== null) boxPart["olderThanDays"] = boxDays;
          if (boxIds.length > 0) boxPart["runIds"] = boxIds;
          if (Object.keys(boxPart).length > 0) selection["discarded"] = boxPart;
          void (async () => {
            panel.replaceChildren(el("p", t.format("runs.loading")));
            resultBox.replaceChildren();
            const reply = asCleanupPreview(await api.previewCleanup(workspace.handle, selection));
            if (!reply.ok) {
              panel.replaceChildren(errorBox(t, reply.code));
              panel.setAttribute("data-plan", reply.code);
              return;
            }
            const clean = button(
              t.format("cleanup.apply"),
              () => {
                clean.setAttribute("disabled", "");
                void (async () => {
                  const done = asCleanupResult(await api.applyCleanup(reply.token));
                  resultBox.replaceChildren(...(done.ok ? resultSection(t, done.result) : [errorBox(t, done.code)]));
                  resultBox.setAttribute("data-result", done.ok ? (done.result.ok ? "done" : done.result.code) : done.code);
                  if (done.ok && done.result.ok) {
                    deps.announce(t.format("cleanup.announce", { count: String(done.result.removed.length) }));
                    const summary = await loadSummary();
                    if (summary !== null) buildForm(summary);
                  }
                })();
              },
              { id: "cleanup-apply" },
            );
            if (reply.plan.items.length === 0) clean.setAttribute("disabled", "");
            panel.replaceChildren(el("h3", t.format("cleanup.plan")), ...planSection(t, reply.plan), clean);
            panel.setAttribute("data-plan", String(reply.plan.items.length));
          })();
        }, { id: "cleanup-preview" });
        form.replaceChildren(
          el("h3", t.format("cleanup.select"), { id: "cleanup-select-title" }),
          el("p", t.format("cleanup.select.note"), { class: "notice" }),
          labelled("cleanup-runs-days", t.format("cleanup.select.runsDays"), runsDays),
          labelled("cleanup-runs-reverted", t.format("cleanup.select.reverted"), reverted),
          labelled("cleanup-discarded-days", t.format("cleanup.select.discardedDays"), discardedDays),
          entries,
          preview,
        );
      };

      body.replaceChildren(summaryBox, form, panel, resultBox);
      void (async () => {
        const summary = await loadSummary();
        if (summary === null) return;
        buildForm(summary);
        body.setAttribute("data-cleanup-ready", "ok");
      })();
    },
  };
}
