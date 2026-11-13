/**
 * U-11 (docs/design/standalone-gui.md 3.11): the first-run guide, four pages as `init` asks them.
 * 1. The config file: where it goes (N-1); made with the defaults, or the existing one is used as it
 *    is (N-2: never over an existing file).
 * 2. The model: with the provider's key set, the model list is fetched in Settings > Model (it
 *    connects to the provider's API and says so there); without one, the model stays a
 *    placeholder and the page says how to register the key (N-3). There is no key field anywhere.
 * 3. Permissions: the limits stay the defaults; init's fixed suggestions for the open workspace are
 *    check boxes, all off. Nothing chosen means documents only, no command. Chosen ones go through
 *    the settings proposals, so a command is asked about by the main process (widening, 6.6).
 * 4. Checks: the same checks as the checks screen, in words; without a key, how to register it.
 * R45-L-1: when the settings cannot be read (a missing or broken file), pages 1 to 3 say so and lead
 * to page 4, whose checks run anyway and say why (the config check).
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asCreateSettings, asDoctor, asProposal, asSettings, asSuggestions, asWritten } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { button, el } from "../shell/dom.js";
import type { Screen } from "../shell/shell.js";
import type { SettingsView } from "../../shared/ipc.js";
import { doctorParts } from "../checks/checks.js";
import { keyHowLine, keyOf } from "../settings/key-how.js";

export interface SetupDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  readonly current: () => Workspace | null;
  readonly announce: (text: string) => void;
  /** Goes to another screen (Settings > Model). */
  readonly show: (id: string) => void;
}

const STEPS = ["folder", "model", "permissions", "checks"] as const;
type Step = (typeof STEPS)[number];

function errorLine(t: Texts, code: string): HTMLElement {
  return el("p", `${errorText(t, code)} ${t.format("error.code", { code })}`, { role: "alert", class: "error", "data-error": code });
}

/** The provider runs use now, its key variable and whether it is set (never its value). */

