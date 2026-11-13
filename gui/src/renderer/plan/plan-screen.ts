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
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asPlan, asStartRun } from "../api.js";
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
        for (const action of view.actions) list.append(el("li", actionLine(t, action), { "data-kind": action.kind }));
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
          parts.push(apply);
        }
        parts.push(message);
        body.replaceChildren(...parts);
        body.setAttribute("data-plan-ready", view.status);
      })();
    },
  };
}
