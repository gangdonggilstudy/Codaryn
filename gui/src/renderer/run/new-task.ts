/**
 * GU-3: the new task screen (docs/design/standalone-gui.md 3.5), the quick form of `startRun`:
 * the open workspace (a handle), a goal, and the task kind and profile chosen from the settings.
 * - The model is shown, not chosen: settings and profiles decide it (settings > model changes it).
 *   The notice names the provider the run will use: the chosen profile's, else the config's, else
 *   the default (SP-D3, SP-D10), with that provider's model.
 * - "Advanced" only says where policy, limits and protected paths come from; the run request has
 *   no field to override them (AC 5.1, M-9).
 * - One run at a time (GUI-D12): the run button is off while a run starts or goes on.
 * - The goal is kept in memory for this session only, to run again (GUI-D11).
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asSettings, asStartRun } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { button, el } from "../shell/dom.js";
import type { Screen } from "../shell/shell.js";
import { GOAL_LIMIT } from "./run-model.js";
import type { RunModel } from "./run-model.js";

export interface NewTaskDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  readonly run: RunModel;
  readonly current: () => Workspace | null;
  readonly open: () => void;
  /** Goes to the run screen once the run has started. */
  readonly showRun: () => void;
  /** R21b-L-1: the form of a run that started, as the workspace's last one. */
  readonly rememberForm?: (form: { readonly profile: string | null; readonly workflow: string | null }) => void;
}

function select(id: string, label: string, options: readonly (readonly [string, string])[], chosen: string): { field: HTMLElement; input: HTMLSelectElement } {
  const field = el("p", undefined, { class: "field" });
  const input = el("select", undefined, { id });
  for (const [value, text] of options) {
    const option = el("option", text, { value });
    if (value === chosen) option.selected = true;
    input.append(option);
  }
  field.append(el("label", label, { for: id }), input);
  return { field, input };
}

export function newTaskScreen(deps: NewTaskDeps): Screen {
  const { texts: t, api, run } = deps;
  return {
    id: "newtask",
    title: "nav.newtask",
    show(root) {
      const workspace = deps.current();
      if (workspace === null) {
        root.replaceChildren(el("h2", t.format("task.title")), el("p", t.format("task.noWorkspace")), button(t.format("home.open"), deps.open, { id: "task-open" }));
        return;
      }
      const body = el("div", undefined, { id: "newtask" });
      root.replaceChildren(el("h2", t.format("task.titleIn", { name: workspace.name })), body);
      void (async () => {
        const reply = asSettings(await api.settings());
        const view = reply.ok ? reply.view : null;
        const workflows: [string, string][] = [["", t.format("task.workflowDefault")]];
        for (const id of view?.workflows.builtin ?? []) workflows.push([id, id]);
        for (const id of view?.workflows.config ?? []) workflows.push([id, t.format("settings.workflowConfig", { workflow: id })]);
        const profiles: [string, string][] = [["", t.format("task.profileNone")]];
        for (const profile of view?.profiles ?? []) profiles.push([profile.name, profile.name]);
        // The workspace's last form (remembered across restarts), else this session's last request.
        const last = workspace.lastForm ?? run.last;
        const known = (value: string | null | undefined, options: readonly (readonly [string, string])[]): string => (value != null && options.some(([id]) => id === value) ? value : "");
        const workflow = select("task-workflow", t.format("task.workflow"), workflows, known(last?.workflow, workflows));
        const profile = select("task-profile", t.format("task.profile"), profiles, known(last?.profile, profiles));

        const goalField = el("p", undefined, { class: "field" });
        const goal = el("textarea", undefined, { id: "task-goal", rows: "4", maxlength: String(GOAL_LIMIT), "aria-describedby": "task-notice" });
        goal.value = run.last?.goal ?? "";
        goalField.append(el("label", t.format("task.goal"), { for: "task-goal" }), goal);

        const model = el("p", undefined, { id: "task-model" });
        const notice = el("p", undefined, { id: "task-notice", class: "notice" });
        const providerInUse = (): string | null => {
          const chosen = view?.profiles.find((item) => item.name === profile.input.value);
          return chosen?.provider ?? view?.provider ?? view?.defaultProvider ?? null;
        };
        const describe = (): void => {
          const provider = providerInUse();
          const entry = view?.apiProviders.find((item) => item.name === provider);
          const modelId = entry === undefined ? (view?.model ?? null) : entry.model;
          model.textContent = modelId === null ? t.format("task.modelNone") : t.format("task.model", { model: modelId });
          notice.textContent = provider === null ? t.format("task.noticeAny") : t.format("task.notice", { provider });
          notice.setAttribute("data-provider", provider ?? "none");
        };
        describe();
        profile.input.addEventListener("change", describe);
        const advanced = el("details", undefined, { id: "task-advanced" });
        advanced.append(el("summary", t.format("task.advanced")), el("p", t.format("task.advancedText")));

        const message = el("div", undefined, { id: "task-message", role: "alert" });
        if (!reply.ok) message.append(el("p", `${errorText(t, reply.code)} ${t.format("error.code", { code: reply.code })}`));
        if (run.startError !== null) message.append(el("p", `${errorText(t, run.startError)} ${t.format("error.code", { code: run.startError })}`, { "data-error": run.startError }));

        const start = (): void => {
          const text = goal.value;
          if (text.trim().length === 0) {
            message.replaceChildren(el("p", t.format("task.goalEmpty")));
            goal.focus();
            return;
          }
          const request = { goal: text, profile: profile.input.value === "" ? null : profile.input.value, workflow: workflow.input.value === "" ? null : workflow.input.value };
          if (!run.starting(request)) return;
          void (async () => {
            const started = asStartRun(await api.startRun(workspace.handle, request.goal, request.profile, request.workflow));
            if (started.ok) {
              run.started(started.runId, Date.now());
              deps.rememberForm?.({ profile: request.profile, workflow: request.workflow });
              deps.showRun();
            } else {
              run.failedToStart(started.code);
            }
          })();
          deps.showRun();
        };
        const runButton = button(t.format("task.run"), start, { id: "task-run", "aria-keyshortcuts": "Control+Enter" });
        if (!run.canStart) {
          runButton.setAttribute("disabled", "");
          message.append(el("p", t.format("task.busy")));
        }
        goal.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && event.ctrlKey && !runButton.hasAttribute("disabled")) {
            event.preventDefault();
            start();
          }
        });
        body.replaceChildren(workflow.field, profile.field, model, goalField, notice, advanced, message, runButton);
        body.setAttribute("data-newtask-ready", reply.ok ? "ok" : "error");
      })();
    },
  };
}
