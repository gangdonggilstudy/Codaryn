/**
 * GU-4: the run list and the revert preview (docs/design/standalone-gui.md 3.8).
 * - Rows: start time (local), kind (run or apply), status word, changed files, task id (masked),
 *   and whether the run was reverted. A damaged run reads "records cannot be checked" and has no
 *   action (N-23 (b), N-26).
 * - The window never uses "latest": a preview names the run id of the row the person chose.
 * - "Revert…" sends the preview's token only; the main process asks the person in an OS dialog
 *   (default: do not revert) before anything changes (6.6). The preview is no promise: files
 *   changed after it are skipped (AC 5.5).
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asRevert, asRuns } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { button, el } from "../shell/dom.js";
import type { Screen } from "../shell/shell.js";
import type { RevertView, RunListItem } from "../../shared/ipc.js";
import { localDateTime } from "../run/run-model.js";

export interface RunsDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  readonly current: () => Workspace | null;
  readonly open: () => void;
  readonly announce: (text: string) => void;
  /** GU-5: the plan screen for a run that waits for its plan to be approved. */
  readonly openPlan: (runId: string, profile: string | null, workflow: string | null, formKnown?: boolean, recordsChanged?: boolean) => void;
  /** DR-29: the changed files of a run, by path and state, and their texts when verified. */
  readonly openChanges: (runId: string, profile: string | null, workflow: string | null) => void;
  /** GU-3 (3.7): the run's report, with the run's form when this app started it; U-79: and the tab to open first. */
  readonly openReport: (runId: string, form: { readonly profile: string | null; readonly workflow: string | null } | null, tab?: string | null) => void;
}

function errorBox(t: Texts, code: string): HTMLElement {
  return el("div", `${errorText(t, code)} ${t.format("error.code", { code })}`, { role: "alert", class: "error", "data-error": code });
}

function word(t: Texts, prefix: string, value: string): string {
  const id = `${prefix}.${value}`;
  return t.has(id) ? t.format(id) : value;
}

function revertList(t: Texts, view: RevertView): HTMLElement[] {
  const out: HTMLElement[] = [];
  // U-32 (UXM-14, DR-38): as the CLI's revert says it; the revert is not refused.
  if (view.recordsChanged === true) out.push(el("p", t.format("runs.revertRecordsChanged"), { class: "notice", id: "revert-records-changed" }));
  out.push(el("h4", t.format("runs.toRevert", { count: String(view.reverted.length) })));
  if (view.reverted.length > 0) {
    const list = el("ul", undefined, { class: "revert-files" });
    for (const file of view.reverted) {
      const text = file.from === null ? `${word(t, "revertaction", file.action)}: ${file.path}` : `${word(t, "revertaction", file.action)}: ${file.from} → ${file.path}`;
      list.append(el("li", file.unsafe ? `${text} ${t.format("runs.unsafe")}` : text, { "data-action": file.action }));
    }
    out.push(list);
  }
  out.push(el("h4", t.format("runs.toSkip", { count: String(view.skipped.length) })));
  if (view.skipped.length > 0) {
    const list = el("ul", undefined, { class: "skip-files" });
    for (const file of view.skipped) list.append(el("li", `${file.path}: ${word(t, "skip", file.reason)}`, { "data-reason": file.reason }));
    out.push(list);
  }
  if (view.moveSafetyUnchecked) out.push(el("p", t.format("runs.moveSafety"), { class: "notice" }));
  if (view.revertedBefore !== null) out.push(el("p", t.format("runs.revertedBefore", { time: localDateTime(view.revertedBefore.at) }), { class: "notice" }));
  return out;
}

