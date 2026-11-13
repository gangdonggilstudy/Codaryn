/**
 * GU-5: the plan screen (docs/design/standalone-gui.md 3.9). A plan run that ended as
 * `plan_pending` shows its plan here; it is not a question during a run (DR-1).
 * - The plan comes from the app layer's `plan`, masked again with the task form's secrets; when
 *   those mask it otherwise than the plan run did, it is not shown (`plan_secrets_differ`, DR-28).
 * - The digest's first 12 characters, the counts of moves and discards, the inventory limit (DR-6).
 * - "Apply this plan…" sends the plan view's approval token only. The main process asks the person
 *   (an OS dialog) and applies the plan it showed; the apply is a new run (DR-2, GT-D13) with the
 *   run screen's progress and cancel.
 * - A plan applied before shows who applied it, and no apply button.
 * - U-32 (as the CLI's `plan`, U-14): a plan run with a records-changed mark has its warning first,
 *   no summary, and in place of the apply button that a new run makes a new plan (the main process
 *   gives it no approval token). The model's summary is shown under the label that says it is the
 *   agent's words and not what is approved (rows drawn as the CLI draws them, by the app layer's modelTextRows).
 * - U-119 (DR-21, adapter-contract 5.14): before an apply can be asked for, the app layer's check of
 *   the plan the main process showed (by its approval token): actions that cannot be applied are
 *   marked on their rows, moves that would need the DR-21 consent are counted and marked, and what the
 *   check could not take back (probe links, the lock) is said. The check is no approval: the apply
 *   still takes the token and the person's OS confirmation. The apply button waits for the check
 *   (which holds the workspace lock a moment).
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asPlan, asPlanCheck, asStartRun } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { button, el } from "../shell/dom.js";
import { copyControl } from "../shell/copy.js";
import type { Screen } from "../shell/shell.js";
import type { PlanActionView } from "../../shared/ipc.js";
import { localDateTime } from "../run/run-model.js";
import type { RunModel } from "../run/run-model.js";

export interface PlanDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  readonly run: RunModel;
  readonly current: () => Workspace | null;
  readonly showRun: () => void;
}

export interface PlanScreen extends Screen {
  /**
   * Which plan run to show next, and the profile and task kind of its task form. `formKnown` false
   * (R21b-L-1): the form it was made with is unknown (the run was started elsewhere), so the plan is
   * shown but cannot be applied here; an apply with another form would be refused after the OS dialog.
   */
  choose(runId: string, profile: string | null, workflow: string | null, formKnown?: boolean, recordsChanged?: boolean): void;
}

export function actionLine(t: Texts, action: PlanActionView): string {
  return action.kind === "move" ? t.format("plan.move", { from: action.from, to: action.to ?? "" }) : t.format("plan.discard", { path: action.from });
}

/**
 * UXM-24: the CLI commands that apply a plan whose form this app does not know, in forms the CLI's
 * `apply` reads (a unit test parses them with its argument reader): its run and the digest's first
 * 12 characters filled in, the task part a <placeholder> the person fills in the way the run was
 * started (a task file, or the workspace folder and its task type).
 */
export function applyCommands(t: Texts, runId: string, digest: string): string[] {
  const plan = `--run ${runId} --digest ${digest.slice(0, 12)}`;
  return [
    `codaryn apply --task <${t.format("plan.cli.taskFile")}> ${plan}`,
    `codaryn apply --workspace <${t.format("plan.cli.workspace")}> --workflow <${t.format("plan.cli.taskType")}> ${plan}`,
  ];
}

/**
 * U-119 (3.9, DR-21): what the check found, in words, with the plan view's rows marked by index:
 * actions that cannot be applied (and that a new run makes a new plan), moves that need the DR-21
 * consent at the apply, probes and a lock the check could not take back, and that it is no approval.
 */
