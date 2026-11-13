/**
 * GU-3: the run screen (docs/design/standalone-gui.md 3.6) and the summary of its result (3.7).
 * - State: the state word, elapsed time, model turns and tool calls. Progress: the shared catalog's
 *   sentences the engine host made, with a filter (all, denials, file changes, checks).
 * - Cancel: off until startRun answered ("preparing", AC 5.3); asks in the window first, with
 *   "keep running" as the default; Esc never cancels. Changes already made stay (AC 5.3).
 * - The result: the status word and reason sentence from the shared catalog, the run id, the
 *   changed files (masked paths), the checks by number, usage, the masking counts (U-40) and notes.
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asRuns, asStartRun } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { actionLine } from "../plan/plan-screen.js";
import { button, el } from "../shell/dom.js";
import type { Screen } from "../shell/shell.js";
import type { RunItemView, RunResultView } from "../../shared/ipc.js";
import { FINAL_MESSAGE_LIMIT, clock, localTime } from "./run-model.js";
import { maskingLine, saveReportButton } from "../report/report-screen.js";
import { copyControl } from "../shell/copy.js";
import type { RunFilter, RunModel } from "./run-model.js";
import { reviewPanel } from "./review-panel.js";

export interface RunScreenDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  readonly run: RunModel;
  readonly newTask: () => void;
  readonly announce: (text: string) => void;
  /** GU-5: the open workspace (for a review) and the plan screen for a plan run. */
  readonly current: () => Workspace | null;
  readonly openPlan: (runId: string, profile: string | null, workflow: string | null, formKnown?: boolean) => void;
  /** DR-29: the changed files of a run, by path and state, and their texts when verified. */
  readonly openChanges: (runId: string, profile: string | null, workflow: string | null) => void;
  /** GU-3 (3.7): the run's report, with the run's form; U-61: and the tab to open first. */
  readonly openReport: (runId: string, form: { readonly profile: string | null; readonly workflow: string | null } | null, tab?: string | null) => void;
  /** U-61 (3.12): the run list with this run's revert preview. */
  readonly openRevert?: (runId: string) => void;
  /** U-61 (3.12): the settings screen, where the limits are (3.10). */
  readonly openSettings?: () => void;
}

/** GU-5: what follows a result: the plan, the DR-21 consent question, the applied actions, a review. */
/**
 * `formKnown` false (U-63, a task file's run): the window does not keep the task file's path, so the
 * run's form is unknown here, as for a run started elsewhere: its plan is shown, not applied, and its
 * review is recorded with the CLI.
 */
function nextSteps(t: Texts, deps: RunScreenDeps, result: RunResultView, formKnown = true): HTMLElement[] {
  const { api, run } = deps;
  const out: HTMLElement[] = [button(t.format("run.viewReport"), () => deps.openReport(result.runId, run.last === null ? null : { profile: run.last.profile, workflow: run.last.workflow }), { id: "run-view-report" })];
  // 3.12: saving the report is one of the next steps of an ended run.
  const workspace = deps.current();
  if (workspace !== null) out.push(...saveReportButton(t, api, workspace, result.runId, "run-save-report"));
  if (result.kind === "run" && result.changes.length > 0) {
    out.push(button(t.format("run.viewChanges"), () => deps.openChanges(result.runId, run.last?.profile ?? null, run.last?.workflow ?? null), { id: "run-view-changes" }));
  }
  if (result.plan !== null) {
    out.push(button(t.format("run.viewPlan"), () => deps.openPlan(result.runId, run.last?.profile ?? null, run.last?.workflow ?? null, formKnown), { id: "run-view-plan" }));
  }
  // U-61 (3.12): the next steps the design names for how the run ended. A run or an apply that
  // changed something can be reverted (done, cancelled, apply_incomplete and the rest alike).
  const form = run.last === null ? null : { profile: run.last.profile, workflow: run.last.workflow };
  const changed = (result.kind === "run" && result.changes.length > 0) || (result.kind === "apply" && result.applied.length > 0);
  const openRevert = deps.openRevert;
  if (changed && openRevert !== undefined) out.push(button(t.format("run.revertPreview"), () => openRevert(result.runId), { id: "run-revert-preview" }));
  if (result.reason === "protected_changed") out.push(button(t.format("run.viewProtected"), () => deps.openReport(result.runId, form, "protected"), { id: "run-view-protected" }));
  const openSettings = deps.openSettings;
  if (result.status === "budget-exhausted" && openSettings !== undefined) out.push(button(t.format("run.viewLimits"), openSettings, { id: "run-view-limits" }));
  // U-226: a run that carried out a plan stops as plan_stale before its first model request, writing nothing.
  const carried = result.kind === "run" && result.planRunId !== null;
  if (result.reason === "plan_stale") out.push(el("p", t.format(carried ? "run.planStaleCarried" : "run.planStale"), { class: "notice", id: "run-plan-stale" }), button(t.format("run.newPlan"), deps.newTask, { id: "run-new-plan" }));
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
  // GU-5 (3.7), U-79: the review panel, the same as the report's review tab has.
  if (result.review !== null && workspace !== null && !formKnown) out.push(el("p", t.format("report.reviewCli"), { class: "notice", id: "run-review-cli" }));
  else if (result.review !== null && workspace !== null) {
    out.push(reviewPanel({ texts: t, api, workspace, runId: result.runId, profile: run.last?.profile ?? null, workflow: run.last?.workflow ?? null, announce: deps.announce }, { panel: "run-review-panel", title: "run-review-title" }));
  }
  return out;
}