function row(t: Texts, run: RunListItem, preview: (runId: string) => void, openPlan: (runId: string) => void, openChanges: (runId: string) => void, openReport: (runId: string) => void, openReview: (runId: string) => void): HTMLElement {
  const item = el("li", undefined, { "data-run": run.runId, "data-state": run.state });
  if (run.state === "damaged") {
    item.append(el("span", run.runId, { class: "run-id", lang: "en" }), el("span", t.format("runs.damaged"), { class: "damaged" }));
    return item;
  }
  const facts = [
    run.startedAt === null ? "" : localDateTime(run.startedAt),
    word(t, "runkind", run.kind),
    run.status === null ? t.format("runstatus.none") : word(t, "runstatus", run.status),
    run.changes === null ? t.format("runs.changesUnknown") : t.format("runs.changes", { count: String(run.changes) }),
  ];
  item.setAttribute("data-status", run.status ?? "none");
  item.append(el("span", facts.filter((fact) => fact !== "").join(" · "), { class: "run-facts" }), el("span", run.taskId, { class: "task-id" }), el("code", run.runId, { class: "run-id", lang: "en" }));
  if (run.reverted !== null) item.append(el("span", t.format(run.reverted.status === "partial" ? "runs.revertedPartial" : "runs.reverted", { time: localDateTime(run.reverted.at) }), { class: "reverted" }));
  if (run.revertRecordDamaged) item.append(el("span", t.format("runs.revertDamaged"), { class: "damaged" }));
  // UXM-14, DR-38: as the CLI's runs says it.
  if (run.recordsChanged === true) item.append(el("span", t.format("runs.recordsChanged"), { class: "damaged", "data-records-changed": "true" }));
  // U-61 (U-16, R-55): what became of this plan's apply, by the contract's rule, in the CLI's runs words.
  if (run.planApply != null) {
    const { state, applyRunId, reason } = run.planApply;
    item.append(el("span", t.format(`runs.planApply.${state}`, { runId: applyRunId, reason: reason ?? "-" }), { class: "plan-apply", "data-plan-apply": state }));
  }
  const open = button(t.format("runs.preview"), () => preview(run.runId), { "data-preview": run.runId });
  open.setAttribute("aria-label", `${t.format("runs.preview")}: ${run.runId}`);
  item.append(button(t.format("run.viewReport"), () => openReport(run.runId), { "data-report": run.runId }), open);
  if (run.kind === "run" && run.changes !== null && run.changes > 0) item.append(button(t.format("run.viewChanges"), () => openChanges(run.runId), { "data-changes": run.runId }));
  if (run.reason === "plan_pending") item.append(button(t.format("run.viewPlan"), () => openPlan(run.runId), { "data-plan": run.runId }));
  // U-79 (3.7, 3.8): a run waiting for its review is reviewed from the list too (after a restart, its result screen is gone).
  if (run.reason === "awaiting_review") item.append(button(t.format("runs.review"), () => openReview(run.runId), { "data-review": run.runId }));
  return item;
}

export interface RunsScreen extends Screen {
  /** U-61 (3.12): the next time the list is shown, preview the revert of this run (a result's next step). */
  choosePreview(runId: string): void;
}

