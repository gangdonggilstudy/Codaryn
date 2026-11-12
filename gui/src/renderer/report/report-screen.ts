/**
 * GU-3: the result screen of a run or an apply (docs/design/standalone-gui.md 3.7), from the app
 * layer's structured `report` (never Markdown turned into HTML). Tabs: summary, checks (by number,
 * with their evidence), changes (a run) or actions (an apply), protected items ("found after the
 * fact"), usage, the masking counts (U-40) and records, and the person's verdict. Every text came masked and cleaned.
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asReport, asSaveReport } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { button, el } from "../shell/dom.js";
import type { Screen } from "../shell/shell.js";
import type { MaskingView, ReportView } from "../../shared/ipc.js";
import { FINAL_MESSAGE_LIMIT, clock, localDateTime } from "../run/run-model.js";

/**
 * U-40 (DR-52, AXM-17): the masking line of the run's end and of the report, the same words as the
 * CLI's `summary.masking`: two counts, never a value, a place or a length. Null (no line) when the
 * result has none, or when either is not a count (the main process dropped such a field already).
 */
export function maskingLine(t: Texts, masking: MaskingView | null | undefined): string | null {
  if (masking === undefined || masking === null) return null;
  const { registeredValues, maskedPlaces } = masking;
  const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (!isCount(registeredValues) || !isCount(maskedPlaces)) return null;
  return t.format("run.masking", { registered: String(registeredValues), masked: String(maskedPlaces) });
}

export interface ReportDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  readonly current: () => Workspace | null;
  /** The changes screen for a run (DR-29), with the run's form when known. */
  readonly openChanges: (runId: string, form: RunForm | null) => void;
}

type RunForm = { readonly profile: string | null; readonly workflow: string | null };

export interface ReportScreen extends Screen {
  /** The run to show, and its form (R21b-L-1: the run's own, never another run's). */
  choose(runId: string, form?: RunForm | null): void;
}

function word(t: Texts, prefix: string, value: string): string {
  const id = `${prefix}.${value}`;
  return t.has(id) ? t.format(id) : value;
}

function list(items: readonly string[], attrs: Readonly<Record<string, string>> = {}): HTMLElement {
  const out = el("ul", undefined, attrs);
  for (const item of items) out.append(el("li", item));
  return out;
}

type Tab = { readonly id: string; readonly label: string; readonly build: () => HTMLElement[] };

