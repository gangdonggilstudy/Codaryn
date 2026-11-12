/**
 * GU-3: the run screen (docs/design/standalone-gui.md 3.6) and the summary of its result (3.7).
 * - State: the state word, elapsed time, model turns and tool calls. Progress: the shared catalog's
 *   sentences the engine host made, with a filter (all, denials, file changes, checks).
 * - Cancel: off until startRun answered ("preparing", AC 5.3); asks in the window first, with
 *   "keep running" as the default; Esc never cancels. Changes already made stay (AC 5.3).
 * - The result: the status word and reason sentence from the shared catalog, the run id, the
 *   changed files (masked paths), the checks by number, usage and notes.
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asReview, asStartRun } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { actionLine } from "../plan/plan-screen.js";
import { button, el } from "../shell/dom.js";
import type { Screen } from "../shell/shell.js";
import type { RunItemView, RunResultView } from "../../shared/ipc.js";
import { clock, localTime } from "./run-model.js";
import type { RunFilter, RunModel } from "./run-model.js";

export interface RunScreenDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  readonly run: RunModel;
  readonly newTask: () => void;
  readonly announce: (text: string) => void;
  /** GU-5: the open workspace (for a review) and the plan screen for a plan run. */
  readonly current: () => Workspace | null;
  readonly openPlan: (runId: string, profile: string | null, workflow: string | null) => void;
  /** DR-29: the changed files of a run, by path and state, and their texts when verified. */
  readonly openChanges: (runId: string, profile: string | null, workflow: string | null) => void;
}

const MAX_NOTE = 500;

/** GU-5: what follows a result: the plan, the DR-21 consent question, the applied actions, a review. */
function nextSteps(t: Texts, deps: RunScreenDeps, result: RunResultView): HTMLElement[] {
  const { api, run } = deps;
  const out: HTMLElement[] = [];
  if (result.kind === "run" && result.changes.length > 0) {
    out.push(button(t.format("run.viewChanges"), () => deps.openChanges(result.runId, run.last?.profile ?? null, run.last?.workflow ?? null), { id: "run-view-changes" }));
  }
  if (result.plan !== null) {
    out.push(button(t.format("run.viewPlan"), () => deps.openPlan(result.runId, run.last?.profile ?? null, run.last?.workflow ?? null), { id: "run-view-plan" }));
  }
  if (result.kind === "apply") {
    const applied = el("div", undefined, { id: "run-applied" });
    applied.append(el("h4", t.format("run.applied", { count: String(result.applied.length) })));
    const list = el("ul");
    for (const action of result.applied) list.append(el("li", `${actionLine(t, action)}${action.unsafe === true ? ` ${t.format("runs.unsafe")}` : ""}`, { "data-kind": action.kind }));
    applied.append(list);
    out.push(applied);
    if (result.reason === "consent_required" && run.approval !== null) {
      const approval = run.approval;
      const message = el("div", undefined, { role: "alert" });
      const agree = button(t.format("run.consentAsk"), () => {
        if (!run.startingApply(approval)) return;
        agree.setAttribute("disabled", "");
        void (async () => {
          const started = asStartRun(await api.applyPlan(approval, true));
          if (started.ok) run.started(started.runId, Date.now());
          else {
            run.failedToStart(started.code);
            message.replaceChildren(el("p", `${errorText(t, started.code)} ${t.format("error.code", { code: started.code })}`, { "data-error": started.code }));
          }
        })();
      }, { id: "run-consent" });
      out.push(el("p", t.format("run.consentNeeded", { count: String(result.unsafeMoves ?? 0) }), { id: "run-consent-text", class: "notice" }), agree, message);
    }
  }
  const workspace = deps.current();
  if (result.review !== null && workspace !== null) {
    const panel = el("section", undefined, { id: "run-review-panel", "aria-labelledby": "run-review-title" });
    const note = el("textarea", undefined, { id: "review-note", rows: "3", maxlength: String(MAX_NOTE) });
    const confirm = el("div", undefined, { id: "review-confirm", hidden: "", role: "alertdialog", "aria-labelledby": "review-confirm-text" });
    const outcome = el("div", undefined, { id: "review-outcome", role: "status" });
    let decision: "accept" | "reject" = "accept";
    const ask = (chosen: "accept" | "reject"): void => {
      decision = chosen;
      confirmText.textContent = t.format(chosen === "accept" ? "review.confirmAccept" : "review.confirmReject");
      confirm.removeAttribute("hidden");
      keep.focus();
    };
    const confirmText = el("p", "", { id: "review-confirm-text" });
    const keep = button(t.format("review.back"), () => confirm.setAttribute("hidden", ""), { id: "review-back" });
    const record = button(t.format("review.record"), () => {
      confirm.setAttribute("hidden", "");
      void (async () => {
        const text = note.value.trim();
        const reply = asReview(await api.review(workspace.handle, result.runId, run.last?.profile ?? null, run.last?.workflow ?? null, decision, text === "" ? null : text));
        if (!reply.ok) {
          outcome.replaceChildren(el("p", `${errorText(t, reply.code)} ${t.format("error.code", { code: reply.code })}`, { "data-error": reply.code }));
          return;
        }
        outcome.replaceChildren(el("p", t.format(reply.verdict === "accepted" ? "review.accepted" : "review.rejected")));
        outcome.setAttribute("data-verdict", reply.verdict);
        deps.announce(t.format(reply.verdict === "accepted" ? "review.accepted" : "review.rejected"));
      })();
    }, { id: "review-record" });
    confirm.append(confirmText, keep, record);
    // No default button (3.7): the person picks one; the window asks once more before recording.
    panel.append(
      el("h4", t.format("review.title"), { id: "run-review-title" }),
      el("p", t.format("review.text")),
      el("label", t.format("review.note"), { for: "review-note" }),
      note,
      button(t.format("review.accept"), () => ask("accept"), { id: "review-accept" }),
      button(t.format("review.reject"), () => ask("reject"), { id: "review-reject" }),
      confirm,
      outcome,
    );
    out.push(panel);
  }
  return out;
}