export function runsScreen(deps: RunsDeps): RunsScreen {
  const { texts: t, api } = deps;
  let pendingPreview: string | null = null;
  return {
    id: "runs",
    title: "nav.runs",
    choosePreview(runId) {
      pendingPreview = runId;
    },
    show(root) {
      const workspace = deps.current();
      if (workspace === null) {
        root.replaceChildren(el("h2", t.format("runs.title")), el("p", t.format("task.noWorkspace")), button(t.format("home.open"), deps.open));
        return;
      }
      const list = el("ul", undefined, { id: "runs-list", class: "runs" });
      const panel = el("section", undefined, { id: "revert-panel", "aria-live": "polite" });
      const head = el("div", undefined, { class: "screen-head" });

      /** A revert's result; DR-25: when files were skipped as unsafe moves, the person may ask to be asked. */
      const showResult = (runId: string, view: RevertView, consentRetry: string | null): void => {
        const title = t.format(view.status === "partial" ? "runs.resultPartial" : "runs.resultComplete", { runId });
        const parts: HTMLElement[] = [el("h3", title, { id: "revert-title" }), ...revertList(t, view)];
        if (consentRetry !== null) {
          const unsafe = view.skipped.filter((file) => file.reason === "unsafe_move").length;
          const message = el("div", undefined, { role: "alert" });
          const again = button(t.format("runs.consentAsk"), () => {
            again.setAttribute("disabled", "");
            void (async () => {
              const retried = asRevert(await api.revertConsent(consentRetry));
              if (!retried.ok) {
                message.replaceChildren(errorBox(t, retried.code));
                panel.setAttribute("data-revert-consent", retried.code);
                return;
              }
              showResult(runId, retried.view, null);
              panel.setAttribute("data-revert-consent", retried.view.status);
              await load();
            })();
          }, { id: "revert-consent" });
          parts.push(el("p", t.format("runs.consentNeeded", { count: String(unsafe) }), { class: "notice" }), again, message);
        }
        panel.replaceChildren(...parts);
        panel.setAttribute("data-revert", view.status);
        deps.announce(title);
      };

      const showPreview = async (runId: string): Promise<void> => {
        panel.replaceChildren(el("p", t.format("runs.loading")));
        panel.setAttribute("data-preview", "loading");
        const reply = asRevert(await api.previewRevert(workspace.handle, runId));
        if (!reply.ok) {
          panel.replaceChildren(errorBox(t, reply.code));
          panel.setAttribute("data-preview", "error");
          return;
        }
        const token = reply.preview;
        const title = el("h3", t.format("runs.previewTitle", { runId }), { id: "revert-title" });
        const revert = button(t.format("runs.revert"), () => {
          if (token === null) return;
          revert.setAttribute("disabled", "");
          void (async () => {
            const done = asRevert(await api.revert(token));
            if (!done.ok) {
              panel.append(errorBox(t, done.code));
              panel.setAttribute("data-revert", done.code);
              return;
            }
            showResult(runId, done.view, done.consentRetry);
            await load();
          })();
        }, { id: "revert-run" });
        if (token === null || reply.view.reverted.length === 0) revert.setAttribute("disabled", "");
        panel.replaceChildren(title, el("p", t.format("runs.previewNote"), { class: "notice" }), ...revertList(t, reply.view), revert);
        panel.setAttribute("data-preview", String(reply.view.reverted.length));
        panel.removeAttribute("data-revert");
      };

      const load = async (): Promise<void> => {
        list.setAttribute("data-runs-ready", "loading");
        const reply = asRuns(await api.listRuns(workspace.handle));
        if (!reply.ok) {
          list.replaceChildren();
          list.setAttribute("data-runs-ready", "error");
          panel.replaceChildren(errorBox(t, reply.code));
          return;
        }
        // R21b-L-1: a row opens with the run's own form when this app started it; else its plan is only shown.
        const forms = new Map(reply.runs.flatMap((run) => (run.state === "checked" ? [[run.runId, run.form ?? null] as const] : [])));
        const marked = new Set(reply.runs.flatMap((run) => (run.state === "checked" && run.recordsChanged === true ? [run.runId] : [])));
        const openWithForm = (id: string, what: "plan" | "changes" | "report" | "review"): void => {
          const form = forms.get(id) ?? null;
          if (what === "plan") deps.openPlan(id, form?.profile ?? null, form?.workflow ?? null, form !== null, marked.has(id));
          else if (what === "changes") deps.openChanges(id, form?.profile ?? null, form?.workflow ?? null);
          else if (what === "review") deps.openReport(id, form, "review");
          else deps.openReport(id, form);
        };
        list.replaceChildren(...(reply.runs.length === 0 ? [el("li", t.format("runs.empty"), { class: "empty" })] : reply.runs.map((run) => row(t, run, (id) => void showPreview(id), (id) => openWithForm(id, "plan"), (id) => openWithForm(id, "changes"), (id) => openWithForm(id, "report"), (id) => openWithForm(id, "review")))));
        if (reply.omitted > 0) list.append(el("li", t.format("runs.omitted", { count: String(reply.omitted) }), { class: "omitted" }));
        list.setAttribute("data-runs-ready", String(reply.runs.length));
        // U-61: a preview asked from a result, once the list (which the main process checks it against) is in.
        const chosen = pendingPreview;
        pendingPreview = null;
        if (chosen !== null && reply.runs.some((run) => run.state === "checked" && run.runId === chosen)) await showPreview(chosen);
      };

      head.append(el("h2", t.format("runs.titleIn", { name: workspace.name })), button(t.format("runs.refresh"), () => void load(), { id: "runs-refresh" }));
      root.replaceChildren(head, list, panel);
      void load();
    },
  };
}