function tabsOf(t: Texts, deps: ReportDeps, view: ReportView, labels: { readonly status: string; readonly reason: string } | null, form: RunForm | null): Tab[] {
  const tabs: Tab[] = [];
  tabs.push({
    id: "summary",
    label: t.format("report.tab.summary"),
    build: () => {
      const parts = [
        el("p", view.finished === null ? t.format("report.notFinished") : t.format("run.statusLine", { status: labels?.status ?? word(t, "runstatus", view.finished.status), reason: labels?.reason ?? view.finished.reason }), { id: "report-status", "data-status": view.finished?.status ?? "none", "data-reason": view.finished?.reason ?? "none" }),
        el("p", t.format("report.runId", { runId: view.runId }), { lang: "en" }),
        el("p", t.format("report.task", { task: view.taskId })),
      ];
      if (view.run !== null) parts.push(el("p", t.format("report.workflow", { workflow: view.run.workflow, provider: view.run.provider ?? "-" })));
      if (view.status === "incomplete") parts.push(el("p", t.format("report.incomplete"), { class: "notice" }));
      // U-21 (DR-47, AXM-1): the agent's last message under the report's label (its own words, not a verified fact).
      if (view.finalMessage !== undefined && view.finalMessage !== null) {
        const words = el("div", undefined, { id: "report-final-message" });
        words.append(el("p", t.format("report.finalMessage"), { class: "notice" }), el("div", view.finalMessage.text, { class: "agent-words", id: "report-final-message-text" }));
        if (view.finalMessage.truncated) words.append(el("p", t.format("run.finalMessageTruncated", { count: String(FINAL_MESSAGE_LIMIT) }), { class: "notice" }));
        parts.push(words);
      }
      return parts;
    },
  });
  tabs.push({
    id: "checks",
    label: t.format("report.tab.checks"),
    build: () => {
      if (view.verifiers.length === 0) return [el("p", t.format("run.noChecks"))];
      return view.verifiers.map((verifier) => {
        const box = el("section", undefined, { class: "check", "data-outcome": verifier.outcome });
        box.append(el("h4", t.format("run.check", { number: String(verifier.number), outcome: word(t, "outcome", verifier.outcome) })));
        box.append(el("pre", verifier.evidence, { class: "evidence" }));
        if (verifier.evidenceCut) box.append(el("p", t.format("report.evidenceCut"), { class: "notice" }));
        if (verifier.checked.length > 0) box.append(el("h5", t.format("report.checked")), list(verifier.checked));
        if (verifier.limits.length > 0) box.append(el("h5", t.format("report.limits")), list(verifier.limits));
        return box;
      });
    },
  });
  if (view.run !== null) {
    const run = view.run;
    tabs.push({
      id: "changes",
      label: t.format("report.tab.changes"),
      build: () => {
        const parts: HTMLElement[] = [el("p", t.format("run.changes", { count: String(run.changes.length) }))];
        if (run.changes.length > 0) {
          parts.push(list(run.changes.map((change) => (change.created ? t.format("run.created", { path: change.path }) : change.path)), { id: "report-changes" }));
          parts.push(button(t.format("run.viewChanges"), () => deps.openChanges(view.runId, form), { id: "report-view-changes" }));
        }
        return parts;
      },
    });
  }
  if (view.apply !== null) {
    const apply = view.apply;
    tabs.push({
      id: "actions",
      label: t.format("report.tab.actions"),
      build: () => {
        const parts: HTMLElement[] = [
          el("p", t.format("report.plan", { runId: apply.planRunId ?? "-", digest: apply.digest?.slice(0, 12) ?? "-" })),
          el("p", t.format("report.approval", { channel: apply.approval ?? "-" })),
        ];
        if (apply.unsafeMoveConsent !== null) parts.push(el("p", t.format("report.unsafeConsent", { channel: apply.unsafeMoveConsent }), { class: "notice" }));
        if (apply.inventoryLimitReached) parts.push(el("p", t.format("plan.inventoryLimit"), { class: "notice" }));
        parts.push(el("h4", t.format("report.moved", { count: String(apply.moved.length) })));
        parts.push(list(apply.moved.map((item) => `${t.format("plan.move", { from: item.from, to: item.to })}${item.unsafe ? ` ${t.format("runs.unsafe")}` : ""}`)));
        parts.push(el("h4", t.format("report.discarded", { count: String(apply.discarded.length) })));
        parts.push(list(apply.discarded.map((item) => t.format("plan.discard", { path: item.path }))));
        if (apply.failed.length > 0) {
          parts.push(el("h4", t.format("report.failed", { count: String(apply.failed.length) })));
          parts.push(list(apply.failed.map((item) => t.format("report.failedItem", { number: String(item.number), problem: item.problem }))));
        }
        return parts;
      },
    });
  }
  tabs.push({
    id: "protected",
    label: t.format("report.tab.protected"),
    build: () => {
      if (view.integrity.length === 0) return [el("p", t.format("report.noProtected"))];
      const parts: HTMLElement[] = [el("p", t.format("report.afterTheFact"), { class: "notice" })];
      for (const check of view.integrity) {
        parts.push(el("h4", word(t, "phase", check.phase)));
        parts.push(check.changed.length === 0 ? el("p", t.format("report.unchanged")) : list(check.changed));
      }
      return parts;
    },
  });
  tabs.push({
    id: "usage",
    label: t.format("report.tab.usage"),
    build: () => {
      const usage = view.usage;
      const seconds = usage?.durationMs === null || usage === null ? null : Math.round((usage.durationMs ?? 0) / 1000);
      const parts = [
        el(
          "p",
          usage === null
            ? t.format("report.noUsage")
            : t.format("run.usage", {
                turns: String(usage.turns ?? "-"),
                tools: String(usage.tools ?? "-"),
                tokens: usage.inputTokens === null && usage.outputTokens === null ? "-" : String((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)),
                time: seconds === null ? "-" : clock(seconds),
              }),
        ),
        el("p", t.format("report.records", { count: String(view.records ?? "-") })),
      ];
      // U-40 (DR-52): the run's masking counts after its usage, as the run's end shows them.
      const masking = maskingLine(t, view.masking);
      if (masking !== null) parts.splice(1, 0, el("p", masking, { id: "report-masking" }));
      if (view.run !== null) {
        parts.push(el("p", t.format("report.runCounts", { requests: String(view.run.modelRequests ?? "-"), denied: String(view.run.deniedToolCalls ?? "-"), repairs: String(view.run.repairs ?? "-") })));
      }
      return parts;
    },
  });
  if (view.run !== null) {
    const verdict = view.run.verdict;
    tabs.push({
      id: "review",
      label: t.format("report.tab.review"),
      build: () =>
        verdict === null
          ? [el("p", t.format("report.noVerdict"))]
          : [
              el("p", t.format(verdict.verdict === "accepted" ? "review.accepted" : "review.rejected"), { id: "report-verdict", "data-verdict": verdict.verdict }),
              el("p", t.format("report.verdictAt", { time: localDateTime(verdict.at) })),
              ...(verdict.note === null ? [] : [el("p", t.format("report.note", { note: verdict.note }))]),
            ],
    });
  }
  return tabs;
}