/**
 * U-63 (3.5): a task file names its own workspace, which the app layer does not tell the window
 * (reported to the app layer's owner). The next steps read and change the open workspace's records,
 * so they are offered only when the open workspace's run list has this run; otherwise the window
 * says to open the task's workspace.
 */
function taskRunSteps(t: Texts, deps: RunScreenDeps, result: RunResultView): HTMLElement[] {
  const box = el("div", undefined, { id: "run-task-steps", "data-task-place": "checking" });
  const workspace = deps.current();
  void (async () => {
    const reply = workspace === null ? null : asRuns(await deps.api.listRuns(workspace.handle));
    const here = reply !== null && reply.ok && reply.runs.some((item) => item.runId === result.runId);
    box.replaceChildren(...(here ? nextSteps(t, deps, result, false) : [el("p", t.format("run.taskElsewhere"), { class: "notice", id: "run-task-elsewhere" })]));
    box.setAttribute("data-task-place", here ? "open" : "elsewhere");
  })();
  return [box];
}

const FILTERS: readonly RunFilter[] = ["all", "denied", "files", "checks"];

function itemRow(item: RunItemView): HTMLElement {
  const row = el("li", undefined, { "data-kind": item.kind });
  const time = localTime(item.at);
  if (time !== "") row.append(el("time", time, { class: "at" }));
  row.append(el("span", item.text, { class: "text" }));
  return row;
}

function resultView(t: Texts, api: CodarynApi, result: RunResultView, labels: { status: string; reason: string }): HTMLElement {
  const box = el("section", undefined, { id: "run-result", "aria-labelledby": "run-result-title", "data-status": result.status, "data-reason": result.reason });
  box.append(el("h3", t.format("run.result"), { id: "run-result-title" }));
  box.append(el("p", t.format("run.statusLine", { status: labels.status, reason: labels.reason }), { class: "status-line" }));
  const id = el("p", undefined, { class: "run-id" });
  id.append(el("span", t.format("run.runId")), el("code", result.runId, { id: "run-result-id", lang: "en" }), copyControl(t, t.format("copy.runId"), () => api.copyText(result.runId), { id: "run-copy-id" }));
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

  // U-21 (DR-47, AXM-1): the agent's last message, after what was checked, under a label that says
  // it is the agent's own words; text only, its lines kept.
  if (result.finalMessage !== undefined && result.finalMessage !== null) {
    const words = el("div", undefined, { id: "run-final-message" });
    words.append(el("h4", t.format("run.finalMessage")), el("div", result.finalMessage.text, { class: "agent-words", id: "run-final-message-text" }));
    if (result.finalMessage.truncated) words.append(el("p", t.format("run.finalMessageTruncated", { count: String(FINAL_MESSAGE_LIMIT) }), { class: "notice" }));
    box.append(words);
  }

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
  // U-40 (DR-52, AXM-17): whether masking worked, two counts as the CLI's end summary shows them,
  // after the usage; no line when the result has none.
  const masking = maskingLine(t, result.masking);
  if (masking !== null) box.append(el("p", masking, { id: "run-masking" }));
  // U-124 (3.6, DR-3): how the permission questions ended, with the CLI's end summary's meaning.
  const asked = result.confirmations ?? null;
  if (asked !== null) {
    for (const [key, count] of [["allowed", asked.allowed], ["user", asked.user], ["unanswered", asked.default], ["cancelled", asked.cancelled]] as const) {
      if (count > 0) box.append(el("p", t.format(`run.confirm.${key}`, { count: String(count) }), { id: `run-question-${key}` }));
    }
  }
  // U-226 (U-221): a run plan's line counts files to write, as the CLI's end summary does.
  if (result.plan !== null) {
    const digest = result.plan.digest.slice(0, 12);
    const counted = String(result.plan.actions ?? "-");
    box.append(el("p", result.plan.kind === "changes" ? t.format("run.planChanges", { count: counted, digest }) : t.format("run.plan", { actions: counted, digest }), { id: "run-plan" }));
  }
  // U-226 (U-218): a run that carried out a run plan: whose plan, and (the CLI's end summary) its writes
  // refused because the approved plan does not name the file, with how to change other files.
  if (result.kind === "run" && result.planRunId !== null) {
    box.append(el("p", t.format("run.carriedPlan", { runId: result.planRunId }), { id: "run-carried-plan" }));
    const refused = result.deniedNotPlanned ?? 0;
    if (refused > 0) {
      box.append(
        el("p", t.format("run.deniedNotPlanned", { count: String(refused) }), { id: "run-denied-not-planned" }),
        el("p", t.format("run.deniedNotPlannedHint"), { class: "notice", id: "run-denied-not-planned-hint" }),
      );
    }
  }
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
          if (run.done.ok) end.append(resultView(t, api, run.done.result, run.done.labels), ...(run.last?.taskFile === true ? taskRunSteps(t, deps, run.done.result) : nextSteps(t, deps, run.done.result)));
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