const FILTERS: readonly RunFilter[] = ["all", "denied", "files", "checks"];

function itemRow(item: RunItemView): HTMLElement {
  const row = el("li", undefined, { "data-kind": item.kind });
  const time = localTime(item.at);
  if (time !== "") row.append(el("time", time, { class: "at" }));
  row.append(el("span", item.text, { class: "text" }));
  return row;
}

function resultView(t: Texts, result: RunResultView, labels: { status: string; reason: string }): HTMLElement {
  const box = el("section", undefined, { id: "run-result", "aria-labelledby": "run-result-title", "data-status": result.status, "data-reason": result.reason });
  box.append(el("h3", t.format("run.result"), { id: "run-result-title" }));
  box.append(el("p", t.format("run.statusLine", { status: labels.status, reason: labels.reason }), { class: "status-line" }));
  const id = el("p", undefined, { class: "run-id" });
  id.append(el("span", t.format("run.runId")), el("code", result.runId, { id: "run-result-id", lang: "en" }));
  box.append(id);

  const changes = el("div", undefined, { id: "run-changes" });
  changes.append(el("h4", t.format("run.changes", { count: String(result.changes.length) })));
  if (result.changes.length > 0) {
    const list = el("ul", undefined, { class: "changes" });
    for (const change of result.changes) list.append(el("li", change.created ? t.format("run.created", { path: change.path }) : change.path, { "data-created": String(change.created) }));
    changes.append(list);
  }
  box.append(changes);

  const checks = el("div", undefined, { id: "run-checks" });
  checks.append(el("h4", t.format("run.checks")));
  checks.append(
    result.verifiers.length === 0
      ? el("p", t.format("run.noChecks"))
      : el(
          "ul",
          undefined,
          {},
        ),
  );
  const checkList = checks.querySelector("ul");
  if (checkList !== null) {
    for (const verifier of result.verifiers) {
      const id = `outcome.${verifier.outcome}`;
      const outcome = t.has(id) ? t.format(id) : verifier.outcome;
      checkList.append(el("li", t.format("run.check", { number: String(verifier.number), outcome }), { "data-outcome": verifier.outcome }));
    }
  }
  box.append(checks);

  const usage = result.usage;
  const seconds = usage.durationMs === null ? null : Math.round(usage.durationMs / 1000);
  box.append(
    el(
      "p",
      t.format("run.usage", {
        turns: String(usage.turns ?? "-"),
        tools: String(usage.tools ?? "-"),
        tokens: usage.inputTokens === null && usage.outputTokens === null ? "-" : String((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)),
        time: seconds === null ? "-" : clock(seconds),
      }),
      { id: "run-usage" },
    ),
  );
  if (result.plan !== null) box.append(el("p", t.format("run.plan", { actions: String(result.plan.actions ?? "-"), digest: result.plan.digest.slice(0, 12) }), { id: "run-plan" }));
  if (result.review !== null) {
    const review = el("div", undefined, { id: "run-review" });
    review.append(el("h4", t.format("run.review")));
    const list = el("ul");
    for (const item of result.review.checklist) list.append(el("li", item));
    review.append(list);
    box.append(review);
  }
  if (result.notices.length > 0) {
    const notes = el("ul", undefined, { id: "run-notices" });
    for (const notice of result.notices) notes.append(el("li", notice));
    box.append(el("h4", t.format("run.notices")), notes);
  }
  return box;
}