export function reportScreen(deps: ReportDeps): ReportScreen {
  const { texts: t, api } = deps;
  let chosen: string | null = null;
  let chosenForm: RunForm | null = null;
  return {
    id: "report",
    title: "nav.report",
    choose(runId, form = null) {
      chosen = runId;
      chosenForm = form;
    },
    show(root) {
      const workspace = deps.current();
      const body = el("div", undefined, { id: "report" });
      root.replaceChildren(el("h2", t.format("report.title")), body);
      if (workspace === null || chosen === null) {
        body.append(el("p", t.format("report.none")));
        body.setAttribute("data-report-ready", "none");
        return;
      }
      const runId = chosen;
      const form = chosenForm;
      void (async () => {
        body.replaceChildren(el("p", t.format("runs.loading")));
        const reply = asReport(await api.report(workspace.handle, runId));
        if (!reply.ok) {
          body.replaceChildren(el("div", `${errorText(t, reply.code)} ${t.format("error.code", { code: reply.code })}`, { role: "alert", class: "error", "data-error": reply.code }));
          body.setAttribute("data-report-ready", "error");
          return;
        }
        const tabs = tabsOf(t, deps, reply.view, reply.labels ?? null, form);
        const bar = el("div", undefined, { role: "tablist", "aria-label": t.format("report.title") });
        const panel = el("section", undefined, { role: "tabpanel", id: "report-panel", tabindex: "0" });
        const buttons: HTMLButtonElement[] = [];
        const select = (index: number): void => {
          const tab = tabs[index];
          if (tab === undefined) return;
          buttons.forEach((b, i) => {
            b.setAttribute("aria-selected", String(i === index));
            b.setAttribute("tabindex", i === index ? "0" : "-1");
          });
          panel.setAttribute("aria-labelledby", `report-tab-${tab.id}`);
          panel.setAttribute("data-tab", tab.id);
          panel.replaceChildren(...tab.build());
        };
        tabs.forEach((tab, index) => {
          const b = button(tab.label, () => select(index), { role: "tab", id: `report-tab-${tab.id}`, "aria-controls": "report-panel", "data-tab": tab.id });
          b.addEventListener("keydown", (event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            event.preventDefault();
            const next = (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
            select(next);
            buttons[next]?.focus();
          });
          buttons.push(b);
          bar.append(b);
        });
        // UXM-14, DR-38: as the CLI's report warns; U-32: above the tabs, as every tab is the records' content.
        const warning = reply.view.recordsChanged === true ? [el("p", t.format("report.recordsChanged"), { class: "notice", id: "report-records-changed" })] : [];
        body.replaceChildren(...warning, bar, panel, ...saveReportButton(t, api, workspace, runId, "report-save"));
        select(0);
        body.setAttribute("data-report-ready", reply.view.kind);
      })();
    },
  };
}

/**
 * GU-3 (3.7): "Save the report": the main process asks the report as Markdown (the same masked
 * report) and the OS save dialog chooses the file. The status line names the file, never a folder.
 */
export function saveReportButton(t: Texts, api: CodarynApi, workspace: Workspace, runId: string, id: string): HTMLElement[] {
  const status = el("p", undefined, { id: `${id}-status`, role: "status" });
  const save = button(
    t.format("report.save"),
    () => {
      save.setAttribute("disabled", "");
      void (async () => {
        const reply = asSaveReport(await api.saveReport(workspace.handle, runId));
        save.removeAttribute("disabled");
        if (reply.ok) status.textContent = t.format("report.saved", { name: reply.name });
        else status.textContent = reply.code === "not_saved" ? t.format("report.notSaved") : `${errorText(t, reply.code)} ${t.format("error.code", { code: reply.code })}`;
        status.setAttribute("data-saved", reply.ok ? "ok" : reply.code);
      })();
    },
    { id },
  );
  return [save, status];
}