export function setupScreen(deps: SetupDeps): Screen {
  const { texts: t, api } = deps;
  let step: Step = "folder";
  const screen: Screen = {
    id: "setup",
    title: "nav.setup",
    show(root) {
      const index = STEPS.indexOf(step);
      const body = el("section", undefined, { id: "setup", "data-step": step, "aria-labelledby": "setup-step-title" });
      const nav = el("div", undefined, { class: "setup-nav" });
      const go = (to: Step): void => {
        step = to;
        screen.show(root);
      };
      if (index > 0) nav.append(button(t.format("setup.back"), () => go(STEPS[index - 1] as Step), { id: "setup-back" }));
      if (index < STEPS.length - 1) nav.append(button(t.format("setup.next"), () => go(STEPS[index + 1] as Step), { id: "setup-next" }));
      root.replaceChildren(
        el("h2", t.format("setup.title")),
        el("p", t.format("setup.progress", { step: String(index + 1), total: String(STEPS.length) }), { class: "notice" }),
        el("h3", t.format(`setup.step.${step}`), { id: "setup-step-title" }),
        body,
        nav,
      );
      void (async () => {
        const settings = asSettings(await api.settings());
        const workspace = deps.current();
        if (!settings.ok) {
          if (step !== "checks") {
            body.replaceChildren(errorLine(t, settings.code), el("p", t.format("setup.unreadable"), { class: "notice", id: "setup-unreadable" }), button(t.format("setup.toChecks"), () => go("checks"), { id: "setup-to-checks" }));
            body.setAttribute("data-ready", "error");
            return;
          }
          // Page 4 without the settings: the checks only (the config check says why the file cannot be read).
          body.replaceChildren(errorLine(t, settings.code), el("p", t.format("checks.checking")));
          const reply = asDoctor(await api.doctor(workspace?.handle ?? null));
          body.replaceChildren(errorLine(t, settings.code), ...(reply.ok ? doctorParts(t, reply) : [errorLine(t, reply.code)]));
          body.setAttribute("data-ready", reply.ok ? "ok" : "error");
          return;
        }
        const view = settings.view;
        if (step === "folder") {
          const file = view.file;
          if (file === null) {
            body.replaceChildren(el("p", t.format("setup.folder.none")));
          } else if (file.exists) {
            body.replaceChildren(el("p", t.format("setup.folder.exists", { file: file.display }), { id: "setup-config", "data-config": "exists" }));
          } else {
            const outcome = el("div", undefined, { role: "status", id: "setup-create-outcome" });
            const create = button(
              t.format("setup.folder.create"),
              () => {
                create.setAttribute("disabled", "");
                void (async () => {
                  const reply = asCreateSettings(await api.createSettings(workspace?.handle ?? null));
                  if (reply.ok) {
                    outcome.replaceChildren(el("p", t.format(reply.model === "selected" ? "setup.folder.createdModel" : "setup.folder.created")));
                    if (reply.overridden) outcome.append(el("p", t.format("setup.folder.overridden"), { class: "notice" }));
                    outcome.setAttribute("data-created", "yes");
                    deps.announce(t.format("setup.folder.created"));
                  } else if (reply.code === "config_exists") {
                    outcome.replaceChildren(el("p", t.format("setup.folder.existsNow")));
                    outcome.setAttribute("data-created", "exists");
                  } else {
                    create.removeAttribute("disabled");
                    outcome.replaceChildren(errorLine(t, reply.code));
                    outcome.setAttribute("data-created", reply.code);
                  }
                })();
              },
              { id: "setup-create" },
            );
            body.replaceChildren(el("p", t.format("setup.folder.missing", { file: file.display }), { id: "setup-config", "data-config": "missing" }), el("p", t.format("setup.folder.defaults"), { class: "notice" }), create, outcome);
          }
        } else if (step === "model") {
          const key = keyOf(view);
          const parts: HTMLElement[] = [el("p", view.model === null ? t.format("setup.model.none") : t.format("setup.model.current", { model: view.model }))];
          if (key.keySet) {
            parts.push(
              el("p", t.format("setup.model.keySet", { env: key.keyEnv, provider: key.provider }), { id: "setup-key", "data-key": "set" }),
              button(t.format("setup.model.choose"), () => deps.show("settings"), { id: "setup-choose-model" }),
            );
          } else {
            parts.push(el("p", t.format("setup.model.keyMissing", { env: key.keyEnv }), { id: "setup-key", "data-key": "missing" }));
            // U-271 (C-23): how on this OS.
            const how = keyHowLine(t, view, "setup-key-os");
            if (how !== null) parts.push(how);
            parts.push(el("p", t.format("setup.model.tryScripted"), { class: "notice" }));
          }
          body.replaceChildren(...parts);
        } else if (step === "permissions") {
          const parts: HTMLElement[] = [el("p", t.format("setup.permissions.limits"), { class: "notice" })];
          if (view.file === null || !view.file.exists) {
            parts.push(el("p", t.format("setup.permissions.noFile")));
            body.replaceChildren(...parts);
          } else if (workspace === null) {
            parts.push(el("p", t.format("setup.permissions.noWorkspace")));
            body.replaceChildren(...parts);
          } else {
            const reply = asSuggestions(await api.settingsSuggestions(workspace.handle));
            if (!reply.ok) {
              body.replaceChildren(...parts, errorLine(t, reply.code));
              body.setAttribute("data-ready", "error");
              return;
            }
            parts.push(el("p", t.format("setup.permissions.documentsOnly"), { id: "setup-documents-only" }));
            const choices: { input: HTMLInputElement; edit: Readonly<Record<string, unknown>>; label: string }[] = [];
            const list = el("ul", undefined, { id: "setup-suggestions" });
            const add = (kind: string, label: string, edit: Readonly<Record<string, unknown>>, note: string): void => {
              const id = `setup-suggest-${choices.length}`;
              const input = el("input", undefined, { type: "checkbox", id, "data-suggest": kind, "data-label": label });
              const row = el("li");
              row.append(input, el("label", `${label} · ${note}`, { for: id }));
              list.append(row);
              choices.push({ input, edit, label });
            };
            for (const command of reply.commands) add("command", command.shown, { op: "addCommand", executable: command.rule.executable, argsPrefix: [...command.rule.argsPrefix], allowExtraArgs: command.rule.allowExtraArgs }, t.format("setup.permissions.commandNote"));
            for (const path of reply.protectedPaths) add("protect", path, { op: "addProtectedPath", path }, t.format("setup.permissions.protectNote"));
            if (choices.length === 0) parts.push(el("p", t.format("setup.permissions.noSuggestions"), { id: "setup-no-suggestions" }));
            else parts.push(list);
            const outcome = el("ul", undefined, { id: "setup-applied", role: "status" });
            const apply = button(
              t.format("setup.permissions.apply"),
              () => {
                apply.setAttribute("disabled", "");
                void (async () => {
                  outcome.replaceChildren();
                  for (const choice of choices.filter((item) => item.input.checked === true)) {
                    const proposal = asProposal(await api.proposeSettings(choice.edit));
                    let result: string;
                    if (!proposal.ok) result = proposal.code === "already_present" ? "present" : proposal.code;
                    else if (proposal.changes.length === 0) result = "present";
                    else {
                      const written = asWritten(await api.applySettings(proposal.token));
                      result = written.ok ? "written" : written.code;
                    }
                    const id = `setup.applied.${result}`;
                    const words = t.has(id) ? t.format(id) : `${errorText(t, result)} ${t.format("error.code", { code: result })}`;
                    outcome.append(el("li", `${choice.label}: ${words}`, { "data-result": result }));
                  }
                  apply.removeAttribute("disabled");
                  outcome.setAttribute("data-done", String(outcome.children.length));
                })();
              },
              { id: "setup-apply" },
            );
            if (choices.length > 0) parts.push(apply, outcome);
            body.replaceChildren(...parts);
          }
        } else {
          body.replaceChildren(el("p", t.format("checks.checking")));
          const reply = asDoctor(await api.doctor(workspace?.handle ?? null));
          if (!reply.ok) {
            body.replaceChildren(errorLine(t, reply.code));
            body.setAttribute("data-ready", "error");
            return;
          }
          const parts: HTMLElement[] = [...doctorParts(t, reply)];
          const key = keyOf(view);
          if (!key.keySet) parts.push(el("p", t.format("setup.checks.keyHow", { env: key.keyEnv }), { class: "notice", id: "setup-key-how" }));
          const how = keyHowLine(t, view, "setup-checks-key-os");
          if (how !== null) parts.push(how);
          parts.push(el("p", t.format("setup.checks.done"), { class: "notice" }));
          body.replaceChildren(...parts);
        }
        body.setAttribute("data-ready", "ok");
      })();
    },
  };
  return screen;
}