export function runScreen(deps: RunScreenDeps): Screen {
  const { texts: t, api, run } = deps;
  let filter: RunFilter = "all";
  return {
    id: "run",
    title: "nav.run",
    show(root) {
      const head = el("div", undefined, { class: "screen-head" });
      const state = el("p", undefined, { id: "run-state", role: "status" });
      const counts = el("p", undefined, { id: "run-counts" });
      const gap = el("p", t.format("run.gap"), { id: "run-gap", hidden: "" });
      const log = el("ol", undefined, { id: "run-log", "aria-label": t.format("run.log") });
      const confirm = el("div", undefined, { id: "run-confirm", hidden: "", role: "alertdialog", "aria-labelledby": "run-confirm-text" });
      const end = el("div", undefined, { id: "run-end" });
      const cancel = button(t.format("run.cancel"), () => {
        if (!run.canCancel) return;
        confirm.removeAttribute("hidden");
        keep.focus();
      }, { id: "run-cancel" });
      const keep = button(t.format("run.keep"), () => {
        confirm.setAttribute("hidden", "");
        cancel.focus();
      }, { id: "run-keep" });
      const sure = button(t.format("run.cancelSure"), () => {
        confirm.setAttribute("hidden", "");
        run.cancelling();
        void (async () => {
          if ((await api.cancelRun()) !== true) run.cancelFailed();
        })();
      }, { id: "run-cancel-sure" });
      confirm.append(el("p", t.format("run.cancelText"), { id: "run-confirm-text" }), keep, sure);

      const filterField = el("p", undefined, { class: "field" });
      const filterSelect = el("select", undefined, { id: "run-filter" });
      for (const value of FILTERS) {
        const option = el("option", t.format(`run.filter.${value}`), { value });
        if (value === filter) option.selected = true;
        filterSelect.append(option);
      }
      filterField.append(el("label", t.format("run.filter"), { for: "run-filter" }), filterSelect);
      head.append(el("h2", t.format("run.title")), cancel);
      root.replaceChildren(head, state, counts, confirm, filterField, gap, log, end);

      let shownItems = 0;
      let shownTotal = -1;
      const renderLog = (full: boolean): void => {
        const items = run.shown(filter);
        if (full || items.length < shownItems || run.items.length < shownTotal) {
          log.replaceChildren(...items.map(itemRow));
        } else {
          for (const item of items.slice(shownItems)) log.append(itemRow(item));
        }
        shownItems = items.length;
        shownTotal = run.items.length;
      };
      filterSelect.addEventListener("change", () => {
        filter = (FILTERS as readonly string[]).includes(filterSelect.value) ? (filterSelect.value as RunFilter) : "all";
        renderLog(true);
      });

      let lastPhase = "";
      const render = (): void => {
        const phase = run.phase;
        const word = phase === "done" && run.done?.ok === true ? run.done.labels.status : t.format(`run.phase.${phase}`);
        state.textContent = t.format("run.state", { state: word });
        state.setAttribute("data-phase", phase);
        const seconds = run.elapsed(Date.now());
        counts.textContent = t.format("run.counts", { time: seconds === null ? "-" : clock(seconds), turns: String(run.counts.turns), tools: String(run.counts.tools) });
        if (run.canCancel) cancel.removeAttribute("disabled");
        else cancel.setAttribute("disabled", "");
        cancel.textContent = phase === "starting" ? t.format("run.preparing") : phase === "cancelling" ? t.format("run.cancelling") : t.format("run.cancel");
        if (!run.canCancel) confirm.setAttribute("hidden", "");
        if (run.gap) gap.removeAttribute("hidden");
        renderLog(false);
        if (phase === lastPhase) return;
        lastPhase = phase;
        end.replaceChildren();
        if (phase === "idle" && run.startError !== null) {
          end.append(el("div", `${errorText(t, run.startError)} ${t.format("error.code", { code: run.startError })}`, { role: "alert", class: "error", "data-error": run.startError }));
        }
        if (phase === "idle" && run.startError === null && run.done === null) end.append(el("p", t.format("run.none")));
        if (phase === "done" && run.done !== null) {
          if (run.done.ok) end.append(resultView(t, run.done.result, run.done.labels), ...nextSteps(t, deps, run.done.result));
          else end.append(el("div", `${errorText(t, run.done.code)} ${t.format("error.code", { code: run.done.code })}`, { role: "alert", class: "error", "data-error": run.done.code }));
        }
        if (phase === "idle" || phase === "done") end.append(button(t.format("run.again"), deps.newTask, { id: "run-again" }));
        root.setAttribute("data-run-phase", phase);
      };
      render();
      const unsubscribe = run.subscribe(() => {
        if (!root.contains(state)) {
          unsubscribe();
          return;
        }
        render();
      });
      // The elapsed time moves while the run goes on; the timer stops when the screen is gone.
      const timer = setInterval(() => {
        if (!root.contains(state)) {
          clearInterval(timer);
          unsubscribe();
          return;
        }
        if (run.phase === "running" || run.phase === "cancelling") render();
      }, 1000);
    },
  };
}