export function planCheckParts(t: Texts, result: ReturnType<typeof asPlanCheck>, rows: readonly HTMLElement[]): HTMLElement[] {
  if (!result.ok) {
    return [
      el("p", `${t.format("plancheck.failed", { code: result.code })} ${errorText(t, result.code)}`, { role: "alert", class: "error", "data-error": result.code }),
      el("p", t.format("plancheck.notApproval"), { class: "notice" }),
    ];
  }
  const parts: HTMLElement[] = [];
  for (const { index, problem } of result.problems) {
    const row = rows[index];
    if (row === undefined) continue;
    row.setAttribute("data-problem", problem);
    const id = `plancheck.problem.${problem}`;
    row.append(el("span", ` — ${t.has(id) ? t.format(id) : problem}`, { class: "plan-problem" }));
  }
  for (const index of result.unsafeMoves) {
    const row = rows[index];
    if (row === undefined) continue;
    row.setAttribute("data-unsafe", "true");
    row.append(el("span", ` — ${t.format("plancheck.unsafeRow")}`, { class: "plan-unsafe" }));
  }
  if (result.problems.length > 0) parts.push(el("p", t.format("plancheck.problems", { count: String(result.problems.length) }), { role: "alert", id: "plan-check-problems" }));
  if (result.unsafeMoves.length > 0) parts.push(el("p", t.format("plancheck.unsafe", { count: String(result.unsafeMoves.length) }), { class: "notice", id: "plan-check-unsafe" }));
  if (result.problems.length === 0 && result.unsafeMoves.length === 0) parts.push(el("p", t.format("plancheck.clean"), { id: "plan-check-clean" }));
  if (result.probesRemoved > 0) parts.push(el("p", t.format("plancheck.probesRemoved", { count: String(result.probesRemoved) }), { class: "notice", id: "plan-check-probes-removed" }));
  if (result.probesLeft > 0) parts.push(el("p", t.format("plancheck.probesLeft", { count: String(result.probesLeft) }), { role: "alert", class: "error", id: "plan-check-probes-left" }));
  if (result.lockLeft) parts.push(el("p", t.format("plancheck.lockLeft"), { role: "alert", class: "error", id: "plan-check-lock-left" }));
  parts.push(el("p", t.format("plancheck.notApproval"), { class: "notice" }));
  return parts;
}

export function planScreen(deps: PlanDeps): PlanScreen {
  const { texts: t, api, run } = deps;
  let chosen: { runId: string; profile: string | null; workflow: string | null; formKnown: boolean; recordsChanged: boolean } | null = null;
  return {
    id: "plan",
    title: "nav.plan",
    choose(runId, profile, workflow, formKnown = true, recordsChanged = false) {
      chosen = { runId, profile, workflow, formKnown, recordsChanged };
    },
    show(root) {
      const workspace = deps.current();
      const body = el("div", undefined, { id: "plan" });
      root.replaceChildren(el("h2", t.format("plan.title")), body);
      if (workspace === null || chosen === null) {
        body.append(el("p", t.format("plan.none")));
        body.setAttribute("data-plan-ready", "none");
        return;
      }
      const target = chosen;
      void (async () => {
        body.replaceChildren(el("p", t.format("runs.loading")));
        const reply = asPlan(await api.plan(workspace.handle, target.runId, target.profile, target.workflow));
        if (!reply.ok) {
          body.replaceChildren(el("div", `${errorText(t, reply.code)} ${t.format("error.code", { code: reply.code })}`, { role: "alert", class: "error", "data-error": reply.code }));
          body.setAttribute("data-plan-ready", "error");
          return;
        }
        const view = reply.view;
        // U-32 (UXM-14, U-14 AXM-2): the mark the plan view itself carries, or the run list's (fail closed).
        const marked = view.recordsChanged === true || target.recordsChanged;
        const moves = view.actions.filter((action) => action.kind === "move").length;
        const summary = el("p", t.format("plan.summary", { moves: String(moves), discards: String(view.actions.length - moves), digest: view.digest.slice(0, 12) }), { id: "plan-summary" });
        const list = el("ul", undefined, { id: "plan-actions" });
        const rows = view.actions.map((action, index) => el("li", actionLine(t, action), { "data-kind": action.kind, "data-index": String(index) }));
        list.append(...rows);
        const parts: HTMLElement[] = [];
        // As the CLI's plan: a marked plan run's warning comes before anything of the plan.
        if (marked) parts.push(el("p", t.format("plan.recordsChanged"), { class: "notice", id: "plan-records-changed" }));
        // U-62 (3.9): the digest's first 12 characters, the part the CLI's apply takes, can be copied.
        parts.push(summary, copyControl(t, t.format("copy.digest"), () => api.copyText(view.digest.slice(0, 12)), { id: "plan-copy-digest" }), el("p", t.format("plan.runId", { runId: view.runId }), { lang: "en" }), list);
        // U-32 (U-14 AXM-15): the model's summary under the label that says whose words they are and
        // that they are not what is approved; rows as the engine drew them. None for a marked plan run.
        if (!marked && view.summary !== undefined && view.summary.length > 0) {
          const words = el("section", undefined, { id: "plan-agent-words" });
          words.append(el("p", t.format("plan.summaryLabel"), { class: "notice" }), el("div", view.summary.join("\n"), { class: "agent-words", id: "plan-agent-words-text" }));
          parts.push(words);
        }
        if (view.inventoryLimitReached) parts.push(el("p", t.format("plan.inventoryLimit"), { class: "notice", id: "plan-inventory" }));
        parts.push(el("p", t.format("plan.modelMade"), { class: "notice" }));
        const message = el("div", undefined, { id: "plan-message", role: "alert" });
        if (view.status !== "applied" && marked) {
          // DR-38: the engine refuses it (plan_records_changed); in place of the apply button.
          parts.push(el("p", t.format("plan.cannotApply"), { class: "notice", id: "plan-cannot-apply" }));
        } else if (view.status !== "applied" && reply.approval !== null && !target.formKnown) {
          const unknown = el("div", undefined, { class: "notice", id: "plan-form-unknown" });
          const commands = el("ul", undefined, { id: "plan-cli-commands" });
          for (const command of applyCommands(t, view.runId, view.digest)) {
            const item = el("li");
            item.append(el("code", command));
            commands.append(item);
          }
          unknown.append(el("p", t.format("plan.formUnknown", { runId: view.runId })), commands);
          parts.push(unknown);
        } else if (view.status === "applied" || reply.approval === null) {
          parts.push(el("p", view.appliedBy === null ? t.format("plan.applied") : t.format("plan.appliedBy", { runId: view.appliedBy.runId, time: localDateTime(view.appliedBy.at) }), { id: "plan-applied" }));
        } else {
          const approval = reply.approval;
          const apply = button(t.format("plan.apply"), () => {
            if (!run.startingApply(approval)) {
              message.replaceChildren(el("p", t.format("task.busy")));
              return;
            }
            apply.setAttribute("disabled", "");
            void (async () => {
              const started = asStartRun(await api.applyPlan(approval, false));
              apply.removeAttribute("disabled");
              if (started.ok) {
                run.started(started.runId, Date.now());
                deps.showRun();
              } else {
                run.failedToStart(started.code);
                message.replaceChildren(el("p", `${errorText(t, started.code)} ${t.format("error.code", { code: started.code })}`, { "data-error": started.code }));
              }
            })();
          }, { id: "plan-apply" });
          // U-119: the check first; the apply waits for its answer (the check holds the lock a moment).
          apply.setAttribute("disabled", "");
          const check = el("section", undefined, { id: "plan-check", "aria-labelledby": "plan-check-title", "data-check": "checking" });
          check.append(el("h3", t.format("plancheck.title"), { id: "plan-check-title" }), el("p", t.format("plancheck.checking")));
          parts.push(check, apply);
          void (async () => {
            const result = asPlanCheck(await api.checkPlan(approval));
            check.replaceChildren(el("h3", t.format("plancheck.title"), { id: "plan-check-title" }), ...planCheckParts(t, result, rows));
            check.setAttribute("data-check", !result.ok ? "error" : result.problems.length > 0 ? "problems" : result.unsafeMoves.length > 0 ? "unsafe" : "clean");
            apply.removeAttribute("disabled");
          })();
        }
        parts.push(message);
        body.replaceChildren(...parts);
        body.setAttribute("data-plan-ready", view.status);
      })();
    },
  };
}
